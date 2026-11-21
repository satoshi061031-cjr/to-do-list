const test = require("node:test");
const assert = require("node:assert/strict");
global.window = global;
require("../task-fields.js");
const { parse, describe, number } = require("../quick-task.js");

const now = new Date("2026-11-20T09:00:00"); // a Friday
const p = (text, options) => parse(text, now, options);
const pick = (result, keys) => Object.fromEntries(keys.map((key) => [key, result?.[key]]));

test("dates and times in Chinese and English", () => {
  assert.deepEqual(pick(p("明天下午3点 给妈妈打电话"), ["text", "dueDate", "dueTime"]), { text: "给妈妈打电话", dueDate: "2026-11-21", dueTime: "15:00" });
  assert.equal(p("下周三 交报告").dueDate, "2026-11-25");
  assert.equal(p("dentist friday 9am").dueDate, "2026-11-20");
  assert.equal(p("dentist friday 9am").dueTime, "09:00");
  assert.equal(p("report next monday").dueDate, "2026-11-23");
  assert.equal(p("in 3 days pick up parcel").dueDate, "2026-11-23");
  assert.equal(p("3天后 取快递").dueDate, "2026-11-23");
  assert.equal(p("2周后 复查").dueDate, "2026-12-04");
  assert.equal(p("12月3日 体检").dueDate, "2026-12-03");
  assert.equal(p("25号 交水电费").dueDate, "2026-11-25");
  assert.equal(p("Dec 3 dentist").dueDate, "2026-12-03");
  assert.equal(p("3 March dentist").dueDate, "2027-03-03", "a passed month/day moves to next year");
  assert.deepEqual(pick(p("今晚8点 看电影"), ["dueDate", "dueTime"]), { dueDate: "2026-11-20", dueTime: "20:00" });
  assert.equal(p("会议 3点半").dueTime, "03:30");
  assert.equal(p("会议 下午3点一刻").dueTime, "15:15");
  assert.equal(p("2026-02-30 bad date"), null);
  assert.equal(p("买牛奶"), null, "nothing recognised, nothing suggested");
  assert.equal(p("the plan for 2026"), null);
});

test("repeat phrases set a rule and a first due date", () => {
  const gym = p("每周一 健身");
  assert.deepEqual(pick(gym, ["text", "repeat", "dueDate", "repeatDays"]), { text: "健身", repeat: "weekly", dueDate: "2026-11-23", repeatDays: undefined });
  assert.deepEqual(pick(p("每周一三五 健身"), ["repeat", "repeatDays", "dueDate"]), { repeat: "weekly", repeatDays: [1, 3, 5], dueDate: "2026-11-20" });
  assert.deepEqual(pick(p("每两周 周会"), ["repeat", "repeatEvery"]), { repeat: "weekly", repeatEvery: 2 });
  assert.deepEqual(pick(p("每隔一天 浇花"), ["repeat", "repeatEvery"]), { repeat: "daily", repeatEvery: 2 });
  assert.deepEqual(pick(p("每个工作日 站会 9:30"), ["repeat", "dueDate", "dueTime"]), { repeat: "weekdays", dueDate: "2026-11-20", dueTime: "09:30" });
  assert.deepEqual(pick(p("每月25号 交房租"), ["repeat", "dueDate"]), { repeat: "monthly", dueDate: "2026-11-25" });
  assert.deepEqual(pick(p("每年3月8日 纪念日"), ["repeat", "dueDate"]), { repeat: "yearly", dueDate: "2027-03-08" });
  assert.deepEqual(pick(p("pay rent every month on the 25th"), ["text", "repeat", "dueDate"]), { text: "pay rent", repeat: "monthly", dueDate: "2026-11-25" });
  assert.deepEqual(pick(p("gym every mon and thu 7pm"), ["repeat", "repeatDays", "dueDate", "dueTime"]), { repeat: "weekly", repeatDays: [1, 4], dueDate: "2026-11-23", dueTime: "19:00" });
  assert.deepEqual(pick(p("water plants every other day"), ["repeat", "repeatEvery"]), { repeat: "daily", repeatEvery: 2 });
  assert.deepEqual(pick(p("standup every weekday 9:30am"), ["repeat", "dueTime"]), { repeat: "weekdays", dueTime: "09:30" });
});

test("tags, category by name and priority", () => {
  const result = p("buy milk #Life #errands !!", { categories: ["Life", "Work"] });
  assert.deepEqual(pick(result, ["text", "categoryName", "tags", "priority"]), { text: "buy milk", categoryName: "Life", tags: ["errands"], priority: "high" });
  assert.equal(p("tidy desk !3").priority, "low");
  assert.equal(p("email #work", { categories: [] }).tags[0], "work");
  assert.equal(p("C# notes"), null, "a # inside a word is not a tag");
});

test("the suggestion reads like the task will be saved", () => {
  const zh = (en, cn) => cn;
  assert.equal(describe(p("每周一三五 晚上7点 健身 #健康 !!"), zh), "2026-11-20 · 19:00 · 每周 · 周一、三、五 · #健康 · 重要");
  assert.equal(number("二十五"), 25);
  assert.equal(number("两"), 2);
  assert.ok(Number.isNaN(number("三十三十")));
});
