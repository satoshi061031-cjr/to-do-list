(function () {
  const STORAGE_KEY = "travel-book-v1";
  const PLACES_API = "/api/travel/places";

  /**
   * @typedef {{ id: string; day: number; title: string; note: string; lat: number; lng: number }} Stop
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
   * }} Trip
   */

  /** @type {Trip[]} */
  let trips = [];
  /** @type {string | null} */
  let activeTripId = null;
  let activeDay = 1;
  /** @type {string | null} */
  let activeStopId = null;
  /** @type {import("leaflet").Map | null} */
  let map = null;
  /** @type {import("leaflet").TileLayer | null} */
  let tileLayer = null;
  /** @type {import("leaflet").LayerGroup | null} */
  let markerLayer = null;
  /** @type {import("leaflet").Polyline | null} */
  let routeLine = null;
  let geocodeBusy = false;

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
  const stopListEl = document.getElementById("travel-stop-list");
  const stopsEmptyEl = document.getElementById("travel-stops-empty");
  const stopsCountEl = document.getElementById("travel-stops-count");
  const stopsHeading = document.getElementById("travel-stops-heading");
  const searchForm = document.getElementById("travel-search-form");
  const searchInput = document.getElementById("travel-search-input");
  const mapHint = document.getElementById("travel-map-hint");
  const mapResultsEl = document.getElementById("travel-map-results");
  const mapEl = document.getElementById("travel-map");

  function uiLocale() {
    return window.DailySpaceI18n?.localeTag() || "en-US";
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
    return trips.find((trip) => trip.id === activeTripId) || null;
  }

  function normalizeTrip(trip) {
    return {
      id: trip.id,
      name: String(trip.name).slice(0, 60),
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
    };
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
      if (activeTripId && !activeTrip()) activeTripId = null;
      if (!activeTripId && trips[0]) activeTripId = trips[0].id;
    } catch (_) {
      trips = [];
      activeTripId = null;
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 4, trips, activeTripId }));
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

  function renderMapLayers() {
    const trip = activeTrip();
    if (!map || !markerLayer || !trip || !window.L) return;
    markerLayer.clearLayers();
    if (routeLine) {
      map.removeLayer(routeLine);
      routeLine = null;
    }

    const ordered = trip.stops
      .filter((stop) => stop.day === activeDay)
      .slice()
      .sort((a, b) => trip.stops.indexOf(a) - trip.stops.indexOf(b));

    const fill = tokenColor("--tertiary", "#e5c235");
    const ink = tokenColor("--on-tertiary", "#1a1814");
    const edge = tokenColor("--primary", "#35322e");
    const latLngs = [];

    ordered.forEach((stop, index) => {
      const marker = window.L.circleMarker([stop.lat, stop.lng], {
        radius: stop.id === activeStopId ? 10 : 8,
        color: stop.id === activeStopId ? ink : edge,
        weight: 2,
        fillColor: fill,
        fillOpacity: 0.95,
      });
      marker.bindTooltip(`${index + 1}. ${stop.title}`, { direction: "top" });
      marker.on("click", (event) => {
        if (event.originalEvent) event.originalEvent.stopPropagation();
        activeStopId = stop.id;
        renderStops();
        renderMapLayers();
        map.panTo([stop.lat, stop.lng]);
      });
      marker.addTo(markerLayer);
      latLngs.push([stop.lat, stop.lng]);
    });

    if (latLngs.length > 1) {
      routeLine = window.L
        .polyline(latLngs, { color: fill, weight: 3, opacity: 0.75 })
        .addTo(map);
      map.fitBounds(latLngs, { padding: [36, 36], maxZoom: 14 });
    } else if (latLngs.length === 1) {
      map.setView(latLngs[0], Math.max(trip.zoom || 12, 13));
    }
  }

  function ensureMap(trip) {
    if (!mapEl) return;
    if (!window.L) {
      if (mapHint) mapHint.textContent = "Map library failed to load. Refresh the page.";
      return;
    }
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
    map.setView([trip.lat, trip.lng], trip.zoom || 12);
    const refreshSize = () => {
      if (!map) return;
      map.invalidateSize();
      renderMapLayers();
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
    saveState();
    renderWorkspace();
  }

  function removeStop(stopId) {
    const trip = activeTrip();
    if (!trip) return;
    trip.stops = trip.stops.filter((stop) => stop.id !== stopId);
    if (activeStopId === stopId) activeStopId = null;
    saveState();
    renderWorkspace();
  }

  function renderTripSelect() {
    if (!tripSelect) return;
    tripSelect.innerHTML = "";
    trips.forEach((trip) => {
      const option = document.createElement("option");
      option.value = trip.id;
      option.textContent = trip.name;
      tripSelect.appendChild(option);
    });
    if (tripSelectWrap) tripSelectWrap.hidden = trips.length < 2;
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
        renderWorkspace();
      });
      daysEl.appendChild(chip);
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
      const li = document.createElement("li");
      li.className = "travel-stop" + (stop.id === activeStopId ? " is-active" : "");
      li.innerHTML = `
        <span class="travel-stop-index">${index + 1}</span>
        <div>
          <p class="travel-stop-title">${escapeHtml(stop.title)}</p>
          ${stop.note ? `<p class="travel-stop-note">${escapeHtml(stop.note)}</p>` : ""}
        </div>
        <button type="button" class="travel-stop-delete" aria-label="Delete stop">×</button>
      `;
      li.addEventListener("click", (event) => {
        if (event.target.closest(".travel-stop-delete")) return;
        activeStopId = stop.id;
        renderStops();
        renderMapLayers();
        map?.panTo([stop.lat, stop.lng]);
      });
      li.querySelector(".travel-stop-delete")?.addEventListener("click", (event) => {
        event.stopPropagation();
        removeStop(stop.id);
      });
      stopListEl.appendChild(li);
    });
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

  function renderWorkspace() {
    renderTripSelect();
    const trip = activeTrip();
    document.body.classList.toggle("travel-has-trip", Boolean(trip));
    if (!trip) {
      emptyEl.hidden = false;
      renderEmptyGreeting();
      workspaceEl.hidden = true;
      destroyMap();
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
    ensureMap(trip);
  }

  newOpenBtn?.addEventListener("click", () => setSheetOpen(true));
  emptyAddBtn?.addEventListener("click", () => setSheetOpen(true));
  newCloseBtn?.addEventListener("click", () => setSheetOpen(false));
  newBackdrop?.addEventListener("click", () => setSheetOpen(false));

  tripSelect?.addEventListener("change", () => {
    activeTripId = tripSelect.value || null;
    activeDay = 1;
    activeStopId = null;
    clearPlaceResults();
    saveState();
    renderWorkspace();
  });

  deleteTripBtn?.addEventListener("click", () => {
    const trip = activeTrip();
    if (!trip) return;
    if (!window.confirm(`Delete trip “${trip.name}”?`)) return;
    trips = trips.filter((item) => item.id !== trip.id);
    activeTripId = trips[0]?.id || null;
    activeDay = 1;
    activeStopId = null;
    saveState();
    renderWorkspace();
  });

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
      const places = await searchPlaces(
        query,
        { lat: trip.lat, lng: trip.lng, destination: trip.destination },
        8
      );
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

  window.addEventListener("daily-space-locale-changed", renderWorkspace);
  window.addEventListener("resize", () => map?.invalidateSize());

  const themeObserver = new MutationObserver(() => {
    if (!map) return;
    syncMapBasemap();
    renderMapLayers();
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  loadState();
  renderWorkspace();
})();
