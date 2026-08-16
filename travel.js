(function () {
  const STORAGE_KEY = "travel-book-v1";
  const SHARED_STORAGE_KEY = "travel-shared-v1";
  const PLACES_API = "/api/travel/places";
  const SHARED_API = "/api/travel/trips";
  const SHARED_PREFIX = "shared:";
  const SHARED_POLL_MS = 2000;

  /**
   * @typedef {{ id: string; day: number; title: string; note: string; lat: number; lng: number }} Stop
   * @typedef {{ id: string; sourceId: string; kind: "flight"|"hotel"|"restaurant"; day: number; title: string; provider: string|null; startDate: string|null; endDate: string|null; startTime: string|null; endTime: string|null; location: string|null; origin: string|null; destination: string|null; confirmationCode: string|null; details: string|null }} Reservation
   * @typedef {{
   *   id: string;
   *   name: string;
   *   destination: string;
   *   startDate: string;
   *   endDate: string;
   *   lat: number;
   *   lng: number;
   *   zoom: number;
   *   stops: Stop[];
   *   reservations: Reservation[];
   * }} Trip
   */

  /** @type {Trip[]} */
  let trips = [];
  /** @type {string | null} */
  let activeTripId = null;
  let activeDay = 1;
  /** @type {string | null} */
  let activeStopId = null;
  /** @type {string[]} ordered stop ids for Google Maps directions (max 2) */
  let routeStopIds = [];
  /** @type {import("leaflet").Map | null} */
  let map = null;
  /** @type {import("leaflet").TileLayer | null} */
  let tileLayer = null;
  /** @type {import("leaflet").LayerGroup | null} */
  let markerLayer = null;
  /** @type {import("leaflet").Polyline | null} */
  let routeLine = null;
  let geocodeBusy = false;
  /** @type {Trip[]} */
  let sharedTrips = [];
  let sharedMappings = {};
  let sharedPollTimer = null;
  let sharedBusy = false;
  let sharedStatus = "";
  let sharedStatusError = false;
  let shareOpen = false;
  let pendingInviteToken = "";
  let inviteLinks = {};
  let authUser = null;
  let lastMapTripId = null;

  const emptyEl = document.getElementById("travel-empty");
  const emptyGreetingEl = document.getElementById("travel-empty-greeting");
  const emptyAddBtn = document.getElementById("travel-empty-add");
  const workspaceEl = document.getElementById("travel-workspace");
  const tripSelect = document.getElementById("travel-trip-select");
  const tripSelectWrap = document.querySelector(".travel-trip-select-wrap");
  const newOpenBtn = document.getElementById("travel-new-open");
  const newSheet = document.getElementById("travel-new-sheet");
  const newBackdrop = document.getElementById("travel-new-backdrop");
  const newCloseBtn = document.getElementById("travel-new-close");
  const newForm = document.getElementById("travel-new-form");
  const newName = document.getElementById("travel-new-name");
  const newDest = document.getElementById("travel-new-dest");
  const newStart = document.getElementById("travel-new-start");
  const newEnd = document.getElementById("travel-new-end");
  const newNote = document.getElementById("travel-new-note");
  const deleteTripBtn = document.getElementById("travel-delete-trip");
  const sidePlace = document.getElementById("travel-side-place");
  const sideTitle = document.getElementById("travel-side-title");
  const sideMeta = document.getElementById("travel-side-meta");
  const daysEl = document.getElementById("travel-days");
  const desktopDaysEl = document.getElementById("travel-desktop-days");
  const stopListEl = document.getElementById("travel-stop-list");
  const stopsEmptyEl = document.getElementById("travel-stops-empty");
  const stopsCountEl = document.getElementById("travel-stops-count");
  const stopsHeading = document.getElementById("travel-stops-heading");
  const routeHintEl = document.getElementById("travel-route-hint");
  const routeOpenBtn = document.getElementById("travel-route-open");
  const searchForm = document.getElementById("travel-search-form");
  const searchInput = document.getElementById("travel-search-input");
  const searchDayEl = document.getElementById("travel-search-day");
  const mapHint = document.getElementById("travel-map-hint");
  const mapResultsEl = document.getElementById("travel-map-results");
  const mapEl = document.getElementById("travel-map");
  const invitePreviewEl = document.getElementById("travel-invite-preview");
  const inviteTitleEl = document.getElementById("travel-invite-title");
  const inviteCopyEl = document.getElementById("travel-invite-copy");
  const inviteMetaEl = document.getElementById("travel-invite-meta");
  const inviteStatusEl = document.getElementById("travel-invite-status");
  const inviteActionBtn = document.getElementById("travel-invite-action");
  const shareToggleBtn = document.getElementById("travel-share-toggle");
  const shareBodyEl = document.getElementById("travel-share-body");
  const shareStartBtn = document.getElementById("travel-share-start");
  const shareControlsEl = document.getElementById("travel-share-controls");
  const syncStatusEl = document.getElementById("travel-sync-status");
  const shareNoteEl = document.getElementById("travel-share-note");
  const membersEl = document.getElementById("travel-members");
  const inviteForm = document.getElementById("travel-invite-form");
  const inviteTypeEl = document.getElementById("travel-invite-type");
  const inviteEmailWrap = document.getElementById("travel-invite-email-wrap");
  const inviteEmailEl = document.getElementById("travel-invite-email");
  const inviteExpiryEl = document.getElementById("travel-invite-expiry");
  const invitesEl = document.getElementById("travel-invites");

  function uiLocale() {
    return window.DailySpaceI18n?.localeTag() || "en-US";
  }

  function isZh() {
    return window.DailySpaceI18n?.locale() === "zh";
  }

  function t(en, zh) {
    return isZh() ? zh : en;
  }

  function id() {
    return typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : String(Date.now()) + Math.random();
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function todayIso() {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  }

  function parseIso(iso) {
    const [y, m, d] = String(iso || "").split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function dayCount(startIso, endIso) {
    const start = parseIso(startIso);
    const end = parseIso(endIso);
    return Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86400000) + 1);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char])
    );
  }

  function formatRange(startIso, endIso) {
    const start = parseIso(startIso);
    const end = parseIso(endIso);
    const opts = { month: "short", day: "numeric" };
    const sameYear = start.getFullYear() === end.getFullYear();
    const startLabel = start.toLocaleDateString(uiLocale(), {
      ...opts,
      year: sameYear ? undefined : "numeric",
    });
    const endLabel = end.toLocaleDateString(uiLocale(), { ...opts, year: "numeric" });
    return `${startLabel} – ${endLabel}`;
  }

  function activeTrip() {
    if (String(activeTripId || "").startsWith(SHARED_PREFIX)) {
      const sharedId = String(activeTripId).slice(SHARED_PREFIX.length);
      return sharedTrips.find((trip) => trip.id === sharedId) || null;
    }
    return trips.find((trip) => trip.id === activeTripId) || null;
  }

  function isSharedTrip(trip = activeTrip()) {
    return Boolean(trip && sharedTrips.some((item) => item.id === trip.id));
  }

  function sharedSelectionId(idValue) {
    return `${SHARED_PREFIX}${idValue}`;
  }

  function normalizeReservation(reservation) {
    if (!reservation || typeof reservation !== "object") return null;
    const kind = String(reservation.kind || "").toLowerCase();
    const title = String(reservation.title || "").trim().slice(0, 100);
    if (!["flight", "hotel", "restaurant"].includes(kind) || !title) return null;
    const nullableText = (value, max) =>
      typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
    return {
      id: typeof reservation.id === "string" ? reservation.id : id(),
      sourceId: nullableText(reservation.sourceId, 260) || "",
      kind,
      day: Math.max(1, Number(reservation.day) || 1),
      title,
      provider: nullableText(reservation.provider, 80),
      startDate: nullableText(reservation.startDate, 10),
      endDate: nullableText(reservation.endDate, 10),
      startTime: nullableText(reservation.startTime, 5),
      endTime: nullableText(reservation.endTime, 5),
      location: nullableText(reservation.location, 180),
      origin: nullableText(reservation.origin, 120),
      destination: nullableText(reservation.destination, 120),
      confirmationCode: nullableText(reservation.confirmationCode, 60),
      details: nullableText(reservation.details, 500),
      importedAt: nullableText(reservation.importedAt, 40),
    };
  }

  function objectData(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function stopFromServer(raw) {
    if (!raw || typeof raw !== "object") return null;
    const data = objectData(raw.data);
    return {
      id: typeof raw.id === "string" ? raw.id : id(),
      day: Math.max(1, Number(data.day || raw.day) || 1),
      title: String(data.title || data.name || raw.title || "Stop").slice(0, 80),
      note: String(data.note || raw.note || "").slice(0, 160),
      lat: Number(data.lat ?? raw.lat),
      lng: Number(data.lng ?? raw.lng),
    };
  }

  function reservationFromServer(raw) {
    if (!raw || typeof raw !== "object") return null;
    return normalizeReservation({
      ...objectData(raw.data),
      id: raw.id,
      sourceId: raw.sourceId || objectData(raw.data).sourceId,
    });
  }

  function tripFromServer(raw) {
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string") return null;
    const data = objectData(raw.data);
    return normalizeTrip({
      id: raw.id,
      name: raw.title || raw.name || data.name || "Trip",
      destination: data.destination || raw.destination || "",
      startDate: data.startDate || raw.startDate,
      endDate: data.endDate || raw.endDate,
      lat: data.lat ?? raw.lat,
      lng: data.lng ?? raw.lng,
      zoom: data.zoom ?? raw.zoom,
      stops: Array.isArray(raw.stops) ? raw.stops.map(stopFromServer).filter(Boolean) : [],
      reservations: Array.isArray(raw.reservations)
        ? raw.reservations.map(reservationFromServer).filter(Boolean)
        : [],
      revision: raw.revision,
      role: raw.role,
      members: raw.members,
      invites: raw.invites,
      ownerUserId: raw.ownerUserId,
    });
  }

  function tripPayload(trip) {
    return {
      destination: trip.destination,
      startDate: trip.startDate,
      endDate: trip.endDate,
      lat: trip.lat,
      lng: trip.lng,
      zoom: trip.zoom,
    };
  }

  function stopPayload(stop) {
    return {
      day: stop.day,
      title: stop.title,
      note: stop.note,
      lat: stop.lat,
      lng: stop.lng,
    };
  }

  function reservationPayload(reservation) {
    return {
      kind: reservation.kind,
      day: reservation.day,
      title: reservation.title,
      provider: reservation.provider,
      startDate: reservation.startDate,
      endDate: reservation.endDate,
      startTime: reservation.startTime,
      endTime: reservation.endTime,
      location: reservation.location,
      origin: reservation.origin,
      destination: reservation.destination,
      confirmationCode: reservation.confirmationCode,
      details: reservation.details,
      importedAt: reservation.importedAt,
    };
  }

  function normalizeTrip(trip) {
    const normalized = {
      id: trip.id,
      name: String(trip.name || trip.title || "Trip").slice(0, 60),
      destination: String(trip.destination || "").slice(0, 80),
      startDate: trip.startDate || todayIso(),
      endDate: trip.endDate || trip.startDate || todayIso(),
      lat: Number.isFinite(trip.lat) ? trip.lat : 48.8566,
      lng: Number.isFinite(trip.lng) ? trip.lng : 2.3522,
      zoom: Number.isFinite(trip.zoom) ? trip.zoom : 12,
      stops: Array.isArray(trip.stops)
        ? trip.stops
            .filter(
              (stop) =>
                stop &&
                Number.isFinite(stop.lat) &&
                Number.isFinite(stop.lng) &&
                typeof stop.title === "string"
            )
            .map((stop) => ({
              id: typeof stop.id === "string" ? stop.id : id(),
              day: Math.max(1, Number(stop.day) || 1),
              title: String(stop.title).slice(0, 80),
              note: typeof stop.note === "string" ? stop.note.slice(0, 160) : "",
              lat: Number(stop.lat),
              lng: Number(stop.lng),
            }))
        : [],
      reservations: Array.isArray(trip.reservations)
        ? trip.reservations.map(normalizeReservation).filter(Boolean).slice(0, 80)
        : [],
    };
    if (Number.isFinite(Number(trip.revision))) normalized.revision = Number(trip.revision);
    if (Array.isArray(trip.members)) normalized.members = trip.members;
    if (Array.isArray(trip.invites)) normalized.invites = trip.invites;
    if (typeof trip.role === "string") normalized.role = trip.role;
    if (typeof trip.ownerUserId === "string") normalized.ownerUserId = trip.ownerUserId;
    return normalized;
  }

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      if (!parsed || typeof parsed !== "object") return;
      trips = Array.isArray(parsed.trips)
        ? parsed.trips
            .filter((trip) => trip && typeof trip.id === "string" && typeof trip.name === "string")
            .map(normalizeTrip)
        : [];
      activeTripId = typeof parsed.activeTripId === "string" ? parsed.activeTripId : null;
      if (activeTripId && !String(activeTripId).startsWith(SHARED_PREFIX) && !activeTrip()) {
        activeTripId = null;
      }
      if (!activeTripId && trips[0]) activeTripId = trips[0].id;
      const sharedState = JSON.parse(localStorage.getItem(SHARED_STORAGE_KEY) || "{}");
      sharedMappings =
        sharedState && typeof sharedState.mappings === "object" && sharedState.mappings
          ? sharedState.mappings
          : {};
      inviteLinks =
        sharedState && typeof sharedState.inviteLinks === "object" && sharedState.inviteLinks
          ? sharedState.inviteLinks
          : {};
      if (typeof sharedState.activeSharedTripId === "string") {
        activeTripId = sharedSelectionId(sharedState.activeSharedTripId);
      }
    } catch (_) {
      trips = [];
      activeTripId = null;
      sharedMappings = {};
      inviteLinks = {};
    }
  }

  function saveState() {
    const personalActiveId = String(activeTripId || "").startsWith(SHARED_PREFIX)
      ? trips[0]?.id || null
      : activeTripId;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 5, trips, activeTripId: personalActiveId })
    );
    localStorage.setItem(
      SHARED_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        mappings: sharedMappings,
        inviteLinks,
        activeSharedTripId: String(activeTripId || "").startsWith(SHARED_PREFIX)
          ? String(activeTripId).slice(SHARED_PREFIX.length)
          : null,
      })
    );
  }

  function isGoogleProvider(provider) {
    const value = String(provider || "").trim().toLowerCase();
    return value === "google" || value === "gmail" || value.includes("google") || value.includes("gmail");
  }

  function readLocalAuth() {
    try {
      const parsed = JSON.parse(localStorage.getItem("daily-space-auth-v1") || "null");
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function isGoogleUser() {
    if (authUser) return isGoogleProvider(authUser.provider);
    const local = readLocalAuth();
    return isGoogleProvider(local?.provider) || isGoogleProvider(local?.mailProvider);
  }

  function inviteUrl(token) {
    return `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(token)}`;
  }

  async function sharedRequest(path, init) {
    const response = await fetch(`${SHARED_API}${path}`, {
      credentials: "same-origin",
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || "Shared trip request failed.");
      error.status = response.status;
      error.code = payload.code;
      error.currentRevision = payload.currentRevision;
      throw error;
    }
    return payload;
  }

  function replaceSharedTrip(rawTrip) {
    const next = tripFromServer(rawTrip);
    if (!next) return null;
    const previous = sharedTrips.find((trip) => trip.id === next.id);
    if (previous) {
      if (!Array.isArray(rawTrip.stops)) next.stops = previous.stops;
      if (!Array.isArray(rawTrip.reservations)) next.reservations = previous.reservations;
      if (!Array.isArray(rawTrip.members) && previous.members) next.members = previous.members;
      if (!Array.isArray(rawTrip.invites) && previous.invites) next.invites = previous.invites;
    }
    const index = sharedTrips.findIndex((trip) => trip.id === next.id);
    if (index >= 0) sharedTrips[index] = next;
    else sharedTrips.push(next);
    return next;
  }

  async function loadAuthUser() {
    try {
      const response = await fetch("/api/auth/me", { credentials: "same-origin" });
      const payload = await response.json().catch(() => ({}));
      authUser = payload.user || null;
    } catch (_) {
      authUser = null;
    }
    return authUser;
  }

  async function startGoogleSignIn(returnTo) {
    const response = await fetch("/api/auth/google/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        returnTo: returnTo || `${window.location.pathname}${window.location.search}`,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || t("Google sign-in failed.", "Google 登录失败。"));
    if (!payload.authUrl) throw new Error(t("Missing Google authorization URL.", "缺少 Google 授权地址。"));
    window.location.href = payload.authUrl;
  }

  async function loadSharedTrips({ preserveSelection = true } = {}) {
    if (!isGoogleUser()) {
      sharedTrips = [];
      return false;
    }
    try {
      const payload = await sharedRequest("");
      const summaries = (Array.isArray(payload.trips) ? payload.trips : [])
        .map(tripFromServer)
        .filter(Boolean);
      sharedTrips = summaries.map((summary) => {
        const existing = sharedTrips.find((trip) => trip.id === summary.id);
        if (existing && existing.revision === summary.revision) {
          return {
            ...summary,
            stops: existing.stops,
            reservations: existing.reservations,
            members: existing.members,
            invites: existing.invites,
          };
        }
        return existing && existing.revision === summary.revision ? existing : summary;
      });
      if (
        !preserveSelection ||
        (String(activeTripId || "").startsWith(SHARED_PREFIX) && !activeTrip())
      ) {
        activeTripId = sharedTrips[0] ? sharedSelectionId(sharedTrips[0].id) : trips[0]?.id || null;
      }
      return true;
    } catch (error) {
      if (error.status === 401 || error.code === "GOOGLE_SESSION_REQUIRED") {
        sharedTrips = [];
        return false;
      }
      sharedStatus = error.message;
      sharedStatusError = true;
      return false;
    }
  }

  async function reloadSharedTrip(sharedId, { render = true, revision, preserveMap = false } = {}) {
    const query = Number.isInteger(Number(revision)) ? `?revision=${Number(revision)}` : "";
    const payload = await sharedRequest(`/${encodeURIComponent(sharedId)}${query}`);
    if (payload.trip?.unchanged) {
      return sharedTrips.find((trip) => trip.id === sharedId) || null;
    }
    const trip = replaceSharedTrip(payload.trip);
    if (shareOpen && trip) await loadShareDetails(trip).catch(() => {});
    if (render) renderWorkspace({ preserveMap });
    return trip;
  }

  async function loadShareDetails(trip) {
    if (!trip || !isSharedTrip(trip)) return trip;
    const membersPayload = await sharedRequest(`/${encodeURIComponent(trip.id)}/members`);
    trip.members = Array.isArray(membersPayload.members) ? membersPayload.members : [];
    if (trip.role === "owner") {
      const invitesPayload = await sharedRequest(`/${encodeURIComponent(trip.id)}/invites`);
      trip.invites = Array.isArray(invitesPayload.invites) ? invitesPayload.invites : [];
    } else {
      trip.invites = [];
    }
    return trip;
  }

  function stopSharedPoll() {
    if (sharedPollTimer) {
      window.clearInterval(sharedPollTimer);
      sharedPollTimer = null;
    }
  }

  async function pollActiveSharedTrip() {
    const trip = activeTrip();
    if (!isSharedTrip(trip) || sharedBusy || document.hidden || pendingInviteToken) return;
    try {
      await reloadSharedTrip(trip.id, {
        render: true,
        revision: trip.revision,
        preserveMap: true,
      });
    } catch (error) {
      if (error.status === 401 || error.status === 403) stopSharedPoll();
    }
  }

  function startSharedPoll() {
    stopSharedPoll();
    if (!isGoogleUser()) return;
    sharedPollTimer = window.setInterval(pollActiveSharedTrip, SHARED_POLL_MS);
  }

  function mutationQuery(trip) {
    return Number.isInteger(Number(trip?.revision)) ? `?baseRevision=${Number(trip.revision)}` : "";
  }

  async function commitSharedMutation(trip, path, method, body) {
    if (!isSharedTrip(trip) || sharedBusy) return null;
    sharedBusy = true;
    sharedStatus = t("Syncing…", "同步中…");
    sharedStatusError = false;
    renderSharePanel(trip);
    try {
      const isDelete = method === "DELETE";
      const payload = await sharedRequest(
        `/${encodeURIComponent(trip.id)}${path}${isDelete ? mutationQuery(trip) : ""}`,
        {
          method,
          body: isDelete
            ? undefined
            : JSON.stringify({ baseRevision: trip.revision, ...body }),
        }
      );
      if (payload.trip && !payload.trip.unchanged) replaceSharedTrip(payload.trip);
      if (Number.isFinite(Number(payload.revision))) trip.revision = Number(payload.revision);
      if (payload.stop) {
        const nextStop = stopFromServer(payload.stop);
        const index = trip.stops.findIndex((item) => item.id === body.id || item.id === nextStop?.id);
        if (nextStop && index >= 0) {
          const previousId = trip.stops[index].id;
          trip.stops[index] = nextStop;
          if (activeStopId === previousId) activeStopId = nextStop.id;
          routeStopIds = routeStopIds.map((item) => (item === previousId ? nextStop.id : item));
        }
      }
      if (payload.reservation) {
        const nextReservation = reservationFromServer(payload.reservation);
        const index = trip.reservations.findIndex(
          (item) => item.id === body.id || item.id === nextReservation?.id
        );
        if (nextReservation && index >= 0) trip.reservations[index] = nextReservation;
      }
      sharedStatus = t("Synced", "已同步");
      sharedStatusError = false;
      renderWorkspace({ preserveMap: true });
      return payload;
    } catch (error) {
      sharedStatusError = true;
      if (error.status === 409) {
        sharedStatus = t("Changed elsewhere — reloading…", "其他成员已修改 — 正在重新加载…");
        await reloadSharedTrip(trip.id, { preserveMap: true }).catch(() => {});
      } else {
        sharedStatus = error.message;
        await reloadSharedTrip(trip.id, { preserveMap: true }).catch(() =>
          renderWorkspace({ preserveMap: true })
        );
      }
      return null;
    } finally {
      sharedBusy = false;
      renderSharePanel(activeTrip());
    }
  }

  async function shareCurrentTrip() {
    const trip = activeTrip();
    if (!trip) return;
    if (!isGoogleUser()) {
      sharedStatusError = true;
      sharedStatus = t(
        "Shared Travel requires a Google sign-in.",
        "共享行程需要使用 Google 登录。"
      );
      renderSharePanel(trip);
      return;
    }
    if (isSharedTrip(trip)) {
      shareOpen = true;
      await loadShareDetails(trip).catch((error) => {
        sharedStatus = error.message;
        sharedStatusError = true;
      });
      renderSharePanel(trip);
      return;
    }
    const mappedId = sharedMappings[trip.id];
    if (mappedId && sharedTrips.some((item) => item.id === mappedId)) {
      activeTripId = sharedSelectionId(mappedId);
      shareOpen = true;
      saveState();
      await reloadSharedTrip(mappedId);
      return;
    }
    sharedBusy = true;
    sharedStatus = t("Uploading trip…", "正在上传行程…");
    sharedStatusError = false;
    renderSharePanel(trip);
    try {
      const created = await sharedRequest("", {
        method: "POST",
        body: JSON.stringify({ title: trip.name, data: tripPayload(trip) }),
      });
      const shared = replaceSharedTrip(created.trip);
      if (!shared) throw new Error(t("Could not share this trip.", "无法共享此行程。"));
      let revision = shared.revision;
      for (const stop of trip.stops) {
        const result = await sharedRequest(`/${encodeURIComponent(shared.id)}/stops`, {
          method: "POST",
          body: JSON.stringify({
            id: stop.id,
            data: stopPayload(stop),
            position: trip.stops.indexOf(stop),
            baseRevision: revision,
          }),
        });
        revision = Number(result.revision) || revision + 1;
      }
      for (const reservation of trip.reservations) {
        const result = await sharedRequest(`/${encodeURIComponent(shared.id)}/reservations`, {
          method: "POST",
          body: JSON.stringify({
            id: reservation.id,
            sourceId: reservation.sourceId || undefined,
            data: reservationPayload(reservation),
            baseRevision: revision,
          }),
        });
        revision = Number(result.revision) || revision + 1;
      }
      sharedMappings[trip.id] = shared.id;
      activeTripId = sharedSelectionId(shared.id);
      shareOpen = true;
      saveState();
      await reloadSharedTrip(shared.id);
      sharedStatus = t("Shared", "已共享");
      sharedStatusError = false;
      renderSharePanel(activeTrip());
    } catch (error) {
      sharedStatus = error.message;
      sharedStatusError = true;
      renderSharePanel(trip);
    } finally {
      sharedBusy = false;
    }
  }

  async function createInviteLink(event) {
    event?.preventDefault();
    const trip = activeTrip();
    if (!isSharedTrip(trip) || trip.role !== "owner") return;
    const type = inviteTypeEl?.value === "reusable" ? "reusable" : "one_time";
    const hours = Number(inviteExpiryEl?.value) || 168;
    const email = String(inviteEmailEl?.value || "").trim();
    sharedBusy = true;
    try {
      const payload = await sharedRequest(`/${encodeURIComponent(trip.id)}/invites`, {
        method: "POST",
        body: JSON.stringify({
          type,
          email: type === "one_time" && email ? email : undefined,
          expiresAt: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString(),
          baseRevision: trip.revision,
        }),
      });
      if (Number.isFinite(Number(payload.revision))) trip.revision = Number(payload.revision);
      if (payload.invite?.id && payload.invite.token) {
        inviteLinks[payload.invite.id] = payload.invite.token;
        saveState();
      }
      if (inviteEmailEl) inviteEmailEl.value = "";
      await loadShareDetails(trip);
      sharedStatus = t("Invite created — copy the link now.", "邀请已创建 — 请立即复制链接。");
      sharedStatusError = false;
      renderSharePanel(trip);
    } catch (error) {
      sharedStatus = error.message;
      sharedStatusError = true;
      if (error.status === 409) await reloadSharedTrip(trip.id).catch(() => {});
      renderSharePanel(trip);
    } finally {
      sharedBusy = false;
    }
  }

  async function revokeInviteLink(inviteId) {
    const trip = activeTrip();
    if (!isSharedTrip(trip) || trip.role !== "owner") return;
    sharedBusy = true;
    try {
      const payload = await sharedRequest(
        `/${encodeURIComponent(trip.id)}/invites/${encodeURIComponent(inviteId)}${mutationQuery(trip)}`,
        { method: "DELETE" }
      );
      if (Number.isFinite(Number(payload.revision))) trip.revision = Number(payload.revision);
      delete inviteLinks[inviteId];
      saveState();
      await loadShareDetails(trip);
      sharedStatus = t("Invite revoked.", "邀请已撤销。");
      sharedStatusError = false;
      renderSharePanel(trip);
    } catch (error) {
      sharedStatus = error.message;
      sharedStatusError = true;
      renderSharePanel(trip);
    } finally {
      sharedBusy = false;
    }
  }

  async function removeSharedMember(userId) {
    const trip = activeTrip();
    if (!isSharedTrip(trip) || trip.role !== "owner") return;
    sharedBusy = true;
    try {
      const payload = await sharedRequest(
        `/${encodeURIComponent(trip.id)}/members/${encodeURIComponent(userId)}${mutationQuery(trip)}`,
        { method: "DELETE" }
      );
      if (Number.isFinite(Number(payload.revision))) trip.revision = Number(payload.revision);
      await loadShareDetails(trip);
      renderSharePanel(trip);
    } catch (error) {
      sharedStatus = error.message;
      sharedStatusError = true;
      renderSharePanel(trip);
    } finally {
      sharedBusy = false;
    }
  }

  async function copyInviteToken(token) {
    if (!token) return;
    const url = inviteUrl(token);
    try {
      await navigator.clipboard.writeText(url);
      sharedStatus = t("Invite link copied.", "邀请链接已复制。");
      sharedStatusError = false;
    } catch (_) {
      window.prompt(t("Copy invite link", "复制邀请链接"), url);
    }
    renderSharePanel(activeTrip());
  }

  function clearInviteQuery() {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("invite")) return;
    url.searchParams.delete("invite");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  async function showInvitePreview(token) {
    pendingInviteToken = token;
    if (invitePreviewEl) invitePreviewEl.hidden = false;
    if (emptyEl) emptyEl.hidden = true;
    if (workspaceEl) workspaceEl.hidden = true;
    if (inviteTitleEl) inviteTitleEl.textContent = t("Opening invitation…", "正在打开邀请…");
    if (inviteCopyEl) inviteCopyEl.textContent = t("Checking this invitation.", "正在检查这份邀请。");
    if (inviteMetaEl) inviteMetaEl.textContent = "";
    if (inviteStatusEl) inviteStatusEl.textContent = "";
    if (inviteActionBtn) inviteActionBtn.hidden = true;
    try {
      const response = await fetch(
        `/api/travel/invites/${encodeURIComponent(token)}/preview`,
        { credentials: "same-origin" }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || t("Invite not found.", "找不到这份邀请。"));
      const invite = payload.invite || {};
      if (inviteTitleEl) {
        inviteTitleEl.textContent = invite.tripTitle || t("Shared trip", "共享行程");
      }
      if (inviteCopyEl) {
        inviteCopyEl.textContent =
          invite.type === "reusable"
            ? t("Reusable Google invite — join as an editor.", "可重复使用的 Google 邀请 — 加入后可编辑。")
            : t("One-time Google invite — join as an editor.", "一次性 Google 邀请 — 加入后可编辑。");
      }
      if (inviteMetaEl) {
        const bits = [
          invite.emailBound ? t("Bound to a Google email", "已绑定 Google 邮箱") : "",
          invite.expiresAt
            ? t(`Expires ${new Date(invite.expiresAt).toLocaleString(uiLocale())}`, `有效期至 ${new Date(invite.expiresAt).toLocaleString(uiLocale())}`)
            : "",
        ].filter(Boolean);
        inviteMetaEl.textContent = bits.join(" · ");
      }
      if (!authUser) {
        if (inviteActionBtn) {
          inviteActionBtn.hidden = false;
          inviteActionBtn.textContent = t("Continue with Google", "使用 Google 继续");
        }
        if (inviteStatusEl) {
          inviteStatusEl.textContent = t(
            "Sign in with Google to join this trip.",
            "使用 Google 登录后即可加入行程。"
          );
        }
        return;
      }
      if (!isGoogleUser()) {
        if (inviteStatusEl) {
          inviteStatusEl.textContent = t(
            "Shared Travel requires a Google sign-in.",
            "共享行程需要使用 Google 登录。"
          );
        }
        return;
      }
      if (inviteActionBtn) {
        inviteActionBtn.hidden = false;
        inviteActionBtn.textContent = t("Join trip", "加入行程");
      }
    } catch (error) {
      if (inviteTitleEl) inviteTitleEl.textContent = t("Invitation unavailable", "邀请不可用");
      if (inviteCopyEl) inviteCopyEl.textContent = error.message;
      if (inviteActionBtn) inviteActionBtn.hidden = true;
    }
  }

  async function acceptPendingInvite() {
    if (!pendingInviteToken) return;
    if (!authUser) {
      await startGoogleSignIn(`/travel.html?invite=${encodeURIComponent(pendingInviteToken)}`);
      return;
    }
    if (!isGoogleUser()) {
      if (inviteStatusEl) {
        inviteStatusEl.textContent = t(
          "Shared Travel requires a Google sign-in.",
          "共享行程需要使用 Google 登录。"
        );
      }
      return;
    }
    if (inviteStatusEl) inviteStatusEl.textContent = t("Joining trip…", "正在加入行程…");
    try {
      const response = await fetch("/api/travel/invites/accept", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ token: pendingInviteToken }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || t("Could not accept invite.", "无法接受邀请。"));
      pendingInviteToken = "";
      clearInviteQuery();
      if (invitePreviewEl) invitePreviewEl.hidden = true;
      await loadSharedTrips({ preserveSelection: false });
      if (payload.trip?.id) {
        activeTripId = sharedSelectionId(payload.trip.id);
        saveState();
        await reloadSharedTrip(payload.trip.id);
      } else {
        renderWorkspace();
      }
      startSharedPoll();
    } catch (error) {
      if (inviteStatusEl) inviteStatusEl.textContent = error.message;
    }
  }

  function setSheetOpen(open) {
    newSheet.hidden = !open;
    document.body.classList.toggle("travel-sheet-open", open);
    if (open) {
      if (!newStart.value) newStart.value = todayIso();
      if (!newEnd.value) {
        const end = addDays(parseIso(newStart.value || todayIso()), 4);
        newEnd.value = `${end.getFullYear()}-${pad2(end.getMonth() + 1)}-${pad2(end.getDate())}`;
      }
      newNote.textContent = "";
      newNote.classList.remove("is-error");
      window.requestAnimationFrame(() => newName.focus());
    }
  }

  async function searchPlaces(query, near, limit) {
    const q = String(query || "").trim();
    if (!q) return [];
    const capped = Math.max(1, Math.min(12, Number(limit) || 8));
    const params = new URLSearchParams({
      q,
      limit: String(capped),
      lang: uiLocale().toLowerCase().startsWith("zh") ? "zh" : "en",
    });
    if (near && Number.isFinite(near.lat) && Number.isFinite(near.lng)) {
      params.set("lat", String(near.lat));
      params.set("lng", String(near.lng));
    }
    if (near && Number.isFinite(near.zoom)) {
      params.set("zoom", String(near.zoom));
    }
    if (near && near.destination) {
      params.set("destination", String(near.destination).slice(0, 120));
    }
    const response = await fetch(`${PLACES_API}?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("Place search failed");
    const payload = await response.json();
    const places = Array.isArray(payload?.places) ? payload.places : [];
    return places
      .filter((place) => place && Number.isFinite(Number(place.lat)) && Number.isFinite(Number(place.lng)))
      .map((place) => ({
        lat: Number(place.lat),
        lng: Number(place.lng),
        title: String(place.title || q).slice(0, 80),
        label: String(place.label || place.title || q).slice(0, 180),
      }));
  }

  function searchNearForTrip(trip) {
    if (!trip) return null;
    const center = map?.getCenter?.();
    return {
      lat: center && Number.isFinite(center.lat) ? center.lat : trip.lat,
      lng: center && Number.isFinite(center.lng) ? center.lng : trip.lng,
      zoom: map?.getZoom?.() || trip.zoom || 12,
      destination: trip.destination,
    };
  }

  async function geocode(query) {
    const results = await searchPlaces(query, null, 1);
    return results[0] || null;
  }

  function clearPlaceResults() {
    if (!mapResultsEl) return;
    mapResultsEl.innerHTML = "";
    mapResultsEl.hidden = true;
  }

  function isDarkTheme() {
    return document.documentElement.dataset.theme === "dark";
  }

  function basemapSpec() {
    const dark = isDarkTheme();
    return {
      url: dark
        ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      options: {
        maxZoom: 19,
        subdomains: "abcd",
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      },
    };
  }

  function tokenColor(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  function destroyMap() {
    if (!map) return;
    map.remove();
    map = null;
    tileLayer = null;
    markerLayer = null;
    routeLine = null;
    lastMapTripId = null;
  }

  function pruneRouteStops() {
    const trip = activeTrip();
    if (!trip) {
      routeStopIds = [];
      return;
    }
    const valid = new Set(
      trip.stops.filter((stop) => stop.day === activeDay).map((stop) => stop.id)
    );
    routeStopIds = routeStopIds.filter((id) => valid.has(id));
  }

  function dayStops(trip = activeTrip()) {
    if (!trip) return [];
    return trip.stops.filter((stop) => stop.day === activeDay);
  }

  function googleDirectionsUrl(from, to) {
    const params = new URLSearchParams({
      api: "1",
      origin: `${from.lat},${from.lng}`,
      destination: `${to.lat},${to.lng}`,
      travelmode: "transit",
    });
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  }

  /** @returns {{ from: Stop; to: Stop; selected: boolean } | null} */
  function routePair() {
    const trip = activeTrip();
    if (!trip) return null;
    const stops = dayStops(trip);
    pruneRouteStops();
    if (routeStopIds.length === 2) {
      const from = stops.find((stop) => stop.id === routeStopIds[0]);
      const to = stops.find((stop) => stop.id === routeStopIds[1]);
      if (from && to) return { from, to, selected: true };
    }
    if (stops.length >= 2) return { from: stops[0], to: stops[1], selected: false };
    return null;
  }

  function openExternalUrl(url) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  function openGoogleDirections() {
    const pair = routePair();
    if (!pair) return;
    openExternalUrl(googleDirectionsUrl(pair.from, pair.to));
  }

  function updateRouteAction() {
    const pair = routePair();
    const count = routeStopIds.length;
    const stops = dayStops();
    if (routeHintEl) {
      if (count === 1) {
        routeHintEl.textContent = t(
          "Tap a second stop to open Google Maps.",
          "再点一个停靠点，就会打开 Google Maps。"
        );
      } else if (pair?.selected) {
        routeHintEl.textContent = t(
          "Route ready — opens Google Maps transit.",
          "路线已选好 — 可打开 Google Maps 公交路线。"
        );
      } else if (stops.length >= 2) {
        routeHintEl.textContent = t(
          "Open Maps for stop 1 → 2, or tap two stops to choose.",
          "可打开停靠点 1 → 2 的路线，或点选两个停靠点自定义。"
        );
      } else {
        routeHintEl.textContent = t(
          "Add two stops, then open transit directions.",
          "添加两个停靠点后，可打开公交路线。"
        );
      }
    }
    if (routeOpenBtn) {
      routeOpenBtn.hidden = !pair;
      if (!pair) {
        routeOpenBtn.textContent = t("Open in Google Maps", "在 Google Maps 打开");
      } else {
        const short = (title) => {
          const text = String(title || "Stop");
          return text.length > 18 ? `${text.slice(0, 17)}…` : text;
        };
        routeOpenBtn.textContent = t(
          `Maps · ${short(pair.from.title)} → ${short(pair.to.title)}`,
          `地图 · ${short(pair.from.title)} → ${short(pair.to.title)}`
        );
      }
    }
  }

  function selectStopForRoute(stopId, { pan = false, openMaps = false } = {}) {
    const trip = activeTrip();
    if (!trip) return;
    const stop = trip.stops.find((item) => item.id === stopId);
    if (!stop || stop.day !== activeDay) return;

    const existing = routeStopIds.indexOf(stopId);
    if (existing >= 0) {
      routeStopIds = routeStopIds.filter((id) => id !== stopId);
    } else if (routeStopIds.length >= 2) {
      routeStopIds = [stopId];
    } else {
      routeStopIds = [...routeStopIds, stopId];
    }

    activeStopId = stopId;
    if (pan) map?.panTo([stop.lat, stop.lng]);
    updateRouteAction();
    renderStops();
    renderMapLayers();
    if (openMaps && routeStopIds.length === 2) openGoogleDirections();
  }

  function syncMapBasemap() {
    if (!map || !window.L) return;
    const next = basemapSpec();
    const currentUrl = tileLayer && tileLayer._url;
    if (tileLayer && currentUrl === next.url) return;
    if (tileLayer) map.removeLayer(tileLayer);
    tileLayer = window.L.tileLayer(next.url, next.options).addTo(map);
    markerLayer?.bringToFront();
    routeLine?.bringToFront();
    mapEl?.classList.toggle("is-dark-basemap", isDarkTheme());
  }

  function renderMapLayers({ fit = false } = {}) {
    const trip = activeTrip();
    if (!map || !markerLayer || !trip || !window.L) return;
    markerLayer.clearLayers();
    if (routeLine) {
      map.removeLayer(routeLine);
      routeLine = null;
    }

    const desktop = window.innerWidth >= 820;
    const ordered = trip.stops
      .filter((stop) => desktop || stop.day === activeDay)
      .slice()
      .sort((a, b) => trip.stops.indexOf(a) - trip.stops.indexOf(b));

    const fill = tokenColor("--tertiary", "#e5c235");
    const quietFill = tokenColor("--secondary", "#4f6368");
    const ink = tokenColor("--on-tertiary", "#1a1814");
    const edge = tokenColor("--primary", "#35322e");
    const latLngs = [];
    const activeLatLngs = [];

    ordered.forEach((stop) => {
      const dayIndex = trip.stops.filter((item) => item.day === stop.day).indexOf(stop);
      const routeIndex = routeStopIds.indexOf(stop.id);
      const selected = routeIndex >= 0 || stop.id === activeStopId;
      const marker = window.L.circleMarker([stop.lat, stop.lng], {
        radius: selected ? 10 : 8,
        color: routeIndex >= 0 ? ink : edge,
        weight: routeIndex >= 0 ? 3 : 2,
        fillColor: stop.day === activeDay ? fill : quietFill,
        fillOpacity: stop.day === activeDay ? 0.95 : 0.72,
      });
      const routeLabel =
        routeIndex === 0 ? "A · " : routeIndex === 1 ? "B · " : "";
      marker.bindTooltip(
        `${routeLabel}${desktop ? `Day ${stop.day} · ` : ""}${dayIndex + 1}. ${stop.title}`,
        { direction: "top" }
      );
      marker.on("click", (event) => {
        if (event.originalEvent) event.originalEvent.stopPropagation();
        if (desktop && stop.day !== activeDay) {
          activeDay = stop.day;
          activeStopId = null;
          routeStopIds = [];
        }
        selectStopForRoute(stop.id, { pan: true, openMaps: true });
      });
      marker.addTo(markerLayer);
      latLngs.push([stop.lat, stop.lng]);
      if (stop.day === activeDay) activeLatLngs.push([stop.lat, stop.lng]);
    });

    if (activeLatLngs.length > 1) {
      routeLine = window.L
        .polyline(activeLatLngs, { color: fill, weight: 3, opacity: 0.75 })
        .addTo(map);
    }

    if (fit && latLngs.length > 1) {
      map.fitBounds(latLngs, {
        paddingTopLeft: desktop ? [Math.min(420, window.innerWidth * 0.28), 72] : [36, 36],
        paddingBottomRight: desktop ? [Math.min(380, window.innerWidth * 0.25), 72] : [36, 36],
        maxZoom: 14,
      });
    } else if (fit && latLngs.length === 1) {
      map.setView(latLngs[0], Math.max(trip.zoom || 12, 13));
    }
  }

  function ensureMap(trip, { resetView = false } = {}) {
    if (!mapEl) return;
    if (!window.L) {
      if (mapHint) mapHint.textContent = "Map library failed to load. Refresh the page.";
      return;
    }
    const switched = lastMapTripId !== trip.id;
    if (!map) {
      map = window.L.map(mapEl, { zoomControl: false, attributionControl: true });
      window.L.control.zoom({ position: "bottomleft" }).addTo(map);
      syncMapBasemap();
      markerLayer = window.L.layerGroup().addTo(map);
      map.on("click", (event) => {
        const current = activeTrip();
        if (!current) return;
        addStop(current, {
          title: `Stop ${current.stops.filter((s) => s.day === activeDay).length + 1}`,
          note: "",
          lat: event.latlng.lat,
          lng: event.latlng.lng,
          day: activeDay,
        });
      });
    } else {
      syncMapBasemap();
    }
    if (switched || resetView || !lastMapTripId) {
      lastMapTripId = trip.id;
      map.setView([trip.lat, trip.lng], trip.zoom || 12);
    }
    const refreshSize = () => {
      if (!map) return;
      map.invalidateSize();
      renderMapLayers({ fit: switched || resetView });
    };
    window.requestAnimationFrame(() => {
      refreshSize();
      window.setTimeout(refreshSize, 80);
      window.setTimeout(refreshSize, 250);
    });
  }

  function addStop(trip, payload) {
    const stop = {
      id: id(),
      day: payload.day || activeDay,
      title: String(payload.title || "Stop").slice(0, 80),
      note: String(payload.note || "").slice(0, 160),
      lat: Number(payload.lat),
      lng: Number(payload.lng),
    };
    trip.stops.push(stop);
    activeStopId = stop.id;
    const sameDay = trip.stops.filter((item) => item.day === stop.day);
    // When the day reaches two stops, preselect them so the Maps button appears.
    if (sameDay.length === 2 && stop.day === activeDay) {
      routeStopIds = [sameDay[0].id, sameDay[1].id];
    }
    if (isSharedTrip(trip)) {
      commitSharedMutation(trip, "/stops", "POST", {
        id: stop.id,
        data: stopPayload(stop),
        position: trip.stops.length - 1,
      });
    } else {
      saveState();
    }
    renderWorkspace({ preserveMap: true });
  }

  function removeStop(stopId) {
    const trip = activeTrip();
    if (!trip) return;
    trip.stops = trip.stops.filter((stop) => stop.id !== stopId);
    if (activeStopId === stopId) activeStopId = null;
    routeStopIds = routeStopIds.filter((id) => id !== stopId);
    if (isSharedTrip(trip)) {
      commitSharedMutation(trip, `/stops/${encodeURIComponent(stopId)}`, "DELETE", {});
    } else {
      saveState();
    }
    renderWorkspace({ preserveMap: true });
  }

  function removeReservation(reservationId) {
    const trip = activeTrip();
    if (!trip) return;
    trip.reservations = trip.reservations.filter((reservation) => reservation.id !== reservationId);
    if (isSharedTrip(trip)) {
      commitSharedMutation(
        trip,
        `/reservations/${encodeURIComponent(reservationId)}`,
        "DELETE",
        {}
      );
    } else {
      saveState();
    }
    renderWorkspace({ preserveMap: true });
  }

  function renderTripSelect() {
    if (!tripSelect) return;
    tripSelect.innerHTML = "";
    trips.forEach((trip) => {
      const option = document.createElement("option");
      option.value = trip.id;
      option.textContent = `${trip.name} · ${t("Personal", "个人")}`;
      tripSelect.appendChild(option);
    });
    sharedTrips.forEach((trip) => {
      const option = document.createElement("option");
      option.value = sharedSelectionId(trip.id);
      option.textContent = `${trip.name} · ${t("Shared", "共享")}`;
      tripSelect.appendChild(option);
    });
    if (tripSelectWrap) tripSelectWrap.hidden = trips.length + sharedTrips.length < 2;
    if (activeTripId) tripSelect.value = activeTripId;
  }

  function greetingText() {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 14) return "Good noon";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }

  function renderEmptyGreeting() {
    if (emptyGreetingEl) emptyGreetingEl.textContent = greetingText();
  }

  function renderDays(trip) {
    const total = dayCount(trip.startDate, trip.endDate);
    if (activeDay > total) activeDay = total;
    daysEl.innerHTML = "";
    for (let day = 1; day <= total; day += 1) {
      const date = addDays(parseIso(trip.startDate), day - 1);
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "travel-day-chip" + (day === activeDay ? " is-active" : "");
      chip.setAttribute("role", "tab");
      chip.setAttribute("aria-selected", String(day === activeDay));
      const label = date.toLocaleDateString(uiLocale(), { month: "short", day: "numeric" });
      chip.textContent = `Day ${day} · ${label}`;
      chip.addEventListener("click", () => {
        activeDay = day;
        activeStopId = null;
        routeStopIds = [];
        renderWorkspace();
      });
      daysEl.appendChild(chip);
    }
  }

  function renderDesktopDays(trip) {
    if (!desktopDaysEl) return;
    const total = dayCount(trip.startDate, trip.endDate);
    desktopDaysEl.innerHTML = "";

    for (let day = 1; day <= total; day += 1) {
      const date = addDays(parseIso(trip.startDate), day - 1);
      const stops = trip.stops.filter((stop) => stop.day === day);
      const reservations = trip.reservations.filter((reservation) => reservation.day === day);
      const section = document.createElement("section");
      section.className = "travel-desktop-day" + (day === activeDay ? " is-active" : "");

      const head = document.createElement("button");
      head.type = "button";
      head.className = "travel-desktop-day-head";
      head.setAttribute("aria-pressed", String(day === activeDay));
      head.innerHTML = `
        <span class="travel-desktop-day-number">${t(`Day ${day}`, `第 ${day} 天`)}</span>
        <span class="travel-desktop-day-date">${escapeHtml(
          date.toLocaleDateString(uiLocale(), { month: "short", day: "numeric", weekday: "short" })
        )}</span>
        <span class="travel-desktop-day-count">${stops.length + reservations.length}</span>
      `;
      head.addEventListener("click", () => {
        activeDay = day;
        activeStopId = null;
        routeStopIds = [];
        clearPlaceResults();
        renderWorkspace();
      });
      section.appendChild(head);

      if (reservations.length) {
        const bookingList = document.createElement("ul");
        bookingList.className = "travel-booking-list";
        reservations.forEach((reservation) => {
          const icon =
            reservation.kind === "flight" ? "✈" : reservation.kind === "hotel" ? "H" : "R";
          const timing = [
            reservation.startDate,
            reservation.startTime,
            reservation.endDate && reservation.endDate !== reservation.startDate
              ? `→ ${reservation.endDate}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ");
          const route =
            reservation.kind === "flight" && (reservation.origin || reservation.destination)
              ? [reservation.origin, reservation.destination].filter(Boolean).join(" → ")
              : reservation.location;
          const item = document.createElement("li");
          item.className = `travel-booking travel-booking-${reservation.kind}`;
          item.innerHTML = `
            <span class="travel-booking-icon" aria-hidden="true">${icon}</span>
            <div class="travel-booking-copy">
              <p>${escapeHtml(reservation.title)}</p>
              ${timing ? `<span>${escapeHtml(timing)}</span>` : ""}
              ${route ? `<span>${escapeHtml(route)}</span>` : ""}
              ${
                reservation.confirmationCode
                  ? `<span>${t("Confirmation", "确认号")} · ${escapeHtml(
                      reservation.confirmationCode
                    )}</span>`
                  : ""
              }
            </div>
            <button type="button" class="travel-stop-delete" aria-label="Delete booking">×</button>
          `;
          item.querySelector(".travel-stop-delete")?.addEventListener("click", () => {
            removeReservation(reservation.id);
          });
          bookingList.appendChild(item);
        });
        section.appendChild(bookingList);
      }

      if (stops.length) {
        const list = document.createElement("ol");
        list.className = "travel-desktop-stop-list";
        stops.forEach((stop, index) => {
          const item = document.createElement("li");
          item.className =
            "travel-desktop-stop" +
            (stop.id === activeStopId ? " is-active" : "") +
            (routeStopIds.includes(stop.id) ? " is-route" : "");
          item.innerHTML = `
            <span class="travel-desktop-stop-index">${index + 1}</span>
            <div class="travel-desktop-stop-copy">
              <p>${escapeHtml(stop.title)}</p>
              ${stop.note ? `<span>${escapeHtml(stop.note)}</span>` : ""}
            </div>
            <button type="button" class="travel-stop-delete" aria-label="Delete stop">×</button>
          `;
          item.addEventListener("click", (event) => {
            if (event.target.closest(".travel-stop-delete")) return;
            if (activeDay !== day) {
              activeDay = day;
              activeStopId = null;
              routeStopIds = [];
            }
            selectStopForRoute(stop.id, { pan: true, openMaps: false });
          });
          item.querySelector(".travel-stop-delete")?.addEventListener("click", (event) => {
            event.stopPropagation();
            removeStop(stop.id);
          });
          list.appendChild(item);
        });
        section.appendChild(list);
      } else {
        const empty = document.createElement("p");
        empty.className = "travel-desktop-day-empty";
        empty.textContent = t("No stops yet", "还没有停靠点");
        section.appendChild(empty);
      }

      desktopDaysEl.appendChild(section);
    }
  }

  function renderStops() {
    const trip = activeTrip();
    if (!trip) return;
    const dayStops = trip.stops.filter((stop) => stop.day === activeDay);
    stopListEl.innerHTML = "";
    stopsEmptyEl.hidden = dayStops.length > 0;
    stopsCountEl.textContent = `${dayStops.length}`;
    stopsHeading.textContent = `Day ${activeDay} stops`;

    dayStops.forEach((stop, index) => {
      const routeIndex = routeStopIds.indexOf(stop.id);
      const li = document.createElement("li");
      li.className =
        "travel-stop" +
        (stop.id === activeStopId ? " is-active" : "") +
        (routeIndex === 0 ? " is-route-a" : "") +
        (routeIndex === 1 ? " is-route-b" : "");
      const routeBadge =
        routeIndex === 0 ? "A" : routeIndex === 1 ? "B" : String(index + 1);
      li.innerHTML = `
        <span class="travel-stop-index">${routeBadge}</span>
        <div>
          <p class="travel-stop-title">${escapeHtml(stop.title)}</p>
          ${stop.note ? `<p class="travel-stop-note">${escapeHtml(stop.note)}</p>` : ""}
        </div>
        <button type="button" class="travel-stop-delete" aria-label="Delete stop">×</button>
      `;
      li.addEventListener("click", (event) => {
        if (event.target.closest(".travel-stop-delete")) return;
        selectStopForRoute(stop.id, { pan: true, openMaps: true });
      });
      li.querySelector(".travel-stop-delete")?.addEventListener("click", (event) => {
        event.stopPropagation();
        removeStop(stop.id);
      });
      stopListEl.appendChild(li);
    });
    updateRouteAction();
    renderDesktopDays(trip);
    if (searchDayEl) searchDayEl.textContent = t(`Day ${activeDay}`, `第 ${activeDay} 天`);
  }

  function renderPlaceResults(places) {
    if (!mapResultsEl) return;
    mapResultsEl.innerHTML = "";
    if (!places.length) {
      mapResultsEl.hidden = true;
      return;
    }
    places.forEach((place) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "travel-place-result";
      btn.innerHTML = `
        <span class="travel-place-result-title">${escapeHtml(place.title)}</span>
        <span class="travel-place-result-meta">${escapeHtml(place.label)}</span>
      `;
      btn.addEventListener("click", () => {
        const trip = activeTrip();
        if (!trip) return;
        addStop(trip, {
          title: place.title,
          note: place.label,
          lat: place.lat,
          lng: place.lng,
          day: activeDay,
        });
        clearPlaceResults();
        if (searchInput) searchInput.value = "";
        if (mapHint) mapHint.textContent = `Added “${place.title}” to Day ${activeDay}.`;
        map?.setView([place.lat, place.lng], Math.max(map.getZoom(), 14));
      });
      li.appendChild(btn);
      mapResultsEl.appendChild(li);
    });
    mapResultsEl.hidden = false;
  }

  function renderSharePanel(trip = activeTrip()) {
    if (!shareToggleBtn || !shareBodyEl) return;
    const shared = isSharedTrip(trip);
    const owner = shared && trip.role === "owner";
    shareToggleBtn.setAttribute("aria-expanded", String(shareOpen));
    shareToggleBtn.textContent = shareOpen ? t("Hide", "收起") : t("Share", "共享");
    shareBodyEl.hidden = !shareOpen;
    if (shareStartBtn) {
      shareStartBtn.hidden = shared;
      shareStartBtn.disabled = sharedBusy;
      shareStartBtn.textContent = t("Share this trip", "共享此行程");
    }
    if (shareControlsEl) shareControlsEl.hidden = !shared;
    if (inviteForm) inviteForm.hidden = !owner;
    if (syncStatusEl) {
      syncStatusEl.classList.toggle("is-error", sharedStatusError);
      syncStatusEl.classList.toggle("is-synced", Boolean(shared && !sharedStatusError && sharedStatus));
      if (sharedStatus) {
        syncStatusEl.textContent = sharedStatus;
      } else if (shared) {
        syncStatusEl.textContent = t("Shared · syncs about every 2 seconds", "共享 · 约每 2 秒同步");
      } else {
        syncStatusEl.textContent = t("Personal · saved on this device", "个人 · 保存在此设备");
      }
    }
    if (shareNoteEl) {
      if (authUser && !isGoogleUser()) {
        shareNoteEl.textContent = t(
          "Shared Travel requires a Google sign-in.",
          "共享行程需要使用 Google 登录。"
        );
      } else if (!authUser && !isGoogleUser()) {
        shareNoteEl.textContent = t(
          "Sign in with Google to invite editors.",
          "使用 Google 登录后即可邀请协作者。"
        );
      } else if (shared && !owner) {
        shareNoteEl.textContent = t("You can edit this trip. Only the owner can invite.", "你可以编辑此行程。只有所有者可以邀请。");
      } else {
        shareNoteEl.textContent = t(
          "Google accounts only. One-time or reusable links.",
          "仅限 Google 账号。可创建一次性或可重复邀请链接。"
        );
      }
    }
    if (inviteEmailWrap) inviteEmailWrap.hidden = inviteTypeEl?.value === "reusable";
    if (membersEl) {
      membersEl.innerHTML = "";
      (trip?.members || []).forEach((member) => {
        const item = document.createElement("li");
        item.className = "travel-member";
        item.innerHTML = `<span>${escapeHtml(member.label || member.userId)}<small>${escapeHtml(
          member.role === "owner" ? t("Owner", "所有者") : t("Editor", "编辑者")
        )}</small></span>`;
        if (owner && member.role !== "owner") {
          const removeBtn = document.createElement("button");
          removeBtn.type = "button";
          removeBtn.textContent = t("Remove", "移除");
          removeBtn.addEventListener("click", () => removeSharedMember(member.userId));
          item.appendChild(removeBtn);
        }
        membersEl.appendChild(item);
      });
    }
    if (invitesEl) {
      invitesEl.innerHTML = "";
      (trip?.invites || [])
        .filter((invite) => !invite.revokedAt)
        .forEach((invite) => {
          const token = inviteLinks[invite.id];
          const item = document.createElement("li");
          item.className = "travel-invite-row";
          const copy = document.createElement("div");
          copy.className = "travel-invite-copy";
          copy.innerHTML = `<strong>${escapeHtml(
            invite.type === "reusable" ? t("Reusable", "可重复") : t("One-time", "一次性")
          )}</strong><small>${escapeHtml(
            [
              invite.email || "",
              invite.expiresAt
                ? t(`Expires ${new Date(invite.expiresAt).toLocaleDateString(uiLocale())}`, `有效期至 ${new Date(invite.expiresAt).toLocaleDateString(uiLocale())}`)
                : "",
              token ? t("Copy while this page is open", "请在本页打开时复制") : t("Link shown only when created", "链接仅在创建时显示"),
            ]
              .filter(Boolean)
              .join(" · ")
          )}</small>`;
          const actions = document.createElement("div");
          actions.className = "travel-invite-actions";
          if (token) {
            const copyBtn = document.createElement("button");
            copyBtn.type = "button";
            copyBtn.textContent = t("Copy", "复制");
            copyBtn.addEventListener("click", () => copyInviteToken(token));
            actions.appendChild(copyBtn);
          }
          const revokeBtn = document.createElement("button");
          revokeBtn.type = "button";
          revokeBtn.dataset.revokeInvite = invite.id;
          revokeBtn.textContent = t("Revoke", "撤销");
          revokeBtn.addEventListener("click", () => revokeInviteLink(invite.id));
          actions.appendChild(revokeBtn);
          item.appendChild(copy);
          item.appendChild(actions);
          invitesEl.appendChild(item);
        });
    }
    if (deleteTripBtn) {
      deleteTripBtn.hidden = Boolean(shared && trip.role !== "owner");
    }
  }

  function renderWorkspace({ preserveMap = false } = {}) {
    renderTripSelect();
    const trip = activeTrip();
    document.body.classList.toggle("travel-has-trip", Boolean(trip) && !pendingInviteToken);
    if (pendingInviteToken && invitePreviewEl && !invitePreviewEl.hidden) {
      if (emptyEl) emptyEl.hidden = true;
      if (workspaceEl) workspaceEl.hidden = true;
      return;
    }
    if (!trip) {
      emptyEl.hidden = false;
      renderEmptyGreeting();
      workspaceEl.hidden = true;
      lastMapTripId = null;
      destroyMap();
      renderSharePanel(null);
      return;
    }

    emptyEl.hidden = true;
    workspaceEl.hidden = false;
    sidePlace.textContent = trip.destination;
    sideTitle.textContent = trip.name;
    sideMeta.textContent = `${formatRange(trip.startDate, trip.endDate)} · ${dayCount(
      trip.startDate,
      trip.endDate
    )} days`;
    renderDays(trip);
    renderStops();
    ensureMap(trip, { resetView: !preserveMap && lastMapTripId !== trip.id });
    renderSharePanel(trip);
  }

  newOpenBtn?.addEventListener("click", () => setSheetOpen(true));
  emptyAddBtn?.addEventListener("click", () => setSheetOpen(true));
  newCloseBtn?.addEventListener("click", () => setSheetOpen(false));
  newBackdrop?.addEventListener("click", () => setSheetOpen(false));

  tripSelect?.addEventListener("change", () => {
    activeTripId = tripSelect.value || null;
    activeDay = 1;
    activeStopId = null;
    routeStopIds = [];
    clearPlaceResults();
    saveState();
    renderWorkspace();
    const trip = activeTrip();
    if (isSharedTrip(trip)) {
      reloadSharedTrip(trip.id, { preserveMap: false }).catch(() => {});
    }
  });

  deleteTripBtn?.addEventListener("click", async () => {
    const trip = activeTrip();
    if (!trip) return;
    if (!window.confirm(`Delete trip “${trip.name}”?`)) return;
    if (isSharedTrip(trip)) {
      if (trip.role !== "owner") return;
      try {
        await sharedRequest(`/${encodeURIComponent(trip.id)}${mutationQuery(trip)}`, {
          method: "DELETE",
        });
      } catch (error) {
        sharedStatus = error.message;
        sharedStatusError = true;
        renderSharePanel(trip);
        return;
      }
      sharedTrips = sharedTrips.filter((item) => item.id !== trip.id);
      Object.keys(sharedMappings).forEach((localId) => {
        if (sharedMappings[localId] === trip.id) delete sharedMappings[localId];
      });
      activeTripId = sharedTrips[0]
        ? sharedSelectionId(sharedTrips[0].id)
        : trips[0]?.id || null;
    } else {
      trips = trips.filter((item) => item.id !== trip.id);
      activeTripId = trips[0]?.id || null;
    }
    activeDay = 1;
    activeStopId = null;
    routeStopIds = [];
    saveState();
    renderWorkspace();
  });

  shareToggleBtn?.addEventListener("click", async () => {
    shareOpen = !shareOpen;
    const trip = activeTrip();
    if (shareOpen && isSharedTrip(trip)) {
      await loadShareDetails(trip).catch((error) => {
        sharedStatus = error.message;
        sharedStatusError = true;
      });
    }
    renderSharePanel(trip);
  });

  shareStartBtn?.addEventListener("click", async () => {
    if (!authUser) await loadAuthUser();
    if (authUser) {
      shareCurrentTrip();
      return;
    }
    startGoogleSignIn().catch((error) => {
      sharedStatus = error.message;
      sharedStatusError = true;
      renderSharePanel(activeTrip());
    });
  });

  inviteTypeEl?.addEventListener("change", () => renderSharePanel(activeTrip()));
  inviteForm?.addEventListener("submit", createInviteLink);
  inviteActionBtn?.addEventListener("click", () => {
    acceptPendingInvite().catch((error) => {
      if (inviteStatusEl) inviteStatusEl.textContent = error.message;
    });
  });

  routeOpenBtn?.addEventListener("click", () => openGoogleDirections());

  newForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (geocodeBusy) return;
    const name = newName.value.trim();
    const destination = newDest.value.trim();
    const startDate = newStart.value;
    const endDate = newEnd.value;
    if (!name || !destination || !startDate || !endDate) return;
    if (parseIso(endDate) < parseIso(startDate)) {
      newNote.textContent = "End date must be on or after the start date.";
      newNote.classList.add("is-error");
      return;
    }

    geocodeBusy = true;
    newNote.textContent = "Looking up destination…";
    newNote.classList.remove("is-error");
    try {
      const place = await geocode(destination);
      if (!place) {
        newNote.textContent = "Couldn’t find that place. Try a clearer city name.";
        newNote.classList.add("is-error");
        return;
      }
      const trip = normalizeTrip({
        id: id(),
        name: name.slice(0, 60),
        destination: place.label.slice(0, 80),
        startDate,
        endDate,
        lat: place.lat,
        lng: place.lng,
        zoom: 12,
        stops: [],
      });
      trips.push(trip);
      activeTripId = trip.id;
      activeDay = 1;
      activeStopId = null;
      routeStopIds = [];
      newName.value = "";
      newDest.value = "";
      saveState();
      setSheetOpen(false);
      renderWorkspace();
    } catch (_) {
      newNote.textContent = "Lookup failed. Check your connection and try again.";
      newNote.classList.add("is-error");
    } finally {
      geocodeBusy = false;
    }
  });

  searchForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const trip = activeTrip();
    if (!trip || geocodeBusy) return;
    const query = searchInput?.value.trim() || "";
    if (!query) return;
    geocodeBusy = true;
    clearPlaceResults();
    if (mapHint) mapHint.textContent = "Searching…";
    try {
      const places = await searchPlaces(query, searchNearForTrip(trip), 8);
      if (!places.length) {
        if (mapHint) mapHint.textContent = "No places found. Try another search.";
        return;
      }
      if (mapHint) {
        mapHint.textContent = `${places.length} places found. Pick one to add — the map stays put until then.`;
      }
      renderPlaceResults(places);
    } catch (_) {
      if (mapHint) mapHint.textContent = "Search failed. Check your connection.";
    } finally {
      geocodeBusy = false;
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && newSheet && !newSheet.hidden) setSheetOpen(false);
  });

  window.addEventListener("daily-space-locale-changed", () => renderWorkspace({ preserveMap: true }));
  window.addEventListener("daily-space-travel-bookings-updated", (event) => {
    const sharedId = event.detail?.sharedTripId;
    if (sharedId) {
      reloadSharedTrip(sharedId, { preserveMap: true }).catch(() => {});
      return;
    }
    loadState();
    renderWorkspace({ preserveMap: true });
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    loadState();
    renderWorkspace({ preserveMap: true });
  });
  window.addEventListener("resize", () => map?.invalidateSize());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopSharedPoll();
      return;
    }
    startSharedPoll();
    pollActiveSharedTrip();
  });
  window.addEventListener("daily-space-auth-updated", () => {
    bootTravel().catch(() => {});
  });

  const themeObserver = new MutationObserver(() => {
    if (!map) return;
    syncMapBasemap();
    renderMapLayers();
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  async function bootTravel() {
    loadState();
    renderWorkspace();
    await loadAuthUser();
    const inviteToken = new URLSearchParams(window.location.search).get("invite");
    if (inviteToken) {
      await showInvitePreview(inviteToken);
      if (authUser && isGoogleUser()) return;
      return;
    }
    if (isGoogleUser()) {
      await loadSharedTrips();
      const trip = activeTrip();
      if (isSharedTrip(trip)) {
        await reloadSharedTrip(trip.id, { preserveMap: false }).catch(() => {});
      } else {
        renderWorkspace();
      }
      startSharedPoll();
    } else {
      renderSharePanel(activeTrip());
    }
  }

  bootTravel().catch(() => {
    renderWorkspace();
  });
})();
