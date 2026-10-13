const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright-core");

test("browser interactions on desktop and touch screens", { timeout: 90_000 }, async t => {
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

  assert.deepEqual(errors, [], "no uncaught browser errors");
});
