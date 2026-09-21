// Pet cafes: curated list (indoor / outdoor dining, which animals) that
// auto-hides cafes Google Maps reports as closed.
//
//   Public   GET  /api/pet-cafes-nearby?lat=&lon=&dine=indoor|outdoor|both
//   Admin    GET  /api/admin/pet-cafes[?pending=1]      (x-admin-secret header)
//            POST /api/admin/pet-cafes/discover         find candidates via Google Places
//            POST /api/admin/pet-cafes/verify           run the closed-cafe check now
//            POST /api/admin/pet-cafes/:id              confirm/edit a cafe
//
// Data lives on the Railway Volume (/data) next to push subscriptions.
// New candidates start reviewed:false and are NOT shown to the public until
// you confirm them. Set GOOGLE_MAPS_API_KEY (Places API (New)) to enable
// discovery and the weekly status check.

const fs = require('fs');
const path = require('path');

const CAFES_FILE = process.env.PETCAFES_FILE || '/data/pet-cafes.json';
const LOG_FILE = process.env.PETCAFES_LOG_FILE || '/data/pet-cafes-log.json';
const STATE_FILE = process.env.PETCAFES_STATE_FILE || '/data/pet-cafes-state.json';
const API_KEY = (process.env.GOOGLE_MAPS_API_KEY || '').trim();
const VERIFY_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

const DISCOVER_QUERIES = [
  'cat cafe Singapore', 'dog cafe Singapore', 'pet cafe Singapore',
  'pet friendly cafe Singapore', 'pet friendly restaurant outdoor seating Singapore',
  'rabbit cafe Singapore',
];

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`pet-cafes: could not read ${file}:`, err.message);
    return fallback;
  }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file); // atomic, so a crash mid-write can't corrupt the list
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---- Opening hours ---------------------------------------------------------
// Google's weekdayDescriptions look like "Monday: 10:00 AM – 12:00 PM, 1:00 – 7:30 PM",
// "Monday: Closed" or "Monday: Open 24 hours". Times are minutes since midnight;
// a range that runs past midnight ends after 1440.
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function parseClock(str, fallbackMeridiem) {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(str.trim());
  if (!m) return null;
  const mer = (m[3] || fallbackMeridiem || '').toUpperCase();
  return { minutes: (Number(m[1]) % 12) * 60 + Number(m[2]) + (mer === 'PM' ? 720 : 0), hasMer: Boolean(m[3]), mer };
}

// Returns an array of [start, end] ranges, or null when the text can't be understood.
function parseDayHours(line) {
  const text = String(line).replace(/[   ]/g, ' ').replace(/^[A-Za-z]+:\s*/, '').trim();
  if (/^closed$/i.test(text)) return [];
  if (/^open 24 hours$/i.test(text)) return [[0, 1440]];
  const ranges = [];
  for (const part of text.split(',')) {
    const [a, b] = part.split(/\s*[–—-]\s*/);
    if (!a || !b) return null;
    const end = parseClock(b);
    if (!end || !end.hasMer) return null;
    let start = parseClock(a, end.mer);
    if (!start) return null;
    if (!start.hasMer && start.minutes >= end.minutes) {
      // "10:00 – 2:00 PM": the start is in the other half of the day
      start = parseClock(a, end.mer === 'PM' ? 'AM' : 'PM');
    }
    let e = end.minutes;
    if (e <= start.minutes) e += 1440;
    ranges.push([start.minutes, e]);
  }
  return ranges;
}

// true / false, or null when the cafe has no usable hours.
function isOpenNow(hours, date = new Date()) {
  if (!Array.isArray(hours) || hours.length < 7) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Singapore', weekday: 'long', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  const dayIdx = DAY_NAMES.indexOf(get('weekday'));
  const nowMin = Number(get('hour')) * 60 + Number(get('minute'));
  const lineFor = (i) => hours.find((h) => String(h).startsWith(DAY_NAMES[(i + 7) % 7]));
  const today = lineFor(dayIdx) && parseDayHours(lineFor(dayIdx));
  const yesterday = lineFor(dayIdx - 1) && parseDayHours(lineFor(dayIdx - 1));
  if (!today) return null;
  if (today.some(([s, e]) => nowMin >= s && nowMin < e)) return true;
  // last night's opening that ran past midnight
  if (yesterday && yesterday.some(([, e]) => e > 1440 && nowMin < e - 1440)) return true;
  return false;
}

// ---- Google Places (New) ---------------------------------------------------
async function searchText(query) {
  const fields = ['places.id', 'places.displayName', 'places.formattedAddress', 'places.location',
    'places.businessStatus', 'places.outdoorSeating', 'places.googleMapsUri', 'places.websiteUri', 'places.nationalPhoneNumber', 'nextPageToken'].join(',');
  const out = [];
  let pageToken;
  do {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': API_KEY, 'X-Goog-FieldMask': fields },
      body: JSON.stringify({ textQuery: query, regionCode: 'SG', pageSize: 20, ...(pageToken ? { pageToken } : {}) }),
    });
    if (!res.ok) throw new Error(`Places search ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    out.push(...(json.places || []));
    pageToken = json.nextPageToken;
    if (pageToken) await sleep(500);
  } while (pageToken);
  return out;
}

async function placeStatus(placeId) {
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { 'X-Goog-Api-Key': API_KEY, 'X-Goog-FieldMask': 'id,businessStatus' },
  });
  if (res.status === 404) return 'NOT_FOUND';
  if (!res.ok) throw new Error(`Places details ${res.status}`);
  return (await res.json()).businessStatus || 'UNKNOWN';
}

// Fetches phone numbers and weekly opening hours for confirmed, visible cafes (one lookup each). Run it
// on demand — it uses a pricier Google field than the weekly status check, so
// it is deliberately not part of that job. Google only lets Places data be
// cached for a limited time, so re-run it from time to time.
async function fillPhones() {
  if (!API_KEY) throw new Error('GOOGLE_MAPS_API_KEY is not set');
  const cafes = readJson(CAFES_FILE, []);
  let filled = 0, errors = 0;
  for (const cafe of cafes.filter((c) => (c.reviewed || c.listUnverified) && !c.hidden)) {
    try {
      const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(cafe.placeId)}`, {
        headers: { 'X-Goog-Api-Key': API_KEY, 'X-Goog-FieldMask': 'id,nationalPhoneNumber,regularOpeningHours.weekdayDescriptions' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const phone = data.nationalPhoneNumber || '';
      if (phone) filled++;
      cafe.phone = phone;
      // Hours you typed in by hand are never overwritten.
      if (!cafe.hoursManual) cafe.hours = data.regularOpeningHours?.weekdayDescriptions || [];
      cafe.phoneCheckedAt = new Date().toISOString();
    } catch (err) {
      console.warn(`pet-cafes: phone for ${cafe.name}: ${err.message}`); errors++;
    }
    await sleep(100);
  }
  writeJson(CAFES_FILE, cafes);
  console.log(`pet-cafes: phones filled for ${filled}, ${errors} error(s)`);
  return { filled, errors };
}

let busy = false; // one discover/verify at a time

async function discover() {
  if (!API_KEY) throw new Error('GOOGLE_MAPS_API_KEY is not set');
  const cafes = readJson(CAFES_FILE, []);
  const known = new Set(cafes.map((c) => c.placeId));
  let added = 0;
  for (const q of DISCOVER_QUERIES) {
    for (const p of await searchText(q)) {
      if (known.has(p.id)) continue;
      known.add(p.id);
      cafes.push({
        placeId: p.id, name: p.displayName?.text || 'Unknown', address: p.formattedAddress || '',
        lat: p.location?.latitude, lon: p.location?.longitude,
        mapsUrl: p.googleMapsUri || '', website: p.websiteUri || '', phone: p.nationalPhoneNumber || '',
        businessStatus: p.businessStatus || 'UNKNOWN',
        googleOutdoorSeating: p.outdoorSeating ?? null, // hint only
        hasIndoor: null, hasOutdoor: null, animals: [], notes: '',
        reviewed: false, hidden: false, hiddenReason: null, lastChecked: null, notFoundCount: 0,
      });
      added++;
    }
  }
  writeJson(CAFES_FILE, cafes);
  console.log(`pet-cafes: discover added ${added} candidate(s), total ${cafes.length}`);
  return { added, total: cafes.length };
}

// Hides closed cafes, un-hides ones that reopened (only if THIS job hid them).
// An API/network error never hides anything.
async function verify() {
  if (!API_KEY) throw new Error('GOOGLE_MAPS_API_KEY is not set');
  const cafes = readJson(CAFES_FILE, []);
  const log = readJson(LOG_FILE, []);
  const now = new Date().toISOString();
  let changes = 0, errors = 0;
  for (const cafe of cafes) {
    let status;
    try { status = await placeStatus(cafe.placeId); } catch (err) {
      console.warn(`pet-cafes: ${cafe.name}: ${err.message}`); errors++; continue;
    }
    const before = { hidden: cafe.hidden, businessStatus: cafe.businessStatus };
    cafe.lastChecked = now;
    if (status === 'NOT_FOUND') {
      cafe.notFoundCount = (cafe.notFoundCount || 0) + 1;
      if (cafe.notFoundCount >= 2 && !cafe.hidden) { cafe.hidden = true; cafe.hiddenReason = 'auto:not_found'; }
    } else {
      cafe.notFoundCount = 0;
      cafe.businessStatus = status;
      if (status === 'CLOSED_PERMANENTLY' || status === 'CLOSED_TEMPORARILY') {
        if (!cafe.hidden) { cafe.hidden = true; cafe.hiddenReason = `auto:${status.toLowerCase()}`; }
      } else if (status === 'OPERATIONAL' && cafe.hidden && String(cafe.hiddenReason || '').startsWith('auto:')) {
        cafe.hidden = false; cafe.hiddenReason = null;
      }
    }
    if (before.hidden !== cafe.hidden || before.businessStatus !== cafe.businessStatus) {
      changes++;
      log.push({ at: now, placeId: cafe.placeId, name: cafe.name, status, hidden: cafe.hidden, reason: cafe.hiddenReason });
      console.log(`pet-cafes: ${cafe.name}: ${status} -> ${cafe.hidden ? 'HIDDEN' : 'visible'}`);
    }
    await sleep(100);
  }
  writeJson(CAFES_FILE, cafes);
  writeJson(LOG_FILE, log);
  // Only record a run if at least something got checked, so a bad API key
  // is retried on the next tick instead of waiting another week.
  if (errors < cafes.length || cafes.length === 0) writeJson(STATE_FILE, { lastVerifiedAt: now });
  console.log(`pet-cafes: verified ${cafes.length}, ${changes} change(s), ${errors} error(s)`);
  return { checked: cafes.length, changes, errors };
}

async function exclusive(fn) {
  if (busy) { const e = new Error('Another pet-cafes job is already running.'); e.status = 409; throw e; }
  busy = true;
  try { return await fn(); } finally { busy = false; }
}

function register(app, { requireAdmin }) {
  // ---- public ----
  app.get('/api/pet-cafes-nearby', (req, res) => {
    const lat = parseFloat(req.query.lat), lon = parseFloat(req.query.lon);
    if (Number.isNaN(lat) || Number.isNaN(lon)) return res.status(400).json({ error: 'lat and lon are required' });
    const dine = req.query.dine;
    const onlyOpen = req.query.open === '1';
    const cafes = readJson(CAFES_FILE, [])
      .filter((c) => (c.reviewed || c.listUnverified) && !c.hidden && typeof c.lat === 'number' && typeof c.lon === 'number')
      .filter((c) => dine === 'indoor' ? c.hasIndoor === true
        : dine === 'outdoor' ? c.hasOutdoor === true
        : dine === 'both' ? (c.hasIndoor === true && c.hasOutdoor === true) : true)
      .map((c) => ({ ...c, openNow: isOpenNow(c.hours) }))
      .filter((c) => !onlyOpen || c.openNow === true)
      .map((c) => ({
        label: c.name, openNow: c.openNow, verified: c.reviewed === true, address: c.address, lat: c.lat, lon: c.lon,
        hasIndoor: c.hasIndoor === true, hasOutdoor: c.hasOutdoor === true,
        animals: c.animals || [], notes: c.notes || '', mapsUrl: c.mapsUrl || '', phone: c.phone || '', hours: c.hours || [],
        distanceMeters: Math.round(haversineMeters(lat, lon, c.lat, c.lon)),
      }))
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, 100);
    res.json({ cafes });
  });

  // ---- admin ----
  app.get('/api/admin/pet-cafes', requireAdmin, (req, res) => {
    let cafes = readJson(CAFES_FILE, []);
    if (req.query.pending) cafes = cafes.filter((c) => !c.reviewed);
    res.json({ count: cafes.length, cafes, state: readJson(STATE_FILE, {}) });
  });

  app.post('/api/admin/pet-cafes/discover', requireAdmin, async (req, res) => {
    try { res.json(await exclusive(discover)); } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
  });
  app.post(['/api/admin/pet-cafes/phones', '/api/admin/pet-cafes/details'], requireAdmin, async (req, res) => {
    try { res.json(await exclusive(fillPhones)); } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
  });
  app.post('/api/admin/pet-cafes/verify', requireAdmin, async (req, res) => {
    try { res.json(await exclusive(verify)); } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
  });

  app.post('/api/admin/pet-cafes/:id', requireAdmin, (req, res) => {
    const cafes = readJson(CAFES_FILE, []);
    const cafe = cafes.find((c) => c.placeId === req.params.id);
    if (!cafe) return res.status(404).json({ error: 'Unknown cafe id' });
    const b = req.body || {};
    const bool = (v) => (v === true || v === false ? v : undefined);
    for (const k of ['reviewed', 'listUnverified', 'hasIndoor', 'hasOutdoor']) if (bool(b[k]) !== undefined) cafe[k] = b[k];
    if (bool(b.hidden) !== undefined) { cafe.hidden = b.hidden; cafe.hiddenReason = b.hidden ? 'manual' : null; }
    if (Array.isArray(b.animals)) cafe.animals = b.animals.map(String).slice(0, 6);
    if (typeof b.notes === 'string') cafe.notes = b.notes.slice(0, 300);
    if (typeof b.phone === 'string') cafe.phone = b.phone.slice(0, 40);
    // hours: 7 lines, Monday first, e.g. ["Monday: 11:00 AM – 8:00 PM", ...]. [] clears manual hours.
    if (Array.isArray(b.hours)) {
      cafe.hours = b.hours.map((h) => String(h).slice(0, 60)).slice(0, 7);
      cafe.hoursManual = cafe.hours.length > 0;
    }
    writeJson(CAFES_FILE, cafes);
    res.json({ cafe });
  });

  // ---- weekly closed-cafe check, in-process (the volume can only attach to
  // this one service, so a separate cron service couldn't see the data) ----
  if (API_KEY) {
    const tick = async () => {
      const last = Date.parse(readJson(STATE_FILE, {}).lastVerifiedAt || '') || 0;
      if (Date.now() - last < VERIFY_EVERY_MS) return;
      try { await exclusive(verify); } catch (err) { console.error('pet-cafes weekly verify failed:', err.message); }
    };
    setInterval(tick, 6 * 60 * 60 * 1000);
    setTimeout(tick, 60 * 1000); // shortly after boot, if a week has passed
  } else {
    console.log('pet-cafes: GOOGLE_MAPS_API_KEY not set — discovery and weekly status check disabled.');
  }
}

module.exports = { register, isOpenNow, parseDayHours };
