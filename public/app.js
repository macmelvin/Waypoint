// Waypoint — a clean, ad-free maps & directions app.
// Map tiles: OpenStreetMap. Geocoding: Nominatim. Routing: OSRM public demo server.

const SINGAPORE_CENTER = [1.3521, 103.8198];
// Singapore's bounding box (with a little padding), used to keep the map
// and all search results confined to Singapore.
const SG_BOUNDS = L.latLngBounds([1.130, 103.550], [1.485, 104.130]);
const SG_VIEWBOX = '103.550,1.485,104.130,1.130'; // left,top,right,bottom for Nominatim

const map = L.map('map', {
  zoomControl: true,
  maxBounds: SG_BOUNDS.pad(0.15),
  minZoom: 11
}).setView(SINGAPORE_CENTER, 12);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

let searchMarker = null;
let fromMarker = null;
let toMarker = null;
let routeLayer = null;
let fromCoords = null; // { lat, lon, label }
let toCoords = null;
let selectedMode = 'driving';

const els = {
  searchInput: document.getElementById('searchInput'),
  searchClear: document.getElementById('searchClear'),
  searchResults: document.getElementById('searchResults'),
  placeCard: document.getElementById('placeCard'),
  placeName: document.getElementById('placeName'),
  placeAddress: document.getElementById('placeAddress'),
  dirFromHere: document.getElementById('dirFromHere'),
  dirToHere: document.getElementById('dirToHere'),
  fromInput: document.getElementById('fromInput'),
  toInput: document.getElementById('toInput'),
  fromResults: document.getElementById('fromResults'),
  toResults: document.getElementById('toResults'),
  swapBtn: document.getElementById('swapBtn'),
  getDirectionsBtn: document.getElementById('getDirectionsBtn'),
  routeSummary: document.getElementById('routeSummary'),
  routeSteps: document.getElementById('routeSteps'),
  itineraryOptions: document.getElementById('itineraryOptions'),
  locateBtn: document.getElementById('locateBtn'),
  toast: document.getElementById('toast'),
  tabs: document.querySelectorAll('.tab-btn'),
  panels: document.querySelectorAll('.panel'),
  modeButtons: document.querySelectorAll('.mode-btn'),
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

async function geocode(query) {
  if (!query || query.trim().length < 2) return [];
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6`
    + `&countrycodes=sg&viewbox=${SG_VIEWBOX}&bounded=1`
    + `&q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    if (!res.ok) throw new Error('geocode failed');
    return await res.json();
  } catch (err) {
    console.error(err);
    return [];
  }
}

function shortLabel(result) {
  return result.display_name.split(',').slice(0, 2).join(',').trim();
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
    sub.textContent = r.display_name;
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

  const lat = parseFloat(r.lat), lon = parseFloat(r.lon);
  if (searchMarker) map.removeLayer(searchMarker);
  searchMarker = L.marker([lat, lon]).addTo(map)
    .bindPopup(`<strong>${shortLabel(r)}</strong><br>${r.display_name}`)
    .openPopup();
  map.setView([lat, lon], 16);

  els.placeName.textContent = shortLabel(r);
  els.placeAddress.textContent = r.display_name;
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

// ---------- Directions panel ----------

function setFrom(coords) {
  fromCoords = coords;
  els.fromInput.value = coords.label;
  if (fromMarker) map.removeLayer(fromMarker);
  fromMarker = L.marker([coords.lat, coords.lon], {
    icon: L.divIcon({ className: '', html: '🟢', iconSize: [20, 20] })
  }).addTo(map);
  maybeEnableDirections();
}

function setTo(coords) {
  toCoords = coords;
  els.toInput.value = coords.label;
  if (toMarker) map.removeLayer(toMarker);
  toMarker = L.marker([coords.lat, coords.lon], {
    icon: L.divIcon({ className: '', html: '🔴', iconSize: [20, 20] })
  }).addTo(map);
  maybeEnableDirections();
}

function maybeEnableDirections() {
  els.getDirectionsBtn.disabled = !(fromCoords && toCoords);
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
    if (fromCoords && toCoords && routeLayer) {
      getDirections();
    }
  });
});

els.getDirectionsBtn.addEventListener('click', getDirections);

async function getDirections() {
  if (!fromCoords || !toCoords) return;
  if (selectedMode === 'transit') return getTransitDirections();

  els.itineraryOptions.classList.add('hidden');
  els.itineraryOptions.innerHTML = '';
  transitItineraries = [];

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
    drawRoute(route);
    renderRouteSummary(route);
    renderRouteSteps(route);
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
const MODE_COLOR = { walk: '#6b7280', bus: '#059669', train: '#dc2626', ferry: '#0891b2' };

let transitItineraries = []; // all itinerary options returned for the current transit search
let selectedItineraryIndex = 0;

// Decodes a Google-encoded polyline (precision 5) into an array of [lat, lng].
function decodePolyline(encoded) {
  let points = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = (result & 1) ? ~(result >> 1) : (result >> 1);
    lng += dlng;

    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

async function getTransitDirections() {
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
  } catch (err) {
    console.error(err);
    showToast('Transit routing service unavailable. Please try again.');
  } finally {
    els.getDirectionsBtn.disabled = false;
    els.getDirectionsBtn.textContent = 'Get Directions';
  }
}

// Renders the list of alternative itineraries as selectable cards, e.g.
// "🚶 → 🚇 → 🚶   32 min   5:38p–6:10p". Clicking a card switches the map
// route, summary, and step list to that option.
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

  drawTransitRoute(itinerary);
  renderTransitSummary(itinerary);
  renderTransitSteps(itinerary);
}

function drawTransitRoute(itinerary) {
  if (routeLayer) map.removeLayer(routeLayer);
  const group = L.layerGroup();

  itinerary.legs.forEach((leg) => {
    if (!leg.geometry) return;
    const points = decodePolyline(leg.geometry);
    const color = leg.routeColor ? `#${leg.routeColor}` : (MODE_COLOR[leg.mode] || '#2563eb');
    L.polyline(points, {
      color,
      weight: leg.mode === 'walk' ? 4 : 5,
      opacity: leg.mode === 'walk' ? 0.7 : 0.9,
      dashArray: leg.mode === 'walk' ? '1, 8' : null,
    }).addTo(group);
  });

  routeLayer = group.addTo(map);
  const allPoints = itinerary.legs.flatMap((leg) => leg.geometry ? decodePolyline(leg.geometry) : []);
  if (allPoints.length) {
    map.fitBounds(L.latLngBounds(allPoints), { padding: [40, 40] });
  }
}

function formatClockTime(ms) {
  return new Date(ms).toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function renderTransitSummary(itinerary) {
  els.routeSummary.classList.remove('hidden');
  const transfers = itinerary.legs.filter((l) => l.mode !== 'walk').length;
  const transferText = transfers > 1 ? `${transfers - 1} transfer${transfers > 2 ? 's' : ''}` : 'Direct';
  els.routeSummary.innerHTML = `<strong>${formatDuration(itinerary.duration)}</strong> &nbsp;·&nbsp; `
    + `${formatClockTime(itinerary.startTime)} – ${formatClockTime(itinerary.endTime)} &nbsp;·&nbsp; ${transferText}`;
}

function renderTransitSteps(itinerary) {
  els.routeSteps.innerHTML = '';
  itinerary.legs.forEach((leg) => {
    const li = document.createElement('li');
    const icon = document.createElement('span');
    icon.className = 'step-num';
    icon.textContent = MODE_ICON[leg.mode] || '➜';

    const text = document.createElement('span');
    if (leg.mode === 'walk') {
      text.textContent = `Walk to ${leg.to} — ${formatDistance(leg.distance)}, ${formatDuration(leg.duration)}`;
    } else {
      const line = leg.routeName ? `${leg.mode === 'train' ? 'Line' : 'Bus'} ${leg.routeName}` : leg.mode;
      const headsign = leg.headsign ? ` towards ${leg.headsign}` : '';
      text.innerHTML = `<strong>${line}</strong>${headsign}<br>`
        + `${leg.from} → ${leg.to} — ${formatDuration(leg.duration)} (${formatClockTime(leg.startTime)})`;
    }
    li.appendChild(icon);
    li.appendChild(text);
    els.routeSteps.appendChild(li);
  });
}

function drawRoute(route) {
  if (routeLayer) map.removeLayer(routeLayer);
  routeLayer = L.geoJSON(route.geometry, {
    style: { color: '#2563eb', weight: 5, opacity: 0.85 }
  }).addTo(map);
  map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });
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

// ---------- Geolocation ----------

els.locateBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    showToast('Geolocation is not supported by your browser.');
    return;
  }
  els.locateBtn.textContent = '…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      map.setView([latitude, longitude], 16);
      L.circleMarker([latitude, longitude], {
        radius: 8, color: '#2563eb', fillColor: '#60a5fa', fillOpacity: 0.9, weight: 2
      }).addTo(map).bindPopup('You are here').openPopup();
      els.locateBtn.textContent = '🎯';
    },
    () => {
      showToast('Could not get your location.');
      els.locateBtn.textContent = '🎯';
    }
  );
});

// ---------- Map click: reverse geocode ----------

map.on('click', async (e) => {
  const { lat, lng } = e.latlng;
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data && data.display_name) {
      currentPlace = { lat, lon: lng, display_name: data.display_name };
      if (searchMarker) map.removeLayer(searchMarker);
      searchMarker = L.marker([lat, lng]).addTo(map)
        .bindPopup(`<strong>${shortLabel({ display_name: data.display_name })}</strong><br>${data.display_name}`)
        .openPopup();
      els.placeName.textContent = shortLabel({ display_name: data.display_name });
      els.placeAddress.textContent = data.display_name;
      els.placeCard.classList.remove('hidden');
      document.querySelector('.tab-btn[data-tab="search"]').click();
    }
  } catch (err) {
    console.error(err);
  }
});
