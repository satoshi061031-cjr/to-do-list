const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright-core");

test("browser interactions on desktop and touch screens", { timeout: 120_000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "daily-space-ui-"));
  const port = 45000 + Math.floor(Math.random() * 5000);
  const base = `http://127.0.0.1:${port}`;
  let output = "";
  const server = spawn(process.execPath, ["--experimental-sqlite", "--disable-warning=ExperimentalWarning", "server/index.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, PORT: String(port), DAILY_SPACE_DB_PATH: path.join(directory, "test.sqlite"),
      GROQ_API_KEY: "", OPENAI_API_KEY: "", SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", chunk => { output += chunk; });
  server.stderr.on("data", chunk => { output += chunk; });
  t.after(async () => {
    if (server.exitCode === null) {
      await new Promise(resolve => { server.once("exit", resolve); server.kill("SIGTERM"); });
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  assert.ok(ready, output);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: process.env.CHROMIUM_NO_SANDBOX === "1" ? ["--no-sandbox"] : [] });
  t.after(() => browser.close());
  const errors = [];

  async function pageFor(options = {}) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block", ...options });
    t.after(() => context.close());
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    page.setDefaultNavigationTimeout(10000);
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      if (!localStorage.getItem("todo-app-v2")) {
        localStorage.setItem("todo-app-v2", JSON.stringify({ categories: [], todos: ["a", "b", "c"].map(id => ({
          id, text: `Task ${id}`, completed: false, dueDate: new Date().toISOString().slice(0, 10),
        })) }));
      }
    });
    return page;
  }

  async function trapped(page, dialog) {
    for (let step = 0; step < 20; step++) {
      await page.keyboard.press(step % 3 ? "Tab" : "Shift+Tab");
      assert.ok(await page.locator(dialog).evaluate(node => node.contains(document.activeElement)));
    }
  }

  await t.test("Google sign-in and local Guest are consistent and preserve device data", async () => {
    const page = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const signins = [];
    await page.route("**/api/auth/google/start", async route => {
      signins.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authUrl: `${base}/todo-m.html?oauth-test=1#today` }) });
    });
    await page.goto(`${base}/index.html`, { waitUntil: "load" });
    await page.locator(".welcome-lens").click();
    assert.equal(await page.locator("[data-welcome-provider]").count(), 1);
    assert.equal(await page.locator("[data-welcome-provider]").getAttribute("data-welcome-provider"), "google");
    await page.locator(".welcome-enter").click();
    await page.waitForURL(/todo-m\.html/);
    const saved = await page.evaluate(() => localStorage.getItem("todo-app-v2"));
    assert.equal(signins.length, 0, "Guest must not start OAuth");
    assert.equal(await page.locator("[data-guest-signin]").count(), 1);
    await page.locator("#bento-menu-toggle").click();
    await page.locator(".sidebar-auth-entry").click();
    await page.locator(".auth-modal").waitFor({ state: "visible" });
    assert.equal(await page.locator(".auth-modal [data-provider]").count(), 1);
    assert.equal(await page.locator(".auth-modal [data-provider]").getAttribute("data-provider"), "google");
    await page.locator("[data-auth-guest]").click();
    await page.locator(".auth-modal").waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => localStorage.getItem("todo-app-v2")), saved);
    assert.equal(signins.length, 0);
    assert.equal(await page.evaluate(() => localStorage.getItem("daily-space-auth-v1")), null);
    await page.locator(".sidebar-auth-entry").click();
    await page.locator('[data-provider="google"]').click();
    await page.waitForURL(/oauth-test=1/);
    assert.equal(signins.length, 1, "Google must still start OAuth");
    assert.ok(signins[0].returnTo.includes("todo-m.html"));
    assert.equal(await page.evaluate(() => localStorage.getItem("todo-app-v2")), saved);
    await page.goto(`${base}/mail.html`, { waitUntil: "load" });
    assert.equal(await page.locator('[data-quick-provider="outlook"]').count(), 0);
    assert.equal(await page.locator('[data-quick-provider="gmail"]').count(), 2);
    await page.locator("#mail-signin-space").waitFor({ state: "visible" });
    assert.equal(await page.locator("#guest-save-banner").count(), 0, "Mail must have only its dedicated Google prompt");
    assert.ok(!(await page.locator("#mail-tools").isVisible()));
    assert.equal(await page.evaluate(() => localStorage.getItem("todo-app-v2")), saved);
    await captureMail(page, "mail-guest-390-light.png");
    await page.locator("#mail-signin-space").click();
    await page.waitForURL(/oauth-test=1/);
    assert.equal(signins.length, 2, "Mail guest action must start Google directly");
    assert.ok(signins[1].returnTo.includes("mail.html"));
    assert.equal(await page.evaluate(() => localStorage.getItem("todo-app-v2")), saved);
  });

  await t.test("completion and addition preserve unrelated rows and focus", async () => {
    const page = await pageFor();
    await page.goto(`${base}/todo.html`, { waitUntil: "load" });
    await page.locator('.filter-btn[data-filter="active"]').click();
    await page.locator('#todo-list [data-id="c"]').evaluate(node => { window.unchanged = node; });
    await page.locator('#todo-list [data-id="a"] .todo-check').click();
    await page.locator('#todo-list [data-id="a"]').waitFor({ state: "detached" });
    assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem("todo-app-v2")).todos.find(todo => todo.id === "a").completed));
    assert.ok(await page.evaluate(() => window.unchanged === document.querySelector('#todo-list [data-id="c"]')));
    assert.ok(await page.evaluate(() => document.querySelector("#todo-list").contains(document.activeElement)));
    assert.equal(await page.evaluate(() => window.unchanged.getAnimations().filter(animation => animation.animationName === "enter").length), 0);
    await page.locator("#todo-input").fill("Added in browser");
    await page.locator("#todo-input").press("Enter");
    await page.waitForFunction(() => document.querySelectorAll("#todo-list .todo-item").length === 3);
    assert.ok(await page.evaluate(() => window.unchanged === document.querySelector('#todo-list [data-id="c"]')));
    const label = page.locator('#todo-list [data-id="b"] .todo-label');
    await label.fill("Renamed task");
    await label.press("Enter");
    assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem("todo-app-v2")).todos.some(todo => todo.text === "Renamed task")));
  });

  await t.test("editing drafts survive an update to another task", async () => {
    const page = await pageFor();
    await page.goto(`${base}/todo.html`, { waitUntil: "load" });
    const label = page.locator('#todo-list [data-id="b"] .todo-label');
    await label.fill("Draft still typing");
    await label.evaluate(node => { window.editingNode = node; window.editingOffset = getSelection().anchorOffset; });
    await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem("todo-app-v2"));
      data.todos.find(todo => todo.id === "c").text = "Changed elsewhere";
      localStorage.setItem("todo-app-v2", JSON.stringify(data));
      window.dispatchEvent(new CustomEvent("daily-space-agent-data-updated", { detail: { domains: ["todo"] } }));
    });
    assert.ok(await page.evaluate(() => document.activeElement === window.editingNode));
    assert.equal(await label.innerText(), "Draft still typing");
    assert.ok(await page.evaluate(() => getSelection().anchorOffset === window.editingOffset));
    await label.press("Enter");
    assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem("todo-app-v2")).todos.some(todo => todo.text === "Draft still typing")));
  });

  await t.test("Agent traps focus, isolates background, and restores its trigger", async () => {
    const page = await pageFor();
    await page.goto(`${base}/todo.html`, { waitUntil: "load" });
    await page.locator("#daily-loop-focus").click();
    await page.locator("#todo-agent-overlay").waitFor({ state: "visible" });
    assert.ok(await page.locator("#add-form").evaluate(node => !!node.closest("[inert]")));
    assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden");
    await trapped(page, "#todo-agent-panel");
    await page.keyboard.press("Escape");
    await page.locator("#todo-agent-overlay").waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => document.activeElement.id), "daily-loop-focus");
    assert.ok(await page.locator("#add-form").evaluate(node => !node.closest("[inert]")));
  });

  await t.test("expense and trip sheets trap focus and return to their opening button", async () => {
    const page = await pageFor();
    for (const [route, opener, sheet, panel] of [
      ["tally.html", "#tally-empty-cta", "#tally-add-sheet", ".tally-sheet-panel"],
      ["travel.html", "#travel-empty-add", "#travel-new-sheet", ".travel-sheet-panel"],
    ]) {
      await page.goto(`${base}/${route}`, { waitUntil: "load" });
      await page.locator(opener).click();
      await page.locator(sheet).waitFor({ state: "visible" });
      await trapped(page, panel);
      await page.keyboard.press("Escape");
      await page.locator(sheet).waitFor({ state: "hidden" });
      assert.equal(await page.evaluate(() => document.activeElement.id), opener.slice(1));
    }
  });

  await t.test("keyboard delete does not open expense editing and Undo restores the row", async () => {
    const page = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.goto(`${base}/tally.html`, { waitUntil: "load" });
    await page.locator("#tally-quick-options > summary").click();
    await page.locator("#tally-quick-amount").fill("12");
    await page.locator("#tally-quick-category").fill("Lunch");
    await page.locator('#tally-quick-form button[type="submit"]').click();
    const row = page.locator(".tally-record").first();
    await row.waitFor();
    const control = row.locator(".tally-record-delete");
    const rect = await control.boundingBox();
    assert.ok(rect.width >= 44 && rect.height >= 44);
    await control.focus();
    await control.press("Enter");
    assert.equal(await page.locator(".tally-record").count(), 0);
    assert.ok(await page.locator("#tally-add-sheet").evaluate(node => node.hidden));
    await page.locator(".undo-bar-action").click();
    assert.equal(await page.locator(".tally-record").count(), 1);
    await row.click();
    await page.locator("#tally-add-sheet").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await page.locator("#tally-add-sheet").waitFor({ state: "hidden" });
    assert.ok(await row.evaluate(node => document.activeElement === node));
  });

  await t.test("phone capture preserves drafts, supports consecutive entry, and respects IME composition", async () => {
    const page = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.goto(`${base}/todo-m.html`, { waitUntil: "load" });
    await page.locator("#m-add-task").click();
    await page.locator("#m-task-title").fill("中文输入中的草稿");
    await page.locator("#m-task-title").dispatchEvent("compositionstart");
    await page.locator("#m-task-title").press("Enter");
    await page.locator("#m-task-form").evaluate(form => form.requestSubmit());
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("todo-app-v2")).todos.length), 3);
    await page.locator("#m-task-title").dispatchEvent("compositionend");
    await page.locator("#m-task-save").click();
    assert.equal(await page.locator("#m-task-title").inputValue(), "");
    assert.ok(await page.locator("#m-task-editor").isVisible());
    assert.equal(await page.evaluate(() => document.activeElement.id), "m-task-title");
    await page.locator("#m-task-title").fill("Second capture");
    await page.locator("#m-task-tomorrow").click();
    await page.locator("#m-task-save").click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("todo-app-v2")).todos.length), 5);
    const second = await page.evaluate(() => JSON.parse(localStorage.getItem("todo-app-v2")).todos.find(task => task.text === "Second capture"));
    assert.notEqual(second.dueDate, new Date().toISOString().slice(0, 10));
    await page.locator("#m-task-title").fill("Remember this draft");
    await page.goBack();
    await page.locator("#m-task-editor").waitFor({ state: "hidden" });
    await page.locator("#m-add-task").click();
    assert.equal(await page.locator("#m-task-title").inputValue(), "Remember this draft");
    await page.reload({ waitUntil: "load" });
    assert.equal(await page.locator("#m-task-title").inputValue(), "Remember this draft");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !history.state?.mobileTaskSheet);
    const reopened = await page.context().newPage();
    await reopened.goto(`${base}/todo-m.html`, { waitUntil: "load" });
    await reopened.locator("#m-add-task").click();
    assert.equal(await reopened.locator("#m-task-title").inputValue(), "Remember this draft");
    await reopened.close();
  });

  await t.test("phone task details save dates and repeat, delete with Undo, and remember the completed tab", async () => {
    const page = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.goto(`${base}/todo-m.html`, { waitUntil: "load" });
    await page.locator('#todo-list [data-id="b"] .todo-main').click();
    assert.equal(await page.locator("#m-task-title").inputValue(), "Task b");
    await page.locator("#m-task-title").fill("Updated on phone");
    await page.locator("#m-task-details summary").click();
    await page.locator("#m-task-time").fill("09:30");
    await page.locator("#m-task-repeat").selectOption("weekly");
    await page.locator("#m-task-save").click();
    await page.waitForFunction(() => !history.state?.mobileTaskSheet);
    const task = await page.evaluate(() => JSON.parse(localStorage.getItem("todo-app-v2")).todos.find(task => task.id === "b"));
    assert.equal(task.text, "Updated on phone"); assert.equal(task.dueTime, "09:30"); assert.equal(task.repeat, "weekly");
    await page.locator('#todo-list [data-id="b"] .todo-main').click();
    await page.locator("#m-task-details summary").click();
    await page.locator("#m-task-delete").click();
    await page.waitForFunction(() => !history.state?.mobileTaskSheet);
    await page.waitForFunction(() => {
      const undo = document.querySelector("#undo-bar").getBoundingClientRect();
      const add = document.querySelector(".m-add-bar").getBoundingClientRect();
      return undo.bottom <= add.top;
    });
    await page.locator(".undo-bar-action").click();
    assert.equal(await page.locator('#todo-list [data-id="b"]').count(), 1);
    await page.locator('#todo-list [data-id="b"] .todo-check').click();
    assert.ok(!(await page.locator("#clear-completed").isVisible()));
    await page.locator("#m-filter-completed").click();
    assert.ok(await page.locator("#clear-completed").isVisible());
    assert.equal(await page.locator('#todo-list [data-id="b"]').count(), 1);
    await page.goto(`${base}/calendar.html`, { waitUntil: "load" });
    await page.goto(`${base}/todo-m.html`, { waitUntil: "load" });
    assert.equal(await page.locator("#m-filter-completed").getAttribute("aria-selected"), "true");
  });

  async function touchDock(page, from, to, ending = "touchEnd") {
    const cdp = await page.context().newCDPSession(page);
    const points = { x: from.x, y: from.y };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [points] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{
      x: from.x + (to.x - from.x) * 0.2, y: from.y + (to.y - from.y) * 0.2,
    }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [to] });
    if (ending) await cdp.send("Input.dispatchTouchEvent", { type: ending, touchPoints: [] });
    return cdp;
  }
  async function dockCenter(page, selector) {
    const rect = await page.locator(selector).boundingBox();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }

  await t.test("phone dock follows touch and navigates once on release", async () => {
    const page = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.goto(`${base}/todo-m.html`, { waitUntil: "load" });
    await page.locator(".bento-rail-nav.dock-ready").waitFor();
    const from = await dockCenter(page, '[data-rail-page="todo"]');
    const to = await dockCenter(page, '[data-rail-page="calendar"]');
    const position = { x: to.x - 10, y: to.y };
    const cdp = await touchDock(page, from, position, null);
    assert.ok(page.url().includes("todo-m.html"), "preview must not navigate");
    await page.waitForFunction(x => {
      const rect = document.querySelector(".bento-rail-lens").getBoundingClientRect();
      return Math.abs(rect.x + rect.width / 2 - x) < 2;
    }, position.x);
    const capsule = await page.locator(".bento-rail-lens").boundingBox();
    assert.ok(Math.abs(capsule.x + capsule.width / 2 - position.x) < 2, "capsule follows the finger");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForURL(`${base}/calendar.html`);
    assert.equal(await page.locator('[data-rail-page="calendar"]').getAttribute("aria-current"), "page");
    await page.locator('[data-rail-page="tally"]').click();
    await page.waitForURL(`${base}/tally.html`);
    assert.equal(await page.locator('[data-rail-page="tally"]').getAttribute("aria-current"), "page");
    assert.equal(await page.evaluate(() => sessionStorage.getItem("daily-space-dock-transition-v1")), null);
    assert.ok(await page.evaluate(() => history.length < 6), "a gesture must not create duplicate navigation");
  });

  await t.test("dock cancellation restores selection and More opens once", async () => {
    const page = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.goto(`${base}/todo-m.html`, { waitUntil: "load" });
    await page.locator(".bento-rail-nav.dock-ready").waitFor();
    const from = await dockCenter(page, '[data-rail-page="todo"]');
    const to = await dockCenter(page, '[data-rail-page="calendar"]');
    await touchDock(page, from, to, "touchCancel");
    assert.ok(page.url().includes("todo-m.html"));
    await page.waitForFunction(() => document.querySelector('[data-rail-page="todo"]').hasAttribute("data-dock-active"));
    await touchDock(page, from, { x: from.x + 2, y: from.y - 50 });
    assert.ok(page.url().includes("todo-m.html"), "vertical movement must not change page");
    const more = await dockCenter(page, "#bento-menu-toggle");
    await touchDock(page, from, more);
    assert.equal(await page.locator("#bento-menu-toggle").getAttribute("aria-expanded"), "true");
    assert.ok(await page.locator("#sidebar").isVisible());
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector('[data-rail-page="todo"]').hasAttribute("data-dock-active"));
    await page.locator("#bento-menu-toggle").focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#bento-menu-toggle").getAttribute("aria-expanded"), "true");
  });

  await t.test("dock gestures work with reduced motion and after resizing", async () => {
    const page = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
    await page.goto(`${base}/calendar.html`, { waitUntil: "load" });
    await page.locator(".bento-rail-nav.dock-ready").waitFor();
    assert.equal(await page.locator(".bento-rail-lens").evaluate(node => getComputedStyle(node).transitionDuration), "0s");
    await touchDock(page, await dockCenter(page, '[data-rail-page="calendar"]'), await dockCenter(page, '[data-rail-page="tally"]'));
    await page.waitForURL(`${base}/tally.html`);
    assert.equal(await page.locator(".main-area").evaluate(node => node.getAnimations().length), 0);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForFunction(() => !document.body.classList.contains("has-mobile-dock"));
    assert.equal(await page.locator(".bento-rail-lens").evaluate(node => getComputedStyle(node).display), "none");
    await page.setViewportSize({ width: 360, height: 844 });
    await page.locator(".bento-rail-nav.dock-ready").waitFor();
    await touchDock(page, await dockCenter(page, '[data-rail-page="tally"]'), await dockCenter(page, '[data-rail-page="calendar"]'));
    await page.waitForURL(`${base}/calendar.html`);
  });

  await t.test("phone layouts expose 44px task controls without horizontal overflow", async () => {
    for (const width of [360, 390, 768]) {
      const page = await pageFor({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
      await page.goto(`${base}/todo-m.html`, { waitUntil: "load" });
      for (const selector of ["#todo-list .todo-check-target", "#m-filter-active", "#m-add-task"]) {
        const rect = await page.locator(selector).first().boundingBox();
        assert.ok(rect.width >= 44 && rect.height >= 44, `${selector} at ${width}px`);
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px overflow`);
      assert.equal(await page.locator('#todo-list [contenteditable="true"]').count(), 0);
      await page.locator("#m-add-task").click();
      await page.locator("#m-task-editor").waitFor({ state: "visible" });
      await page.locator("#m-task-title").fill("Phone keyboard check");
      await trapped(page, ".m-task-panel");
      await page.setViewportSize({ width, height: 420 });
      await page.locator("#m-task-details summary").click();
      const saveRect = await page.locator("#m-task-save").boundingBox();
      assert.ok(saveRect.y >= 0 && saveRect.y + saveRect.height <= 420, "Save stays above the viewport edge");
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !history.state?.mobileTaskSheet);
      await page.setViewportSize({ width, height: 844 });
      const ghost = page.locator("#m-agent-toggle");
      await ghost.click();
      await page.locator("#todo-agent-overlay").waitFor({ state: "visible" });
      await trapped(page, "#todo-agent-panel");
      const panel = await page.locator("#todo-agent-panel").boundingBox();
      assert.ok(panel.x >= 0 && panel.x + panel.width <= width + 1);
      await page.setViewportSize({ width, height: 420 });
      const field = await page.locator(".todo-agent-input").boundingBox();
      assert.ok(field.y >= 0 && field.y + field.height <= 420, "Agent input stays visible in a short viewport");
      await page.keyboard.press("Escape");
      assert.equal(await page.evaluate(() => document.activeElement.id), "m-agent-toggle");
    }
  });

  await t.test("reduced-motion preference removes task entry and completion animations", async () => {
    const page = await pageFor({ reducedMotion: "reduce" });
    await page.goto(`${base}/todo.html`, { waitUntil: "load" });
    await page.locator('.filter-btn[data-filter="active"]').click();
    await page.locator("#todo-input").fill("Quiet task");
    await page.locator("#todo-input").press("Enter");
    const task = page.locator("#todo-list .todo-item").filter({ hasText: "Quiet task" });
    assert.equal(await task.evaluate(node => getComputedStyle(node).animationName), "none");
    await task.locator(".todo-check").click();
    await task.waitFor({ state: "detached" });
    assert.equal(await page.locator("#todo-list .is-leaving").count(), 0);
  });

  await t.test("nested dialogs restore prior focus and preserve existing inert regions", async () => {
    const page = await pageFor();
    await page.goto(`${base}/todo.html`, { waitUntil: "load" });
    await page.evaluate(() => {
      const fixture = document.createElement("div");
      fixture.innerHTML = `<button id="sample-open">Sample dialog</button>
        <div id="sample-outer" data-dialog-root hidden><section role="dialog" aria-modal="true">
          <button id="sample-inner-open">Nested</button><button data-dialog-close id="sample-close">Close</button>
        </section></div>
        <div id="sample-inner" data-dialog-root hidden><section role="dialog" aria-modal="true">
          <button data-dialog-close id="sample-inner-close">Close nested</button>
        </section></div><div id="sample-inert" inert>Already inert</div>`;
      document.body.appendChild(fixture);
      document.querySelector("#sample-open").onclick = () => { document.querySelector("#sample-outer").hidden = false; };
      document.querySelector("#sample-inner-open").onclick = () => { document.querySelector("#sample-inner").hidden = false; };
      document.querySelector("#sample-close").onclick = () => { document.querySelector("#sample-outer").hidden = true; };
      document.querySelector("#sample-inner-close").onclick = () => { document.querySelector("#sample-inner").hidden = true; };
    });
    await page.locator("#sample-open").click();
    await page.locator("#sample-inner-open").click();
    await trapped(page, "#sample-inner [role=dialog]");
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => document.activeElement.id), "sample-inner-open");
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => document.activeElement.id), "sample-open");
    assert.ok(await page.locator("#sample-inert").evaluate(node => node.inert));
  });

  const mailAccounts = [
    { id: "personal", provider: "Gmail", email: "hello@gmail.com", hasCredentials: true, connectedAt: "2026-10-01T09:00:00Z" },
    { id: "work", provider: "Gmail", email: "work@gmail.com", hasCredentials: true, connectedAt: "2026-10-01T09:00:00Z" },
  ];
  const mailMessages = [
    { id: "project", threadId: "thread-project", from: '林夏 <lin@example.com>', subject: "下周的设计评审", receivedAt: new Date().toISOString(), snippet: "周三下午一起看一下新版界面，提前准备两三个你最想讨论的问题。", summary: "周三前准备设计评审的问题。" },
    { id: "hotel", from: 'Mori Hotel <stay@example.com>', subject: "Hotel booking · 京都的周末", receivedAt: new Date().toISOString(), snippet: "你的预订已确认。10 月 24 日入住，10 月 26 日退房。", summary: "确认入住时间，并把酒店安排加入旅行。" },
    { id: "invoice", from: "North Studio <team@example.com>", subject: "十月项目账单", receivedAt: "2026-10-12T09:00:00Z", snippet: "附件是本月项目账单，方便时请确认一下。", summary: "查看本月账单。" },
    { id: "notes", from: "阿远 <yuan@example.com>", subject: "给你的阅读清单", receivedAt: "2026-10-11T09:00:00Z", snippet: "挑了几篇可能对你有帮助的文章，有空的时候慢慢看。" },
    { id: "coffee", from: "小野 <ono@example.com>", subject: "周末见", receivedAt: "2026-10-10T09:00:00Z", snippet: "街角那家咖啡馆开了，周末一起去坐坐。" },
    { id: "unsafe", from: '<img src=x onerror="window.mailInjected=true">', subject: '<script>window.mailInjected=true</script>', receivedAt: null, snippet: "Plain-text mail preview." },
  ];
  const mailDigest = "准备周三的设计评审。\n确认京都酒店的入住时间。\n查看十月项目账单。\n有空看看阿远的阅读清单。";
  async function mockMail(page, respond = () => ({ messages: mailMessages, digest: mailDigest, summarized: true })) {
    let user = { userId: "mail-reader", email: "hello@gmail.com", label: "Mail reader", provider: "Google" };
    const requests = [];
    await page.addInitScript(() => localStorage.setItem("daily-space-auth-v1", JSON.stringify({ provider: "Google", label: "Mail reader", email: "hello@gmail.com", mailProvider: "gmail" })));
    const json = (route, value, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    await page.route("**/api/auth/me", route => json(route, { user }));
    await page.route("**/api/user/snapshot", route => json(route, { payload: {}, revision: 0 }));
    await page.route("**/api/agent/status", route => json(route, { configured: true }));
    await page.route("**/api/mail/accounts", route => json(route, { accounts: mailAccounts }));
    await page.route("**/api/mail/accounts/*/digest?*", async route => {
      const accountId = new URL(route.request().url()).pathname.split("/")[4];
      requests.push(accountId);
      const value = await respond(accountId, requests.length);
      await json(route, value.body || value, value.status || 200).catch(() => {}); // Switching accounts can abort the request.
    });
    return { requests, setUser: value => { user = value; } };
  }
  async function captureMail(page, filename) {
    if (!process.env.UI_CAPTURE_DIR) return;
    fs.mkdirSync(process.env.UI_CAPTURE_DIR, { recursive: true });
    await page.mouse.move(1, 1);
    await page.screenshot({ path: path.join(process.env.UI_CAPTURE_DIR, filename), animations: "disabled", style: "#sidebar-hint { visibility: hidden; }" });
  }

  await t.test("Mail reader is safe, keyboard accessible, and adds a task once", async () => {
    const page = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await mockMail(page);
    await page.goto(`${base}/mail.html`, { waitUntil: "load" });
    await page.locator('[data-open-mail="project"]').waitFor();
    assert.ok(!(await page.locator(".mail-message-check").first().isVisible()));
    assert.equal(await page.locator(".mail-message-actions").count(), 0);
    assert.ok(!(await page.locator("#mail-import-pdf").isVisible()));
    assert.ok(!(await page.locator("#mail-digest-section").evaluate(node => node.open)));
    await page.locator("#mail-digest-section > summary").click();
    assert.equal(await page.locator("#mail-digest li").count(), 3);
    await page.locator("#mail-digest-rest > summary").click();
    assert.equal(await page.locator("#mail-digest-full").textContent(), mailDigest);
    await page.locator("#mail-digest-section > summary").click();
    await page.evaluate(() => { window.DailySpaceI18n.setLocale("zh"); document.documentElement.dataset.theme = "dark"; });
    await captureMail(page, "mail-390-dark.png");
    await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
    await captureMail(page, "mail-390-light.png");
    await page.setViewportSize({ width: 1280, height: 900 });
    await captureMail(page, "mail-desktop-light.png");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-open-mail="project"]').click();
    await page.locator("#mail-detail-sheet").waitFor({ state: "visible" });
    await trapped(page, ".mail-detail-panel");
    assert.ok(await page.locator("#mail-inbox").evaluate(node => !!node.closest("[inert]")));
    assert.ok(!(await page.locator("#mail-detail-booking").isVisible()));
    assert.equal(await page.locator("#mail-detail-original").getAttribute("href"), "https://mail.google.com/mail/?authuser=hello%40gmail.com#all/thread-project");
    await captureMail(page, "mail-detail-390-light.png");
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem("todo-app-v2") || '{"todos":[]}').todos.length);
    await page.locator("#mail-detail-add").click();
    assert.ok(await page.locator("#mail-detail-add").isDisabled());
    const added = await page.evaluate(() => JSON.parse(localStorage.getItem("todo-app-v2")).todos);
    assert.equal(added.length, before + 1);
    assert.equal(added.filter(item => item.sourceMailId === "mail:personal:project").length, 1);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.activeElement?.dataset.openMail === "project");
    await page.locator('[data-open-mail="project"]').click();
    assert.ok(await page.locator("#mail-detail-add").isDisabled());
    await page.keyboard.press("Escape");
    await page.locator('[data-open-mail="unsafe"]').click();
    assert.equal(await page.locator("#mail-detail-title").textContent(), mailMessages.at(-1).subject);
    assert.equal(await page.locator("#mail-detail-title script").count(), 0);
    assert.equal(await page.evaluate(() => window.mailInjected), undefined);
    assert.match(await page.locator("#mail-detail-time").textContent(), /Unknown time|时间未知/);
    await page.keyboard.press("Escape");
    await page.locator("#mail-tools > summary").click();
    assert.ok(await page.locator("#mail-import-pdf").isVisible());
    await page.locator("#notif-bell").click();
    assert.ok(!(await page.locator("#mail-import-pdf").isVisible()));
    assert.ok(await page.locator(".notif-panel").isVisible());
    const notification = await page.locator(".notif-panel").boundingBox();
    assert.ok(notification.x >= 0 && notification.x + notification.width <= 390);
    const bell = await page.locator("#notif-bell").boundingBox();
    assert.ok(bell.width >= 44 && bell.height >= 44);
    await page.keyboard.press("Escape");
    assert.ok(!(await page.locator("#mail-import-pdf").isVisible()));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  });

  await t.test("Mail selection survives refresh errors, retries and excludes added tasks", async () => {
    const page = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    let releaseRefresh;
    let response = null;
    await mockMail(page, () => response || ({ messages: mailMessages, digest: mailDigest, summarized: true }));
    await page.goto(`${base}/mail.html`, { waitUntil: "load" });
    await page.locator('[data-open-mail="project"]').waitFor();
    await page.locator("#mail-select-toggle").click();
    await page.locator('[data-mail-check="project"]').check();
    assert.ok(await page.locator("#mail-select-all").evaluate(node => node.indeterminate));
    const bar = await page.locator("#mail-batch-bar").boundingBox();
    const dock = await page.locator(".bento-rail").boundingBox();
    assert.ok(bar.y + bar.height <= dock.y, "batch actions must sit above the dock");
    response = new Promise(resolve => { releaseRefresh = resolve; });
    await page.locator("#mail-refresh").click();
    assert.ok(await page.locator('[data-mail-check="project"]').isChecked());
    assert.equal(await page.locator("#mail-digest li").count(), 3);
    releaseRefresh({ status: 502, body: { error: "Temporary mail service failure" } });
    await page.locator("#mail-status .mail-retry-btn").waitFor();
    assert.equal(await page.locator(".mail-message-item").count(), mailMessages.length);
    assert.ok(await page.locator('[data-mail-check="project"]').isChecked());
    assert.equal(await page.locator("#mail-digest-full").textContent(), mailDigest);
    response = null;
    await page.locator("#mail-status .mail-retry-btn").click();
    await page.locator("#mail-status").waitFor({ state: "hidden" });
    assert.ok(await page.locator('[data-mail-check="project"]').isChecked());
    await page.locator("#mail-select-all").check();
    assert.equal(await page.locator('[data-mail-check]:checked').count(), mailMessages.length);
    await page.evaluate(() => { window.DailySpaceI18n.setLocale("zh"); document.documentElement.dataset.theme = "dark"; });
    await captureMail(page, "mail-select-390-dark.png");
    await page.locator("#mail-add-selected").click();
    assert.ok(!(await page.locator("#mail-batch-bar").isVisible()));
    await page.locator("#mail-select-toggle").click();
    assert.ok(await page.locator("#mail-select-all").isDisabled());
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("todo-app-v2")).todos.filter(task => task.sourceMailId?.startsWith("mail:personal:")).length), mailMessages.length);
    await page.setViewportSize({ width: 320, height: 568 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const narrowBar = await page.locator("#mail-batch-bar").boundingBox();
    const narrowDock = await page.locator(".bento-rail").boundingBox();
    assert.ok(narrowBar.y + narrowBar.height <= narrowDock.y);
  });

  await t.test("Mailbox changes and sign-out ignore old responses and clear private views", async () => {
    const page = await pageFor();
    let releasePersonal;
    let personalPending = false;
    const fixture = await mockMail(page, accountId => accountId === "work"
      ? ({ status: 502, body: { error: "Work mailbox unavailable" } })
      : personalPending ? new Promise(resolve => { releasePersonal = resolve; })
        : ({ messages: mailMessages, digest: mailDigest, summarized: true }));
    await page.goto(`${base}/mail.html`, { waitUntil: "load" });
    await page.locator('[data-open-mail="project"]').waitFor();
    await page.locator("#mail-select-toggle").click();
    await page.locator('[data-mail-check="project"]').check();
    personalPending = true;
    await page.locator("#mail-refresh").click();
    await page.waitForFunction(() => document.getElementById("mail-refresh").disabled);
    await page.locator("#mail-account-switcher").selectOption("work");
    await page.locator("#mail-status .mail-retry-btn").waitFor();
    releasePersonal({ messages: [{ ...mailMessages[0], subject: "Stale personal response" }], digest: "Stale digest", summarized: true });
    assert.equal(await page.locator(".mail-message-item").count(), 0);
    assert.ok(!(await page.locator("#mail-digest-section").isVisible()));
    assert.ok(!(await page.locator("#mail-batch-bar").isVisible()));
    personalPending = false;
    await page.locator("#mail-account-switcher").selectOption("personal");
    await page.locator('[data-open-mail="project"]').waitFor();
    assert.equal(await page.locator('[data-mail-check]:checked').count(), 0);
    await page.locator('[data-open-mail="project"]').click();
    fixture.setUser(null);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("daily-space-auth-updated")));
    await page.locator("#mail-signin-space").waitFor({ state: "visible" });
    assert.ok(!(await page.locator("#mail-detail-sheet").isVisible()));
    assert.ok(!(await page.locator("#mail-inbox").isVisible()));
    assert.ok(!(await page.locator("#mail-tools").isVisible()));
    assert.ok(!(await page.locator("#mail-refresh").isVisible()));
  });

  await t.test("Mail booking details nest safely and reader actions remain visible on short screens", async () => {
    const page = await pageFor({ viewport: { width: 390, height: 420 }, isMobile: true, hasTouch: true });
    const messages = mailMessages.map(message => message.id === "hotel"
      ? { ...message, subject: message.subject.repeat(12), snippet: message.snippet.repeat(30) } : message);
    await mockMail(page, () => ({ messages, digest: "", summarized: false, fallbackReason: "agent_not_configured" }));
    await page.route("**/api/mail/accounts/*/messages/*/booking-import", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ bookings: [], source: { subject: "Kyoto confirmation" }, parsedBy: "fallback" }) }));
    await page.goto(`${base}/mail.html`, { waitUntil: "load" });
    await page.locator('[data-open-mail="hotel"]').waitFor();
    await page.locator("#mail-digest-section > summary").click();
    assert.ok(await page.locator("#mail-ai-banner").isVisible());
    assert.ok(!(await page.locator("#mail-ai-banner").textContent()).includes("GROQ_API_KEY"));
    await page.locator('[data-open-mail="hotel"]').click();
    const button = await page.locator("#mail-detail-add").boundingBox();
    assert.ok(button.y >= 0 && button.y + button.height <= 420);
    await page.locator("#mail-detail-booking").click();
    await page.locator("#mail-booking-sheet").waitFor({ state: "visible" });
    await trapped(page, ".mail-booking-panel");
    await page.keyboard.press("Escape");
    assert.ok(await page.locator("#mail-detail-sheet").isVisible());
    assert.equal(await page.evaluate(() => document.activeElement.id), "mail-detail-booking");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.activeElement?.dataset.openMail === "hotel");
    let releaseBooking;
    await page.route("**/api/mail/accounts/*/messages/*/booking-import", async route => {
      const payload = await new Promise(resolve => { releaseBooking = resolve; });
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(payload) });
    });
    await page.locator('[data-open-mail="hotel"]').click();
    await page.locator("#mail-detail-booking").click();
    await page.keyboard.press("Escape");
    const completed = page.waitForResponse(/booking-import$/);
    releaseBooking({ bookings: [], source: { subject: "Late booking" } });
    await completed;
    await page.waitForFunction(() => !document.getElementById("mail-detail-booking").disabled);
    assert.ok(!(await page.locator("#mail-booking-sheet").isVisible()), "closing the reader must discard pending booking results");
  });

  async function seedWorkspace(page, signedIn = false) {
    await page.addInitScript(signed => {
      if (sessionStorage.getItem("site-fixtures")) return;
      sessionStorage.setItem("site-fixtures", "1");
      sessionStorage.setItem("daily-space-guest-save-dismissed-v1", "1");
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const old = "2025-02-15";
      localStorage.setItem("todo-app-v2", JSON.stringify({ categories: [], selectedCategoryKey: "__all__", todos: [
        { id: "focus-task:&", text: "Search destination task", completed: true, dueDate: old },
        { id: "design", text: "整理设计评审的问题", completed: false, dueDate: today, dueTime: "09:30" },
        { id: "walk", text: "傍晚去河边走走", completed: false, dueDate: today, dueTime: "18:00" },
      ] }));
      localStorage.setItem("calendar-app-v1", JSON.stringify({ selectedDate: today, reminders: [
        { id: "focus-reminder", text: "Search destination reminder", date: old, startTime: "10:00", endTime: "11:00", priority: "medium" },
        { id: "review", text: "和林夏讨论新版界面", date: today, startTime: "14:00", endTime: "15:00", priority: "medium" },
        { id: "coffee", text: "咖啡馆见小野", date: today, startTime: "16:30", endTime: "17:00", priority: "low" },
      ] }));
      localStorage.setItem("tally-book-v1", JSON.stringify({ baseCurrency: "CNY", budget: 3000, records: [
        { id: "focus-expense", date: old, amount: 108, category: "Search destination expense", note: "An older record", currency: "CNY", scope: "personal" },
        { id: "lunch", date: today, amount: 48, category: "午餐", note: "街角的面馆", currency: "CNY", scope: "personal" },
        { id: "taxi", date: today, amount: 16, category: "交通", note: "回家的地铁", currency: "CNY", scope: "personal" },
      ] }));
      const columns = ["planned", "progress", "done", "hold"].map((status, index) => ({ id: status, status, systemKey: status, title: ["Planned", "In Progress", "Done", "On Hold"][index], emoji: "○" }));
      localStorage.setItem("planner-app-v1", JSON.stringify({ version: 2, planners: [{ id: "board-a", name: "个人项目" }, { id: "board-b", name: "新网站" }], selectedPlannerId: "board-a", boards: {
        "board-a": { columns, entries: [] },
        "board-b": { columns, entries: [{ id: "focus-card", columnId: "hold", title: "Search destination card", note: "Details of the right card", completed: false, expanded: false, tags: [] }] },
      } }));
      localStorage.setItem("travel-book-v1", JSON.stringify({ version: 5, activeTripId: "trip-a", trips: [
        { id: "trip-a", name: "东京", destination: "Tokyo", startDate: "2026-11-01", endDate: "2026-11-03", lat: 35.68, lng: 139.69, zoom: 12, stops: [] },
        { id: "focus-trip", name: "Search destination trip", destination: "Kyoto", startDate: "2026-11-04", endDate: "2026-11-06", lat: 35.01, lng: 135.76, zoom: 12, stops: [] },
      ] }));
      if (signed) localStorage.setItem("daily-space-auth-v1", JSON.stringify({ provider: "Google", label: "Reader", email: "reader@gmail.com" }));
    }, signedIn);
    await page.route("https://**/*", route => route.abort());
    if (signedIn) {
      const json = (route, body) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
      await page.route("**/api/auth/me", route => json(route, { user: { userId: "reader", email: "reader@gmail.com", label: "Reader", provider: "Google" } }));
      await page.route("**/api/user/snapshot", route => json(route, { payload: {}, revision: 0 }));
      await page.route("**/api/me/notifications?*", route => json(route, { notifications: [] }));
    }
  }
  async function openWorkspaceSearch(page, text) {
    await page.locator("[data-workspace-search]").click();
    const palette = page.locator(".command-palette:visible");
    await palette.locator("input[type=search]").fill(text);
    return palette;
  }

  await t.test("page headers group search and notifications without overlapping phone controls", async () => {
    const page = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await seedWorkspace(page, true);
    for (const route of ["todo-m.html", "calendar.html", "tally.html", "planner.html", "teamwork.html", "travel.html"]) {
      await page.goto(`${base}/${route}`, { waitUntil: "load" });
      const header = page.locator("[data-page-header]").first();
      await header.locator("[data-workspace-search]").waitFor();
      const controls = await header.locator(".page-action-cluster > button, .page-action-cluster > details > summary, #notif-bell").evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).map(node => {
        const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height };
      }));
      for (const rect of controls) assert.ok(rect.width >= 44 && rect.height >= 44 && rect.x >= 0 && rect.x + rect.width <= 390, route);
      for (let a = 0; a < controls.length; a++) for (let b = a + 1; b < controls.length; b++) {
        const first = controls[a], second = controls[b];
        assert.ok(first.x + first.width <= second.x || second.x + second.width <= first.x || first.y + first.height <= second.y || second.y + second.height <= first.y, route);
      }
      await header.locator("[data-workspace-search]").click();
      await trapped(page, ".command-palette:visible");
      await page.keyboard.press("Escape");
      await page.locator(".command-palette:visible").waitFor({ state: "hidden" });
      assert.ok(await header.locator("[data-workspace-search]").evaluate(node => node === document.activeElement));
      await page.locator("#notif-bell").click();
      const panel = await page.locator(".notif-panel").boundingBox();
      assert.ok(panel.x >= 0 && panel.x + panel.width <= 390, route);
      await page.keyboard.press("Escape");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), route);
    }
  });

  await t.test("phone Calendar captures tasks and reminders, retains drafts and closes on Back", async () => {
    const page = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await seedWorkspace(page);
    await page.goto(`${base}/calendar.html`, { waitUntil: "load" });
    assert.ok(await page.locator("#calendar-title").isVisible());
    assert.ok(await page.locator("#task-list").isVisible());
    assert.ok(!(await page.locator("#day-task-form").isVisible()));
    assert.ok(!(await page.locator("#reminder-form").isVisible()));
    assert.ok(!(await page.locator("#cal-search-input").isVisible()));
    const capture = await page.locator("#calendar-capture").boundingBox();
    const dock = await page.locator(".bento-rail").boundingBox();
    assert.ok(capture.y + capture.height <= dock.y);
    await page.evaluate(() => window.DailySpaceI18n.setLocale("zh"));
    await captureMail(page, "calendar-390-light.png");
    await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
    await captureMail(page, "calendar-390-dark.png");
    await page.locator("#calendar-capture").click();
    await page.locator("#calendar-editor-save").click();
    assert.ok(await page.locator("#calendar-editor-sheet").isVisible(), "an empty reminder must stay in the editor");
    await page.locator("#reminder-input").fill("Draft appointment");
    await trapped(page, ".calendar-editor-panel");
    await page.goBack();
    await page.locator("#calendar-editor-sheet").waitFor({ state: "hidden" });
    await page.locator("#calendar-capture").click();
    assert.equal(await page.locator("#reminder-input").inputValue(), "Draft appointment");
    await page.locator("#reminder-start-time").fill("13:30");
    await page.locator("#reminder-end-time").fill("14:00");
    await page.setViewportSize({ width: 390, height: 420 });
    await page.waitForFunction(() => {
      const rect = document.getElementById("calendar-editor-save").getBoundingClientRect();
      return rect.y >= 0 && rect.bottom <= innerHeight;
    });
    const save = await page.locator("#calendar-editor-save").boundingBox();
    assert.ok(save.y >= 0 && save.y + save.height <= 420);
    await page.locator("#calendar-editor-save").click();
    await page.waitForFunction(() => !history.state?.workspaceSheet);
    const appointment = await page.evaluate(() => JSON.parse(localStorage.getItem("calendar-app-v1")).reminders.find(item => item.text === "Draft appointment"));
    assert.equal(appointment.startTime, "13:30"); assert.equal(appointment.endTime, "14:00");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#calendar-capture").click();
    await page.locator('[data-calendar-kind="task"]').click();
    await page.locator("#day-task-input").fill("Task from Calendar");
    await captureMail(page, "calendar-editor-390-dark.png");
    await page.locator("#calendar-editor-save").click();
    await page.waitForFunction(() => !history.state?.workspaceSheet);
    assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem("todo-app-v2")).todos.some(item => item.text === "Task from Calendar")));
    await page.locator("#calendar-search-options > summary").click();
    await page.locator("#cal-search-input").fill("Draft appointment");
    await page.reload({ waitUntil: "load" });
    assert.equal(await page.locator("#cal-search-input").inputValue(), "Draft appointment");
    await page.setViewportSize({ width: 1280, height: 900 });
    await captureMail(page, "calendar-desktop-dark.png");
  });

  await t.test("phone Tally saves editor drafts, exposes tools and preserves the selected month", async () => {
    const page = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await seedWorkspace(page);
    await page.goto(`${base}/tally.html`, { waitUntil: "load" });
    assert.ok(!(await page.locator("#tally-export").isVisible()));
    assert.ok(!(await page.locator("#tally-category").isVisible()));
    const add = await page.locator("#tally-add-open").boundingBox();
    const dock = await page.locator(".bento-rail").boundingBox();
    assert.ok(add.y + add.height <= dock.y);
    await page.evaluate(() => window.DailySpaceI18n.setLocale("zh"));
    await captureMail(page, "tally-390-light.png");
    await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
    await captureMail(page, "tally-390-dark.png");
    await page.locator("#tally-add-open").click();
    await page.locator("#tally-amount").fill("0");
    await page.locator("#tally-submit").click();
    assert.ok(await page.locator("#tally-add-sheet").isVisible(), "a zero amount must stay in the editor");
    await page.locator("#tally-amount").fill("23");
    await page.locator("#tally-category").fill("Dinner");
    assert.equal(await page.locator("#tally-note").isVisible(), false);
    await page.locator("#tally-extra-options > summary").click();
    await page.locator("#tally-note").fill("A saved draft");
    await page.goBack();
    await page.locator("#tally-add-sheet").waitFor({ state: "hidden" });
    await page.locator("#tally-add-open").click();
    assert.equal(await page.locator("#tally-amount").inputValue(), "23");
    assert.equal(await page.locator("#tally-note").inputValue(), "A saved draft");
    await page.reload({ waitUntil: "load" });
    assert.ok(await page.locator("#tally-add-sheet").isVisible());
    assert.equal(await page.locator("#tally-note").inputValue(), "A saved draft");
    await page.setViewportSize({ width: 390, height: 420 });
    await page.waitForFunction(() => {
      const rect = document.getElementById("tally-submit").getBoundingClientRect();
      return rect.y >= 0 && rect.bottom <= innerHeight;
    });
    const save = await page.locator("#tally-submit").boundingBox();
    assert.ok(save.y >= 0 && save.y + save.height <= 420);
    await page.locator("#tally-submit").click();
    await page.waitForFunction(() => !history.state?.workspaceSheet);
    await page.locator("#tally-add-sheet").waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("tally-book-v1")).records.filter(item => item.note === "A saved draft").length), 1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#tally-tools > summary").click();
    await page.locator("#tally-settings-toggle").click();
    assert.ok(await page.locator("#tally-settings").isVisible());
    await page.locator("#tally-tools > summary").click();
    const download = page.waitForEvent("download");
    await page.locator("#tally-export").click();
    assert.match((await download).suggestedFilename(), /\.csv$/);
    await page.locator("#tally-prev").click();
    const month = await page.locator("#tally-month-title").textContent();
    await page.reload({ waitUntil: "load" });
    assert.equal(await page.locator("#tally-month-title").textContent(), month);
    await page.setViewportSize({ width: 1280, height: 900 });
    await captureMail(page, "tally-desktop-dark.png");
  });

  await t.test("expense capture preserves optional fields through refresh and saves without rebuilding twice", async () => {
    const page = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await seedWorkspace(page);
    await page.goto(`${base}/tally.html`, { waitUntil: "load" });
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("tally-book-v1"));
      state.people.push({ id: "friend", name: "Friend", isSelf: false });
      localStorage.setItem("tally-book-v1", JSON.stringify(state));
      window.dispatchEvent(new CustomEvent("daily-space-agent-data-updated", { detail: { domains: ["tally"] } }));
      window.keptExpenseRow = document.querySelector(".tally-record");
    });
    await page.locator("#tally-add-open").click();
    assert.equal(await page.locator("#tally-extra-options").getAttribute("open"), null);
    await page.locator("#tally-amount").fill("25");
    await page.locator("#tally-category").fill("Lunch together");
    await page.locator("#tally-extra-options > summary").click();
    await page.locator("#tally-note").fill("Keep this draft");
    await page.locator("#tally-scope").selectOption("shared");
    await page.locator("#tally-paid-by").selectOption("friend");
    await page.locator('#tally-split-people input:not([value="friend"])').uncheck();
    await page.locator("#tally-note").focus();
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("tally-book-v1"));
      state.budget += 50;
      localStorage.setItem("tally-book-v1", JSON.stringify(state));
      window.dispatchEvent(new CustomEvent("daily-space-agent-data-updated", { detail: { domains: ["tally"] } }));
    });
    assert.equal(await page.evaluate(() => window.keptExpenseRow === document.querySelector(".tally-record")), true, "budget refresh must keep the unchanged record row");
    assert.equal(await page.locator("#tally-paid-by").inputValue(), "friend");
    assert.equal(await page.locator("#tally-split-people input:checked").count(), 1);
    assert.equal(await page.evaluate(() => document.activeElement.id), "tally-note");
    await page.keyboard.press("Escape");
    await page.locator("#tally-add-sheet").waitFor({ state: "hidden" });
    await page.locator("#tally-add-open").click();
    assert.equal(await page.locator("#tally-note").isVisible(), true);
    assert.equal(await page.locator("#tally-paid-by").inputValue(), "friend");
    await page.evaluate(() => {
      window.recordGroupsAdded = 0;
      new MutationObserver(changes => { for (const change of changes) for (const node of change.addedNodes) if (node.classList?.contains("tally-record-group")) window.recordGroupsAdded++; }).observe(document.getElementById("tally-record-list"), { childList: true });
    });
    await page.locator("#tally-submit").click();
    await page.locator("#tally-add-sheet").waitFor({ state: "hidden" });
    const result = await page.evaluate(() => ({ added: window.recordGroupsAdded, record: JSON.parse(localStorage.getItem("tally-book-v1")).records.find(record => record.note === "Keep this draft"), draft: window.DailySpaceView.read("tally").draft }));
    assert.equal(result.added, 1, "saving should insert the shared date group once");
    assert.equal(result.record.paidById, "friend");
    assert.deepEqual(result.record.splitAmongIds, ["friend"]);
    assert.equal(result.draft, null);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("#tally-add-open").click();
    assert.equal(await page.evaluate(() => { document.getElementById("tally-add-close").click(); return document.getElementById("tally-add-sheet").hidden; }), true);
  });

  await t.test("workspace search opens the exact completed task, old expense, reminder, card and trip", async () => {
    const page = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await seedWorkspace(page);
    await page.goto(`${base}/calendar.html`, { waitUntil: "load" });
    let palette = await openWorkspaceSearch(page, "Search destination task");
    assert.equal(await palette.locator(".command-palette-item").count(), 1);
    await palette.locator("input[type=search]").press("Enter");
    await page.waitForURL(/todo-m\.html.*focus=todo/);
    await page.locator("#m-task-editor").waitFor({ state: "visible" });
    assert.equal(await page.locator("#m-task-title").inputValue(), "Search destination task");
    assert.equal(await page.locator("#m-task-date").inputValue(), "2025-02-15");
    await page.reload({ waitUntil: "load" });
    await page.locator("#m-task-editor").waitFor({ state: "visible" });
    await page.goBack();
    await page.locator("#m-task-editor").waitFor({ state: "hidden" });
    await page.waitForFunction(() => !history.state?.mobileTaskSheet);
    for (const [query, route, target, expected] of [
      ["Search destination expense", /tally\.html.*focus=expense/, "#tally-category", "Search destination expense"],
      ["Search destination reminder", /calendar\.html.*focus=reminder/, '[data-reminder-id="focus-reminder"]', "Search destination reminder"],
      ["Search destination card", /planner\.html.*focus=card/, '[data-entry-id="focus-card"] .planner-card-title', "Search destination card"],
      ["Search destination trip", /travel\.html.*focus=trip/, "#travel-side-title", "Search destination trip"],
    ]) {
      if (await page.locator("#tally-add-sheet:visible").count()) {
        await page.keyboard.press("Escape"); await page.waitForFunction(() => !history.state?.workspaceSheet);
      }
      palette = await openWorkspaceSearch(page, query);
      await palette.locator(".command-palette-item").click();
      await page.waitForURL(route);
      await page.locator(target).waitFor();
      const value = await page.locator(target).evaluate(node => node instanceof HTMLInputElement ? node.value : node.textContent);
      assert.ok(value.includes(expected), query);
      if (query.includes("expense")) assert.equal(await page.locator("#tally-date").inputValue(), "2025-02-15");
      if (query.includes("card")) assert.ok(await page.locator('[data-entry-id="focus-card"]').evaluate(node => !node.classList.contains("is-collapsed") && !!node.closest(".is-phone-active")));
    }
    await page.locator('[data-travel-view="map"]').click();
    assert.ok(await page.locator("#travel-map").isVisible());
    assert.ok(await page.locator("#travel-search-input").isVisible());
    await page.locator('[data-travel-view="itinerary"]').click();
    assert.ok(await page.locator("#travel-side-title").isVisible());
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("travel-book-v1")).activeTripId), "focus-trip");
    await page.goto(`${base}/tally.html?focus=expense&id=missing`, { waitUntil: "load" });
    await page.locator("#workspace-target-status").waitFor();
    assert.ok(!(await page.locator("#tally-add-sheet").isVisible()));
    await page.setViewportSize({ width: 320, height: 568 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  });

  await t.test("task notes and subtasks preserve drafts, sources, calendar edits and recurrence", async () => {
    const page = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.addInitScript(() => { const state = JSON.parse(localStorage.getItem("todo-app-v2")); state.todos[0].sourceMailId = "mail:fixture:a"; state.todos[0].sourceMailUrl = "https://mail.google.com/mail/?authuser=fixture%40example.test#all/a"; localStorage.setItem("todo-app-v2", JSON.stringify(state)); });
    await page.goto(`${base}/todo-m.html`, { waitUntil: "load" });
    await page.locator('#todo-list [data-id="a"] .todo-main').click();
    await page.locator('.task-detail-fields summary').click();
    await page.locator('[data-task-notes]').fill("设计评审：先整理交互问题，再确认移动端方案。");
    await page.locator('[data-subtask-add]').click();
    await page.locator('[data-subtask-text]').fill("整理移动端反馈");
    await page.locator('[data-subtask-add]').click();
    await page.locator('[data-subtask-text]').nth(1).fill("确认下一步安排");
    await page.locator('.task-subtask-check').first().click();
    await page.goBack();
    await page.locator('#m-task-editor').waitFor({ state: "hidden" });
    await page.reload(); await page.locator('#todo-list [data-id="a"] .todo-main').click();
    assert.ok((await page.locator('[data-task-notes]').inputValue()).includes("设计评审"));
    assert.equal(await page.locator('[data-subtask-text]').count(), 2);
    assert.equal(await page.locator('.task-subtask-check input').first().isChecked(), true);
    assert.ok((await page.locator('.task-source-link').getAttribute('href')).startsWith('https://mail.google.com/'));
    await page.locator('#m-task-details summary').click(); await page.locator('#m-task-repeat').selectOption('weekly');
    await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
    await captureMail(page, 'task-details-390-dark.png');
    await page.locator('#m-task-save').click(); await page.locator('#m-task-editor').waitFor({ state: "hidden" });
    await page.goto(`${base}/calendar.html`, { waitUntil: "load" });
    await page.locator('#calendar-capture').click(); await page.locator('[data-calendar-kind=task]').click();
    await page.locator('#day-task-input').fill('Calendar compatibility fixture'); await page.locator('#calendar-editor-save').click();
    await page.locator('#calendar-editor-sheet').waitFor({ state: 'hidden' });
    await page.goto(`${base}/todo-m.html`, { waitUntil: "load" });
    await page.locator('#todo-list [data-id="a"] .todo-check').click();
    const state = await page.evaluate(() => JSON.parse(localStorage.getItem('todo-app-v2')));
    const next = state.todos.find(task => task.repeat === 'weekly' && !task.completed);
    assert.equal(next.notes, state.todos.find(task => task.id === 'a').notes); assert.equal(next.subtasks.length, 2); assert.equal(next.subtasks.every(task => !task.completed), true);
    assert.notEqual(next.subtasks[0].id, state.todos.find(task => task.id === 'a').subtasks[0].id);
  });

  await t.test("batch selection is scoped, reschedules and categorises tasks with reversible recurrence", async () => {
    const page = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.addInitScript(() => { const state = JSON.parse(localStorage.getItem('todo-app-v2')); state.categories = [{ id: 'work', name: '工作' }]; state.todos[0].repeat = 'weekly'; state.todos.push({ id: 'hidden-future', text: 'Future', dueDate: '2027-02-01', completed: false }); localStorage.setItem('todo-app-v2', JSON.stringify(state)); });
    await page.goto(`${base}/todo-m.html`, { waitUntil: 'load' });
    await page.locator('#task-select-mode').click(); await page.locator('#task-select-all').click();
    assert.equal(await page.locator('.task-batch-check input:checked').count(), 3);
    await page.locator('.task-batch-options summary').click(); await page.locator('.task-batch-bar select').selectOption('work');
    await page.locator('.task-batch-choices button').nth(1).click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('todo-app-v2')).todos.filter(task => task.categoryId === 'work').length), 3);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('todo-app-v2')).todos.find(task => task.id === 'hidden-future').categoryId), null);
    await page.locator('#task-select-mode').click(); await page.locator('#task-select-all').click();
    await page.evaluate(() => document.documentElement.dataset.theme = 'dark'); await captureMail(page, 'task-batch-390-dark.png');
    const bar = await page.locator('.task-batch-bar').boundingBox(); const dock = await page.locator('.bento-rail').boundingBox();
    assert.ok(bar.y + bar.height <= dock.y, 'batch bar must clear the dock');
    await page.locator('.task-batch-primary button').first().click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('todo-app-v2')).todos.filter(task => task.completed).length), 3);
    await page.locator('#undo-bar button').click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('todo-app-v2')).todos.length), 4);
    await page.locator('#task-select-mode').click(); await page.locator('#todo-list [data-id="b"] .todo-main').click();
    assert.equal(await page.locator('#task-select-all').evaluate(input => input.indeterminate), true);
    await page.locator('.task-batch-primary button').nth(1).click();
    assert.ok(await page.evaluate(() => { const value = new Date(); value.setDate(value.getDate()+1); const task = JSON.parse(localStorage.getItem('todo-app-v2')).todos.find(task => task.id === 'b'); return task.dueDate === `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`; }));
    await page.setViewportSize({ width: 320, height: 568 }); await page.locator('#task-select-mode').click(); await page.locator('#task-select-all').click(); await page.locator('.task-batch-options summary').click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.locator('.task-batch-choices input').fill('2026-11-01'); await page.locator('.task-batch-choices button').first().click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('todo-app-v2')).todos.filter(task => task.dueDate === '2026-11-01').length), 2);
  });

  await t.test("desktop details trap focus and Guest snooze stays local", async () => {
    const page = await pageFor(); const remote = []; page.on('request', request => { if (request.url().includes('/api/reminders/')) remote.push(request.url()); });
    await page.goto(`${base}/todo.html`, { waitUntil: 'load' });
    await page.locator('#todo-list [data-id="a"] .task-details-open').click();
    await trapped(page, '.task-desktop-panel');
    await page.locator('.task-desktop-panel .task-detail-fields summary').click();
    await page.locator('.task-desktop-panel [data-task-notes]').fill('A desktop note');
    await page.locator('.task-desktop-save').click(); await page.locator('.task-desktop-editor').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('todo-app-v2')).todos.find(task => task.id === 'a').notes), 'A desktop note');
    const before = Date.now(); await page.evaluate(() => window.DailySpaceReminders.defer('todo', 'a', 10));
    assert.ok(await page.evaluate(before => JSON.parse(localStorage.getItem('todo-app-v2')).todos.find(task => task.id === 'a').remindAt >= before + 600000, before));
    assert.deepEqual(remote, [], 'Guest reminders must never send tasks to a server');
    await page.locator('#task-select-mode').click(); await page.locator('#task-select-all').click();
    assert.equal(await page.locator('#todo-list .todo-label').first().getAttribute('contenteditable'), 'false');
    await captureMail(page, 'task-batch-desktop-light.png');
    await page.locator('.task-batch-primary button').first().click();
    await page.evaluate(() => { const task = window.DailySpaceTodo.getTasks().find(task => task.id === 'a'); window.DailySpaceTodo.saveTask({ ...task, notes: 'Edited after the batch' }, task.id); });
    await page.locator('#undo-bar button').click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('todo-app-v2')).todos.find(task => task.id === 'a').notes), 'Edited after the batch');
  });

  await t.test("Google background opt-in syncs changes and avoids simultaneous local alerts", async () => {
    const page = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await seedWorkspace(page, true);
    await page.addInitScript(() => {
      let sub = null; let localAlerts = 0;
      class TestNotification { static permission = 'default'; static async requestPermission() { this.permission = 'granted'; return 'granted'; } constructor() { localAlerts++; } }
      window.Notification = TestNotification;
      const registration = { showNotification: async () => { localAlerts++; }, pushManager: { getSubscription: async () => sub, subscribe: async () => {
        sub = { endpoint: 'https://fcm.googleapis.com/fixture-browser', toJSON: () => ({ endpoint: sub.endpoint, keys: { p256dh: 'fixture', auth: 'fixture' } }), unsubscribe: async () => { sub = null; return true; } }; return sub;
      } } };
      Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve(registration), addEventListener() {}, register: async () => registration } });
      window.localAlertCount = () => localAlerts;
    });
    let active = false; const schedules = []; const requests = [];
    await page.route('**/api/reminders/**', async route => {
      const request = route.request(); requests.push(request.method() + ':' + new URL(request.url()).pathname);
      let response;
      if (request.url().includes('/status')) response = { configured: true, publicKey: 'AAAA', enabled: active };
      else if (request.method() === 'DELETE') { active = false; response = { ok: true }; }
      else { active = true; schedules.push(request.postDataJSON().jobs); response = { ok: true }; }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
    });
    await page.goto(`${base}/todo-m.html`, { waitUntil: 'load' });
    await page.locator('.reminder-settings summary').click(); await page.locator('.reminder-settings button').click();
    await page.waitForFunction(() => document.querySelector('.reminder-settings [role=status]').textContent.includes('Background reminders on'));
    assert.ok(schedules.length > 0); assert.ok(schedules[0].some(job => job.source === 'todo:design'));
    await page.evaluate(() => window.DailySpaceReminders.tick()); assert.equal(await page.evaluate(() => window.localAlertCount()), 0);
    await page.locator('#todo-list [data-id=design] .todo-check').click();
    await page.waitForFunction(() => document.querySelector('.reminder-settings [role=status]').textContent.includes('Background reminders on'));
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('daily-space-user-sync-updated', { detail: { status: 'ok' } })));
    await page.waitForTimeout(100);
    assert.ok(!schedules.at(-1).some(job => job.source === 'todo:design'), 'completed task must leave the schedule');
    await page.locator('.reminder-settings button').click();
    assert.ok(requests.some(request => request.startsWith('DELETE:')));
  });

  await t.test("templates apply fresh checklists on a chosen date, save selections and undo creation", async () => {
    const page=await pageFor({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    await page.goto(`${base}/todo-m.html`,{waitUntil:'load'});
    assert.equal(await page.locator('.task-selection-head .workspace-task-shortcuts').count(),0);
    assert.equal(await page.locator('.m-add-bar .workspace-task-shortcuts button').count(),1);
    await page.locator('.workspace-task-shortcuts button').first().click();
    await page.locator('[data-template-id=builtin-review]').click();
    assert.equal(await page.locator('[data-template-id=builtin-review]').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('[data-template-id=builtin-focus]').getAttribute('aria-pressed'),'false');
    assert.equal(await page.locator('.workspace-tool-footer button').count(),1);
    await page.locator('.workspace-tool-body input[type=date]').fill('2026-12-31');
    await trapped(page,'.workspace-tool-panel');
    await captureMail(page,'templates-390-light.png');
    await page.locator('.workspace-tool-footer .btn-primary').click();
    const created=await page.evaluate(()=>window.DailySpaceTodo.getTasks().find(task=>task.text==='Review the week'));
    assert.equal(created.dueDate,'2026-12-31');assert.equal(created.subtasks.length,3);assert.equal(created.subtasks.every(task=>!task.completed),true);
    await page.locator('#undo-bar button').click();assert.equal(await page.evaluate(()=>window.DailySpaceTodo.getTasks().length),3);
    await page.evaluate(()=>window.DailySpaceTodo.selectDueDay(new Date().toISOString().slice(0,10)));
    await page.locator('#task-select-mode').click();await page.locator('#task-select-all').click();await page.locator('.task-batch-options summary').click();await page.locator('[data-save-template]').click();
    await page.locator('[data-template-name]').fill('Morning routine');
    await page.goBack();await page.locator('.workspace-tool-sheet').waitFor({state:'hidden'});
    await page.locator('[data-save-template]').click();assert.equal(await page.locator('[data-template-name]').inputValue(),'Morning routine');
    await page.locator('.workspace-tool-footer .btn-primary').click();
    const templates=await page.evaluate(()=>JSON.parse(localStorage.getItem('task-templates-v1')).templates);assert.equal(templates.length,1);assert.equal(templates[0].items.length,3);
    await page.locator(`[data-template-id="${templates[0].id}"]`).click();await page.locator('.workspace-tool-footer .btn-primary').click();
    assert.equal(await page.evaluate(()=>window.DailySpaceTodo.getTasks().length),6);
    await page.locator('.workspace-task-shortcuts button').first().click();
    await page.locator(`[data-template-id="${templates[0].id}"]`).locator('..').locator('button').last().click();
    await page.locator('.workspace-tool-sheet').waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('task-templates-v1')).templates.length),0);
    await page.locator('#undo-bar button').click();assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('task-templates-v1')).templates.length),1);
    await page.evaluate(()=>{window.DailySpaceUndo.offer('Private undo',()=>{window.wrongIdentityUndo=true;});window.dispatchEvent(new Event('daily-space-auth-updated'));});
    assert.equal(await page.locator('#undo-bar').isVisible(),false);assert.equal(await page.evaluate(()=>window.wrongIdentityUndo),undefined);
    await page.setViewportSize({width:320,height:568});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  });

  await t.test("file preview merges CSV safely, re-imports once and rejects stale or malformed data", async () => {
    const page=await pageFor({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const remote=[];page.on('request',request=>{if(request.url().includes('/api/user/snapshot')&&request.method()==='PUT')remote.push(request.url());});
    await page.goto(`${base}/todo-m.html`,{waitUntil:'load'});
    await page.locator('#bento-menu-toggle').click();await page.locator('.sidebar-auth-entry').click();await page.locator('.auth-data-tools').click();
    await page.locator('#workspace-import-format').selectOption('todo');
    const file={name:'tasks.csv',mimeType:'text/csv',buffer:Buffer.from('text,dueDate,dueTime,category,notes\n"A new, useful task",2026-10-14,14:00,Work,"Two lines\nwith detail"')};
    await page.locator('#workspace-import-file').setInputFiles(file);await page.locator('#workspace-import-apply:not([disabled])').waitFor();
    assert.equal(await page.evaluate(()=>window.DailySpaceTodo.getTasks().length),3);await captureMail(page,'import-preview-390-light.png');
    await page.locator('#workspace-import-apply').click();assert.equal(await page.evaluate(()=>window.DailySpaceTodo.getTasks().length),4);
    await page.locator('#workspace-import-file').setInputFiles(file);await page.locator('#workspace-import-preview').getByText(/existing kept/).waitFor();assert.equal(await page.locator('#workspace-import-apply').isDisabled(),true);
    const another={...file,buffer:Buffer.from('text,dueDate\nAnother task,2026-10-14')};await page.locator('#workspace-import-file').setInputFiles(another);await page.locator('#workspace-import-apply:not([disabled])').waitFor();
    await page.evaluate(()=>window.DailySpaceTodo.saveTask({text:'Edited while previewing',dueDate:new Date().toISOString().slice(0,10)},'a'));
    await page.locator('#workspace-import-apply').click();assert.ok((await page.locator('.workspace-tool-status').textContent()).includes('changed'));assert.equal(await page.evaluate(()=>window.DailySpaceTodo.getTasks().some(task=>task.text==='Another task')),false);
    await page.locator('#workspace-import-file').setInputFiles({...file,buffer:Buffer.from('text,dueDate\nBad date,2026-02-30')});await page.locator('.workspace-tool-status').getByText(/Invalid date/).waitFor();assert.equal(await page.locator('#workspace-import-apply').isDisabled(),true);assert.deepEqual(remote,[]);
    await page.setViewportSize({width:320,height:420});const save=await page.locator('#workspace-import-apply').boundingBox();assert.ok(save.y+save.height<=420);await trapped(page,'.workspace-tool-panel');
  });

  await t.test("travel costs use saved exchange rates, persist budget and link capture back to the trip", async () => {
    const page=await pageFor({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await seedWorkspace(page);
    await page.addInitScript(()=>{if(sessionStorage.getItem('trip-expense-fixture'))return;sessionStorage.setItem('trip-expense-fixture','1');const state=JSON.parse(localStorage.getItem('tally-book-v1'));const lunch=state.records.find(record=>record.id==='lunch');lunch.tripId='focus-trip';lunch.tripName='Search destination trip';lunch.date='2026-11-04';state.records.push({id:'hotel-cost',date:'2026-11-04',amount:20,currency:'USD',fxRate:7.1,category:'Hotel',scope:'personal',tripId:'focus-trip',tripName:'Search destination trip'});localStorage.setItem('tally-book-v1',JSON.stringify(state));});
    await page.goto(`${base}/travel.html?focus=trip&id=focus-trip`,{waitUntil:'load'});
    await page.locator('#travel-expenses > summary').click();assert.ok((await page.locator('#travel-expenses > summary').textContent()).includes('190.00'));
    await page.locator('.trip-expense-budget input').fill('200');await page.locator('.trip-expense-budget input').dispatchEvent('change');assert.ok((await page.locator('#travel-expenses').textContent()).includes('10.00'));
    await page.evaluate(()=>document.documentElement.dataset.theme='dark');await captureMail(page,'travel-expenses-390-dark.png');
    await page.locator('#travel-days .travel-day-chip').nth(1).click();
    const capture=await page.locator('.trip-expense-add').boundingBox(),rail=await page.locator('.bento-rail').boundingBox();assert.ok(capture.y+capture.height<=rail.y,'trip capture must clear the dock');
    await page.locator('.trip-expense-add').click();await page.waitForURL(/tally.html/);await page.locator('#tally-add-sheet').waitFor({state:'visible'});
    assert.equal(await page.locator('#tally-trip').inputValue(),'focus-trip');assert.equal(await page.locator('#tally-date').inputValue(),'2026-11-05');
    await page.locator('#tally-amount').fill('50');await page.locator('#tally-category').fill('Transport');await captureMail(page,'trip-expense-editor-390-dark.png');await page.locator('#tally-submit').click();await page.locator('#tally-add-sheet').waitFor({state:'hidden'});
    const expense=await page.evaluate(()=>JSON.parse(localStorage.getItem('tally-book-v1')).records.find(record=>record.category==='Transport'));assert.equal(expense.tripId,'focus-trip');assert.equal(expense.tripName,'Search destination trip');
    await page.goto(`${base}/travel.html?focus=trip&id=focus-trip`,{waitUntil:'load'});await page.locator('#travel-expenses > summary').click();assert.ok((await page.locator('#travel-expenses > summary').textContent()).includes('240.00'));assert.ok((await page.locator('#travel-expenses').textContent()).includes('40.00'));
    await page.locator(".trip-expense-history summary").click();
    await page.locator(`.trip-expense-records a[href*="${expense.id}"]`).click();await page.waitForURL(/focus=expense/);await page.locator('#tally-add-sheet').waitFor({state:'visible'});assert.equal(await page.locator('#tally-trip').inputValue(),'focus-trip');
    await page.locator('#tally-trip').selectOption('');await page.locator('#tally-submit').click();assert.equal(await page.evaluate(id=>JSON.parse(localStorage.getItem('tally-book-v1')).records.find(record=>record.id===id).tripId,expense.id),null);
  });

  assert.deepEqual(errors, [], "no uncaught browser errors");
});
