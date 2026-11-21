const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');

const pad = value => String(value).padStart(2, '0');
const iso = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const now = new Date();
const today = iso(now);
const monthStart = offset => new Date(now.getFullYear(), now.getMonth() + offset, 1);
const day = (offset, dayOfMonth) => iso(new Date(now.getFullYear(), now.getMonth() + offset, dayOfMonth));
const monthName = (offset, options = { month: 'long', year: 'numeric' }) => monthStart(offset).toLocaleDateString('en-US', options);

/** A ledger relative to today: two subscriptions, eight categories this month, a foreign expense and a shared one. */
function ledger() {
  const records = [];
  const add = (id, date, amount, category, note = '', extra = {}) => records.push({ id, date, amount, currency: 'CNY', fxRate: 1, category, note, scope: 'personal', ...extra });
  for (const offset of [-3, -2, -1, 0]) add(`netflix${offset}`, day(offset, 1), 68, 'Streaming', 'Netflix · Premium');
  for (const offset of [-2, -1, 0]) add(`spotify${offset}`, day(offset, 1), 15, 'Music', 'Spotify');
  const thisMonth = { Rent: 4200, Groceries: 600, Dining: 300, Travel: 250, Coffee: 120, Transport: 80, Gifts: 30 };
  Object.entries(thisMonth).forEach(([category, amount]) => add(`now-${category}`, day(0, 1), amount, category));
  add('now-books', day(0, 1), 10, 'Books', 'Kindle', { currency: 'USD', fxRate: 7 });
  add('now-shared', day(0, 1), 900, 'Dining', 'Team dinner', { scope: 'shared' });
  add('last-rent', day(-1, 3), 4200, 'Rent');
  add('last-food', day(-1, 9), 500, 'Groceries');
  add('older', day(-4, 12), 300, 'Shopping');
  return { baseCurrency: 'CNY', records };
}
const THIS_MONTH_TOTAL = 68 + 15 + 4200 + 600 + 300 + 250 + 120 + 80 + 30 + 70;
const LAST_MONTH_TOTAL = 68 + 15 + 4200 + 500;

async function startServer(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayfly-insights-'));
  const port = 52600 + Math.floor(Math.random() * 1400), base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['--experimental-sqlite', '--disable-warning=ExperimentalWarning', 'server/index.js'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, PORT: String(port), DAILY_SPACE_DB_PATH: path.join(directory, 'test.sqlite'), SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', GROQ_API_KEY: '', OPENAI_API_KEY: '', AGENT_VISION_MODEL: '' }, stdio: 'ignore' });
  t.after(async () => { if (server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill(); }); fs.rmSync(directory, { recursive: true, force: true }); });
  for (let count = 0; count < 80; count++) { try { if ((await fetch(`${base}/api/health`)).ok) return base; } catch (_) {} await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error('server did not start');
}

async function launch(t) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: process.env.CHROMIUM_NO_SANDBOX === '1' ? ['--no-sandbox'] : [] });
  t.after(() => browser.close());
  return browser;
}

async function guestPage(browser, t, options, book = ledger()) {
  const context = await browser.newContext({ serviceWorkers: 'block', ...options });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(6000); page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**/*', route => route.abort());
  await page.addInitScript(book => {
    if (sessionStorage.getItem('insights-fixture')) return;
    sessionStorage.setItem('insights-fixture', '1'); sessionStorage.setItem('daily-space-guest-save-dismissed-v1', '1');
    localStorage.setItem('daily-space-language-v1', 'en');
    localStorage.setItem('tally-book-v1', JSON.stringify(book));
  }, book);
  return { page, errors };
}

const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('tally-book-v1')));

test('spending insights chart the personal ledger, navigate months and turn subscriptions into bills', { timeout: 90_000 }, async t => {
  const base = await startServer(t), browser = await launch(t);
  const { page, errors } = await guestPage(browser, t, { viewport: { width: 1280, height: 900 } });
  await page.goto(`${base}/tally.html`, { waitUntil: 'load' });
  const insights = page.locator('#tally-spending-insights');
  assert.equal(await insights.evaluate(el => el.open), true, 'open on desktop');
  assert.deepEqual(await page.evaluate(() => [document.getElementById('tally-spending-insights').previousElementSibling.id, document.getElementById('tally-spending-insights').nextElementSibling.id]),
    ['tally-quick-options', 'tally-planning'], 'placed just before Budgets & bills');
  assert.equal(await insights.locator(':scope > summary').textContent(), 'Spending insights · 2 possible subscriptions');

  // This month by category: base currency, personal only, top six plus Other.
  assert.equal(await page.locator('#tally-categories-heading').textContent(), 'This month by category');
  assert.equal(await insights.locator('.tally-insight-total strong').textContent(), `CN¥${THIS_MONTH_TOTAL.toFixed(2)}`);
  const change = Math.round(Math.abs((THIS_MONTH_TOTAL - LAST_MONTH_TOTAL) / LAST_MONTH_TOTAL * 100));
  assert.equal(await insights.locator('.tally-insight-total span').textContent(), `↑ ${change}% vs ${monthName(-1, { month: 'long' })} (CN¥${LAST_MONTH_TOTAL.toFixed(2)})`);
  const rows = insights.locator('.tally-category-row');
  assert.deepEqual(await rows.locator('.tally-category-name').allTextContents(), ['Rent', 'Groceries', 'Dining', 'Travel', 'Coffee', 'Transport', 'Other · 4 categories']);
  assert.equal(await rows.first().locator('.tally-category-value').textContent(), `CN¥4200.00 · ${Math.round(4200 / THIS_MONTH_TOTAL * 100)}%`);
  assert.equal(await rows.last().getAttribute('class'), 'tally-category-row is-other');
  assert.match(await insights.locator('.tally-category-bars').getAttribute('aria-label'), new RegExp(`^Spending by category, ${monthName(0)}: Rent \\d+%, Groceries`));
  assert.equal(await rows.first().locator('.tally-category-track').getAttribute('aria-hidden'), 'true');

  // Six-month trend: every bar has visible text, the viewed month is pressed.
  const bars = insights.locator('.tally-trend-bar');
  assert.equal(await bars.count(), 6);
  assert.deepEqual(await bars.locator('.tally-trend-month').allTextContents(), [-5, -4, -3, -2, -1, 0].map(offset => monthName(offset, { month: 'short' })));
  for (const text of await bars.locator('.tally-trend-value').allTextContents()) assert.ok(text.trim(), 'value text');
  assert.equal(await bars.nth(0).locator('.tally-trend-value').textContent(), '–', 'a month without spending says so');
  assert.equal(await bars.nth(5).getAttribute('aria-pressed'), 'true');
  assert.match(await bars.nth(5).getAttribute('aria-label'), new RegExp(`^${monthName(0)} so far · CN¥${THIS_MONTH_TOTAL.toFixed(2)} · 10 expenses$`));
  assert.match(await insights.locator('.tally-trend').getAttribute('aria-label'), /^Monthly personal spending, .+\. Highest: .+, CN¥\d+\.\d\d\.$/);

  // Choosing a bar moves the ledger to that month; the chart window stays put.
  await bars.nth(4).click();
  assert.equal(await page.locator('#tally-month-title').textContent(), monthName(-1));
  assert.equal(await bars.nth(4).getAttribute('aria-pressed'), 'true');
  assert.equal(await bars.nth(5).getAttribute('aria-pressed'), 'false');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.month), day(-1, 1).slice(0, 7), 'focus stays on the chosen bar');
  assert.equal(await page.locator('#tally-categories-heading').textContent(), `${monthName(-1)} by category`);
  assert.equal(await page.locator('[data-record-id="last-rent"]').count(), 1);
  assert.equal(await page.locator('[data-record-id="now-Rent"]').count(), 0);
  assert.deepEqual(await bars.locator('.tally-trend-month').allTextContents(), [-5, -4, -3, -2, -1, 0].map(offset => monthName(offset, { month: 'short' })));
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#tally-month-title').textContent(), monthName(0));
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-pressed')), 'true');

  // "Add as bill" goes through the recurring-bill save path and records nothing yet.
  const recordsBefore = (await stored(page)).records.length;
  const netflix = insights.locator('[data-subscription-key="netflix"]');
  assert.equal(await netflix.locator('strong').textContent(), 'Netflix · CN¥68.00 / month');
  await netflix.getByRole('button', { name: 'Add as bill', exact: true }).click();
  let book = await stored(page);
  assert.equal(book.records.length, recordsBefore);
  assert.deepEqual(book.recurringBills.map(bill => [bill.name, bill.amount, bill.currency, bill.category, bill.interval, bill.nextDate, bill.enabled]),
    [['Netflix', 68, 'CNY', 'Streaming', 'monthly', day(1, 1), true]]);
  assert.equal(await netflix.count(), 0);
  assert.match(await insights.locator('.tally-planning-status').textContent(), /Netflix is now a recurring bill/);
  assert.equal(await insights.locator(':scope > summary').textContent(), 'Spending insights · 1 possible subscription');
  await page.locator('#tally-planning > summary').click();
  assert.equal(await page.locator('#tally-planning [data-recurring-bill-id]').count(), 1);

  // "Not a subscription" is remembered, can be undone, and survives a reload.
  const spotify = insights.locator('[data-subscription-key="spotify"]');
  await spotify.getByRole('button', { name: 'Not a subscription', exact: true }).click();
  assert.deepEqual((await stored(page)).dismissedSubscriptions, ['spotify']);
  assert.equal(await spotify.count(), 0);
  assert.equal(await insights.locator('.tally-subscription-list').isVisible(), false);
  await page.locator('#undo-bar .undo-bar-action').click();
  assert.deepEqual((await stored(page)).dismissedSubscriptions, []);
  assert.equal(await spotify.count(), 1);
  await spotify.getByRole('button', { name: 'Not a subscription', exact: true }).click();
  await page.reload();
  assert.equal(await page.locator('[data-subscription-key="spotify"]').count(), 0);
  assert.equal(await page.locator('#tally-spending-insights > summary').textContent(), 'Spending insights');
  assert.deepEqual(errors, []);

  await t.test('quiet months show calm empty states', async () => {
    const empty = await guestPage(browser, t, { viewport: { width: 1280, height: 900 } }, { baseCurrency: 'CNY', records: [] });
    await empty.page.goto(`${base}/tally.html`, { waitUntil: 'load' });
    const panel = empty.page.locator('#tally-spending-insights');
    assert.equal(await panel.locator('.tally-category-bars').isVisible(), false);
    assert.equal(await panel.locator('.tally-insight-total').isVisible(), false);
    const messages = await panel.locator('.tally-insight-empty').evaluateAll(nodes => nodes.filter(node => !node.hidden).map(node => node.textContent));
    assert.equal(messages.length, 2);
    assert.equal(messages[0], 'No personal expenses this month yet.');
    assert.match(messages[1], new RegExp(`^No personal expenses in ${monthName(-5, { month: 'long' })}.+${monthName(0)}\\.$`));
    assert.equal(await panel.locator('.tally-trend').isVisible(), false);
    assert.equal(await panel.locator('#tally-subscriptions-heading').isVisible(), false);
    assert.deepEqual(empty.errors, []);
  });

  await t.test('on a 320px phone the panel starts closed, fits and keeps 44px targets', async () => {
    const phone = await guestPage(browser, t, { viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true });
    await phone.page.goto(`${base}/tally.html`, { waitUntil: 'load' });
    const panel = phone.page.locator('#tally-spending-insights');
    assert.equal(await panel.evaluate(el => el.open), false);
    await panel.locator(':scope > summary').click();
    await panel.locator('.tally-trend').waitFor();
    const sizes = await panel.locator('.tally-trend-bar').evaluateAll(nodes => nodes.map(node => { const box = node.getBoundingClientRect(); return [box.width, box.height]; }));
    for (const [width, height] of sizes) assert.ok(width >= 44 && height >= 44, `${width}×${height}`);
    for (const button of await panel.locator('.tally-subscription button').all()) { const box = await button.boundingBox(); assert.ok(box.height >= 44); }
    assert.ok(await phone.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal scroll');
    const outside = await panel.evaluate(root => {
      const inside = (inner, outer) => inner.left >= outer.left - 1 && inner.right <= outer.right + 1;
      const bars = [...root.querySelectorAll('.tally-trend-bar')].flatMap(bar => [...bar.querySelectorAll('.tally-trend-value, .tally-trend-month')].filter(label => !inside(label.getBoundingClientRect(), bar.getBoundingClientRect())));
      const list = root.querySelector('.tally-category-bars').getBoundingClientRect();
      return bars.length + [...root.querySelectorAll('.tally-category-value')].filter(value => !inside(value.getBoundingClientRect(), list)).length;
    });
    assert.equal(outside, 0, 'labels fit their columns');
    await phone.page.reload();
    assert.equal(await phone.page.locator('#tally-spending-insights').evaluate(el => el.open), true, 'the open choice lasts for the session');
    assert.deepEqual(phone.errors, []);
  });
});

/** Minimal JPEG reader for the frame size of the photo the page uploads. */
function jpegSize(buffer) {
  for (let offset = 2; offset + 9 < buffer.length;) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    if (marker >= 0xc0 && marker <= 0xc3) return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    offset += 2 + buffer.readUInt16BE(offset + 2);
  }
  return null;
}

test('receipt scanning fills the expense form for signed-in people and never saves on its own', { timeout: 90_000 }, async t => {
  const base = await startServer(t), browser = await launch(t);
  const user = { provider: 'Google', email: 'alice@example.com', label: 'Alice', userId: 'alice@example.com' };
  const cloudBook = { baseCurrency: 'CNY', records: [{ id: 'existing', date: day(0, 1), amount: 20, currency: 'CNY', fxRate: 1, category: 'Coffee', note: '', scope: 'personal' }] };

  async function accountPage({ signedIn = true, receiptScan = true, receipt } = {}) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    t.after(() => context.close());
    const page = await context.newPage(), errors = [], scans = [];
    page.setDefaultTimeout(8000); page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ user, signedIn, book }) => {
      if (sessionStorage.getItem('receipt-fixture')) return;
      sessionStorage.setItem('receipt-fixture', '1'); sessionStorage.setItem('daily-space-guest-save-dismissed-v1', '1');
      localStorage.setItem('daily-space-language-v1', 'en');
      if (signedIn) localStorage.setItem('daily-space-auth-v1', JSON.stringify(user));
      else localStorage.setItem('tally-book-v1', JSON.stringify(book));
    }, { user, signedIn, book: cloudBook });
    await page.route('https://**/*', route => route.abort());
    let cloud = { payload: { 'tally-book-v1': JSON.stringify(cloudBook) }, revision: 1, updatedAt: '2026-01-01T00:00:00.000Z' };
    await page.route('**/api/**', route => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (pathname === '/api/agent/status') return json({ ok: true, configured: true, connection: 'unverified', modelVerified: false, receiptScan });
      if (pathname === '/api/auth/me') return json({ user: signedIn ? user : null });
      if (pathname === '/api/user/snapshot') {
        if (request.method() === 'PUT') cloud = { payload: request.postDataJSON().payload, revision: cloud.revision + 1, updatedAt: new Date().toISOString() };
        return json({ ok: true, userId: user.userId, ...cloud });
      }
      if (pathname === '/api/fx/rate') return json({ ok: true, rate: 7.1 });
      if (pathname === '/api/tally/receipt') { scans.push(request.postDataJSON()); const next = receipt(); return json(next.body, next.status || 200); }
      return json({ notifications: [], tasks: [], workspaces: [], accounts: [] });
    });
    await page.goto(`${base}/tally.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.DailySpaceTallyCore.readState().records.length === 1 && document.documentElement.dataset.workspaceReady !== 'false');
    return { page, errors, scans };
  }
  const openSheet = async page => { await page.locator('#tally-add-open').click(); await page.locator('#tally-add-sheet').waitFor({ state: 'visible' }); };
  const choosePhoto = page => page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 2400; canvas.height = 1200;
    const context = canvas.getContext('2d'); context.fillStyle = 'white'; context.fillRect(0, 0, 2400, 1200); context.fillStyle = 'black'; context.fillRect(200, 200, 800, 80);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'receipt.png', { type: 'image/png' }));
    const input = document.getElementById('tally-receipt-file'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await t.test('hidden for guests and when the server cannot read receipts', async () => {
    for (const options of [{ signedIn: false }, { receiptScan: false }]) {
      const { page, errors } = await accountPage(options);
      await openSheet(page);
      assert.equal(await page.locator('#tally-receipt-scan').isVisible(), false, JSON.stringify(options));
      assert.deepEqual(errors, []);
    }
  });

  await t.test('a scan pre-fills amount, currency, date, category and note, then the person saves', async () => {
    const yesterday = day(0, 1); // a date in this month that the form would not default to (unless today is the 1st)
    const { page, errors, scans } = await accountPage({ receipt: () => ({ body: { ok: true, receipt: { amount: 23.5, currency: 'USD', date: yesterday, merchant: 'Blue Bottle', category: 'Coffee', note: 'Latte' } } }) });
    await openSheet(page);
    const scan = page.locator('#tally-receipt-scan');
    assert.equal(await scan.textContent(), 'Scan receipt');
    assert.equal(await page.locator('#tally-receipt-file').getAttribute('accept'), 'image/*');
    assert.equal(await page.locator('#tally-receipt-file').getAttribute('capture'), 'environment');
    await choosePhoto(page);
    await page.waitForFunction(() => /^Filled /.test(document.getElementById('tally-receipt-status').textContent));
    assert.equal(await page.locator('#tally-receipt-status').textContent(), 'Filled amount, currency, date, category and note from the receipt. Check them before saving.');
    await page.waitForFunction(() => document.getElementById('tally-fx-rate').value === '7.1');
    assert.deepEqual(await page.evaluate(() => ['tally-amount', 'tally-record-currency', 'tally-date', 'tally-category', 'tally-note'].map(id => document.getElementById(id).value)),
      ['23.5', 'USD', yesterday, 'Coffee', 'Blue Bottle · Latte']);
    assert.equal(await page.locator('#tally-extra-options').evaluate(el => el.open), true, 'More options shows the note and currency');
    assert.equal(scans.length, 1);
    assert.deepEqual([scans[0].lang, scans[0].today], ['en', today]);
    assert.match(scans[0].image, /^data:image\/jpeg;base64,/);
    assert.deepEqual(jpegSize(Buffer.from(scans[0].image.split(',')[1], 'base64')), { width: 1600, height: 800 }, 'downscaled to 1600px on the long side');
    assert.equal(await page.evaluate(() => window.DailySpaceTallyCore.readState().records.length), 1, 'scanning never saves');
    assert.equal(await page.locator('#tally-add-sheet').isVisible(), true);
    await page.locator('#tally-submit').click();
    await page.locator('#tally-add-sheet').waitFor({ state: 'hidden' });
    const saved = await page.evaluate(() => window.DailySpaceTallyCore.readState().records.find(record => record.id !== 'existing'));
    assert.deepEqual([saved.amount, saved.currency, saved.fxRate, saved.date, saved.category, saved.note], [23.5, 'USD', 7.1, yesterday, 'Coffee', 'Blue Bottle · Latte']);
    await page.locator('[data-record-id="existing"]').click();
    await page.locator('#tally-add-sheet').waitFor({ state: 'visible' });
    assert.equal(await scan.isVisible(), false, 'editing an existing expense offers no scan');
    assert.deepEqual(errors, []);
  });

  await t.test('errors keep the form usable, and an unavailable reader hides the button next time', async () => {
    const replies = [{ status: 422, body: { error: 'No receipt details were found in this photo.', code: 'RECEIPT_UNREADABLE' } }, { status: 503, body: { error: 'off', code: 'RECEIPT_SCAN_UNAVAILABLE' } }];
    const { page, errors } = await accountPage({ receipt: () => replies.shift() });
    await openSheet(page);
    await page.locator('#tally-amount').fill('12');
    await choosePhoto(page);
    await page.waitForFunction(() => document.getElementById('tally-receipt-status').classList.contains('is-error'));
    assert.equal(await page.locator('#tally-receipt-status').textContent(), 'No receipt details were found in this photo. Enter the expense yourself.');
    assert.equal(await page.locator('#tally-amount').inputValue(), '12');
    assert.equal(await page.locator('#tally-receipt-scan').getAttribute('aria-disabled'), 'false');
    await choosePhoto(page);
    await page.waitForFunction(() => /not available/.test(document.getElementById('tally-receipt-status').textContent));
    await page.locator('#tally-category').fill('Snacks');
    await page.locator('#tally-submit').click();
    await page.locator('#tally-add-sheet').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.DailySpaceTallyCore.readState().records.filter(record => record.category === 'Snacks' && record.amount === 12).length), 1);
    await openSheet(page);
    assert.equal(await page.locator('#tally-receipt-scan').isVisible(), false);
    assert.equal(await page.locator('#tally-receipt-status').textContent(), '', 'a new expense starts without old scan messages');
    assert.deepEqual(errors, []);
  });
});
