const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Internal Railway private-network address of the transit-router (OpenTripPlanner) service.
const TRANSIT_API_URL = process.env.TRANSIT_API_URL || 'http://transit-router.railway.internal:8080';

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

    res.json({ busStopCode, services });
  } catch (err) {
    console.error('bus-arrivals error:', err.message);
    res.status(502).json({ error: 'Could not reach LTA DataMall.', detail: err.message });
  }
});

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
});
