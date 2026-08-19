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
let hasRoute = false; // whether a route/itinerary is currently displayed (for mode-switch auto-refresh)

const els = {
  searchInput: document.getElementById('searchInput'),
  searchClear: document.getElementById('searchClear'),
  searchResults: document.getElementById('searchResults'),
  placeCard: document.getElementById('placeCard'),
  placeName: document.getElementById('placeName'),
  placeAddress: document.getElementById('placeAddress'),
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
  routeSteps: document.getElementById('routeSteps'),
  itineraryOptions: document.getElementById('itineraryOptions'),
  rainBanner: document.getElementById('rainBanner'),
  rainBannerText: document.getElementById('rainBannerText'),
  locateBtn: document.getElementById('locateBtn'),
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
  nearbyStopsBtn: document.getElementById('nearbyStopsBtn'),
  favSearchInput: document.getElementById('favSearchInput'),
  favSearchResults: document.getElementById('favSearchResults'),
  favList: document.getElementById('favList'),
  favEmptyHint: document.getElementById('favEmptyHint'),
};

let currentPlace = null; // last searched place result

// ---------- Utilities ----------

function debounce(fn, delay) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
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
    sub.textContent = addressText(r);
    li.appendChild(title);
    li.appendChild(sub);
    li.addEventListener('click', () => onPick(r));
    listEl.appendChild(li);
  });
}

function selectSearchResult(r) {
  currentPlace = r;
  els.searchResults.innerHTML = '';
  els.searchInput.value = shortLabel(r);

  els.placeName.textContent = shortLabel(r);
  els.placeAddress.textContent = addressText(r);
  els.placeCard.classList.remove('hidden');
}

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
// as a one-tap "To" destination from the Directions panel — the common case
// of "route me home/to work" without retyping the address every time.

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
  els.quickHomeBtn.title = home ? `Directions to ${home.label}` : 'Not set yet — search a place, then "Set as Home"';
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

function useQuickLocation(key, label) {
  const loc = loadQuickLocation(key);
  if (!loc) {
    showToast(`Set your ${label} first — search a place, then tap "Set as ${label}".`);
    document.querySelector('.tab-btn[data-tab="search"]').click();
    return;
  }
  setTo(loc);
  switchToDirectionsTab();
}

els.quickHomeBtn.addEventListener('click', () => useQuickLocation(HOME_KEY, 'Home'));
els.quickWorkBtn.addEventListener('click', () => useQuickLocation(WORK_KEY, 'Work'));

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
  if (!els.searchInput.contains(e.target) && !els.searchResults.contains(e.target)) els.searchResults.innerHTML = '';
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
    if (fromCoords && toCoords && hasRoute) {
      getDirections();
    }
  });
});

els.getDirectionsBtn.addEventListener('click', getDirections);

async function getDirections() {
  if (!fromCoords || !toCoords) return;
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
  const url = `https://router.project-osrm.org/route/v1/${selectedMode}/${coordStr}?overview=full&geometries=geojson&steps=true`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (data.code !== 'Ok' || !data.routes || !data.routes.length) {
      showToast('Could not find a route between those points.');
      return;
    }

    const route = data.routes[0];
    hasRoute = true;
    renderRouteSummary(route);
    renderRouteSteps(route);
    if (selectedMode === 'walking') checkRainAlert(fromCoords, toCoords);
    else hideRainAlert();
  } catch (err) {
    console.error(err);
    showToast('Routing service unavailable. Please try again.');
  } finally {
    els.getDirectionsBtn.disabled = false;
    els.getDirectionsBtn.textContent = 'Get Directions';
  }
}

// ---------- Transit (bus / MRT) directions ----------

const MODE_ICON = { walk: '🚶', bus: '🚌', train: '🚇', ferry: '⛴' };

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
      return;
    }

    // Sort fastest-first so the quickest option is always what's shown/selected
    // by default — OTP's own return order is by internal search criteria
    // (roughly departure time), not duration.
    transitItineraries = [...data.itineraries].sort((a, b) => a.duration - b.duration);
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
    return;
  }

  els.itineraryOptions.classList.remove('hidden');

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
      const icon = document.createElement('span');
      icon.textContent = MODE_ICON[leg.mode] || '➜';
      modes.appendChild(icon);
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

    const badge = document.createElement('span');
    badge.className = 'io-badge' + (i === 0 ? ' io-badge-fastest' : '');
    const transferCount = Math.max(transitLegs.length - 1, 0);
    const transferText = transferCount > 0 ? `${transferCount} transfer${transferCount > 1 ? 's' : ''}` : 'Direct';
    badge.textContent = i === 0 ? `Fastest · ${transferText}` : transferText;

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

  hasRoute = true;
  renderTransitSummary(itinerary);
  renderTransitSteps(itinerary);
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

    const icon = document.createElement('span');
    icon.className = 'step-num';
    icon.textContent = MODE_ICON[leg.mode] || '➜';

    const text = document.createElement('span');
    if (leg.mode === 'walk') {
      const toCode = leg.toStopCode ? ` (Bus Stop ${leg.toStopCode})` : '';
      text.textContent = `Walk to ${leg.to}${toCode} — ${formatDistance(leg.distance)}, ${formatDuration(leg.duration)}`;
    } else {
      const line = leg.routeName ? `${leg.mode === 'train' ? 'Line' : 'Bus'} ${leg.routeName}` : leg.mode;
      const headsign = leg.headsign ? ` towards ${leg.headsign}` : '';
      const fromCode = leg.fromStopCode ? ` (${leg.fromStopCode})` : '';
      const toCode = leg.toStopCode ? ` (${leg.toStopCode})` : '';
      text.innerHTML = `<strong>${line}</strong>${headsign}<br>`
        + `${leg.from}${fromCode} → ${leg.to}${toCode} — ${formatDuration(leg.duration)} (${formatClockTime(leg.startTime)})`;
    }
    row.appendChild(icon);
    row.appendChild(text);
    li.appendChild(row);

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
}

const STEP_ICONS = {
  depart: '🚩', arrive: '🏁', turn: '↪', merge: '↗', roundabout: '⟳',
  'roundabout turn': '⟳', fork: '⑂', 'end of road': '⤴', continue: '⬆',
  new_name: '⬆', notification: 'ℹ', default: '➜'
};

function stepIcon(maneuver) {
  return STEP_ICONS[maneuver.type] || STEP_ICONS.default;
}

function renderRouteSteps(route) {
  els.routeSteps.innerHTML = '';
  const steps = route.legs.flatMap(leg => leg.steps);
  steps.forEach((step, i) => {
    const li = document.createElement('li');
    const num = document.createElement('span');
    num.className = 'step-num';
    num.textContent = stepIcon(step.maneuver);
    const text = document.createElement('span');
    const name = step.name ? ` onto ${step.name}` : '';
    const verb = step.maneuver.type === 'depart' ? 'Head out'
      : step.maneuver.type === 'arrive' ? 'Arrive at destination'
      : `${step.maneuver.type.replace(/_/g, ' ')}${step.maneuver.modifier ? ' ' + step.maneuver.modifier : ''}`;
    text.textContent = `${verb}${name} — ${formatDistance(step.distance)}`;
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

let wakeState = null; // { watchId, repeatTimer, btnEl, statusEl, targetName, triggered }
let wakeAudioCtx = null;

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
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

function startWakeAlert(leg, btnEl, statusEl) {
  if (!navigator.geolocation) {
    showToast('Geolocation is not supported by your browser.');
    return;
  }
  stopWakeAlert(false); // only one active watch at a time

  const targetName = leg.to || 'your stop';
  wakeState = { watchId: null, repeatTimer: null, btnEl, statusEl, targetName, triggered: false };
  btnEl.textContent = '🔕 Cancel alert';
  btnEl.classList.add('active');
  statusEl.textContent = 'Locating you…';
  showToast(`We'll wake you up near ${targetName}.`);

  wakeState.watchId = navigator.geolocation.watchPosition(
    (pos) => {
      if (!wakeState) return;
      const dist = haversineMeters(pos.coords.latitude, pos.coords.longitude, leg.toLat, leg.toLon);
      wakeState.statusEl.textContent = `📍 ${formatDistance(dist)} to ${targetName}`;
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
  });
}

function formatArrivalMins(iso) {
  if (!iso) return null;
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  return mins <= 0 ? 'Arr' : `${mins} min`;
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

    panel.innerHTML = '';
    data.services.forEach((svc) => {
      const row = document.createElement('div');
      row.className = 'arrival-row';
      const num = document.createElement('span');
      num.className = 'arrival-service';
      num.textContent = svc.serviceNo;
      const times = document.createElement('span');
      times.className = 'arrival-times';
      const parts = svc.nextArrivals.map((a) => formatArrivalMins(a.estimatedArrival)).filter(Boolean);
      times.textContent = parts.length ? parts.join(', ') : 'No estimate';
      row.appendChild(num);
      row.appendChild(times);
      panel.appendChild(row);
    });
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
}

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
  els.locateBtn.textContent = '…';
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
        document.querySelector('.tab-btn[data-tab="search"]').click();
      } catch (err) {
        console.error(err);
        showToast('Could not determine your address.');
      } finally {
        els.locateBtn.textContent = '🎯';
      }
    },
    (err) => {
      console.error('locate-me geolocation error:', err);
      showToast(geoErrorMessage(err));
      els.locateBtn.textContent = '🎯';
    },
    GEO_OPTIONS
  );
});

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
  if (isStandalone() || installDismissedRecently()) return;
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
    const res = await fetch(`/api/weather-nearby?lat=${coords.lat}&lon=${coords.lon}`);
    const data = await res.json();
    if (!res.ok || !data.forecast) {
      els.weatherWidget.classList.add('hidden');
      return;
    }
    els.weatherWidget.textContent = `${data.icon || '🌤️'} ${data.forecast}`;
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

function renderWeatherPanel(daily) {
  const area = els.weatherWidget.dataset.area;
  const nowForecast = els.weatherWidget.dataset.forecast;
  const nowLine = area && nowForecast
    ? `<p class="weather-panel-now">📍 Right now near <strong>${area}</strong>: ${nowForecast}</p>`
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
