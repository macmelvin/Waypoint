const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Internal Railway private-network address of the transit-router (OpenTripPlanner) service.
const TRANSIT_API_URL = process.env.TRANSIT_API_URL || 'http://transit-router.railway.internal:8080';

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

    const itineraries = (plan.itineraries || []).map((it) => ({
      duration: it.duration,
      startTime: it.startTime,
      endTime: it.endTime,
      walkDistance: it.walkDistance,
      legs: it.legs.map((leg) => ({
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
      })),
    }));

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

// SPA-style fallback for any unmatched route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Waypoint running on port ${PORT}`);
});
