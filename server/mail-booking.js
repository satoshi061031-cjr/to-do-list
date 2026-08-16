const { callOpenAiChat, extractJsonObject, getAgentConfig, isAgentConfigured } = require("./agent");

const BOOKING_KINDS = new Set(["flight", "hotel", "restaurant"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_24H = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_SOURCE_CHARS = 80_000;

function text(value, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : null;
}

function nullableDate(value) {
  const result = text(value, 10);
  return result && ISO_DATE.test(result) ? result : null;
}

function nullableTime(value) {
  const result = text(value, 5);
  return result && TIME_24H.test(result) ? result : null;
}

function normalizeBooking(raw) {
  if (!raw || typeof raw !== "object") return null;
  const kind = text(raw.kind, 20)?.toLowerCase();
  if (!BOOKING_KINDS.has(kind)) return null;
  const title = text(raw.title, 100);
  if (!title) return null;
  return {
    kind,
    title,
    provider: text(raw.provider, 80),
    startDate: nullableDate(raw.startDate),
    endDate: nullableDate(raw.endDate),
    startTime: nullableTime(raw.startTime),
    endTime: nullableTime(raw.endTime),
    location: text(raw.location, 180),
    origin: text(raw.origin, 120),
    destination: text(raw.destination, 120),
    confirmationCode: text(raw.confirmationCode, 60),
    details: text(raw.details, 500),
  };
}

function normalizeBookingResult(payload) {
  const rows = Array.isArray(payload?.bookings) ? payload.bookings : [];
  return {
    bookings: rows.slice(0, 12).map(normalizeBooking).filter(Boolean),
  };
}

function fallbackBooking(message, sourceText) {
  const haystack = `${message?.subject || ""}\n${sourceText || ""}`;
  let kind = null;
  if (/\b(flight|airline|boarding|departure|arrival|航班|机票|登机)\b/i.test(haystack)) kind = "flight";
  else if (/\b(hotel|check[\s-]?in|accommodation|酒店|入住)\b/i.test(haystack)) kind = "hotel";
  else if (/\b(restaurant|reservation|table|dining|餐厅|订位)\b/i.test(haystack)) kind = "restaurant";
  if (!kind) return [];
  const confirmation =
    haystack.match(
      /(?:confirmation|booking|reservation|record locator)\s+(?:code|number|no\.?)\s*[:：#-]?\s*([A-Z0-9-]{4,20})/i
    )?.[1] ||
    haystack.match(/(?:确认号|预订号|确认号码|预订号码)\s*[:：#-]?\s*([A-Z0-9-]{4,20})/i)?.[1] ||
    haystack.match(
      /(?:confirmation|booking|reservation|record locator)\s*[:：#]\s*([A-Z0-9-]{4,20})/i
    )?.[1] ||
    null;
  return [
    {
      kind,
      title: text(message?.subject, 100) || `${kind[0].toUpperCase()}${kind.slice(1)} booking`,
      provider: text(message?.from, 80),
      startDate: null,
      endDate: null,
      startTime: null,
      endTime: null,
      location: null,
      origin: null,
      destination: null,
      confirmationCode: confirmation,
      details: text(sourceText, 500),
    },
  ];
}

async function parseMailBookings({ message, bodyText, pdfTexts, today, lang }) {
  const sourceText = [bodyText, ...(Array.isArray(pdfTexts) ? pdfTexts : [])]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("\n\n--- ATTACHMENT ---\n\n")
    .slice(0, MAX_SOURCE_CHARS);
  if (!sourceText && !message?.subject) {
    const error = new Error("No email or PDF text was available to parse.");
    error.statusCode = 400;
    throw error;
  }

  if (!isAgentConfigured()) {
    return { bookings: fallbackBooking(message, sourceText), parsedBy: "fallback" };
  }

  const preferZh = String(lang || "").toLowerCase().startsWith("zh");
  const { apiKey, baseUrl, model } = getAgentConfig();
  try {
    const content = await callOpenAiChat({
      apiKey,
      baseUrl,
      model,
      system: [
        "Extract travel reservations from confirmation email and PDF text.",
        `Today is ${ISO_DATE.test(String(today || "")) ? today : new Date().toISOString().slice(0, 10)}.`,
        "Return only JSON: {\"bookings\": Booking[]}.",
        "Booking.kind must be flight, hotel, or restaurant.",
        "Each booking fields: kind,title,provider,startDate,endDate,startTime,endTime,location,origin,destination,confirmationCode,details.",
        "Dates must be YYYY-MM-DD, times HH:MM 24-hour, or null when absent.",
        "For flights, origin and destination are airports/cities; location may be the arrival airport.",
        "For hotels, startDate/endDate are check-in/check-out and location is the hotel/address.",
        "For restaurants, startDate/startTime are the reservation time and location is the venue/address.",
        "Never invent confirmation codes, dates, times, or locations.",
        preferZh ? "Use concise Chinese titles/details." : "Use concise English titles/details.",
      ].join("\n"),
      user: JSON.stringify({
        message: {
          subject: text(message?.subject, 300),
          from: text(message?.from, 200),
          receivedAt: text(message?.receivedAt, 40),
        },
        sourceText,
      }),
    });
    const parsed = normalizeBookingResult(extractJsonObject(content));
    if (parsed.bookings.length) return { ...parsed, parsedBy: "agent" };
  } catch (_) {
    // A readable deterministic fallback is better than failing the import entirely.
  }
  return { bookings: fallbackBooking(message, sourceText), parsedBy: "fallback" };
}

module.exports = {
  normalizeBooking,
  normalizeBookingResult,
  parseMailBookings,
};
