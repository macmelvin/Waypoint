# syntax=docker/dockerfile:1.4
# Transit router for Waypoint — OpenTripPlanner serving Singapore bus + MRT/LRT.
# Internal-only service: the main "waypoint" service proxies to this over
# Railway's private network, so nothing here needs a public domain.

FROM eclipse-temurin:21-jre AS graphbuild

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl osmium-tool unzip python3 ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /graph

# OpenTripPlanner (needs Java 21; do not bump past 2.7.x without checking the
# required Java version — 2.9.x requires Java 25).
RUN curl -fsSL -o otp.jar \
    https://github.com/opentripplanner/OpenTripPlanner/releases/download/v2.7.0/otp-shaded-2.7.0.jar

# Singapore GTFS (bus + MRT/LRT), community-maintained from LTA DataMall data.
RUN curl -fsSL -o singapore-gtfs.zip \
    "https://files.mobilitydatabase.org/mdb-3051/mdb-3051-202602171452/mdb-3051-202602171452.zip"

# Street network for walk/transfer legs: Geofabrik's Malaysia/Singapore/Brunei
# extract, clipped down to just Singapore (+ a small border buffer) so the
# graph build stays fast and light.
RUN curl -fsSL -o mysgbn.osm.pbf \
    https://download.geofabrik.de/asia/malaysia-singapore-brunei-latest.osm.pbf && \
    osmium extract -b 103.55,1.13,104.13,1.485 mysgbn.osm.pbf -o singapore.osm.pbf --overwrite && \
    rm mysgbn.osm.pbf

COPY build-config.json router-config.json /graph/

# --- TEMP DIAGNOSTIC ---------------------------------------------------------
# Investigating why zero rail (MRT/LRT) legs ever appear in itineraries.
# Inspect the GTFS feed's route_type breakdown and rail trip/schedule data
# directly, then abort *before* the ~10min graph build so this comes back
# fast. Remove this whole RUN block once the cause is found.
RUN <<'SCRIPT'
set -e
mkdir -p /tmp/gtfs-inspect
cd /tmp/gtfs-inspect
unzip -oq /graph/singapore-gtfs.zip
cat > inspect.py <<'PYEOF'
import csv, os
from collections import Counter

print('=== files ===', sorted(os.listdir('.')))

with open('routes.txt', newline='', encoding='utf-8-sig') as f:
    routes = list(csv.DictReader(f))
print('=== total routes ===', len(routes))
print('=== route_type counts ===', dict(Counter(r.get('route_type') for r in routes)))

rail_types = {'0', '1', '2', '5', '6', '7', '11', '12'}
rail_routes = [r for r in routes if r.get('route_type') in rail_types]
print('=== rail-like route count ===', len(rail_routes))
for r in rail_routes[:15]:
    print('  ', r.get('route_id'), r.get('route_short_name'), r.get('route_long_name'), 'type=', r.get('route_type'))

has_freq = os.path.exists('frequencies.txt')
print('=== has frequencies.txt ===', has_freq)
if has_freq:
    with open('frequencies.txt', newline='', encoding='utf-8-sig') as f:
        freq_rows = list(csv.DictReader(f))
    print('=== frequencies.txt row count ===', len(freq_rows))
    print('=== sample frequencies ===', freq_rows[:3])

with open('trips.txt', newline='', encoding='utf-8-sig') as f:
    trips = list(csv.DictReader(f))
print('=== total trips ===', len(trips))
rail_route_ids = {r['route_id'] for r in rail_routes}
rail_trips = [t for t in trips if t.get('route_id') in rail_route_ids]
print('=== rail trips count ===', len(rail_trips))
if rail_trips:
    print('=== sample rail trip ===', rail_trips[0])

rail_trip_ids = {t['trip_id'] for t in rail_trips}
st_count = 0
sample_rows = []
rail_stop_ids = set()
with open('stop_times.txt', newline='', encoding='utf-8-sig') as f:
    reader = csv.DictReader(f)
    for row in reader:
        if row.get('trip_id') in rail_trip_ids:
            st_count += 1
            rail_stop_ids.add(row.get('stop_id'))
            if len(sample_rows) < 5:
                sample_rows.append(row)
print('=== stop_times rows for rail trips ===', st_count)
print('=== sample rail stop_times ===', sample_rows)
print('=== distinct rail stop_ids ===', len(rail_stop_ids))

with open('stops.txt', newline='', encoding='utf-8-sig') as f:
    stops = list(csv.DictReader(f))
print('=== stops.txt columns ===', list(stops[0].keys()) if stops else None)
print('=== total stops ===', len(stops))

rail_stops = [s for s in stops if s.get('stop_id') in rail_stop_ids]
print('=== rail stop records found ===', len(rail_stops))
for s in rail_stops[:20]:
    print('  ', {k: s.get(k) for k in ('stop_id','stop_name','stop_lat','stop_lon','location_type','parent_station')})

# Sanity-check specific well-known stations by name.
for needle in ('Punggol', 'Orchard', 'Dhoby Ghaut', 'Serangoon'):
    matches = [s for s in stops if needle.lower() in (s.get('stop_name') or '').lower()]
    print(f'=== stops matching "{needle}" ({len(matches)}) ===')
    for s in matches[:8]:
        print('  ', {k: s.get(k) for k in ('stop_id','stop_name','stop_lat','stop_lon','location_type','parent_station')})

print('=== has pathways.txt ===', os.path.exists('pathways.txt'))
print('=== has transfers.txt ===', os.path.exists('transfers.txt'))
if os.path.exists('calendar.txt'):
    with open('calendar.txt', newline='', encoding='utf-8-sig') as f:
        cal = list(csv.DictReader(f))
    print('=== calendar.txt rows ===', cal)
PYEOF
python3 inspect.py
echo '=== DIAGNOSTIC DONE, ABORTING BUILD ON PURPOSE ==='
exit 1
SCRIPT
# --- END TEMP DIAGNOSTIC -----------------------------------------------------

RUN java -Xmx7g -jar otp.jar --build --save /graph

FROM eclipse-temurin:21-jre

WORKDIR /graph
COPY --from=graphbuild /graph/graph.obj /graph/graph.obj
COPY --from=graphbuild /graph/otp.jar /graph/otp.jar
COPY router-config.json /graph/router-config.json

EXPOSE 8080

CMD ["java", "-Xmx4g", "-jar", "/graph/otp.jar", "--load", "--serve", "/graph"]
