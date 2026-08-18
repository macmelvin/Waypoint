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
            from { name lat lon stop { code } }
            to { name lat lon stop { code } }
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
        fromStopCode: leg.from?.stop?.code ?? null,
        to: leg.to?.name,
        toLat: leg.to?.lat ?? null,
        toLon: leg.to?.lon ?? null,
        toStopCode: leg.to?.stop?.code ?? null,
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

// SPA-style fallback for any unmatched route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Waypoint running on port ${PORT}`);
});
