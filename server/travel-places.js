/**
 * Travel place search providers.
 * Order: Mapbox (if MAPBOX_ACCESS_TOKEN) → Photon → Nominatim.
 */

const PHOTON_URL = "https://photon.komoot.io/api/";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const MAPBOX_URL = "https://api.mapbox.com/geocoding/v5/mapbox.places";
const USER_AGENT = "DailySpaceTravel/1.0 (local travel planner)";

function clampLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 8;
  return Math.max(1, Math.min(12, Math.floor(n)));
}

function shortTitle(label, fallback) {
  const text = String(label || "").trim();
  if (!text) return String(fallback || "Place").slice(0, 80);
  return text.split(",")[0].trim().slice(0, 80) || String(fallback || "Place").slice(0, 80);
}

function normalizePlace(place) {
  if (!place) return null;
  const lat = Number(place.lat);
  const lng = Number(place.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const label = String(place.label || "").slice(0, 180);
  const title = String(place.title || shortTitle(label, "Place")).slice(0, 80);
  return {
    lat,
    lng,
    title,
    label: label || title,
    type: String(place.type || "").slice(0, 40),
    source: String(place.source || "").slice(0, 24),
  };
}

async function fetchJson(url, headers) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
      ...(headers || {}),
    },
  });
  if (!response.ok) {
    const error = new Error(`Place search HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function searchPhoton(query, near, limit, lang) {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
    lang: lang === "zh" ? "zh" : "en",
  });
  if (near && Number.isFinite(near.lat) && Number.isFinite(near.lng)) {
    params.set("lat", String(near.lat));
    params.set("lon", String(near.lng));
  }
  const data = await fetchJson(`${PHOTON_URL}?${params.toString()}`);
  const features = Array.isArray(data?.features) ? data.features : [];
  return features
    .map((feature) => {
      const coords = feature?.geometry?.coordinates;
      const props = feature?.properties || {};
      if (!Array.isArray(coords) || coords.length < 2) return null;
      const parts = [props.name, props.street, props.city || props.county, props.state, props.country]
        .map((part) => (typeof part === "string" ? part.trim() : ""))
        .filter(Boolean);
      const label = parts.join(", ") || props.name || query;
      return normalizePlace({
        lat: coords[1],
        lng: coords[0],
        title: props.name || shortTitle(label, query),
        label,
        type: props.osm_value || props.type || props.osm_key || "",
        source: "photon",
      });
    })
    .filter(Boolean);
}

async function searchNominatim(query, near, limit, lang) {
  const params = new URLSearchParams({
    format: "json",
    q: query,
    limit: String(limit),
    addressdetails: "0",
  });
  if (near && Number.isFinite(near.lat) && Number.isFinite(near.lng)) {
    // Soft bias — do not use bounded=1 (too easy to return zero hits).
    const delta = 0.6;
    params.set(
      "viewbox",
      `${near.lng - delta},${near.lat + delta},${near.lng + delta},${near.lat - delta}`
    );
  }
  const data = await fetchJson(`${NOMINATIM_URL}?${params.toString()}`, {
    "Accept-Language": lang === "zh" ? "zh-CN,zh;q=0.9,en;q=0.8" : "en",
  });
  if (!Array.isArray(data)) return [];
  return data
    .map((hit) =>
      normalizePlace({
        lat: hit.lat,
        lng: hit.lon,
        title: shortTitle(hit.display_name, query),
        label: hit.display_name,
        type: hit.type || hit.class || "",
        source: "nominatim",
      })
    )
    .filter(Boolean);
}

async function searchMapbox(query, near, limit, lang) {
  const token = String(process.env.MAPBOX_ACCESS_TOKEN || "").trim();
  if (!token) return [];
  const encoded = encodeURIComponent(query);
  const params = new URLSearchParams({
    access_token: token,
    limit: String(limit),
    language: lang === "zh" ? "zh" : "en",
    types: "poi,address,place,locality,neighborhood",
  });
  if (near && Number.isFinite(near.lat) && Number.isFinite(near.lng)) {
    params.set("proximity", `${near.lng},${near.lat}`);
  }
  const data = await fetchJson(`${MAPBOX_URL}/${encoded}.json?${params.toString()}`);
  const features = Array.isArray(data?.features) ? data.features : [];
  return features
    .map((feature) => {
      const center = feature?.center;
      if (!Array.isArray(center) || center.length < 2) return null;
      return normalizePlace({
        lat: center[1],
        lng: center[0],
        title: feature.text || shortTitle(feature.place_name, query),
        label: feature.place_name || feature.text || query,
        type: Array.isArray(feature.place_type) ? feature.place_type[0] : "",
        source: "mapbox",
      });
    })
    .filter(Boolean);
}

function dedupePlaces(places) {
  const seen = new Set();
  const out = [];
  for (const place of places) {
    const key = `${place.title.toLowerCase()}|${place.lat.toFixed(4)}|${place.lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(place);
  }
  return out;
}

/**
 * @param {{
 *   query: string;
 *   lat?: number;
 *   lng?: number;
 *   limit?: number;
 *   lang?: string;
 * }} options
 */
async function searchTravelPlaces(options) {
  const query = String(options?.query || "").trim();
  if (!query) {
    return { places: [], provider: "none" };
  }
  const limit = clampLimit(options?.limit);
  const lang = String(options?.lang || "en").toLowerCase().startsWith("zh") ? "zh" : "en";
  const near =
    Number.isFinite(Number(options?.lat)) && Number.isFinite(Number(options?.lng))
      ? { lat: Number(options.lat), lng: Number(options.lng) }
      : null;

  const mapbox = await searchMapbox(query, near, limit, lang).catch(() => []);
  if (mapbox.length) {
    return { places: dedupePlaces(mapbox).slice(0, limit), provider: "mapbox" };
  }

  const photon = await searchPhoton(query, near, limit, lang).catch(() => []);
  if (photon.length) {
    return { places: dedupePlaces(photon).slice(0, limit), provider: "photon" };
  }

  const nominatim = await searchNominatim(query, near, limit, lang).catch(() => []);
  return {
    places: dedupePlaces(nominatim).slice(0, limit),
    provider: nominatim.length ? "nominatim" : "none",
  };
}

function travelPlacesStatus() {
  return {
    mapboxConfigured: Boolean(String(process.env.MAPBOX_ACCESS_TOKEN || "").trim()),
    providers: ["mapbox", "photon", "nominatim"],
  };
}

module.exports = {
  searchTravelPlaces,
  travelPlacesStatus,
};
