const GOOGLE_WORKSPACE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

const OUTLOOK_WORKSPACE_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "https://graph.microsoft.com/Mail.Read",
  "https://graph.microsoft.com/Calendars.ReadWrite",
].join(" ");

function accountHasGoogleWorkspaceGrant(account) {
  if (!account || account.hasCredentials === false) return false;
  const scope = String(account.scope || "").toLowerCase();
  return scope.includes("gmail.readonly") && scope.includes("calendar");
}

function accountHasOutlookWorkspaceGrant(account) {
  if (!account || account.hasCredentials === false) return false;
  const scope = String(account.scope || "").toLowerCase();
  return scope.includes("mail.read") && scope.includes("calendars");
}

function shouldForceWorkspaceConsent(accounts, provider, forceConsent) {
  if (forceConsent) return true;
  const list = Array.isArray(accounts) ? accounts : [];
  const name = String(provider || "").trim().toLowerCase();
  if (name === "gmail" || name === "google") {
    const gmail = list.find((account) => String(account.provider || "").toLowerCase() === "gmail");
    if (!gmail) return false;
    return !accountHasGoogleWorkspaceGrant(gmail);
  }
  if (name === "outlook") {
    const outlook = list.find((account) => String(account.provider || "").toLowerCase() === "outlook");
    if (!outlook) return false;
    return !accountHasOutlookWorkspaceGrant(outlook);
  }
  return false;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function localDateFromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function localTimeFromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function nextIsoDate(iso) {
  const match = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return iso;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1);
  return localDateFromDate(date);
}

function addOneHour(hhmm) {
  const match = String(hhmm || "").match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return "01:00";
  const minutes = Number(match[1]) * 60 + Number(match[2]) + 60;
  const wrapped = minutes % (24 * 60);
  return `${pad2(Math.floor(wrapped / 60))}:${pad2(wrapped % 60)}`;
}

function wallClockFromRfc3339(value) {
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (match) return { date: match[1], time: match[2] };
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return { date: null, time: null };
  return { date: localDateFromDate(date), time: localTimeFromDate(date) };
}

function googleEventToWorkspace(event) {
  if (!event || typeof event !== "object") return null;
  const start = event.start && typeof event.start === "object" ? event.start : {};
  const end = event.end && typeof event.end === "object" ? event.end : {};
  let date = typeof start.date === "string" ? start.date : null;
  let startTime = null;
  let endTime = null;
  if (!date && start.dateTime) {
    const wall = wallClockFromRfc3339(start.dateTime);
    date = wall.date;
    startTime = wall.time;
  }
  if (end.dateTime) {
    endTime = wallClockFromRfc3339(end.dateTime).time;
  }
  if (!date || !String(event.summary || event.id || "").trim()) return null;
  return {
    id: String(event.id || ""),
    title: String(event.summary || "Event").trim().slice(0, 200),
    date,
    startTime,
    endTime,
    allDay: Boolean(start.date && !start.dateTime),
    source: "google",
    htmlLink: typeof event.htmlLink === "string" ? event.htmlLink : "",
  };
}

function graphEventToWorkspace(event) {
  if (!event || typeof event !== "object") return null;
  const start = event.start && typeof event.start === "object" ? event.start : {};
  const end = event.end && typeof event.end === "object" ? event.end : {};
  const startValue = String(start.dateTime || start.date || "");
  const endValue = String(end.dateTime || end.date || "");
  const startWall = wallClockFromRfc3339(startValue);
  const date = start.dateTime ? startWall.date : startValue.slice(0, 10);
  if (!date || !String(event.subject || event.id || "").trim()) return null;
  return {
    id: String(event.id || ""),
    title: String(event.subject || "Event").trim().slice(0, 200),
    date,
    startTime: start.dateTime ? startWall.time : null,
    endTime: end.dateTime ? wallClockFromRfc3339(endValue).time : null,
    allDay: Boolean(event.isAllDay),
    source: "outlook",
    htmlLink: typeof event.webLink === "string" ? event.webLink : "",
  };
}

function buildGoogleEventBody(input) {
  const title = String(input.title || "").trim().slice(0, 200);
  const date = String(input.date || "").trim();
  const startTime = String(input.startTime || "").trim();
  const endTime = String(input.endTime || "").trim() || (startTime ? addOneHour(startTime) : "");
  const timeZone = String(input.timeZone || "UTC").trim() || "UTC";
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (startTime) {
    return {
      summary: title,
      start: { dateTime: `${date}T${startTime}:00`, timeZone },
      end: { dateTime: `${date}T${endTime}:00`, timeZone },
    };
  }
  return {
    summary: title,
    start: { date },
    end: { date: nextIsoDate(date) },
  };
}

function buildGraphEventBody(input) {
  const title = String(input.title || "").trim().slice(0, 200);
  const date = String(input.date || "").trim();
  const startTime = String(input.startTime || "").trim();
  const endTime = String(input.endTime || "").trim() || (startTime ? addOneHour(startTime) : "");
  const timeZone = String(input.timeZone || "UTC").trim() || "UTC";
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (startTime) {
    return {
      subject: title,
      start: { dateTime: `${date}T${startTime}:00`, timeZone },
      end: { dateTime: `${date}T${endTime}:00`, timeZone },
    };
  }
  return {
    subject: title,
    isAllDay: true,
    start: { dateTime: `${date}T00:00:00`, timeZone },
    end: { dateTime: `${nextIsoDate(date)}T00:00:00`, timeZone },
  };
}

module.exports = {
  GOOGLE_WORKSPACE_SCOPES,
  OUTLOOK_WORKSPACE_SCOPES,
  accountHasGoogleWorkspaceGrant,
  accountHasOutlookWorkspaceGrant,
  shouldForceWorkspaceConsent,
  googleEventToWorkspace,
  graphEventToWorkspace,
  buildGoogleEventBody,
  buildGraphEventBody,
};
