const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../task-fields.js");

const next = (task, options = {}) => F.nextOccurrenceDate(task, { today: "2026-11-20", ...options });

test("plain units keep their old behaviour, including month-end clamping", () => {
  assert.equal(next({ repeat: "daily", dueDate: "2026-11-20" }), "2026-11-21");
  assert.equal(next({ repeat: "weekly", dueDate: "2026-11-20" }), "2026-11-27");
  assert.equal(next({ repeat: "monthly", dueDate: "2026-01-31" }), "2026-02-28");
  assert.equal(next({ repeat: "monthly", dueDate: "2026-02-28", repeatDay: 31 }), "2026-03-31");
  assert.equal(F.nextRepeatDate("2026-12-15", "monthly"), "2027-01-15");
  assert.equal(F.nextRepeatDate(null, "daily", null, "2026-11-20"), "2026-11-21", "a task without a date counts from today");
  assert.equal(next({ repeat: "hourly", dueDate: "2026-11-20" }), null);
  assert.equal(next({ repeat: null, dueDate: "2026-11-20" }), null);
});

test("weekdays skip the weekend", () => {
  assert.equal(next({ repeat: "weekdays", dueDate: "2026-11-20" }), "2026-11-23", "Friday → Monday");
  assert.equal(next({ repeat: "weekdays", dueDate: "2026-11-23" }), "2026-11-24");
  assert.equal(next({ repeat: "weekdays", dueDate: "2026-11-21" }), "2026-11-23", "Saturday → Monday");
});

test("every N and yearly", () => {
  assert.equal(next({ repeat: "daily", repeatEvery: 3, dueDate: "2026-11-20" }), "2026-11-23");
  assert.equal(next({ repeat: "weekly", repeatEvery: 2, dueDate: "2026-11-20" }), "2026-12-04");
  assert.equal(next({ repeat: "monthly", repeatEvery: 3, dueDate: "2026-11-30" }), "2027-02-28");
  assert.equal(next({ repeat: "yearly", dueDate: "2024-02-29" }), "2025-02-28");
  const anchor = F.recurrence({ repeat: "yearly", dueDate: "2024-02-29" }).repeatDay;
  assert.equal(next({ repeat: "yearly", dueDate: "2025-02-28", repeatDay: anchor }), "2026-02-28");
  assert.equal(next({ repeat: "yearly", repeatEvery: 4, dueDate: "2024-02-29", repeatDay: anchor }), "2028-02-29");
});

test("weekly on chosen days, also every other week", () => {
  // 2026-11-23 is a Monday.
  const monWedFri = { repeat: "weekly", repeatDays: [1, 3, 5] };
  assert.equal(next({ ...monWedFri, dueDate: "2026-11-23" }), "2026-11-25");
  assert.equal(next({ ...monWedFri, dueDate: "2026-11-27" }), "2026-11-30", "Friday → next Monday");
  const biweekly = { repeat: "weekly", repeatEvery: 2, repeatDays: [1, 4] };
  assert.equal(next({ ...biweekly, dueDate: "2026-11-23" }), "2026-11-26", "same week Thursday");
  assert.equal(next({ ...biweekly, dueDate: "2026-11-26" }), "2026-12-07", "skips a week, then Monday");
  assert.deepEqual(F.fields({ repeatDays: [5, 1, "3", 9, 1] }).repeatDays, [1, 3, 5]);
  assert.equal(F.fields({ repeatDays: [0, 1, 2, 3, 4, 5, 6] }).repeatDays, null, "every day of the week is just daily");
});

test("an end date stops the series and repeat-from-completion counts from the finishing day", () => {
  assert.equal(next({ repeat: "daily", dueDate: "2026-12-30", repeatUntil: "2026-12-31" }), "2026-12-31");
  assert.equal(next({ repeat: "daily", dueDate: "2026-12-31", repeatUntil: "2026-12-31" }), null);
  const water = { repeat: "daily", repeatEvery: 3, repeatFrom: "completion", dueDate: "2026-11-10" };
  assert.equal(next(water, { completedOn: "2026-11-20" }), "2026-11-23", "finished late: next is 3 days after finishing");
  assert.equal(next({ repeat: "monthly", repeatFrom: "completion", dueDate: "2026-10-05" }, { completedOn: "2026-11-20" }), "2026-12-20");
});

test("rules survive normalization, drafts and the next occurrence", () => {
  const task = { id: "a", text: "Gym", repeat: "weekly", repeatEvery: "2", repeatDays: [1, 3], repeatUntil: "2027-01-31", repeatFrom: "completion", tags: ["#health", "Health", " gym "], dueDate: "2026-11-23" };
  const normalized = F.fields(task);
  assert.deepEqual([normalized.repeatEvery, normalized.repeatDays, normalized.repeatUntil, normalized.repeatFrom], [2, [1, 3], "2027-01-31", "completion"]);
  assert.deepEqual(normalized.tags, ["health", "gym"]);
  const carried = F.recurrence(task);
  assert.deepEqual([carried.repeatEvery, carried.repeatDays, carried.repeatUntil, carried.repeatFrom], [2, [1, 3], "2027-01-31", "completion"]);
  assert.deepEqual(carried.tags, ["health", "gym"]);
  const { patch } = F.mergeDraft({ id: "a", text: "Gym", repeat: "weekly" }, { repeat: "weekdays", repeatEvery: 1, repeatUntil: "", tags: ["a"] });
  assert.deepEqual(patch, { repeat: "weekdays", repeatEvery: null, repeatUntil: null, tags: ["a"] });
  assert.equal(F.normalizeRepeat("Yearly"), "yearly");
});

test("repeat labels in both languages", () => {
  assert.deepEqual(F.describeRepeat({ repeat: "weekly", repeatEvery: 2, repeatDays: [4, 1] }), { en: "Every 2 weeks · Mon, Thu", zh: "每 2 周 · 周一、四" });
  assert.deepEqual(F.describeRepeat({ repeat: "weekdays" }), { en: "Weekdays", zh: "工作日" });
  assert.deepEqual(F.describeRepeat({ repeat: "monthly", repeatFrom: "completion", repeatUntil: "2027-06-30" }), { en: "Monthly · after done · until 2027-06-30", zh: "每月 · 完成后计 · 至 2027-06-30" });
  assert.equal(F.describeRepeat({ repeat: null }), null);
});
