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
