const test = require("node:test");
const assert = require("node:assert/strict");
const { parse } = require("../quick-task");
const { DatabaseSync } = require("node:sqlite");
const { createTravelCollabStore } = require("../server/travel-collab-store");
test("quick capture understands Chinese dates, numeral hours and half hours locally", () => {
  const now = new Date(2026, 11, 31, 20);
  assert.deepEqual(parse("明天下午三点取快递", now), {
    text: "取快递",
    dueDate: "2027-01-01",
    dueTime: "15:00",
  });
  assert.deepEqual(parse("后天上午十点半去医院", now), {
    text: "去医院",
    dueDate: "2027-01-02",
    dueTime: "10:30",
  });
  assert.deepEqual(parse("今天中午十二点吃饭", now), {
    text: "吃饭",
    dueDate: "2026-12-31",
    dueTime: "12:00",
  });
});
test("quick capture validates explicit dates and clocks and leaves ambiguous text intact", () => {
  const now = new Date(2026, 9, 25);
  assert.equal(parse("2026-02-30 Review", now), null);
  assert.equal(parse("Meeting 28:90", now), null);
  assert.equal(parse("普通任务", now), null);
  assert.equal(parse("明天", now), null);
  assert.deepEqual(parse("tomorrow 3pm Collect parcel", now), {
    text: "Collect parcel",
    dueDate: "2026-10-26",
    dueTime: "15:00",
  });
  assert.deepEqual(parse("2028-02-29 12:15 Review", now), {
    text: "Review",
    dueDate: "2028-02-29",
    dueTime: "12:15",
  });
});
test("weekday capture handles next week and Sunday without UTC day shifts", () => {
  const now = new Date(2026, 9, 25, 23); // Sunday
  assert.equal(parse("下周一开会", now).dueDate, "2026-10-26");
  assert.equal(parse("周日整理", now).dueDate, "2026-10-25");
  assert.equal(parse("本周一整理", now).dueDate, "2026-10-19");
});
test("shared stop reordering is atomic, revision guarded and member scoped", () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  const store = createTravelCollabStore({ database });
  try {
    const trip = store.createTrip({
      ownerUserId: "owner@example.com",
      title: "Trip",
      data: {},
    });
    let rev = trip.revision;
    const ids = ["a", "b", "c"];
    ids.forEach((id, index) => {
      rev = store.createStop(trip.id, "owner@example.com", {
        id,
        data: { title: id },
        position: index,
        baseRevision: rev,
      }).revision;
    });
    assert.throws(
      () =>
        store.reorderStops(trip.id, "outsider@example.com", {
          ids: ["c", "a", "b"],
          baseRevision: rev,
        }),
      (error) => error.statusCode === 404,
    );
    for (const invalid of [
      ["a", "b"],
      ["a", "a", "c"],
      ["x", "a", "b"],
    ])
      assert.throws(
        () =>
          store.reorderStops(trip.id, "owner@example.com", {
            ids: invalid,
            baseRevision: rev,
          }),
        (error) => error.statusCode === 400,
      );
    assert.deepEqual(
      store.listStops(trip.id, "owner@example.com").map((stop) => stop.id),
      ids,
    );
    const saved = store.reorderStops(trip.id, "owner@example.com", {
      ids: ["c", "a", "b"],
      baseRevision: rev,
    });
    assert.equal(saved.trip.revision, rev + 1);
    assert.deepEqual(
      saved.trip.stops.map((stop) => stop.id),
      ["c", "a", "b"],
    );
    assert.throws(
      () =>
        store.reorderStops(trip.id, "owner@example.com", {
          ids,
          baseRevision: rev,
        }),
      (error) => error.statusCode === 409,
    );
    assert.deepEqual(
      store.listStops(trip.id, "owner@example.com").map((stop) => stop.id),
      ["c", "a", "b"],
    );
  } finally {
    database.close();
  }
});
