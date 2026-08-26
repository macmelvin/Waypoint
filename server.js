const express = require('express');
const path = require('path');
const fs = require('fs');
const webpush = require('web-push');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Push notifications (Web Push) ------------------------------------------
// Self-generated VAPID keypair identifying this server to push services (not a
// third-party account credential — just asymmetric keys this app owns). Set
// VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY on this service in Railway's Variables
// UI. Until both are set (or if either is malformed — e.g. stray whitespace
// from a copy-paste), push features quietly no-op instead of erroring, and
// crucially this must NEVER be able to crash the whole server over a
// notifications feature — hence the try/catch around setVapidDetails.
const VAPID_PUBLIC_KEY = (process.env.VAPID_PUBLIC_KEY || '').trim();
const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || '').trim();
let PUSH_ENABLED = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (PUSH_ENABLED) {
  try {
    webpush.setVapidDetails('https://waypoint-production-0307.up.railway.app', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  } catch (err) {
    console.error('Invalid VAPID keys — push notifications disabled:', err.message);
    PUSH_ENABLED = false;
  }
}

// Subscription store, kept in memory for fast access but persisted to a JSON
// file on a Railway Volume mounted at /data — so subscriptions survive
// redeploys/restarts instead of silently vanishing every time this service
// ships an update (which, during active development, is often).
const SUBSCRIPTIONS_FILE = process.env.PUSH_SUBSCRIPTIONS_FILE || '/data/push-subscriptions.json';

function loadPushSubscriptions() {
  try {
    const raw = fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf8');
    const arr = JSON.parse(raw);
    return new Map(arr.map((sub) => [sub.endpoint, sub]));
  } catch (err) {
    // First run (file doesn't exist yet) or a corrupt file — start fresh
    // rather than crash the whole server over a notifications feature.
    return new Map();
  }
}

function savePushSubscriptions() {
  try {
    fs.mkdirSync(path.dirname(SUBSCRIPTIONS_FILE), { recursive: true });
    fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify([...pushSubscriptions.values()]));
  } catch (err) {
    console.error('failed to persist push subscriptions:', err.message);
  }
}

const pushSubscriptions = loadPushSubscriptions();

async function broadcastPush(payload) {
  if (!PUSH_ENABLED || !pushSubscriptions.size) return;
  const body = JSON.stringify(payload);
  let changed = false;
  for (const [endpoint, sub] of pushSubscriptions) {
    try {
      await webpush.sendNotification(sub, body);
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        pushSubscriptions.delete(endpoint); // subscription expired or was revoked by the browser/OS
        changed = true;
      } else {
        console.error('push send failed:', err.statusCode, err.message);
      }
    }
  }
  if (changed) savePushSubscriptions();
}

// Internal Railway private-network address of the transit-router (OpenTripPlanner) service.
const TRANSIT_API_URL = process.env.TRANSIT_API_URL || 'http://transit-router.railway.internal:8080';

app.use(express.json());

// ---- Invite-only access gate -------------------------------------------------
// Two independent switches, both off by default so nothing changes until you
// opt in:
//   ADMIN_SECRET        — set this to turn on the /admin panel, where you add
//                          or revoke people. The site itself stays fully open
//                          until the second switch is flipped, so you can set
//                          up and test invites without locking yourself out.
//   INVITE_GATE_ENABLED — set this to "true" once you've confirmed your own
//                          invite link works. From then on, anyone without a
//                          valid, active invite is shown a "request access"
//                          page instead of the app (and API calls are
//                          rejected), until they visit a link you gave them.
//
// Invite "tokens" are long random strings — knowing one IS the credential
// (like a bearer link), so there's no separate password to manage. A token
// only works while its invite is marked active in the store below; revoking
// someone takes effect on their very next request, since every request is
// checked against the live list rather than trusting a signed cookie alone.
const crypto = require('crypto');
const ADMIN_SECRET = (process.env.ADMIN_SECRET || '').trim();
const INVITE_GATE_ENABLED = /^(1|true)$/i.test((process.env.INVITE_GATE_ENABLED || '').trim());
const ADMIN_ENABLED = Boolean(ADMIN_SECRET);
const INVITES_FILE = process.env.INVITES_FILE || '/data/invites.json';
const INVITE_COOKIE = 'wp_invite';
// Shown as a "request access" button on the invite-only page. Optional —
// leave WHATSAPP_NUMBER unset to hide the button entirely.
const WHATSAPP_NUMBER = (process.env.GATE_WHATSAPP_NUMBER || '6588877041').replace(/[^0-9]/g, '');
const WHATSAPP_MESSAGE = "Hi, I'd like access to Waypoint";

function loadInvites() {
  try {
    return JSON.parse(fs.readFileSync(INVITES_FILE, 'utf8'));
  } catch (err) {
    return [];
  }
}

function saveInvites() {
  try {
    fs.mkdirSync(path.dirname(INVITES_FILE), { recursive: true });
    fs.writeFileSync(INVITES_FILE, JSON.stringify(invites, null, 2));
  } catch (err) {
    console.error('failed to persist invites:', err.message);
  }
}

let invites = loadInvites();

function findInviteByToken(token) {
  return invites.find((inv) => inv.token === token);
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireAdmin(req, res, next) {
  if (!ADMIN_ENABLED) return res.status(404).json({ error: 'Admin panel not configured' });
  const provided = req.get('x-admin-secret') || '';
  if (!provided || !timingSafeEqual(provided, ADMIN_SECRET)) {
    return res.status(401).json({ error: 'Invalid admin secret' });
  }
  next();
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

const GATE_EXEMPT_PREFIXES = ['/admin', '/api/admin', '/privacy.html', '/.well-known'];

function inviteGate(req, res, next) {
  if (GATE_EXEMPT_PREFIXES.some((p) => req.path === p || req.path.startsWith(p + '/') || req.path.startsWith(p))) {
    return next();
  }

  // A link with ?invite=<token> claims access: if valid, remember it in a
  // cookie and continue (stripping the token from the visible URL on normal
  // page loads so it doesn't linger in browser history / get shared by
  // accident when someone copies the address bar).
  const queryToken = typeof req.query.invite === 'string' ? req.query.invite : null;
  if (queryToken) {
    const inv = findInviteByToken(queryToken);
    if (inv && inv.active) {
      inv.lastSeenAt = new Date().toISOString();
      saveInvites();
      res.cookie(INVITE_COOKIE, queryToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 365 * 24 * 60 * 60 * 1000,
      });
      if (req.method === 'GET' && req.accepts('html')) {
        const cleanUrl = req.path + (Object.keys(req.query).length > 1
          ? '?' + Object.entries(req.query).filter(([k]) => k !== 'invite').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
          : '');
        return res.redirect(cleanUrl || '/');
      }
      return next();
    }
  }

  if (!INVITE_GATE_ENABLED) return next();

  const cookieToken = parseCookies(req)[INVITE_COOKIE];
  const inv = cookieToken ? findInviteByToken(cookieToken) : null;
  if (inv && inv.active) {
    inv.lastSeenAt = new Date().toISOString();
    return next();
  }

  if (req.path.startsWith('/api/')) {
    return res.status(403).json({ error: 'This app is invite-only. Ask for an access link.' });
  }
  if (req.accepts('html')) {
    const whatsappButton = WHATSAPP_NUMBER ? `
<a class="wa-btn" href="https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}" target="_blank" rel="noopener">
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.149-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12.004 2.003c-5.514 0-9.997 4.483-9.997 9.997 0 1.762.462 3.484 1.34 5.003l-1.416 5.17 5.29-1.387a9.96 9.96 0 0 0 4.783 1.218h.004c5.514 0 9.997-4.483 9.997-9.997 0-2.67-1.04-5.18-2.929-7.07a9.935 9.935 0 0 0-7.072-2.934zm0 18.174h-.003a8.19 8.19 0 0 1-4.174-1.143l-.3-.178-3.14.823.838-3.06-.195-.314a8.166 8.166 0 0 1-1.257-4.375c0-4.518 3.677-8.194 8.198-8.194 2.19 0 4.248.854 5.796 2.404a8.14 8.14 0 0 1 2.399 5.796c0 4.518-3.677 8.194-8.198 8.194z"/></svg>
  Request access on WhatsApp
</a>` : '';
    res.status(403).set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Waypoint — invite only</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;
align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}
.card{max-width:360px}h1{font-size:20px;margin:0 0 8px}p{color:#94a3b8;font-size:15px;line-height:1.5}
.wa-btn{display:inline-flex;align-items:center;gap:8px;margin-top:18px;padding:11px 20px;border-radius:999px;
background:#25D366;color:#04240f;font-weight:600;font-size:14px;text-decoration:none}
.wa-btn:hover{filter:brightness(1.05)}</style>
</head><body><div class="card"><h1>Waypoint is invite-only</h1>
<p>You'll need an access link to use this. If someone shared one with you, open it directly in this browser.</p>
${whatsappButton}
</div></body></html>`);
    return;
  }
  return res.status(403).end();
}

app.use(inviteGate);

app.get('/api/admin/invites', requireAdmin, (req, res) => {
  res.json({ invites });
});

app.post('/api/admin/invites', requireAdmin, (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  const invite = {
    id: crypto.randomUUID(),
    name,
    token: crypto.randomBytes(12).toString('base64url'),
    active: true,
    createdAt: new Date().toISOString(),
    lastSeenAt: null,
  };
  invites.push(invite);
  saveInvites();
  res.json({ invite });
});

app.post('/api/admin/invites/:id/toggle', requireAdmin, (req, res) => {
  const inv = invites.find((i) => i.id === req.params.id);
  if (!inv) return res.status(404).json({ error: 'not found' });
  inv.active = !inv.active;
  saveInvites();
  res.json({ invite: inv });
});

app.delete('/api/admin/invites/:id', requireAdmin, (req, res) => {
  const before = invites.length;
  invites = invites.filter((i) => i.id !== req.params.id);
  if (invites.length !== before) saveInvites();
  res.json({ ok: true });
});

// Express's static middleware ignores dotfiles (like .well-known) by
// default, which would 404 the Android app's Digital Asset Links file —
// serve that one path explicitly before the catch-all static handler.
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', '.well-known', 'assetlinks.json'));
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// ---- Transit planning proxy -------------------------------------------------
// The frontend calls this same-origin endpoint instead of talking to the
// OpenTripPlanner service directly, which avoids CORS and keeps the internal
// service address out of client-side code.

function otpModeToLabel(mode) {
  const map = {
    WALK: 'walk',
    BUS: 'bus',
    RAIL: 'train',
    SUBWAY: 'train',
    TRAM: 'train',
    FERRY: 'ferry',
  };
  return map[mode] || mode.toLowerCase();
}

// This GTFS feed leaves the official stop_code column empty for bus stops —
// the public 5-digit LTA bus stop number instead lives in the GTFS stop_id
// itself (OTP exposes it as gtfsId, formatted "<feedId>:<stopId>"). Prefer
// stop.code when present (authoritative), otherwise fall back to the numeric
// id portion — but only when it's purely digits, so our own synthetic
// interchange stops (ids like "SGX_ORCHARD", which don't have a real bus
// stop number) correctly show nothing instead of a made-up code.
function stopCode(stop) {
  if (!stop) return null;
  if (stop.code) return stop.code;
  if (stop.gtfsId) {
    const idPart = stop.gtfsId.includes(':') ? stop.gtfsId.split(':').slice(1).join(':') : stop.gtfsId;
    if (/^\d+$/.test(idPart)) return idPart;
  }
  return null;
}

// ---- Geocoding (OneMap, Singapore's official government address search) ---
// Replaces the old client-side Nominatim/OpenStreetMap search. OneMap (run by
// the Singapore Land Authority) returns exact station/building names and
// postal codes reliably — Nominatim would sometimes surface under-construction
// future-line POIs (e.g. "Cross Island Line, Punggol Central") ahead of the
// actual operating "Punggol MRT Station" for a plain "Punggol MRT" search.
// No API key needed for this basic search endpoint.
//
// OneMap is address/building-oriented though — it has no real business/POI
// database, so searching a specific café or restaurant by name resolves to
// whatever official address record matches, which is often just the host
// building's boundary point rather than the actual shopfront. OSM's Nominatim
// separately indexes named POIs (amenity/shop/tourism tags contributors have
// placed at the real storefront), so we query both and put genuine POI hits
// first — while still demoting transit/administrative/boundary-type Nominatim
// results behind OneMap, which is what avoided the under-construction-station
// problem above.

async function fetchOneMapResults(q) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const url = `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${encodeURIComponent(q)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
    const omRes = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WaypointSG/1.0; +https://waypoint-production-0307.up.railway.app/)',
        Accept: 'application/json',
      },
    });
    if (!omRes.ok) throw new Error(`OneMap responded ${omRes.status}`);
    const data = await omRes.json();
    return (data.results || [])
      .slice(0, 6)
      .map((r) => ({
        label: r.SEARCHVAL || r.BUILDING || r.ADDRESS || '',
        address: r.ADDRESS || '',
        lat: parseFloat(r.LATITUDE),
        lon: parseFloat(r.LONGITUDE),
      }))
      .filter((r) => r.label && !Number.isNaN(r.lat) && !Number.isNaN(r.lon));
  } finally {
    clearTimeout(timeout);
  }
}

// Nominatim "class" values that mean the hit is an administrative/geographic
// entity rather than a real, visitable business/POI — these get demoted
// behind OneMap's results (this is what keeps future-line "Cross Island
// Line, Punggol Central"-style entries from outranking the real station).
const NOMINATIM_NON_POI_CLASSES = new Set(['place', 'boundary', 'highway', 'railway', 'natural', 'landuse', 'waterway', 'administrative']);

async function fetchNominatimResults(q) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&countrycodes=sg&limit=6`;
    const nomRes = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WaypointSG/1.0; +https://waypoint-production-0307.up.railway.app/)',
        Accept: 'application/json',
      },
    });
    if (!nomRes.ok) throw new Error(`Nominatim responded ${nomRes.status}`);
    const data = await nomRes.json();
    return data
      .map((r) => {
        const parts = (r.display_name || '').split(',').map((p) => p.trim());
        return {
          label: parts[0] || r.display_name || '',
          address: parts.slice(1, 3).join(', '),
          lat: parseFloat(r.lat),
          lon: parseFloat(r.lon),
          isPoi: !NOMINATIM_NON_POI_CLASSES.has(r.class),
        };
      })
      .filter((r) => r.label && !Number.isNaN(r.lat) && !Number.isNaN(r.lon));
  } finally {
    clearTimeout(timeout);
  }
}

app.get('/api/geocode', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ results: [] });

  const [oneMapOutcome, nominatimOutcome] = await Promise.allSettled([
    fetchOneMapResults(q),
    fetchNominatimResults(q),
  ]);
  const oneMapResults = oneMapOutcome.status === 'fulfilled' ? oneMapOutcome.value : [];
  const nominatimResults = nominatimOutcome.status === 'fulfilled' ? nominatimOutcome.value : [];
  if (oneMapOutcome.status === 'rejected') console.error('OneMap geocode error:', oneMapOutcome.reason?.message);
  if (nominatimOutcome.status === 'rejected') console.error('Nominatim geocode error:', nominatimOutcome.reason?.message);

  if (!oneMapResults.length && !nominatimResults.length) {
    return res.status(502).json({ error: 'Could not search that location.' });
  }

  // Named-POI hits from Nominatim first (that's what a business-name search
  // is actually looking for), then OneMap's address/building results, then
  // any leftover non-POI Nominatim results as a last resort.
  const poiHits = nominatimResults.filter((r) => r.isPoi);
  const otherHits = nominatimResults.filter((r) => !r.isPoi);
  const combined = [...poiHits, ...oneMapResults, ...otherHits];

  // Dedupe near-identical pins that both sources returned for the same spot.
  const kept = [];
  const deduped = combined.filter((r) => {
    const isDup = kept.some((k) => k.label.toLowerCase() === r.label.toLowerCase() && haversineMeters(k.lat, k.lon, r.lat, r.lon) < 25);
    if (isDup) return false;
    kept.push(r);
    return true;
  });

  res.json({ results: deduped.slice(0, 8).map(({ isPoi, ...r }) => r) });
});

// ---- Nearby places by category (Waze-style "Categories" quick search) ------
// Sourced live from OpenStreetMap's Overpass API, scoped to a radius around
// wherever the person is standing, rather than a preloaded whole-of-Singapore
// dataset like the EV/petrol features use — "food" alone would be tens of
// thousands of entries island-wide, and a live radius query stays fresh
// (restaurants open and close) without needing a manual dataset refresh.
// Most categories key off OSM's "amenity" tag, but a few (groceries, shopping,
// hotels, parks) are tagged under "shop"/"tourism"/"leisure" instead — each
// entry says which key to filter on. radius is a fixed 1km for every category
// per request — results are only ever "near me right now", not island-wide.
const PLACES_RADIUS_M = 1000;
const PLACE_CATEGORIES = {
  hospital: { key: 'amenity', tags: ['hospital'] },
  police: { key: 'amenity', tags: ['police'] },
  food: { key: 'amenity', tags: ['restaurant', 'fast_food', 'food_court'] },
  coffee: { key: 'amenity', tags: ['cafe'] },
  groceries: { key: 'shop', tags: ['supermarket', 'convenience'] },
  pharmacy: { key: 'amenity', tags: ['pharmacy'] },
  shopping: { key: 'shop', tags: ['mall', 'department_store'] },
  hotel: { key: 'tourism', tags: ['hotel'] },
  park: { key: 'leisure', tags: ['park'] },
};

function buildOverpassNearbyQuery({ key, tags }, lat, lon, radius) {
  const filter = tags.length === 1
    ? `["${key}"="${tags[0]}"]`
    : `["${key}"~"^(${tags.join('|')})$"]`;
  const around = `(around:${radius},${lat},${lon})`;
  // Include relations too, not just node/way — some larger sites (hospital
  // campuses, malls, parks) are mapped as multipolygon relations in OSM, and
  // `out center` gives those a usable centroid the same as a way.
  return `[out:json][timeout:25];(node${filter}${around};way${filter}${around};relation${filter}${around};);out center tags 40;`;
}

// Two independent public Overpass instances — overpass-api.de is the main
// one, but it turned out unreachable from Railway ("fetch failed" — a
// network-level failure, not a bad query or a slow response). Kumi Systems
// runs a separate, independently-hosted mirror as a fallback.
const OVERPASS_HOSTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function overpassNearby(cat, lat, lon, radius) {
  const query = buildOverpassNearbyQuery(cat, lat, lon, radius);
  let lastErr = null;
  for (const host of OVERPASS_HOSTS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 28000);
    try {
      const opRes = await fetch(host, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (compatible; WaypointSG/1.0; +https://waypoint-production-0307.up.railway.app/)',
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!opRes.ok) {
        const bodySnippet = (await opRes.text().catch(() => '')).slice(0, 300);
        throw new Error(`${host} responded ${opRes.status}: ${bodySnippet}`);
      }
      const data = await opRes.json();
      return (data.elements || [])
        .map((el) => {
          const point = el.type === 'node' ? el : el.center;
          const t = el.tags || {};
          const name = t.name || t.brand || null;
          // Unnamed nodes (a handful of tagged points with no name/brand at
          // all) aren't useful in a pick list — skip them.
          if (!point || !name) return null;
          const address = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
          return { label: name, address, lat: point.lat, lon: point.lon };
        })
        .filter(Boolean);
    } catch (err) {
      // err.cause carries the real underlying reason (DNS failure, connection
      // refused, etc.) for a fetch-level failure — log it, then fall through
      // to try the next mirror instead of giving up on the first bad host.
      lastErr = new Error(`${host} failed: ${err.message}${err.cause ? ` (cause: ${err.cause})` : ''}`);
      console.warn(lastErr.message);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastErr;
}

app.get('/api/places-nearby', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  const cat = PLACE_CATEGORIES[req.query.category];
  if (!cat) return res.status(400).json({ error: 'Unknown category.' });
  if (Number.isNaN(lat) || Number.isNaN(lon)) return res.status(400).json({ error: 'lat and lon are required' });

  try {
    const places = await overpassNearby(cat, lat, lon, PLACES_RADIUS_M);
    console.log(`places-nearby: category=${req.query.category} lat=${lat} lon=${lon} -> ${places.length} raw results within ${PLACES_RADIUS_M}m`);
    const results = places
      .map((p) => ({ ...p, distanceMeters: Math.round(haversineMeters(lat, lon, p.lat, p.lon)) }))
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, 8);
    res.json({ results });
  } catch (err) {
    console.error(`places-nearby error (category=${req.query.category}):`, err.message);
    res.status(502).json({ error: 'Could not search nearby places right now.' });
  }
});

// Approximate adult SimplyGo/EZ-Link card fare. Singapore's transit card
// charges ONE combined fare per journey based on total distance actually
// travelled by bus/train (not per leg, and excluding walking), as long as
// transfers happen within the standard transfer window — so we sum the
// distance of every non-walk leg and look it up in the (bus and train share
// the same table) LTA-published distance-fare bands. This is an ESTIMATE:
// actual fare can vary with peak/off-peak timing and promotions.
const FARE_TABLE_KM_CENTS = [
  [3.2, 128], [4.2, 138], [5.2, 149], [6.2, 159], [7.2, 168],
  [8.2, 175], [9.2, 182], [10.2, 186], [11.2, 190], [12.2, 194],
  [13.2, 198], [14.2, 202], [15.2, 207], [16.2, 211], [17.2, 215],
  [18.2, 220], [19.2, 224], [20.2, 227], [21.2, 230], [22.2, 233],
  [23.2, 236], [24.2, 238], [25.2, 240], [26.2, 242], [27.2, 243],
  [28.2, 244], [29.2, 245], [30.2, 246], [31.2, 247], [32.2, 248],
  [33.2, 249], [34.2, 250], [35.2, 251], [36.2, 252], [37.2, 253],
  [38.2, 254], [39.2, 255], [40.2, 256],
];
const FARE_MAX_CENTS = 257;

function estimateFareCents(totalKm) {
  if (totalKm <= 0) return 0;
  for (const [maxKm, cents] of FARE_TABLE_KM_CENTS) {
    if (totalKm <= maxKm) return cents;
  }
  return FARE_MAX_CENTS;
}

app.get('/api/transit-plan', async (req, res) => {
  const { fromLat, fromLon, toLat, toLon } = req.query;

  if (!fromLat || !fromLon || !toLat || !toLon) {
    return res.status(400).json({ error: 'fromLat, fromLon, toLat, toLon are required' });
  }

  const query = `
    query Plan($fromLat: Float!, $fromLon: Float!, $toLat: Float!, $toLon: Float!) {
      plan(
        from: { lat: $fromLat, lon: $fromLon }
        to: { lat: $toLat, lon: $toLon }
        transportModes: [{ mode: WALK }, { mode: TRANSIT }]
        numItineraries: 12
      ) {
        itineraries {
          duration
          startTime
          endTime
          walkDistance
          legs {
            mode
            duration
            distance
            startTime
            endTime
            from { name lat lon stop { code gtfsId } }
            to { name lat lon stop { code gtfsId } }
            route { shortName longName color textColor }
            headsign
            legGeometry { points }
            intermediateStops { name lat lon }
          }
        }
        routingErrors { code description }
      }
    }
  `;

  try {
    // transit-router sleeps when idle (Railway serverless mode, enabled to
    // cut hosting cost on a low-traffic app) — its first request after a
    // nap can come back as a 502, or hang while OTP reloads the transit
    // graph into memory, rather than just responding slowly. Retry a
    // couple of times with a short pause so a cold start reads to the user
    // as "took a bit longer" instead of an outright error.
    const MAX_ATTEMPTS = 3;
    const RETRY_DELAY_MS = 3000;
    let otpRes;
    let lastErr;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        otpRes = await fetch(`${TRANSIT_API_URL}/otp/routers/default/index/graphql`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            variables: {
              fromLat: parseFloat(fromLat),
              fromLon: parseFloat(fromLon),
              toLat: parseFloat(toLat),
              toLon: parseFloat(toLon),
            },
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (otpRes.ok) {
          lastErr = null;
          break;
        }
        lastErr = new Error(`transit router responded ${otpRes.status}`);
      } catch (err) {
        clearTimeout(timeout);
        lastErr = err;
      }

      if (attempt < MAX_ATTEMPTS) {
        console.warn(`transit-plan attempt ${attempt} failed (${lastErr.message}), retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }

    if (lastErr) {
      throw lastErr;
    }

    const body = await otpRes.json();
    const plan = body?.data?.plan;

    if (!plan) {
      return res.status(502).json({ error: 'Malformed response from transit router' });
    }

    const itineraries = (plan.itineraries || []).map((it) => {
      const legs = it.legs.map((leg) => ({
        mode: otpModeToLabel(leg.mode),
        duration: leg.duration,
        distance: leg.distance,
        startTime: leg.startTime,
        endTime: leg.endTime,
        from: leg.from?.name,
        fromLat: leg.from?.lat ?? null,
        fromLon: leg.from?.lon ?? null,
        fromStopCode: stopCode(leg.from?.stop),
        to: leg.to?.name,
        toLat: leg.to?.lat ?? null,
        toLon: leg.to?.lon ?? null,
        toStopCode: stopCode(leg.to?.stop),
        routeName: leg.route ? (leg.route.shortName || leg.route.longName) : null,
        routeColor: leg.route?.color || null,
        routeTextColor: leg.route?.textColor || null,
        headsign: leg.headsign || null,
        geometry: leg.legGeometry?.points || null,
        // Full boarding-to-alighting stop sequence (for the "Wake me up"
        // live stop countdown) — only meaningful for bus/train legs; walk
        // legs have no intermediateStops so this is just [from, to].
        stops:
          leg.mode === 'WALK'
            ? null
            : [
                { name: leg.from?.name, lat: leg.from?.lat ?? null, lon: leg.from?.lon ?? null },
                ...(leg.intermediateStops || []).map((s) => ({
                  name: s.name,
                  lat: s.lat,
                  lon: s.lon,
                })),
                { name: leg.to?.name, lat: leg.to?.lat ?? null, lon: leg.to?.lon ?? null },
              ],
      }));

      const transitKm = legs
        .filter((l) => l.mode !== 'walk')
        .reduce((sum, l) => sum + (l.distance || 0), 0) / 1000;

      return {
        duration: it.duration,
        startTime: it.startTime,
        endTime: it.endTime,
        walkDistance: it.walkDistance,
        fareEstimate: transitKm > 0 ? estimateFareCents(transitKm) / 100 : null,
        legs,
      };
    });

    // OTP can return several nearly-identical itineraries that differ only
    // by departure time (e.g. "Bus 168" three times over) — those eat up
    // slots in the alternatives list without offering anything genuinely
    // different to pick between. Keep only the fastest instance of each
    // distinct route "shape" (its sequence of transit legs), so a real
    // alternative — like an MRT+bus combo — has room to show up instead of
    // a third copy of the same bus at a different time.
    const bestByShape = new Map();
    for (const itinerary of itineraries) {
      const shape = itinerary.legs
        .filter((l) => l.mode !== 'walk')
        .map((l) => `${l.mode}:${l.routeName || '?'}`)
        .join('>') || 'walk-only';
      const existing = bestByShape.get(shape);
      if (!existing || itinerary.duration < existing.duration) {
        bestByShape.set(shape, itinerary);
      }
    }
    // MRT/LRT is generally faster and far less affected by road traffic than
    // a bus, so give rail-inclusive itineraries a modest priority over pure
    // duration — a route with a train leg only needs to be within 5 minutes
    // of the fastest bus-only option to rank above it, rather than requiring
    // it to literally win on raw time. Actual duration (shown to the user
    // and used for the "Fastest" badge below) is never altered — this only
    // affects display order.
    const RAIL_PRIORITY_BONUS_SECONDS = 5 * 60;
    const rankScore = (it) => {
      const hasRail = it.legs.some((l) => l.mode === 'train');
      return hasRail ? it.duration - RAIL_PRIORITY_BONUS_SECONDS : it.duration;
    };
    const dedupedItineraries = [...bestByShape.values()]
      .sort((a, b) => rankScore(a) - rankScore(b))
      .slice(0, 6);

    res.json({
      itineraries: dedupedItineraries,
      errors: plan.routingErrors || [],
    });
  } catch (err) {
    console.error('transit-plan error:', err.message);
    res.status(502).json({ error: 'Could not reach the transit router', detail: err.message });
  }
});

// ---- Live bus arrivals (LTA DataMall) ---------------------------------------
// Needs a free AccountKey from https://datamall.lta.gov.sg — set it as the
// LTA_ACCOUNT_KEY environment variable on this service. Until that's set,
// the endpoint responds with a clear "not configured" error instead of
// pretending to work.

const LTA_ACCOUNT_KEY = process.env.LTA_ACCOUNT_KEY || '';

function busNumberSortKey(serviceNo) {
  const match = /^(\d+)(.*)$/.exec(serviceNo || '');
  return match ? [parseInt(match[1], 10), match[2]] : [Infinity, serviceNo || ''];
}

app.get('/api/bus-arrivals', async (req, res) => {
  const { busStopCode } = req.query;

  if (!busStopCode) {
    return res.status(400).json({ error: 'busStopCode is required' });
  }
  if (!LTA_ACCOUNT_KEY) {
    return res.status(503).json({ error: 'Live bus arrivals aren\'t set up yet — needs an LTA DataMall API key.' });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const ltaRes = await fetch(
      `https://datamall2.mytransport.sg/ltaodataservice/v3/BusArrival?BusStopCode=${encodeURIComponent(busStopCode)}`,
      { headers: { AccountKey: LTA_ACCOUNT_KEY, accept: 'application/json' }, signal: controller.signal }
    );
    clearTimeout(timeout);

    if (!ltaRes.ok) {
      throw new Error(`LTA DataMall responded ${ltaRes.status}`);
    }

    const data = await ltaRes.json();

    const services = (data.Services || [])
      .map((s) => ({
        serviceNo: s.ServiceNo,
        operator: s.Operator,
        nextArrivals: [s.NextBus, s.NextBus2, s.NextBus3]
          .filter((b) => b && b.EstimatedArrival)
          .map((b) => ({
            estimatedArrival: b.EstimatedArrival,
            load: b.Load || null, // SEA (seats avail) / SDA (standing avail) / LSD (limited standing)
            type: b.Type || null, // SD (single) / DD (double) / BD (bendy)
            wheelchairAccessible: b.Feature === 'WAB',
          })),
      }))
      .sort((a, b) => {
        const [an, as_] = busNumberSortKey(a.serviceNo);
        const [bn, bs] = busNumberSortKey(b.serviceNo);
        return an - bn || as_.localeCompare(bs);
      });

    res.json({ busStopCode, services, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error('bus-arrivals error:', err.message);
    res.status(502).json({
      error: "⚠️ Bus times are temporarily unavailable — LTA's live data feed is having issues right now (not a Waypoint bug). Try again in a few minutes.",
      detail: err.message,
    });
  }
});

// ---- MRT/LRT service disruption alerts (LTA DataMall TrainServiceAlerts) ---
// Polled by the client every couple of minutes to show a dismissible banner
// when a line is disrupted. Status 1 = Normal, 2 = Disrupted (per LTA docs).
// Cached briefly so a burst of client polls doesn't hammer LTA.

let trainAlertsCache = null;
let trainAlertsCacheAt = 0;
const TRAIN_ALERTS_TTL_MS = 2 * 60 * 1000;

async function getTrainAlerts() {
  if (trainAlertsCache && Date.now() - trainAlertsCacheAt < TRAIN_ALERTS_TTL_MS) {
    return trainAlertsCache;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const ltaRes = await fetch('https://datamall2.mytransport.sg/ltaodataservice/TrainServiceAlerts', {
      headers: { AccountKey: LTA_ACCOUNT_KEY, accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!ltaRes.ok) throw new Error(`LTA TrainServiceAlerts responded ${ltaRes.status}`);
    const data = await ltaRes.json();
    trainAlertsCache = (data.value && data.value[0]) || { Status: 1, AffectedSegments: [], Message: [] };
    trainAlertsCacheAt = Date.now();
    return trainAlertsCache;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

app.get('/api/train-alerts', async (req, res) => {
  if (!LTA_ACCOUNT_KEY) {
    return res.json({ disrupted: false, message: null, lines: [] });
  }
  try {
    const alert = await getTrainAlerts();
    const disrupted = alert.Status === 2;
    res.json({
      disrupted,
      message: disrupted && alert.Message && alert.Message[0] ? alert.Message[0].Content : null,
      lines: disrupted ? [...new Set((alert.AffectedSegments || []).map((s) => s.Line).filter(Boolean))] : [],
    });
  } catch (err) {
    console.error('train-alerts error:', err.message);
    // Fail quietly — a broken alerts feed shouldn't masquerade as a real disruption.
    res.json({ disrupted: false, message: null, lines: [] });
  }
});

// ---- Push notification subscription endpoints -------------------------------

app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY, enabled: PUSH_ENABLED });
});

app.post('/api/push/subscribe', (req, res) => {
  const sub = req.body && req.body.subscription;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'subscription is required' });
  pushSubscriptions.set(sub.endpoint, sub);
  savePushSubscriptions();
  res.json({ ok: true });
});

app.post('/api/push/unsubscribe', (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  if (endpoint) {
    pushSubscriptions.delete(endpoint);
    savePushSubscriptions();
  }
  res.json({ ok: true });
});

// ---- Push trigger: MRT/LRT disruptions --------------------------------------
// Piggybacks on the same getTrainAlerts() cache the client-facing endpoint
// uses, but polls it proactively (not just when a client happens to ask) so a
// disruption can be pushed out even while nobody has the app open. The first
// check after startup only records a baseline and never pushes — otherwise
// every redeploy would blast a notification if a disruption happened to
// already be active at that moment.

let lastTrainAlertSignature; // undefined until the first successful check

async function checkTrainAlertsForPush() {
  if (!LTA_ACCOUNT_KEY || !PUSH_ENABLED) return;
  try {
    const alert = await getTrainAlerts();
    const disrupted = alert.Status === 2;
    const message = disrupted && alert.Message && alert.Message[0] ? alert.Message[0].Content : null;
    const signature = disrupted ? `disrupted:${message}` : 'normal';
    const hadBaseline = lastTrainAlertSignature !== undefined;
    const wasDisrupted = hadBaseline && lastTrainAlertSignature.startsWith('disrupted:');

    if (hadBaseline && signature !== lastTrainAlertSignature) {
      if (disrupted) {
        const lines = [...new Set((alert.AffectedSegments || []).map((s) => s.Line).filter(Boolean))];
        const linesPrefix = lines.length ? `${lines.join(', ')}: ` : '';
        broadcastPush({ title: '🚨 MRT/LRT Disruption', body: `${linesPrefix}${message}`, url: '/' })
          .catch((err) => console.error('train alert push failed:', err.message));
      } else if (wasDisrupted) {
        broadcastPush({ title: '✅ MRT/LRT Service Back to Normal', body: 'The earlier disruption has been resolved.', url: '/' })
          .catch((err) => console.error('train alert push failed:', err.message));
      }
    }
    lastTrainAlertSignature = signature;
  } catch (err) {
    console.error('train alert push check failed:', err.message);
  }
}

if (LTA_ACCOUNT_KEY && PUSH_ENABLED) {
  setInterval(checkTrainAlertsForPush, TRAIN_ALERTS_TTL_MS);
  checkTrainAlertsForPush();
}

// ---- Push trigger: major traffic incidents (LTA DataMall TrafficIncidents) --
// This is island-wide, not tied to any saved route — Waypoint doesn't send
// your Home/Work addresses to the server (they're kept local to your device
// on purpose, see the privacy policy), so there's no server-side way to know
// "is there a jam on my commute" yet. This pushes for genuinely new incidents
// of the more disruptive types; routine planned roadworks are skipped to avoid
// notification fatigue. LTA's feed has no stable incident ID, so the message
// text itself is used to detect "have we seen this one already."

const TRAFFIC_INCIDENTS_POLL_MS = 3 * 60 * 1000;
const TRAFFIC_INCIDENT_PUSH_TYPES = new Set([
  'accident', 'vehicle breakdown', 'road block', 'heavy traffic', 'obstacle', 'vehicle fire', 'weather',
]);

let knownIncidentMessages = new Set();
let incidentsBaselined = false;

async function checkTrafficIncidentsForPush() {
  if (!LTA_ACCOUNT_KEY || !PUSH_ENABLED) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const ltaRes = await fetch('https://datamall2.mytransport.sg/ltaodataservice/TrafficIncidents', {
      headers: { AccountKey: LTA_ACCOUNT_KEY, accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!ltaRes.ok) throw new Error(`LTA TrafficIncidents responded ${ltaRes.status}`);
    const data = await ltaRes.json();
    const incidents = data.value || [];
    const currentMessages = new Set(incidents.map((i) => i.Message).filter(Boolean));

    if (incidentsBaselined) {
      for (const incident of incidents) {
        const type = (incident.Type || '').toLowerCase();
        if (!incident.Message || knownIncidentMessages.has(incident.Message)) continue;
        if (!TRAFFIC_INCIDENT_PUSH_TYPES.has(type)) continue;
        broadcastPush({ title: `🚧 ${incident.Type || 'Traffic Incident'}`, body: incident.Message, url: '/' })
          .catch((err) => console.error('traffic incident push failed:', err.message));
      }
    }
    knownIncidentMessages = currentMessages;
    incidentsBaselined = true;
  } catch (err) {
    clearTimeout(timeout);
    console.error('traffic incidents push check failed:', err.message);
  }
}

if (LTA_ACCOUNT_KEY && PUSH_ENABLED) {
  setInterval(checkTrafficIncidentsForPush, TRAFFIC_INCIDENTS_POLL_MS);
  checkTrafficIncidentsForPush();
}

// ---- Bus stop directory (LTA DataMall static BusStops dataset, cached) -----
// Powers "search for a stop by code or name" for the Favourites feature.
// LTA paginates this 50 records at a time (~5,000 stops total), so we fetch
// the whole thing once and cache it in memory rather than hitting LTA on
// every keystroke. Refreshed once a day — bus stops essentially never move.

let busStopsCache = [];
let busStopsCacheAt = 0;
const BUS_STOPS_TTL_MS = 24 * 60 * 60 * 1000;

async function fetchAllBusStops() {
  const all = [];
  let skip = 0;
  for (;;) {
    const res = await fetch(`https://datamall2.mytransport.sg/ltaodataservice/BusStops?$skip=${skip}`, {
      headers: { AccountKey: LTA_ACCOUNT_KEY, accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`LTA BusStops responded ${res.status}`);
    const data = await res.json();
    const batch = data.value || [];
    all.push(...batch);
    if (batch.length < 50) break;
    skip += 50;
  }
  return all;
}

async function getBusStops() {
  if (busStopsCache.length && Date.now() - busStopsCacheAt < BUS_STOPS_TTL_MS) return busStopsCache;
  const stops = await fetchAllBusStops();
  if (stops.length) {
    busStopsCache = stops;
    busStopsCacheAt = Date.now();
  }
  return busStopsCache;
}

// Warm the cache at boot so the first real search doesn't have to wait on ~100
// paginated LTA calls. Harmless no-op if the key isn't set yet.
if (LTA_ACCOUNT_KEY) getBusStops().catch((err) => console.error('bus stop cache warmup failed:', err.message));

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---- Carpark availability (LTA DataMall CarParkAvailability, cached) -------
// Powers "nearby parking" for driving directions. LTA paginates this 50 at a
// time like the bus stop directory; refreshed every 2 minutes since LTA's
// own feed updates roughly every minute.

let carParksCache = [];
let carParksCacheAt = 0;
const CARPARKS_TTL_MS = 2 * 60 * 1000;

async function fetchAllCarParks() {
  const all = [];
  let skip = 0;
  for (;;) {
    const res = await fetch(`https://datamall2.mytransport.sg/ltaodataservice/CarParkAvailabilityv2?$skip=${skip}`, {
      headers: { AccountKey: LTA_ACCOUNT_KEY, accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`LTA CarParkAvailabilityv2 responded ${res.status}`);
    const data = await res.json();
    const batch = data.value || [];
    all.push(...batch);
    if (batch.length < 50) break;
    skip += 50;
  }
  return all;
}

async function getCarParks() {
  if (carParksCache.length && Date.now() - carParksCacheAt < CARPARKS_TTL_MS) return carParksCache;
  const parks = await fetchAllCarParks();
  if (parks.length) {
    carParksCache = parks;
    carParksCacheAt = Date.now();
  }
  return carParksCache;
}

app.get('/api/carparks-nearby', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return res.status(400).json({ error: 'lat and lon are required' });
  }
  if (!LTA_ACCOUNT_KEY) {
    return res.status(503).json({ error: 'Carpark availability isn\'t set up yet — needs an LTA DataMall API key.' });
  }

  try {
    const parks = await getCarParks();
    const mapped = parks
      .filter((p) => p.LotType !== 'Y') // exclude motorcycle-only lots
      .map((p) => {
        const [plat, plon] = (p.Location || '').split(' ').map(Number);
        if (Number.isNaN(plat) || Number.isNaN(plon)) return null;
        return {
          id: p.CarParkID,
          development: p.Development,
          agency: p.Agency,
          availableLots: Number(p.AvailableLots),
          lat: plat,
          lon: plon,
          distanceMeters: Math.round(haversineMeters(lat, lon, plat, plon)),
        };
      })
      .filter(Boolean);

    // LTA's feed has multiple sub-records per physical carpark (e.g. separate
    // lot-type/scheme entries under the same CarParkID) — dedupe so nearby
    // results aren't 5 copies of the same carpark, keeping the fuller count.
    const byId = new Map();
    mapped.forEach((p) => {
      const existing = byId.get(p.id);
      if (!existing || p.availableLots > existing.availableLots) byId.set(p.id, p);
    });

    const results = [...byId.values()]
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, 5);
    res.json({ carparks: results, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error('carparks-nearby error:', err.message);
    res.status(502).json({ error: 'Could not load carpark availability.', detail: err.message });
  }
});

// ---- EV charging points near a destination -----------------------------------
// Sourced from LTA DataMall's quarterly "Electric Vehicle Charging Points"
// static dataset (https://datamall.lta.gov.sg) — locations only, no live
// occupied/free status (LTA doesn't publish that). Pre-grouped at build time
// (scripts/build-ev-data.py) from ~11k individual outlet rows down to ~2.8k
// physical station locations, combining outlet counts and plug types per site.
// Loaded once into memory since the whole file is under 1MB and only changes
// when the quarterly CSV is refreshed and re-run through the build script.
let evChargingPoints = [];
try {
  evChargingPoints = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'ev-charging-points.json'), 'utf8'));
  console.log(`Loaded ${evChargingPoints.length} EV charging station locations.`);
} catch (err) {
  console.warn('Could not load EV charging points data:', err.message);
}

app.get('/api/ev-charging-nearby', (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return res.status(400).json({ error: 'lat and lon are required' });
  }
  if (!evChargingPoints.length) {
    return res.status(503).json({ error: 'EV charging point data isn\'t loaded.' });
  }

  const results = evChargingPoints
    .map((s) => ({
      address: s.address,
      postalCode: s.postalCode,
      operators: s.operators,
      plugTypes: s.plugTypes,
      outlets: s.outlets,
      lat: s.lat,
      lon: s.lon,
      distanceMeters: Math.round(haversineMeters(lat, lon, s.lat, s.lon)),
    }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 5);

  res.json({ stations: results });
});

// ---- Petrol stations near a destination -------------------------------------
// LTA DataMall / data.gov.sg don't publish a retail petrol station location
// dataset (their closest match is a ~21-entry industrial bulk-fuel-depot
// list, not petrol kiosks) so this is sourced from OpenStreetMap's
// community-mapped `amenity=fuel` points via the Overpass API — locations
// only, no live price or queue data (nobody publishes that for SG).
// Pre-processed at build time (scripts/build-petrol-data.py) from a raw
// Overpass JSON export into a compact per-station list.
let petrolStations = [];
try {
  petrolStations = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'petrol-stations.json'), 'utf8'));
  console.log(`Loaded ${petrolStations.length} petrol station locations.`);
} catch (err) {
  console.warn('Could not load petrol station data:', err.message);
}

app.get('/api/petrol-nearby', (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return res.status(400).json({ error: 'lat and lon are required' });
  }
  if (!petrolStations.length) {
    return res.status(503).json({ error: 'Petrol station data isn\'t loaded.' });
  }

  const results = petrolStations
    .map((s) => ({
      name: s.name,
      brand: s.brand,
      address: s.address,
      open24h: s.open24h,
      lat: s.lat,
      lon: s.lon,
      distanceMeters: Math.round(haversineMeters(lat, lon, s.lat, s.lon)),
    }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 5);

  res.json({ stations: results });
});

// ---- ERP gantry crossings along a driving route -----------------------------
// LTA doesn't publish an API that maps a route to an exact ERP dollar cost —
// its ERPRates feed (rates by zone/time/vehicle type) has no published link
// back to physical gantry locations. Rather than guess at a dollar figure
// that could be wrong, this detects which physical gantries (from data.gov.sg's
// static LTA Gantry geometry dataset) a route's polyline passes near, and
// leaves the exact cost to LTA's own rate table via a link in the UI.

let gantryCache = null;
let gantryCacheAt = 0;
const GANTRY_TTL_MS = 24 * 60 * 60 * 1000;
const GANTRY_DATASET_ID = 'd_753090823cc9920ac41efaa6530c5893';

async function getGantries() {
  if (gantryCache && Date.now() - gantryCacheAt < GANTRY_TTL_MS) return gantryCache;

  const pollRes = await fetch(
    `https://api-open.data.gov.sg/v1/public/api/datasets/${GANTRY_DATASET_ID}/poll-download`
  );
  if (!pollRes.ok) throw new Error(`gantry poll-download responded ${pollRes.status}`);
  const pollData = await pollRes.json();
  const url = pollData?.data?.url;
  if (!url) throw new Error('gantry dataset URL missing from poll-download response');

  const geoRes = await fetch(url);
  if (!geoRes.ok) throw new Error(`gantry geojson fetch responded ${geoRes.status}`);
  const geojson = await geoRes.json();

  const gantries = (geojson.features || [])
    .map((f, i) => {
      const coords = f.geometry && f.geometry.type === 'LineString' ? f.geometry.coordinates : null;
      if (!coords || !coords.length) return null;
      const [lon, lat] = coords[Math.floor(coords.length / 2)];
      return { id: f.properties?.Name || `gantry-${i}`, lat, lon };
    })
    .filter(Boolean);

  if (gantries.length) {
    gantryCache = gantries;
    gantryCacheAt = Date.now();
  }
  return gantryCache || [];
}

app.post('/api/erp-crossings', async (req, res) => {
  const coords = req.body?.coordinates; // [[lon, lat], ...] — e.g. OSRM route geometry
  if (!Array.isArray(coords) || coords.length < 2) {
    return res.status(400).json({ error: 'coordinates array is required' });
  }
  try {
    const gantries = await getGantries();
    const THRESHOLD_METERS = 30;
    const crossedCount = gantries.filter((g) =>
      coords.some(([lon, lat]) => haversineMeters(lat, lon, g.lat, g.lon) < THRESHOLD_METERS)
    ).length;
    res.json({ gantryCount: crossedCount });
  } catch (err) {
    console.error('erp-crossings error:', err.message);
    // Fail quietly — this is informational, not core routing.
    res.json({ gantryCount: null });
  }
});

// ---- Live traffic speed on a driving route (LTA DataMall TrafficSpeedBandsv2) ----
// LTA publishes near-real-time speed bands (refreshed roughly every 5 min) for
// road links across Singapore. This fetches the full island-wide dataset,
// caches it briefly, then matches a route's polyline against it so jammed
// stretches can be drawn in red/amber on the nav map instead of the usual
// plain blue line.

let trafficSpeedBandsCache = [];
let trafficSpeedBandsGrid = null;
let trafficSpeedBandsCacheAt = 0;
const TRAFFIC_SPEED_BANDS_TTL_MS = 3 * 60 * 1000; // LTA's own feed refreshes ~every 5 min
const TRAFFIC_GRID_CELL_DEG = 0.01; // ~1.1km lat / ~1km lon at SG's latitude — spatial index bucket size

// SpeedBand 1-8 -> approx km/h, per LTA's API guide:
// 1: 0-9, 2: 10-19, 3: 20-29, 4: 30-39, 5: 40-49, 6: 50-59, 7: 60-69, 8: 70+
function classifySpeedBand(band) {
  if (band <= 2) return 'red';   // heavy jam
  if (band <= 4) return 'amber'; // slow-moving
  return null;                   // flowing fine — no overlay needed
}

function parseSpeedBandLocation(loc) {
  if (!loc) return null;
  const parts = loc.trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return null;
  const [lat1, lon1, lat2, lon2] = parts;
  return { lat1, lon1, lat2, lon2 };
}

function trafficGridKey(lat, lon) {
  return `${Math.floor(lat / TRAFFIC_GRID_CELL_DEG)}_${Math.floor(lon / TRAFFIC_GRID_CELL_DEG)}`;
}

// Buckets each link under the grid cell(s) it touches so matching a route
// point only has to check a handful of nearby links, not the whole island.
function buildTrafficGrid(links) {
  const grid = new Map();
  links.forEach((link, idx) => {
    const cells = new Set([
      trafficGridKey(link.lat1, link.lon1),
      trafficGridKey(link.lat2, link.lon2),
      trafficGridKey((link.lat1 + link.lat2) / 2, (link.lon1 + link.lon2) / 2),
    ]);
    cells.forEach((key) => {
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(idx);
    });
  });
  return grid;
}

async function fetchAllTrafficSpeedBands() {
  const all = [];
  let skip = 0;
  for (;;) {
    const res = await fetch(`https://datamall2.mytransport.sg/ltaodataservice/TrafficSpeedBandsv2?$skip=${skip}`, {
      headers: { AccountKey: LTA_ACCOUNT_KEY, accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`LTA TrafficSpeedBandsv2 responded ${res.status}`);
    const data = await res.json();
    const batch = data.value || [];
    for (const item of batch) {
      const loc = parseSpeedBandLocation(item.Location);
      const band = parseInt(item.SpeedBand, 10);
      if (loc && Number.isFinite(band)) all.push({ ...loc, speedBand: band });
    }
    if (batch.length < 500) break; // LTA pages this endpoint 500 records at a time
    skip += 500;
  }
  return all;
}

async function getTrafficSpeedBands() {
  if (trafficSpeedBandsCache.length && Date.now() - trafficSpeedBandsCacheAt < TRAFFIC_SPEED_BANDS_TTL_MS) {
    return { links: trafficSpeedBandsCache, grid: trafficSpeedBandsGrid };
  }
  const links = await fetchAllTrafficSpeedBands();
  if (links.length) {
    trafficSpeedBandsCache = links;
    trafficSpeedBandsGrid = buildTrafficGrid(links);
    trafficSpeedBandsCacheAt = Date.now();
  }
  return { links: trafficSpeedBandsCache, grid: trafficSpeedBandsGrid };
}

// Warm the cache at boot so the first driving route doesn't have to wait on a
// few dozen paginated LTA calls. Harmless no-op if the key isn't set yet.
if (LTA_ACCOUNT_KEY) getTrafficSpeedBands().catch((err) => console.error('traffic speed bands warmup failed:', err.message));

// Flat-earth projection referenced to Singapore's latitude — plenty accurate
// over the ~50km the island spans, and much cheaper than haversine when run
// per-candidate-link across an entire route's worth of sample points.
const SG_M_PER_DEG_LAT = 110574;
const SG_M_PER_DEG_LON = 111320 * Math.cos((1.35 * Math.PI) / 180);

function pointToSegmentMeters(plat, plon, alat, alon, blat, blon) {
  const px = plon * SG_M_PER_DEG_LON, py = plat * SG_M_PER_DEG_LAT;
  const ax = alon * SG_M_PER_DEG_LON, ay = alat * SG_M_PER_DEG_LAT;
  const bx = blon * SG_M_PER_DEG_LON, by = blat * SG_M_PER_DEG_LAT;
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// LTA's road-link geometry doesn't line up exactly with OSRM/OSM's, so this
// is deliberately generous — wide enough to catch the right road, tight
// enough to not bleed onto a parallel one.
const TRAFFIC_MATCH_THRESHOLD_M = 35;

function findNearestSpeedBand(grid, links, lat, lon) {
  const baseLatCell = Math.floor(lat / TRAFFIC_GRID_CELL_DEG);
  const baseLonCell = Math.floor(lon / TRAFFIC_GRID_CELL_DEG);
  let best = null, bestDist = Infinity;
  for (let dLat = -1; dLat <= 1; dLat++) {
    for (let dLon = -1; dLon <= 1; dLon++) {
      const bucket = grid.get(`${baseLatCell + dLat}_${baseLonCell + dLon}`);
      if (!bucket) continue;
      for (const idx of bucket) {
        const link = links[idx];
        const d = pointToSegmentMeters(lat, lon, link.lat1, link.lon1, link.lat2, link.lon2);
        if (d < bestDist) { bestDist = d; best = link; }
      }
    }
  }
  return bestDist <= TRAFFIC_MATCH_THRESHOLD_M ? best : null;
}

// Walks a route's [lon,lat] geometry and drops a point roughly every
// `stepMeters`, independent of how sparse/dense OSRM's own vertices are —
// gives consistent-granularity samples to match against speed band links.
function resampleRouteMeters(coordsLonLat, stepMeters) {
  if (!coordsLonLat.length) return [];
  const out = [coordsLonLat[0]];
  let carry = 0;
  for (let i = 1; i < coordsLonLat.length; i++) {
    let [lon0, lat0] = coordsLonLat[i - 1];
    const [lon1, lat1] = coordsLonLat[i];
    let segLen = haversineMeters(lat0, lon0, lat1, lon1);
    if (segLen === 0) continue;
    while (carry + segLen >= stepMeters) {
      const t = (stepMeters - carry) / segLen;
      const lat = lat0 + (lat1 - lat0) * t;
      const lon = lon0 + (lon1 - lon0) * t;
      out.push([lon, lat]);
      lat0 = lat; lon0 = lon;
      segLen = haversineMeters(lat0, lon0, lat1, lon1);
      carry = 0;
    }
    carry += segLen;
  }
  out.push(coordsLonLat[coordsLonLat.length - 1]);
  return out;
}

const TRAFFIC_SAMPLE_STEP_M = 40;
const TRAFFIC_MAX_ROUTE_POINTS = 5000;

app.post('/api/route-traffic', async (req, res) => {
  const coords = req.body?.coordinates; // [[lon, lat], ...] — e.g. OSRM route geometry
  if (!Array.isArray(coords) || coords.length < 2) {
    return res.status(400).json({ error: 'coordinates array is required' });
  }
  if (coords.length > TRAFFIC_MAX_ROUTE_POINTS) {
    return res.status(400).json({ error: 'Route is too long to check for live traffic.' });
  }
  if (!LTA_ACCOUNT_KEY) {
    return res.json({ overlays: [], meta: { redMeters: 0, amberMeters: 0 } });
  }

  try {
    const { links, grid } = await getTrafficSpeedBands();
    if (!links.length || !grid) {
      return res.json({ overlays: [], meta: { redMeters: 0, amberMeters: 0 } });
    }

    const sampled = resampleRouteMeters(coords, TRAFFIC_SAMPLE_STEP_M);
    const classified = sampled.map(([lon, lat]) => {
      const link = findNearestSpeedBand(grid, links, lat, lon);
      return { lat, lon, cls: link ? classifySpeedBand(link.speedBand) : null };
    });

    // Collapse consecutive same-classification samples into overlay
    // segments, so the client just draws a handful of colored polylines on
    // top of the base route instead of one styled segment per sample point.
    const overlays = [];
    let redMeters = 0;
    let amberMeters = 0;
    let i = 0;
    while (i < classified.length) {
      const cls = classified[i].cls;
      if (!cls) { i++; continue; }
      let j = i;
      while (j + 1 < classified.length && classified[j + 1].cls === cls) j++;
      // Pull in one neighbouring sample on each side so the overlay's ends
      // touch the base route line instead of leaving a visible gap.
      const startIdx = Math.max(0, i - 1);
      const endIdx = Math.min(classified.length - 1, j + 1);
      const points = classified.slice(startIdx, endIdx + 1).map((p) => [p.lat, p.lon]);
      let segMeters = 0;
      for (let k = 1; k < points.length; k++) {
        segMeters += haversineMeters(points[k - 1][0], points[k - 1][1], points[k][0], points[k][1]);
      }
      if (cls === 'red') redMeters += segMeters; else amberMeters += segMeters;
      overlays.push({ color: cls, points });
      i = j + 1;
    }

    res.json({ overlays, meta: { redMeters: Math.round(redMeters), amberMeters: Math.round(amberMeters) } });
  } catch (err) {
    console.error('route-traffic error:', err.message);
    // Fail quietly — this is informational, not core routing.
    res.json({ overlays: [], meta: { redMeters: 0, amberMeters: 0 } });
  }
});

// "Stops near me" for the Favourites tab — sorts the full cached stop
// directory by straight-line distance from the given position instead of
// requiring the user to know/type a stop name.
app.get('/api/stop-search-nearby', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return res.status(400).json({ error: 'lat and lon are required' });
  }
  if (!LTA_ACCOUNT_KEY) {
    return res.status(503).json({ error: 'Bus stop search isn\'t set up yet — needs an LTA DataMall API key.' });
  }

  try {
    const stops = await getBusStops();
    const results = stops
      .map((s) => ({
        code: s.BusStopCode,
        name: s.Description,
        road: s.RoadName,
        lat: s.Latitude,
        lon: s.Longitude,
        distance: haversineMeters(lat, lon, s.Latitude, s.Longitude),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 10);
    res.json({ results });
  } catch (err) {
    console.error('stop-search-nearby error:', err.message);
    res.status(502).json({ error: 'Could not search nearby bus stops.', detail: err.message });
  }
});

app.get('/api/stop-search', async (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  if (q.length < 1) return res.json({ results: [] });
  if (!LTA_ACCOUNT_KEY) {
    return res.status(503).json({ error: 'Bus stop search isn\'t set up yet — needs an LTA DataMall API key.' });
  }

  try {
    const stops = await getBusStops();
    const results = stops
      .filter((s) => s.BusStopCode.startsWith(q)
        || (s.Description || '').toLowerCase().includes(q)
        || (s.RoadName || '').toLowerCase().includes(q))
      .slice(0, 15)
      .map((s) => ({
        code: s.BusStopCode,
        name: s.Description,
        road: s.RoadName,
        lat: s.Latitude,
        lon: s.Longitude,
      }));
    res.json({ results });
  } catch (err) {
    console.error('stop-search error:', err.message);
    res.status(502).json({ error: 'Could not search bus stops.', detail: err.message });
  }
});

// ---- Rain awareness (NEA 2-hour weather forecast, data.gov.sg) -------------
// Singapore-specific value-add: flags rain forecast near either end of a
// walking-inclusive route so people know to grab an umbrella. Free public
// dataset, no API key required.

let weatherCache = null; // { areaMetadata, forecasts, validPeriod }
let weatherCacheAt = 0;
const WEATHER_TTL_MS = 5 * 60 * 1000; // NEA updates this roughly every 30 min

async function getWeatherForecast() {
  if (weatherCache && Date.now() - weatherCacheAt < WEATHER_TTL_MS) return weatherCache;
  const res = await fetch('https://api.data.gov.sg/v1/environment/2-hour-weather-forecast');
  if (!res.ok) throw new Error(`NEA weather API responded ${res.status}`);
  const data = await res.json();
  const item = data.items?.[0];
  if (!item) throw new Error('No forecast data returned');
  weatherCache = {
    areaMetadata: data.area_metadata || [],
    forecasts: item.forecasts || [],
    validPeriod: item.valid_period || null,
  };
  weatherCacheAt = Date.now();
  return weatherCache;
}

const RAINY_PATTERN = /rain|shower|thundery/i;

// Maps NEA's free-text forecast (e.g. "Light Showers", "Partly Cloudy",
// "Fair (Night)") to a single representative emoji for the weather widget.
function forecastIcon(text) {
  if (!text) return '🌡️';
  const t = text.toLowerCase();
  if (t.includes('thundery')) return '⛈️';
  if (t.includes('rain') || t.includes('shower')) return '🌧️';
  if (t.includes('fog') || t.includes('mist') || t.includes('haz')) return '🌫️';
  if (t.includes('windy')) return '💨';
  if (t.includes('cloudy')) return '☁️';
  if (t.includes('fair') || t.includes('sunny')) return '☀️';
  return '🌤️';
}

app.get('/api/weather-nearby', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return res.status(400).json({ error: 'lat and lon are required' });
  }

  try {
    const { areaMetadata, forecasts, validPeriod } = await getWeatherForecast();
    if (!areaMetadata.length) {
      return res.status(502).json({ error: 'No weather areas available.' });
    }

    let nearest = null;
    let nearestDist = Infinity;
    areaMetadata.forEach((a) => {
      const d = haversineMeters(lat, lon, a.label_location.latitude, a.label_location.longitude);
      if (d < nearestDist) { nearestDist = d; nearest = a; }
    });

    const match = forecasts.find((f) => f.area === nearest.name);
    const forecastText = match ? match.forecast : null;

    res.json({
      area: nearest.name,
      forecast: forecastText,
      icon: forecastIcon(forecastText),
      isRainy: forecastText ? RAINY_PATTERN.test(forecastText) : false,
      validPeriod,
    });
  } catch (err) {
    console.error('weather-nearby error:', err.message);
    res.status(502).json({ error: 'Could not fetch weather forecast.', detail: err.message });
  }
});

// Today's detailed outlook (NEA 24-hour forecast) — general Singapore-wide
// forecast text, temperature range, humidity range, and wind. Distinct from
// the 2-hour nearby forecast above: that one is hyper-local and used for the
// rain alert; this one is the fuller "what's today going to be like" view
// shown when the weather widget is tapped.

let dailyWeatherCache = null; // { general, validPeriod }
let dailyWeatherCacheAt = 0;
const DAILY_WEATHER_TTL_MS = 30 * 60 * 1000; // NEA refreshes this a few times a day

async function getDailyForecast() {
  if (dailyWeatherCache && Date.now() - dailyWeatherCacheAt < DAILY_WEATHER_TTL_MS) return dailyWeatherCache;
  const res = await fetch('https://api.data.gov.sg/v1/environment/24-hour-weather-forecast');
  if (!res.ok) throw new Error(`NEA 24-hour forecast API responded ${res.status}`);
  const data = await res.json();
  const item = data.items?.[0];
  if (!item) throw new Error('No forecast data returned');
  dailyWeatherCache = {
    general: item.general || null,
    validPeriod: item.valid_period || null,
  };
  dailyWeatherCacheAt = Date.now();
  return dailyWeatherCache;
}

app.get('/api/weather-today', async (req, res) => {
  try {
    const { general, validPeriod } = await getDailyForecast();
    if (!general) {
      return res.status(502).json({ error: 'No forecast data available.' });
    }

    res.json({
      forecast: general.forecast || null,
      icon: forecastIcon(general.forecast),
      isRainy: general.forecast ? RAINY_PATTERN.test(general.forecast) : false,
      tempLow: general.temperature?.low ?? null,
      tempHigh: general.temperature?.high ?? null,
      humidityLow: general.relative_humidity?.low ?? null,
      humidityHigh: general.relative_humidity?.high ?? null,
      windDirection: general.wind?.direction ?? null,
      windSpeedLow: general.wind?.speed?.low ?? null,
      windSpeedHigh: general.wind?.speed?.high ?? null,
      validPeriod,
    });
  } catch (err) {
    console.error('weather-today error:', err.message);
    res.status(502).json({ error: "Could not fetch today's forecast.", detail: err.message });
  }
});

// SPA-style fallback for any unmatched route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Waypoint running on port ${PORT}`);
  console.log(`Loaded ${pushSubscriptions.size} push subscription(s) from ${SUBSCRIPTIONS_FILE}`);
});
