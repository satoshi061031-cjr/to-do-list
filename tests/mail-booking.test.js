const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { normalizeBookingResult, parseMailBookings } = require("../server/mail-booking");

test("normalizes structured flight, hotel, and restaurant bookings", () => {
  const result = normalizeBookingResult({
    bookings: [
      {
        kind: "flight",
        title: "JL 12 to Tokyo",
        startDate: "2026-09-10",
        startTime: "09:30",
        origin: "SIN",
        destination: "HND",
        confirmationCode: "ABC123",
      },
      {
        kind: "hotel",
        title: "Tokyo Hotel",
        startDate: "2026-09-10",
        endDate: "2026-09-13",
        location: "Shinjuku",
      },
      { kind: "train", title: "Ignored" },
    ],
  });
  assert.equal(result.bookings.length, 2);
  assert.equal(result.bookings[0].kind, "flight");
  assert.equal(result.bookings[0].confirmationCode, "ABC123");
  assert.equal(result.bookings[1].endDate, "2026-09-13");
});

test("falls back to a useful booking when the model is unavailable", async () => {
  const groq = process.env.GROQ_API_KEY;
  const openai = process.env.OPENAI_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const result = await parseMailBookings({
      message: { subject: "Flight confirmation JL12", from: "Japan Airlines" },
      bodyText: "Your flight booking confirmation code: ABC123. Departure from SIN to HND.",
      pdfTexts: [],
      today: "2026-09-01",
      lang: "en",
    });
    assert.equal(result.parsedBy, "fallback");
    assert.equal(result.bookings[0].kind, "flight");
    assert.equal(result.bookings[0].confirmationCode, "ABC123");
  } finally {
    if (groq == null) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = groq;
    if (openai == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = openai;
  }
});

test("imports parsed mail bookings into a trip once and assigns the matching day", () => {
  const values = new Map();
  const events = [];
  const localStorage = {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
  values.set(
    "travel-book-v1",
    JSON.stringify({
      version: 4,
      activeTripId: "trip-1",
      trips: [
        {
          id: "trip-1",
          name: "Tokyo",
          destination: "Tokyo",
          startDate: "2026-09-10",
          endDate: "2026-09-13",
          stops: [],
        },
      ],
    })
  );
  class CustomEvent {
    constructor(type, options) {
      this.type = type;
      this.detail = options?.detail;
    }
  }
  const window = {
    dispatchEvent(event) {
      events.push(event);
    },
  };
  const context = vm.createContext({
    window,
    localStorage,
    CustomEvent,
    crypto,
    Date,
    Math,
    JSON,
    Set,
    Array,
    Number,
    String,
    Object,
  });
  vm.runInContext(
    fs.readFileSync(path.resolve(__dirname, "../travel-bookings.js"), "utf8"),
    context
  );

  const payload = {
    tripId: "trip-1",
    sourceKey: "mail-booking:account:message",
    bookings: [
      {
        kind: "hotel",
        title: "Tokyo Hotel",
        startDate: "2026-09-12",
        endDate: "2026-09-13",
        location: "Shinjuku",
      },
    ],
  };
  assert.equal(window.DailySpaceTravelBookings.importBookings(payload).added, 1);
  assert.equal(window.DailySpaceTravelBookings.importBookings(payload).added, 0);
  const stored = JSON.parse(values.get("travel-book-v1"));
  assert.equal(stored.version, 5);
  assert.equal(stored.trips[0].reservations.length, 1);
  assert.equal(stored.trips[0].reservations[0].day, 3);
  assert.equal(events.at(-1).type, "daily-space-travel-bookings-updated");
});
