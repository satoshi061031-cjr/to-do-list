(function () {
  const STORAGE_KEY = "travel-book-v1";
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const TIME_24H = /^([01]\d|2[0-3]):[0-5]\d$/;
  const KINDS = new Set(["flight", "hotel", "restaurant"]);

  function id() {
    return crypto.randomUUID?.() || `travel-booking-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function readState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return {
        version: Math.max(5, Number(parsed?.version) || 0),
        trips: Array.isArray(parsed?.trips) ? parsed.trips : [],
        activeTripId: typeof parsed?.activeTripId === "string" ? parsed.activeTripId : null,
      };
    } catch (_) {
      return { version: 5, trips: [], activeTripId: null };
    }
  }

  function dateDay(trip, date) {
    if (!ISO_DATE.test(String(date || "")) || !ISO_DATE.test(String(trip?.startDate || ""))) return 1;
    const start = new Date(`${trip.startDate}T12:00:00`);
    const target = new Date(`${date}T12:00:00`);
    const result = Math.floor((target.getTime() - start.getTime()) / 86400000) + 1;
    const end = ISO_DATE.test(String(trip.endDate || ""))
      ? Math.floor(
          (new Date(`${trip.endDate}T12:00:00`).getTime() - start.getTime()) / 86400000
        ) + 1
      : 1;
    return Math.max(1, Math.min(Math.max(1, end), result));
  }

  function normalizeBooking(raw, trip, sourceId) {
    if (!raw || typeof raw !== "object") return null;
    const kind = String(raw.kind || "").trim().toLowerCase();
    const title = String(raw.title || "").trim().slice(0, 100);
    if (!KINDS.has(kind) || !title) return null;
    const stringOrNull = (value, max) => {
      const result = typeof value === "string" ? value.trim().slice(0, max) : "";
      return result || null;
    };
    const startDate = ISO_DATE.test(String(raw.startDate || "")) ? raw.startDate : null;
    const endDate = ISO_DATE.test(String(raw.endDate || "")) ? raw.endDate : null;
    return {
      id: id(),
      sourceId,
      kind,
      day: dateDay(trip, startDate),
      title,
      provider: stringOrNull(raw.provider, 80),
      startDate,
      endDate,
      startTime: TIME_24H.test(String(raw.startTime || "")) ? raw.startTime : null,
      endTime: TIME_24H.test(String(raw.endTime || "")) ? raw.endTime : null,
      location: stringOrNull(raw.location, 180),
      origin: stringOrNull(raw.origin, 120),
      destination: stringOrNull(raw.destination, 120),
      confirmationCode: stringOrNull(raw.confirmationCode, 60),
      details: stringOrNull(raw.details, 500),
      importedAt: new Date().toISOString(),
    };
  }

  function listTrips() {
    return readState().trips
      .filter((trip) => trip && typeof trip.id === "string" && typeof trip.name === "string")
      .map((trip) => ({
        id: trip.id,
        name: trip.name,
        destination: String(trip.destination || ""),
        startDate: String(trip.startDate || ""),
        endDate: String(trip.endDate || ""),
      }));
  }

  function importBookings({ tripId, bookings, sourceKey }) {
    const state = readState();
    const trip = state.trips.find((item) => item?.id === tripId);
    if (!trip) return { ok: false, reason: "trip_not_found", added: 0 };
    if (!Array.isArray(trip.reservations)) trip.reservations = [];
    const prefix = String(sourceKey || "manual").slice(0, 240);
    let added = 0;
    bookings.slice(0, 12).forEach((booking, index) => {
      const sourceId = `${prefix}:${index}:${String(booking?.kind || "booking")}`;
      if (trip.reservations.some((item) => item?.sourceId === sourceId)) return;
      const normalized = normalizeBooking(booking, trip, sourceId);
      if (!normalized) return;
      trip.reservations.push(normalized);
      added += 1;
    });
    state.activeTripId = trip.id;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (added) {
      window.dispatchEvent(
        new CustomEvent("daily-space-travel-bookings-updated", {
          detail: { tripId: trip.id, added },
        })
      );
    }
    return { ok: true, added, tripId: trip.id, duplicate: added === 0 };
  }

  window.DailySpaceTravelBookings = {
    importBookings,
    listTrips,
  };
})();
