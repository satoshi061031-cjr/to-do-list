/**
 * Travel place search providers.
 * Order: Mapbox (if MAPBOX_ACCESS_TOKEN) → Photon → Nominatim.
 * When lat/lng are provided, results prefer the trip / map area over globally famous hits.
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

function clampZoom(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 12;
  return Math.max(6, Math.min(16, Math.floor(n)));
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

function haversineKm(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function rankByNear(places, near) {
  if (!near || !places.length) return places;
  return places
    .slice()
    .sort((left, right) => haversineKm(left, near) - haversineKm(right, near));
}

function preferLocal(places, near, limit) {
  const ranked = rankByNear(dedupePlaces(places), near);
  if (!near || !ranked.length) return ranked.slice(0, limit);

  // Keep nearby hits first; only fill with far results if locals are scarce.
  const nearHits = ranked.filter((place) => haversineKm(place, near) <= 120);
  if (nearHits.length >= Math.min(3, limit)) {
    return nearHits.slice(0, limit);
  }
  return ranked.slice(0, limit);
}

function bboxAround(near, deltaDeg) {
  const lat = near.lat;
  const lng = near.lng;
  const latDelta = deltaDeg;
  const lngDelta = deltaDeg / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  return {
    minLon: lng - lngDelta,
    minLat: lat - latDelta,
    maxLon: lng + lngDelta,
    maxLat: lat + latDelta,
  };
}

function bboxParam(bbox) {
  return `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`;
}

function guessCountryCode(destination) {
  const text = String(destination || "").toLowerCase();
  if (!text) return "";
  if (
    /korea|대한민국|한국|서울|부산|제주|인천|대구|광주|south korea|rok\b/.test(text)
  ) {
    return "kr";
  }
  if (/japan|日本|일본|東京|tokyo|osaka|大阪|kyoto|京都/.test(text)) return "jp";
  if (/china|中国|中國|北京|上海|广州|深圳|香港|taiwan|台灣|台湾/.test(text)) {
    return /hong kong|香港/.test(text) ? "hk" : /taiwan|台灣|台湾/.test(text) ? "tw" : "cn";
  }
  if (/france|paris|法國|法国|파리/.test(text)) return "fr";
  if (/united states|usa\b|america|미국/.test(text)) return "us";
  if (/united kingdom|england|london|英國|英国/.test(text)) return "gb";
  if (/thailand|bangkok|泰國|泰国|방콕/.test(text)) return "th";
  if (/vietnam|hanoi|호치민|베트남/.test(text)) return "vn";
  if (/singapore|新加坡|싱가포르/.test(text)) return "sg";
  return "";
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

async function searchPhoton(query, near, limit, lang, zoom) {
  const fetchLimit = Math.min(12, Math.max(limit, limit * 2));
  const params = new URLSearchParams({
    q: query,
    limit: String(fetchLimit),
    lang: lang === "zh" ? "zh" : "en",
  });
  if (near && Number.isFinite(near.lat) && Number.isFinite(near.lng)) {
    params.set("lat", String(near.lat));
    params.set("lon", String(near.lng));
    params.set("zoom", String(clampZoom(zoom)));
    // Prefer proximity over globally famous places with the same name.
    params.set("location_bias_scale", "0.12");
  }

  async function run(withBbox) {
    const localParams = new URLSearchParams(params);
    if (withBbox && near) {
      localParams.set("bbox", bboxParam(bboxAround(near, 1.1)));
    }
    const data = await fetchJson(`${PHOTON_URL}?${localParams.toString()}`);
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

  if (near) {
    const local = await run(true).catch(() => []);
    if (local.length) return local;
  }
  return run(false);
}

async function searchNominatim(query, near, limit, lang, destination) {
  const fetchLimit = Math.min(12, Math.max(limit, limit * 2));
  const country = guessCountryCode(destination);
  const acceptLang =
    lang === "zh"
      ? "zh-CN,zh;q=0.9,ko;q=0.8,en;q=0.7"
      : country === "kr"
        ? "ko,en;q=0.8"
        : country === "jp"
          ? "ja,en;q=0.8"
          : "en";

  async function run({ bounded, useCountry }) {
    const params = new URLSearchParams({
      format: "json",
      q: query,
      limit: String(fetchLimit),
      addressdetails: "0",
    });
    if (near && Number.isFinite(near.lat) && Number.isFinite(near.lng)) {
      const box = bboxAround(near, bounded ? 1.2 : 2.5);
      params.set(
        "viewbox",
        `${box.minLon},${box.maxLat},${box.maxLon},${box.minLat}`
      );
      if (bounded) params.set("bounded", "1");
    }
    if (useCountry && country) params.set("countrycodes", country);
    const data = await fetchJson(`${NOMINATIM_URL}?${params.toString()}`, {
      "Accept-Language": acceptLang,
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

  if (near) {
    const local = await run({ bounded: true, useCountry: true }).catch(() => []);
    if (local.length) return local;
    const softLocal = await run({ bounded: true, useCountry: false }).catch(() => []);
    if (softLocal.length) return softLocal;
  }

  return run({ bounded: false, useCountry: Boolean(country) });
}

async function searchMapbox(query, near, limit, lang, zoom) {
  const token = String(process.env.MAPBOX_ACCESS_TOKEN || "").trim();
  if (!token) return [];
  const encoded = encodeURIComponent(query);
  const params = new URLSearchParams({
    access_token: token,
    limit: String(Math.min(12, Math.max(limit, limit * 2))),
    language: lang === "zh" ? "zh" : "en",
    types: "poi,address,place,locality,neighborhood",
  });
  if (near && Number.isFinite(near.lat) && Number.isFinite(near.lng)) {
    params.set("proximity", `${near.lng},${near.lat}`);
    const box = bboxAround(near, 1.4);
    params.set("bbox", `${box.minLon},${box.minLat},${box.maxLon},${box.maxLat}`);
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
 *   zoom?: number;
 *   destination?: string;
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
  const zoom = clampZoom(options?.zoom);
  const destination = String(options?.destination || "").slice(0, 120);
  const near =
    Number.isFinite(Number(options?.lat)) && Number.isFinite(Number(options?.lng))
      ? { lat: Number(options.lat), lng: Number(options.lng) }
      : null;

  const mapbox = await searchMapbox(query, near, limit, lang, zoom).catch(() => []);
  if (mapbox.length) {
    return { places: preferLocal(mapbox, near, limit), provider: "mapbox" };
  }

  const photon = await searchPhoton(query, near, limit, lang, zoom).catch(() => []);
  if (photon.length) {
    return { places: preferLocal(photon, near, limit), provider: "photon" };
  }

  const nominatim = await searchNominatim(query, near, limit, lang, destination).catch(() => []);
  return {
    places: preferLocal(nominatim, near, limit),
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
