// Waypoint — a clean, ad-free directions app.
// Geocoding: OneMap (Singapore's official government geocoder, via our own
// /api/geocode proxy) for place/address/postal-code search. Reverse geocoding
// ("what's near my current GPS position") still uses Nominatim, since that
// direction isn't prone to the ambiguous/under-construction-POI problem OneMap
// fixed for forward search. Routing: OSRM public demo server (driving/cycling/
// walking) and OpenTripPlanner via /api/transit-plan (bus/MRT).

let fromCoords = null; // { lat, lon, label }
let toCoords = null;
let selectedMode = 'driving';

// Which OSRM backend + profile name to use per travel mode. See the comment
// in getDirections() for why driving/cycling/walking don't all hit the same host.
const OSRM_ENDPOINTS = {
  driving: { host: 'https://router.project-osrm.org', profile: 'driving' },
  cycling: { host: 'https://routing.openstreetmap.de/routed-bike', profile: 'bike' },
  walking: { host: 'https://routing.openstreetmap.de/routed-foot', profile: 'foot' },
};

// Small inline-SVG icon set for the handful of chrome controls whose icon
// is swapped at runtime (everything else lives as static markup in
// index.html). Kept dependency-free — no icon font/library — matching the
// rest of the app.
const ICONS = {
  locate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="6.3"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><path d="M12 2.3v3M12 18.7v3M2.3 12h3M18.7 12h3"/></svg>',
  volumeOn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5v5h3.2L12 18V6L7.2 9.5H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>',
  volumeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5v5h3.2L12 18V6L7.2 9.5H4z"/><path d="M16 9l4.5 6M20.5 9L16 15"/></svg>',
};

const els = {
  langBtn: document.getElementById('langBtn'),
  langBtnText: document.getElementById('langBtnText'),
  searchInput: document.getElementById('searchInput'),
  searchClear: document.getElementById('searchClear'),
  searchResults: document.getElementById('searchResults'),
  categoryRow: document.getElementById('categoryRow'),
  placeCard: document.getElementById('placeCard'),
  placeName: document.getElementById('placeName'),
  placeAddress: document.getElementById('placeAddress'),
  attractionInfo: document.getElementById('attractionInfo'),
  dirFromHere: document.getElementById('dirFromHere'),
  dirToHere: document.getElementById('dirToHere'),
  setHomeBtn: document.getElementById('setHomeBtn'),
  setWorkBtn: document.getElementById('setWorkBtn'),
  quickHomeBtn: document.getElementById('quickHomeBtn'),
  quickWorkBtn: document.getElementById('quickWorkBtn'),
  fromInput: document.getElementById('fromInput'),
  toInput: document.getElementById('toInput'),
  fromResults: document.getElementById('fromResults'),
  toResults: document.getElementById('toResults'),
  swapBtn: document.getElementById('swapBtn'),
  getDirectionsBtn: document.getElementById('getDirectionsBtn'),
  routeSummary: document.getElementById('routeSummary'),
  routePreviewMap: document.getElementById('routePreviewMap'),
  rideHailingLinks: document.getElementById('rideHailingLinks'),
  routeSteps: document.getElementById('routeSteps'),
  itineraryOptionsLabel: document.getElementById('itineraryOptionsLabel'),
  itineraryOptions: document.getElementById('itineraryOptions'),
  rainBanner: document.getElementById('rainBanner'),
  rainBannerText: document.getElementById('rainBannerText'),
  dengueBanner: document.getElementById('dengueBanner'),
  dengueBannerText: document.getElementById('dengueBannerText'),
  floodBanner: document.getElementById('floodBanner'),
  floodBannerText: document.getElementById('floodBannerText'),
  trainAlertBanner: document.getElementById('trainAlertBanner'),
  trainAlertText: document.getElementById('trainAlertText'),
  trainAlertDismiss: document.getElementById('trainAlertDismiss'),
  parkingInfo: document.getElementById('parkingInfo'),
  evChargingInfo: document.getElementById('evChargingInfo'),
  petrolInfo: document.getElementById('petrolInfo'),
  erpInfo: document.getElementById('erpInfo'),
  speedCameraInfo: document.getElementById('speedCameraInfo'),
  trafficInfo: document.getElementById('trafficInfo'),
  cyclingExtra: document.getElementById('cyclingExtra'),
  startNavBtn: document.getElementById('startNavBtn'),
  navBanner: document.getElementById('navBanner'),
  navBannerIcon: document.getElementById('navBannerIcon'),
  navBannerDistance: document.getElementById('navBannerDistance'),
  navBannerInstruction: document.getElementById('navBannerInstruction'),
  navMuteBtn: document.getElementById('navMuteBtn'),
  navStopBtn: document.getElementById('navStopBtn'),
  navMapOverlay: document.getElementById('navMapOverlay'),
  navRecenterBtn: document.getElementById('navRecenterBtn'),
  navSpeedBadge: document.getElementById('navSpeedBadge'),
  navSpeedValue: document.getElementById('navSpeedValue'),
  navCompass: document.getElementById('navCompass'),
  navCompassNeedle: document.getElementById('navCompassNeedle'),
  navBottomSheet: document.getElementById('navBottomSheet'),
  navEta: document.getElementById('navEta'),
  navRemainingDuration: document.getElementById('navRemainingDuration'),
  navRemainingDistance: document.getElementById('navRemainingDistance'),
  parkedCarCard: document.getElementById('parkedCarCard'),
  parkedCarAgo: document.getElementById('parkedCarAgo'),
  parkedCarDistance: document.getElementById('parkedCarDistance'),
  parkedCarDirectionsBtn: document.getElementById('parkedCarDirectionsBtn'),
  parkedCarClearBtn: document.getElementById('parkedCarClearBtn'),
  saveParkingBtn: document.getElementById('saveParkingBtn'),
  locateBtn: document.getElementById('locateBtn'),
  locateBtnIcon: document.getElementById('locateBtnIcon'),
  offlineBanner: document.getElementById('offlineBanner'),
  notifyBtn: document.getElementById('notifyBtn'),
  sosBtn: document.getElementById('sosBtn'),
  sosModal: document.getElementById('sosModal'),
  sosModalBody: document.getElementById('sosModalBody'),
  sosModalClose: document.getElementById('sosModalClose'),
  sosTrackingBanner: document.getElementById('sosTrackingBanner'),
  sosTrackingText: document.getElementById('sosTrackingText'),
  sosTrackingStopBtn: document.getElementById('sosTrackingStopBtn'),
  weatherWidget: document.getElementById('weatherWidget'),
  weatherPanel: document.getElementById('weatherPanel'),
  weatherPanelBody: document.getElementById('weatherPanelBody'),
  weatherPanelClose: document.getElementById('weatherPanelClose'),
  toast: document.getElementById('toast'),
  tabs: document.querySelectorAll('.tab-btn'),
  panels: document.querySelectorAll('.panel'),
  modeButtons: document.querySelectorAll('.mode-btn'),
  wakeAlert: document.getElementById('wakeAlert'),
  wakeAlertText: document.getElementById('wakeAlertText'),
  wakeAlertDismiss: document.getElementById('wakeAlertDismiss'),
  shareBtn: document.getElementById('shareBtn'),
  installBanner: document.getElementById('installBanner'),
  installBtn: document.getElementById('installBtn'),
  installDismissBtn: document.getElementById('installDismissBtn'),
  alertNudgeBanner: document.getElementById('alertNudgeBanner'),
  alertNudgeBtn: document.getElementById('alertNudgeBtn'),
  alertNudgeDismissBtn: document.getElementById('alertNudgeDismissBtn'),
  nearbyStopsBtn: document.getElementById('nearbyStopsBtn'),
  nearbyArrivalsList: document.getElementById('nearbyArrivalsList'),
  nearbyArrivalsHint: document.getElementById('nearbyArrivalsHint'),
  nearbyArrivalsRefreshBtn: document.getElementById('nearbyArrivalsRefreshBtn'),
  favSearchInput: document.getElementById('favSearchInput'),
  favSearchResults: document.getElementById('favSearchResults'),
  favList: document.getElementById('favList'),
  favEmptyHint: document.getElementById('favEmptyHint'),
  themeToggle: document.getElementById('themeToggle'),
  themeColorMeta: document.getElementById('themeColorMeta'),
  routePickingBanner: document.getElementById('routePickingBanner'),
  routePickingCancelBtn: document.getElementById('routePickingCancelBtn'),
  planRouteBtn: document.getElementById('planRouteBtn'),
  routePlanResult: document.getElementById('routePlanResult'),
};

let currentPlace = null; // last searched place result

// ---------- Theme (light/dark) ----------
// Same localStorage pattern every other Waypoint preference uses (see
// LANG_STORAGE_KEY, PUSH_ENABLED_KEY, etc. below). A tiny inline script in
// index.html's <head> reads this same key and sets data-theme before first
// paint (so there's no flash of the wrong theme) — keep THEME_KEY in sync
// with the string literal there if it ever changes.
const THEME_KEY = 'waypoint_theme';

function getSystemTheme() {
  return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}

function getStoredTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return (v === 'light' || v === 'dark') ? v : null;
  } catch (err) { return null; }
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  if (els.themeToggle) {
    els.themeToggle.setAttribute('aria-checked', theme === 'dark' ? 'true' : 'false');
    const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    els.themeToggle.title = label;
    els.themeToggle.setAttribute('aria-label', label);
  }
  // Matches the browser chrome (status bar / task switcher) to the theme,
  // same idea as index.html's static #2563eb but theme-aware.
  if (els.themeColorMeta) els.themeColorMeta.setAttribute('content', theme === 'dark' ? '#000000' : '#2563eb');
}

function initTheme() {
  // The <head> inline script already set data-theme before paint (stored
  // choice, else the OS preference) — normally this just wires up the
  // toggle button to match whatever it landed on. The stored/system-theme
  // fallback here only matters if that inline script didn't run (e.g. CSP).
  const attr = document.documentElement.getAttribute('data-theme');
  const current = (attr === 'dark' || attr === 'light') ? attr : (getStoredTheme() || getSystemTheme());
  applyTheme(current);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch (err) { /* ignore */ }
}

if (els.themeToggle) els.themeToggle.addEventListener('click', toggleTheme);
initTheme();

// ---------- Utilities ----------

function debounce(fn, delay) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(msg, ms = 2500) {
  els.toast.textContent = msg;
  els.toast.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => els.toast.classList.add('hidden'), ms);
}

// Turns a GeolocationPositionError into an actionable message instead of a
// generic "Could not get your location" for every possible cause — permission
// denial, no GPS/wifi fix available, and a timeout all need different fixes
// from the user, and code 0 ("Geolocation is not supported...") is handled
// separately by each caller before this ever runs.
function geoErrorMessage(err) {
  switch (err && err.code) {
    case 1: // PERMISSION_DENIED
      return 'Location access is blocked for this site — check your browser/site permissions and allow location, then try again.';
    case 2: // POSITION_UNAVAILABLE
      return 'Could not get a location fix — try again with GPS/Wi-Fi on, ideally outdoors.';
    case 3: // TIMEOUT
      return 'Location request timed out — try again.';
    default:
      return 'Could not get your location.';
  }
}

const GEO_OPTIONS = { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 };

async function geocode(query) {
  if (!query || query.trim().length < 2) return [];
  try {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error('geocode failed');
    const data = await res.json();
    return data.results || [];
  } catch (err) {
    console.error(err);
    return [];
  }
}

// Results can come from two shapes: OneMap forward-search results ({ label,
// address, lat, lon }, already short/clean — no OSM-style comma-hierarchy to
// trim) or a Nominatim reverse-geocode result ({ display_name }) from the
// "use my location" button.
function shortLabel(result) {
  if (result.label) return result.label;
  if (result.display_name) return result.display_name.split(',').slice(0, 2).join(',').trim();
  return '';
}

function addressText(result) {
  return result.address || result.display_name || '';
}

// ---------- Tabs ----------

els.tabs.forEach(btn => {
  btn.addEventListener('click', () => {
    els.tabs.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    const target = btn.dataset.tab;
    els.panels.forEach(p => p.classList.remove('active'));
    document.getElementById(`panel-${target}`).classList.add('active');
    if (target === 'favourites') {
      renderParkedCar();
      loadNearbyArrivals();
    } else {
      stopNearbyArrivalsRefresh();
    }
  });
});

function switchToDirectionsTab() {
  document.querySelector('.tab-btn[data-tab="directions"]').click();
}

// ---------- Search panel ----------

const runSearch = debounce(async (query) => {
  const results = await geocode(query);
  renderResultList(els.searchResults, results, (r) => selectSearchResult(r));
}, 350);

els.searchInput.addEventListener('input', (e) => {
  const val = e.target.value;
  els.searchClear.classList.toggle('visible', val.length > 0);
  if (val.length < 2) {
    els.searchResults.innerHTML = '';
    return;
  }
  runSearch(val);
});

els.searchClear.addEventListener('click', () => {
  els.searchInput.value = '';
  els.searchClear.classList.remove('visible');
  els.searchResults.innerHTML = '';
  els.placeCard.classList.add('hidden');
  els.attractionInfo.classList.add('hidden');
  els.attractionInfo.innerHTML = '';
});

function renderResultList(listEl, results, onPick) {
  listEl.innerHTML = '';
  results.forEach(r => {
    const li = document.createElement('li');
    const title = document.createElement('span');
    title.className = 'r-title';
    title.textContent = shortLabel(r);
    const sub = document.createElement('span');
    sub.className = 'r-sub';
    if (r.details) {
      // Each piece (tag, hours, phone) stays whole; the pieces wrap between themselves.
      r.details.filter((line) => line.length).forEach((line) => {
        const row = document.createElement('div');
        row.className = 'r-line';
        line.forEach((item) => {
          const isLink = typeof item === 'object' && item.href;
          // A colored line-badge chip (e.g. "NS" on red, "CC" on orange) —
          // used for MRT/LRT station results, same visual language as the
          // transit-directions line badges (see lineBadge/MRT_LINE_NAMES).
          const isBadge = !isLink && typeof item === 'object' && item.badge;
          const chip = document.createElement(isLink ? 'a' : 'span');
          chip.className = isLink ? 'r-chip r-link' : isBadge ? 'r-chip line-badge' : 'r-chip';
          chip.textContent = isLink || isBadge ? item.text : item;
          if (isLink) {
            chip.href = item.href;
            if (item.external) { chip.target = '_blank'; chip.rel = 'noopener'; }
            chip.addEventListener('click', (e) => e.stopPropagation());
          }
          if (isBadge) {
            chip.style.background = item.bg || '#666';
            chip.style.color = item.color || '#fff';
            if (item.title) chip.title = item.title;
          }
          row.appendChild(chip);
        });
        sub.appendChild(row);
      });
    } else {
      sub.textContent = addressText(r);
    }
    li.appendChild(title);
    li.appendChild(sub);
    li.addEventListener('click', () => onPick(r));
    listEl.appendChild(li);
  });
}

function selectSearchResult(r) {
  // Plan a Route hijacks the Search tab to fill one of its 3 destination
  // slots -- this is the single choke point every search flow (free-text,
  // a landmark chip, or a "nearby X" category result) already funnels
  // through, so hooking in here is what makes "pick any place, from any
  // category" work without duplicating any of that logic.
  if (routePickingSlot) {
    setRouteDestination(routePickingSlot, r);
    return;
  }
  currentPlace = r;
  els.searchResults.innerHTML = '';
  els.searchInput.value = shortLabel(r);

  els.placeName.textContent = shortLabel(r);
  els.placeAddress.textContent = addressText(r);
  const oldContact = els.placeCard.querySelector('.place-contact');
  if (oldContact) oldContact.remove();
  if (r.contact && r.contact.href) {
    const link = document.createElement('a');
    link.className = 'place-contact';
    link.href = r.contact.href;
    link.textContent = r.contact.text.startsWith('💬') ? '💬 Message on WhatsApp' : `📞 Call ${r.contact.text.replace(/^\S+\s/, '')}`;
    if (r.contact.external) { link.target = '_blank'; link.rel = 'noopener'; }
    els.placeAddress.insertAdjacentElement('afterend', link);
  }
  els.placeCard.classList.remove('hidden');
  loadAttractionInfo(r);
}

// ---------- Attraction info (nearest MRT/LRT + nearby attractions) ---------
// Shown on the place card only for Waypoint's own curated LANDMARKS — a
// random street address or bus stop from OneMap search doesn't have a
// meaningful "nearby attractions" list, but the ~30 tourist spots we already
// know about do. Reuses infrastructure that already exists elsewhere in the
// app rather than adding anything new-and-parallel: haversine for distances
// (client-side copy — server.js has its own, but nothing here talks to it
// for this), OSRM's foot profile for an accurate walk time (same host/profile
// getDirections() already uses for walking mode), and the new
// /api/nearest-station endpoint for MRT/LRT (LTA's bus stop feed has no rail
// stations at all).

const ATTRACTION_MATCH_RADIUS_M = 150; // "is this search result actually one of our landmarks"
const NEARBY_ATTRACTIONS_RADIUS_M = 2000;
const NEARBY_ATTRACTIONS_LIMIT = 4;

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Matches a selected search result back to a LANDMARKS entry even when it
// came from free-text search (OneMap's own coordinates for "Gardens by the
// Bay" won't be byte-identical to ours) rather than a category chip tap.
function findLandmarkMatch(r) {
  if (!r || typeof r.lat !== 'number' || typeof r.lon !== 'number') return null;
  let best = null;
  for (const [key, entry] of Object.entries(LANDMARKS)) {
    const d = haversineMeters(r.lat, r.lon, entry.lat, entry.lon);
    if (d <= ATTRACTION_MATCH_RADIUS_M && (!best || d < best.distance)) best = { key, entry, distance: d };
  }
  return best;
}

function nearbyAttractions(matchedKey, lat, lon) {
  return Object.entries(LANDMARKS)
    .filter(([key]) => key !== matchedKey)
    .map(([key, entry]) => ({ key, entry, distance: haversineMeters(lat, lon, entry.lat, entry.lon) }))
    .filter((a) => a.distance <= NEARBY_ATTRACTIONS_RADIUS_M)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, NEARBY_ATTRACTIONS_LIMIT);
}

// Straight-line distance always understates an actual walking route (roads/
// paths aren't a straight line) — asking OSRM for the real foot-profile route
// gives a genuine walk time instead of a guess, same host this app already
// trusts for turn-by-turn walking directions.
async function walkingRouteTo(fromLat, fromLon, toLat, toLon) {
  const { host, profile } = OSRM_ENDPOINTS.walking;
  try {
    const res = await fetch(`${host}/route/v1/${profile}/${fromLon},${fromLat};${toLon},${toLat}?overview=false`);
    if (!res.ok) throw new Error(`OSRM responded ${res.status}`);
    const data = await res.json();
    const route = data.routes && data.routes[0];
    if (!route) throw new Error('no route');
    return { distance: route.distance, duration: route.duration };
  } catch (err) {
    // Fall back to straight-line distance at a typical walking pace (5km/h)
    // if OSRM is unreachable — still useful, just labelled as an estimate.
    const distance = haversineMeters(fromLat, fromLon, toLat, toLon);
    return { distance, duration: (distance / 1000 / 5) * 3600, estimated: true };
  }
}

// Guide cards: name, verified badge, specialty/languages, a short curated
// "insider tip" preview from the guide (feature: guide-curated previews),
// and -- where the guide has a WhatsApp number on file -- a "Message on
// WhatsApp" button that pre-fills an enquiry (feature: direct booking, as
// an enquiry-to-book MVP rather than a live calendar). Sample profiles
// (seeded before any real STGS guide is added) have no WhatsApp number, so
// that button just doesn't render for them.
//
// Extracted out of loadAttractionInfo() below so it's a plain, reusable
// "here's who's tagged to this key" renderer rather than inline in that
// function -- kept as its own helper even though it currently has just the
// one caller, since a category-style guide list with no place card (à la
// the Guided Walk theme categories tried and rolled back earlier) is the
// kind of thing likely to come back.
function renderGuidesSection(guideList, key) {
  return guideList.length
    ? `
      <div class="attraction-guides">
        <h4>${t('attraction_guides_title')} <span class="attraction-guides-badge">Society of Tourist Guides</span></h4>
        ${guideList.map((g) => {
          const languages = (g.languages || []).join(', ');
          return `
            <div class="attraction-guide-card">
              <div class="attraction-guide-head">
                <span class="attraction-guide-name">${escapeHtml(g.name)}</span>
                ${g.verified ? `<span class="attraction-guide-verified">✓ ${t('attraction_guide_verified')}</span>` : ''}
              </div>
              ${g.specialty || languages ? `<div class="attraction-guide-meta">${escapeHtml([g.specialty, languages].filter(Boolean).join(' · '))}</div>` : ''}
              ${g.pricePerAdult != null ? `<div class="attraction-guide-price">S$${Number(g.pricePerAdult).toFixed(2)} / adult · children under 15 free</div>` : ''}
              ${g.note ? `<p class="attraction-guide-note">“${escapeHtml(g.note)}”</p>` : ''}
              ${g.sample ? `<div class="attraction-guide-sample-note">${t('attraction_guide_sample')}</div>` : `<a class="attraction-guide-availability" href="/guide-booking.html?guide=${encodeURIComponent(g.id)}&landmark=${encodeURIComponent(key)}" target="_blank" rel="noopener">📅 ${t('attraction_guide_availability')}</a>`}
            </div>`;
        }).join('')}
      </div>`
    : '';
}

let attractionInfoToken = 0; // guards against a slow lookup overwriting a newer selection

async function loadAttractionInfo(r) {
  const match = findLandmarkMatch(r);
  if (!match) {
    els.attractionInfo.classList.add('hidden');
    els.attractionInfo.innerHTML = '';
    return;
  }

  const token = ++attractionInfoToken;
  const { key, entry } = match;
  els.attractionInfo.classList.remove('hidden');
  els.attractionInfo.innerHTML = `<p class="attraction-loading">${t('attraction_loading')}</p>`;

  const nearby = nearbyAttractions(key, entry.lat, entry.lon);

  // Certified STGS guides tagged to this landmark (see /api/guides-for-landmark
  // in server.js) -- fetched alongside the MRT/LRT lookup below so both are
  // ready by the time the card renders. Fails soft to an empty list: a guide
  // fetch problem shouldn't block the rest of the place card from showing.
  let guideList = [];
  try {
    const guidesRes = await fetch(`/api/guides-for-landmark?key=${encodeURIComponent(key)}`);
    if (token !== attractionInfoToken) return;
    const guidesData = await guidesRes.json().catch(() => ({}));
    if (guidesRes.ok && Array.isArray(guidesData.guides)) guideList = guidesData.guides;
  } catch (err) {
    console.error('guides-for-landmark lookup failed:', err);
  }

  let stationHtml = '';
  try {
    const res = await fetch(`/api/nearest-station?lat=${entry.lat}&lon=${entry.lon}`);
    const data = await res.json().catch(() => ({}));
    if (token !== attractionInfoToken) return; // a newer attraction was selected meanwhile
    const nearest = res.ok && data.stations && data.stations[0];
    if (nearest) {
      const walk = await walkingRouteTo(entry.lat, entry.lon, nearest.lat, nearest.lon);
      if (token !== attractionInfoToken) return;
      stationHtml = `
        <div class="attraction-station">
          <span class="attraction-station-icon">🚇</span>
          <div class="attraction-station-text">
            <strong>${escapeHtml(nearest.name)} ${nearest.mode}</strong>
            <span>${t('attraction_walk_prefix')} ${formatDistance(walk.distance)} · ${formatDuration(walk.duration)}${walk.estimated ? ` (${t('attraction_estimated')})` : ''}</span>
          </div>
        </div>`;
    } else {
      stationHtml = `<p class="attraction-station-none">${t('attraction_no_station')}</p>`;
    }
  } catch (err) {
    console.error('nearest-station lookup failed:', err);
    if (token !== attractionInfoToken) return;
    stationHtml = `<p class="attraction-station-none">${t('attraction_no_station')}</p>`;
  }

  const nearbyHtml = nearby.length
    ? `
      <div class="attraction-nearby">
        <h4>${t('attraction_nearby_title')}</h4>
        <div class="attraction-nearby-list">
          ${nearby.map((a) => `<button type="button" class="attraction-nearby-chip" data-landmark="${a.key}">${escapeHtml(a.entry.label)} · ${formatDistance(a.distance)}</button>`).join('')}
        </div>
      </div>`
    : '';

  // See renderGuidesSection() above.
  const guidesHtml = renderGuidesSection(guideList, key);

  // Only rendered for landmarks that are actually paid/ticketed attractions
  // (see TICKET_LINKS) — a free spot like Merlion Park has nothing to book.
  const ticketUrl = tagAffiliateUrl(TICKET_LINKS[key]);
  const ticketHtml = ticketUrl
    ? `<a class="attraction-ticket-btn" href="${ticketUrl}" target="_blank" rel="noopener noreferrer sponsored">${t('attraction_book_tickets')}</a>`
    : '';

  // Only rendered for Gourmet Food landmarks (see FOOD_LINKS) — links to a
  // general food-experiences listing rather than the specific hawker centre.
  const foodUrl = tagAffiliateUrl(FOOD_LINKS[key]);
  const foodHtml = foodUrl
    ? `<a class="attraction-ticket-btn" href="${foodUrl}" target="_blank" rel="noopener noreferrer sponsored">${t('attraction_explore_food')}</a>`
    : '';

  // "What to actually order here" — only shown alongside the Gourmet Food
  // link above, since a tourist has no way to know which stall/dish a hawker
  // centre is actually known for otherwise.
  const foodHighlight = FOOD_HIGHLIGHTS[key];
  const foodHighlightHtml = foodHighlight
    ? `<p class="attraction-food-tip">🍴 ${t('attraction_try')} <strong>${escapeHtml(foodHighlight)}</strong></p>`
    : '';

  // A short "did you know" info tip for every Guided Walk landmark — see
  // DISTRICT_COVERAGE above. Shown first, ahead of the nearest MRT/nearby-
  // attractions info, since "what is this place" matters more here than it
  // does for a landmark whose name is already fully self-explanatory.
  const coverage = DISTRICT_COVERAGE[key];
  const coverageHtml = coverage
    ? `<p class="attraction-coverage-tip">📍 ${escapeHtml(coverage)}</p>`
    : '';

  if (token !== attractionInfoToken) return;
  els.attractionInfo.innerHTML = `${coverageHtml}${stationHtml}${nearbyHtml}${guidesHtml}${ticketHtml}${foodHighlightHtml}${foodHtml}`;
  els.attractionInfo.querySelectorAll('.attraction-nearby-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const landmark = LANDMARKS[btn.dataset.landmark];
      if (landmark) selectSearchResult(landmark);
    });
  });
}

// ---------- Category quick search (Waze-style "Categories" row) ----------
// Tap 🏥/🍽️/👮 on the Search tab to find the nearest of that kind from your
// current GPS position — reuses the exact same result list + place card +
// "Directions to here" flow as a normal text search, since the results come
// back in the same { label, address, lat, lon } shape.

const CATEGORY_LABELS = {
  hospital: 'hospital',
  police: 'police station',
  vets: 'vet',
  toilets: 'toilet',
  vegetarian: 'vegetarian-friendly restaurant',
  halal: 'halal restaurant',
  mosque: 'mosque',
  moneychanger: 'money changer',
  postoffice: 'post office',
  library: 'library',
  church: 'church',
  temple: 'temple',
  dogpark: 'dog park',
  carpark: 'carpark',
  towtruck: 'tow truck service',
  petgrooming: 'pet groomer',
  petcafe: 'pet cafe',
  petcafeopen: 'pet cafe that is open now',
  petcafeoutdoor: 'pet cafe with outdoor seating',
  petcafeindoor: 'pet cafe with indoor seating',
  anytimefitness: 'Anytime Fitness gym',
  applestore: 'Apple Store',
  mrtstations: 'MRT/LRT station',
};

// Same OSM tag mapping as the server used to run — moved client-side after
// Railway's own server-to-server calls to Overpass came back "fetch failed"
// (a network-level failure to even connect, not a bad query or slow
// response). Calling Overpass directly from the browser instead sidesteps
// whatever that was, and matches how OSRM routing already works in this app
// — fetched straight from the phone, not proxied through our server.
const CATEGORY_OSM_TAGS = {
  hospital: { key: 'amenity', tags: ['hospital'] },
  police: { key: 'amenity', tags: ['police'] },
  vets: { key: 'amenity', tags: ['veterinary'] },
  toilets: { key: 'amenity', tags: ['toilets'] },
  // Vegetarian/halal aren't their own OSM place types — they're food places
  // (restaurant/cafe/fast_food) additionally tagged diet:vegetarian or
  // diet:halal. In OSM's diet:* scheme, "yes" only means "accommodates this
  // diet" (e.g. a McDonald's with a veggie burger, a Western grill with one
  // halal option) — it does NOT mean the place is actually a vegetarian/halal
  // restaurant. Only "only" means every item served meets the diet, so that's
  // what these chips need to avoid surfacing places that are mostly not
  // vegetarian/halal at all.
  vegetarian: { key: 'amenity', tags: ['restaurant', 'cafe', 'fast_food'], extraKey: 'diet:vegetarian', extraValue: 'only' },
  halal: { key: 'amenity', tags: ['restaurant', 'cafe', 'fast_food'], extraKey: 'diet:halal', extraValue: 'only' },
  // Mosques are place_of_worship + religion=muslim.
  mosque: { key: 'amenity', tags: ['place_of_worship'], extraKey: 'religion', extraValue: 'muslim' },
  // Church/Temple are the same place_of_worship base, split by religion —
  // "Temple" covers Singapore's Buddhist, Taoist, and Hindu temples together.
  church: { key: 'amenity', tags: ['place_of_worship'], extraKey: 'religion', extraValue: 'christian' },
  temple: { key: 'amenity', tags: ['place_of_worship'], extraKey: 'religion', extraValue: 'buddhist|hindu|taoist' },
  moneychanger: { key: 'shop', tags: ['money_exchange'] },
  postoffice: { key: 'amenity', tags: ['post_office'] },
  library: { key: 'amenity', tags: ['library'] },
  dogpark: { key: 'leisure', tags: ['dog_park'] },
  // Towing isn't its own OSM place type either — it's a car repair shop
  // (shop=car_repair) additionally tagged service:vehicle:towing=yes, per
  // OSM's documented Key:service:vehicle:* scheme. Without the extra filter
  // this would surface every car workshop, most of which don't tow.
  towtruck: { key: 'shop', tags: ['car_repair'], extraKey: 'service:vehicle:towing', extraValue: 'yes' },
  // Standard, documented OSM tag — no sub-filter needed, same as hospital/police/vets.
  petgrooming: { key: 'shop', tags: ['pet_grooming'] },
};
// Tried in order — start close (keeps dense categories genuinely local),
// then widen automatically for sparse categories that
// legitimately don't have one within 1km. Confirmed against Waze itself: for
// a Punggol starting point, Waze's own nearest "Hospitals" result was 1.9km
// away — a hard 1km cutoff would show "nothing found" even though Waze (and
// this app, once widened) finds real hospitals just past that line.
const CATEGORY_SEARCH_RADII_M = [1000, 3000, 6000];
const OVERPASS_HOSTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

function buildCategoryOverpassQuery({ key, tags, extraKey, extraValue }, lat, lon, radius) {
  const filter = tags.length === 1 ? `["${key}"="${tags[0]}"]` : `["${key}"~"^(${tags.join('|')})$"]`;
  // A second bracket filter chains as AND in Overpass QL, so this narrows
  // e.g. "restaurant" down to "restaurant AND diet:vegetarian is yes/only",
  // or "place_of_worship" down to "place_of_worship AND religion=muslim".
  const extraFilter = extraKey ? `["${extraKey}"~"^(${extraValue})$"]` : '';
  const around = `(around:${radius},${lat},${lon})`;
  return `[out:json][timeout:20];(node${filter}${extraFilter}${around};way${filter}${extraFilter}${around};relation${filter}${extraFilter}${around};);out center tags 40;`;
}

async function fetchFromOverpass(query) {
  let lastErr = null;
  for (const host of OVERPASS_HOSTS) {
    // A plain fetch() has no default timeout — without this, one slow/hung
    // mirror could stall the whole search indefinitely, especially across up
    // to 3 radius tiers × 2 mirrors = 6 sequential attempts in the worst case.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(host, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) throw new Error(`${host} responded ${res.status}`);
      const data = await res.json();
      return (data.elements || [])
        .map((el) => {
          const point = el.type === 'node' ? el : el.center;
          const t = el.tags || {};
          const name = t.name || t.brand || null;
          if (!point || !name) return null;
          const address = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
          return { label: name, address, lat: point.lat, lon: point.lon };
        })
        .filter(Boolean);
    } catch (err) {
      console.error(`category search via ${host} failed:`, err);
      lastErr = err;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastErr || new Error('All Overpass mirrors failed.');
}

async function fetchCategoryPlaces(category, lat, lon, onTierStart) {
  const tagInfo = CATEGORY_OSM_TAGS[category];
  let lastErr = null;
  for (const radius of CATEGORY_SEARCH_RADII_M) {
    if (onTierStart) onTierStart(radius);
    const query = buildCategoryOverpassQuery(tagInfo, lat, lon, radius);
    try {
      const places = await fetchFromOverpass(query);
      if (places.length) return { places, radiusUsed: radius };
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) throw lastErr;
  return { places: [], radiusUsed: CATEGORY_SEARCH_RADII_M[CATEGORY_SEARCH_RADII_M.length - 1] };
}

// Carpark uses the same live LTA DataMall feed as the "near destination"
// panel on the Directions tab (see fetchParkingInfo) instead of OpenStreetMap
// — real available-lot counts refreshed roughly every minute, not just a
// pin. Shaped to match fetchCategoryPlaces' { places, radiusUsed } return so
// it can drop straight into the same rendering pipeline below.
async function fetchNearbyCarparks(lat, lon) {
  const res = await fetch(`/api/carparks-nearby?lat=${lat}&lon=${lon}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Carpark availability responded ${res.status}`);
  const places = (data.carparks || []).map((c) => ({
    label: c.development || 'Carpark',
    address: `${c.availableLots} lot${c.availableLots === 1 ? '' : 's'} available`,
    lat: c.lat,
    lon: c.lon,
  }));
  return { places, radiusUsed: null };
}

// Pet cafes come from Waypoint's own curated list (indoor/outdoor confirmed by
// hand, closed cafes auto-hidden via Google Maps) rather than OpenStreetMap.
// Shaped to match fetchCategoryPlaces' { places, radiusUsed }. The address
// line carries the dining/animal tags, and the shared renderer appends the
// distance.
function petCafeTodayHours(hours) {
  if (!hours || !hours.length) return '';
  const day = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Singapore' });
  const line = hours.find((h) => h.startsWith(day));
  return line ? `🕒 ${line.replace(/^[A-Za-z]+:\s*/, '')}` : '';
}
// Singapore mobiles (8xxx / 9xxx xxxx) can open a WhatsApp chat; landlines (6xxx) can't,
// so those just dial. Returns { text, href } or null.
// Same idea as petCafeContact() below, but WhatsApp-only (a guide enquiry
// isn't a phone call) and with its own pre-filled message naming the guide
// and the landmark, so the guide opens the chat already knowing who's
// asking and about what. Returns a wa.me URL, or null when there's no
// usable SG mobile number on file (the button then just doesn't render).
function guideContact(whatsapp, guideName, landmarkLabel) {
  const digits = String(whatsapp || '').replace(/\D/g, '').replace(/^65(?=\d{8}$)/, '');
  if (!/^[89]\d{7}$/.test(digits)) return null;
  const msg = encodeURIComponent(`Hi ${guideName}, I'm exploring ${landmarkLabel} on Waypoint and would like to book a guided walk.`);
  return `https://wa.me/65${digits}?text=${msg}`;
}

function petCafeContact(phone) {
  const digits = String(phone || '').replace(/\D/g, '').replace(/^65(?=\d{8}$)/, '');
  if (!digits) return null;
  const nb = (s) => s.replace(/ /g, ' ');
  if (/^[89]\d{7}$/.test(digits)) {
    const msg = encodeURIComponent('Hi, are you open today?');
    return { text: `💬 ${nb(phone)}`, href: `https://wa.me/65${digits}?text=${msg}`, external: true };
  }
  // Singapore toll-free numbers (1800 XXX XXXX, e.g. Apple Store's support
  // lines) are dialed locally as-is — prefixing +65 in front of "1800"
  // isn't how they're reached.
  const href = digits.startsWith('1800') ? `tel:${digits}` : `tel:+65${digits}`;
  return { text: `📞 ${nb(phone)}`, href };
}
const PET_CAFE_DINE = { petcafe: '', petcafeopen: '', petcafeoutdoor: 'outdoor', petcafeindoor: 'indoor' };
async function fetchNearbyPetCafes(category, lat, lon) {
  const dine = PET_CAFE_DINE[category];
  const res = await fetch(`/api/pet-cafes-nearby?lat=${lat}&lon=${lon}${dine ? `&dine=${dine}` : ''}${category === 'petcafeopen' ? '&open=1' : ''}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Pet cafes responded ${res.status}`);
  const places = (data.cafes || []).map((c) => {
    const tags = [c.openNow === true && '🟢 Open now', c.verified === false && '⚠️ Unverified', c.hasIndoor && 'Indoor', c.hasOutdoor && 'Outdoor', ...(c.animals || [])].filter(Boolean);
    // Non-breaking spaces keep "8778 5768" and "11:30 AM – 8:30 PM" from splitting across lines.
    const nb = (s) => String(s).replace(/ /g, '\u00a0');
    const contact = petCafeContact(c.phone);
    const info = [petCafeTodayHours(c.hours) && nb(petCafeTodayHours(c.hours)), contact].filter(Boolean);
    const plain = (x) => (typeof x === 'string' ? x : x.text);
    return { label: c.label, address: [...tags, ...info].map(plain).join(' · '), details: [tags, info], contact, lat: c.lat, lon: c.lon };
  });
  return { places, radiusUsed: null };
}

// Anytime Fitness branches: a manually sourced (not OSM/Overpass) dataset,
// same reasoning as pet cafes — see /api/anytime-fitness-nearby in server.js.
// Reuses petCafeContact (despite the name, it's just phone -> WhatsApp/tel
// link logic) so gym numbers get the same tappable treatment.
async function fetchNearbyAnytimeFitness(lat, lon) {
  const res = await fetch(`/api/anytime-fitness-nearby?lat=${lat}&lon=${lon}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Anytime Fitness responded ${res.status}`);
  const places = (data.gyms || []).map((g) => {
    const contact = petCafeContact(g.phone);
    const plain = (x) => (typeof x === 'string' ? x : x.text);
    const info = [contact].filter(Boolean);
    return {
      label: g.name,
      address: [g.address, ...info].map(plain).join(' · '),
      details: [[], info],
      contact,
      lat: g.lat,
      lon: g.lon,
    };
  });
  return { places, radiusUsed: null };
}

// Apple's own 3 Singapore retail stores — see /api/apple-stores-nearby.
async function fetchNearbyAppleStores(lat, lon) {
  const res = await fetch(`/api/apple-stores-nearby?lat=${lat}&lon=${lon}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Apple Store responded ${res.status}`);
  const places = (data.stores || []).map((s) => {
    const contact = petCafeContact(s.phone);
    const plain = (x) => (typeof x === 'string' ? x : x.text);
    const info = [contact].filter(Boolean);
    return {
      label: s.name,
      address: [s.address, ...info].map(plain).join(' · '),
      details: [[], info],
      contact,
      lat: s.lat,
      lon: s.lon,
    };
  });
  return { places, radiusUsed: null };
}

// Every MRT/LRT station within 5km, tagged with the line(s) it serves — see
// /api/mrt-stations-nearby. Unlike the other Nearby categories above this
// isn't a fixed dataset; it's a live query against the same OTP transit
// graph /api/transit-plan uses, so a new line or station shows up
// automatically with no data file to maintain.
async function fetchNearbyMrtStations(lat, lon) {
  const res = await fetch(`/api/mrt-stations-nearby?lat=${lat}&lon=${lon}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `MRT/LRT stations responded ${res.status}`);
  const places = (data.stations || []).map((s) => {
    // Colored line-badge chips, same look as the transit-directions line
    // badges (lineBadge/MRT_LINE_NAMES) — color/textColor come straight from
    // the live GTFS feed via the server, with a plain fallback if a build of
    // the transit router doesn't expose them.
    const lines = (s.routes || []).map((r) => ({
      text: r.code,
      bg: r.color ? `#${r.color}` : '#666',
      color: r.textColor ? `#${r.textColor}` : contrastTextColor(r.color),
      badge: true,
      title: MRT_LINE_NAMES[r.code] || undefined,
    }));
    return {
      label: s.name,
      address: `${s.mode} station`,
      details: [lines, []],
      lat: s.lat,
      lon: s.lon,
    };
  });
  return { places, radiusUsed: null };
}

// Guards against a slow, stale category search overwriting a newer one's
// results. Overpass (especially the kumi.systems mirror) can be slow or time
// out — confirmed live, not hypothetical — and each tap here fires a fresh,
// independent async chain with no cancellation of whatever's already in
// flight. Without this guard, tapping e.g. Hospital then quickly Vets could
// let the (slower) Hospital response land AFTER the Vets one and silently
// replace the correct vet results with hospital ones, even though the Vets
// chip is the one showing as tapped — exactly the "right chip, wrong
// results" bug this fixes. Every call gets a ticket; a response only
// touches the DOM if its ticket is still the latest one issued.
let categorySearchToken = 0;

function searchNearbyCategory(category) {
  if (!navigator.geolocation) {
    showToast('Geolocation is not supported by your browser.');
    return;
  }
  const myToken = ++categorySearchToken;
  const isStale = () => myToken !== categorySearchToken;

  els.placeCard.classList.add('hidden');
  els.attractionInfo.classList.add('hidden');
  els.attractionInfo.innerHTML = '';
  els.searchResults.innerHTML = '<li class="r-loading">Finding your location…</li>';
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      if (isStale()) return;
      els.searchResults.innerHTML = `<li class="r-loading">Searching nearby ${CATEGORY_LABELS[category]}…</li>`;
      try {
        const { latitude: lat, longitude: lon } = pos.coords;
        const { places, radiusUsed } = category === 'carpark'
          ? await fetchNearbyCarparks(lat, lon)
          : category in PET_CAFE_DINE
          ? await fetchNearbyPetCafes(category, lat, lon)
          : category === 'anytimefitness'
          ? await fetchNearbyAnytimeFitness(lat, lon)
          : category === 'applestore'
          ? await fetchNearbyAppleStores(lat, lon)
          : category === 'mrtstations'
          ? await fetchNearbyMrtStations(lat, lon)
          : await fetchCategoryPlaces(category, lat, lon, (radius) => {
              if (!isStale()) els.searchResults.innerHTML = `<li class="r-loading">Searching within ${formatDistance(radius)}…</li>`;
            });
        if (isStale()) return; // a newer category tap has already taken over the results list
        if (!places.length) {
          els.searchResults.innerHTML = '';
          showToast(radiusUsed
            ? `No ${CATEGORY_LABELS[category]} found within ${formatDistance(radiusUsed)}.`
            : `No ${CATEGORY_LABELS[category]} found nearby.`, 5000);
          return;
        }
        const mapped = places
          .map((p) => ({ ...p, distanceMeters: Math.round(haversineMeters(lat, lon, p.lat, p.lon)) }))
          .sort((a, b) => a.distanceMeters - b.distanceMeters)
          .slice(0, category in PET_CAFE_DINE || category === 'anytimefitness' || category === 'applestore' || category === 'mrtstations' ? 100 : 8)
          .map((r) => ({
            label: r.label,
            address: r.address ? `${r.address} · ${formatDistance(r.distanceMeters)}` : formatDistance(r.distanceMeters),
            ...(r.details ? { details: [[...r.details[0], formatDistance(r.distanceMeters)], r.details[1]] } : {}),
            ...(r.contact ? { contact: r.contact } : {}),
            lat: r.lat,
            lon: r.lon,
          }));
        renderResultList(els.searchResults, mapped, (r) => selectSearchResult(r));
      } catch (err) {
        console.error('category search failed:', err);
        if (isStale()) return;
        els.searchResults.innerHTML = '';
        showToast(category === 'carpark' && err.message
          ? err.message
          : 'Could not search nearby places right now — OpenStreetMap\'s search may be unreachable.', 5000);
      }
    },
    (err) => {
      if (isStale()) return;
      els.searchResults.innerHTML = '';
      showToast(geoErrorMessage(err), 6000);
    },
    GEO_OPTIONS
  );
}

// A handful of chips are a single fixed landmark rather than "find the
// nearest X near me" — tapping one jumps straight to that place (no GPS
// fix needed first) using the same place-card + "Directions to here" flow
// as picking a normal search result.
const LANDMARKS = {
  mbs: { label: 'Marina Bay Sands', address: '10 Bayfront Ave, Singapore 018956', lat: 1.283927, lon: 103.860535 },
  gardensbythebay: { label: 'Gardens by the Bay', address: '18 Marina Gardens Dr, Singapore 018953', lat: 1.28160, lon: 103.86360 },
  sentosa: { label: 'Sentosa Island', address: 'Sentosa Gateway, Singapore', lat: 1.24940, lon: 103.83030 },
  uss: { label: 'Universal Studios Singapore', address: '8 Sentosa Gateway, Singapore 098269', lat: 1.25400, lon: 103.82380 },
  seaaquarium: { label: 'S.E.A. Aquarium', address: '8 Sentosa Gateway, Singapore 098269', lat: 1.25780, lon: 103.82030 },
  jewelchangi: { label: 'Jewel Changi Airport', address: '78 Airport Blvd, Singapore 819666', lat: 1.36030, lon: 103.98950 },
  // The airport itself (terminals), distinct from Jewel — this points at the
  // Aerodrome Reference Point roughly centred between T1-T4, a reasonable
  // "the airport in general" pin for someone flying out rather than visiting
  // Jewel specifically.
  changiairport: { label: 'Changi Airport', address: 'Airport Boulevard, Singapore 819643', lat: 1.36440, lon: 103.99150 },
  merlionpark: { label: 'Merlion Park', address: '1 Fullerton Rd, Singapore 049213', lat: 1.28680, lon: 103.85450 },
  sgflyer: { label: 'Singapore Flyer', address: '30 Raffles Ave, Singapore 039803', lat: 1.28930, lon: 103.86320 },
  sgzoo: { label: 'Singapore Zoo', address: '80 Mandai Lake Rd, Singapore 729826', lat: 1.40430, lon: 103.79300 },
  nightsafari: { label: 'Night Safari', address: '80 Mandai Lake Rd, Singapore 729826', lat: 1.40226, lon: 103.78789 },
  riverwonders: { label: 'River Wonders', address: '80 Mandai Lake Rd, Singapore 729826', lat: 1.40378, lon: 103.79414 },
  chinatown: { label: 'Chinatown', address: 'Chinatown, Singapore', lat: 1.28120, lon: 103.84430 },
  littleindia: { label: 'Little India', address: 'Little India, Singapore', lat: 1.30670, lon: 103.85180 },
  kampongglam: { label: 'Kampong Glam', address: 'Kampong Glam, Singapore', lat: 1.30210, lon: 103.85900 },
  // Singapore's colonial-era civic core, centred on the Padang -- same
  // area-style pin as Chinatown/Little India/Kampong Glam above rather than
  // one specific building, since "Civic District" itself isn't a single
  // address. See DISTRICT_COVERAGE below for the full list of what it spans
  // (National Gallery, Asian Civilisations Museum, St Andrew's Cathedral,
  // etc.) -- shown as an info tip on the place card since a first-time
  // visitor searching "Civic District" has no way to know that otherwise.
  civicdistrict: { label: 'Civic District', address: 'Civic District, Singapore', lat: 1.29056, lon: 103.85306 },
  // The old seat of the Malay kings, then colonial Government House --
  // pinned at the Fort Canning Centre building (also home to the Battle
  // Box), a real addressable point right in the park, rather than the park
  // boundary generally. Also has a DISTRICT_COVERAGE entry below for the
  // same reason as Civic District: several separate sights within a few
  // minutes' walk that a first-time visitor wouldn't otherwise know about.
  fortcanning: { label: 'Fort Canning Park', address: '51 Canning Rise, Singapore 179872', lat: 1.296182, lon: 103.846152 },
  clarkequay: { label: 'Clarke Quay', address: '3 River Valley Rd, Singapore 179024', lat: 1.28840, lon: 103.84650 },
  botanicgardens: { label: 'Singapore Botanic Gardens', address: '1 Cluny Rd, Singapore 259569', lat: 1.31380, lon: 103.81590 },
  nationalgallery: { label: 'National Gallery Singapore', address: "1 St Andrew's Rd, Singapore 178957", lat: 1.29030, lon: 103.85170 },
  artsciencemuseum: { label: 'ArtScience Museum', address: '6 Bayfront Ave, Singapore 018974', lat: 1.28620, lon: 103.85930 },
  esplanade: { label: 'Esplanade', address: '1 Esplanade Dr, Singapore 038981', lat: 1.28970, lon: 103.85580 },
  hawparvilla: { label: 'Haw Par Villa', address: '262 Pasir Panjang Rd, Singapore 118628', lat: 1.28220, lon: 103.78150 },
  eastcoastpark: { label: 'East Coast Park', address: 'East Coast Park, Singapore', lat: 1.30160, lon: 103.91240 },
  // The Causeway crossing into Johor Bahru — routes here the same as any
  // other landmark, then the app's own turn-by-turn takes over right up to
  // the checkpoint gantries (actual immigration/customs clearance is of
  // course outside anything a maps app can do).
  woodlandscheckpoint: { label: 'Woodlands Checkpoint (JB Causeway)', address: 'Woodlands Checkpoint, Singapore 738099', lat: 1.44780, lon: 103.76910 },
  // The Second Link crossing into Johor — better for Legoland/Puteri
  // Harbour or avoiding Causeway jams.
  tuascheckpoint: { label: 'Tuas Checkpoint (2nd Link)', address: '1 Jalan Tukang, Singapore 638357', lat: 1.34740, lon: 103.63670 },
  // ICA's main HQ building (Kallang) — passport/IC renewal, PR/EP/S Pass
  // applications, etc. Distinct from the two border checkpoints above.
  icabuilding: { label: 'ICA Building', address: '10 Kallang Rd, Singapore 208718', lat: 1.30570, lon: 103.86310 },
  // MOM Services Centre (Bendemeer) — work pass applications/renewals,
  // employment disputes/claims, foreign worker matters, etc.
  momservices: { label: 'MOM Services Centre', address: '1500 Bendemeer Rd, Singapore 339946', lat: 1.326422, lon: 103.869041 },
  // Nature/reservoir spots — requested together as a group (hiking + water
  // catchment parks), not just the two named first.
  macritchie: { label: 'MacRitchie Reservoir', address: 'MacRitchie Reservoir Park, Lornie Rd, Singapore', lat: 1.34140, lon: 103.82560 },
  // TreeTop Walk itself sits deep in the forest with no vehicle access — this
  // points at Venus Drive Car Park, the actual trailhead people drive/get
  // dropped off at to start the hike out to it.
  macritchietreetop: { label: 'MacRitchie TreeTop Walk (via Venus Drive)', address: 'Venus Drive Car Park, Singapore', lat: 1.34690, lon: 103.81680 },
  bukittimah: { label: 'Bukit Timah Hill', address: '177 Hindhede Dr, Singapore 589333', lat: 1.35200, lon: 103.77670 },
  lowerpeirce: { label: 'Lower Peirce Reservoir', address: 'Lower Peirce Reservoir Park, Singapore', lat: 1.36390, lon: 103.82830 },
  upperseletar: { label: 'Upper Seletar Reservoir', address: 'Upper Seletar Reservoir Park, Singapore', lat: 1.40580, lon: 103.81020 },
  bedokreservoir: { label: 'Bedok Reservoir', address: 'Bedok Reservoir Park, Singapore', lat: 1.33620, lon: 103.93190 },
  // Pulau Ubin has no vehicle/bridge access at all -- getting there means a
  // bumboat from Changi Point Ferry Terminal ($4/pax each way, departs on
  // demand 6am-7pm once 12 passengers are aboard), so -- same reasoning as
  // macritchietreetop above -- this points at the ferry terminal itself, the
  // actual place a visitor can be routed to by road, rather than a pin out on
  // the island that Directions could never reach. Chek Jawa Wetlands (free
  // entry, boardwalk open 9am-5pm) is a further ~3km/40min walk (or
  // bike/van hire) from Pulau Ubin's main jetty once there, so it's folded
  // into this one combined chip rather than given its own separate pin.
  pulauubin: { label: 'Pulau Ubin & Chek Jawa (via Changi Point Ferry Terminal)', address: '51 Lorong Bekukong, Singapore 499172', lat: 1.390871, lon: 103.987559 },
  // Gourmet Food — Singapore's most famous hawker centres and food markets,
  // the kind of "gourmet" food experience tourists specifically travel here
  // for (several Michelin-recognised stalls among them). Same fixed-landmark
  // pattern as Attractions/Tickets & Tours, not a live OSM category search,
  // since these are specific named destinations rather than "any restaurant
  // nearby".
  laupasat: { label: 'Lau Pa Sat', address: '18 Raffles Quay, Singapore 048582', lat: 1.280339, lon: 103.850463 },
  maxwellfood: { label: 'Maxwell Food Centre', address: '1 Kadayanallur St, Singapore 069184', lat: 1.280300, lon: 103.844400 },
  chinatownfoodcentre: { label: 'Chinatown Complex Food Centre', address: '335 Smith St, Singapore 050335', lat: 1.282300, lon: 103.843700 },
  newtonfoodcentre: { label: 'Newton Food Centre', address: '500 Clemenceau Ave North, Singapore 229495', lat: 1.312600, lon: 103.838200 },
  oldairportroad: { label: 'Old Airport Road Food Centre', address: '51 Old Airport Rd, Singapore 390051', lat: 1.308800, lon: 103.885700 },
  tiongbahrumarket: { label: 'Tiong Bahru Market', address: '30 Seng Poh Rd, Singapore 168898', lat: 1.284700, lon: 103.832200 },
  eastcoastlagoon: { label: 'East Coast Lagoon Food Village', address: '1220 East Coast Parkway, Singapore 468960', lat: 1.300900, lon: 103.931900 },
  amoystreet: { label: 'Amoy Street Food Centre', address: '7 Maxwell Rd, Singapore 069111', lat: 1.279900, lon: 103.846800 },
  // Added for the "Singapore Must-Eats" nearby-finder — dedicated, named
  // spots per dish rather than the generic hawker-centre landmarks above,
  // per request (link each dish to one specific, well-known place instead of
  // "nearest of a couple of food centres").
  jumboseafood: { label: 'Jumbo Seafood (Riverside Point)', address: '30 Merchant Rd, #01-01/02 Riverside Point, Singapore 058282', lat: 1.287900, lon: 103.846500 },
  laksa328: { label: '328 Katong Laksa', address: '51/53 East Coast Rd, Singapore 428770', lat: 1.304900, lon: 103.903600 },
  tiantianchickenrice: { label: 'Tian Tian Hainanese Chicken Rice (Maxwell Food Centre)', address: '1 Kadayanallur St, #01-10/11, Singapore 069184', lat: 1.280300, lon: 103.844400 },
  yakunkayatoast: { label: 'Ya Kun Kaya Toast (Far East Square)', address: '18 China St, #01-01 Far East Square, Singapore 049560', lat: 1.283500, lon: 103.847700 },
  songfabkt: { label: 'Song Fa Bak Kut Teh', address: '11 New Bridge Rd, Singapore 059383', lat: 1.287900, lon: 103.844800 },
  ahwoonnasilemak: { label: 'Ah Woon 源味 (Chinatown Complex Food Centre)', address: '335 Smith St, #02-150, Singapore 050335', lat: 1.282300, lon: 103.843700 },
};

// Tickets & Tours — affiliate booking links for landmarks that are actually
// paid, ticketed attractions (vs. free spots like Merlion Park or a park
// connector). Real KKday affiliate links (cid=26927), one search per
// attraction so each "Book Tickets" tap lands on relevant results instead of
// a generic list — ud1 is set per-attraction so KKday's own reporting can
// show which chip in the app is driving clicks. Keyed by the same LANDMARKS
// key so this drops straight into the existing attraction info panel with no
// new place-matching logic needed.
const KKDAY_AFFILIATE_CID = '26927';
// Gourmet Food landmarks link out to KKday's general Singapore restaurants/
// food-experiences listing rather than a per-hawker-centre search — hawker
// centres are free public places, not individually bookable KKday products,
// so a name-specific search (like TICKET_LINKS uses for paid attractions)
// would mostly come back empty. ud1 is still set per-landmark so KKday's
// reporting can show which Gourmet Food chip is driving clicks.
function kkdayFoodLink(trackingTag) {
  return `https://www.kkday.com/en-sg/category/sg-singapore/restaurants/list?cid=${KKDAY_AFFILIATE_CID}&ud1=Waypoint_${trackingTag}`;
}
const FOOD_LINKS = {
  laupasat: kkdayFoodLink('laupasat'),
  maxwellfood: kkdayFoodLink('maxwellfood'),
  chinatownfoodcentre: kkdayFoodLink('chinatownfoodcentre'),
  newtonfoodcentre: kkdayFoodLink('newtonfoodcentre'),
  oldairportroad: kkdayFoodLink('oldairportroad'),
  tiongbahrumarket: kkdayFoodLink('tiongbahrumarket'),
  eastcoastlagoon: kkdayFoodLink('eastcoastlagoon'),
  amoystreet: kkdayFoodLink('amoystreet'),
};

// What to actually order at each Gourmet Food landmark — tourists (unlike
// locals) don't already know which stall/dish a hawker centre is famous for,
// so this turns "here's a hawker centre" into an actual recommendation.
const FOOD_HIGHLIGHTS = {
  laupasat: 'Satay — the outdoor "Satay Street" fires up every evening',
  maxwellfood: 'Tian Tian Hainanese Chicken Rice',
  chinatownfoodcentre: "Liao Fan Hawker Chan's Michelin-starred soya sauce chicken rice",
  newtonfoodcentre: 'Satay and BBQ seafood — Singapore\'s most famous night hawker scene',
  oldairportroad: 'Char kway teow and Hokkien mee, local favourites away from the tourist crowds',
  tiongbahrumarket: 'Chwee kueh (steamed rice cakes) and classic local breakfast fare',
  eastcoastlagoon: 'BBQ seafood and stingray, eaten right by the beach',
  amoystreet: 'Budget-friendly rice and noodle stalls popular with the lunchtime office crowd',
};

// A short "did you know" info tip for every Guided Walk landmark, shown on
// the place card (see loadAttractionInfo below) right where the "Certified
// local guides" section also lives. Started with just Civic District and
// Fort Canning Park, whose names alone don't say what's actually there
// (several separate sub-attractions clustered around one area), then
// extended to every other Guided Walk chip too -- for the other district-
// style ones (Chinatown, Little India, Kampong Glam) it's the same "here's
// what's actually within a few minutes' walk" framing; for the single-site
// ones (Botanic Gardens, Haw Par Villa, Pulau Ubin & Chek Jawa) it's a
// quick highlight or a "this is actually two separate stops" clarification
// instead, since a coverage list doesn't fit a single attraction.
const DISTRICT_COVERAGE = {
  chinatown: "Buddha Tooth Relic Temple and Sri Mariamman Temple (Singapore's oldest Hindu temple) are 2 minutes apart on South Bridge Road; Maxwell Food Centre is a couple of blocks further, and Thian Hock Keng Temple a 5-min walk east on Telok Ayer Street.",
  littleindia: 'Sri Veeramakaliamman Temple, Tekka Centre (wet market and hawker food), Mustafa Centre (24-hour shopping) and the shophouses of Little India Arcade are all spread along and just off Serangoon Road, a 10-15 min walk end to end.',
  kampongglam: 'Sultan Mosque and the Malay Heritage Centre anchor the district, with the boutiques, cafes and murals of Haji Lane, Bussorah Street and Arab Street all within a couple of minutes’ walk of each other.',
  botanicgardens: "The National Orchid Garden, Jacob Ballas Children's Garden, Swan Lake and Symphony Lake are all within the gardens — Singapore's only UNESCO World Heritage Site.",
  hawparvilla: 'Home to over 1,000 statues and dioramas depicting Chinese mythology and folklore, including the famously graphic Ten Courts of Hell — built in 1937 by the Aw brothers of Tiger Balm, and free to enter.',
  civicdistrict: "National Gallery Singapore, the Asian Civilisations Museum, St Andrew's Cathedral, Old Parliament House, Victoria Theatre & Concert Hall, CHIJMES and Raffles Hotel are all a 5-10 min walk from the Padang.",
  fortcanning: 'The Battle Box (the underground WWII command bunker where the surrender of Singapore was decided) is inside the park itself; the Peranakan Museum, Old Hill Street Police Station and Central Fire Station are all a 4-6 min walk away.',
  pulauubin: "This chip's ferry pin is Changi Point Ferry Terminal — the boat lands on Pulau Ubin itself, and Chek Jawa Wetlands is a further ~3km (cycle or walk) from the main jetty. The German Girl Shrine and a disused granite quarry are also on the island.",
};

// Real, Singapore-scoped search URLs — copied directly from KKday's own site
// search (each carries a "destination=D-SG-xxxx" filter, which is what
// actually locks results to Singapore). The earlier version of this map was
// built by guessing at a URL pattern with only a category filter (tab_key)
// and no destination filter at all, which let unrelated results from other
// countries (Korea, Japan) slip in — this replaces every entry with a
// manually verified link.
const TICKET_LINKS = {
  mbs: 'https://www.kkday.com/en-sg/product/productlist/Marina%20Bay%20Sands%20SkyPark?destination=D-SG-4608&keyword=Marina%20Bay%20Sands%20SkyPark&currency=SGD&sort=prec&page=1&count=10&tab_key=CATEGORY_001,CATEGORY_018&cid=26927&ud1=MarinaBaySands',
  uss: 'https://www.kkday.com/en-sg/product/productlist/Universal%20Studios%20Singapore?destination=D-SG-4608,D-SG-6801,D-SG-4612,D-SG-4610,D-SG-8491,D-SG-4611,D-SG-4609&keyword=Universal%20Studios%20Singapore&currency=SGD&sort=prec&page=1&count=10&tab_key=CATEGORY_001,CATEGORY_018&cid=26927&ud1=UniversalStudios',
  gardensbythebay: 'https://www.kkday.com/en-sg/product/productlist/Gardens%20by%20the%20Bay?destination=D-SG-4608,D-SG-6801&keyword=Gardens%20by%20the%20Bay&currency=SGD&sort=prec&page=1&count=10&tab_key=CATEGORY_001,CATEGORY_018&cid=26927&ud1=GardensByThebay',
  sgzoo: 'https://www.kkday.com/en-sg/product/productlist/Singapore%20Zoo?destination=D-SG-4608,D-SG-4612,D-SG-6801,D-SG-4610,D-SG-8491,D-SG-4611,D-SG-4609&keyword=Singapore%20Zoo&currency=SGD&sort=prec&page=1&count=10&tab_key=CATEGORY_001,CATEGORY_018&cid=26927&ud1=SingaporeZoo',
  nightsafari: 'https://www.kkday.com/en-sg/product/productlist/Night%20Safari%20Singapore?destination=D-SG-4608,D-SG-6801,D-SG-4612,D-SG-4610,D-SG-8491,D-SG-4611,D-SG-4609&keyword=Night%20Safari%20Singapore&currency=SGD&sort=prec&page=1&count=10&tab_key=CATEGORY_001,CATEGORY_018&cid=26927&ud1=NightSafari',
  seaaquarium: 'https://www.kkday.com/en-sg/product/productlist/S.E.A.%20Aquarium?destination=D-SG-4610,D-SG-8491,D-SG-4612,D-SG-6801,D-SG-4609&keyword=S.E.A.%20Aquarium&currency=SGD&sort=prec&page=1&count=10&tab_key=CATEGORY_001,CATEGORY_018&cid=26927&ud1=SingaporeOceanarium',
  riverwonders: 'https://www.kkday.com/en-sg/product/productlist/River%20Wonders%20Singapore?destination=D-SG-4608,D-SG-6801,D-SG-4612,D-SG-4610,D-SG-8491,D-SG-4611,D-SG-4609&keyword=River%20Wonders%20Singapore&currency=SGD&sort=prec&page=1&count=10&tab_key=CATEGORY_001,CATEGORY_018&cid=26927&ud1=RiverWonders',
  sgflyer: 'https://www.kkday.com/en-sg/product/productlist/Singapore%20Flyer?destination=D-SG-4608,D-SG-6801,D-SG-4612,D-SG-4610,D-SG-8491,D-SG-4611,D-SG-4609&keyword=Singapore%20Flyer&currency=SGD&sort=prec&page=1&count=10&tab_key=CATEGORY_001,CATEGORY_018&cid=26927&ud1=SingaporeFlyers',
};

// "Book Online" — mostly KKday's own top-level categories (real affiliate
// links supplied directly, one per category, each already carrying its own
// ud1 tracking tag), not tied to any Singapore landmark. These chips don't
// do a place search at all — see the .category-chip click handler below,
// which opens data-link straight away for any chip that has one. "Transport"
// and "Souvenirs" from KKday's own category list aren't included — no link
// was given for those yet.
//
// "sistic" and "ticketmelon" are the exception: neither is an affiliate
// partner, and upcoming-concert listings change constantly, so rather than
// maintain our own (inevitably stale) list of shows, these link straight to
// each platform's own live listings -- same reasoning as the LTA MRT map
// link. They're two separate chips rather than one combined "Concerts" chip
// since each is its own site with its own listings -- SISTIC has a
// browsable Concerts genre page, but Ticketmelon doesn't have an equivalent
// single category URL (its listings are per-event/per-organizer), so that
// one links to its homepage instead.
//
// "carrental" is the same kind of exception: KKday's own car-rental page is a
// generic worldwide search landing page with no clear Singapore-specific
// listing, so rather than send people somewhere that might not even surface
// local pickup locations, this links straight to Hertz's Singapore site --
// a globally recognised brand with Changi Airport and downtown counters, so
// a visitor can book (and often reuse an existing Hertz account/status) the
// same way they would back home.
//
// "avengedsevenfold" is a one-off, time-limited promo chip for a single
// concert date (13 Oct 2026, Singapore Indoor Stadium -- Avenged Sevenfold's
// Asia Tour 2026, opened by Nene Royal fresh off her America's Got Talent
// Season 21 win) rather than an evergreen category. It links straight to the
// event's own BookMyShow.sg page -- no affiliate deal, same reasoning as the
// direct SISTIC link for Concerts. REMOVE THIS CHIP (and its CHIP_I18N entry
// + index.html button) once 13 Oct 2026 has passed; it has no ongoing
// relevance after the show.
//
// "f1singapore", unlike avengedsevenfold, IS an evergreen category, not a
// one-off -- the Singapore Grand Prix runs every year at Marina Bay Street
// Circuit (2026's race weekend: 9-11 Oct, race day Sun 11 Oct), and this
// links to F1's own official ticketing page for the Singapore round, which
// gets reused/updated for whichever year is currently on sale rather than
// pointing at a single dated event. No affiliate deal -- same direct-link
// reasoning as Concerts/Car Rental, since KKday doesn't sell F1 tickets.
//
// "ktmbtrain" links to KTMB's own official ticketing website rather than an
// app, deliberately: KTMB's old "KTMB Mobile" app was discontinued (Dec
// 2025) and replaced by a different app ("KITS Style"), which shows how
// quickly a hardcoded app-store link can go stale here -- the website at
// online.ktmb.com.my covers the same booking flow (ETS/Intercity, Komuter,
// and the JB Sentral-Woodlands Shuttle most SG visitors actually want) and
// works in any mobile browser with no install required. No affiliate deal,
// same direct-link reasoning as Concerts/F1/Car Rental.
const BOOK_ONLINE_LINKS = {
  sistic: 'https://www.sistic.com.sg/events?genre=64',
  ticketmelon: 'https://www.ticketmelon.com/',
  attractiontickets: 'https://www.kkday.com/en-sg/category/sg-singapore/attraction-tickets/list?cid=26927&ud1=AttractionTickets',
  daytours: 'https://www.kkday.com/en-sg/category/sg-singapore/day-tours/list?cid=26927&ud1=DayTours',
  cruisevacation: 'https://www.kkday.com/en-sg/category/sg-singapore/cruise-vacation/list?cid=26927&ud1=CruiseVacation',
  ferries: 'https://www.kkday.com/en-sg/category/sg-singapore/ferries/list?cid=26927&ud1=Ferries',
  ktmbtrain: 'https://online.ktmb.com.my/',
  airporttransfer: 'https://www.kkday.com/en-sg/category/sg-singapore/airport-transfers/list?cid=26927&ud1=AirportTransfer',
  accommodation: 'https://www.trip.com/t/RqV5cn2vNW2',
  simcards: 'https://www.kkday.com/en-sg/category/sg-singapore/wifi-sim-cards/list?cid=26927&ud1=SimCards',
  carrental: 'https://www.hertz.com.sg/sg/en',
  avengedsevenfold: 'https://bookmyshow.sg/en/events/avenged-sevenfold-asia-tour-2026/AVSEVENF',
  f1singapore: 'https://tickets.formula1.com/en/f1-3301-singapore',
};

// ---- Travel-agency / distribution-partner referral tagging -------------------
// A partner (e.g. a travel agency) hands tourists a link like
// /?ref=some-agency (as a QR code, printed in a welcome pack, etc). The
// server sets a long-lived, JS-readable "waypoint_ref" cookie on that first
// visit — see partnerRefTracking() in server.js — attributing the rest of the
// trip to that partner. From then on, every affiliate link tapped gets that
// partner's slug folded into KKday's own "ud1" free-text tracking param
// (rather than a brand-new query param KKday wouldn't recognize or report
// on), so partner performance shows up in KKday's own dashboard, filterable
// by ud1 — not just as a private visit counter in Waypoint's admin panel.
// Links with no ud1 param at all (the Trip.com accommodation shortlink) are
// returned unchanged — there's nothing to tag them with.
function getPartnerRefTag() {
  const match = document.cookie.match(/(?:^|; )waypoint_ref=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function tagAffiliateUrl(url) {
  if (!url) return url;
  const ref = getPartnerRefTag();
  if (!ref) return url;
  try {
    const parsed = new URL(url);
    const ud1 = parsed.searchParams.get('ud1');
    if (!ud1) return url;
    const safeTag = ref.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safeTag) return url;
    parsed.searchParams.set('ud1', `${ud1}_${safeTag}`);
    return parsed.toString();
  } catch (err) {
    return url; // malformed URL — fail safe rather than break the link
  }
}

// Category rows switched via tabs (Nearby / More Places / Tickets & Tours /
// Gourmet Food) instead of stacking all four rows at once — with four
// categories now, showing every row simultaneously pushed the actual search
// box/results down and felt cluttered. Only one row's chips show at a time;
// switching tabs never touches which chip was last tapped.
document.querySelectorAll('.category-group-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.category-group-tab').forEach((b) => b.classList.remove('active'));
    tab.classList.add('active');
    const group = tab.dataset.group;
    document.querySelectorAll('#categoryRow .category-row').forEach((row) => {
      row.classList.toggle('hidden', row.dataset.group !== group);
    });
    // Must-Eats is its own tab (not nested under Gourmet Food) — folding it
    // into a tab at all, rather than always showing on the home screen, is
    // what keeps the default view uncluttered.
    const mustEats = document.getElementById('mustEats');
    if (mustEats) mustEats.classList.toggle('hidden', group !== 'musteats');
    // Guided Walk is also its own tab, same reasoning as Must-Eats above.
    const guidedWalk = document.getElementById('guidedWalk');
    if (guidedWalk) guidedWalk.classList.toggle('hidden', group !== 'guidedwalk');
    // Tix & Tours is also its own tab/section now (was a plain chip row),
    // same reasoning as Must-Eats and Guided Walk above.
    const tixTours = document.getElementById('tixTours');
    if (tixTours) tixTours.classList.toggle('hidden', group !== 'tickets');
    // More Places' scenic entries got the same photo-card treatment, shown
    // alongside the handful of practical More Places chips (JB checkpoints,
    // ICA, MOM Services) that stayed plain since a photo card doesn't suit
    // them -- both live under the same "places" tab/group.
    const morePlacesCards = document.getElementById('morePlacesCards');
    if (morePlacesCards) morePlacesCards.classList.toggle('hidden', group !== 'places');
  });
});

document.querySelectorAll('.category-chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    const category = btn.dataset.category;
    // Book Online chips aren't places at all (Wi-Fi & SIM Cards, Cruise
    // Vacation, etc.) — they just open their KKday category page directly,
    // skipping the place-card/GPS-search flow entirely.
    const bookOnlineUrl = tagAffiliateUrl(BOOK_ONLINE_LINKS[category]);
    if (bookOnlineUrl) {
      window.open(bookOnlineUrl, '_blank', 'noopener,noreferrer');
    } else if (LANDMARKS[category]) {
      selectSearchResult(LANDMARKS[category]);
    } else {
      searchNearbyCategory(category);
    }
  });
});

// ---------- "4 Singapore Must-Eats" ----------
// A fixed shortlist of iconically-Singaporean dishes, each pointing at one or
// more curated landmarks known for it. Chicken Rice, Laksa and Chilli Crab
// each point at one specific, named stall/restaurant (Tian Tian at Maxwell,
// 328 Katong Laksa, Jumbo Seafood) per request, rather than the nearest of a
// couple of general hawker centres. Satay still picks whichever of Lau Pa
// Sat/Newton Food Centre is closer, since there's no single iconic satay
// stall the same way. "Find nearby" deliberately doesn't monetise directly —
// it just answers "what should I eat and where's the closest place for it",
// the same place-card + directions flow as every other landmark.
// Trimmed from an earlier 5-dish list (kaya toast and bak kut teh dropped,
// satay added) per request.
const MUST_EATS = [
  { id: 'satay', icon: '🍢', name: 'Satay', tagline: 'Grilled skewers with peanut dip', landmarks: ['laupasat', 'newtonfoodcentre'] },
  { id: 'chickenrice', icon: '🍗', name: 'Hainanese Chicken Rice', tagline: "Singapore's iconic comfort food", landmarks: ['tiantianchickenrice'] },
  { id: 'laksa', icon: '🍜', name: 'Laksa', tagline: 'Rich, spicy coconut curry noodles', landmarks: ['laksa328'] },
  { id: 'chillicrab', icon: '🦀', name: 'Chilli Crab', tagline: "Singapore's most famous seafood dish", landmarks: ['jumboseafood'] },
  { id: 'nasilemak', icon: '🍚', name: 'Nasi Lemak', tagline: 'Coconut rice with fried anchovies, egg & sambal', landmarks: ['ahwoonnasilemak'] },
];

function findNearestLandmark(candidateKeys, lat, lon) {
  return candidateKeys
    .filter((key) => LANDMARKS[key])
    .map((key) => ({ key, entry: LANDMARKS[key], distance: haversineMeters(lat, lon, LANDMARKS[key].lat, LANDMARKS[key].lon) }))
    .sort((a, b) => a.distance - b.distance)[0];
}

document.querySelectorAll('.must-eat-find-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const dish = MUST_EATS.find((d) => d.id === btn.closest('.must-eat-card').dataset.dish);
    if (!dish) return;
    const candidates = dish.landmarks.filter((key) => LANDMARKS[key]);
    if (candidates.length === 0) return;
    // Only one known spot for this dish — jump straight there, no need to
    // ask for location first (same as a single-landmark category chip).
    if (candidates.length === 1) {
      selectSearchResult(LANDMARKS[candidates[0]]);
      return;
    }
    if (!navigator.geolocation) {
      selectSearchResult(LANDMARKS[candidates[0]]);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const nearest = findNearestLandmark(candidates, pos.coords.latitude, pos.coords.longitude);
        selectSearchResult((nearest && nearest.entry) || LANDMARKS[candidates[0]]);
      },
      () => selectSearchResult(LANDMARKS[candidates[0]]),
      GEO_OPTIONS
    );
  });
});

// Tap-to-enlarge photo preview (touch devices only -- desktop already shows
// the photo on hover, see .must-eat-preview rules in style.css). Tapping a
// card pops its dish photo up full-size with a dimmed backdrop behind it;
// tapping the open card again, the backdrop, or another card closes/switches
// it. Clicks on the "Find nearby" button are left alone so they keep working
// as a plain button tap rather than also toggling the photo.
//
// Rotating/multi-photo cards: a .must-eat-preview can optionally carry a
// data-photos attribute -- a comma-separated list of image paths (the first
// one also goes in the plain src attribute so single-photo cards, which
// don't set data-photos at all, keep working exactly as before with zero
// extra markup). A card with 2+ photos cycles to the next one on each
// click/tap instead of immediately closing/doing nothing, so a dish that has
// more than one good photo (e.g. a stall's own promo shot plus a plain food
// photo) can show both without needing a second card. This lives on
// .must-eat-preview/.must-eat-card specifically -- Guided Walk/Tix &
// Tours/More Places keep their own single-photo-only parallel blocks for now.
function mustEatPhotoList(img) {
  if (!img) return [];
  const raw = img.dataset.photos || img.getAttribute('src') || '';
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : [];
}
function advanceMustEatPhoto(card) {
  const img = card.querySelector('.must-eat-preview');
  const photos = mustEatPhotoList(img);
  if (photos.length < 2) return false;
  const current = img.dataset.photoIndex ? parseInt(img.dataset.photoIndex, 10) : 0;
  const next = (current + 1) % photos.length;
  img.dataset.photoIndex = String(next);
  img.src = photos[next];
  return true;
}
const mustEatBackdrop = document.getElementById('mustEatBackdrop');
function closeAllMustEatPreviews() {
  document.querySelectorAll('.must-eat-card.is-open').forEach((c) => c.classList.remove('is-open'));
  if (mustEatBackdrop) mustEatBackdrop.classList.remove('visible');
}
document.querySelectorAll('.must-eat-card').forEach((card) => {
  card.addEventListener('click', (e) => {
    if (e.target.closest('.must-eat-find-btn')) return;
    if (!window.matchMedia('(hover: none), (pointer: coarse)').matches) {
      // Desktop/mouse: hover already reveals the preview, so a click here
      // doesn't need to open anything -- it just steps a multi-photo card to
      // its next image (a no-op for a single-photo card).
      advanceMustEatPhoto(card);
      return;
    }
    const alreadyOpen = card.classList.contains('is-open');
    if (alreadyOpen) {
      // Already open on a multi-photo card -- advance to the next photo
      // instead of closing, so repeated taps step through all of them.
      // A single-photo card falls through to the original close-on-retap.
      if (advanceMustEatPhoto(card)) return;
      closeAllMustEatPreviews();
      return;
    }
    closeAllMustEatPreviews();
    card.classList.add('is-open');
    if (mustEatBackdrop) mustEatBackdrop.classList.add('visible');
  });
});
if (mustEatBackdrop) mustEatBackdrop.addEventListener('click', closeAllMustEatPreviews);

// ---------- Guided Walk (self-guided walk cards with photo preview) ----------
// Replaces the old plain-chip grid under the "Guided Walk" tab -- same
// behaviour as before (tapping a place jumps straight to it via
// selectSearchResult, since these are all single, named LANDMARKS entries,
// not a nearby-search), just as a full card with a photo instead of a
// bare icon+label pill. The photo preview mechanism mirrors Must-Eats
// above exactly (hover reveal on desktop, tap-to-enlarge with a dimmed
// backdrop on touch) but is kept as its own parallel block so neither
// feature can accidentally break the other.
document.querySelectorAll('.guided-walk-find-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.closest('.guided-walk-card').dataset.landmark;
    if (LANDMARKS[key]) selectSearchResult(LANDMARKS[key]);
  });
});

const guidedWalkBackdrop = document.getElementById('guidedWalkBackdrop');
function closeAllGuidedWalkPreviews() {
  document.querySelectorAll('.guided-walk-card.is-open').forEach((c) => c.classList.remove('is-open'));
  if (guidedWalkBackdrop) guidedWalkBackdrop.classList.remove('visible');
}
document.querySelectorAll('.guided-walk-card').forEach((card) => {
  card.addEventListener('click', (e) => {
    if (e.target.closest('.guided-walk-find-btn')) return;
    if (!window.matchMedia('(hover: none), (pointer: coarse)').matches) return;
    const alreadyOpen = card.classList.contains('is-open');
    closeAllGuidedWalkPreviews();
    if (!alreadyOpen) {
      card.classList.add('is-open');
      if (guidedWalkBackdrop) guidedWalkBackdrop.classList.add('visible');
    }
  });
});
if (guidedWalkBackdrop) guidedWalkBackdrop.addEventListener('click', closeAllGuidedWalkPreviews);

// ---------- Tix & Tours (attraction cards with photo preview) ----------
// Replaces the old plain-chip grid under the "Tix & Tours" tab. Each card's
// "Book Tickets" button opens that attraction's real KKday link straight
// away (TICKET_LINKS[key], the same object loadAttractionInfo() already
// uses to render a ticket link inside a place card elsewhere) -- it does
// NOT navigate to the place card first. An earlier version routed through
// selectSearchResult(LANDMARKS[category]) instead (matching the old plain
// chip's fallback behavior), but that meant a button labelled "Book
// Tickets" actually just opened the map/place view, with the real ticket
// link only appearing a second or two later once that place card's async
// info panel finished loading -- easy to mistake for the link being broken.
// Opening TICKET_LINKS[key] directly here removes that indirection entirely.
// A card can have no .ticket-preview image yet (an attraction whose photo
// hasn't been sent) -- it just shows as a plain icon+name+button row with
// no hover/tap photo until one is added. Photo preview mechanism mirrors
// Must-Eats/Guided Walk exactly, kept as its own parallel block.
document.querySelectorAll('.ticket-find-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const category = btn.closest('.ticket-card').dataset.category;
    const url = tagAffiliateUrl(TICKET_LINKS[category]);
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else if (LANDMARKS[category]) {
      // Fail-safe only: every current Tix & Tours key has a TICKET_LINKS
      // entry, but if a future attraction is added without one yet, fall
      // back to the place card instead of the button doing nothing.
      selectSearchResult(LANDMARKS[category]);
    }
  });
});

const ticketBackdrop = document.getElementById('ticketBackdrop');
function closeAllTicketPreviews() {
  document.querySelectorAll('.ticket-card.is-open').forEach((c) => c.classList.remove('is-open'));
  if (ticketBackdrop) ticketBackdrop.classList.remove('visible');
}
document.querySelectorAll('.ticket-card').forEach((card) => {
  // Cards without a photo yet (uss/riverwonders/sgflyer for now) have no
  // .ticket-preview element -- skip the tap-to-enlarge behavior for those so
  // tapping them doesn't just darken the whole screen with nothing to show.
  if (!card.querySelector('.ticket-preview')) return;
  card.addEventListener('click', (e) => {
    if (e.target.closest('.ticket-find-btn')) return;
    if (!window.matchMedia('(hover: none), (pointer: coarse)').matches) return;
    const alreadyOpen = card.classList.contains('is-open');
    closeAllTicketPreviews();
    if (!alreadyOpen) {
      card.classList.add('is-open');
      if (ticketBackdrop) ticketBackdrop.classList.add('visible');
    }
  });
});
if (ticketBackdrop) ticketBackdrop.addEventListener('click', closeAllTicketPreviews);

// ---------- More Places (scenic entries as photo cards) ----------
// The scenic/attraction subset of the old "More Places" chip row (Sentosa,
// Clarke Quay, Merlion Park, the reservoirs, etc.) got the same photo-card
// treatment as Guided Walk/Tix & Tours; a handful of purely practical
// entries (JB checkpoints, ICA Building, MOM Services) stayed plain chips
// since a photo card doesn't suit them. "Explore" jumps straight to that
// landmark's place card via selectSearchResult -- these aren't bookable
// attractions like Tix & Tours, so there's no external link to open here,
// just the same navigation the old chip already did. Kept as its own
// parallel block (places-card/places-preview/places-find-btn/placesBackdrop)
// rather than reusing ticket-card's classes, same reasoning as elsewhere.
document.querySelectorAll('.places-find-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const category = btn.closest('.places-card').dataset.category;
    if (LANDMARKS[category]) selectSearchResult(LANDMARKS[category]);
  });
});

const placesBackdrop = document.getElementById('placesBackdrop');
function closeAllPlacesPreviews() {
  document.querySelectorAll('.places-card.is-open').forEach((c) => c.classList.remove('is-open'));
  if (placesBackdrop) placesBackdrop.classList.remove('visible');
}
document.querySelectorAll('.places-card').forEach((card) => {
  // Defensive, same as Tix & Tours: skip tap-to-enlarge for any card with no
  // photo yet rather than darkening the screen with nothing to show.
  if (!card.querySelector('.places-preview')) return;
  card.addEventListener('click', (e) => {
    if (e.target.closest('.places-find-btn')) return;
    if (!window.matchMedia('(hover: none), (pointer: coarse)').matches) return;
    const alreadyOpen = card.classList.contains('is-open');
    closeAllPlacesPreviews();
    if (!alreadyOpen) {
      card.classList.add('is-open');
      if (placesBackdrop) placesBackdrop.classList.add('visible');
    }
  });
});
if (placesBackdrop) placesBackdrop.addEventListener('click', closeAllPlacesPreviews);

// ---------- Language (UI chrome only) ----------
// Covers the app's own buttons/labels/menus and all category+landmark chip
// names — Singapore's four official languages, plus Japanese and Korean for
// two of Singapore's fastest-growing visitor markets. Search results
// themselves (restaurant names, street addresses from OneMap/OSM/LTA,
// turn-by-turn voice instructions, live weather/traffic text) come from
// those upstream sources as-is and aren't translated here.
const LANG_STORAGE_KEY = 'wp_lang';
const LANG_CYCLE = ['en', 'zh', 'ms', 'ta', 'ja', 'ko'];
const LANG_SHORT = { en: 'EN', zh: '中文', ms: 'BM', ta: 'TA', ja: '日本語', ko: '한국어' };
const LANG_HTML_TAG = { en: 'en', zh: 'zh-Hans', ms: 'ms', ta: 'ta', ja: 'ja', ko: 'ko' };

let currentLang = 'en';
try {
  const saved = localStorage.getItem(LANG_STORAGE_KEY);
  if (saved && LANG_CYCLE.includes(saved)) currentLang = saved;
} catch (err) { /* private-mode/blocked storage — default to English */ }

const I18N = {
  en: {
    tab_search: 'Search', tab_directions: 'Directions', tab_bus: '🚌 Bus Times',
    notify_title: 'Turn on train/traffic/haze alerts', where_am_i: 'Where am I',
    offline_banner: "You're offline — showing saved places & last-known data. Search, routing and live arrivals need a connection.",
    search_placeholder: 'Enter postal code, address, or place…', clear: 'Clear',
    category_nearby: 'Nearby', category_attractions: 'More Places', category_guidedwalk: 'Guided Walk', category_tickets: 'Tix & Tours', category_gourmet: 'Gourmet Food', category_musteats: 'Must-Eats', category_bookonline: 'Book Online',
    must_eats_title: '🇸🇬 5 Singapore Must-Eats', find_nearby: '📍 Find nearby',
    guided_walk_title: '🚶 Self-Guided Walks', guided_walk_explore: '🧭 Explore',
    tix_tours_title: '🎟️ Tix & Tours', places_explore: '🧭 Explore',
    directions_from_here: 'Directions from here', directions_to_here: 'Directions to here',
    set_home: '🏠 Set as Home', set_work: '💼 Set as Work',
    hint_search: 'Try searching for a landmark, street, or postal code.',
    quick_home: '🏠 Home', quick_work: '💼 Work',
    dir_from_placeholder: 'From — postal code, address, or place', dir_to_placeholder: 'To — postal code, address, or place',
    swap: 'Swap', mode_drive: 'Drive', mode_transit: 'Bus / MRT', mode_cycle: 'Cycle', mode_walk: 'Walk',
    get_directions: 'Get Directions', start_navigation: '▶️ Start Navigation',
    tab_planroute: '🗺️ Plan Route', planroute_intro: 'Pick any 3 places from Search — attractions, food, MRT stations, anything — and Waypoint works out the best order to visit them from where you are now.', planroute_add_destination: '+ Add Destination', planroute_picking_banner: 'Tap a place, or any category chip, to add it as a stop.', planroute_cancel: 'Cancel', planroute_plan_button: 'Plan My Route', planroute_total_prefix: 'Total (straight-line estimate):', planroute_my_location: 'My Location',
    car_parked: 'Car parked', tap_to_walk_back: 'Tap below to walk back to it', walk_to_car: 'Walk to my car',
    save_parking: '🅿️ Save my parking spot', nearby_stops: '📍 Stops near me',
    nearby_arrivals_title: 'Nearby',
    nearby_arrivals_hint: 'Turn on location to see live bus arrivals for stops near you.',
    fav_section_divider: 'Or save a specific stop to check anytime',
    attraction_loading: 'Loading nearby info…', attraction_walk_prefix: 'Walk', attraction_estimated: 'estimated',
    attraction_no_station: 'No MRT/LRT station nearby.', attraction_nearby_title: 'Nearby attractions',
    attraction_book_tickets: '🎟️ Book Tickets', attraction_explore_food: "🍽️ Explore More of Singapore's Melting Pot", attraction_try: 'Try:', attraction_guides_title: 'Certified local guides', attraction_guide_verified: 'Verified', attraction_guide_message: 'Secure a Guided Walk Booking', attraction_guide_sample: 'Sample profile — contact number not yet added', attraction_guide_availability: 'Check availability & book',
    fav_search_placeholder: 'Add a bus stop — code or name…',
    fav_empty_hint: 'Search for a bus stop above and add it to check live arrivals here anytime — no need to plan a trip first.',
    share_footer: '💙 Share this app if you find it useful', support_footer: '☕ Buy me a coffee — help keep Waypoint running',
    install_banner_text: '📲 Add Waypoint to your home screen for quick access', install: 'Install', not_now: 'Not now',
    alert_nudge_text: '🔔 Get notified about MRT/LRT disruptions and major traffic incidents?', alert_nudge_turn_on: 'Turn on',
    dismiss: 'Dismiss', ride_hailing_label: 'Or book a ride',
  },
  zh: {
    tab_search: '搜索', tab_directions: '路线', tab_bus: '🚌 巴士时间',
    notify_title: '开启地铁/交通/雾霾提醒', where_am_i: '我的位置',
    offline_banner: '您已离线 — 显示已保存的地点和最新数据。搜索、路线规划和实时到站信息需要网络连接。',
    search_placeholder: '输入邮区编号、地址或地点…', clear: '清除',
    category_nearby: '附近', category_attractions: '更多景点', category_tickets: '门票与观光团', category_gourmet: '特色美食', category_musteats: '必吃美食', category_bookonline: '在线预订',
    must_eats_title: '🇸🇬 5大新加坡必吃美食', find_nearby: '📍 附近寻找',
    guided_walk_title: '🚶 自助徒步游览', guided_walk_explore: '🧭 探索',
    tix_tours_title: '🎟️ 门票与观光团', places_explore: '🧭 探索',
    directions_from_here: '从这里出发', directions_to_here: '前往这里',
    set_home: '🏠 设为住家', set_work: '💼 设为公司',
    hint_search: '试试搜索地标、街道或邮区编号。',
    quick_home: '🏠 住家', quick_work: '💼 公司',
    dir_from_placeholder: '起点 — 邮区编号、地址或地点', dir_to_placeholder: '终点 — 邮区编号、地址或地点',
    swap: '互换', mode_drive: '驾车', mode_transit: '巴士 / 地铁', mode_cycle: '骑行', mode_walk: '步行',
    get_directions: '获取路线', start_navigation: '▶️ 开始导航',
    tab_planroute: '🗺️ 路线规划', planroute_intro: '从"搜索"中任选3个地点——景点、美食、地铁站,任何地方都可以——Waypoint会根据您目前的位置,为您规划最佳游览顺序。', planroute_add_destination: '+ 添加目的地', planroute_picking_banner: '点击一个地点,或任意分类图标,将其加入行程。', planroute_cancel: '取消', planroute_plan_button: '规划路线', planroute_total_prefix: '总距离(直线估算):', planroute_my_location: '我的位置',
    car_parked: '停车时间', tap_to_walk_back: '点击下方步行返回车辆位置', walk_to_car: '步行回到我的车',
    save_parking: '🅿️ 保存停车位置', nearby_stops: '📍 附近车站',
    nearby_arrivals_title: '附近',
    nearby_arrivals_hint: '开启定位以查看附近车站的实时到站时间。',
    fav_section_divider: '或保存特定车站以随时查看',
    attraction_loading: '正在加载附近信息…', attraction_walk_prefix: '步行', attraction_estimated: '预计',
    attraction_no_station: '附近没有地铁/轻轨站。', attraction_nearby_title: '附近景点',
    attraction_book_tickets: '🎟️ 预订门票', attraction_explore_food: '🍽️ 探索美食体验', attraction_try: '推荐：',
    fav_search_placeholder: '添加巴士车站 — 输入编号或名称…',
    fav_empty_hint: '在上方搜索巴士车站并添加，即可随时查看实时到站时间 — 无需先规划行程。',
    share_footer: '💙 如果觉得好用，欢迎分享给朋友', support_footer: '☕ 请我喝杯咖啡 — 支持 Waypoint 持续运作',
    install_banner_text: '📲 将 Waypoint 添加到主屏幕，方便快速使用', install: '安装', not_now: '暂不安装',
    alert_nudge_text: '🔔 接收地铁/轻轨故障和重大交通事故通知？', alert_nudge_turn_on: '开启',
    dismiss: '关闭', ride_hailing_label: '或预订叫车',
  },
  ms: {
    tab_search: 'Carian', tab_directions: 'Arah', tab_bus: '🚌 Waktu Bas',
    notify_title: 'Hidupkan makluman keretapi/trafik/jerebu', where_am_i: 'Di Mana Saya',
    offline_banner: 'Anda di luar talian — memaparkan tempat tersimpan & data terkini. Carian, laluan dan ketibaan langsung memerlukan sambungan internet.',
    search_placeholder: 'Masukkan poskod, alamat, atau tempat…', clear: 'Kosongkan',
    category_nearby: 'Berdekatan', category_attractions: 'Lebih Banyak Tempat', category_tickets: 'Tiket & Lawatan', category_gourmet: 'Makanan Gourmet', category_musteats: 'Makanan Wajib', category_bookonline: 'Tempah Dalam Talian',
    must_eats_title: '🇸🇬 5 Makanan Wajib Singapura', find_nearby: '📍 Cari berdekatan',
    guided_walk_title: '🚶 Lawatan Jalan Kaki Sendiri', guided_walk_explore: '🧭 Terokai',
    tix_tours_title: '🎟️ Tiket & Lawatan', places_explore: '🧭 Terokai',
    directions_from_here: 'Arah dari sini', directions_to_here: 'Arah ke sini',
    set_home: '🏠 Tetapkan sebagai Rumah', set_work: '💼 Tetapkan sebagai Tempat Kerja',
    hint_search: 'Cuba cari mercu tanda, jalan, atau poskod.',
    quick_home: '🏠 Rumah', quick_work: '💼 Tempat Kerja',
    dir_from_placeholder: 'Dari — poskod, alamat, atau tempat', dir_to_placeholder: 'Ke — poskod, alamat, atau tempat',
    swap: 'Tukar', mode_drive: 'Memandu', mode_transit: 'Bas / MRT', mode_cycle: 'Berbasikal', mode_walk: 'Berjalan kaki',
    get_directions: 'Dapatkan Arah', start_navigation: '▶️ Mula Navigasi',
    tab_planroute: '🗺️ Rancang Laluan', planroute_intro: 'Pilih mana-mana 3 tempat dari Carian — tarikan, makanan, stesen MRT, apa sahaja — dan Waypoint akan mencari susunan terbaik untuk melawatnya dari lokasi anda sekarang.', planroute_add_destination: '+ Tambah Destinasi', planroute_picking_banner: 'Ketik satu tempat, atau mana-mana cip kategori, untuk menambahkannya sebagai perhentian.', planroute_cancel: 'Batal', planroute_plan_button: 'Rancang Laluan Saya', planroute_total_prefix: 'Jumlah (anggaran garis lurus):', planroute_my_location: 'Lokasi Saya',
    car_parked: 'Kereta diletak', tap_to_walk_back: 'Ketik di bawah untuk berjalan kembali ke sana', walk_to_car: 'Berjalan ke kereta saya',
    save_parking: '🅿️ Simpan lokasi tempat letak kereta saya', nearby_stops: '📍 Perhentian berdekatan',
    nearby_arrivals_title: 'Berdekatan',
    nearby_arrivals_hint: 'Hidupkan lokasi untuk melihat ketibaan bas langsung bagi perhentian berdekatan.',
    fav_section_divider: 'Atau simpan perhentian tertentu untuk disemak bila-bila masa',
    attraction_loading: 'Memuatkan maklumat berdekatan…', attraction_walk_prefix: 'Berjalan kaki', attraction_estimated: 'anggaran',
    attraction_no_station: 'Tiada stesen MRT/LRT berdekatan.', attraction_nearby_title: 'Tempat menarik berdekatan',
    attraction_book_tickets: '🎟️ Tempah Tiket', attraction_explore_food: '🍽️ Terokai Pengalaman Makanan', attraction_try: 'Cuba:',
    fav_search_placeholder: 'Tambah perhentian bas — kod atau nama…',
    fav_empty_hint: 'Cari perhentian bas di atas dan tambahkannya untuk semak ketibaan langsung di sini bila-bila masa — tidak perlu rancang perjalanan dahulu.',
    share_footer: '💙 Kongsikan aplikasi ini jika berguna', support_footer: '☕ Belanja saya kopi — bantu kekalkan Waypoint berjalan',
    install_banner_text: '📲 Tambah Waypoint ke skrin utama untuk akses pantas', install: 'Pasang', not_now: 'Bukan sekarang',
    alert_nudge_text: '🔔 Dapatkan pemberitahuan tentang gangguan MRT/LRT dan insiden trafik besar?', alert_nudge_turn_on: 'Hidupkan',
    dismiss: 'Tutup', ride_hailing_label: 'Atau tempah kenderaan',
  },
  ta: {
    tab_search: 'தேடல்', tab_directions: 'வழிகள்', tab_bus: '🚌 பேருந்து நேரம்',
    notify_title: 'ரயில்/போக்குவரத்து/புகைமூட்ட எச்சரிக்கைகளை இயக்கு', where_am_i: 'நான் எங்கே',
    offline_banner: 'நீங்கள் ஆஃப்லைனில் உள்ளீர்கள் — சேமிக்கப்பட்ட இடங்கள் மற்றும் சமீபத்திய தரவு காட்டப்படுகிறது. தேடல், வழிகள் மற்றும் நேரலை வருகைக்கு இணைப்பு தேவை.',
    search_placeholder: 'அஞ்சல் குறியீடு, முகவரி அல்லது இடத்தை உள்ளிடவும்…', clear: 'அழி',
    category_nearby: 'அருகில்', category_attractions: 'மேலும் இடங்கள்', category_tickets: 'டிக்கெட் மற்றும் சுற்றுலாக்கள்', category_gourmet: 'ருசிகரமான உணவு', category_musteats: 'அவசிய உணவுகள்', category_bookonline: 'ஆன்லைனில் முன்பதிவு செய்யுங்கள்',
    must_eats_title: '🇸🇬 சிங்கப்பூரின் 5 அவசிய உணவுகள்', find_nearby: '📍 அருகில் தேடு',
    guided_walk_title: '🚶 சுய-வழிகாட்டப்பட்ட நடைப் பயணங்கள்', guided_walk_explore: '🧭 ஆராயுங்கள்',
    tix_tours_title: '🎟️ டிக்கெட் மற்றும் சுற்றுலாக்கள்', places_explore: '🧭 ஆராயுங்கள்',
    directions_from_here: 'இங்கிருந்து வழிகள்', directions_to_here: 'இங்கு வழிகள்',
    set_home: '🏠 வீடாக அமை', set_work: '💼 பணியிடமாக அமை',
    hint_search: 'ஒரு அடையாளம், தெரு அல்லது அஞ்சல் குறியீட்டைத் தேடிப் பாருங்கள்.',
    quick_home: '🏠 வீடு', quick_work: '💼 பணியிடம்',
    dir_from_placeholder: 'இருந்து — அஞ்சல் குறியீடு, முகவரி அல்லது இடம்', dir_to_placeholder: 'வரை — அஞ்சல் குறியீடு, முகவரி அல்லது இடம்',
    swap: 'மாற்று', mode_drive: 'ஓட்டுதல்', mode_transit: 'பேருந்து / எம்ஆர்டி', mode_cycle: 'சைக்கிள்', mode_walk: 'நடை',
    get_directions: 'வழிகளைப் பெறுக', start_navigation: '▶️ வழிகாட்டலைத் தொடங்கு',
    tab_planroute: '🗺️ பாதை திட்டமிடல்', planroute_intro: 'தேடலில் இருந்து ஏதேனும் 3 இடங்களைத் தேர்ந்தெடுக்கவும் — சுற்றுலா தலங்கள், உணவு, எம்ஆர்டி நிலையங்கள், எதுவும் — நீங்கள் இப்போது இருக்கும் இடத்திலிருந்து சிறந்த வழியை Waypoint கண்டறியும்.', planroute_add_destination: '+ இலக்கைச் சேர்க்க', planroute_picking_banner: 'ஒரு இடத்தை அல்லது எந்த வகை சின்னத்தையும் தட்டி, அதை நிறுத்தமாகச் சேர்க்கவும்.', planroute_cancel: 'ரத்துசெய்', planroute_plan_button: 'எனது பாதையைத் திட்டமிடு', planroute_total_prefix: 'மொத்தம் (நேர்கோட்டு மதிப்பீடு):', planroute_my_location: 'எனது இடம்',
    car_parked: 'கார் நிறுத்தப்பட்டது', tap_to_walk_back: 'அங்கு நடந்து செல்ல கீழே தட்டவும்', walk_to_car: 'எனது காருக்கு நடந்து செல்',
    save_parking: '🅿️ எனது பார்க்கிங் இடத்தைச் சேமி', nearby_stops: '📍 அருகிலுள்ள நிறுத்தங்கள்',
    nearby_arrivals_title: 'அருகில்',
    nearby_arrivals_hint: 'அருகிலுள்ள நிறுத்தங்களுக்கான நேரலை பேருந்து வருகைகளைக் காண இருப்பிடத்தை இயக்கவும்.',
    fav_section_divider: 'அல்லது எந்த நேரத்திலும் சரிபார்க்க ஒரு குறிப்பிட்ட நிறுத்தத்தைச் சேமிக்கவும்',
    attraction_loading: 'அருகிலுள்ள தகவல் ஏற்றப்படுகிறது…', attraction_walk_prefix: 'நடை தூரம்', attraction_estimated: 'மதிப்பீடு',
    attraction_no_station: 'அருகில் எம்ஆர்டி/எல்ஆர்டி நிலையம் இல்லை.', attraction_nearby_title: 'அருகிலுள்ள சுற்றுலா தளங்கள்',
    attraction_book_tickets: '🎟️ டிக்கெட் முன்பதிவு செய்யுங்கள்', attraction_explore_food: '🍽️ உணவு அனுபவங்களைக் காணுங்கள்', attraction_try: 'சுவைக்க வேண்டியது:',
    fav_search_placeholder: 'பேருந்து நிறுத்தத்தைச் சேர் — குறியீடு அல்லது பெயர்…',
    fav_empty_hint: 'மேலே ஒரு பேருந்து நிறுத்தத்தைத் தேடி சேர்த்து, எப்போது வேண்டுமானாலும் நேரலை வருகையைச் சரிபார்க்கலாம் — முதலில் பயணத்தைத் திட்டமிட வேண்டியதில்லை.',
    share_footer: '💙 இது பயனுள்ளதாக இருந்தால் இந்த ஆப்பைப் பகிரவும்', support_footer: '☕ எனக்கு ஒரு காபி வாங்கிக் கொடுங்கள் — Waypoint செயல்பட உதவுங்கள்',
    install_banner_text: '📲 விரைவு அணுகலுக்காக Waypoint-ஐ உங்கள் முகப்புத் திரையில் சேர்க்கவும்', install: 'நிறுவு', not_now: 'இப்போது வேண்டாம்',
    alert_nudge_text: '🔔 MRT/LRT தடங்கல்கள் மற்றும் பெரிய போக்குவரத்து சம்பவங்கள் குறித்து அறிவிப்பு பெற விரும்புகிறீர்களா?', alert_nudge_turn_on: 'இயக்கு',
    dismiss: 'மூடு', ride_hailing_label: 'அல்லது ஒரு வாகனத்தை முன்பதிவு செய்யுங்கள்',
  },
  ja: {
    tab_search: '検索', tab_directions: 'ルート', tab_bus: '🚌 バス時刻',
    notify_title: '電車・交通・ヘイズ情報の通知をオンにする', where_am_i: '現在地',
    offline_banner: 'オフラインです — 保存された場所と最新データを表示しています。検索、ルート案内、リアルタイム到着情報には接続が必要です。',
    search_placeholder: '郵便番号、住所、または場所を入力…', clear: 'クリア',
    category_nearby: '近く', category_attractions: 'その他のスポット', category_tickets: 'チケット＆ツアー', category_gourmet: 'グルメ', category_musteats: '必食グルメ', category_bookonline: 'オンライン予約',
    must_eats_title: '🇸🇬 シンガポール必食5選', find_nearby: '📍 近くを探す',
    guided_walk_title: '🚶 セルフガイドウォーク', guided_walk_explore: '🧭 探索する',
    tix_tours_title: '🎟️ チケット＆ツアー', places_explore: '🧭 探索する',
    directions_from_here: 'ここから出発', directions_to_here: 'ここへ向かう',
    set_home: '🏠 自宅に設定', set_work: '💼 職場に設定',
    hint_search: 'ランドマーク、通り、または郵便番号で検索してみてください。',
    quick_home: '🏠 自宅', quick_work: '💼 職場',
    dir_from_placeholder: '出発地 — 郵便番号、住所、または場所', dir_to_placeholder: '目的地 — 郵便番号、住所、または場所',
    swap: '入れ替え', mode_drive: '車', mode_transit: 'バス / MRT', mode_cycle: '自転車', mode_walk: '徒歩',
    get_directions: 'ルートを取得', start_navigation: '▶️ ナビ開始',
    tab_planroute: '🗺️ ルートプラン', planroute_intro: '検索から観光地、グルメ、MRT駅など好きな3か所を選ぶと、Waypointが現在地から回る最適な順番を提案します。', planroute_add_destination: '+ 目的地を追加', planroute_picking_banner: '場所やカテゴリーのアイコンをタップして、立ち寄り先として追加してください。', planroute_cancel: 'キャンセル', planroute_plan_button: 'ルートを計画', planroute_total_prefix: '合計(直線距離の目安):', planroute_my_location: '現在地',
    car_parked: '駐車済み', tap_to_walk_back: '下をタップして車まで歩いて戻る', walk_to_car: '車まで歩く',
    save_parking: '🅿️ 駐車位置を保存', nearby_stops: '📍 近くのバス停',
    nearby_arrivals_title: '近く',
    nearby_arrivals_hint: '近くの停留所のリアルタイムのバス到着状況を見るには位置情報をオンにしてください。',
    fav_section_divider: 'または特定のバス停を保存していつでも確認',
    attraction_loading: '近くの情報を読み込み中…', attraction_walk_prefix: '徒歩', attraction_estimated: '概算',
    attraction_no_station: '近くにMRT/LRT駅はありません。', attraction_nearby_title: '近くの観光スポット',
    attraction_book_tickets: '🎟️ チケットを予約', attraction_explore_food: '🍽️ グルメ体験を探す', attraction_try: 'おすすめ:',
    fav_search_placeholder: 'バス停を追加 — 番号または名前…',
    fav_empty_hint: '上でバス停を検索して追加すると、いつでもリアルタイムの到着時刻を確認できます — 先にルートを計画する必要はありません。',
    share_footer: '💙 便利だと思ったらこのアプリをシェアしてください', support_footer: '☕ コーヒーをおごる — Waypointの運営を支援',
    install_banner_text: '📲 Waypointをホーム画面に追加してすぐにアクセス', install: 'インストール', not_now: '今はしない',
    alert_nudge_text: '🔔 MRT/LRTの運行障害や重大な交通事故の通知を受け取りますか？', alert_nudge_turn_on: 'オンにする',
    dismiss: '閉じる', ride_hailing_label: 'または配車サービスを予約',
  },
  ko: {
    tab_search: '검색', tab_directions: '길찾기', tab_bus: '🚌 버스 도착 시간',
    notify_title: '열차/교통/실안개 알림 켜기', where_am_i: '내 위치',
    offline_banner: '오프라인 상태입니다 — 저장된 장소와 최신 데이터를 표시하고 있습니다. 검색, 경로 안내, 실시간 도착 정보에는 인터넷 연결이 필요합니다.',
    search_placeholder: '우편번호, 주소 또는 장소를 입력하세요…', clear: '지우기',
    category_nearby: '주변', category_attractions: '더 많은 장소', category_tickets: '티켓 & 투어', category_gourmet: '맛집', category_musteats: '필수 음식', category_bookonline: '온라인 예약',
    must_eats_title: '🇸🇬 싱가포르 필수 음식 5', find_nearby: '📍 근처에서 찾기',
    guided_walk_title: '🚶 셀프 가이드 도보 투어', guided_walk_explore: '🧭 둘러보기',
    tix_tours_title: '🎟️ 티켓 & 투어', places_explore: '🧭 둘러보기',
    directions_from_here: '여기서 출발', directions_to_here: '여기로 가기',
    set_home: '🏠 집으로 설정', set_work: '💼 직장으로 설정',
    hint_search: '랜드마크, 거리 또는 우편번호로 검색해 보세요.',
    quick_home: '🏠 집', quick_work: '💼 직장',
    dir_from_placeholder: '출발지 — 우편번호, 주소 또는 장소', dir_to_placeholder: '도착지 — 우편번호, 주소 또는 장소',
    swap: '전환', mode_drive: '운전', mode_transit: '버스 / MRT', mode_cycle: '자전거', mode_walk: '도보',
    get_directions: '경로 가져오기', start_navigation: '▶️ 내비게이션 시작',
    tab_planroute: '🗺️ 경로 계획', planroute_intro: '검색에서 명소, 음식점, MRT역 등 원하는 장소 3곳을 고르면, Waypoint가 현재 위치에서 방문하기 가장 좋은 순서를 알려드립니다.', planroute_add_destination: '+ 목적지 추가', planroute_picking_banner: '장소나 카테고리 아이콘을 탭하여 경유지로 추가하세요.', planroute_cancel: '취소', planroute_plan_button: '내 경로 계획하기', planroute_total_prefix: '총 거리(직선 거리 추정):', planroute_my_location: '내 위치',
    car_parked: '주차됨', tap_to_walk_back: '아래를 탭하여 차로 걸어서 돌아가기', walk_to_car: '내 차로 걸어가기',
    save_parking: '🅿️ 주차 위치 저장', nearby_stops: '📍 근처 정류장',
    nearby_arrivals_title: '근처',
    nearby_arrivals_hint: '근처 정류장의 실시간 버스 도착 정보를 보려면 위치 서비스를 켜세요.',
    fav_section_divider: '또는 특정 정류장을 저장해 언제든지 확인하세요',
    attraction_loading: '주변 정보를 불러오는 중…', attraction_walk_prefix: '도보', attraction_estimated: '예상',
    attraction_no_station: '근처에 MRT/LRT 역이 없습니다.', attraction_nearby_title: '주변 관광명소',
    attraction_book_tickets: '🎟️ 티켓 예매', attraction_explore_food: '🍽️ 맛집 체험 둘러보기', attraction_try: '추천 메뉴:',
    fav_search_placeholder: '버스 정류장 추가 — 번호 또는 이름…',
    fav_empty_hint: '위에서 버스 정류장을 검색해 추가하면 언제든지 실시간 도착 정보를 확인할 수 있습니다 — 먼저 경로를 계획할 필요가 없습니다.',
    share_footer: '💙 유용하다면 이 앱을 공유해 주세요', support_footer: '☕ 커피 한 잔 사주세요 — Waypoint 운영에 도움이 됩니다',
    install_banner_text: '📲 빠른 접근을 위해 Waypoint를 홈 화면에 추가하세요', install: '설치', not_now: '나중에',
    alert_nudge_text: '🔔 MRT/LRT 운행 장애 및 주요 교통사고 알림을 받으시겠습니까?', alert_nudge_turn_on: '켜기',
    dismiss: '닫기', ride_hailing_label: '또는 차량 예약하기',
  },
};

// Chip label translations, keyed by data-category. English values here match
// what's already hardcoded in index.html (used as the fallback / source of
// truth when a key is somehow missing from a language).
const CHIP_I18N = {
  carpark: { en: 'Carpark', zh: '停车场', ms: 'Tempat Letak Kereta', ta: 'கார் பார்க்கிங்', ja: '駐車場', ko: '주차장' },
  hospital: { en: 'Hospital', zh: '医院', ms: 'Hospital', ta: 'மருத்துவமனை', ja: '病院', ko: '병원' },
  police: { en: 'Police', zh: '警察局', ms: 'Balai Polis', ta: 'காவல் நிலையம்', ja: '警察署', ko: '경찰서' },
  vets: { en: 'Vets', zh: '兽医', ms: 'Doktor Haiwan', ta: 'கால்நடை மருத்துவர்', ja: '動物病院', ko: '동물병원' },
  toilets: { en: 'Toilets', zh: '洗手间', ms: 'Tandas', ta: 'கழிப்பறை', ja: 'トイレ', ko: '화장실' },
  vegetarian: { en: 'Vegetarian', zh: '素食', ms: 'Vegetarian', ta: 'சைவம்', ja: 'ベジタリアン', ko: '채식' },
  halal: { en: 'Halal', zh: '清真', ms: 'Halal', ta: 'ஹலால்', ja: 'ハラール', ko: '할랄' },
  mosque: { en: 'Mosque', zh: '清真寺', ms: 'Masjid', ta: 'மசூதி', ja: 'モスク', ko: '모스크' },
  church: { en: 'Church', zh: '教堂', ms: 'Gereja', ta: 'தேவாலயம்', ja: '教会', ko: '교회' },
  temple: { en: 'Temple', zh: '庙宇', ms: 'Kuil', ta: 'கோவில்', ja: '寺院', ko: '사원' },
  moneychanger: { en: 'Money Changer', zh: '找换店', ms: 'Penukar Wang', ta: 'பண மாற்று நிலையம்', ja: '両替所', ko: '환전소' },
  postoffice: { en: 'Post Office', zh: '邮局', ms: 'Pejabat Pos', ta: 'அஞ்சல் அலுவலகம்', ja: '郵便局', ko: '우체국' },
  library: { en: 'Library', zh: '图书馆', ms: 'Perpustakaan', ta: 'நூலகம்', ja: '図書館', ko: '도서관' },
  dogpark: { en: 'Dog Park', zh: '狗狗公园', ms: 'Taman Anjing', ta: 'நாய் பூங்கா', ja: 'ドッグパーク', ko: '반려견 공원' },
  towtruck: { en: 'Tow Truck', zh: '拖车服务', ms: 'Khidmat Tunda Kereta', ta: 'இழுவை வாகன சேவை', ja: 'レッカーサービス', ko: '견인 서비스' },
  petcafe: { en: 'Pet Cafes', zh: '宠物咖啡馆', ms: 'Kafe Haiwan', ta: 'செல்லப்பிராணி கஃபே', ja: 'ペットカフェ', ko: '펫 카페' },
  petcafeopen: { en: 'Pet Cafes · Open now', zh: '宠物咖啡馆 · 营业中', ms: 'Kafe Haiwan · Buka sekarang', ta: 'செல்லப்பிராணி கஃபே · இப்போது திறந்துள்ளது', ja: 'ペットカフェ · 営業中', ko: '펫 카페 · 영업 중' },
  petcafeoutdoor: { en: 'Pet Cafes · Outdoor', zh: '宠物咖啡馆 · 户外', ms: 'Kafe Haiwan · Luar', ta: 'செல்லப்பிராணி கஃபே · வெளிப்புறம்', ja: 'ペットカフェ · 屋外', ko: '펫 카페 · 야외' },
  petcafeindoor: { en: 'Pet Cafes · Indoor', zh: '宠物咖啡馆 · 室内', ms: 'Kafe Haiwan · Dalam', ta: 'செல்லப்பிராணி கஃபே · உட்புறம்', ja: 'ペットカフェ · 屋内', ko: '펫 카페 · 실내' },
  petgrooming: { en: 'Pet Grooming', zh: '宠物美容', ms: 'Dandanan Haiwan', ta: 'செல்லப்பிராணி அழகுபடுத்தல்', ja: 'ペットグルーミング', ko: '반려동물 미용' },
  anytimefitness: { en: 'Anytime Fitness', zh: 'Anytime Fitness', ms: 'Anytime Fitness', ta: 'Anytime Fitness', ja: 'エニタイムフィットネス', ko: '애니타임 피트니스' },
  applestore: { en: 'Apple Store', zh: 'Apple Store', ms: 'Apple Store', ta: 'Apple Store', ja: 'アップルストア', ko: '애플스토어' },
  mrtstations: { en: 'MRT/LRT Stations', zh: '地铁/轻轨站', ms: 'Stesen MRT/LRT', ta: 'எம்ஆர்டி/எல்ஆர்டி நிலையங்கள்', ja: 'MRT/LRT駅', ko: 'MRT/LRT 역' },
  mbs: { en: 'Marina Bay Sands', zh: '滨海湾金沙', ms: 'Marina Bay Sands', ta: 'மரீனா பே சாண்ட்ஸ்', ja: 'マリーナベイ・サンズ', ko: '마리나 베이 샌즈' },
  gardensbythebay: { en: 'Gardens by the Bay', zh: '滨海湾花园', ms: 'Gardens by the Bay', ta: 'கார்டன்ஸ் பை தி பே', ja: 'ガーデンズ・バイ・ザ・ベイ', ko: '가든스 바이 더 베이' },
  sentosa: { en: 'Sentosa Island', zh: '圣淘沙岛', ms: 'Pulau Sentosa', ta: 'செண்டோசா தீவு', ja: 'セントーサ島', ko: '센토사 섬' },
  uss: { en: 'Universal Studios', zh: '环球影城', ms: 'Universal Studios', ta: 'யுனிவர்சல் ஸ்டுடியோஸ்', ja: 'ユニバーサル・スタジオ', ko: '유니버설 스튜디오' },
  seaaquarium: { en: 'S.E.A. Aquarium', zh: '星耀水族馆', ms: 'Akuarium S.E.A.', ta: 'எஸ்.இ.ஏ. மீன்காட்சியகம்', ja: 'S.E.A.アクアリウム', ko: 'S.E.A. 아쿠아리움' },
  jewelchangi: { en: 'Jewel Changi', zh: '星耀樟宜', ms: 'Jewel Changi', ta: 'ஜூவல் சாங்கி', ja: 'ジュエル・チャンギ', ko: '주얼 창이' },
  changiairport: { en: 'Changi Airport', zh: '樟宜机场', ms: 'Lapangan Terbang Changi', ta: 'சாங்கி விமான நிலையம்', ja: 'チャンギ空港', ko: '창이공항' },
  merlionpark: { en: 'Merlion Park', zh: '鱼尾狮公园', ms: 'Taman Merlion', ta: 'மெர்லயன் பூங்கா', ja: 'マーライオン公園', ko: '멀라이언 파크' },
  sgflyer: { en: 'Singapore Flyer', zh: '新加坡摩天观景轮', ms: 'Singapore Flyer', ta: 'சிங்கப்பூர் ஃபிளையர்', ja: 'シンガポール・フライヤー', ko: '싱가포르 플라이어' },
  sgzoo: { en: 'Singapore Zoo', zh: '新加坡动物园', ms: 'Zoo Singapura', ta: 'சிங்கப்பூர் உயிரியல் பூங்கா', ja: 'シンガポール動物園', ko: '싱가포르 동물원' },
  nightsafari: { en: 'Night Safari', zh: '夜间野生动物园', ms: 'Night Safari', ta: 'நைட் சஃபாரி', ja: 'ナイトサファリ', ko: '나이트 사파리' },
  riverwonders: { en: 'River Wonders', zh: '河川生态园', ms: 'River Wonders', ta: 'ரிவர் வண்டர்ஸ்', ja: 'リバー・ワンダーズ', ko: '리버 원더스' },
  chinatown: { en: 'Chinatown', zh: '牛车水', ms: 'Chinatown', ta: 'சைனாடவுன்', ja: 'チャイナタウン', ko: '차이나타운' },
  littleindia: { en: 'Little India', zh: '小印度', ms: 'Little India', ta: 'லிட்டில் இந்தியா', ja: 'リトルインディア', ko: '리틀 인디아' },
  kampongglam: { en: 'Kampong Glam', zh: '甘榜格南', ms: 'Kampung Glam', ta: 'கம்போங் கிளாம்', ja: 'カンポングラム', ko: '캄퐁글램' },
  clarkequay: { en: 'Clarke Quay', zh: '克拉码头', ms: 'Clarke Quay', ta: 'கிளார்க் கீ', ja: 'クラークキー', ko: '클락키' },
  botanicgardens: { en: 'Botanic Gardens', zh: '植物园', ms: 'Kebun Botani', ta: 'தாவரவியல் பூங்கா', ja: 'シンガポール植物園', ko: '보타닉 가든' },
  nationalgallery: { en: 'National Gallery', zh: '国家美术馆', ms: 'Galeri Negara', ta: 'தேசிய கேலரி', ja: 'ナショナルギャラリー', ko: '내셔널 갤러리' },
  artsciencemuseum: { en: 'ArtScience Museum', zh: '艺术科学博物馆', ms: 'Muzium ArtScience', ta: 'ஆர்ட்சயின்ஸ் அருங்காட்சியகம்', ja: 'アートサイエンス・ミュージアム', ko: '아트사이언스 뮤지엄' },
  esplanade: { en: 'Esplanade', zh: '滨海艺术中心', ms: 'Esplanade', ta: 'எஸ்பிளனேட்', ja: 'エスプラネード', ko: '에스플러네이드' },
  hawparvilla: { en: 'Haw Par Villa', zh: '虎豹别墅', ms: 'Haw Par Villa', ta: 'ஹா பார் வில்லா', ja: 'ホーパー・ヴィラ', ko: '호파빌라' },
  eastcoastpark: { en: 'East Coast Park', zh: '东海岸公园', ms: 'Taman Pantai Timur', ta: 'கிழக்குக் கடற்கரைப் பூங்கா', ja: 'イーストコーストパーク', ko: '이스트코스트 공원' },
  woodlandscheckpoint: { en: 'To JB (Causeway)', zh: '前往新山（长堤）', ms: 'Ke JB (Tambak)', ta: 'ஜேபிக்கு (காஸ்வே)', ja: 'JBへ（コーズウェイ）', ko: 'JB로 (코즈웨이)' },
  tuascheckpoint: { en: 'To JB (2nd Link)', zh: '前往新山（第二通道）', ms: 'Ke JB (Laluan Kedua)', ta: 'ஜேபிக்கு (2வது இணைப்பு)', ja: 'JBへ（第2リンク）', ko: 'JB로 (2번째 링크)' },
  icabuilding: { en: 'ICA Building', zh: '移民与关卡局大厦', ms: 'Bangunan ICA', ta: 'ஐசிஏ கட்டிடம்', ja: 'ICAビル', ko: 'ICA 빌딩' },
  momservices: { en: 'MOM Services', zh: '人力部服务中心', ms: 'Perkhidmatan KSM', ta: 'MOM சேவைகள்', ja: 'MOMサービスセンター', ko: 'MOM 서비스센터' },
  macritchie: { en: 'MacRitchie Reservoir', zh: '麦里芝蓄水池', ms: 'Takungan MacRitchie', ta: 'மேக்ரிட்சி நீர்த்தேக்கம்', ja: 'マクリッチー貯水池', ko: '맥리치 저수지' },
  macritchietreetop: { en: 'TreeTop Walk', zh: '树梢吊桥', ms: 'TreeTop Walk', ta: 'ட்ரீடாப் வாக்', ja: 'ツリートップウォーク', ko: '트리톱 워크' },
  bukittimah: { en: 'Bukit Timah Hill', zh: '武吉知马山', ms: 'Bukit Timah', ta: 'புக்கிட் திமா மலை', ja: 'ブキティマヒル', ko: '부킷 티마 힐' },
  lowerpeirce: { en: 'Lower Peirce Reservoir', zh: '下白沙浮蓄水池', ms: 'Takungan Lower Peirce', ta: 'லோயர் பியர்ஸ் நீர்த்தேக்கம்', ja: 'ローワー・ピアース貯水池', ko: '로어 피어스 저수지' },
  upperseletar: { en: 'Upper Seletar Reservoir', zh: '上实里达蓄水池', ms: 'Takungan Upper Seletar', ta: 'அப்பர் செலெடார் நீர்த்தேக்கம்', ja: 'アッパー・セレター貯水池', ko: '어퍼 셀레타 저수지' },
  bedokreservoir: { en: 'Bedok Reservoir', zh: '勿洛蓄水池', ms: 'Takungan Bedok', ta: 'பேடோக் நீர்த்தேக்கம்', ja: 'ベドック貯水池', ko: '베독 저수지' },
  laupasat: { en: 'Lau Pa Sat', zh: '老巴刹', ms: 'Lau Pa Sat', ta: 'லாவ் பா சாட்', ja: 'ラオパサ', ko: '라오파삿' },
  maxwellfood: { en: 'Maxwell Food Centre', zh: '麦士威熟食中心', ms: 'Pusat Penjaja Maxwell', ta: 'மேக்ஸ்வெல் ஃபுட் சென்டர்', ja: 'マックスウェル・フードセンター', ko: '맥스웰 푸드센터' },
  chinatownfoodcentre: { en: 'Chinatown Complex Food Centre', zh: '牛车水大厦熟食中心', ms: 'Pusat Penjaja Chinatown Complex', ta: 'சைனாடவுன் காம்ப்ளக்ஸ் ஃபுட் சென்டர்', ja: 'チャイナタウン・コンプレックス・フードセンター', ko: '차이나타운 컴플렉스 푸드센터' },
  newtonfoodcentre: { en: 'Newton Food Centre', zh: '纽顿熟食中心', ms: 'Pusat Penjaja Newton', ta: 'நியூட்டன் ஃபுட் சென்டர்', ja: 'ニュートン・フードセンター', ko: '뉴턴 푸드센터' },
  oldairportroad: { en: 'Old Airport Road Food Centre', zh: '老机场路熟食中心', ms: 'Pusat Penjaja Old Airport Road', ta: 'ஓல்ட் ஏர்போர்ட் ரோடு ஃபுட் சென்டர்', ja: 'オールド・エアポート・ロード・フードセンター', ko: '올드 에어포트 로드 푸드센터' },
  tiongbahrumarket: { en: 'Tiong Bahru Market', zh: '中峇鲁市场', ms: 'Pasar Tiong Bahru', ta: 'டியோங் பாரு மார்க்கெட்', ja: 'ティオンバル・マーケット', ko: '티옹바루 마켓' },
  eastcoastlagoon: { en: 'East Coast Lagoon Food Village', zh: '东海岸潟湖美食村', ms: 'Kampung Makanan East Coast Lagoon', ta: 'ஈஸ்ட் கோஸ்ட் லகூன் ஃபுட் வில்லேஜ்', ja: 'イーストコースト・ラグーン・フードビレッジ', ko: '이스트코스트 라군 푸드빌리지' },
  amoystreet: { en: 'Amoy Street Food Centre', zh: '厦门街熟食中心', ms: 'Pusat Penjaja Amoy Street', ta: 'அமோய் ஸ்ட்ரீட் ஃபுட் சென்டர்', ja: 'アモイストリート・フードセンター', ko: '아모이 스트리트 푸드센터' },
  sistic: { en: 'SISTIC', zh: 'SISTIC', ms: 'SISTIC', ta: 'SISTIC', ja: 'SISTIC', ko: 'SISTIC' },
  ticketmelon: { en: 'Ticketmelon', zh: 'Ticketmelon', ms: 'Ticketmelon', ta: 'Ticketmelon', ja: 'Ticketmelon', ko: 'Ticketmelon' },
  attractiontickets: { en: 'Attraction Tickets', zh: '景点门票', ms: 'Tiket Tempat Menarik', ta: 'சுற்றுலா டிக்கெட்டுகள்', ja: 'アトラクションチケット', ko: '명소 티켓' },
  daytours: { en: 'Half/Full-day Tours', zh: '半日/全日游', ms: 'Lawatan Separuh/Sehari', ta: 'அரை நாள்/முழு நாள் சுற்றுலா', ja: '半日/日帰りツアー', ko: '반나절/종일 투어' },
  cruisevacation: { en: 'Cruise Vacation', zh: '邮轮假期', ms: 'Percutian Pelayaran', ta: 'கப்பல் பயண விடுமுறை', ja: 'クルーズ休暇', ko: '크루즈 여행' },
  ferries: { en: 'Ferries', zh: '渡轮', ms: 'Feri', ta: 'படகுகள்', ja: 'フェリー', ko: '페리' },
  ktmbtrain: { en: 'KTMB Train Tickets', zh: 'KTMB火车票', ms: 'Tiket Keretapi KTMB', ta: 'KTMB ரயில் டிக்கெட்டுகள்', ja: 'KTMB列車チケット', ko: 'KTMB 기차표' },
  airporttransfer: { en: 'Airport Transfer', zh: '机场接送', ms: 'Pemindahan Lapangan Terbang', ta: 'விமான நிலைய போக்குவரத்து', ja: '空港送迎', ko: '공항 이동 서비스' },
  accommodation: { en: 'Accommodation', zh: '住宿', ms: 'Penginapan', ta: 'தங்குமிடம்', ja: '宿泊', ko: '숙박' },
  simcards: { en: 'SIM & eSIM', zh: 'Wi-Fi与SIM卡', ms: 'Wi-Fi & Kad SIM', ta: 'வைஃபை & சிம் கார்டுகள்', ja: 'Wi-Fi＆SIMカード', ko: '와이파이 & 유심' },
  carrental: { en: 'Car Rental', zh: '租车', ms: 'Sewa Kereta', ta: 'கார் வாடகை', ja: 'レンタカー', ko: '렌터카' },
  avengedsevenfold: { en: 'Avenged Sevenfold ft. Nene Royal', zh: 'Avenged Sevenfold ft. Nene Royal', ms: 'Avenged Sevenfold ft. Nene Royal', ta: 'Avenged Sevenfold ft. Nene Royal', ja: 'アヴェンジド・セヴンフォールド feat. ネネ・ロイヤル', ko: '어벤지드 세븐폴드 feat. 네네 로열' },
  f1singapore: { en: 'F1 Singapore GP', zh: 'F1新加坡大奖赛', ms: 'F1 Grand Prix Singapura', ta: 'F1 சிங்கப்பூர் கிராண்ட் பிரிக்ஸ்', ja: 'F1シンガポールGP', ko: 'F1 싱가포르 그랑프리' },
};

function t(key) {
  return (I18N[currentLang] && I18N[currentLang][key]) || I18N.en[key] || key;
}

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.getAttribute('data-i18n')); });
  // Tab labels sit under their own icon (.tab-icon), so drop the emoji some
  // translations lead with — otherwise "🚌 Bus Times" would show the bus twice.
  document.querySelectorAll('.tab-label').forEach((el) => { el.textContent = el.textContent.replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, ''); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.getAttribute('data-i18n-placeholder')); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.getAttribute('data-i18n-title')); });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'))); });
  document.querySelectorAll('.category-chip').forEach((btn) => {
    const cat = btn.dataset.category;
    const entry = CHIP_I18N[cat];
    const label = entry && (entry[currentLang] || entry.en);
    if (!label) return;
    const iconEl = btn.querySelector('.category-chip-icon');
    btn.textContent = '';
    if (iconEl) btn.appendChild(iconEl);
    btn.appendChild(document.createTextNode(label));
  });
  if (els.langBtnText) els.langBtnText.textContent = LANG_SHORT[currentLang];
  document.documentElement.lang = LANG_HTML_TAG[currentLang] || 'en';
}

if (els.langBtn) {
  els.langBtn.addEventListener('click', () => {
    const idx = LANG_CYCLE.indexOf(currentLang);
    currentLang = LANG_CYCLE[(idx + 1) % LANG_CYCLE.length];
    try { localStorage.setItem(LANG_STORAGE_KEY, currentLang); } catch (err) { /* ignore */ }
    applyTranslations();
  });
}

applyTranslations();

els.dirFromHere.addEventListener('click', () => {
  if (!currentPlace) return;
  setFrom({ lat: parseFloat(currentPlace.lat), lon: parseFloat(currentPlace.lon), label: shortLabel(currentPlace) });
  switchToDirectionsTab();
});

els.dirToHere.addEventListener('click', () => {
  if (!currentPlace) return;
  setTo({ lat: parseFloat(currentPlace.lat), lon: parseFloat(currentPlace.lon), label: shortLabel(currentPlace) });
  switchToDirectionsTab();
});

// ---------- Home / Work quick locations ----------
// Saved once from a search result ("Set as Home"/"Set as Work"), then usable
// as a one-tap fill from the Directions panel — Home fills the "From" field
// (the common case of starting a trip from home) and Work fills "To" (the
// common case of heading to work), so tapping both in sequence gives a
// ready-to-go "Home → Work" route without retyping either address.

const HOME_KEY = 'waypoint_home';
const WORK_KEY = 'waypoint_work';

function loadQuickLocation(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || 'null');
    return raw && typeof raw.lat === 'number' && typeof raw.lon === 'number' ? raw : null;
  } catch (err) {
    console.error(err);
    return null;
  }
}

function saveQuickLocation(key, coords) {
  try {
    localStorage.setItem(key, JSON.stringify(coords));
  } catch (err) {
    console.error(err);
  }
}

function currentPlaceCoords() {
  if (!currentPlace) return null;
  const lat = typeof currentPlace.lat === 'string' ? parseFloat(currentPlace.lat) : currentPlace.lat;
  const lon = typeof currentPlace.lon === 'string' ? parseFloat(currentPlace.lon) : currentPlace.lon;
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
  return { lat, lon, label: shortLabel(currentPlace) };
}

function updateQuickButtons() {
  const home = loadQuickLocation(HOME_KEY);
  const work = loadQuickLocation(WORK_KEY);
  els.quickHomeBtn.classList.toggle('unset', !home);
  els.quickHomeBtn.title = home ? `Start from ${home.label}` : 'Not set yet — search a place, then "Set as Home"';
  els.quickWorkBtn.classList.toggle('unset', !work);
  els.quickWorkBtn.title = work ? `Directions to ${work.label}` : 'Not set yet — search a place, then "Set as Work"';
}

els.setHomeBtn.addEventListener('click', () => {
  const coords = currentPlaceCoords();
  if (!coords) return;
  saveQuickLocation(HOME_KEY, coords);
  updateQuickButtons();
  showToast('🏠 Home set!');
});

els.setWorkBtn.addEventListener('click', () => {
  const coords = currentPlaceCoords();
  if (!coords) return;
  saveQuickLocation(WORK_KEY, coords);
  updateQuickButtons();
  showToast('💼 Work set!');
});

function useQuickLocation(key, label, setter) {
  const loc = loadQuickLocation(key);
  if (!loc) {
    showToast(`Set your ${label} first — search a place, then tap "Set as ${label}".`);
    document.querySelector('.tab-btn[data-tab="search"]').click();
    return;
  }
  setter(loc);
  switchToDirectionsTab();
}

// Home fills "From" (you're usually starting a trip from home); Work fills
// "To" (you're usually heading to work) — tap both for a ready "Home → Work".
els.quickHomeBtn.addEventListener('click', () => useQuickLocation(HOME_KEY, 'Home', setFrom));
els.quickWorkBtn.addEventListener('click', () => useQuickLocation(WORK_KEY, 'Work', setTo));

// ---------- "My Parked Car" — remember where you left it ----------
// Saved locally only (never sent anywhere). Auto-saved the moment live
// driving navigation reaches your destination; can also be saved manually
// from the Favourites tab for trips driven without in-app navigation.

const PARKED_CAR_KEY = 'waypoint_parked_car';

function loadParkedCar() {
  try {
    const raw = JSON.parse(localStorage.getItem(PARKED_CAR_KEY) || 'null');
    return raw && typeof raw.lat === 'number' && typeof raw.lon === 'number' ? raw : null;
  } catch (err) {
    console.error(err);
    return null;
  }
}

function saveParkedCar(lat, lon) {
  try {
    localStorage.setItem(PARKED_CAR_KEY, JSON.stringify({ lat, lon, savedAt: Date.now() }));
  } catch (err) {
    console.error(err);
  }
  renderParkedCar();
}

function clearParkedCar() {
  try {
    localStorage.removeItem(PARKED_CAR_KEY);
  } catch (err) {
    console.error(err);
  }
  renderParkedCar();
}

function formatAgoLong(ms) {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.round(hrs / 24)} day(s) ago`;
}

function renderParkedCar() {
  const car = loadParkedCar();
  els.parkedCarCard.classList.toggle('hidden', !car);
  if (car) els.parkedCarAgo.textContent = formatAgoLong(car.savedAt);
}

function saveParkingSpotFromGeolocation(silent) {
  if (!navigator.geolocation) {
    if (!silent) showToast('Geolocation is not supported by your browser.');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      saveParkedCar(pos.coords.latitude, pos.coords.longitude);
      if (!silent) showToast('🅿️ Parking spot saved.');
    },
    (err) => {
      if (!silent) showToast(geoErrorMessage(err) + ' (needed to save your parking spot)');
    },
    GEO_OPTIONS
  );
}

els.saveParkingBtn.addEventListener('click', () => saveParkingSpotFromGeolocation(false));

els.parkedCarClearBtn.addEventListener('click', () => {
  clearParkedCar();
  showToast('Parking spot cleared.');
});

els.parkedCarDirectionsBtn.addEventListener('click', () => {
  const car = loadParkedCar();
  if (!car) return;
  if (!navigator.geolocation) {
    showToast('Geolocation is not supported by your browser.');
    return;
  }
  showToast('Locating you…');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      // GPS works fine offline, but the walking route itself comes from OSRM,
      // which needs a connection. Don't pre-check navigator.onLine here — it's
      // unreliable and can falsely report offline on a working connection.
      // getDirections() below already handles a genuine offline/failed fetch
      // reactively (straight-line distance + compass heading fallback), so
      // just always proceed and let it decide.
      setFrom({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: 'Your location' });
      setTo({ lat: car.lat, lon: car.lon, label: 'Your parked car' });
      selectedMode = 'walking';
      els.modeButtons.forEach((b) => b.classList.toggle('active', b.dataset.mode === 'walking'));
      switchToDirectionsTab();
      getDirections();
    },
    (err) => showToast(geoErrorMessage(err) + ' (needed to walk back to your car)'),
    GEO_OPTIONS
  );
});

renderParkedCar();

// ---------- Directions panel ----------

function setFrom(coords) {
  fromCoords = coords;
  els.fromInput.value = coords.label;
  maybeEnableDirections();
}

function setTo(coords) {
  toCoords = coords;
  els.toInput.value = coords.label;
  maybeEnableDirections();
}

function maybeEnableDirections() {
  els.getDirectionsBtn.disabled = !(fromCoords && toCoords);
}

// ---------- Plan a Route (multi-stop trip planner) ----------
// Lets a traveller pick any 3 places -- via the exact same Search tab flow
// used everywhere else (free-text search, a landmark chip, or a "nearby X"
// category result) -- and get back the best order to visit them in, starting
// from wherever they are right now.
//
// Ordering is decided using straight-line (haversine) distance between all
// 4 points (current location + 3 stops) rather than fetching a real route
// for all 6 possible visiting orders just to throw 5 of them away -- with
// only 3 stops this is a fine proxy for "which order is shortest" at
// Singapore's scale, it's instant, and it needs no network call that could
// fail. Once the order is decided, each leg still hands off to the real
// Directions tab (via the existing setFrom/setTo/getDirections plumbing) --
// so the actual walk/drive/transit route you're told to follow always comes
// from OSRM/OTP, never a straight line.
let routeDestinations = [null, null, null]; // each: { lat, lon, label } | null
let routePickingSlot = null; // 1 | 2 | 3 while the Search tab is filling a slot
let routeSelectedMode = 'transit';

function switchToSearchTab() {
  document.querySelector('.tab-btn[data-tab="search"]').click();
}

function switchToPlanRouteTab() {
  document.querySelector('.tab-btn[data-tab="planroute"]').click();
}

function renderRouteSlots() {
  document.querySelectorAll('.route-slot').forEach((btn) => {
    const slot = parseInt(btn.dataset.slot, 10);
    const dest = routeDestinations[slot - 1];
    btn.classList.toggle('filled', !!dest);
    btn.querySelector('.route-slot-label').textContent = dest ? dest.label : t('planroute_add_destination');
    btn.querySelector('.route-slot-clear').classList.toggle('hidden', !dest);
  });
  els.planRouteBtn.disabled = routeDestinations.some((d) => !d);
  // A stale plan from before a slot changed would otherwise keep showing a
  // route that no longer matches the current 3 destinations.
  els.routePlanResult.classList.add('hidden');
  els.routePlanResult.innerHTML = '';
}

function setRouteDestination(slot, r) {
  const label = shortLabel(r) || addressText(r) || t('planroute_add_destination');
  routeDestinations[slot - 1] = {
    lat: typeof r.lat === 'string' ? parseFloat(r.lat) : r.lat,
    lon: typeof r.lon === 'string' ? parseFloat(r.lon) : r.lon,
    label,
  };
  routePickingSlot = null;
  els.routePickingBanner.classList.add('hidden');
  els.searchResults.innerHTML = '';
  els.searchInput.value = '';
  els.searchClear.classList.remove('visible');
  switchToPlanRouteTab();
  renderRouteSlots();
  showToast(`Added "${label}" as Destination ${slot}.`, 3000);
}

document.querySelectorAll('.route-slot').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    const slot = parseInt(btn.dataset.slot, 10);
    if (e.target.classList.contains('route-slot-clear')) {
      routeDestinations[slot - 1] = null;
      renderRouteSlots();
      return;
    }
    routePickingSlot = slot;
    els.routePickingBanner.classList.remove('hidden');
    switchToSearchTab();
    els.searchInput.focus();
  });
});

els.routePickingCancelBtn.addEventListener('click', () => {
  routePickingSlot = null;
  els.routePickingBanner.classList.add('hidden');
  switchToPlanRouteTab();
});

document.querySelectorAll('.route-mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.route-mode-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    routeSelectedMode = btn.dataset.mode;
  });
});

// Brute-force is fine here -- 3 stops means only 3! = 6 possible visiting
// orders, trivial to check exhaustively rather than reaching for a real
// TSP heuristic that would be overkill at this size.
function permutationsOf3(arr) {
  const [a, b, c] = arr;
  return [
    [a, b, c], [a, c, b],
    [b, a, c], [b, c, a],
    [c, a, b], [c, b, a],
  ];
}

function bestVisitingOrder(start, destinations) {
  let best = null;
  permutationsOf3(destinations).forEach((order) => {
    let total = haversineMeters(start.lat, start.lon, order[0].lat, order[0].lon);
    total += haversineMeters(order[0].lat, order[0].lon, order[1].lat, order[1].lon);
    total += haversineMeters(order[1].lat, order[1].lon, order[2].lat, order[2].lon);
    if (!best || total < best.total) best = { order, total };
  });
  return best;
}

function renderRoutePlan(start, best) {
  const points = [start, ...best.order];
  const rows = best.order.map((dest, i) => {
    const from = points[i];
    const legMeters = haversineMeters(from.lat, from.lon, dest.lat, dest.lon);
    return `
      <div class="route-plan-leg">
        <div class="route-plan-leg-title"><span class="route-plan-leg-num">${i + 1}</span>${escapeHtml(dest.label)}</div>
        <div class="route-plan-leg-sub">${formatDistance(legMeters)} from ${escapeHtml(from.label)}</div>
        <button class="pill-btn route-plan-leg-btn" type="button" data-leg="${i}">${t('get_directions')}</button>
      </div>`;
  }).join('');

  els.routePlanResult.innerHTML = `${rows}<div class="route-plan-total">${t('planroute_total_prefix')} ${formatDistance(best.total)}</div>`;
  els.routePlanResult.classList.remove('hidden');

  els.routePlanResult.querySelectorAll('.route-plan-leg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.leg, 10);
      setFrom({ lat: points[i].lat, lon: points[i].lon, label: points[i].label });
      setTo({ lat: points[i + 1].lat, lon: points[i + 1].lon, label: points[i + 1].label });
      const modeBtn = document.querySelector(`.mode-btn[data-mode="${routeSelectedMode}"]`);
      if (modeBtn) modeBtn.click();
      switchToDirectionsTab();
      getDirections();
    });
  });
}

els.planRouteBtn.addEventListener('click', () => {
  if (routeDestinations.some((d) => !d)) return;
  if (!navigator.geolocation) {
    showToast('Geolocation is not supported by your browser.');
    return;
  }
  const originalLabel = els.planRouteBtn.textContent;
  els.planRouteBtn.disabled = true;
  els.planRouteBtn.textContent = '📍 Finding your location…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const start = { lat: pos.coords.latitude, lon: pos.coords.longitude, label: t('planroute_my_location') };
      renderRoutePlan(start, bestVisitingOrder(start, routeDestinations));
      els.planRouteBtn.disabled = false;
      els.planRouteBtn.textContent = originalLabel;
    },
    (err) => {
      showToast(geoErrorMessage(err));
      els.planRouteBtn.disabled = false;
      els.planRouteBtn.textContent = originalLabel;
    },
    GEO_OPTIONS
  );
});

// ---------- Rain awareness ----------
// Only relevant when the route includes actual time on foot (walking mode,
// or transit — which always has walk legs to/from stops). Checks the NEA
// 2-hour forecast near both ends of the trip and surfaces a banner if either
// is showing rain/showers.

function hideRainAlert() {
  els.rainBanner.classList.add('hidden');
}

function showRainAlert(text) {
  els.rainBannerText.textContent = text;
  els.rainBanner.classList.remove('hidden');
}

async function checkRainAlert(from, to) {
  hideRainAlert();
  if (!from || !to) return;
  try {
    const [fromWx, toWx] = await Promise.all([
      fetch(`/api/weather-nearby?lat=${from.lat}&lon=${from.lon}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/weather-nearby?lat=${to.lat}&lon=${to.lon}`).then((r) => (r.ok ? r.json() : null)),
    ]);
    const rainy = [fromWx, toWx].filter((w) => w && w.isRainy);
    if (!rainy.length) return;
    const areas = [...new Set(rainy.map((w) => w.area))].join(' & ');
    showRainAlert(`${rainy[0].forecast} near ${areas} — bring an umbrella for the walk!`);
  } catch (err) {
    console.error('rain check failed:', err);
  }
}

// Same idea as checkRainAlert above, but re-checked against your LIVE
// position while you're actually navigating on foot, so rain that develops
// mid-walk (not just what was forecast at your start/end points before you
// left) still gets surfaced. See NAV_RAIN_RECHECK_MS/navRainWarned above for
// why this is throttled and only fires once per navigation session.
async function checkNavRainProactive(lat, lon) {
  if (navRainWarned) return;
  if (selectedMode !== 'walking' && selectedMode !== 'transit') return;
  const now = Date.now();
  if (now - navLastRainCheckAt < NAV_RAIN_RECHECK_MS) return;
  navLastRainCheckAt = now;
  try {
    const wx = await fetch(`/api/weather-nearby?lat=${lat}&lon=${lon}`).then((r) => (r.ok ? r.json() : null));
    if (wx && wx.isRainy) {
      navRainWarned = true;
      showToast(`☔ ${wx.forecast} near ${wx.area} — you may want to find shelter.`, 7000);
    }
  } catch (err) {
    console.error('proactive nav rain check failed:', err);
  }
}

// One-time heads-up per camera as you actually approach it while driving —
// navSpeedCameras is the list matched against this route back in
// loadSpeedCameraInfo; navAlertedCameraIdxs tracks which ones this session
// has already announced so it doesn't repeat on every position tick.
const SPEED_CAMERA_ALERT_RADIUS_M = 500;

function checkNavSpeedCameras(lat, lon) {
  if (selectedMode !== 'driving' || !navSpeedCameras.length) return;
  navSpeedCameras.forEach((cam, i) => {
    if (navAlertedCameraIdxs.has(i)) return;
    if (haversineMeters(lat, lon, cam.lat, cam.lon) <= SPEED_CAMERA_ALERT_RADIUS_M) {
      navAlertedCameraIdxs.add(i);
      speakNav('Speed camera ahead.');
      showToast(`📷 Speed camera ahead — ${cam.location}`, 6000);
    }
  });
}

const runFromSearch = debounce(async (q) => {
  const results = await geocode(q);
  renderResultList(els.fromResults, results, (r) => {
    setFrom({ lat: parseFloat(r.lat), lon: parseFloat(r.lon), label: shortLabel(r) });
    els.fromResults.innerHTML = '';
  });
}, 350);

const runToSearch = debounce(async (q) => {
  const results = await geocode(q);
  renderResultList(els.toResults, results, (r) => {
    setTo({ lat: parseFloat(r.lat), lon: parseFloat(r.lon), label: shortLabel(r) });
    els.toResults.innerHTML = '';
  });
}, 350);

els.fromInput.addEventListener('input', (e) => {
  fromCoords = null;
  maybeEnableDirections();
  const v = e.target.value;
  if (v.length < 2) { els.fromResults.innerHTML = ''; return; }
  runFromSearch(v);
});

els.toInput.addEventListener('input', (e) => {
  toCoords = null;
  maybeEnableDirections();
  const v = e.target.value;
  if (v.length < 2) { els.toResults.innerHTML = ''; return; }
  runToSearch(v);
});

document.addEventListener('click', (e) => {
  if (!els.fromInput.contains(e.target)) els.fromResults.innerHTML = '';
  if (!els.toInput.contains(e.target)) els.toResults.innerHTML = '';
  // Tapping a category chip (🏥/🍽️/etc) lives outside both the search input
  // and the results list, so without this it would immediately wipe out the
  // "Finding your location…" text the same click was meant to trigger —
  // the search would then run with zero visible feedback until it either
  // finished or the person gave up waiting.
  const clickedCategoryChip = els.categoryRow && els.categoryRow.contains(e.target);
  if (!els.searchInput.contains(e.target) && !els.searchResults.contains(e.target) && !clickedCategoryChip) {
    els.searchResults.innerHTML = '';
  }
});

els.swapBtn.addEventListener('click', () => {
  const tmpCoords = fromCoords, tmpVal = els.fromInput.value;
  if (toCoords) setFrom(toCoords); else { fromCoords = null; els.fromInput.value = els.toInput.value; }
  if (tmpCoords) setTo(tmpCoords); else { toCoords = null; els.toInput.value = tmpVal; }
  maybeEnableDirections();
});

els.modeButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    els.modeButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedMode = btn.dataset.mode;
    if (selectedMode === 'cycling') {
      showCyclingExtra(); // instant, doesn't need a calculated route
    } else {
      els.cyclingExtra.classList.add('hidden');
      els.cyclingExtra.innerHTML = '';
    }
    // Switching mode (e.g. tapping "Bus & MRT" as the very first action after
    // setting From/To, before ever pressing "Get Directions") should fetch
    // that mode's route right away -- getDirections() already no-ops safely
    // if From/To aren't set, so there's no need to also require a route to
    // already exist. Previously this checked `&& hasRoute`, which meant the
    // very first mode click after entering From/To did nothing at all (the
    // button just highlighted) until "Get Directions" was pressed once --
    // read by users as needing to "click twice" for a route to appear.
    if (fromCoords && toCoords) {
      getDirections();
    }
  });
});

els.getDirectionsBtn.addEventListener('click', getDirections);

function hideDrivingExtras() {
  els.parkingInfo.classList.add('hidden');
  els.parkingInfo.innerHTML = '';
  els.evChargingInfo.classList.add('hidden');
  els.evChargingInfo.innerHTML = '';
  els.petrolInfo.classList.add('hidden');
  els.petrolInfo.innerHTML = '';
  els.erpInfo.classList.add('hidden');
  els.erpInfo.innerHTML = '';
  els.speedCameraInfo.classList.add('hidden');
  els.speedCameraInfo.innerHTML = '';
  navSpeedCameras = [];
  els.trafficInfo.classList.add('hidden');
  els.trafficInfo.innerHTML = '';
  navTrafficOverlays = [];
  els.cyclingExtra.classList.add('hidden');
  els.cyclingExtra.innerHTML = '';
  els.startNavBtn.classList.add('hidden');
  stopNavigation(false);
}

// Anywheel (and every other Singapore dockless bike-share operator) doesn't
// publish a public API or GBFS feed — checked the official GBFS registry,
// LTA DataMall's full dataset list, and community bike-share API docs, none
// have it. So rather than guess at bike locations, this just opens Anywheel's
// own app/site where their live map actually lives.
function anywheelLink() {
  const ua = navigator.userAgent || '';
  if (/android/i.test(ua)) return 'https://play.google.com/store/apps/details?id=com.ytyiot.ebike.anywheel';
  if (/iphone|ipad|ipod/i.test(ua)) return 'https://apps.apple.com/sg/app/anywheel/id1453812982';
  return 'https://www.anywheel.sg/';
}

function showCyclingExtra() {
  els.cyclingExtra.classList.remove('hidden');
  els.cyclingExtra.innerHTML = '<div class="driving-extra-title">🚲 Need a bike?</div>'
    + '<div class="driving-extra-note">Waypoint doesn\'t have live Anywheel bike locations (no public API exists) — check their own live map instead.</div>'
    + `<a href="${anywheelLink()}" target="_blank" rel="noopener" class="pill-btn primary driving-extra-link">Open Anywheel</a>`;
}

// Escapes a string for safe use inside an HTML attribute (e.g. data-label="...").
function escapeAttr(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// Re-routes within Waypoint itself (instead of bouncing out to Google Maps)
// when the person taps a parking / EV charging / petrol station row — sets
// that spot as the new destination and re-runs directions.
async function routeToPoint(lat, lon, label) {
  setTo({ lat, lon, label });
  await getDirections();
}

// Driving-extra rows are rendered as <a href="#" data-lat/data-lon/data-label>
// rather than real links, so this wires them up to route within the app.
// Called once right after each panel's innerHTML is set.
function wireDrivingExtraLinks(container) {
  container.querySelectorAll('.driving-extra-link-row').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const lat = parseFloat(el.dataset.lat);
      const lon = parseFloat(el.dataset.lon);
      routeToPoint(lat, lon, el.dataset.label || '');
    });
  });
}

async function loadParkingInfo(coords) {
  els.parkingInfo.classList.remove('hidden');
  els.parkingInfo.innerHTML = '<div class="driving-extra-title">🅿️ Parking near destination</div><div class="driving-extra-row">Loading…</div>';
  try {
    const res = await fetch(`/api/carparks-nearby?lat=${coords.lat}&lon=${coords.lon}`);
    const data = await res.json();
    if (!res.ok || !data.carparks || !data.carparks.length) {
      els.parkingInfo.classList.add('hidden');
      return;
    }
    els.parkingInfo.innerHTML = '<div class="driving-extra-title">🅿️ Parking near destination</div>' + data.carparks.map((c) => {
      const label = escapeAttr(`${c.development} (${c.agency})`);
      return `
        <a class="driving-extra-row driving-extra-link-row" href="#" data-lat="${c.lat}" data-lon="${c.lon}" data-label="${label}">
          <span>${c.development} (${c.agency}) · ${formatDistance(c.distanceMeters)}</span>
          <span class="driving-extra-lots">${Number.isFinite(c.availableLots) ? c.availableLots + ' lots' : '—'}</span>
        </a>
      `;
    }).join('');
    wireDrivingExtraLinks(els.parkingInfo);
  } catch (err) {
    console.error('parking info failed:', err);
    els.parkingInfo.classList.add('hidden');
  }
}

// Summarizes a station's plugTypes map (e.g. {"Type 2": 3, "CCS 2": 5}) into
// "3× Type 2, 5× CCS 2" — compact enough for the driving-extra row.
function formatPlugTypes(plugTypes) {
  return Object.entries(plugTypes || {})
    .map(([type, count]) => `${count}× ${type}`)
    .join(', ');
}

async function loadEvChargingInfo(coords) {
  els.evChargingInfo.classList.remove('hidden');
  els.evChargingInfo.innerHTML = '<div class="driving-extra-title">🔌 EV charging near destination</div><div class="driving-extra-row">Loading…</div>';
  try {
    const res = await fetch(`/api/ev-charging-nearby?lat=${coords.lat}&lon=${coords.lon}`);
    const data = await res.json();
    if (!res.ok || !data.stations || !data.stations.length) {
      els.evChargingInfo.classList.add('hidden');
      return;
    }
    els.evChargingInfo.innerHTML = '<div class="driving-extra-title">🔌 EV charging near destination</div>' + data.stations.map((s) => {
      const label = escapeAttr(s.address || 'EV charging station');
      return `
        <a class="driving-extra-row driving-extra-link-row" href="#" data-lat="${s.lat}" data-lon="${s.lon}" data-label="${label}">
          <span>${s.address} · ${formatDistance(s.distanceMeters)}</span>
          <span class="driving-extra-lots">${formatPlugTypes(s.plugTypes)}</span>
        </a>
      `;
    }).join('') + '<div class="driving-extra-note">Locations from LTA DataMall\'s quarterly dataset — not live availability.</div>';
    wireDrivingExtraLinks(els.evChargingInfo);
  } catch (err) {
    console.error('EV charging info failed:', err);
    els.evChargingInfo.classList.add('hidden');
  }
}

async function loadPetrolInfo(coords) {
  els.petrolInfo.classList.remove('hidden');
  els.petrolInfo.innerHTML = '<div class="driving-extra-title">⛽ Petrol stations near destination</div><div class="driving-extra-row">Loading…</div>';
  try {
    const res = await fetch(`/api/petrol-nearby?lat=${coords.lat}&lon=${coords.lon}`);
    const data = await res.json();
    if (!res.ok || !data.stations || !data.stations.length) {
      els.petrolInfo.classList.add('hidden');
      return;
    }
    els.petrolInfo.innerHTML = '<div class="driving-extra-title">⛽ Petrol stations near destination</div>' + data.stations.map((s) => {
      const label = s.address ? `${s.name} · ${s.address}` : s.name;
      return `
        <a class="driving-extra-row driving-extra-link-row" href="#" data-lat="${s.lat}" data-lon="${s.lon}" data-label="${escapeAttr(label)}">
          <span>${label} · ${formatDistance(s.distanceMeters)}</span>
          <span class="driving-extra-lots">${s.open24h ? '24 hrs' : ''}</span>
        </a>
      `;
    }).join('') + '<div class="driving-extra-note">Locations from OpenStreetMap contributors — not live prices or queues.</div>';
    wireDrivingExtraLinks(els.petrolInfo);
  } catch (err) {
    console.error('Petrol station info failed:', err);
    els.petrolInfo.classList.add('hidden');
  }
}

async function loadErpInfo(coordinates) {
  els.erpInfo.classList.remove('hidden');
  els.erpInfo.innerHTML = '<div class="driving-extra-title">🛣️ ERP</div><div class="driving-extra-row">Checking route…</div>';
  try {
    const res = await fetch('/api/erp-crossings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates }),
    });
    const data = await res.json();
    if (!res.ok || data.gantryCount == null) {
      els.erpInfo.classList.add('hidden');
      return;
    }
    if (data.gantryCount === 0) {
      els.erpInfo.innerHTML = '<div class="driving-extra-title">🛣️ ERP</div><div class="driving-extra-row">No ERP gantries on this route.</div>';
    } else {
      els.erpInfo.innerHTML = '<div class="driving-extra-title">🛣️ ERP</div>'
        + `<div class="driving-extra-row"><span>Gantries on this route</span><span class="driving-extra-lots">${data.gantryCount}</span></div>`
        + '<div class="driving-extra-note">We can flag gantries but not the exact charge yet (LTA doesn\'t publish a route-to-rate link) — charges only apply during operating hours and vary by vehicle type. <a href="https://onemotoring.lta.gov.sg/" target="_blank" rel="noopener">Check current rates</a>.</div>';
    }
  } catch (err) {
    console.error('erp info failed:', err);
    els.erpInfo.classList.add('hidden');
  }
}

// Speed camera alerts — see /api/speed-camera-crossings. Same "flag it on the
// route summary" treatment as ERP gantries above, plus this also stashes the
// matched cameras into navSpeedCameras so live turn-by-turn navigation (see
// handleNavPosition/checkNavSpeedCameras) can give a one-time heads-up as you
// actually approach each one while driving.
async function loadSpeedCameraInfo(coordinates) {
  els.speedCameraInfo.classList.remove('hidden');
  els.speedCameraInfo.innerHTML = '<div class="driving-extra-title">📷 Speed Cameras</div><div class="driving-extra-row">Checking route…</div>';
  navSpeedCameras = [];
  try {
    const res = await fetch('/api/speed-camera-crossings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates }),
    });
    const data = await res.json();
    if (!res.ok || data.cameras == null) {
      els.speedCameraInfo.classList.add('hidden');
      return;
    }
    navSpeedCameras = data.cameras;
    if (!data.cameras.length) {
      els.speedCameraInfo.innerHTML = '<div class="driving-extra-title">📷 Speed Cameras</div><div class="driving-extra-row">No known speed cameras on this route.</div>';
    } else {
      els.speedCameraInfo.innerHTML = '<div class="driving-extra-title">📷 Speed Cameras</div>'
        + data.cameras.map((c) => `<div class="driving-extra-row"><span>${escapeHtml(c.location)}</span><span class="driving-extra-lots">${escapeHtml(c.type)}</span></div>`).join('')
        + '<div class="driving-extra-note">From SPF\'s published camera locations (data.gov.sg) — may not include the newest sites. We\'ll also give you a heads-up as you approach one during live navigation.</div>';
    }
  } catch (err) {
    console.error('speed camera info failed:', err);
    els.speedCameraInfo.classList.add('hidden');
  }
}

// Checks LTA's live speed-band data against the route and, if any stretch is
// jammed or slow-moving, both shows a summary here and stashes the matched
// segments in navTrafficOverlays so the nav map can draw them in red/amber
// on top of the usual blue route line (see drawTrafficOverlays()).
async function loadRouteTraffic(coordinates) {
  els.trafficInfo.classList.remove('hidden');
  els.trafficInfo.innerHTML = '<div class="driving-extra-title">🚦 Traffic</div><div class="driving-extra-row">Checking live conditions…</div>';
  navTrafficOverlays = [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch('/api/route-traffic', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates }),
    });
    const data = await res.json();
    if (!res.ok || !data.overlays) {
      els.trafficInfo.classList.add('hidden');
      return;
    }
    navTrafficOverlays = data.overlays;
    const { redMeters = 0, amberMeters = 0 } = data.meta || {};
    if (!redMeters && !amberMeters) {
      els.trafficInfo.innerHTML = '<div class="driving-extra-title">🚦 Traffic</div><div class="driving-extra-row">Flowing smoothly along this route.</div>';
    } else {
      const parts = [];
      if (redMeters) parts.push(`<span class="traffic-dot traffic-dot-red"></span>${formatDistance(redMeters)} heavy traffic`);
      if (amberMeters) parts.push(`<span class="traffic-dot traffic-dot-amber"></span>${formatDistance(amberMeters)} slow-moving`);
      els.trafficInfo.innerHTML = '<div class="driving-extra-title">🚦 Traffic</div>'
        + `<div class="driving-extra-row">${parts.join(' &nbsp; ')}</div>`
        + '<div class="driving-extra-note">From LTA\'s live speed data (refreshes every few min) — highlighted on the map once you start navigation.</div>';
    }
    // If navigation is already underway, redraw immediately rather than
    // waiting for the next showNavMap() call.
    if (!els.navMapOverlay.classList.contains('hidden')) drawTrafficOverlays();
  } catch (err) {
    console.error('route traffic failed:', err);
    els.trafficInfo.classList.add('hidden');
  } finally {
    clearTimeout(timeout);
  }
}

async function getDirections() {
  if (!fromCoords || !toCoords) return;
  hideDrivingExtras();

  if (selectedMode === 'transit') return getTransitDirections();

  stopWakeAlert(false);
  clearArrivalIntervalsIn(els.routeSteps);
  els.itineraryOptions.classList.add('hidden');
  els.itineraryOptions.innerHTML = '';
  transitItineraries = [];
  hideRainAlert();

  els.getDirectionsBtn.disabled = true;
  els.getDirectionsBtn.textContent = 'Loading…';

  const coordStr = `${fromCoords.lon},${fromCoords.lat};${toCoords.lon},${toCoords.lat}`;
  // The public OSRM demo server (router.project-osrm.org) only ever runs the
  // car/driving profile — requests with profile "walking" or "cycling" still
  // get routed over car roads at car speeds instead of erroring, which is why
  // walking estimates could come back drastically too fast (a route needing
  // a pedestrian bridge/stairs the car graph doesn't have gets approximated
  // by a nearby road, timed as if driven). FOSSGIS e.V.'s community OSRM
  // mirrors run the actual foot/bike profiles against real pedestrian/cycling
  // network data, so send those two modes there instead.
  const { host, profile } = OSRM_ENDPOINTS[selectedMode] || OSRM_ENDPOINTS.driving;
  const url = `${host}/route/v1/${profile}/${coordStr}?overview=full&geometries=geojson&steps=true`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (data.code !== 'Ok' || !data.routes || !data.routes.length) {
      showToast('Could not find a route between those points.');
      hideRoutePreviewMap();
      return;
    }

    const route = data.routes[0];
    renderRouteSummary(route);
    renderRouteSteps(route);
    if (selectedMode === 'walking') checkRainAlert(fromCoords, toCoords);
    else hideRainAlert();
    if (selectedMode === 'driving') {
      loadParkingInfo(toCoords);
      loadEvChargingInfo(toCoords);
      loadPetrolInfo(toCoords);
      loadErpInfo(route.geometry.coordinates);
      loadSpeedCameraInfo(route.geometry.coordinates);
      loadRouteTraffic(route.geometry.coordinates);
    } else if (selectedMode === 'cycling') {
      showCyclingExtra();
    }
    // Live turn-by-turn navigation (map + voice + banner) works the same way
    // for driving, cycling, and walking — all three come back from OSRM with
    // real turn-by-turn maneuver steps. Only transit skips it, since that's
    // its own itinerary UI (bus/train legs, not a single walkable route).
    if (selectedMode === 'driving' || selectedMode === 'cycling' || selectedMode === 'walking') {
      navRouteSteps = route.legs.flatMap((leg) => leg.steps);
      navRouteCoords = route.geometry.coordinates;
      els.startNavBtn.classList.remove('hidden');
    }
  } catch (err) {
    console.error(err);
    // A failed fetch is a far more reliable "you're actually offline" signal
    // than navigator.onLine, which is notoriously unreliable — it can report
    // false even on a perfectly working connection (this caused a real bug:
    // switching travel modes with a route already loaded would re-trigger
    // getDirections() and falsely claim "offline" even when fully online).
    // Only show the offline-flavored fallback once the request has actually
    // failed AND the browser also agrees we're offline; otherwise it's some
    // other transient hiccup and the generic message is more honest.
    if (!navigator.onLine) {
      const dist = haversineMeters(fromCoords.lat, fromCoords.lon, toCoords.lat, toCoords.lon);
      const { label } = bearingCompass(fromCoords.lat, fromCoords.lon, toCoords.lat, toCoords.lon);
      showToast(`📡 You're offline — no live routing, but ${toCoords.label || 'your destination'} is roughly ${formatDistanceShort(dist)} to the ${label}.`, 6000);
    } else {
      showToast('Routing service unavailable. Please try again.');
    }
  } finally {
    els.getDirectionsBtn.disabled = false;
    els.getDirectionsBtn.textContent = 'Get Directions';
  }
}

// ---------- Live driving navigation (GPS-tracked, voice-guided turn-by-turn) ----------
// Watches your position and walks through the same steps rendered above,
// speaking each upcoming instruction as you approach it. Deliberately does
// NOT reroute automatically if you go off-path — that needs continuously
// re-querying the routing engine and is a bigger project on its own; instead
// it just flags that you've drifted from the route.

const NAV_ARRIVAL_THRESHOLD_M = 25; // close enough to a maneuver to count as "reached it"
const NAV_OFFROUTE_THRESHOLD_M = 80; // distance from the route line before we warn
const NAV_OFFROUTE_COOLDOWN_MS = 30000; // don't spam the off-route toast

let navRouteSteps = [];
let navRouteCoords = [];
let navWatchId = null;
let navWakeLock = null;
let navTargetIndex = 1; // index into navRouteSteps we're currently heading toward
let navMuted = false;
let navLastOffRouteWarnAt = 0;
let navLastFix = null; // { lat, lon, t } — previous GPS fix, used to derive speed/heading when the browser doesn't report them directly
let navSpeedCameras = []; // cameras matched against the current driving route — see loadSpeedCameraInfo
let navAlertedCameraIdxs = new Set(); // indexes into navSpeedCameras already announced this nav session, so we don't repeat

// The pre-trip rain banner (checkRainAlert, below the Directions form) only
// checks once, at your fixed start/end points, before you've even left — it
// never re-checks once you're actually walking. That misses the "it was fine
// when I left, but it started raining 20 minutes into the walk" case. This
// covers that: re-checks the same NEA 2-hour forecast, but against your
// LIVE position, periodically while navigating on foot, and surfaces a toast
// (visible even over the fullscreen nav map) the first time it turns rainy.
const NAV_RAIN_RECHECK_MS = 5 * 60 * 1000; // matches the server's own NEA cache TTL — no point checking more often than the data itself changes
let navLastRainCheckAt = 0;
let navRainWarned = false; // only warn once per navigation session, not on every recheck
let navMapRotationDeg = 0; // current course-up rotation applied to the map container (0 = north-up)
let navLastHeadingDeg = null; // most recent known heading, so "recenter" can re-apply rotation immediately instead of waiting for the next GPS fix
let navCompassHeadingDeg = null; // live reading from the phone's own compass/magnetometer, when available
let navCompassActive = false;

// GPS "course over ground" (used above in resolveHeadingDeg) only exists
// once you're actually moving, and can be noisy at walking pace — it can't
// tell you're now facing a different way if you've simply stopped and
// turned around. The device's own compass answers that instantly, which
// matters most for walking (see getCurrentHeadingDeg below, which prefers
// GPS while moving at a normal clip and falls back to the compass
// otherwise). iOS requires an explicit permission prompt, which has to be
// triggered directly from a user gesture — this is called synchronously
// from the "Start Navigation" tap handler for exactly that reason.
function handleDeviceOrientation(event) {
  let heading = null;
  if (typeof event.webkitCompassHeading === 'number') {
    // iOS Safari reports a true compass heading directly, no conversion needed.
    heading = event.webkitCompassHeading;
  } else if (event.absolute && typeof event.alpha === 'number') {
    // deviceorientationabsolute's alpha increases counter-clockwise from
    // north; compass headings increase clockwise, hence the flip.
    heading = (360 - event.alpha) % 360;
  }
  if (Number.isFinite(heading)) navCompassHeadingDeg = heading;
}

function startCompassListener() {
  if (navCompassActive || typeof DeviceOrientationEvent === 'undefined') return;
  const attach = () => {
    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', handleDeviceOrientation);
    } else {
      window.addEventListener('deviceorientation', handleDeviceOrientation);
    }
    navCompassActive = true;
  };
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission()
      .then((state) => { if (state === 'granted') attach(); })
      .catch((err) => console.error('compass permission request failed:', err));
  } else {
    attach();
  }
}

function stopCompassListener() {
  if (!navCompassActive) return;
  window.removeEventListener('deviceorientationabsolute', handleDeviceOrientation);
  window.removeEventListener('deviceorientation', handleDeviceOrientation);
  navCompassActive = false;
  navCompassHeadingDeg = null;
}

// Visual map — Leaflet, loaded from a CDN (see index.html). Lazily created on
// the first "Start Navigation" tap, then reused/repositioned for later trips
// rather than rebuilt each time.
let navMap = null;
let navMapRouteHalo = null; // a wider white line drawn under navMapRouteLine so the route reads clearly against busy OSM tiles
let navMapRouteLine = null;
let navMapLiveMarker = null;
let navMapStartMarker = null;
let navMapDestMarker = null;
let navFollowing = true; // false once the user manually drags/zooms the map, until they tap recenter

// Leaflet fires the exact same 'zoomstart' event whether WE change the zoom
// (auto-follow re-centering) or the PERSON does (pinch/scroll/+-buttons) —
// there's no built-in way to tell those apart, unlike 'dragstart' (which only
// ever fires for a real manual drag). Without this flag, every GPS fix that
// calls followNavPosition() and changes the zoom level would immediately
// re-trigger 'zoomstart' and get treated as "the user zoomed," which in turn
// would (a) wrongly flip navFollowing off after every single auto-recenter,
// and worse (b) mean any REAL pinch-zoom the user does gets silently undone
// a few seconds later by the next GPS fix calling followNavPosition() again
// while navFollowing was never actually turned off. So: set this right
// before any zoom/pan WE trigger, and the zoomstart handler below only
// treats the event as a manual zoom when this is false.
let navProgrammaticZoom = false;
function navMarkProgrammaticZoom() {
  navProgrammaticZoom = true;
  if (navMap) navMap.once('moveend', () => { navProgrammaticZoom = false; });
}

// Live-traffic overlay segments matched against the current route by
// /api/route-traffic (see loadRouteTraffic()) — [{ color: 'red'|'amber',
// points: [[lat,lon], ...] }]. Drawn on top of navMapRouteLine.
let navTrafficOverlays = [];
let navMapTrafficLines = [];

function drawTrafficOverlays() {
  if (!navMap) return;
  navMapTrafficLines.forEach((line) => navMap.removeLayer(line));
  navMapTrafficLines = [];
  const colors = { red: '#dc2626', amber: '#f59e0b' };
  navTrafficOverlays.forEach((overlay) => {
    const line = L.polyline(overlay.points, {
      color: colors[overlay.color] || colors.red,
      weight: 7,
      opacity: 0.9,
    }).addTo(navMap);
    line.bringToFront();
    navMapTrafficLines.push(line);
  });
}

// Free CARTO Basemaps API key (carto.com/basemaps/apikey/, free tier: 5M
// tile requests/month) — switches both the live nav map and the route
// preview map to CARTO's clean "Positron" style (soft grays/greens, like
// Waze/Petal Maps) instead of the default OSM "Standard" style's busy beige
// buildings and dense labels. This key is only good for pulling map tiles
// (not an account/billing secret), and CARTO Basemaps keys are meant to
// ship in client-side JS like this — but it is visible to anyone who views
// this file, so if it's ever misused, regenerate/revoke it from the same
// carto.com/basemaps/apikey/ form. Leave this empty to fall back to the
// default OSM tiles (still softened by the CSS filter below).
const CARTO_API_KEY = 'cb1_3i2h_1_e6f7d6e99ba7fde0991ed336';

function buildBasemapLayer() {
  if (CARTO_API_KEY) {
    // CARTO's docs (and multiple other projects that hit this same "API KEY
    // REQUIRED" watermark) confirm the query param is named "key", not
    // "api_key" — that mismatch is what caused the watermark even with a
    // valid key plugged in.
    return L.tileLayer(`https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=${CARTO_API_KEY}`, {
      maxZoom: 20,
      subdomains: 'abcd',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors '
        + '&copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>',
    });
  }
  return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  });
}

// ---- Hazard layers: dengue cluster zones (NEA) + flash flood alerts (PUB) --
// Fetched once at load and refreshed periodically (see setInterval below),
// then drawn as shaded zones / markers on BOTH maps (live nav + route
// preview) and checked against whatever route is currently shown so a
// walk/cycle through one gets a heads-up banner.
let dengueClusters = [];
let floodAlerts = [];
const HAZARD_POLL_MS = 10 * 60 * 1000;

async function loadHazardData() {
  try {
    const [dengueRes, floodRes] = await Promise.all([
      fetch('/api/dengue-clusters').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/flood-alerts').then((r) => (r.ok ? r.json() : null)),
    ]);
    if (dengueRes?.clusters) dengueClusters = dengueRes.clusters;
    if (floodRes?.alerts) floodAlerts = floodRes.alerts;
    refreshHazardLayers();
    // A route may already be on screen when this (re)loads — re-check it
    // against the freshest data rather than waiting for the next search.
    if (lastPreviewPoints) checkRouteHazards(lastPreviewPoints);
  } catch (err) {
    console.error('hazard data load failed:', err);
  }
}

function buildDengueLayer() {
  const group = L.layerGroup();
  dengueClusters.forEach((cluster) => {
    const caseLabel = cluster.caseSize != null ? ` — ${cluster.caseSize} case${cluster.caseSize === 1 ? '' : 's'}` : '';
    (cluster.rings || []).forEach((ring) => {
      // Spell out "Dengue cluster" rather than relying on the 🦟 emoji alone
      // to say what this is — the emoji renders tiny/hard to read on some
      // phones, so the word itself needs to carry the meaning.
      L.polygon(ring, { color: '#c2410c', weight: 1.5, fillColor: '#f97316', fillOpacity: 0.28 })
        .bindTooltip(`🦟 Dengue cluster — ${cluster.locality}${caseLabel}`, { sticky: true })
        .addTo(group);
    });
  });
  return group;
}

function buildFloodLayer() {
  const group = L.layerGroup();
  floodAlerts.forEach((alert) => {
    const icon = L.divIcon({ className: 'flood-alert-marker', html: '🌊', iconSize: [24, 24], iconAnchor: [12, 12] });
    // Same reasoning as the dengue tooltip above — spell out "Flash flood
    // alert" instead of leaning on the small 🌊 marker icon alone.
    L.marker([alert.lat, alert.lon], { icon })
      .bindTooltip(`🌊 Flash flood alert — ${alert.name}${alert.status ? ` — ${alert.status}` : ''}`, { sticky: true })
      .addTo(group);
  });
  return group;
}

let navHazardLayers = null;
let previewHazardLayers = null;

// Redraws both hazard layers on whichever of the two maps currently exist —
// safe to call before either map is created (it just does nothing for the
// missing one) and safe to call repeatedly as data refreshes.
function refreshHazardLayers() {
  try {
    if (typeof L === 'undefined') return;
    if (navMap) {
      if (navHazardLayers) { navMap.removeLayer(navHazardLayers.dengue); navMap.removeLayer(navHazardLayers.flood); }
      navHazardLayers = { dengue: buildDengueLayer().addTo(navMap), flood: buildFloodLayer().addTo(navMap) };
    }
    if (previewMap) {
      if (previewHazardLayers) { previewMap.removeLayer(previewHazardLayers.dengue); previewMap.removeLayer(previewHazardLayers.flood); }
      previewHazardLayers = { dengue: buildDengueLayer().addTo(previewMap), flood: buildFloodLayer().addTo(previewMap) };
    }
  } catch (err) {
    console.error('hazard layer refresh failed:', err);
  }
}

// Ray-casting point-in-polygon test. ring: [[lat,lon], ...].
function pointInRing(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    const intersect = (yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInAnyDengueCluster(lat, lon) {
  return dengueClusters.find((c) => (c.rings || []).some((ring) => pointInRing(lat, lon, ring))) || null;
}

const FLOOD_ALERT_PROXIMITY_M = 300;

function showDengueAlert(cluster) {
  const caseLabel = cluster.caseSize != null ? ` (${cluster.caseSize} case${cluster.caseSize === 1 ? '' : 's'})` : '';
  els.dengueBannerText.textContent = `Your route passes through an active dengue cluster near ${cluster.locality}${caseLabel} — consider insect repellent.`;
  els.dengueBanner.classList.remove('hidden');
}
function hideDengueAlert() { els.dengueBanner.classList.add('hidden'); }

function showFloodAlert(alert) {
  const statusLabel = alert.status ? ` (${alert.status})` : '';
  els.floodBannerText.textContent = `Active flash flood alert near your route at ${alert.name}${statusLabel} — consider an alternate route or delay.`;
  els.floodBanner.classList.remove('hidden');
}
function hideFloodAlert() { els.floodBanner.classList.add('hidden'); }

// Remembers the last route's points so a hazard-data refresh mid-session
// (see loadHazardData) can re-check the route already on screen.
let lastPreviewPoints = null;

// points: [[lat,lon], ...] — every vertex of the route/itinerary currently
// shown on the preview map. Checks the WHOLE route, not just endpoints,
// since a cluster or flood spot in the middle of the path matters just as
// much as one at either end.
function checkRouteHazards(points) {
  try {
    hideDengueAlert();
    hideFloodAlert();
    if (!points || !points.length) return;

    for (const [lat, lon] of points) {
      const hit = pointInAnyDengueCluster(lat, lon);
      if (hit) { showDengueAlert(hit); break; }
    }

    pointLoop:
    for (const [lat, lon] of points) {
      for (const alert of floodAlerts) {
        if (haversineMeters(lat, lon, alert.lat, alert.lon) <= FLOOD_ALERT_PROXIMITY_M) {
          showFloodAlert(alert);
          break pointLoop;
        }
      }
    }
  } catch (err) {
    console.error('hazard route check failed:', err);
  }
}

loadHazardData();
setInterval(loadHazardData, HAZARD_POLL_MS);

function initNavMap() {
  if (navMap || typeof L === 'undefined') return;
  navMap = L.map('navMap', { zoomControl: false, attributionControl: true });
  // Give the map a view IMMEDIATELY, before anything is added to it. Until a
  // map has had setView/fitBounds called at least once, Leaflet considers it
  // "not ready" and silently QUEUES every addLayer call to replay once a
  // view finally gets set — and replaying a big batch at once (tile layer +
  // hazard polygons + route lines + markers, all queued together the first
  // time this runs) is what was crashing deep inside Leaflet's renderer
  // ("Cannot read properties of undefined (reading 'min')"), which in turn
  // left those layers half-initialized and throwing AGAIN later when they
  // got removed ("reading 'parentNode'") — this is what was silently eating
  // the route line, markers, and live puck/arrow on the nav map. Centering
  // on Singapore here is arbitrary — showNavMap()'s later fitBounds() call
  // immediately re-frames it to the real route, this view is only ever
  // visible for a single frame, if that.
  navMap.setView([1.3521, 103.8198], 12);
  buildBasemapLayer().addTo(navMap);
  // Manually panning away breaks course-up tracking — freeze back to a
  // plain north-up map rather than leaving it stuck at a rotated angle
  // while the person's looking somewhere else on it.
  navMap.on('dragstart', () => { navFollowing = false; resetMapRotation(); });
  // Covers pinch-zoom, scroll-wheel zoom, and the +/- buttons — see
  // navProgrammaticZoom above for why this guard is needed.
  navMap.on('zoomstart', () => {
    if (navProgrammaticZoom) return;
    navFollowing = false;
    resetMapRotation();
  });
  refreshHazardLayers();
}

// ---- Route preview map (Directions results, before "Start Navigation") ----
// A small static map showing the route/itinerary right in the results —
// same idea as Google/Waze/Petal Maps showing the route before you commit to
// navigating, rather than Waypoint's previous text-only steps list. Separate
// Leaflet instance from the full-screen live nav map (different container,
// no live puck/rotation/traffic overlay — just the path + start/end pins),
// but shares the same basemap choice via buildBasemapLayer().

// Standard Google/OTP-format encoded polyline decoder (precision 5) — OTP's
// leg.legGeometry.points comes back in this format. Returns [[lat,lon], ...].
function decodePolyline(encoded) {
  if (!encoded) return [];
  const coordinates = [];
  const factor = 1e5;
  let index = 0, lat = 0, lon = 0;
  while (index < encoded.length) {
    let result = 0, shift = 0, b;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    result = 0; shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lon += (result & 1) ? ~(result >> 1) : (result >> 1);

    coordinates.push([lat / factor, lon / factor]);
  }
  return coordinates;
}

let previewMap = null;
let previewMapLayers = []; // polylines + markers drawn for the current route, cleared and rebuilt each call

function initPreviewMap() {
  if (previewMap || typeof L === 'undefined') return;
  // No zoom control / dragging kept minimal — this is a small "here's your
  // route at a glance" preview, not something you're meant to pan around;
  // scrollWheelZoom off so scrolling the results panel over it on desktop
  // doesn't accidentally zoom the map instead.
  previewMap = L.map('routePreviewMap', { zoomControl: false, attributionControl: true, scrollWheelZoom: false });
  // See the matching comment in initNavMap(): a Leaflet map needs a view set
  // before anything is added to it, or every addLayer call gets silently
  // queued and replayed later, which is what was crashing (and eating the
  // route line/pins) on this preview map too. renderRoutePreviewMap()'s
  // fitBounds() call right after re-frames this to the real route.
  previewMap.setView([1.3521, 103.8198], 12);
  buildBasemapLayer().addTo(previewMap);
  refreshHazardLayers();
}

// segments: [{ latlngs: [[lat,lon],...], color: '#hex', dashed: bool }, ...]
// Everything below is wrapped in one try/catch. Reasoning: this function is
// called from INSIDE renderRouteSummary()/selectItinerary(), both of which
// still have important work to do right after (rendering route steps,
// revealing the "Start Navigation" button, showing cycling/driving extras).
// Those are plain synchronous statements after this call — if anything in
// here threw, the exception would propagate straight up and silently skip
// all of that later code too, which is a much worse failure than "the
// preview map/hazard overlay didn't draw this one time." A rendering bug in
// a map overlay should never be able to take down the rest of the results
// screen with it.
function renderRoutePreviewMap(segments) {
  try {
    if (typeof L === 'undefined' || !els.routePreviewMap) return;
    const nonEmpty = segments.filter((s) => s.latlngs && s.latlngs.length);
    if (!nonEmpty.length) { els.routePreviewMap.classList.add('hidden'); return; }

    els.routePreviewMap.classList.remove('hidden');
    initPreviewMap();
    if (!previewMap) return;
    // The container was just un-hidden (or the panel just became visible), so
    // Leaflet needs a nudge to notice its real size — same fix as the nav map.
    setTimeout(() => previewMap.invalidateSize(), 0);

    previewMapLayers.forEach((layer) => previewMap.removeLayer(layer));
    previewMapLayers = [];

    const allPoints = [];
    nonEmpty.forEach((seg) => {
      allPoints.push(...seg.latlngs);
      // Same white "halo under the line" trick as the nav map, so the route
      // still reads clearly against building/park fills.
      previewMapLayers.push(
        L.polyline(seg.latlngs, { color: '#ffffff', weight: 7, opacity: 0.85 }).addTo(previewMap),
        L.polyline(seg.latlngs, {
          color: seg.color || '#2563eb',
          weight: 4,
          opacity: 0.95,
          dashArray: seg.dashed ? '1,8' : null,
        }).addTo(previewMap)
      );
    });

    const startIcon = L.divIcon({ className: 'nav-start-marker', iconSize: [14, 14], iconAnchor: [7, 7] });
    const destIcon = L.divIcon({ className: 'nav-dest-marker', html: '📍', iconSize: [26, 26], iconAnchor: [13, 26] });
    previewMapLayers.push(
      L.marker(allPoints[0], { icon: startIcon }).addTo(previewMap),
      L.marker(allPoints[allPoints.length - 1], { icon: destIcon }).addTo(previewMap)
    );

    previewMap.fitBounds(L.latLngBounds(allPoints), { padding: [24, 24] });

    lastPreviewPoints = allPoints;
    checkRouteHazards(allPoints);
  } catch (err) {
    console.error('route preview map failed (route steps/Start Navigation still proceed):', err);
  }
}

function hideRoutePreviewMap() {
  if (els.routePreviewMap) els.routePreviewMap.classList.add('hidden');
  lastPreviewPoints = null;
  hideDengueAlert();
  hideFloodAlert();
}

// Turns one transit itinerary's legs into preview-map segments — walk legs
// dashed gray (de-emphasized, matches how the steps list treats them), train
// legs colored by their real line color (same leg.routeColor used for line
// badges elsewhere), everything else (bus) a plain blue.
function transitPreviewSegments(itinerary) {
  return itinerary.legs.map((leg) => {
    const isWalk = leg.mode === 'walk';
    let color = '#2563eb';
    if (isWalk) color = '#9ca3af';
    else if (leg.mode === 'train' && leg.routeColor) color = `#${leg.routeColor}`;
    return { latlngs: decodePolyline(leg.geometry), color, dashed: isWalk };
  });
}

function showNavMap(routeCoords) {
  if (typeof L === 'undefined') return; // Leaflet didn't load (e.g. no connection to the CDN) — nav still works via the banner/voice, just no map
  els.navMapOverlay.classList.remove('hidden');
  initNavMap();

  // Reveal the rest of the nav chrome (compass, speed badge, ETA sheet) and
  // reset tracking state BEFORE touching any of the actual route-drawing
  // below. This must never be gated behind the drawing code succeeding —
  // exactly the mistake that once let a hazard-overlay bug quietly eat the
  // "Start Navigation" button/cycling extras: an exception partway through
  // the map drawing would otherwise abort before these lines ran, and the
  // nav screen would come up with the tiles visible but no puck, no arrow,
  // no banner-driven UI, nothing — you're staring at a plain map.
  navFollowing = true;
  els.navSpeedBadge.classList.remove('hidden');
  els.navBottomSheet.classList.remove('hidden');
  els.navCompass.classList.remove('hidden');
  navLastFix = null;
  navLastHeadingDeg = null;
  resetMapRotation();

  if (!navMap) return;

  // Everything that actually draws the route line/markers/traffic on the
  // map, wrapped so a bad coordinate or stale layer reference here can never
  // take down navigation as a whole — worst case this one draw is skipped,
  // GPS tracking/voice/banner keep working, and the next position update
  // gets another chance to place the live puck.
  try {
    // The container was just un-hidden, so Leaflet needs a nudge to notice its real size.
    setTimeout(() => navMap.invalidateSize(), 0);

    if (navMapRouteHalo) { navMap.removeLayer(navMapRouteHalo); navMapRouteHalo = null; }
    if (navMapRouteLine) { navMap.removeLayer(navMapRouteLine); navMapRouteLine = null; }
    const latlngs = routeCoords.map(([lon, lat]) => [lat, lon]);
    if (!latlngs.length) return;
    // A wider white "halo" drawn underneath the blue line so the route still
    // reads clearly against busy/light OSM tiles (car parks, building fills,
    // etc.) instead of a thin line getting lost in the background.
    navMapRouteHalo = L.polyline(latlngs, { color: '#ffffff', weight: 9, opacity: 0.9 }).addTo(navMap);
    navMapRouteLine = L.polyline(latlngs, { color: '#2563eb', weight: 5, opacity: 0.95 }).addTo(navMap);
    navMarkProgrammaticZoom();
    navMap.fitBounds(navMapRouteLine.getBounds(), { padding: [40, 40] });
    drawTrafficOverlays();

    // Start (A) and destination (B) markers — separate from the live puck,
    // which tracks current position and moves away from the start point as
    // soon as you set off. Without a destination pin there's nothing on the
    // map anchoring "this is where you're headed."
    if (!navMapStartMarker) {
      const startIcon = L.divIcon({ className: 'nav-start-marker', iconSize: [14, 14], iconAnchor: [7, 7] });
      navMapStartMarker = L.marker(latlngs[0], { icon: startIcon, zIndexOffset: 900 }).addTo(navMap);
    } else {
      navMapStartMarker.setLatLng(latlngs[0]);
    }
    const destLatLng = latlngs[latlngs.length - 1];
    if (!navMapDestMarker) {
      const destIcon = L.divIcon({ className: 'nav-dest-marker', html: '📍', iconSize: [28, 28], iconAnchor: [14, 28] });
      navMapDestMarker = L.marker(destLatLng, { icon: destIcon, zIndexOffset: 950 }).addTo(navMap);
    } else {
      navMapDestMarker.setLatLng(destLatLng);
    }

    if (!navMapLiveMarker) {
      const liveIcon = L.divIcon({
        className: 'nav-live-puck',
        html: '<div class="nav-live-puck-arrow"></div>',
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      navMapLiveMarker = L.marker(latlngs[0], { icon: liveIcon, zIndexOffset: 1000 }).addTo(navMap);
    } else {
      navMapLiveMarker.setLatLng(latlngs[0]);
    }
  } catch (err) {
    console.error('nav map route drawing failed (banner/GPS/voice guidance still proceed):', err);
  }
}

// Rotates the live puck's arrow to face `heading` (degrees, 0 = north,
// clockwise) when known — falls back to leaving it as last-set if the GPS
// fix doesn't include a heading (common when stationary or on some devices).
// This stays correct whether or not the map itself is currently rotated
// (course-up below): the arrow's rotation is relative to its own parent
// pane, and that pane's rotation is what handles reorienting "north" —
// composing the two always lands the arrow pointing the right way.
function updateNavPuckHeading(heading) {
  if (!navMapLiveMarker || !Number.isFinite(heading)) return;
  const el = navMapLiveMarker.getElement();
  const arrow = el && el.querySelector('.nav-live-puck-arrow');
  if (arrow) arrow.style.transform = `rotate(${heading}deg)`;
}

// "Course-up" rotation — spins the whole map so the direction you're
// currently heading always points to the top of the screen, the way
// Waze/Google Maps do by default, instead of a fixed north-up map that
// needs mentally re-orienting (or physically turning the phone) to match
// which way you're actually walking/driving.
//
// This is a plain CSS rotation of Leaflet's own container, not a "real"
// map-projection rotation (that needs a rotation-aware Leaflet build) — the
// tradeoff is that road/place labels rotate along with everything else and
// can end up sideways or upside-down. Only applied while actively
// following your position; panning away freezes back to north-up (see
// dragstart above) so you're not fighting a spinning map while looking
// around it.
function applyCourseUpRotation(headingDeg) {
  if (!navMap || !navFollowing || !Number.isFinite(headingDeg)) return;
  navMapRotationDeg = -headingDeg;
  navMap.getContainer().style.transform = `rotate(${navMapRotationDeg}deg)`;
  els.navCompassNeedle.style.transform = `rotate(${navMapRotationDeg}deg)`;
}

function resetMapRotation() {
  navMapRotationDeg = 0;
  if (navMap) navMap.getContainer().style.transform = '';
  if (els.navCompassNeedle) els.navCompassNeedle.style.transform = '';
}

// Beyond this distance from the drawn route, you're clearly not actually on
// this trip — most commonly because you looked up directions from some
// arbitrary "from" address without being there (a totally normal way to use
// a directions app: "how far is it from X to Y", not "I am at X right now").
// A real off-route drift while genuinely driving is normally well under
// this (see NAV_OFFROUTE_THRESHOLD_M's 80m, used only for the warning
// toast); this is deliberately much larger so it only kicks in for the
// "nowhere near this route" case, not routine GPS wobble.
const NAV_FAR_FROM_ROUTE_M = 1500;

// Recenters the map on your current position. Normally (actually on/near
// the route) that means the usual tight follow-zoom. But if you're clearly
// not on this route at all, tightly zooming to wherever you actually are
// would push the entire drawn route off-screen — the map would show a
// blank area around a lone puck with no way to tell there's a route at all.
// Instead, in that case, fit the view to show BOTH your position and the
// whole route, so the line stays visible however far away you happen to be.
function followNavPosition(lat, lon) {
  if (!navMap) return;
  const farFromRoute = navMapRouteLine && distanceToRouteLine(lat, lon) > NAV_FAR_FROM_ROUTE_M;
  navMarkProgrammaticZoom();
  if (farFromRoute) {
    const bounds = navMapRouteLine.getBounds();
    bounds.extend([lat, lon]);
    navMap.fitBounds(bounds, { padding: [40, 40] });
  } else {
    navMap.setView([lat, lon], Math.max(navMap.getZoom(), 16), { animate: true });
  }
}

function updateNavMapPosition(lat, lon) {
  if (!navMap || !navMapLiveMarker) return;
  navMapLiveMarker.setLatLng([lat, lon]);
  if (navFollowing) followNavPosition(lat, lon);
}

function hideNavMap() {
  els.navMapOverlay.classList.add('hidden');
  els.navSpeedBadge.classList.add('hidden');
  els.navBottomSheet.classList.add('hidden');
  els.navCompass.classList.add('hidden');
  navLastFix = null;
}

if (els.navRecenterBtn) {
  els.navRecenterBtn.addEventListener('click', () => {
    navFollowing = true;
    if (navMap && navMapLiveMarker) {
      const { lat, lng } = navMapLiveMarker.getLatLng();
      followNavPosition(lat, lng);
    }
    // Re-apply course-up immediately from the last known heading rather than
    // sitting north-up until the next GPS fix happens to arrive.
    if (Number.isFinite(navLastHeadingDeg)) applyCourseUpRotation(navLastHeadingDeg);
  });
}

function navStepInstruction(step) {
  const name = step.name ? ` onto ${step.name}` : '';
  return `${stepVerb(step.maneuver)}${name}`;
}

function speakNav(text) {
  if (navMuted || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(utter);
  } catch (err) {
    console.error('speech synthesis failed:', err);
  }
}

function distanceToRouteLine(lat, lon) {
  // Cheap approximation: closest of the route's polyline vertices, not a true
  // point-to-segment distance — good enough at typical GPS/road sample density.
  let min = Infinity;
  for (const [clon, clat] of navRouteCoords) {
    const d = haversineMeters(lat, lon, clat, clon);
    if (d < min) min = d;
  }
  return min;
}

function updateNavBanner(distanceM, step) {
  els.navBannerDistance.textContent = formatDistance(distanceM);
  els.navBannerInstruction.textContent = navStepInstruction(step);
  els.navBannerIcon.textContent = stepIcon(step.maneuver);
}

function highlightNavStep(index) {
  els.routeSteps.querySelectorAll('.nav-current-step').forEach((li) => li.classList.remove('nav-current-step'));
  const li = document.getElementById(`route-step-${index}`);
  if (li) {
    li.classList.add('nav-current-step');
    li.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// Speed: prefer the GPS fix's own reading (m/s — only present on
// devices/browsers that report it), fall back to distance/time between the
// last two fixes otherwise.
function resolveSpeedKmh(pos) {
  const { speed, latitude: lat, longitude: lon } = pos.coords;
  if (Number.isFinite(speed) && speed >= 0) return speed * 3.6;
  if (navLastFix) {
    const dt = (pos.timestamp - navLastFix.t) / 1000;
    if (dt > 0.5) {
      const d = haversineMeters(navLastFix.lat, navLastFix.lon, lat, lon);
      return (d / dt) * 3.6;
    }
  }
  return null;
}

// Heading: prefer the GPS fix's own reading, fall back to the bearing
// between the last two fixes (skipped over tiny movements, since bearing
// across a couple of metres of GPS jitter is mostly noise).
function resolveHeadingDeg(pos) {
  const { heading, latitude: lat, longitude: lon } = pos.coords;
  if (Number.isFinite(heading)) return heading;
  if (navLastFix) {
    const d = haversineMeters(navLastFix.lat, navLastFix.lon, lat, lon);
    if (d > 3) return bearingCompass(navLastFix.lat, navLastFix.lon, lat, lon).degrees;
  }
  return null;
}

function updateSpeedBadge(speedKmh) {
  els.navSpeedValue.textContent = Number.isFinite(speedKmh) ? String(Math.round(Math.max(0, speedKmh))) : '–';
}

// GPS course-over-ground (resolveHeadingDeg) is the more stable reading
// once you're actually moving at a normal pace — a phone's compass can be
// thrown off by nearby metal/electronics, which matters most in a car. But
// GPS course is unavailable or noisy below walking speed, including
// standing still and just turning to face a different way — exactly when
// the compass is most useful, since it doesn't need any movement at all.
function getCurrentHeadingDeg(pos, speedKmh) {
  const gpsHeading = resolveHeadingDeg(pos);
  if (Number.isFinite(gpsHeading) && Number.isFinite(speedKmh) && speedKmh > 3) return gpsHeading;
  if (Number.isFinite(navCompassHeadingDeg)) return navCompassHeadingDeg;
  return gpsHeading;
}

// Remaining distance/duration from the current fix: the airline distance to
// the upcoming maneuver (a reasonable stand-in for "remaining on this
// step"), plus every step still ahead of it in full — same estimate style
// OSRM's own duration figures already use.
function updateEtaSheet(distToTarget, target) {
  let remainingDist = distToTarget;
  let remainingDuration = target.distance > 0
    ? target.duration * Math.min(1, distToTarget / target.distance)
    : 0;
  for (let i = navTargetIndex + 1; i < navRouteSteps.length; i++) {
    remainingDist += navRouteSteps[i].distance;
    remainingDuration += navRouteSteps[i].duration;
  }
  els.navRemainingDuration.textContent = formatDuration(remainingDuration);
  els.navRemainingDistance.textContent = formatDistance(remainingDist);
  const eta = new Date(Date.now() + remainingDuration * 1000);
  els.navEta.textContent = eta.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function handleNavPosition(pos) {
  if (!navRouteSteps.length) return;
  const { latitude: lat, longitude: lon } = pos.coords;

  const speedKmh = resolveSpeedKmh(pos);
  const headingDeg = getCurrentHeadingDeg(pos, speedKmh);
  updateNavMapPosition(lat, lon);
  updateNavPuckHeading(headingDeg);
  applyCourseUpRotation(headingDeg);
  if (Number.isFinite(headingDeg)) navLastHeadingDeg = headingDeg;
  updateSpeedBadge(speedKmh);

  const target = navRouteSteps[navTargetIndex];
  const [tlon, tlat] = target.maneuver.location;
  const distToTarget = haversineMeters(lat, lon, tlat, tlon);

  updateNavBanner(distToTarget, target);
  updateEtaSheet(distToTarget, target);
  highlightNavStep(navTargetIndex);
  navLastFix = { lat, lon, t: pos.timestamp };
  checkNavRainProactive(lat, lon);
  checkNavSpeedCameras(lat, lon);

  const offRoute = distanceToRouteLine(lat, lon) > NAV_OFFROUTE_THRESHOLD_M;
  if (offRoute && Date.now() - navLastOffRouteWarnAt > NAV_OFFROUTE_COOLDOWN_MS) {
    navLastOffRouteWarnAt = Date.now();
    showToast("You look off-route — Waypoint won't reroute automatically, get new directions if needed.");
  }

  if (distToTarget <= NAV_ARRIVAL_THRESHOLD_M) {
    if (navTargetIndex >= navRouteSteps.length - 1) {
      speakNav('You have arrived at your destination.');
      stopNavigation(false);
      // "Save parked car" only makes sense after driving — there's no car
      // to remember the spot of on a bike or on foot.
      if (selectedMode === 'driving') {
        saveParkedCar(lat, lon);
        showToast('🅿️ You have arrived — parking spot saved to ★ Favourites.');
      } else {
        const arrivedIcon = selectedMode === 'walking' ? '🚶' : '🚲';
        showToast(`${arrivedIcon} You have arrived at your destination.`);
      }
      return;
    }
    navTargetIndex += 1;
    const next = navRouteSteps[navTargetIndex];
    speakNav(navStepInstruction(next));
  }
}

async function startNavigation() {
  if (!navigator.geolocation) {
    showToast('Geolocation is not supported by your browser.');
    return;
  }
  if (!navRouteSteps.length) return;

  navTargetIndex = navRouteSteps.length > 1 ? 1 : 0;
  navLastOffRouteWarnAt = 0;
  navLastRainCheckAt = 0;
  navRainWarned = false;
  navAlertedCameraIdxs = new Set();

  // Must be called synchronously, directly from this click handler — iOS
  // only shows the compass permission prompt when requested straight from
  // a user gesture, not after an await.
  startCompassListener();

  showNavMap(navRouteCoords);
  els.navBanner.classList.remove('hidden');
  els.navMuteBtn.innerHTML = navMuted ? ICONS.volumeOff : ICONS.volumeOn;
  els.navBannerDistance.textContent = 'Locating…';
  // Wrapped: this only formats the first instruction's text/icon from data
  // we already have in hand (navRouteSteps). It should never be able to
  // throw, but if some edge-case route ever does trip it up, that must stay
  // a cosmetic miss on the banner text rather than stopping the geolocation
  // watch below from ever starting — losing live tracking entirely would be
  // a far worse outcome than one blank instruction line.
  try {
    els.navBannerInstruction.textContent = navStepInstruction(navRouteSteps[navTargetIndex]);
    els.navBannerIcon.textContent = stepIcon(navRouteSteps[navTargetIndex].maneuver);
    highlightNavStep(navTargetIndex);
    speakNav(`Starting navigation. ${navStepInstruction(navRouteSteps[navTargetIndex])}`);
  } catch (err) {
    console.error('nav banner instruction setup failed (GPS tracking still starts):', err);
  }

  if ('wakeLock' in navigator) {
    try {
      navWakeLock = await navigator.wakeLock.request('screen');
    } catch (err) {
      console.error('wake lock failed:', err); // non-fatal — screen may just dim/sleep during nav
    }
  }

  navWatchId = navigator.geolocation.watchPosition(
    handleNavPosition,
    (err) => {
      console.error('navigation geolocation error:', err);
      showToast(geoErrorMessage(err) + ' (needed for live navigation)');
      stopNavigation(false);
    },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
  );
}

function stopNavigation(showMsg) {
  if (navWatchId != null) {
    navigator.geolocation.clearWatch(navWatchId);
    navWatchId = null;
  }
  if (navWakeLock) {
    navWakeLock.release().catch(() => {});
    navWakeLock = null;
  }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  stopCompassListener();
  els.navBanner.classList.add('hidden');
  hideNavMap();
  els.routeSteps.querySelectorAll('.nav-current-step').forEach((li) => li.classList.remove('nav-current-step'));
  if (showMsg) showToast('Navigation stopped.');
}

els.startNavBtn.addEventListener('click', startNavigation);
els.navStopBtn.addEventListener('click', () => stopNavigation(true));
els.navMuteBtn.addEventListener('click', () => {
  navMuted = !navMuted;
  els.navMuteBtn.innerHTML = navMuted ? ICONS.volumeOff : ICONS.volumeOn;
  if (navMuted && 'speechSynthesis' in window) window.speechSynthesis.cancel();
});

// ---------- Transit (bus / MRT) directions ----------

const MODE_ICON = { walk: '🚶', bus: '🚌', train: '🚇', ferry: '⛴' };

// Friendlier tooltip names for MRT/LRT line codes. Purely cosmetic — the
// actual badge color always comes from the live GTFS feed (leg.routeColor),
// never hardcoded here, so a brand-new line (or a color change) shows up
// correctly with zero code changes on our end.
const MRT_LINE_NAMES = {
  NS: 'North South Line', EW: 'East West Line', CG: 'East West Line (Changi Airport)',
  NE: 'North East Line', CC: 'Circle Line', CE: 'Circle Line (Marina Bay)',
  DT: 'Downtown Line', TE: 'Thomson-East Coast Line',
  BP: 'Bukit Panjang LRT', SE: 'Sengkang LRT', SW: 'Sengkang LRT', PE: 'Punggol LRT', PW: 'Punggol LRT',
};

// Picks black or white text for readability against an arbitrary line
// color (standard relative-luminance formula) — only used as a fallback
// when the feed doesn't supply its own textColor.
function contrastTextColor(hex) {
  if (!hex || hex.length !== 6) return '#fff';
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#000' : '#fff';
}

// A small colored pill for a train leg, e.g. "DT" on blue, "TE" on brown —
// matches the real MRT/LRT line colors from the live GTFS feed.
function lineBadge(leg) {
  const badge = document.createElement('span');
  badge.className = 'line-badge';
  badge.style.background = leg.routeColor ? `#${leg.routeColor}` : '#666';
  badge.style.color = leg.routeTextColor ? `#${leg.routeTextColor}` : contrastTextColor(leg.routeColor);
  badge.textContent = leg.routeName || '?';
  if (leg.routeName && MRT_LINE_NAMES[leg.routeName]) badge.title = MRT_LINE_NAMES[leg.routeName];
  return badge;
}

let transitItineraries = []; // all itinerary options returned for the current transit search
let selectedItineraryIndex = 0;

async function getTransitDirections() {
  stopWakeAlert(false);
  hideRainAlert();
  els.getDirectionsBtn.disabled = true;
  els.getDirectionsBtn.textContent = 'Loading…';

  const params = new URLSearchParams({
    fromLat: fromCoords.lat, fromLon: fromCoords.lon,
    toLat: toCoords.lat, toLon: toCoords.lon,
  });

  try {
    const res = await fetch(`/api/transit-plan?${params}`);
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Transit routing is unavailable right now.');
      return;
    }

    if (!data.itineraries || !data.itineraries.length) {
      const reason = data.errors?.[0]?.description;
      showToast(reason || 'No bus/MRT route found between those points.');
      els.itineraryOptions.classList.add('hidden');
      els.itineraryOptions.innerHTML = '';
      transitItineraries = [];
      hideRoutePreviewMap();
      return;
    }

    // The server already sorts these — fastest first, with a modest priority
    // boost for MRT/LRT-inclusive routes (rail is generally faster and less
    // traffic-prone than an all-bus trip, so it's shown/selected by default
    // even when a bus option is a few minutes quicker on paper). Trust that
    // order here rather than re-sorting by raw duration, which would undo it.
    transitItineraries = [...data.itineraries];
    renderItineraryOptions();
    selectItinerary(0);
    checkRainAlert(fromCoords, toCoords); // transit always includes walk legs to/from stops
  } catch (err) {
    console.error(err);
    showToast('Transit routing service unavailable. Please try again.');
  } finally {
    els.getDirectionsBtn.disabled = false;
    els.getDirectionsBtn.textContent = 'Get Directions';
  }
}

// Renders the list of alternative itineraries as selectable cards, e.g.
// "🚶 → 🚇 → 🚶   32 min   5:38p–6:10p". Clicking a card switches the
// summary and step list to that option.
function renderItineraryOptions() {
  els.itineraryOptions.innerHTML = '';

  if (transitItineraries.length < 2) {
    els.itineraryOptions.classList.add('hidden');
    if (els.itineraryOptionsLabel) els.itineraryOptionsLabel.classList.add('hidden');
    return;
  }

  els.itineraryOptions.classList.remove('hidden');

  // Easy to miss that the fastest pick isn't the only option (e.g. an
  // MRT+bus alternative a couple minutes slower than the top all-bus
  // pick) — flag how many others there are to compare.
  if (els.itineraryOptionsLabel) {
    const moreCount = transitItineraries.length - 1;
    els.itineraryOptionsLabel.textContent = `${moreCount} more option${moreCount === 1 ? '' : 's'}`;
    els.itineraryOptionsLabel.classList.remove('hidden');
  }

  // The server may put an MRT/LRT-inclusive itinerary first even when it's
  // not literally the quickest by the clock (rail gets a modest priority
  // boost over bus — see server.js). So "Fastest" needs to track actual
  // duration, not just array position, or it'd mislabel a slower option.
  const fastestDuration = Math.min(...transitItineraries.map((it) => it.duration));

  transitItineraries.forEach((itinerary, i) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'itinerary-option' + (i === selectedItineraryIndex ? ' active' : '');

    const modes = document.createElement('span');
    modes.className = 'io-modes';
    const transitLegs = itinerary.legs.filter((l) => l.mode !== 'walk');
    transitLegs.forEach((leg, idx) => {
      if (idx > 0) {
        const sep = document.createElement('span');
        sep.className = 'io-sep';
        sep.textContent = '›';
        modes.appendChild(sep);
      }
      if (leg.mode === 'train' && leg.routeColor) {
        modes.appendChild(lineBadge(leg));
      } else {
        const icon = document.createElement('span');
        icon.textContent = MODE_ICON[leg.mode] || '➜';
        modes.appendChild(icon);
      }
    });

    const main = document.createElement('span');
    main.className = 'io-main';
    const duration = document.createElement('span');
    duration.className = 'io-duration';
    duration.textContent = formatDuration(itinerary.duration);
    const time = document.createElement('span');
    time.className = 'io-time';
    time.textContent = `${formatClockTime(itinerary.startTime)} – ${formatClockTime(itinerary.endTime)}`;
    main.appendChild(duration);
    main.appendChild(time);
    if (itinerary.fareEstimate != null) {
      const fare = document.createElement('span');
      fare.className = 'io-fare';
      fare.textContent = formatFare(itinerary.fareEstimate);
      main.appendChild(fare);
    }

    const transferCount = Math.max(transitLegs.length - 1, 0);
    const transferText = transferCount > 0 ? `${transferCount} transfer${transferCount > 1 ? 's' : ''}` : 'Direct';
    const isFastest = itinerary.duration === fastestDuration;
    const hasRail = transitLegs.some((l) => l.mode === 'train');
    const isRecommendedPick = i === 0 && !isFastest && hasRail;

    const badge = document.createElement('span');
    badge.className = 'io-badge' + (isFastest || isRecommendedPick ? ' io-badge-fastest' : '');
    if (isFastest) badge.textContent = `Fastest · ${transferText}`;
    else if (isRecommendedPick) badge.textContent = `🚇 Recommended · ${transferText}`;
    else badge.textContent = transferText;

    card.appendChild(modes);
    card.appendChild(main);
    card.appendChild(badge);

    card.addEventListener('click', () => selectItinerary(i));
    els.itineraryOptions.appendChild(card);
  });
}

function selectItinerary(index) {
  selectedItineraryIndex = index;
  const itinerary = transitItineraries[index];
  if (!itinerary) return;

  els.itineraryOptions.querySelectorAll('.itinerary-option').forEach((card, i) => {
    card.classList.toggle('active', i === index);
  });

  renderTransitSummary(itinerary);
  renderTransitSteps(itinerary);
  renderRoutePreviewMap(transitPreviewSegments(itinerary));
}

function formatClockTime(ms) {
  return new Date(ms).toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// Adult card fare estimate — see the matching table on the server
// (/api/transit-plan). Approximate: actual fare depends on peak/off-peak
// timing and any promotions, so it's always shown with a "~" prefix.
function formatFare(fare) {
  return `~$${fare.toFixed(2)}`;
}

function renderTransitSummary(itinerary) {
  els.routeSummary.classList.remove('hidden');
  const transfers = itinerary.legs.filter((l) => l.mode !== 'walk').length;
  const transferText = transfers > 1 ? `${transfers - 1} transfer${transfers > 2 ? 's' : ''}` : 'Direct';
  const fareText = itinerary.fareEstimate != null ? ` &nbsp;·&nbsp; ${formatFare(itinerary.fareEstimate)}` : '';
  els.routeSummary.innerHTML = `<strong>${formatDuration(itinerary.duration)}</strong> &nbsp;·&nbsp; `
    + `${formatClockTime(itinerary.startTime)} – ${formatClockTime(itinerary.endTime)} &nbsp;·&nbsp; ${transferText}${fareText}`;
  renderRideHailingLinks();
}

function renderTransitSteps(itinerary) {
  stopWakeAlert(false); // old leg buttons are about to be torn down
  clearArrivalIntervalsIn(els.routeSteps); // old arrivals panels are about to be torn down
  els.routeSteps.innerHTML = '';
  itinerary.legs.forEach((leg) => {
    const li = document.createElement('li');
    li.className = 'route-step';

    const row = document.createElement('div');
    row.className = 'route-step-row';

    const useLineBadge = leg.mode === 'train' && leg.routeColor;
    const icon = useLineBadge ? lineBadge(leg) : document.createElement('span');
    if (!useLineBadge) {
      icon.className = 'step-num';
      icon.textContent = MODE_ICON[leg.mode] || '➜';
    } else {
      icon.classList.add('step-num-badge');
    }

    const text = document.createElement('span');
    if (leg.mode === 'walk') {
      const toCode = leg.toStopCode ? ` (Bus Stop ${leg.toStopCode})` : '';
      text.textContent = `Walk to ${leg.to}${toCode} — ${formatDistance(leg.distance)}, ${formatDuration(leg.duration)}`;
    } else {
      // For a train leg with a real line badge already showing "DT"/"TE"/etc,
      // don't repeat "Line DT" in the text too — just the full line name if
      // we know it, otherwise fall back to the raw code like before.
      const line = leg.mode === 'train'
        ? (useLineBadge && MRT_LINE_NAMES[leg.routeName] ? MRT_LINE_NAMES[leg.routeName] : (leg.routeName ? `Line ${leg.routeName}` : leg.mode))
        : (leg.routeName ? `Bus ${leg.routeName}` : leg.mode);
      const headsign = leg.headsign ? ` towards ${leg.headsign}` : '';
      const fromCode = leg.fromStopCode ? ` (${leg.fromStopCode})` : '';
      const toCode = leg.toStopCode ? ` (${leg.toStopCode})` : '';
      // The alighting stop (leg.to) is bolded, not the "via X" headsign —
      // "via Renjong" is just a boarding-direction hint (like a bus's
      // headsign), not where to get off, but it used to sit right next to
      // the bold line name while the real stop to alight at (leg.to) was
      // buried in a plain sentence. That's a real way to get off at the
      // wrong stop, not just a cosmetic nitpick — confirmed by a user who
      // did exactly that after boarding "towards SW Loop via Renjong" and
      // assumed Renjong was the destination.
      text.innerHTML = `<strong>${line}</strong>${headsign}<br>`
        + `${leg.from}${fromCode} → <strong>${leg.to}${toCode}</strong> — ${formatDuration(leg.duration)} (${formatClockTime(leg.startTime)})`;
    }
    row.appendChild(icon);
    row.appendChild(text);
    li.appendChild(row);

    // Full stop-by-stop list for this leg — leg.stops is already the
    // complete boarding-to-alighting sequence from OTP's intermediateStops
    // (see server.js; the "Wake me up" countdown below already relies on
    // it), just never rendered as a visible list before. Only worth
    // showing when there's at least one stop between boarding and
    // alighting — those two are already named in the bolded line above.
    if (leg.mode !== 'walk' && Array.isArray(leg.stops) && leg.stops.length > 2) {
      const stopsRow = document.createElement('div');
      stopsRow.className = 'step-stops-row';

      const stopCount = leg.stops.length - 2;
      const stopsBtn = document.createElement('button');
      stopsBtn.type = 'button';
      stopsBtn.className = 'stops-list-btn';
      stopsBtn.textContent = `🚏 Show ${stopCount} stop${stopCount === 1 ? '' : 's'}`;

      const stopsList = document.createElement('ol');
      stopsList.className = 'stops-list-panel hidden';
      leg.stops.forEach((s, i) => {
        const stopLi = document.createElement('li');
        if (i === 0) stopLi.innerHTML = `<strong>${s.name}</strong> <span class="stop-tag">Board here</span>`;
        else if (i === leg.stops.length - 1) stopLi.innerHTML = `<strong>${s.name}</strong> <span class="stop-tag">Alight here</span>`;
        else stopLi.textContent = s.name;
        stopsList.appendChild(stopLi);
      });

      stopsBtn.addEventListener('click', () => {
        const opening = stopsList.classList.contains('hidden');
        stopsList.classList.toggle('hidden', !opening);
        stopsBtn.classList.toggle('active', opening);
        stopsBtn.textContent = opening ? '🚏 Hide stops' : `🚏 Show ${stopCount} stop${stopCount === 1 ? '' : 's'}`;
      });

      stopsRow.appendChild(stopsBtn);
      stopsRow.appendChild(stopsList);
      li.appendChild(stopsRow);
    }

    // "Wake me up" alert: only makes sense on a bus/train leg with a real
    // alighting-stop location to watch your live position against.
    if (leg.mode !== 'walk' && leg.toLat != null && leg.toLon != null) {
      const wakeRow = document.createElement('div');
      wakeRow.className = 'step-wake-row';

      const wakeBtn = document.createElement('button');
      wakeBtn.type = 'button';
      wakeBtn.className = 'wake-btn';
      wakeBtn.textContent = '🔔 Wake me up';

      const status = document.createElement('span');
      status.className = 'wake-status';

      wakeBtn.addEventListener('click', () => toggleWakeAlert(leg, wakeBtn, status));

      wakeRow.appendChild(wakeBtn);
      wakeRow.appendChild(status);
      li.appendChild(wakeRow);
    }

    // Live arrivals for every bus service at this leg's boarding stop — not
    // just the one route in the itinerary, so you can see if an earlier bus
    // works too.
    if (leg.mode === 'bus' && leg.fromStopCode) {
      const arrivalsRow = document.createElement('div');
      arrivalsRow.className = 'step-arrivals-row';

      const btnRow = document.createElement('div');
      btnRow.className = 'step-arrivals-btn-row';

      const arrivalsBtn = document.createElement('button');
      arrivalsBtn.type = 'button';
      arrivalsBtn.className = 'arrivals-btn';
      arrivalsBtn.textContent = '🚌 Live arrivals';

      const favBtn = document.createElement('button');
      favBtn.type = 'button';
      favBtn.className = 'fav-quick-btn';
      favBtn.title = 'Save to Favourites';
      favBtn.textContent = isFavourite(leg.fromStopCode) ? '★' : '☆';
      favBtn.addEventListener('click', () => {
        toggleFavourite({ code: leg.fromStopCode, name: leg.from });
        favBtn.textContent = isFavourite(leg.fromStopCode) ? '★' : '☆';
      });

      const panel = document.createElement('div');
      panel.className = 'arrivals-panel hidden';

      arrivalsBtn.addEventListener('click', () => toggleArrivalsPanel(leg.fromStopCode, arrivalsBtn, panel));

      btnRow.appendChild(arrivalsBtn);
      btnRow.appendChild(favBtn);
      arrivalsRow.appendChild(btnRow);
      arrivalsRow.appendChild(panel);
      li.appendChild(arrivalsRow);
    }

    els.routeSteps.appendChild(li);
  });
}

function formatDuration(seconds) {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${h} hr ${m} min`;
}

function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function renderRouteSummary(route) {
  els.routeSummary.classList.remove('hidden');
  els.routeSummary.innerHTML = `<strong>${formatDuration(route.duration)}</strong> &nbsp;·&nbsp; ${formatDistance(route.distance)}`;
  renderRideHailingLinks();
  const coords = route.geometry && route.geometry.coordinates;
  if (coords && coords.length) {
    renderRoutePreviewMap([{ latlngs: coords.map(([lon, lat]) => [lat, lon]), color: '#2563eb' }]);
  } else {
    hideRoutePreviewMap();
  }
}

// ---- Ride-hailing quick links (Grab / Gojek / Ryde / TADA) ------------------
//
// None of these four apps publishes an OFFICIAL, developer-documented deep
// link format for pre-filling a pickup location. Each app below uses
// whatever's the most solid mechanism actually found for it — updated after
// live testing showed the two pure guesses (ryde://, tada://) didn't work:
//   - Grab: "grab://open?screenType=BOOKING&pickUpLatitude=...&pickUpLongitude
//     =..." is a widely-used pattern across many real-world affiliate/OneLink
//     integrations (hotel/mall sites' "Book a Grab" buttons) — not something
//     we invented, but also not a page Grab themselves publish. Confirmed
//     working (pre-fills pickup) via live testing.
//   - Gojek: "gojek://" is an unverified guess at the bare scheme (no pickup
//     pre-fill possible — no known param format), but confirmed via live
//     testing to actually open the app.
//   - Ryde: the raw "ryde://" guess did NOT open the app in testing. Found
//     instead that rydesharing.com's own download button links to
//     "https://ryde.app.link/download-ryde" — Ryde's own official Branch.io
//     universal link. That's used directly below: no guessing, and Branch's
//     own infrastructure (not us) handles "open the app if installed, else
//     show a download page" — no pickup pre-fill, but a real, working open.
//   - TADA: the raw "tada://" guess also did NOT open the app, and unlike
//     Ryde, no universal link, smart banner, or any deep-link mechanism at
//     all could be found anywhere for TADA (their own site, App Store
//     listing, docs). So this now just opens the correct store listing
//     directly — no broken guess in the way.
// The custom-scheme guesses (Grab, Gojek) share one safety net: if the
// scheme doesn't launch anything within RIDE_DEEP_LINK_TIMEOUT_MS (app not
// installed, or the guess is wrong), the tab silently continues to the
// normal store/website link instead of getting stuck on a blank screen.
const RIDE_HAILING_APPS = {
  grab: {
    label: 'Grab',
    iosAppId: '647268330',
    androidPackage: 'com.grabtaxi.passenger',
    webUrl: 'https://www.grab.com/sg/transport/',
    buildDeepLink: (from, to) => {
      const params = new URLSearchParams({
        screenType: 'BOOKING',
        pickUpLatitude: from.lat,
        pickUpLongitude: from.lon,
      });
      if (from.label) params.set('pickUpAddress', from.label);
      // Same affiliate-integration pattern as pickUp* above, mirrored for
      // dropoff — carries over the destination you already searched for
      // (e.g. tapping "Gardens by the Bay" then Get Directions) so Grab
      // doesn't just get your current location with nowhere to go.
      if (to) {
        params.set('dropOffLatitude', to.lat);
        params.set('dropOffLongitude', to.lon);
        if (to.label) params.set('dropOffAddress', to.label);
      }
      return `grab://open?${params.toString()}`;
    },
  },
  gojek: {
    label: 'Gojek',
    iosAppId: '944875099',
    androidPackage: 'com.gojek.app',
    webUrl: 'https://www.gojek.com/sg',
    // Unverified guess at the bare scheme, but confirmed working live —
    // no pickup pre-fill (see note above).
    buildDeepLink: () => 'gojek://',
  },
  ryde: {
    label: 'Ryde',
    iosAppId: '979806982',
    androidPackage: 'com.rydesharing.ryde',
    webUrl: 'https://rydesharing.com/',
    // Ryde's own official Branch.io universal link (see note above) — opens
    // the installed app directly, or Branch's own download page if it
    // isn't. No pickup pre-fill, but no guessing either.
    universalLink: 'https://ryde.app.link/download-ryde',
  },
  tada: {
    label: 'TADA',
    iosAppId: '1412329684',
    androidPackage: 'io.mvlchain.tada',
    // No standalone consumer marketing site could be verified — the Play
    // Store listing is the most reliable link to fall back to on desktop.
    webUrl: 'https://play.google.com/store/apps/details?id=io.mvlchain.tada',
    // No deep-link/universal-link mechanism found anywhere (see note above)
    // — deliberately no buildDeepLink here, straight to the store listing.
  },
};

const RIDE_DEEP_LINK_TIMEOUT_MS = 1500;

function openRideHailingApp(appId) {
  const app = RIDE_HAILING_APPS[appId];
  if (!app) return;
  const ua = navigator.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isMobile = isIOS || isAndroid;

  let fallbackUrl = app.webUrl;
  if (isIOS && app.iosAppId) fallbackUrl = `https://apps.apple.com/sg/app/id${app.iosAppId}`;
  else if (isAndroid && app.androidPackage) fallbackUrl = `https://play.google.com/store/apps/details?id=${app.androidPackage}`;

  // A verified https:// universal/app-link (Ryde) — the service's own
  // infrastructure handles "open app if installed, else show download
  // page," so this needs no guessing or timeout dance, unlike the schemes
  // below.
  if (isMobile && app.universalLink) {
    window.location.href = app.universalLink;
    return;
  }

  // Best-effort deep link with pickup (and, where supported, dropoff)
  // pre-filled — only attempted on mobile (custom schemes are meaningless on
  // desktop), and only when we actually have a "from" location to pre-fill.
  // If nothing intercepts the navigation (app not installed, or the scheme
  // is wrong), the page stays visible and the timeout below quietly
  // continues to the normal link.
  if (isMobile && app.buildDeepLink && fromCoords) {
    let leftPage = false;
    const markLeft = () => { leftPage = true; };
    document.addEventListener('visibilitychange', markLeft, { once: true });
    window.addEventListener('pagehide', markLeft, { once: true });
    window.location.href = app.buildDeepLink(fromCoords, toCoords);
    setTimeout(() => {
      document.removeEventListener('visibilitychange', markLeft);
      if (!leftPage) window.location.href = fallbackUrl;
    }, RIDE_DEEP_LINK_TIMEOUT_MS);
    return;
  }

  window.open(fallbackUrl, '_blank', 'noopener');
}

let rideHailingLinksWired = false;
function renderRideHailingLinks() {
  if (!els.rideHailingLinks) return;
  els.rideHailingLinks.classList.remove('hidden');
  if (rideHailingLinksWired) return;
  rideHailingLinksWired = true;
  els.rideHailingLinks.querySelectorAll('.ride-hailing-btn[data-ride-app]').forEach((btn) => {
    btn.addEventListener('click', () => openRideHailingApp(btn.dataset.rideApp));
  });
}

const STEP_ICONS = {
  depart: '🚩', arrive: '🏁', turn: '↪', merge: '↗', roundabout: '⟳',
  'roundabout turn': '⟳', fork: '⑂', 'end of road': '⤴', continue: '⬆',
  new_name: '⬆', notification: 'ℹ', default: '➜'
};

function stepIcon(maneuver) {
  return STEP_ICONS[maneuver.type] || STEP_ICONS.default;
}

function stepVerb(maneuver) {
  return maneuver.type === 'depart' ? 'Head out'
    : maneuver.type === 'arrive' ? 'Arrive at destination'
    : `${maneuver.type.replace(/_/g, ' ')}${maneuver.modifier ? ' ' + maneuver.modifier : ''}`;
}

function renderRouteSteps(route) {
  els.routeSteps.innerHTML = '';
  const steps = route.legs.flatMap(leg => leg.steps);
  steps.forEach((step, i) => {
    const li = document.createElement('li');
    li.id = `route-step-${i}`;
    li.dataset.stepIndex = String(i);
    const num = document.createElement('span');
    num.className = 'step-num';
    num.textContent = stepIcon(step.maneuver);
    const text = document.createElement('span');
    const name = step.name ? ` onto ${step.name}` : '';
    text.textContent = `${stepVerb(step.maneuver)}${name} — ${formatDistance(step.distance)}`;
    li.appendChild(num);
    li.appendChild(text);
    els.routeSteps.appendChild(li);
  });
}

// ---------- "Wake me up" — alerts you as you approach a bus/train alighting stop ----------
// Watches your live GPS position against the leg's destination stop and beeps +
// vibrates + shows a banner once you're close, repeating until dismissed — useful
// if you doze off on a long bus ride.

const WAKE_ALERT_THRESHOLD_M = 300; // distance to alighting stop that triggers the alert
const WAKE_REPEAT_MS = 8000; // how often to re-beep while the banner is up, undismissed

let wakeState = null; // { watchId, repeatTimer, btnEl, statusEl, targetName, triggered, stops, stopCursor }
let wakeAudioCtx = null;
let wakeWakeLock = null; // screen wake lock — keeps the tab foregrounded/tracking while armed

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Straight-line compass direction from point 1 to point 2, as an 8-point
// compass label (N/NE/E/...). Used as an offline fallback when OSRM routing
// isn't reachable — GPS still works with no signal, turn-by-turn doesn't.
function bearingCompass(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2))
    - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  const bearingDeg = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const label = points[Math.round(bearingDeg / 45) % 8];
  return { degrees: Math.round(bearingDeg), label };
}

function formatDistanceShort(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function playWakeBeep() {
  try {
    if (!wakeAudioCtx) wakeAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (wakeAudioCtx.state === 'suspended') wakeAudioCtx.resume();
    const now = wakeAudioCtx.currentTime;
    [0, 0.3, 0.6].forEach((offset) => {
      const osc = wakeAudioCtx.createOscillator();
      const gain = wakeAudioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      osc.connect(gain);
      gain.connect(wakeAudioCtx.destination);
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.35, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.25);
      osc.start(now + offset);
      osc.stop(now + offset + 0.3);
    });
  } catch (err) {
    console.error('beep failed:', err);
  }
  if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]);
}

function toggleWakeAlert(leg, btnEl, statusEl) {
  if (wakeState && wakeState.btnEl === btnEl) {
    stopWakeAlert(true);
    return;
  }
  startWakeAlert(leg, btnEl, statusEl);
}

async function startWakeAlert(leg, btnEl, statusEl) {
  if (!navigator.geolocation) {
    showToast('Geolocation is not supported by your browser.');
    return;
  }
  stopWakeAlert(false); // only one active watch at a time

  // Keep the screen on while the alert is armed — without this, mobile
  // browsers dim/lock the screen and then suspend the background tab,
  // silently killing the geolocation watch (the #1 reason this alert
  // wouldn't fire). Same approach turn-by-turn nav already uses.
  if ('wakeLock' in navigator) {
    try {
      wakeWakeLock = await navigator.wakeLock.request('screen');
    } catch (err) {
      console.error('wake lock failed:', err); // non-fatal — screen may just dim/sleep
    }
  }

  const targetName = leg.to || 'your stop';
  // leg.stops is the full boarding-to-alighting stop sequence (from server.js,
  // via OTP's intermediateStops) — used to count down remaining stops, not
  // just distance. Falls back to distance-only if it's missing or too short
  // to be meaningful (e.g. an older cached itinerary from before this shipped).
  const stops = Array.isArray(leg.stops) && leg.stops.length >= 2 ? leg.stops : null;
  wakeState = {
    watchId: null, repeatTimer: null, btnEl, statusEl, targetName, triggered: false,
    stops, stopCursor: 0,
  };
  btnEl.textContent = '🔕 Cancel alert';
  btnEl.classList.add('active');
  statusEl.textContent = 'Locating you…';
  showToast(`We'll wake you up near ${targetName}.`);

  wakeState.watchId = navigator.geolocation.watchPosition(
    (pos) => {
      if (!wakeState) return;
      const dist = haversineMeters(pos.coords.latitude, pos.coords.longitude, leg.toLat, leg.toLon);

      let stopsText = '';
      let atStopText = '';
      if (wakeState.stops) {
        // NOTE: GeolocationCoordinates uses `.latitude`/`.longitude`, not
        // `.lat`/`.lon` — a prior version of this destructured `pos.coords`
        // as `{ lat, lon }`, which is always undefined on a real position
        // fix. That silently made every haversineMeters() call below return
        // NaN, so the while loop's `distNext < distCur` compare was always
        // false and stopCursor could never advance past the boarding stop —
        // the "N stops to go" countdown was frozen for the whole ride.
        const { latitude: lat, longitude: lon } = pos.coords;
        const lastIdx = wakeState.stops.length - 1;
        // Advance past any stop we're now clearly closer to the NEXT stop
        // than to it — handles sparse GPS updates (e.g. bus passed 2 stops
        // between fixes) by looping rather than only checking one step.
        while (wakeState.stopCursor < lastIdx) {
          const cur = wakeState.stops[wakeState.stopCursor];
          const next = wakeState.stops[wakeState.stopCursor + 1];
          if (cur.lat == null || cur.lon == null || next.lat == null || next.lon == null) break;
          const distCur = haversineMeters(lat, lon, cur.lat, cur.lon);
          const distNext = haversineMeters(lat, lon, next.lat, next.lon);
          if (distNext < distCur) wakeState.stopCursor += 1;
          else break;
        }
        const stopsRemaining = lastIdx - wakeState.stopCursor;
        if (stopsRemaining > 0) {
          stopsText = ` · ${stopsRemaining} stop${stopsRemaining === 1 ? '' : 's'} to go`;
        } else {
          stopsText = ' · next stop';
        }
        // Name the stop we're currently nearest to (this is derived from OUR
        // OWN GPS fix against the ride's stop sequence, not a live bus AVL
        // feed — it's "which stop you're at", which for a passenger riding
        // the bus is the same thing). Skip it once we've reached the last
        // entry in the list, since that's just targetName again and the
        // "to ${targetName}" phrase already says that.
        const currentStopName = wakeState.stops[wakeState.stopCursor] && wakeState.stops[wakeState.stopCursor].name;
        if (currentStopName && wakeState.stopCursor < lastIdx) {
          atStopText = ` · at ${currentStopName}`;
        }
      }

      wakeState.statusEl.textContent = `📍 ${formatDistance(dist)} to ${targetName}${atStopText}${stopsText}`;
      if (dist <= WAKE_ALERT_THRESHOLD_M && !wakeState.triggered) {
        wakeState.triggered = true;
        triggerWakeAlert(targetName);
      }
    },
    (err) => {
      console.error('wake-alert geolocation error:', err);
      showToast(geoErrorMessage(err) + ' (needed for the wake-up alert)');
      stopWakeAlert(false);
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
}

function triggerWakeAlert(targetName) {
  playWakeBeep();
  els.wakeAlertText.textContent = `Approaching ${targetName} — get ready to alight!`;
  els.wakeAlert.classList.remove('hidden');
  if (wakeState) {
    clearInterval(wakeState.repeatTimer);
    wakeState.repeatTimer = setInterval(playWakeBeep, WAKE_REPEAT_MS);
  }
}

function stopWakeAlert(showMsg) {
  if (!wakeState) {
    els.wakeAlert.classList.add('hidden');
    return;
  }
  if (wakeState.watchId != null) navigator.geolocation.clearWatch(wakeState.watchId);
  clearInterval(wakeState.repeatTimer);
  if (wakeWakeLock) {
    wakeWakeLock.release().catch(() => {});
    wakeWakeLock = null;
  }
  if (wakeState.btnEl) {
    wakeState.btnEl.textContent = '🔔 Wake me up';
    wakeState.btnEl.classList.remove('active');
  }
  if (wakeState.statusEl) wakeState.statusEl.textContent = '';
  els.wakeAlert.classList.add('hidden');
  if (showMsg) showToast('Wake-up alert cancelled.');
  wakeState = null;
}

els.wakeAlertDismiss.addEventListener('click', () => stopWakeAlert(false));

// ---------- Live bus arrivals (LTA DataMall, via /api/bus-arrivals) ----------
// Shows every bus service due at a stop, not just the one in the itinerary —
// useful for spotting an earlier bus on a different service that also works.

const ARRIVALS_REFRESH_MS = 20000;

// Arrivals panels can live in more than one place at once (a directions step,
// a Favourites row) — each panel tracks its own refresh interval on itself
// (panel._refreshInterval), and this sweeps just the ones inside a given
// container right before that container's contents get torn down/rebuilt.
function clearArrivalIntervalsIn(container) {
  container.querySelectorAll('.arrivals-panel').forEach((panel) => {
    if (panel._refreshInterval) clearInterval(panel._refreshInterval);
    if (panel._tickInterval) clearInterval(panel._tickInterval);
  });
}

function formatArrivalMins(iso) {
  if (!iso) return null;
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  return mins <= 0 ? 'Arr' : `${mins} min`;
}

// LTA's Load field on each bus: SEA = seats available, SDA = standing
// available (no seats but comfortable), LSD = limited standing (packed).
const LOAD_LABELS = { SEA: 'Seats available', SDA: 'Standing available', LSD: 'Limited standing — packed' };
function loadClass(load) {
  return load && LOAD_LABELS[load] ? `load-${load.toLowerCase()}` : 'load-unknown';
}
function loadLabel(load) {
  return LOAD_LABELS[load] || 'Crowding unknown';
}

// "Xs ago" / "Xm ago" label so it's always clear how fresh the data on
// screen actually is, rather than silently trusting a stale fetch.
function formatAgo(fetchedAtMs) {
  const secs = Math.max(0, Math.round((Date.now() - fetchedAtMs) / 1000));
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  return `${Math.round(secs / 60)}m ago`;
}

function updateArrivalsMeta(panel) {
  const el = panel.querySelector('.arrivals-updated');
  if (el && panel._fetchedAt) el.textContent = formatAgo(panel._fetchedAt);
}

async function fetchAndRenderArrivals(busStopCode, panel) {
  try {
    const res = await fetch(`/api/bus-arrivals?busStopCode=${encodeURIComponent(busStopCode)}`);
    const data = await res.json();

    if (!res.ok) {
      panel.innerHTML = `<div class="arrivals-error">${data.error || 'Live arrivals unavailable.'}</div>`;
      return;
    }

    if (!data.services || !data.services.length) {
      panel.innerHTML = `<div class="arrivals-error">No live data for this stop right now.</div>`;
      return;
    }

    panel._fetchedAt = data.fetchedAt ? new Date(data.fetchedAt).getTime() : Date.now();

    panel.innerHTML = '';
    const meta = document.createElement('div');
    meta.className = 'arrivals-meta';
    meta.innerHTML = '<span class="live-badge"><span class="arrivals-live-dot">●</span>Live</span> · updated <span class="arrivals-updated">just now</span>';
    panel.appendChild(meta);

    const legend = document.createElement('div');
    legend.className = 'arrivals-legend';
    legend.innerHTML =
      '<span class="load-dot load-sea"></span>Seats' +
      '<span class="load-dot load-sda"></span>Standing' +
      '<span class="load-dot load-lsd"></span>Packed';
    panel.appendChild(legend);

    data.services.forEach((svc) => {
      const row = document.createElement('div');
      row.className = 'arrival-row';
      const num = document.createElement('span');
      num.className = 'arrival-service';
      num.textContent = svc.serviceNo;
      const times = document.createElement('span');
      times.className = 'arrival-times';

      const validArrivals = svc.nextArrivals.filter((a) => formatArrivalMins(a.estimatedArrival));
      if (!validArrivals.length) {
        times.textContent = 'No estimate';
      } else {
        validArrivals.forEach((a) => {
          const chip = document.createElement('span');
          const arrivalText = formatArrivalMins(a.estimatedArrival);
          chip.className = arrivalText === 'Arr' ? 'arrival-chip arrival-now' : 'arrival-chip';
          const titleParts = [loadLabel(a.load)];

          const label = document.createElement('span');
          label.textContent = arrivalText;
          chip.appendChild(label);

          if (a.type === 'DD') {
            const badge = document.createElement('span');
            badge.className = 'bus-badge';
            badge.textContent = 'DD';
            chip.appendChild(badge);
            titleParts.push('Double-deck bus');
          } else if (a.type === 'BD') {
            const badge = document.createElement('span');
            badge.className = 'bus-badge';
            badge.textContent = 'BD';
            chip.appendChild(badge);
            titleParts.push('Bendy bus');
          }

          if (a.wheelchairAccessible) {
            const wc = document.createElement('span');
            wc.className = 'bus-badge wc-badge';
            wc.textContent = '♿';
            chip.appendChild(wc);
            titleParts.push('Wheelchair accessible');
          }

          const dot = document.createElement('span');
          dot.className = `load-dot ${loadClass(a.load)}`;
          chip.appendChild(dot);

          chip.title = titleParts.join(' · ');
          times.appendChild(chip);
        });
      }

      row.appendChild(num);
      row.appendChild(times);
      panel.appendChild(row);
    });

    updateArrivalsMeta(panel);
  } catch (err) {
    console.error(err);
    panel.innerHTML = `<div class="arrivals-error">Could not load live arrivals.</div>`;
  }
}

function toggleArrivalsPanel(busStopCode, btnEl, panel) {
  const isOpen = !panel.classList.contains('hidden');
  if (isOpen) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    if (panel._refreshInterval) {
      clearInterval(panel._refreshInterval);
      panel._refreshInterval = null;
    }
    if (panel._tickInterval) {
      clearInterval(panel._tickInterval);
      panel._tickInterval = null;
    }
    btnEl.textContent = '🚌 Live arrivals';
    btnEl.classList.remove('active');
    return;
  }

  panel.classList.remove('hidden');
  panel.innerHTML = '<div class="arrivals-error">Loading…</div>';
  btnEl.textContent = '🚌 Hide arrivals';
  btnEl.classList.add('active');
  fetchAndRenderArrivals(busStopCode, panel);
  panel._refreshInterval = setInterval(() => fetchAndRenderArrivals(busStopCode, panel), ARRIVALS_REFRESH_MS);
  panel._tickInterval = setInterval(() => updateArrivalsMeta(panel), 1000);
}

// ---------- Nearby stops with live arrivals (Bus Arrival Time tab default) ----------
// Auto-geolocates the moment this tab opens and shows the closest stops with
// live bus times already visible, instead of the old search-then-favourite-
// then-tap-to-expand flow just to see what's coming right now. The search
// box and saved Favourites further down still work exactly as before, for a
// stop worth checking regardless of current location (e.g. one near home).

const NEARBY_ARRIVALS_REFRESH_MS = 20000;
let nearbyArrivalsTimer = null;
let nearbyArrivalsCoords = null;
let nearbyArrivalsLoading = false;

function formatNearbyArrival(iso) {
  if (!iso) return null;
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  return mins <= 0 ? 'Arr' : `${mins} min`;
}

function renderNearbyArrivals(stops) {
  els.nearbyArrivalsList.innerHTML = '';
  if (!stops || !stops.length) {
    els.nearbyArrivalsList.innerHTML = '<p class="hint">No bus stops found near you.</p>';
    return;
  }

  stops.forEach((stop) => {
    const group = document.createElement('div');
    group.className = 'nearby-stop-group';

    const header = document.createElement('div');
    header.className = 'nearby-stop-header';
    header.innerHTML = `
      <span class="nearby-stop-icon">🚏</span>
      <span class="nearby-stop-name">${escapeHtml(stop.name)}</span>
      <span class="nearby-stop-code">(${escapeHtml(stop.code)})</span>
      <span class="nearby-stop-distance">${formatDistance(stop.distance)}</span>
      <span class="nearby-stop-chevron">›</span>
    `;
    // Tapping the header saves it to Favourites (same as picking a search
    // result) — a quick way to pin a stop that keeps showing up nearby.
    header.addEventListener('click', () => {
      if (isFavourite(stop.code)) {
        showToast(`${stop.name} is already in your Favourites.`);
        return;
      }
      favourites.push({ code: stop.code, name: stop.name });
      saveFavourites();
      renderFavourites();
      showToast(`Added ${stop.name} to Favourites.`);
    });
    group.appendChild(header);

    const card = document.createElement('div');
    card.className = 'nearby-stop-card';

    if (stop.error) {
      card.innerHTML = `<div class="nearby-service-error">${escapeHtml(stop.error)}</div>`;
    } else if (!stop.services || !stop.services.length) {
      card.innerHTML = '<div class="nearby-service-error">No services listed for this stop.</div>';
    } else {
      stop.services.forEach((svc) => {
        const validArrivals = (svc.nextArrivals || []).filter((a) => formatNearbyArrival(a.estimatedArrival));
        if (!validArrivals.length) {
          // Nothing due right now — a bare pill instead of a row with no
          // useful time in it (mirrors how real-world SG bus apps show a
          // service that's in the schedule but has no live estimate).
          const pill = document.createElement('span');
          pill.className = 'nearby-service-pill';
          pill.textContent = svc.serviceNo;
          card.appendChild(pill);
          return;
        }

        const row = document.createElement('div');
        row.className = 'nearby-service-row';

        const no = document.createElement('span');
        no.className = 'nearby-service-no';
        no.textContent = svc.serviceNo;

        const info = document.createElement('div');
        info.className = 'nearby-service-info';
        const destText = svc.destinationName
          ? `To ${svc.destinationName}${svc.destinationCode ? ` (${svc.destinationCode})` : ''}`
          : 'Destination unknown';
        info.innerHTML = `<div class="nearby-service-dest">${escapeHtml(destText)}</div>`;

        const times = document.createElement('div');
        times.className = 'nearby-service-times';
        const [first, ...rest] = validArrivals;
        const primary = document.createElement('div');
        // Live in the sense that matters here: every number LTA returns is
        // a real-time prediction, not a fixed timetable slot — there's no
        // separate "scheduled, not tracked" mode to distinguish it from.
        const firstMins = Math.round((new Date(first.estimatedArrival).getTime() - Date.now()) / 60000);
        const isArrivingNow = firstMins <= 0;
        primary.className = isArrivingNow ? 'nearby-service-primary arrival-now' : 'nearby-service-primary';
        // Value/unit are split into their own spans (.hero-number) so dark
        // mode can blow the number up into a big standalone digit — see
        // .hero-number in style.css — while light mode keeps them inline.
        const heroValue = isArrivingNow ? 'Arr' : String(firstMins);
        const heroUnit = isArrivingNow ? '' : 'MIN';
        primary.innerHTML = `<span class="nearby-live-icon">📶</span><span class="hero-number"><span class="hero-number-value">${heroValue}</span>${heroUnit ? `<span class="hero-number-unit">${heroUnit}</span>` : ''}</span>`;
        times.appendChild(primary);
        if (rest.length) {
          const secondary = document.createElement('div');
          secondary.className = 'nearby-service-secondary';
          secondary.textContent = rest.map((a) => formatNearbyArrival(a.estimatedArrival)).join(', ');
          times.appendChild(secondary);
        }

        row.appendChild(no);
        row.appendChild(info);
        row.appendChild(times);
        card.appendChild(row);
      });
    }

    group.appendChild(card);
    els.nearbyArrivalsList.appendChild(group);
  });
}

async function fetchNearbyArrivals(coords) {
  if (nearbyArrivalsLoading) return;
  nearbyArrivalsLoading = true;
  try {
    const res = await fetch(`/api/bus-arrivals-nearby?lat=${coords.lat}&lon=${coords.lon}`);
    const data = await res.json();
    if (!res.ok) {
      els.nearbyArrivalsList.innerHTML = `<p class="hint">${escapeHtml(data.error || 'Live arrivals unavailable right now.')}</p>`;
      return;
    }
    renderNearbyArrivals(data.stops || []);
  } catch (err) {
    console.error('nearby-arrivals fetch failed:', err);
    els.nearbyArrivalsList.innerHTML = '<p class="hint">Could not load nearby bus arrivals.</p>';
  } finally {
    nearbyArrivalsLoading = false;
  }
}

function startNearbyArrivalsRefresh() {
  if (nearbyArrivalsTimer) clearInterval(nearbyArrivalsTimer);
  nearbyArrivalsTimer = setInterval(() => {
    if (nearbyArrivalsCoords) fetchNearbyArrivals(nearbyArrivalsCoords);
  }, NEARBY_ARRIVALS_REFRESH_MS);
}

function stopNearbyArrivalsRefresh() {
  if (nearbyArrivalsTimer) {
    clearInterval(nearbyArrivalsTimer);
    nearbyArrivalsTimer = null;
  }
}

function loadNearbyArrivals() {
  if (!navigator.geolocation) {
    els.nearbyArrivalsHint.classList.remove('hidden');
    els.nearbyArrivalsHint.textContent = 'Geolocation is not supported by your browser.';
    return;
  }
  // Already have a fix and a running refresh loop from earlier in this
  // session — just let the interval's next tick handle it.
  if (nearbyArrivalsCoords && nearbyArrivalsTimer) return;

  els.nearbyArrivalsHint.classList.add('hidden');
  els.nearbyArrivalsList.innerHTML = '<p class="hint">Finding stops near you…</p>';

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      nearbyArrivalsCoords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      fetchNearbyArrivals(nearbyArrivalsCoords);
      startNearbyArrivalsRefresh();
    },
    (err) => {
      console.error('nearby-arrivals geolocation error:', err);
      els.nearbyArrivalsList.innerHTML = '';
      els.nearbyArrivalsHint.classList.remove('hidden');
      els.nearbyArrivalsHint.textContent = geoErrorMessage(err);
    },
    GEO_OPTIONS
  );
}

els.nearbyArrivalsRefreshBtn.addEventListener('click', () => {
  if (nearbyArrivalsCoords) {
    fetchNearbyArrivals(nearbyArrivalsCoords);
  } else {
    loadNearbyArrivals();
  }
});

// ---------- Favourites — saved bus stops with live arrivals on demand ----------
// Stored locally in this browser (not synced anywhere); reuses the same
// arrivals panel machinery as the directions steps above.

const FAVOURITES_KEY = 'waypoint_favourites';

function loadFavourites() {
  try {
    const raw = JSON.parse(localStorage.getItem(FAVOURITES_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch (err) {
    console.error(err);
    return [];
  }
}

let favourites = loadFavourites(); // [{ code, name }]

function saveFavourites() {
  try {
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify(favourites));
  } catch (err) {
    console.error(err);
  }
}

function isFavourite(code) {
  return favourites.some((f) => f.code === code);
}

function toggleFavourite(stop) {
  if (isFavourite(stop.code)) {
    favourites = favourites.filter((f) => f.code !== stop.code);
    showToast(`Removed ${stop.name || stop.code} from Favourites.`);
  } else {
    favourites.push({ code: stop.code, name: stop.name || stop.code });
    showToast(`Added ${stop.name || stop.code} to Favourites.`);
  }
  saveFavourites();
  renderFavourites();
}

function renderFavourites() {
  clearArrivalIntervalsIn(els.favList);
  els.favList.innerHTML = '';
  els.favEmptyHint.classList.toggle('hidden', favourites.length > 0);

  favourites.forEach((fav) => {
    const li = document.createElement('li');
    li.className = 'fav-item';

    const headerRow = document.createElement('div');
    headerRow.className = 'fav-header-row';

    const label = document.createElement('span');
    label.className = 'fav-label';
    label.innerHTML = `<strong>${fav.name}</strong> <span class="fav-code">(${fav.code})</span>`;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'fav-remove-btn';
    removeBtn.title = 'Remove from Favourites';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => toggleFavourite(fav));

    headerRow.appendChild(label);
    headerRow.appendChild(removeBtn);

    const arrivalsBtn = document.createElement('button');
    arrivalsBtn.type = 'button';
    arrivalsBtn.className = 'arrivals-btn';
    arrivalsBtn.textContent = '🚌 Live arrivals';

    const panel = document.createElement('div');
    panel.className = 'arrivals-panel hidden';

    arrivalsBtn.addEventListener('click', () => toggleArrivalsPanel(fav.code, arrivalsBtn, panel));

    li.appendChild(headerRow);
    li.appendChild(arrivalsBtn);
    li.appendChild(panel);
    els.favList.appendChild(li);
  });
}

function renderStopSearchResults(results) {
  els.favSearchResults.innerHTML = '';
  results.forEach((r) => {
    const li = document.createElement('li');
    const title = document.createElement('span');
    title.className = 'r-title';
    title.textContent = `${r.name} (${r.code})`;
    const sub = document.createElement('span');
    sub.className = 'r-sub';
    const subParts = [];
    if (r.distance != null) subParts.push(`${formatDistance(r.distance)} away`);
    if (r.road) subParts.push(r.road);
    sub.textContent = subParts.join(' · ');
    li.appendChild(title);
    li.appendChild(sub);
    li.addEventListener('click', () => {
      if (isFavourite(r.code)) {
        showToast(`${r.name} is already in your Favourites.`);
      } else {
        favourites.push({ code: r.code, name: r.name });
        saveFavourites();
        renderFavourites();
        showToast(`Added ${r.name} to Favourites.`);
      }
      els.favSearchInput.value = '';
      els.favSearchResults.innerHTML = '';
    });
    els.favSearchResults.appendChild(li);
  });
}

const runStopSearch = debounce(async (q) => {
  try {
    const res = await fetch(`/api/stop-search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!res.ok) {
      els.favSearchResults.innerHTML = `<li class="r-sub">${data.error || 'Search unavailable.'}</li>`;
      return;
    }
    renderStopSearchResults(data.results || []);
  } catch (err) {
    console.error(err);
    els.favSearchResults.innerHTML = '<li class="r-sub">Could not search bus stops.</li>';
  }
}, 350);

els.nearbyStopsBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    showToast('Geolocation is not supported by your browser.');
    return;
  }
  const originalText = els.nearbyStopsBtn.textContent;
  els.nearbyStopsBtn.disabled = true;
  els.nearbyStopsBtn.textContent = 'Locating…';

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        const { latitude, longitude } = pos.coords;
        const res = await fetch(`/api/stop-search-nearby?lat=${latitude}&lon=${longitude}`);
        const data = await res.json();
        if (!res.ok) {
          els.favSearchResults.innerHTML = `<li class="r-sub">${data.error || 'Search unavailable.'}</li>`;
          return;
        }
        els.favSearchInput.value = '';
        renderStopSearchResults(data.results || []);
      } catch (err) {
        console.error(err);
        els.favSearchResults.innerHTML = '<li class="r-sub">Could not find nearby stops.</li>';
      } finally {
        els.nearbyStopsBtn.disabled = false;
        els.nearbyStopsBtn.textContent = originalText;
      }
    },
    (err) => {
      console.error('nearby-stops geolocation error:', err);
      showToast(geoErrorMessage(err));
      els.nearbyStopsBtn.disabled = false;
      els.nearbyStopsBtn.textContent = originalText;
    },
    GEO_OPTIONS
  );
});

els.favSearchInput.addEventListener('input', (e) => {
  const v = e.target.value.trim();
  if (v.length < 1) { els.favSearchResults.innerHTML = ''; return; }
  runStopSearch(v);
});

document.addEventListener('click', (e) => {
  if (!els.favSearchInput.contains(e.target) && !els.favSearchResults.contains(e.target)) {
    els.favSearchResults.innerHTML = '';
  }
});

renderFavourites();
updateQuickButtons();

// ---------- Geolocation ----------

els.locateBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    showToast('Geolocation is not supported by your browser.');
    return;
  }
  els.locateBtnIcon.textContent = '…';
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude } = pos.coords;
      try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`;
        const res = await fetch(url);
        const data = await res.json();
        const displayName = data?.display_name || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
        currentPlace = { lat: latitude, lon: longitude, display_name: displayName };
        els.placeName.textContent = shortLabel({ display_name: displayName });
        els.placeAddress.textContent = displayName;
        els.placeCard.classList.remove('hidden');
        loadAttractionInfo({ lat: latitude, lon: longitude });
        document.querySelector('.tab-btn[data-tab="search"]').click();
      } catch (err) {
        console.error(err);
        showToast('Could not determine your address.');
      } finally {
        els.locateBtnIcon.innerHTML = ICONS.locate;
      }
    },
    (err) => {
      console.error('locate-me geolocation error:', err);
      showToast(geoErrorMessage(err));
      els.locateBtnIcon.innerHTML = ICONS.locate;
    },
    GEO_OPTIONS
  );
});

// ---------- Safety Center (SOS + Contacts + Scam Checker + Hotlines) ----------
// The SOS icon opens a 4-tab sheet instead of a single send screen:
//   SOS       — one tap sends a single group SMS with a HELP message and a
//               live-location link to every emergency contact at once.
//   Contacts  — the emergency-contact list (name + phone number) plus the
//               sender's name and alert text.
//   Check     — "Is this a scam?": paste a message and get an on-device,
//               offline-capable red-flag scan. Nothing is uploaded.
//   Hotlines  — emergency numbers for ~150 countries (auto-detected from GPS,
//               or picked manually) plus an embassy/consulate lookup for the
//               visitor's own nationality.
//
// All of this is local-only except the embassy lookup (a cached, public,
// read-only directory fetch) and the one-time country reverse-geocode —
// contacts, messages and the scam-check text never leave the device.

const SOS_CONTACT_KEY = 'waypoint_sos_contact'; // legacy single-contact shape, migrated into SOS_CONTACTS_KEY below
const SOS_CONTACTS_KEY = 'waypoint_sos_contacts'; // [{ name, phone }] — SOS always sends one group SMS to everyone on this list
const SOS_MYNAME_KEY = 'waypoint_sos_myname';
const SOS_ACTIVE_SESSION_KEY = 'waypoint_sos_active_session'; // { sessionId, contactName, expiresAt } — resumes sharing across a reload
const SOS_SHARE_DURATION_MS = 60 * 60 * 1000; // 1 hour — must match SOS_SESSION_TTL_MS in server.js
const SOS_POST_MIN_INTERVAL_MS = 8000; // don't post a new fix more often than this even if GPS updates faster
const SAFETY_CTY_OVERRIDE_KEY = 'waypoint_safety_cty_override';
const SAFETY_NAT_KEY = 'waypoint_safety_nat';

let sosWatchId = null;
let sosStopTimer = null;
let sosLastPostAt = 0;
let safetyActiveTab = 'sos';
let safetyCountry = null; // { code, name, src, unknown? } — cached once detected/chosen
let safetyCountryDetectInFlight = null;
let safetyEmbassyCache = {}; // nationality code -> mission[] (this session only; server also caches)
let safetyEditingContactIndex = null; // index into contacts array while the add/edit form is open, or null for "add new"

// ---- Contacts (multi-recipient, migrated from the old single-contact shape) ----

function loadSosContacts() {
  let list;
  try {
    list = JSON.parse(localStorage.getItem(SOS_CONTACTS_KEY) || 'null');
  } catch (err) {
    list = null;
  }
  if (Array.isArray(list)) return list;

  // First run since this became multi-contact: migrate the old single
  // { name, phone } shape (if any) into the new array, then stop looking at
  // the legacy key.
  let legacy;
  try {
    legacy = JSON.parse(localStorage.getItem(SOS_CONTACT_KEY) || 'null');
  } catch (err) {
    legacy = null;
  }
  const migrated = legacy && legacy.name && legacy.phone
    ? [{ name: legacy.name, phone: legacy.phone }]
    : [];
  saveSosContacts(migrated);
  return migrated;
}

function saveSosContacts(list) {
  localStorage.setItem(SOS_CONTACTS_KEY, JSON.stringify(list));
}

function loadSosMyName() {
  try { return localStorage.getItem(SOS_MYNAME_KEY) || ''; } catch (err) { return ''; }
}

function saveSosMyName(name) {
  try { localStorage.setItem(SOS_MYNAME_KEY, name); } catch (err) { /* ignore */ }
}

const SOS_MESSAGE_KEY = 'waypoint_sos_message'; // last-used SOS text, editable each time
const SOS_DEFAULT_MESSAGE = "🚨 SOS - I need help. I think I'm being targeted by a scam or I'm in an unsafe situation. Please call me now. If I don't answer, call the local police.";
const SOS_OLD_DEFAULT_MESSAGES = ['I NEED HELP']; // superseded defaults — upgrade anyone still on one of these instead of leaving them behind

// A fast, low-precision fix — network/cell-tower location instead of GPS,
// and happy to reuse one up to 5 minutes old. Used for country detection and
// for warming an SOS fix in the background: neither needs GPS-grade
// accuracy, and competing with GEO_OPTIONS' enableHighAccuracy GPS request
// (used for turn-by-turn nav and the live SOS tracking watch) was making
// both requests slower — Android in particular seems to serialize
// concurrent high-accuracy fixes rather than running them side by side.
const GEO_OPTIONS_FAST = { enableHighAccuracy: false, timeout: 6000, maximumAge: 300000 };

// Warmed as soon as the Safety sheet opens (see openSosModal), so that if a
// fix happens to land before someone taps SOS, the outgoing message can
// include real coordinates inline. Purely a nice-to-have now: the SOS send
// itself (handleSafetySosSend) never waits on this — it sends immediately
// either way, since the live-tracking link updates on its own the moment a
// fix comes in via startSosLiveTracking's watchPosition.
const SOS_FIX_FRESH_MS = 45000;
let safetySosFix = null; // { lat, lon, t }
let safetySosFixWarming = false;

function getFreshSosFix() {
  return (safetySosFix && Date.now() - safetySosFix.t < SOS_FIX_FRESH_MS) ? safetySosFix : null;
}

function warmSosFix() {
  if (safetySosFixWarming || getFreshSosFix() || !navigator.geolocation) return;
  safetySosFixWarming = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => { safetySosFix = { lat: pos.coords.latitude, lon: pos.coords.longitude, t: Date.now() }; safetySosFixWarming = false; },
    () => { safetySosFixWarming = false; },
    GEO_OPTIONS_FAST
  );
}

function loadSosMessage() {
  try {
    const saved = localStorage.getItem(SOS_MESSAGE_KEY);
    if (!saved || SOS_OLD_DEFAULT_MESSAGES.includes(saved)) return SOS_DEFAULT_MESSAGE;
    return saved;
  } catch (err) {
    return SOS_DEFAULT_MESSAGE;
  }
}

function saveSosMessage(message) {
  try { localStorage.setItem(SOS_MESSAGE_KEY, message); } catch (err) { /* ignore */ }
}

// Normalizes a phone number to the digits-only "countrycode+number" form
// WhatsApp's click-to-chat links expect (wa.me/6591234567). A leading "+"
// is treated as an explicit international number and trusted as-is (once
// non-digits are stripped) so contacts outside Singapore work too. With no
// "+", falls back to the common ways people type a local Singapore number
// (with/without +65, with/without spaces, with/without a leading 0), since
// that's still the default case for this app.
function normalizePhoneNumber(raw) {
  const trimmed = (raw || '').trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return digits;
  if (digits.startsWith('65') && digits.length === 10) return digits;
  if (digits.length === 8) return `65${digits}`;
  if (digits.startsWith('0') && digits.length === 9) return `65${digits.slice(1)}`;
  return digits;
}

// ---- Safety modal shell: tabs ----

let safetySosRefreshTimer = null; // re-renders the "auto-stops in N min" line while it's on screen

function stopSafetySosRefreshTimer() {
  if (safetySosRefreshTimer != null) { clearInterval(safetySosRefreshTimer); safetySosRefreshTimer = null; }
}

function openSosModal() {
  els.sosModal.classList.remove('hidden');
  switchSafetyTab(safetyActiveTab);
  detectSafetyCountry(); // kick off in the background; renders update themselves when it resolves
  warmSosFix(); // also start warming a location fix, so SOS can send instantly if tapped
}

function closeSosModal() {
  els.sosModal.classList.add('hidden');
  stopSafetySosRefreshTimer();
}

function switchSafetyTab(name) {
  safetyActiveTab = name;
  document.querySelectorAll('.safety-tab').forEach((btn) => {
    const active = btn.dataset.safetyTab === name;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  stopSafetySosRefreshTimer();
  renderSafetyTab(name);
  if (name === 'sos' && isSosSharingActive()) {
    safetySosRefreshTimer = setInterval(() => {
      if (safetyActiveTab === 'sos' && isSosSharingActive()) renderSafetySosTab();
      else stopSafetySosRefreshTimer();
    }, 30000);
  }
}

function renderSafetyTab(name) {
  if (name === 'contacts') return renderSafetyContactsTab();
  if (name === 'check') return renderSafetyCheckTab();
  if (name === 'hotlines') return renderSafetyHotlinesTab();
  return renderSafetySosTab();
}

document.querySelectorAll('.safety-tab').forEach((btn) => {
  btn.addEventListener('click', () => switchSafetyTab(btn.dataset.safetyTab));
});

// ---- SOS tab ----

function safetyLocalBarHtml() {
  const c = safetyCountry;
  if (!c) return '';
  const primaryNums = (c.l || []).filter((x) => x[2]).slice(0, 2);
  if (!primaryNums.length) return '';
  return `
    <div class="safety-local-bar">
      <div>
        <div class="safety-local-label">Emergency in</div>
        <div class="safety-local-name">${escapeHtml(c.n)}</div>
      </div>
      <div class="safety-local-acts">
        ${primaryNums.map((x) => `<a href="${safetyTelHref(x[1], x[3])}">${escapeHtml(x[0].split(/[ ,&]/)[0])} ${escapeHtml(x[1])}</a>`).join('')}
      </div>
    </div>`;
}

function renderSafetySosTab() {
  const contacts = loadSosContacts();

  if (!contacts.length) {
    els.sosModalBody.innerHTML = `
      <div style="text-align:center">
        <div class="weather-panel-icon">🆘</div>
        <h3 class="weather-panel-headline">Add a contact to enable SOS</h3>
        <p class="weather-panel-now">Pressing SOS sends one group SMS with a HELP message and your live location to your contacts — stored only on this device, never sent to Waypoint. Add at least one contact to turn it on.</p>
      </div>
      <button id="safetyGoToContactsBtn" class="sos-primary-btn" type="button">Add a contact</button>
    `;
    document.getElementById('safetyGoToContactsBtn').addEventListener('click', () => switchSafetyTab('contacts'));
    return;
  }

  const who = `Group SMS to ${contacts.length} contact${contacts.length > 1 ? 's' : ''}`;
  const how = 'One SMS to every number';

  const session = getSosActiveSession();
  const sharing = !!session;

  const liveLocationHtml = sharing
    ? `<div class="safety-local-bar" style="border-color:var(--success);background:color-mix(in srgb, var(--success) 10%, var(--surface-elevated))">
        <div>
          <div class="safety-local-label" style="color:var(--success)">🟢 Live location sharing</div>
          <div class="safety-local-name">Updating automatically${session.contactName ? ` for ${escapeHtml(session.contactName)}` : ''} · auto-stops in ${safetyMinutesLeft(session.expiresAt)} min</div>
        </div>
      </div>`
    : `<p class="safety-sub" style="margin:-4px 0 12px">📍 Tapping SOS shares your live location automatically — it keeps updating on its own for up to 1 hour, so you don't need to resend it. Tap "I'm safe" anytime to stop early.</p>`;

  els.sosModalBody.innerHTML = `
    ${safetyLocalBarHtml()}
    <div class="safety-sos-wrap">
      <button id="safetySosBtn" class="safety-sos-btn" type="button" aria-label="Send SOS alert with your location">
        <b>SOS</b><small>${sharing ? 'Sharing…' : 'Tap to alert'}</small>
      </button>
    </div>
    ${liveLocationHtml}
    <div class="sos-form" style="margin-bottom:10px">
      <div class="safety-sub" style="margin-bottom:6px"><strong style="color:var(--ink)">Sends to:</strong> ${escapeHtml(who)} <span style="color:var(--muted)">· ${escapeHtml(how)}</span></div>
      <label class="sos-form-label" for="sosMessageInput">Message</label>
      <input id="sosMessageInput" class="sos-form-input" type="text" value="${escapeHtml(loadSosMessage())}" />
    </div>
    ${sharing ? `<button id="safetyImSafeBtn" class="sos-primary-btn" type="button" style="background:var(--success)">✅ I'm safe — stop sharing</button>` : ''}
  `;

  document.getElementById('safetySosBtn').addEventListener('click', () => {
    const messageInput = document.getElementById('sosMessageInput');
    const message = (messageInput?.value || '').trim() || SOS_DEFAULT_MESSAGE;
    saveSosMessage(message);
    handleSafetySosSend(message);
  });
  const safeBtn = document.getElementById('safetyImSafeBtn');
  if (safeBtn) safeBtn.addEventListener('click', () => {
    stopSosLiveTracking();
    stopSafetySosRefreshTimer();
    showToast("Stopped sharing your live location.");
    renderSafetySosTab();
  });
}

function getSosActiveSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(SOS_ACTIVE_SESSION_KEY) || 'null');
    return (saved && saved.sessionId && Date.now() < saved.expiresAt) ? saved : null;
  } catch (err) {
    return null;
  }
}

function isSosSharingActive() {
  return !!getSosActiveSession();
}

function safetyMinutesLeft(expiresAt) {
  return Math.max(1, Math.round((expiresAt - Date.now()) / 60000));
}

// Generates an opaque, effectively-unguessable session id for the tracking
// link — crypto.randomUUID() where available (all current mobile browsers),
// falling back to a long random string for anything older.
function genSosSessionId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function postSosPosition(sessionId, lat, lon) {
  fetch(`/api/sos-track/${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat, lon }),
    keepalive: true, // survive the page being backgrounded/navigated away as the Messages app opens
  }).catch((err) => console.error('SOS position update failed:', err));
}

// Plain-text coordinates for the SOS message body, so the recipient has an
// exact location even if they can't or don't tap the tracking link (no
// signal, link expired, etc). 4 decimal places is ~11m precision — plenty
// for this purpose without implying false precision.
function formatLatLon(lat, lon) {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}°${latDir}, ${Math.abs(lon).toFixed(4)}°${lonDir}`;
}

function safetyGroupSmsLink(contacts, text) {
  const nums = contacts.map((c) => c.phone.replace(/[^\d+]/g, '')).filter((n) => n.replace('+', '').length >= 8);
  const t = encodeURIComponent(text);
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  return isIOS ? `sms:/open?addresses=${nums.join(',')}&body=${t}` : `sms:${nums.join(',')}?body=${t}`;
}

// SOS always sends one group SMS to every contact, in a single tap — no
// per-contact app choice and no "tap each one" sheet to work through.
// NEVER waits on geolocation: live tracking (below) kicks off its own
// watchPosition and posts a fix the moment one resolves, so the recipients'
// map fills in within moments regardless — the send itself doesn't need to
// sit around for GPS first. And it navigates the current tab directly
// (window.location.href), exactly like the standalone ScamGuard app: that's
// what lets the phone hand off straight to the Messages app instantly.
function handleSafetySosSend(message) {
  const contacts = loadSosContacts();
  if (!contacts.length) return;

  const sessionId = genSosSessionId();
  const messageText = (message || '').trim() || SOS_DEFAULT_MESSAGE;
  const trackLink = `${window.location.origin}/track/${sessionId}`;
  startSosLiveTracking(sessionId, `${contacts.length} contacts`);

  // Use whatever fix (if any) was already warmed while the sheet was open —
  // never wait for a fresh one now. No fix yet is fine: the track link
  // above already reflects the live watch as soon as it resolves.
  const cached = getFreshSosFix();
  if (cached) postSosPosition(sessionId, cached.lat, cached.lon);
  const coordsLine = cached ? `\nLocation: ${formatLatLon(cached.lat, cached.lon)}` : '';

  const fullMessage = `${messageText}${coordsLine}\nTrack my live location (updates for up to 1hr): ${trackLink}\n\nSent via Waypoint at ${new Date().toLocaleString('en-SG')}`;
  window.location.href = safetyGroupSmsLink(contacts, fullMessage);
  closeSosModal();
}

function startSosLiveTracking(sessionId, contactName) {
  stopSosLiveTracking(); // clear any previous session's watch/timer first

  const expiresAt = Date.now() + SOS_SHARE_DURATION_MS;
  localStorage.setItem(SOS_ACTIVE_SESSION_KEY, JSON.stringify({ sessionId, contactName, expiresAt }));

  if (navigator.geolocation) {
    sosLastPostAt = 0;
    sosWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        if (now - sosLastPostAt < SOS_POST_MIN_INTERVAL_MS) return;
        sosLastPostAt = now;
        postSosPosition(sessionId, pos.coords.latitude, pos.coords.longitude);
      },
      (err) => console.error('SOS live tracking geolocation error:', err),
      GEO_OPTIONS
    );
  }

  sosStopTimer = setTimeout(() => {
    stopSosLiveTracking();
    showToast('SOS live location sharing ended after 1 hour.');
  }, Math.max(0, expiresAt - Date.now()));

  els.sosTrackingText.textContent = contactName
    ? `Sharing your live location with ${contactName}…`
    : 'Sharing your live location…';
  els.sosTrackingBanner.classList.remove('hidden');
}

function stopSosLiveTracking() {
  if (sosWatchId != null) {
    navigator.geolocation.clearWatch(sosWatchId);
    sosWatchId = null;
  }
  if (sosStopTimer != null) {
    clearTimeout(sosStopTimer);
    sosStopTimer = null;
  }
  localStorage.removeItem(SOS_ACTIVE_SESSION_KEY);
  els.sosTrackingBanner.classList.add('hidden');
}

// Resumes an in-progress share after a page reload/relaunch — otherwise
// simply reloading the app (or the OS restarting the tab in the background)
// would silently stop the location the contact is watching from updating,
// with no indication to the sender that it had stopped.
function resumeSosLiveTrackingIfActive() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(SOS_ACTIVE_SESSION_KEY) || 'null');
  } catch (err) {
    saved = null;
  }
  if (!saved || !saved.sessionId || Date.now() > saved.expiresAt) {
    localStorage.removeItem(SOS_ACTIVE_SESSION_KEY);
    return;
  }
  startSosLiveTracking(saved.sessionId, saved.contactName);
}

els.sosBtn.addEventListener('click', openSosModal);
els.sosModalClose.addEventListener('click', closeSosModal);
els.sosModal.addEventListener('click', (e) => {
  if (e.target === els.sosModal) closeSosModal();
});
els.sosTrackingStopBtn.addEventListener('click', () => {
  stopSosLiveTracking();
  showToast('Stopped sharing your live location.');
  if (!els.sosModal.classList.contains('hidden') && safetyActiveTab === 'sos') renderSafetySosTab();
});

resumeSosLiveTrackingIfActive();

// ---- Contacts tab ----

function renderSafetyContactsTab() {
  const contacts = loadSosContacts();
  els.sosModalBody.innerHTML = `
    <h3>Emergency contacts</h3>
    <p class="safety-sub">SOS sends one group SMS to everyone on this list. Use the full number with country code, e.g. +65 9123 4567.</p>
    <div id="safetyContactList" class="safety-list"></div>
    <div class="sos-form" id="safetyContactFormWrap">
      <div class="safety-sub" id="safetyContactFormTitle" style="margin:0;font-weight:700;color:var(--ink)">Add contact</div>
      <label class="sos-form-label" for="sosContactName">Name</label>
      <input id="sosContactName" class="sos-form-input" type="text" placeholder="e.g. Mum" maxlength="40" />
      <label class="sos-form-label" for="sosContactPhone">Phone number</label>
      <input id="sosContactPhone" class="sos-form-input" type="tel" placeholder="e.g. 9123 4567, or +1 415 555 0100 outside Singapore" />
    </div>
    <button id="sosSaveBtn" class="sos-primary-btn" type="button">Save contact</button>
    <button id="safetyCancelEditBtn" class="sos-secondary-btn hidden" type="button">Cancel</button>

    <div class="sos-form" style="margin-top:18px">
      <div class="safety-sub" style="margin:0;font-weight:700;color:var(--ink)">Your alert message</div>
      <label class="sos-form-label" for="safetyMyNameInput">Your name (shown in alerts)</label>
      <input id="safetyMyNameInput" class="sos-form-input" type="text" maxlength="40" placeholder="e.g. Aunty May" value="${escapeHtml(loadSosMyName())}" />
    </div>
  `;
  renderSafetyContactList(contacts);

  document.getElementById('safetyMyNameInput').addEventListener('input', (e) => saveSosMyName(e.target.value.trim()));
  document.getElementById('safetyCancelEditBtn').addEventListener('click', resetSafetyContactForm);
  document.getElementById('sosSaveBtn').addEventListener('click', () => {
    const nameInput = document.getElementById('sosContactName');
    const phoneInput = document.getElementById('sosContactPhone');
    const name = nameInput.value.trim();
    const phone = normalizePhoneNumber(phoneInput.value.trim());
    if (!name) { showToast('Enter a name for this contact.'); return; }
    if (phone.length < 8 || phone.length > 15) { showToast('Enter a valid phone number, with a country code (+ and the number) if outside Singapore.'); return; }

    const list = loadSosContacts();
    if (safetyEditingContactIndex != null && list[safetyEditingContactIndex]) {
      list[safetyEditingContactIndex] = { name, phone };
      showToast(`${name} updated`);
    } else {
      list.push({ name, phone });
      showToast(`${name} added`);
    }
    saveSosContacts(list);
    resetSafetyContactForm();
    renderSafetyContactList(list);
  });
}

function resetSafetyContactForm() {
  safetyEditingContactIndex = null;
  document.getElementById('sosContactName').value = '';
  document.getElementById('sosContactPhone').value = '';
  document.getElementById('safetyContactFormTitle').textContent = 'Add contact';
  document.getElementById('sosSaveBtn').textContent = 'Save contact';
  document.getElementById('safetyCancelEditBtn').classList.add('hidden');
}

const SAFETY_EDIT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const SAFETY_DELETE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>';

function renderSafetyContactList(contacts) {
  const wrap = document.getElementById('safetyContactList');
  if (!contacts.length) {
    wrap.innerHTML = `<div class="safety-empty">No contacts yet. Add one below.</div>`;
    return;
  }
  wrap.innerHTML = '';
  contacts.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'safety-contact';
    row.innerHTML = `
      <div>
        <div class="safety-contact-name">${escapeHtml(c.name)}</div>
        <div class="safety-contact-phone">+${escapeHtml(c.phone)}</div>
      </div>
      <div class="safety-contact-acts">
        <button class="safety-icon-btn" type="button" data-act="edit" title="Edit">${SAFETY_EDIT_ICON}</button>
        <button class="safety-icon-btn" type="button" data-act="delete" title="Delete">${SAFETY_DELETE_ICON}</button>
      </div>
    `;
    row.querySelector('[data-act="edit"]').addEventListener('click', () => {
      safetyEditingContactIndex = i;
      document.getElementById('sosContactName').value = c.name;
      document.getElementById('sosContactPhone').value = c.phone;
      document.getElementById('safetyContactFormTitle').textContent = `Edit ${c.name}`;
      document.getElementById('sosSaveBtn').textContent = 'Save changes';
      document.getElementById('safetyCancelEditBtn').classList.remove('hidden');
      document.getElementById('safetyContactFormWrap').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    row.querySelector('[data-act="delete"]').addEventListener('click', () => {
      const list = loadSosContacts();
      list.splice(i, 1);
      saveSosContacts(list);
      resetSafetyContactForm();
      renderSafetyContactList(list);
    });
    wrap.appendChild(row);
  });
}

// ---- Check tab: "Is this a scam?" ----
// Pure on-device pattern matching — nothing here is ever sent anywhere.
// w = score weight, hi = whether a hit alone should count as "serious", r = regex.

const SAFETY_RULES = [
  { w: 3, hi: 1, t: 'Asks for an OTP, PIN or password', d: 'No bank, government agency or delivery company will ever ask for your OTP.', r: /\b(otp|one[- ]time (pass(word|code)?|pin)|pin(code)?|passcode|password|2fa|verification code|tac)\b/gi },
  { w: 3, hi: 1, t: 'Pretends to be government or police', d: "Scammers often pose as the police, tax office, immigration, central bank, customs or a court. Real officers won't ask you to transfer money.", r: /\b(police|interpol|customs|immigration|tax (office|department|authority)|central bank|monetary authority|government (officer|agency)|embassy|court|warrant|arrest|money laundering|investigation officer|mas|iras|cpf|irs|hmrc)\b/gi },
  { w: 2, hi: 0, t: 'Creates urgency or threats', d: "Pressure to act 'now' stops you from thinking or checking.", r: /\b(urgent(ly)?|immediately|within \d+ ?(hours?|hrs?|minutes?|mins?)|last chance|final (notice|warning)|act now|expires? (today|soon)|suspended|blocked|frozen|permanent(ly)? clos\w*|legal action)\b/gi },
  { w: 2, hi: 1, t: 'Asks you to move money', d: "Requests to transfer money, especially to a 'safe account', are a hallmark of scams.", r: /\b(transfer|paynow|pay now|wire|remit|safe account|deposit|top[- ]?up|send (the )?money|bank in|admin fee|processing fee|release fee|clearance fee)\b/gi },
  { w: 3, hi: 1, t: 'Unusual payment method', d: "Gift cards, crypto and prepaid vouchers can't be traced or reversed.", r: /\b(gift ?cards?|google play card|itunes card|steam card|bitcoin|btc|usdt|crypto(currency)?|binance|wallet address|voucher code)\b/gi },
  { w: 2, hi: 0, t: 'Contains a link or shortened URL', d: "Don't tap links in unexpected messages. Short links hide where they really go.", r: /\b((https?:\/\/)?(bit\.ly|tinyurl\.com|t\.co|cutt\.ly|rb\.gy|is\.gd|shorturl\.at|t\.ly|s\.id)\/\S+|https?:\/\/\S+|www\.\S+)/gi },
  { w: 3, hi: 1, t: 'Asks you to install an app or share your screen', d: 'Remote-access apps let scammers control your phone and bank apps.', r: /\b(anydesk|teamviewer|quicksupport|rustdesk|screen ?shar\w*|install (this|the) app|download (this|the) (app|apk)|\.apk)\b/gi },
  { w: 2, hi: 0, t: 'Too-good-to-be-true reward', d: 'Unexpected prizes, refunds or lucky draws are bait.', r: /\b(congratulations|you (have )?won|winner|lucky draw|prize|reward|cash ?back|refund|free gift|claim (your|now))\b/gi },
  { w: 2, hi: 0, t: 'Job or investment promise', d: "Easy money for liking videos, 'tasks' or guaranteed returns is a common scam.", r: /\b(earn \$?\d+|per day|daily (income|pay)|part[- ]time|work from home|simple tasks?|like (videos|posts)|guaranteed (returns?|profit)|high returns?|investment opportunity|trading (platform|mentor)|forex)\b/gi },
  { w: 2, hi: 0, t: 'Asks you to keep it secret', d: "Scammers tell you not to talk to family or the bank so no one can warn you.", r: /\b(don'?t (tell|share (this )?with) (anyone|your family|the bank)|keep (this|it) (secret|confidential)|do not (tell|inform) (anyone|your)|do not share (this )?with anyone|confidential matter)\b/gi },
  { w: 1, hi: 0, t: 'Asks you to confirm personal or bank details', d: "Real organisations already have your details and won't ask by message.", r: /\b(verify (your )?(identity|account|details)|confirm (your )?(details|account|identity)|update (your )?(details|particulars|account)|nric|passport number|card number|cvv|expiry date|bank (login|account number))\b/gi },
  { w: 1, hi: 0, t: 'Delivery or parcel problem', d: "Fake 'failed delivery' notices lead to phishing pages.", r: /\b(parcel|package|delivery (failed|attempt|fee)|re-?deliver\w*|shipment (on hold|held)|customs duty)\b/gi },
  { w: 1, hi: 0, t: 'Unknown number or recorded call', d: 'Messages from unfamiliar international numbers, or recorded voice calls asking you to press a key, need extra care.', r: /(\+\d{1,3}[\s-]?\d{3,}|press 1|press 9|automated (call|message))/gi },
  { w: 1, hi: 0, t: 'Emotional hook', d: 'A friend or relative suddenly needing money, or fast romance, is a common setup.', r: /\b(new number|changed (my )?number|lost my phone|in trouble|hospital|emergency|my dear|sweetheart|honey|babe)\b/gi },
];

function safetyCheckMessage(text) {
  const hits = []; let score = 0; const spans = [];
  SAFETY_RULES.forEach((rule) => {
    const m = [...text.matchAll(rule.r)];
    if (m.length) { hits.push({ ...rule, n: m.length, sample: m[0][0] }); score += rule.w; m.forEach((x) => spans.push([x.index, x.index + x[0].length])); }
  });
  return { hits, score, spans };
}

function safetyHighlight(text, spans) {
  spans.sort((a, b) => a[0] - b[0]);
  const merged = [];
  spans.forEach((s) => { const l = merged[merged.length - 1]; if (l && s[0] <= l[1]) l[1] = Math.max(l[1], s[1]); else merged.push([...s]); });
  let out = ''; let i = 0;
  merged.forEach(([a, b]) => { out += escapeHtml(text.slice(i, a)) + '<mark>' + escapeHtml(text.slice(a, b)) + '</mark>'; i = b; });
  return out + escapeHtml(text.slice(i));
}

const SAFETY_CHECK_DEFAULT_TEXT = "[Bank Security] Dear customer, your bank account has been suspended due to suspicious activity. To avoid permanent closure, verify your identity within 24 hours at bit.ly/bank-verify-now and enter the OTP sent to you. Do not share this with anyone.";

function renderSafetyCheckTab() {
  els.sosModalBody.innerHTML = `
    <h3>Is this a scam?</h3>
    <p class="safety-sub">Paste an SMS, WhatsApp, email or call script. Everything is checked on your phone — nothing is uploaded.</p>
    <textarea id="safetyCheckText" class="safety-check-textarea">${escapeHtml(SAFETY_CHECK_DEFAULT_TEXT)}</textarea>
    <div class="safety-row">
      <button id="safetyCheckBtn" class="pill-btn primary" type="button">Check message</button>
      <button id="safetyClearBtn" class="pill-btn ghost" type="button">Clear</button>
    </div>
    <div id="safetyCheckOut"></div>
  `;
  document.getElementById('safetyCheckBtn').addEventListener('click', runSafetyCheck);
  document.getElementById('safetyClearBtn').addEventListener('click', () => {
    document.getElementById('safetyCheckText').value = '';
    document.getElementById('safetyCheckOut').innerHTML = '';
    document.getElementById('safetyCheckText').focus();
  });
  runSafetyCheck();
}

function safetyHelpButtonHtml() {
  const c = safetyCountry;
  const label = c && c.code === 'SG' ? 'Call ScamShield 1799' : c ? `Call ${c.n} police` : 'Find local emergency numbers';
  const num = c && c.code === 'SG' ? '1799' : c ? c.pol : null;
  if (!num) return `<div class="safety-row"><button class="pill-btn" type="button" data-jump-hotlines>Find local emergency numbers</button></div>`;
  return `<div class="safety-row"><a class="pill-btn primary" href="${safetyTelHref(num)}">${escapeHtml(label)}</a></div>`;
}

function runSafetyCheck() {
  const text = document.getElementById('safetyCheckText').value.trim();
  const out = document.getElementById('safetyCheckOut');
  if (!text) { out.innerHTML = `<div class="safety-empty">Paste a message above to check it.</div>`; return; }
  const { hits, score, spans } = safetyCheckMessage(text);
  const pct = Math.min(100, Math.round((score / 9) * 100));
  const lvl = pct >= 60 ? 'high' : pct >= 25 ? 'mid' : 'low';
  const head = { high: 'Very likely a scam', mid: 'Be careful', low: 'No obvious red flags' }[lvl];
  const advice = {
    high: "Don't reply, click links or send money. Block the sender and contact your bank or the police if you're unsure.",
    mid: 'Check with the organisation using a number you find yourself, not one in the message.',
    low: "This doesn't match common scam patterns, but scammers change tactics. If money or codes are involved, check first.",
  }[lvl];
  out.innerHTML = `
    <div class="safety-verdict ${lvl}"><div class="safety-score">${pct}<span style="font-size:16px">%</span></div><div><h4>${head}</h4><p>${advice}</p></div></div>
    ${hits.length ? `
      <div class="safety-sub" style="margin-bottom:6px"><strong style="color:var(--ink)">${hits.length} red flag${hits.length > 1 ? 's' : ''} found</strong></div>
      <ul class="safety-flags">${hits.sort((a, b) => b.w - a.w).map((h) => `<li class="${h.hi ? 'hi' : ''}"><b>${escapeHtml(h.t)}</b><span>${escapeHtml(h.d)}</span></li>`).join('')}</ul>
      <div class="safety-sub" style="margin-bottom:6px"><strong style="color:var(--ink)">Where we found them</strong></div>
      <div class="safety-preview">${safetyHighlight(text, spans)}</div>` : ''}
    ${lvl !== 'low' ? safetyHelpButtonHtml() : ''}
  `;
  const jumpBtn = out.querySelector('[data-jump-hotlines]');
  if (jumpBtn) jumpBtn.addEventListener('click', () => switchSafetyTab('hotlines'));
}

// ---- Hotlines tab: emergency numbers + embassy lookup ----
// Emergency numbers by country. e=general, p=police, a=ambulance, f=fire,
// t=tourist police, x=extras, v=checked against MFA/official sources.
const SAFETY_DATA = {"AF":{"n":"Afghanistan","p":"119","a":"112","f":"119"},"AL":{"n":"Albania","e":"112","p":"129","a":"127","f":"128"},"DZ":{"n":"Algeria","p":"1548","a":"14","f":"14"},"AD":{"n":"Andorra","e":"112","p":"110","a":"116","f":"118"},"AO":{"n":"Angola","p":"113","a":"112","f":"115"},"AR":{"n":"Argentina","e":"911","p":"101","a":"107","f":"100"},"AM":{"n":"Armenia","e":"112","p":"102","a":"103","f":"101"},"AU":{"n":"Australia","e":"000","x":[["From a mobile phone, also","112"],["Police (non-emergency)","131 444"]],"v":1},"AT":{"n":"Austria","e":"112","p":"133","a":"144","f":"122"},"AZ":{"n":"Azerbaijan","e":"112","p":"102","a":"103","f":"101"},"BS":{"n":"Bahamas","e":"911"},"BH":{"n":"Bahrain","e":"999","x":[["From a mobile phone, also","112"]]},"BD":{"n":"Bangladesh","e":"999"},"BB":{"n":"Barbados","p":"211","a":"511","f":"311"},"BY":{"n":"Belarus","p":"102","a":"103","f":"101"},"BE":{"n":"Belgium","e":"112","p":"101"},"BZ":{"n":"Belize","e":"911"},"BJ":{"n":"Benin","p":"117","a":"112","f":"118"},"BT":{"n":"Bhutan","p":"113","a":"112","f":"110"},"BO":{"n":"Bolivia","e":"911","p":"110","a":"118","f":"119"},"BA":{"n":"Bosnia and Herzegovina","p":"122","a":"124","f":"123"},"BW":{"n":"Botswana","p":"999","a":"997","f":"998","x":[["From a mobile phone","112"]]},"BR":{"n":"Brazil","p":"190","a":"192","f":"193"},"BN":{"n":"Brunei","p":"993","a":"991","f":"995"},"BG":{"n":"Bulgaria","e":"112"},"BF":{"n":"Burkina Faso","p":"17","a":"112","f":"18"},"BI":{"n":"Burundi","p":"117","a":"112","f":"118"},"KH":{"n":"Cambodia","p":"117","a":"119","f":"118","x":[["Tourist Police Phnom Penh","+855 97 778 0002"],["Tourist Police Siem Reap","+855 12 402 424"],["Tourist Police Sihanoukville","+855 97 778 0008"],["Police hotline for foreigners","+855 31 201 2345"]],"v":1},"CM":{"n":"Cameroon","e":"112","p":"117","a":"119","f":"118"},"CA":{"n":"Canada","e":"911"},"CV":{"n":"Cape Verde","p":"132","a":"130","f":"131"},"CF":{"n":"Central African Republic","p":"117","a":"1220","f":"118"},"TD":{"n":"Chad","p":"17","f":"18"},"CL":{"n":"Chile","p":"133","a":"131","f":"132"},"CN":{"n":"China","p":"110","a":"120","f":"119","v":1},"CO":{"n":"Colombia","e":"123"},"KM":{"n":"Comoros","p":"17","f":"18"},"CR":{"n":"Costa Rica","e":"911"},"HR":{"n":"Croatia","e":"112","p":"192","a":"194","f":"193"},"CU":{"n":"Cuba","p":"106","a":"104","f":"105"},"CY":{"n":"Cyprus","e":"112"},"CZ":{"n":"Czech Republic","e":"112","p":"158","a":"155","f":"150"},"CD":{"n":"DR Congo","e":"112","f":"118"},"DK":{"n":"Denmark","e":"112"},"DJ":{"n":"Djibouti","p":"17","a":"19","f":"18"},"DO":{"n":"Dominican Republic","e":"911"},"EC":{"n":"Ecuador","e":"911"},"EG":{"n":"Egypt","e":"112","p":"122","a":"123","f":"180","t":"126","v":1},"SV":{"n":"El Salvador","p":"911","a":"132","f":"913"},"GQ":{"n":"Equatorial Guinea","p":"114","a":"115","f":"112"},"ER":{"n":"Eritrea","e":"112","p":"113","a":"114","f":"116"},"EE":{"n":"Estonia","e":"112"},"SZ":{"n":"Eswatini","p":"999","a":"977","f":"933"},"ET":{"n":"Ethiopia","e":"911","p":"991","a":"907","f":"939"},"FJ":{"n":"Fiji","e":"911","p":"917","f":"910"},"FI":{"n":"Finland","e":"112"},"FR":{"n":"France","e":"112","p":"17","a":"15","f":"18","v":1},"PF":{"n":"French Polynesia","e":"112","p":"17","a":"15","f":"18"},"GA":{"n":"Gabon","p":"1730","a":"1300","f":"18"},"GM":{"n":"Gambia","p":"117","a":"116","f":"118"},"GE":{"n":"Georgia","e":"112"},"DE":{"n":"Germany","p":"110","a":"112","f":"112","v":1},"GH":{"n":"Ghana","e":"112","p":"191","a":"193","f":"192"},"GR":{"n":"Greece","e":"112","p":"100","a":"166","f":"199"},"GU":{"n":"Guam","e":"911"},"GT":{"n":"Guatemala","p":"110","a":"122","f":"122"},"GN":{"n":"Guinea","p":"117"},"GW":{"n":"Guinea-Bissau","e":"112","p":"117","a":"119","f":"118"},"GY":{"n":"Guyana","p":"911","a":"913","f":"912"},"HT":{"n":"Haiti","p":"114","a":"116","f":"115"},"HN":{"n":"Honduras","e":"911","a":"195","f":"198"},"HK":{"n":"Hong Kong","e":"999","x":[["Police hotline (non-emergency)","+852 2527 7177"],["Tourism Board visitor hotline","+852 2508 1234"]],"v":1},"HU":{"n":"Hungary","e":"112","p":"107","a":"104","f":"105"},"IS":{"n":"Iceland","e":"112"},"IN":{"n":"India","e":"112","p":"100","a":"108","f":"101","x":[["Tourist helpline","1363"],["Women's helpline","181"]],"v":1},"ID":{"n":"Indonesia","e":"112","p":"110","a":"118","f":"113","v":1},"IR":{"n":"Iran","p":"110","a":"115","f":"125"},"IQ":{"n":"Iraq","e":"112","p":"104","a":"122","f":"115"},"IE":{"n":"Ireland","e":"112","x":[["Also works","999"]]},"IL":{"n":"Israel","p":"100","a":"101","f":"102"},"IT":{"n":"Italy","e":"112","v":1},"CI":{"n":"Ivory Coast","p":"111","a":"185","f":"180"},"JM":{"n":"Jamaica","p":"119","a":"110","f":"110"},"JP":{"n":"Japan","p":"110","a":"119","f":"119","x":[["Japan Visitor Hotline, English (24/7)","050 3816 2787"]],"v":1},"JO":{"n":"Jordan","e":"911"},"KZ":{"n":"Kazakhstan","e":"112","p":"102","a":"103","f":"101"},"KE":{"n":"Kenya","e":"999","x":[["Also works","112"]]},"KI":{"n":"Kiribati","p":"192","a":"194","f":"193"},"XK":{"n":"Kosovo","p":"192","a":"194","f":"193"},"KW":{"n":"Kuwait","e":"112"},"KG":{"n":"Kyrgyzstan","e":"112"},"LA":{"n":"Laos","p":"1191","a":"1195","f":"1190","t":"1192","x":[["Tourist Police Vientiane","+856 21 251 128"],["Tourist Police Luang Prabang","+856 71 254 568"],["Vientiane Rescue","1623"]],"v":1},"LV":{"n":"Latvia","e":"112","p":"110","a":"113"},"LB":{"n":"Lebanon","e":"112","p":"160","a":"140","f":"175"},"LS":{"n":"Lesotho","p":"123","a":"121","f":"122"},"LR":{"n":"Liberia","e":"911"},"LY":{"n":"Libya","e":"1515","a":"193"},"LI":{"n":"Liechtenstein","e":"112","p":"117","a":"144","f":"118"},"LT":{"n":"Lithuania","e":"112"},"LU":{"n":"Luxembourg","e":"112","p":"113"},"MO":{"n":"Macau","e":"999","x":[["Also works","112"],["Tourism hotline","+853 2831 5566"]],"v":1},"MG":{"n":"Madagascar","p":"117","a":"124","f":"118"},"MW":{"n":"Malawi","p":"997","a":"998","f":"999"},"MY":{"n":"Malaysia","e":"999","x":[["From a mobile phone, also","112"],["Fire (direct)","994"]],"v":1},"MV":{"n":"Maldives","p":"119","a":"102","f":"118","x":[["Police hotline","332 2111"]],"v":1},"ML":{"n":"Mali","p":"17","a":"15","f":"18"},"MT":{"n":"Malta","e":"112"},"MH":{"n":"Marshall Islands","e":"911"},"MR":{"n":"Mauritania","p":"117","a":"101","f":"118"},"MU":{"n":"Mauritius","e":"112","p":"999","a":"114","f":"995"},"MX":{"n":"Mexico","e":"911"},"FM":{"n":"Micronesia","e":"911"},"MD":{"n":"Moldova","e":"112"},"MC":{"n":"Monaco","e":"112","p":"17","a":"18","f":"18"},"MN":{"n":"Mongolia","p":"102","a":"103","f":"101"},"ME":{"n":"Montenegro","e":"112","p":"122","a":"124","f":"123"},"MA":{"n":"Morocco","p":"19","a":"15","f":"15","x":[["From a mobile phone","112"],["Royal Gendarmerie (rural areas)","177"]]},"MZ":{"n":"Mozambique","p":"119","a":"117","f":"198"},"MM":{"n":"Myanmar","p":"199","a":"192","f":"191","x":[["Tourist Police Yangon","+959 448 539 519"],["Tourist Police Mandalay","+959 791 107 831"],["Tourist Police Bagan","+959 448 539 508"]],"v":1},"NA":{"n":"Namibia","p":"10111"},"NR":{"n":"Nauru","p":"110","a":"111","f":"112"},"NP":{"n":"Nepal","p":"100","a":"102","f":"101","v":1},"NL":{"n":"Netherlands","e":"112"},"NC":{"n":"New Caledonia","e":"112","p":"17","a":"15","f":"18"},"NZ":{"n":"New Zealand","e":"111","v":1},"NI":{"n":"Nicaragua","p":"118","a":"128","f":"115"},"NE":{"n":"Niger","p":"17","a":"15","f":"18"},"NG":{"n":"Nigeria","e":"112"},"MK":{"n":"North Macedonia","e":"112","p":"192","a":"194","f":"193"},"NO":{"n":"Norway","p":"112","a":"113","f":"110"},"OM":{"n":"Oman","e":"9999"},"PK":{"n":"Pakistan","p":"15","a":"1122","f":"16"},"PW":{"n":"Palau","e":"911"},"PS":{"n":"Palestine","p":"100","a":"101","f":"102"},"PA":{"n":"Panama","e":"911","p":"104","f":"103"},"PG":{"n":"Papua New Guinea","p":"112","a":"111","f":"110"},"PY":{"n":"Paraguay","e":"911"},"PE":{"n":"Peru","e":"911","p":"105","a":"106","f":"116"},"PH":{"n":"Philippines","e":"911","v":1},"PL":{"n":"Poland","e":"112","p":"997","a":"999","f":"998"},"PT":{"n":"Portugal","e":"112"},"PR":{"n":"Puerto Rico","e":"911"},"QA":{"n":"Qatar","e":"999","v":1},"CG":{"n":"Republic of the Congo","p":"117","f":"118"},"RO":{"n":"Romania","e":"112"},"RU":{"n":"Russia","e":"112","p":"102","a":"103","f":"101"},"RW":{"n":"Rwanda","e":"112","a":"912"},"WS":{"n":"Samoa","e":"999","p":"995","a":"996","f":"994"},"SM":{"n":"San Marino","e":"112","a":"118","f":"115"},"ST":{"n":"Sao Tome and Principe","e":"112"},"SA":{"n":"Saudi Arabia","e":"911","p":"999","a":"997","f":"998","x":[["From a mobile phone, also","112"]],"v":1},"SN":{"n":"Senegal","p":"17","a":"1515","f":"18"},"RS":{"n":"Serbia","e":"112","p":"192","a":"194","f":"193"},"SC":{"n":"Seychelles","e":"999","p":"133","a":"151"},"SL":{"n":"Sierra Leone","p":"019","a":"999"},"SG":{"n":"Singapore","p":"999","a":"995","f":"995","x":[["ScamShield Helpline: is this a scam? (24/7)","1799"],["Police Hotline: report a scam","1800 255 0000"],["SMS the police if you can't speak safely","71999","sms"]],"v":1},"SK":{"n":"Slovakia","e":"112","p":"158","a":"155","f":"150"},"SI":{"n":"Slovenia","e":"112","p":"113"},"SB":{"n":"Solomon Islands","p":"999","a":"111","f":"988"},"SO":{"n":"Somalia","p":"888","a":"999","f":"555"},"ZA":{"n":"South Africa","p":"10111","a":"10177","x":[["From a mobile phone","112"]]},"KR":{"n":"South Korea","p":"112","a":"119","f":"119","x":[["Korea Travel Hotline, English (24/7)","1330"]],"v":1},"SS":{"n":"South Sudan","e":"999"},"ES":{"n":"Spain","e":"112","p":"091","v":1},"LK":{"n":"Sri Lanka","p":"119","a":"1990","f":"110","x":[["Tourist Police","+94 11 242 1052"]],"v":1},"SD":{"n":"Sudan","e":"999"},"SR":{"n":"Suriname","p":"115","a":"113","f":"110"},"SE":{"n":"Sweden","e":"112"},"CH":{"n":"Switzerland","e":"112","p":"117","a":"144","f":"118","v":1},"SY":{"n":"Syria","p":"112","a":"110","f":"113"},"TW":{"n":"Taiwan","p":"110","a":"119","f":"119","x":[["Tourist hotline, English (24/7)","0800 011 765"],["Anti-fraud hotline","165"]],"v":1},"TJ":{"n":"Tajikistan","e":"112","p":"102","a":"103","f":"101"},"TZ":{"n":"Tanzania","e":"112","p":"999","a":"114","f":"115"},"TH":{"n":"Thailand","p":"191","a":"1669","f":"199","t":"1155","x":[["Tourist Police (from abroad)","+66 2 678 6800"],["Complaint hotline for foreigners","1111"]],"v":1},"TL":{"n":"Timor-Leste","e":"112"},"TG":{"n":"Togo","p":"117","a":"8200","f":"118"},"TO":{"n":"Tonga","p":"922","a":"933","f":"999"},"TT":{"n":"Trinidad and Tobago","p":"999","a":"811","f":"990"},"TN":{"n":"Tunisia","p":"197","a":"190","f":"198"},"TM":{"n":"Turkmenistan","p":"02","a":"03","f":"01"},"TR":{"n":"Türkiye","e":"112","v":1},"UG":{"n":"Uganda","e":"112","p":"999"},"UA":{"n":"Ukraine","e":"112","p":"102","a":"103","f":"101"},"AE":{"n":"United Arab Emirates","p":"999","a":"998","f":"997","v":1},"GB":{"n":"United Kingdom","e":"999","x":[["Also works","112"],["Police (non-emergency)","101"],["NHS medical advice","111"]],"v":1},"US":{"n":"United States","e":"911","v":1},"UY":{"n":"Uruguay","e":"911"},"UZ":{"n":"Uzbekistan","p":"102","a":"103","f":"101"},"VU":{"n":"Vanuatu","p":"111","a":"112","f":"113"},"VA":{"n":"Vatican City","e":"112"},"VE":{"n":"Venezuela","e":"911"},"VN":{"n":"Vietnam","p":"113","a":"115","f":"114","v":1},"YE":{"n":"Yemen","p":"194","a":"191"},"ZM":{"n":"Zambia","e":"999","x":[["From a mobile phone","112"]]},"ZW":{"n":"Zimbabwe","e":"999","p":"995","a":"994","f":"993"}};
// Singapore missions checked against MFA pages (Sep 2026): [name, phone, after-hours, email]
const SAFETY_SGV = {
  LA: [["Embassy in Vientiane", "+856 21 353 939", "+856 20 5559 9059", "singemb_vte@mfa.sg"]],
  TH: [["Embassy in Bangkok", "+66 2 348 6700", "+66 2 348 6700 (ext 348)", "singemb_bkk@mfa.sg"]],
  MY: [["High Commission in Kuala Lumpur", "+60 3 2161 6277", "+60 16 661 0400", "singhc_kul@mfa.sg"]],
  ID: [["Embassy in Jakarta", "+62 21 5091 5400", "+62 21 5091 5400", "singemb_jkt@mfa.sg"], ["Consulate-General in Medan", "+62 21 8050 1500", "+62 811 6170 339", ""]],
  VN: [["Embassy in Hanoi", "+84 24 3848 9168", "+84 904 696 589", "singemb_han@mfa.sg"], ["Consulate-General in Ho Chi Minh City", "+84 28 3822 5174", "+84 903 113 500", "singcg_hcm@mfa.sg"]],
  PH: [["Embassy in Manila (Taguig)", "+63 2 8856 9922", "+63 917 860 4740", "singemb_mnl@mfa.sg"]],
  KH: [["Embassy in Phnom Penh", "+855 23 221 875", "+855 97 701 7371", "singemb_pnh@mfa.sg"]],
  MM: [["Embassy in Yangon", "+95 1 9 559 001", "+95 9 250 863 840", "singemb_ygn@mfa.sg"]],
  KR: [["Embassy in Seoul", "+82 2 774 2464", "+82 10 7204 6240", "singemb_seo@mfa.sg"]],
  CN: [["Embassy in Beijing", "+86 10 6532 9380", "+86 139 1075 5251", "singemb_bej@mfa.sg"]],
  HK: [["Consulate-General in Hong Kong", "+852 2527 2212", "+852 9466 1251", "singcg_hkg@mfa.sg"]],
};
// 24/7 consular emergency lines, checked against each government's own site (Sep 2026)
const SAFETY_HOTLINE = {
  SG: ["Singapore MFA Duty Office (24/7)", "+65 6379 8800", "mfa_duty_officer@mfa.gov.sg"],
  AU: ["Australian Consular Emergency Centre (24/7)", "+61 2 6261 3305", ""],
  GB: ["UK Foreign Office, FCDO (24/7)", "+44 20 7008 5000", ""],
  US: ["US Overseas Citizens Services (24/7)", "+1 202 501 4444", ""],
  CA: ["Canada Emergency Watch and Response Centre (24/7)", "+1 613 996 8885", "sos@international.gc.ca"],
  NZ: ["New Zealand Consular Emergency line (24/7)", "+64 99 20 20 20", ""],
};
// Country names as used in the Database of Embassies, where they differ
const SAFETY_DBNAME = { BS: "The Bahamas", CN: "People's Republic of China", CD: "Democratic Republic of the Congo", GM: "The Gambia", FM: "Federated States of Micronesia", ST: "São Tomé and Príncipe", TL: "East Timor", TR: "Turkey", US: "United States of America", VA: "Vatican", HK: "People's Republic of China", MO: "People's Republic of China" };
const SAFETY_TZ = {"Asia/Singapore":"SG","Asia/Kuala_Lumpur":"MY","Asia/Kuching":"MY","Asia/Bangkok":"TH","Asia/Jakarta":"ID","Asia/Pontianak":"ID","Asia/Makassar":"ID","Asia/Jayapura":"ID","Asia/Ho_Chi_Minh":"VN","Asia/Saigon":"VN","Asia/Manila":"PH","Asia/Phnom_Penh":"KH","Asia/Vientiane":"LA","Asia/Yangon":"MM","Asia/Rangoon":"MM","Asia/Brunei":"BN","Asia/Dili":"TL","Asia/Tokyo":"JP","Asia/Seoul":"KR","Asia/Taipei":"TW","Asia/Hong_Kong":"HK","Asia/Macau":"MO","Asia/Shanghai":"CN","Asia/Chongqing":"CN","Asia/Urumqi":"CN","Asia/Kolkata":"IN","Asia/Calcutta":"IN","Asia/Colombo":"LK","Indian/Maldives":"MV","Asia/Kathmandu":"NP","Asia/Dhaka":"BD","Asia/Thimphu":"BT","Asia/Ulaanbaatar":"MN","Asia/Dubai":"AE","Asia/Qatar":"QA","Asia/Riyadh":"SA","Asia/Muscat":"OM","Asia/Bahrain":"BH","Asia/Kuwait":"KW","Asia/Amman":"JO","Asia/Jerusalem":"IL","Asia/Tbilisi":"GE","Africa/Cairo":"EG","Europe/Istanbul":"TR","Europe/London":"GB","Europe/Dublin":"IE","Europe/Paris":"FR","Europe/Berlin":"DE","Europe/Rome":"IT","Europe/Madrid":"ES","Europe/Zurich":"CH","Europe/Amsterdam":"NL","Europe/Vienna":"AT","Europe/Athens":"GR","Europe/Lisbon":"PT","Europe/Brussels":"BE","Europe/Prague":"CZ","Europe/Stockholm":"SE","Europe/Oslo":"NO","Europe/Copenhagen":"DK","Europe/Helsinki":"FI","Europe/Budapest":"HU","Europe/Warsaw":"PL","Atlantic/Reykjavik":"IS","Europe/Moscow":"RU","Australia/Sydney":"AU","Australia/Melbourne":"AU","Australia/Brisbane":"AU","Australia/Perth":"AU","Australia/Adelaide":"AU","Australia/Darwin":"AU","Australia/Hobart":"AU","Pacific/Auckland":"NZ","Pacific/Fiji":"FJ","America/New_York":"US","America/Chicago":"US","America/Denver":"US","America/Phoenix":"US","America/Los_Angeles":"US","America/Anchorage":"US","Pacific/Honolulu":"US","America/Toronto":"CA","America/Vancouver":"CA","America/Edmonton":"CA","America/Winnipeg":"CA","America/Halifax":"CA","America/Mexico_City":"MX","America/Sao_Paulo":"BR","America/Argentina/Buenos_Aires":"AR","Africa/Johannesburg":"ZA","Africa/Nairobi":"KE"};

function safetyTelHref(num, scheme) { return `${scheme || 'tel'}:${num.replace(/[^\d+]/g, '')}`; }

function safetyEntries(d) {
  const l = [];
  if (d.e) l.push([(d.p || d.a || d.f) ? 'Emergency (all services)' : 'Emergency (police, ambulance, fire)', d.e, 1]);
  if (d.p) l.push(['Police', d.p, 1]);
  if (d.a && d.a === d.f) l.push(['Ambulance & fire', d.a, 1]);
  else { if (d.a) l.push(['Ambulance', d.a, 1]); if (d.f) l.push(['Fire', d.f, 0]); }
  if (d.t) l.push(['Tourist Police', d.t, 0]);
  (d.x || []).forEach((x) => l.push([x[0], x[1], 0, x[2]]));
  return l;
}

function safetyLookup(code, fallbackName) {
  const d = SAFETY_DATA[code];
  if (d) return { code, n: d.n, l: safetyEntries(d), v: !!d.v, pol: d.p || d.e };
  return { code, n: fallbackName || code, unknown: true, pol: '112', l: [['General emergency number on most mobile phones', '112', 1]] };
}

function safetyTzCountry() {
  try {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (SAFETY_TZ[z]) return SAFETY_TZ[z];
  } catch (err) { /* ignore */ }
  return 'SG';
}

function safetyDbName(code) { return SAFETY_DBNAME[code] || (SAFETY_DATA[code] ? SAFETY_DATA[code].n : code); }

async function detectSafetyCountry() {
  if (safetyCountry || safetyCountryDetectInFlight) return safetyCountryDetectInFlight;
  const override = localStorage.getItem(SAFETY_CTY_OVERRIDE_KEY);
  if (override) {
    safetyCountry = { ...safetyLookup(override), src: 'Chosen by you' };
    refreshSafetyRenderIfNeeded();
    return;
  }
  safetyCountryDetectInFlight = (async () => {
    if (!navigator.geolocation) {
      safetyCountry = { ...safetyLookup(safetyTzCountry()), src: "Based on your phone's time zone" };
      refreshSafetyRenderIfNeeded();
      return;
    }
    await new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            const r = await fetch(`/api/reverse-country?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`);
            const j = await r.json();
            if (j && j.code) {
              safetyCountry = { ...safetyLookup(j.code, j.name), src: 'Detected from your GPS location' };
            } else {
              safetyCountry = { ...safetyLookup(safetyTzCountry()), src: "Based on your phone's time zone" };
            }
          } catch (err) {
            safetyCountry = { ...safetyLookup(safetyTzCountry()), src: "Based on your phone's time zone" };
          }
          resolve();
        },
        () => { safetyCountry = { ...safetyLookup(safetyTzCountry()), src: "Based on your phone's time zone" }; resolve(); },
        GEO_OPTIONS_FAST
      );
    });
    refreshSafetyRenderIfNeeded();
  })();
  return safetyCountryDetectInFlight;
}

function refreshSafetyRenderIfNeeded() {
  if (els.sosModal.classList.contains('hidden')) return;
  if (safetyActiveTab === 'sos' || safetyActiveTab === 'hotlines' || safetyActiveTab === 'check') renderSafetyTab(safetyActiveTab);
}

async function safetyLoadMissions(nat) {
  if (safetyEmbassyCache[nat]) return safetyEmbassyCache[nat];
  const r = await fetch(`/api/embassies?from=${encodeURIComponent(safetyDbName(nat))}`);
  if (!r.ok) throw new Error('unavailable');
  const d = await r.json();
  safetyEmbassyCache[nat] = d;
  return d;
}

const SAFETY_MISSION_TYPE = { embassy: 'Embassy', 'high commission': 'High Commission', 'consulate general': 'Consulate-General', consulate: 'Consulate', 'de facto embassy': 'Representative office', 'de facto consulate': 'Representative office' };

function safetyMissionsFor(list, code) {
  const name = safetyDbName(code);
  const inCity = (m) => code === 'HK' ? /hong kong/i.test(m.city) : code === 'MO' ? /maca[uo]/i.test(m.city) : code === 'CN' ? !/hong kong|maca[uo]/i.test(m.city) : true;
  const order = { embassy: 0, 'high commission': 0, 'de facto embassy': 1, 'consulate general': 2, consulate: 3, 'de facto consulate': 4 };
  const seen = new Set();
  const here = list.filter((m) => m.c === name && inCity(m)).filter((m) => { const k = m.t + m.city; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => (order[a.t] ?? 9) - (order[b.t] ?? 9));
  if (here.length) return { here };
  const cover = list.filter((m) => (m.j || '').split('|').includes(name) && (m.t === 'embassy' || m.t === 'high commission'));
  return { cover };
}

function safetyEmbRowHtml(label, value, href) {
  return `<div class="safety-emb-row"><span>${escapeHtml(label)}</span>${href ? `<a href="${href}">${escapeHtml(value)}</a>` : escapeHtml(value)}</div>`;
}

async function renderSafetyEmbassyCard(c, nat) {
  const card = document.getElementById('safetyEmbCard');
  if (!card) return;
  if (!nat || nat === c.code || (c.unknown && !c.code)) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  const natName = SAFETY_DATA[nat] ? SAFETY_DATA[nat].n : nat;
  const body = document.getElementById('safetyEmbBody');
  const title = document.getElementById('safetyEmbTitle');
  const note = document.getElementById('safetyEmbNote');
  title.textContent = `${natName} help in ${c.n}`;
  const hot = SAFETY_HOTLINE[nat];
  const hotHtml = hot ? `<div class="safety-emb"><b>${escapeHtml(hot[0])}</b>${safetyEmbRowHtml('Call from anywhere', hot[1], safetyTelHref(hot[1]))}${hot[2] ? safetyEmbRowHtml('Email', hot[2], 'mailto:' + hot[2]) : ''}</div>` : '';
  if (nat === 'SG' && SAFETY_SGV[c.code]) {
    body.innerHTML = SAFETY_SGV[c.code].map((m) => `<div class="safety-emb"><b>Singapore ${escapeHtml(m[0])}</b>${safetyEmbRowHtml('Office hours', m[1], safetyTelHref(m[1]))}${safetyEmbRowHtml('After hours / emergency', m[2], safetyTelHref(m[2].replace(/\(.*\)/, '')))}${m[3] ? safetyEmbRowHtml('Email', m[3], 'mailto:' + m[3]) : ''}</div>`).join('') + hotHtml;
    note.textContent = 'Checked against Singapore MFA pages in September 2026.';
    return;
  }
  body.innerHTML = `<div class="safety-sub">Loading ${escapeHtml(natName)} embassy details…</div>` + hotHtml;
  try {
    const list = await safetyLoadMissions(nat);
    if (safetyCountry.code !== c.code) return;
    const { here, cover } = safetyMissionsFor(list, c.code);
    let html = '';
    if (here && here.length) {
      html = here.slice(0, 4).map((m) => `<div class="safety-emb"><b>${escapeHtml(SAFETY_MISSION_TYPE[m.t] || m.t)} of ${escapeHtml(natName)} · ${escapeHtml(m.city || c.n)}</b>${m.a ? `<div class="safety-emb-addr">${escapeHtml(m.a)}</div>` : ''}${m.ph ? safetyEmbRowHtml('Phone', m.ph, safetyTelHref(m.ph)) : ''}${m.em ? safetyEmbRowHtml('Email', m.em, 'mailto:' + m.em) : ''}${m.w ? safetyEmbRowHtml('Website', 'Open website', m.w) : ''}${!m.ph && !m.em && !m.w ? `<div class="safety-emb-addr">No phone or email in the database. Use the 24/7 line below.</div>` : ''}</div>`).join('');
    } else if (cover && cover.length) {
      const m = cover[0];
      html = `<div class="safety-emb"><b>No ${escapeHtml(natName)} embassy in ${escapeHtml(c.n)}</b><div class="safety-emb-addr">Covered by the ${escapeHtml(SAFETY_MISSION_TYPE[m.t] || m.t)} in ${escapeHtml(m.city)}, ${escapeHtml(m.c)}.</div>${m.ph ? safetyEmbRowHtml('Phone', m.ph, safetyTelHref(m.ph)) : ''}${m.em ? safetyEmbRowHtml('Email', m.em, 'mailto:' + m.em) : ''}${m.w ? safetyEmbRowHtml('Website', 'Open website', m.w) : ''}</div>`;
    } else {
      html = `<div class="safety-emb"><b>No ${escapeHtml(natName)} embassy listed in ${escapeHtml(c.n)}</b><div class="safety-emb-addr">Contact your country's foreign ministry for help.</div></div>`;
    }
    body.innerHTML = html + hotHtml;
    note.textContent = 'From the open Database of Embassies (Wikidata). Phone and email appear only where the database has them; otherwise use the embassy website.';
  } catch (err) {
    body.innerHTML = `<div class="safety-emb"><b>Couldn't load embassy details</b><div class="safety-emb-addr">Check your internet connection and open this tab again.</div></div>` + hotHtml;
    note.textContent = '';
  }
}

function renderSafetyHotlinesTab() {
  if (!safetyCountry) {
    els.sosModalBody.innerHTML = `<h3>Get help now</h3><p class="safety-sub">Finding your location…</p>`;
    detectSafetyCountry();
    return;
  }
  const c = safetyCountry;
  const nat = localStorage.getItem(SAFETY_NAT_KEY) || 'SG';
  const countryOptions = ['<option value="">Detect automatically</option>']
    .concat(Object.keys(SAFETY_DATA).sort((a, b) => SAFETY_DATA[a].n.localeCompare(SAFETY_DATA[b].n)).map((k) => `<option value="${k}">${escapeHtml(SAFETY_DATA[k].n)}</option>`))
    .join('');
  const natOptions = Object.keys(SAFETY_DATA).sort((a, b) => SAFETY_DATA[a].n.localeCompare(SAFETY_DATA[b].n)).map((k) => `<option value="${k}">${escapeHtml(SAFETY_DATA[k].n)}</option>`).join('');
  const override = localStorage.getItem(SAFETY_CTY_OVERRIDE_KEY) || '';

  els.sosModalBody.innerHTML = `
    <h3>Get help now</h3>
    <div class="safety-where">
      <div><div class="safety-sub" style="margin:0 0 2px">You are in</div><div class="safety-where-who">${escapeHtml(c.n)}</div><div class="safety-sub" style="margin:2px 0 0">${escapeHtml(c.unknown ? `${c.src}. We don't have this country's numbers yet, so check locally.` : c.src)}</div></div>
      <select id="safetyCtySel" aria-label="Choose country">${countryOptions}</select>
      <div class="safety-nat"><label class="safety-sub" style="margin:0" for="safetyNatSel">Your nationality</label><select id="safetyNatSel" aria-label="Your nationality">${natOptions}</select></div>
    </div>
    <div class="safety-list">${c.l.map((x) => `<div class="safety-hot${x[2] ? ' urgent' : ''}"><div class="safety-hot-num"${x[1].length > 9 ? ' style="font-size:17px"' : ''}>${escapeHtml(x[1])}</div><div class="safety-hot-what">${escapeHtml(x[0])}</div><a class="pill-btn ${x[2] ? 'primary' : ''}" href="${safetyTelHref(x[1], x[3])}">${x[3] === 'sms' ? 'SMS' : 'Call'}</a></div>`).join('')}</div>
    <p class="safety-sub">${escapeHtml(c.unknown ? '' : c.v ? 'These numbers were checked against Singapore MFA travel pages and official sources in September 2026.' : 'These numbers come from a public list of emergency numbers and haven\'t been individually checked. Confirm them when you arrive.')}</p>
    <div class="safety-emb hidden" id="safetyEmbCard">
      <b id="safetyEmbTitle">Your embassy</b>
      <div id="safetyEmbBody" style="display:flex;flex-direction:column;gap:8px;margin-top:6px"></div>
      <p class="safety-sub" id="safetyEmbNote" style="margin-top:6px"></p>
    </div>
    <div class="sos-form" style="margin-top:12px">
      <div class="safety-sub" style="margin:0 0 6px;font-weight:700;color:var(--ink)">If you've been scammed</div>
      <ol class="safety-tips">
        <li>Call your bank's 24-hour hotline right away to freeze your account and cards.</li>
        <li>Stop all contact with the scammer. Don't send any more money or codes.</li>
        <li>${c.code === 'SG' ? "Report it to the police at 1800 255 0000 or online at police.gov.sg/i-witness, and ask for a report number for your bank." : `Report it to the police in ${escapeHtml(c.n)}${c.unknown ? '' : ` (${escapeHtml(c.pol)})`} and ask for a report number for your bank.`}</li>
        <li>Keep screenshots of chats, phone numbers and transaction records.</li>
        <li>Uninstall any app the caller asked you to install (e.g. AnyDesk, TeamViewer).</li>
      </ol>
    </div>
    <p class="safety-sub">Numbers can change. Confirm local emergency numbers with your hotel or your country's embassy when you arrive.</p>
  `;
  document.getElementById('safetyCtySel').value = override;
  document.getElementById('safetyCtySel').addEventListener('change', (e) => {
    if (e.target.value) localStorage.setItem(SAFETY_CTY_OVERRIDE_KEY, e.target.value);
    else localStorage.removeItem(SAFETY_CTY_OVERRIDE_KEY);
    safetyCountry = null;
    detectSafetyCountry().then(() => renderSafetyHotlinesTab());
  });
  document.getElementById('safetyNatSel').value = nat;
  document.getElementById('safetyNatSel').addEventListener('change', (e) => {
    localStorage.setItem(SAFETY_NAT_KEY, e.target.value);
    renderSafetyEmbassyCard(safetyCountry, e.target.value);
  });
  renderSafetyEmbassyCard(c, nat);
}

// ---------- Share ----------

els.shareBtn.addEventListener('click', async () => {
  const shareData = {
    title: 'Waypoint',
    text: 'Waypoint — a clean, ad-free maps & directions app for Singapore.',
    url: location.origin,
  };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
    } catch (err) {
      if (err.name !== 'AbortError') console.error(err);
    }
    return;
  }

  try {
    await navigator.clipboard.writeText(shareData.url);
    showToast('Link copied — share it with a friend!');
  } catch (err) {
    console.error(err);
    showToast(shareData.url, 5000);
  }
});

// ---------- Offline support ----------
// Registers the service worker (public/sw.js) so the app shell loads
// instantly with no signal, and shows a banner while offline. Search,
// routing, and live bus/weather/carpark data still need a connection —
// this only covers the app shell + whatever a browser cache can hold.

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('Service worker registration failed:', err);
    });
  });
}

function updateOfflineBanner() {
  if (!els.offlineBanner) return;
  els.offlineBanner.classList.toggle('hidden', navigator.onLine);
}

window.addEventListener('online', () => {
  updateOfflineBanner();
  showToast('✅ Back online.');
});
window.addEventListener('offline', () => {
  updateOfflineBanner();
  showToast("📡 You're offline — saved places still work, but search/routing/live data need a connection.", 4000);
});
updateOfflineBanner();

// ---------- Push notifications (MRT/LRT disruptions + major traffic incidents) ----------
// One combined on/off toggle (the 🔔 button in the topbar) rather than
// separate switches — simpler for a first version. Subscribing asks the
// browser/OS for notification permission, then registers a Push subscription
// with our server, which sends a notification the moment it detects a new
// MRT/LRT disruption or a serious traffic incident (see server.js) — even if
// Waypoint isn't open.

const PUSH_ENABLED_KEY = 'waypoint_push_enabled';

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// Web Push wants the VAPID public key as a Uint8Array, but the server hands
// it over as a URL-safe base64 string — this is the standard conversion.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

function updateNotifyButton() {
  if (!els.notifyBtn) return;
  const enabled = localStorage.getItem(PUSH_ENABLED_KEY) === '1';
  els.notifyBtn.classList.toggle('active', enabled);
  els.notifyBtn.title = enabled ? 'Train/traffic/haze alerts are ON — tap to turn off' : 'Turn on train/traffic/haze alerts';
}

async function enablePushAlerts() {
  if (!pushSupported()) {
    showToast("Push notifications aren't supported in this browser.");
    return;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      showToast('Notification permission was not granted — you can allow it later in your browser/app settings.');
      return;
    }
    const { publicKey, enabled } = await (await fetch('/api/push/vapid-public-key')).json();
    if (!enabled || !publicKey) {
      showToast("Alerts aren't set up on the server yet — try again later.");
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub }),
    });
    localStorage.setItem(PUSH_ENABLED_KEY, '1');
    updateNotifyButton();
    showToast("🔔 Alerts enabled — you'll get a notification for MRT/LRT disruptions and major traffic incidents.", 4000);
  } catch (err) {
    console.error(err);
    const detail = err && (err.message || err.name) ? `: ${err.name || ''} ${err.message || ''}`.trim() : '';
    showToast(`Could not enable notifications${detail}.`, 6000);
  }
}

async function disablePushAlerts() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
    }
  } catch (err) {
    console.error(err);
  }
  localStorage.removeItem(PUSH_ENABLED_KEY);
  updateNotifyButton();
  showToast('Alerts turned off.');
}

if (els.notifyBtn) {
  els.notifyBtn.addEventListener('click', () => {
    const enabled = localStorage.getItem(PUSH_ENABLED_KEY) === '1';
    if (enabled) disablePushAlerts();
    else enablePushAlerts();
  });
}
updateNotifyButton();

// ---------- Alert nudge banner (encourage turning on the 🔔 button) --------
// The bell button above is opt-in and easy to miss on first visit, so most
// people never discover MRT/LRT disruption and major traffic incident
// alerts exist at all. This nudges once per visit (throttled like the
// install banner below, same "Not now" for ~2 weeks convention) rather than
// leaving it undiscovered forever.

const ALERT_NUDGE_DISMISS_KEY = 'waypoint_alert_nudge_dismissed_at';
const ALERT_NUDGE_DISMISS_DAYS = 14;

function alertNudgeDismissedRecently() {
  const raw = localStorage.getItem(ALERT_NUDGE_DISMISS_KEY);
  if (!raw) return false;
  const daysSince = (Date.now() - parseInt(raw, 10)) / (1000 * 60 * 60 * 24);
  return daysSince < ALERT_NUDGE_DISMISS_DAYS;
}

function maybeShowAlertNudge() {
  if (!els.alertNudgeBanner) return;
  const alreadyEnabled = localStorage.getItem(PUSH_ENABLED_KEY) === '1';
  // Don't stack this on top of the install banner (same fixed bottom-of-
  // screen spot) — whichever shows first wins, the other waits its turn.
  const installBannerShowing = els.installBanner && !els.installBanner.classList.contains('hidden');
  // A brand-new visitor (no localStorage yet, not arriving via a deep link)
  // is about to get the "Buy Melvin a coffee" full-screen popup at 2500ms
  // (see paynowCoffeePopup below) — skip the nudge on this exact load rather
  // than stack two prompts on someone's very first visit. It'll show
  // normally on their next visit instead, un-throttled since we never set
  // the dismiss key here.
  const incomingParams = new URLSearchParams(window.location.search);
  const coffeePopupPending = !localStorage.getItem('paynow_coffee_popup_shown_v1') && !incomingParams.has('dest_lat');
  if (alreadyEnabled || !pushSupported() || alertNudgeDismissedRecently() || installBannerShowing || coffeePopupPending) return;
  els.alertNudgeBanner.classList.remove('hidden');
}

if (els.alertNudgeBtn) {
  els.alertNudgeBtn.addEventListener('click', () => {
    els.alertNudgeBanner.classList.add('hidden');
    enablePushAlerts();
  });
}
if (els.alertNudgeDismissBtn) {
  els.alertNudgeDismissBtn.addEventListener('click', () => {
    els.alertNudgeBanner.classList.add('hidden');
    localStorage.setItem(ALERT_NUDGE_DISMISS_KEY, String(Date.now()));
  });
}
// Small delay so it doesn't compete with the browser's own permission-prompt
// UI or other on-load toasts for attention.
setTimeout(maybeShowAlertNudge, 1800);

// ---------- PWA install banner ----------
// Chrome/Edge (Android + desktop) fire "beforeinstallprompt" when the app
// qualifies for install (has a manifest + icons, which we already set up).
// iOS Safari never fires this event — there's no equivalent prompt to hook.

const INSTALL_DISMISS_KEY = 'waypoint_install_dismissed_at';
const INSTALL_DISMISS_DAYS = 14; // don't nag again for a couple weeks after "Not now"

let deferredInstallPrompt = null;

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function installDismissedRecently() {
  const raw = localStorage.getItem(INSTALL_DISMISS_KEY);
  if (!raw) return false;
  const daysSince = (Date.now() - parseInt(raw, 10)) / (1000 * 60 * 60 * 24);
  return daysSince < INSTALL_DISMISS_DAYS;
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  const alertNudgeShowing = els.alertNudgeBanner && !els.alertNudgeBanner.classList.contains('hidden');
  if (isStandalone() || installDismissedRecently() || alertNudgeShowing) return;
  deferredInstallPrompt = e;
  els.installBanner.classList.remove('hidden');
});

els.installBtn.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  els.installBanner.classList.add('hidden');
  deferredInstallPrompt.prompt();
  try {
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome !== 'accepted') {
      localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
    }
  } catch (err) {
    console.error(err);
  }
  deferredInstallPrompt = null;
});

els.installDismissBtn.addEventListener('click', () => {
  els.installBanner.classList.add('hidden');
  localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
  deferredInstallPrompt = null;
});

window.addEventListener('appinstalled', () => {
  els.installBanner.classList.add('hidden');
  deferredInstallPrompt = null;
});

// ---------- Current weather widget (topbar) ----------
// Ambient conditions indicator (e.g. "☀️ Fair") next to the locate button —
// reuses the same NEA-backed /api/weather-nearby endpoint that powers rain
// alerts. Geolocates silently on load (no error toast; this isn't something
// the user asked for, just a nice-to-have), falling back to a central
// Singapore point if location isn't available so it still shows something.

const SG_CENTER = { lat: 1.3521, lon: 103.8198 };
const WEATHER_WIDGET_REFRESH_MS = 10 * 60 * 1000;
let weatherWidgetTimer = null;

async function loadWeatherWidget(coords) {
  try {
    const [wxRes, psiRes, pm25Res, uvRes] = await Promise.all([
      fetch(`/api/weather-nearby?lat=${coords.lat}&lon=${coords.lon}`),
      // PSI, PM2.5 and UV Index are nice-to-haves alongside the weather text
      // — never let a failure here (or the endpoint being briefly
      // unavailable) block the weather widget itself.
      fetch(`/api/psi-nearby?lat=${coords.lat}&lon=${coords.lon}`).catch(() => null),
      fetch(`/api/pm25-nearby?lat=${coords.lat}&lon=${coords.lon}`).catch(() => null),
      fetch('/api/uv-index').catch(() => null), // island-wide, no lat/lon needed
    ]);
    const data = await wxRes.json();
    if (!wxRes.ok || !data.forecast) {
      els.weatherWidget.classList.add('hidden');
      return;
    }

    let psiSuffix = '';
    delete els.weatherWidget.dataset.psi;
    if (psiRes && psiRes.ok) {
      const psiData = await psiRes.json();
      if (psiData.psi != null) {
        els.weatherWidget.dataset.psi = psiData.psi;
        els.weatherWidget.dataset.psiCategory = psiData.category || '';
        els.weatherWidget.dataset.psiRegion = psiData.region || '';
        els.weatherWidget.dataset.psiMaskAdvice = psiData.maskAdvice || '';
        psiSuffix = ' 😷'; // icon only — the actual PSI number is in the detail panel this button opens
      }
    }

    let pm25Suffix = '';
    delete els.weatherWidget.dataset.pm25;
    if (pm25Res && pm25Res.ok) {
      const pm25Data = await pm25Res.json();
      if (pm25Data.pm25 != null) {
        els.weatherWidget.dataset.pm25 = pm25Data.pm25;
        els.weatherWidget.dataset.pm25Category = pm25Data.category || '';
        els.weatherWidget.dataset.pm25Region = pm25Data.region || '';
        // Only worth surfacing in the compact widget once it's past Normal —
        // same "don't clutter the common case" rule as UV's threshold below.
        if (pm25Data.pm25 > 55) pm25Suffix = ' 🌫️'; // icon only, same as PSI/UV below
      }
    }

    let uvSuffix = '';
    delete els.weatherWidget.dataset.uv;
    if (uvRes && uvRes.ok) {
      const uvData = await uvRes.json();
      // A UV value of 0 is a real, common reading (before sunrise/after
      // sunset) — only skip on a genuine null (fetch/parse failure upstream).
      if (uvData.value != null) {
        els.weatherWidget.dataset.uv = uvData.value;
        els.weatherWidget.dataset.uvCategory = uvData.category || '';
        // Only worth flagging in the compact widget text once it's actually
        // enough to matter — Low UV before 8am/after 6pm would just be noise.
        if (uvData.value >= 3) uvSuffix = ' ☀️'; // icon only, same as PSI/PM2.5 above
      }
    }

    // Just the icon, not the forecast word ("Partly Cloudy (Day)") — that text
    // was the single biggest reason this pill kept forcing the brand flag/name
    // next to it into overlapping the topbar buttons on a narrow phone. The
    // full forecast is still one tap/long-press away via the title tooltip
    // and the actual weather detail panel this button opens.
    els.weatherWidget.textContent = `${data.icon || '🌤️'}${psiSuffix}${pm25Suffix}${uvSuffix}`;
    els.weatherWidget.title = `${data.forecast} near ${data.area} — tap for details`;
    els.weatherWidget.dataset.area = data.area;
    els.weatherWidget.dataset.forecast = data.forecast;
    els.weatherWidget.classList.remove('hidden');
  } catch (err) {
    console.error('weather widget failed:', err);
    els.weatherWidget.classList.add('hidden');
  }
}

function initWeatherWidget() {
  const refresh = (coords) => {
    loadWeatherWidget(coords);
    clearInterval(weatherWidgetTimer);
    weatherWidgetTimer = setInterval(() => loadWeatherWidget(coords), WEATHER_WIDGET_REFRESH_MS);
  };

  if (!navigator.geolocation) {
    refresh(SG_CENTER);
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => refresh({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
    () => refresh(SG_CENTER), // silent fallback — ambient widget, not a user-initiated action
    GEO_OPTIONS
  );
}

// ---------- Today's detailed weather panel ----------
// Tapping the widget opens a fuller outlook (temperature/humidity/wind range
// for today, via NEA's 24-hour forecast) alongside the hyper-local 2-hour
// condition the widget itself already shows.

// Standard WHO UV Index scale — same bands/colors as uvCategory() in
// server.js (keep in sync if that ever changes). Shown as a small reference
// strip in the weather panel so people know what a given number actually
// means, not just today's raw value. Band NAMES alone ("Moderate", "High")
// don't tell most people anything actionable, so each band also carries a
// plain-language "what to actually do" line, shown for today's current
// value rather than making people learn what the jargon means.
const UV_BANDS = [
  { max: 2, range: '0-2', label: 'Low', color: '2E7D32', advice: 'No real precautions needed.' },
  { max: 5, range: '3-5', label: 'Moderate', color: 'F9A825', advice: 'Seek shade during midday; sunscreen if you\'ll be out a while.' },
  { max: 7, range: '6-7', label: 'High', color: 'EF6C00', advice: 'Wear sunscreen, a hat and sunglasses; limit midday sun.' },
  { max: 10, range: '8-10', label: 'Very High', color: 'C62828', advice: 'Unprotected skin can burn in under 30 min — avoid midday sun.' },
  { max: Infinity, range: '11+', label: 'Extreme', color: '6A1B9A', advice: 'Skin can burn in 10–15 min — avoid sun 11am–3pm if you can.' },
];

function renderUvScale(value) {
  let currentBand = null;
  const bandsHtml = UV_BANDS.map((band, i) => {
    const prevMax = i === 0 ? -Infinity : UV_BANDS[i - 1].max;
    const isCurrent = value != null && value > prevMax && value <= band.max;
    if (isCurrent) currentBand = band;
    return `<div class="uv-scale-band${isCurrent ? ' current' : ''}" style="background:#${band.color}">`
      + `<span class="uv-scale-range">${band.range}</span>`
      + `<span class="uv-scale-label">${band.label}</span>`
      + '</div>';
  }).join('');
  // The advice line is the actual point — what to do right now — not just
  // which jargon bucket today falls into.
  const adviceHtml = currentBand
    ? `<p class="uv-scale-advice">${currentBand.advice}</p>`
    : '';
  return `<div class="uv-scale">${bandsHtml}</div>${adviceHtml}`;
}

// Official NEA PSI scale — same bands/colors as psiCategory() in server.js
// (keep in sync if that ever changes). Reuses the uv-scale-* CSS classes
// since the visual (a row of colored bands, current one highlighted, with
// an advice line for today's value) is identical to the UV scale above.
// Guidance text is NEA's own general-population activity guidance from
// haze.gov.sg, not a guess — this answers "how bad is the haze right now"
// on the full scale, distinct from the mask-specific line shown above it
// (which uses MOH's separate, higher mask thresholds).
const PSI_BANDS = [
  { max: 50, range: '0-50', label: 'Good', color: '2E7D32', advice: 'Normal activities can be carried out as usual.' },
  { max: 100, range: '51-100', label: 'Moderate', color: 'F9A825', advice: 'Normal activities as usual. If you\'re unusually sensitive to haze, cutting down on prolonged outdoor exertion can help.' },
  { max: 200, range: '101-200', label: 'Unhealthy', color: 'EF6C00', advice: 'Reduce prolonged or strenuous outdoor physical exertion.' },
  { max: 300, range: '201-300', label: 'Very Unhealthy', color: 'C62828', advice: 'Avoid prolonged or strenuous outdoor physical exertion.' },
  { max: Infinity, range: '301+', label: 'Hazardous', color: '6A1B9A', advice: 'Minimise outdoor activity.' },
];

function renderPsiScale(value) {
  let currentBand = null;
  const bandsHtml = PSI_BANDS.map((band, i) => {
    const prevMax = i === 0 ? -Infinity : PSI_BANDS[i - 1].max;
    const isCurrent = value != null && value > prevMax && value <= band.max;
    if (isCurrent) currentBand = band;
    return `<div class="uv-scale-band${isCurrent ? ' current' : ''}" style="background:#${band.color}">`
      + `<span class="uv-scale-range">${band.range}</span>`
      + `<span class="uv-scale-label">${band.label}</span>`
      + '</div>';
  }).join('');
  const adviceHtml = currentBand
    ? `<p class="uv-scale-advice">${currentBand.advice}</p>`
    : '';
  return `<div class="uv-scale">${bandsHtml}</div>${adviceHtml}`;
}

// Official NEA PM2.5 one-hour bands (µg/m³) — same bands/colors as
// pm25Category() in server.js. PM2.5 is a faster-moving complement to the
// 24-hour PSI above it: it updates hourly and reacts to a worsening haze
// well before the 24-hour PSI average catches up, so it's shown as its own
// line + scale rather than folded into the PSI one. Band descriptions here
// are plain descriptions of what the number means, not new health/mask
// directives — those stay only in the PSI section above, which is what
// MOH's actual mask guidance is threshold-matched to.
const PM25_BANDS = [
  { max: 55, range: '0-55', label: 'Normal', color: '2E7D32', advice: 'Air is clear — no impact on visibility.' },
  { max: 150, range: '56-150', label: 'Elevated', color: 'F9A825', advice: 'Noticeably hazier than a clear day.' },
  { max: 250, range: '151-250', label: 'High', color: 'EF6C00', advice: 'Haze is heavy, with reduced visibility.' },
  { max: Infinity, range: '251+', label: 'Very High', color: 'C62828', advice: 'Haze is severe — the worst band NEA tracks for PM2.5.' },
];

function renderPm25Scale(value) {
  let currentBand = null;
  const bandsHtml = PM25_BANDS.map((band, i) => {
    const prevMax = i === 0 ? -Infinity : PM25_BANDS[i - 1].max;
    const isCurrent = value != null && value > prevMax && value <= band.max;
    if (isCurrent) currentBand = band;
    return `<div class="uv-scale-band${isCurrent ? ' current' : ''}" style="background:#${band.color}">`
      + `<span class="uv-scale-range">${band.range}</span>`
      + `<span class="uv-scale-label">${band.label}</span>`
      + '</div>';
  }).join('');
  const adviceHtml = currentBand
    ? `<p class="uv-scale-advice">${currentBand.advice}</p>`
    : '';
  return `<div class="uv-scale">${bandsHtml}</div>${adviceHtml}`;
}

function renderWeatherPanel(daily) {
  const area = els.weatherWidget.dataset.area;
  const nowForecast = els.weatherWidget.dataset.forecast;
  const nowLine = area && nowForecast
    ? `<p class="weather-panel-now">📍 Right now near <strong>${area}</strong>: ${nowForecast}</p>`
    : '';
  const psi = els.weatherWidget.dataset.psi;
  const psiMaskAdvice = els.weatherWidget.dataset.psiMaskAdvice;
  // A bare category label ("Moderate", "Unhealthy") doesn't tell most
  // people what to actually do, and guessing tends to overshoot -- the
  // real MOH/HealthHub guidance doesn't call for a mask until well past
  // where "Unhealthy" alone might suggest (see maskAdvice() in server.js
  // for the exact thresholds and sourcing). Spelling that out here directly
  // instead of leaving people to interpret the label themselves.
  const psiLine = psi
    ? `<p class="weather-panel-now">😷 PSI (24-hr) in <strong>${els.weatherWidget.dataset.psiRegion}</strong>: <strong>${psi}</strong> — ${els.weatherWidget.dataset.psiCategory}${psiMaskAdvice ? `<br><span class="weather-panel-mask-advice">${psiMaskAdvice}</span>` : ''}</p>${renderPsiScale(Number(psi))}`
    : '';
  const pm25 = els.weatherWidget.dataset.pm25;
  // Shown as its own reading rather than merged into the PSI line above —
  // different unit (µg/m³ vs an index number), different averaging window
  // (1-hr vs 24-hr), and a separate 4-band NEA scale, so treating it as
  // "the same thing as PSI" would misrepresent both numbers.
  const pm25Line = pm25
    ? `<p class="weather-panel-now">🌫️ PM2.5 (1-hr) in <strong>${els.weatherWidget.dataset.pm25Region}</strong>: <strong>${pm25}</strong> µg/m³ — ${els.weatherWidget.dataset.pm25Category}</p>${renderPm25Scale(Number(pm25))}`
    : '';
  const uv = els.weatherWidget.dataset.uv;
  const uvLine = uv
    ? `<p class="weather-panel-now">☀️ UV Index: <strong>${uv}</strong> — ${els.weatherWidget.dataset.uvCategory}</p>${renderUvScale(Number(uv))}`
    : '';
  const temp = daily.tempLow != null && daily.tempHigh != null ? `${daily.tempLow}–${daily.tempHigh}°C` : '—';
  const humidity = daily.humidityLow != null && daily.humidityHigh != null ? `${daily.humidityLow}–${daily.humidityHigh}%` : '—';
  const wind = daily.windSpeedLow != null && daily.windSpeedHigh != null
    ? `${daily.windDirection || ''} ${daily.windSpeedLow}–${daily.windSpeedHigh} km/h`.trim()
    : '—';

  els.weatherPanelBody.innerHTML = `
    <div class="weather-panel-icon">${daily.icon || '🌤️'}</div>
    <h3 class="weather-panel-headline">${daily.forecast || "Today's outlook"}</h3>
    ${nowLine}
    ${psiLine}
    ${pm25Line}
    ${uvLine}
    <div class="weather-panel-grid">
      <div><span class="weather-panel-label">Temperature</span><span class="weather-panel-value">${temp}</span></div>
      <div><span class="weather-panel-label">Humidity</span><span class="weather-panel-value">${humidity}</span></div>
      <div><span class="weather-panel-label">Wind</span><span class="weather-panel-value">${wind}</span></div>
    </div>
    <p class="weather-panel-note">Today's outlook, Singapore-wide — via NEA.</p>
  `;
}

async function openWeatherPanel() {
  els.weatherPanel.classList.remove('hidden');
  els.weatherPanelBody.innerHTML = '<div class="weather-panel-loading">Loading…</div>';
  try {
    const res = await fetch('/api/weather-today');
    const data = await res.json();
    if (!res.ok) {
      els.weatherPanelBody.innerHTML = `<div class="weather-panel-loading">${data.error || 'Could not load forecast.'}</div>`;
      return;
    }
    renderWeatherPanel(data);
  } catch (err) {
    console.error('weather panel failed:', err);
    els.weatherPanelBody.innerHTML = '<div class="weather-panel-loading">Could not load forecast.</div>';
  }
}

els.weatherWidget.addEventListener('click', openWeatherPanel);
els.weatherPanelClose.addEventListener('click', () => els.weatherPanel.classList.add('hidden'));
els.weatherPanel.addEventListener('click', (e) => {
  if (e.target === els.weatherPanel) els.weatherPanel.classList.add('hidden');
});

initWeatherWidget();

// ---------- MRT/LRT service disruption banner (LTA TrainServiceAlerts) ----------
// Polls a cached server endpoint every couple of minutes. Dismissing a
// specific alert hides it for the rest of this browser session; a genuinely
// new disruption message (different text) will still show even if an older
// one was dismissed.

const TRAIN_ALERTS_POLL_MS = 2 * 60 * 1000;
let currentTrainAlertMessage = null;
let dismissedTrainAlertMessage = null;

async function checkTrainAlerts() {
  try {
    const res = await fetch('/api/train-alerts');
    const data = await res.json();

    if (!data.disrupted || !data.message) {
      currentTrainAlertMessage = null;
      els.trainAlertBanner.classList.add('hidden');
      return;
    }

    currentTrainAlertMessage = data.message;
    if (currentTrainAlertMessage === dismissedTrainAlertMessage) return;

    const linesPrefix = data.lines && data.lines.length ? `${data.lines.join(', ')}: ` : '';
    els.trainAlertText.textContent = `${linesPrefix}${data.message}`;
    els.trainAlertBanner.classList.remove('hidden');
  } catch (err) {
    console.error('train alerts check failed:', err);
  }
}

els.trainAlertDismiss.addEventListener('click', () => {
  dismissedTrainAlertMessage = currentTrainAlertMessage;
  els.trainAlertBanner.classList.add('hidden');
});

checkTrainAlerts();
setInterval(checkTrainAlerts, TRAIN_ALERTS_POLL_MS);

// ---------- Incoming destination via URL (deep link from other apps) ----------
// Lets an external tool send you straight into a ready route:
//   ?dest_lat=1.311&dest_lon=103.845&dest_label=Mount%20Elizabeth%20Hospital
(function handleIncomingDestination() {
  const params = new URLSearchParams(window.location.search);
  const destLat = parseFloat(params.get('dest_lat'));
  const destLon = parseFloat(params.get('dest_lon'));
  const destLabel = params.get('dest_label');
  if (!destLabel || Number.isNaN(destLat) || Number.isNaN(destLon)) return;

  setTo({ lat: destLat, lon: destLon, label: destLabel, address: destLabel });
  switchToDirectionsTab();

  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setFrom({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: 'Your location' });
      if (fromCoords && toCoords) getDirections();
    },
    (err) => {
      console.error('incoming-destination geolocation error:', err);
      showToast(geoErrorMessage(err) + ' — pick a starting point to get directions.');
    },
    GEO_OPTIONS
  );
})();

// ---------- Buy Melvin a coffee — PayNow QR popup ----------
// Shows once per visitor (localStorage flag), after a short delay so it
// never blocks the page. Skipped entirely if the page was opened via a
// destination deep link (e.g. from the appointment check-in app) — someone
// mid-errand to an appointment shouldn't get a donation popup.
(function paynowCoffeePopup() {
  const MOBILE = '+6581617181';
  const AMOUNT = 1.00;
  const MERCHANT_NAME = 'Melvin';
  const MERCHANT_CITY = 'Singapore';
  const STORAGE_KEY = 'paynow_coffee_popup_shown_v1';

  const incomingParams = new URLSearchParams(window.location.search);
  if (incomingParams.has('dest_lat')) return;
  if (localStorage.getItem(STORAGE_KEY)) return;

  function crc16ccitt(str) {
    let crc = 0xFFFF;
    for (let i = 0; i < str.length; i++) {
      crc ^= (str.charCodeAt(i) << 8);
      for (let j = 0; j < 8; j++) {
        crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  function tlv(tag, value) {
    return `${tag}${String(value.length).padStart(2, '0')}${value}`;
  }

  function buildPayNowPayload() {
    const payNowInfo =
      tlv('00', 'SG.PAYNOW') +
      tlv('01', '0') +        // proxy type: 0 = mobile number
      tlv('02', MOBILE) +
      tlv('03', '0');          // amount not editable (fixed)

    let payload =
      tlv('00', '01') +
      tlv('01', '12') +        // dynamic (carries a fixed amount)
      tlv('26', payNowInfo) +
      tlv('52', '0000') +
      tlv('53', '702') +       // SGD
      tlv('54', AMOUNT.toFixed(2)) +
      tlv('58', 'SG') +
      tlv('59', MERCHANT_NAME.slice(0, 25)) +
      tlv('60', MERCHANT_CITY);

    payload += '6304';
    payload += crc16ccitt(payload);
    return payload;
  }

  function showPopup() {
    const payload = buildPayNowPayload();
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=8&data=${encodeURIComponent(payload)}`;
    // WhatsApp's wa.me share link only supports pre-filled TEXT, not an
    // attached image -- there's no click-to-chat parameter for media. The
    // closest equivalent to "share this QR" is a link to the QR image
    // itself, which the recipient can tap to open/view. Omitting a number
    // from the wa.me URL opens WhatsApp's own contact picker instead of a
    // fixed recipient, since this is meant to be forwarded to whoever the
    // sharer chooses, not sent to one hardcoded number.
    const shareText = `If Waypoint's been useful, you can buy Melvin a coffee via PayNow (totally optional) -- scan or open this QR: ${qrUrl}`;
    const shareUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;

    const style = document.createElement('style');
    style.textContent = `
      .coffee-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 9999; padding: 20px; }
      .coffee-card { background: #fff; border-radius: 14px; padding: 24px 22px; max-width: 320px; width: 100%; text-align: center; box-shadow: 0 12px 40px rgba(0,0,0,0.25); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
      .coffee-card p { margin: 4px 0 14px; font-size: 13.5px; color: #555; }
      .coffee-card img { width: 100%; max-width: 220px; border-radius: 8px; margin-bottom: 14px; }
      .coffee-actions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
      .coffee-close { background: #111; color: #fff; border: none; padding: 10px 18px; border-radius: 8px; font-size: 14px; cursor: pointer; }
      .coffee-share { background: #25D366; color: #fff; border: none; padding: 10px 14px; border-radius: 8px; font-size: 14px; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; }
      .coffee-dismiss { display: block; margin: 10px auto 0; background: none; border: none; color: #888; font-size: 12.5px; cursor: pointer; text-decoration: underline; }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.className = 'coffee-overlay';
    overlay.innerHTML = `
      <div class="coffee-card">
        <p>If Waypoint's been useful, scan to send $1 via PayNow — totally optional!</p>
        <img src="${qrUrl}" alt="PayNow QR code">
        <div class="coffee-actions">
          <button class="coffee-close">Close</button>
          <a class="coffee-share" href="${shareUrl}" target="_blank" rel="noopener">Share via WhatsApp</a>
        </div>
        <button class="coffee-dismiss">Don't show this again</button>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('.coffee-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.coffee-dismiss').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }

  localStorage.setItem(STORAGE_KEY, '1');
  setTimeout(showPopup, 2500);
})();
