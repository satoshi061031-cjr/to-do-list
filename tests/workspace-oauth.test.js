const test = require("node:test");
const assert = require("node:assert/strict");
const {
  GOOGLE_WORKSPACE_SCOPES,
  OUTLOOK_WORKSPACE_SCOPES,
  googleEventToWorkspace,
  graphEventToWorkspace,
  buildGoogleEventBody,
} = require("../server/workspace-oauth");

test("Google and Outlook sign-in scopes include mail and calendar", () => {
  assert.match(GOOGLE_WORKSPACE_SCOPES, /gmail\.readonly/);
  assert.match(GOOGLE_WORKSPACE_SCOPES, /calendar\.events/);
  assert.match(OUTLOOK_WORKSPACE_SCOPES, /Mail\.Read/);
  assert.match(OUTLOOK_WORKSPACE_SCOPES, /Calendars\.ReadWrite/);
});

test("normalizes Google Calendar events into workspace schedule items", () => {
  const timed = googleEventToWorkspace({
    id: "evt-1",
    summary: "Design review",
    htmlLink: "https://calendar.google.com/event?eid=1",
    start: { dateTime: "2026-08-17T09:00:00+08:00" },
    end: { dateTime: "2026-08-17T10:00:00+08:00" },
  });
  assert.equal(timed.id, "evt-1");
  assert.equal(timed.title, "Design review");
  assert.equal(timed.date, "2026-08-17");
  assert.equal(timed.startTime, "09:00");
  assert.equal(timed.endTime, "10:00");
  assert.equal(timed.source, "google");

  const allDay = googleEventToWorkspace({
    id: "evt-2",
    summary: "Holiday",
    start: { date: "2026-08-18" },
    end: { date: "2026-08-19" },
  });
  assert.equal(allDay.date, "2026-08-18");
  assert.equal(allDay.startTime, null);
  assert.equal(allDay.allDay, true);
});

test("normalizes Outlook events and builds Google create payloads", () => {
  const event = graphEventToWorkspace({
    id: "outlook-1",
    subject: "Standup",
    isAllDay: false,
    webLink: "https://outlook.office.com/calendar/item/1",
    start: { dateTime: "2026-08-17T15:00:00" },
    end: { dateTime: "2026-08-17T15:30:00" },
  });
  assert.equal(event.source, "outlook");
  assert.equal(event.title, "Standup");
  assert.equal(event.date, "2026-08-17");

  const body = buildGoogleEventBody({
    title: "Ship checklist",
    date: "2026-08-17",
    startTime: "18:00",
    timeZone: "Asia/Shanghai",
  });
  assert.equal(body.summary, "Ship checklist");
  assert.equal(body.start.dateTime, "2026-08-17T18:00:00");
  assert.equal(body.start.timeZone, "Asia/Shanghai");
});
