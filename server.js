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
// UI. Until both are set, push features quietly no-op instead of erroring.
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const PUSH_ENABLED = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (PUSH_ENABLED) {
  webpush.setVapidDetails('https://waypoint-production-0307.up.railway.app', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
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

// Express's static middleware ignores dotfiles (like .well-known) by
// default, which would 404 the Android app's Digital Asset Links file —
// serve that one path explicitly before the catch-all static handler.
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', '.well-known', 'assetlinks.json'));
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use(express.json());

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

app.get('/api/geocode', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ results: [] });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const url = `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${encodeURIComponent(q)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
    const omRes = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WaypointSG/1.0; +https://waypoint-production-0307.up.railway.app/)',
        Accept: 'application/json',
      },
    });
    clearTimeout(timeout);

    if (!omRes.ok) throw new Error(`OneMap responded ${omRes.status}`);
    const data = await omRes.json();

    const results = (data.results || [])
      .slice(0, 6)
      .map((r) => ({
        label: r.SEARCHVAL || r.BUILDING || r.ADDRESS || '',
        address: r.ADDRESS || '',
        lat: parseFloat(r.LATITUDE),
        lon: parseFloat(r.LONGITUDE),
      }))
      .filter((r) => r.label && !Number.isNaN(r.lat) && !Number.isNaN(r.lon));

    res.json({ results });
  } catch (err) {
    console.error('geocode error:', err.message);
    res.status(502).json({ error: 'Could not search that location.', detail: err.message });
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
        numItineraries: 6
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
          }
        }
        routingErrors { code description }
      }
    }
  `;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const otpRes = await fetch(`${TRANSIT_API_URL}/otp/routers/default/index/graphql`, {
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

    if (!otpRes.ok) {
      throw new Error(`transit router responded ${otpRes.status}`);
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
        headsign: leg.headsign || null,
        geometry: leg.legGeometry?.points || null,
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

    res.json({
      itineraries,
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
