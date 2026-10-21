const test = require("node:test");
const assert = require("node:assert/strict");
const Widget = require("../native-widget");
const task = (text, extra = {}) => ({ text, dueDate: "2026-10-21", completed: false, ...extra });

test("widget counts all today's tasks, sorts open tasks, and excludes private fields", () => {
  const todos = [task("No time", { notes: "private", email: "private@example.test", token: "secret" }),
    task("Evening", { dueTime: "18:30" }), task("Morning", { dueTime: "09:00" }), task("Finished", { completed: true }),
    task("Different day", { dueDate: "2026-10-22" }), task("Undated", { dueDate: null }), task("Invalid time", { dueTime: "99:99" })];
  const value = Widget.snapshot({ ready: true, todos, locale: "zh" }, new Date(2026, 9, 21, 12));
  assert.equal(value.days[0].total, 5); assert.equal(value.days[0].completed, 1);
  assert.deepEqual(value.days[0].items.map(item => item.title), ["Morning", "Evening", "No time", "Invalid time"]);
  assert.equal(value.days[0].items[3].time, null);
  assert.equal(value.days[1].total, 1); assert.equal(value.locale, "zh");
  assert.doesNotMatch(JSON.stringify(value), /private|email|token|secret|Finished/);
  assert.deepEqual(Widget.snapshot({ ready: false, todos }).days, []);
});

test("widget payload stays small while progress includes tasks outside the preview", () => {
  const value = Widget.snapshot({ ready: true, todos: Array.from({ length: 1000 }, (_, i) => task("😀".repeat(500), { completed: i < 10 })) }, new Date(2026, 9, 21));
  assert.equal(value.days[0].total, 1000); assert.equal(value.days[0].completed, 10);
  assert.equal(value.days[0].items.length, 4); assert.equal([...value.days[0].items[0].title].length, 120);
  assert.ok(Buffer.byteLength(JSON.stringify(value)) < 65_536);
  assert.deepEqual(Widget.snapshot({ ready: true, todos: {} }).days.map(day => day.total), Array(8).fill(0));
});

test("cached widget dates cross years and daylight saving using calendar dates", () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = "America/New_York";
    const spring = Widget.snapshot({ ready: true }, new Date(2026, 2, 7, 23, 59));
    assert.deepEqual(spring.days.slice(0, 3).map(day => day.date), ["2026-03-07", "2026-03-08", "2026-03-09"]);
    const winter = Widget.snapshot({ ready: true }, new Date(2026, 11, 31, 23, 59));
    assert.equal(winter.days[1].date, "2027-01-01");
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

function native(plugin) { return { isNativePlatform: () => true, getPlatform: () => "ios", registerPlugin: () => plugin }; }
function environment() {
  const events = new EventTarget(); events.document = new EventTarget(); events.routes = [];
  events.location = { assign: url => events.routes.push(url) }; return events;
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test("account readiness resets on owner changes but keeps the verified owner's offline edits", () => {
  const ready = Widget.session();
  assert.equal(ready({ userId: "", status: "idle" }), true);
  assert.equal(ready({ userId: "a", snapshotUserId: "a", status: "offline" }), false);
  assert.equal(ready({ userId: "a", snapshotUserId: "a", status: "conflict" }), false);
  assert.equal(ready({ userId: "a", snapshotUserId: "a", status: "ok" }), true);
  assert.equal(ready({ userId: "a", snapshotUserId: "a", status: "syncing" }), true);
  assert.equal(ready({ userId: "a", snapshotUserId: "a", status: "offline" }), true);
  assert.equal(ready({ userId: "b", snapshotUserId: "a", status: "ok" }), false);
  assert.equal(ready({ userId: "b", snapshotUserId: "b", status: "ok" }), true);
  assert.equal(ready({ userId: "a", snapshotUserId: "b", status: "ok" }), false);
});

test("bridge serializes writes and removes the old account preview after an in-flight update", async () => {
  const env = environment(), writes = []; let release, listener;
  const plugin = { updateSnapshot: async ({ snapshot }) => { writes.push(snapshot); if (writes.length === 1) await new Promise(resolve => { release = resolve; }); },
    addListener: async (_, fn) => { listener = fn; return { remove() {} }; }, consumeRoute: async () => ({ route: "" }) };
  let context = { ready: true, todos: [task("Old account", { dueDate: new Date().toLocaleDateString("en-CA") })] };
  const bridge = Widget.connect(native(plugin), () => context, env);
  context = { ready: false };
  env.dispatchEvent(new Event("daily-space-auth-updated"));
  assert.equal(writes.length, 1);
  release(); await tick();
  assert.equal(writes.length, 2); assert.equal(writes.at(-1).ready, false); assert.deepEqual(writes.at(-1).days, []);
  env.dispatchEvent(new Event("daily-space-user-sync-updated")); await tick(); assert.equal(writes.length, 2);
  assert.equal(typeof listener, "function"); bridge.stop();
});

test("native navigation consumes cold and warm widget taps once and ignores other routes", async () => {
  const env = environment(); let listener, pending = "today", release;
  const plugin = { updateSnapshot: async () => {}, addListener: async (_, fn) => { listener = fn; return { remove() {} }; },
    consumeRoute: async () => { const route = pending; pending = ""; if (route === "delay") await new Promise(resolve => { release = resolve; }); return { route }; } };
  const bridge = Widget.connect(native(plugin), () => ({ ready: false }), env); await tick();
  assert.deepEqual(env.routes, ["todo-m.html#today"]);
  pending = "external://unsafe"; await listener(); assert.equal(env.routes.length, 1);
  pending = "delay"; const consuming = listener(); pending = "today"; listener(); release(); await consuming;
  assert.equal(env.routes.length, 2); bridge.stop();
});

test("web, Android and older native builds do not load or call the widget plugin", () => {
  const registerPlugin = () => { throw new Error("Must not register on this platform"); };
  for (const cap of [{ isNativePlatform: () => false, registerPlugin }, { isNativePlatform: () => true, getPlatform: () => "android", registerPlugin },
    { isNativePlatform: () => true, getPlatform: () => "ios", isPluginAvailable: () => false, registerPlugin }]) {
    assert.equal(Widget.connect(cap, () => ({}), environment()), null);
  }
});
