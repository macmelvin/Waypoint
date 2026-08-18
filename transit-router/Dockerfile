# syntax=docker/dockerfile:1.4
# Transit router for Waypoint — OpenTripPlanner serving Singapore bus + MRT/LRT.
# Internal-only service: the main "waypoint" service proxies to this over
# Railway's private network, so nothing here needs a public domain.

FROM eclipse-temurin:21-jre AS graphbuild

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl osmium-tool python3 ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /graph

# OpenTripPlanner (needs Java 21; do not bump past 2.7.x without checking the
# required Java version — 2.9.x requires Java 25).
RUN curl -fsSL -o otp.jar \
    https://github.com/opentripplanner/OpenTripPlanner/releases/download/v2.7.0/otp-shaded-2.7.0.jar

# Singapore GTFS (bus + MRT/LRT), community-maintained from LTA DataMall data.
RUN curl -fsSL -o singapore-gtfs-raw.zip \
    "https://files.mobilitydatabase.org/mdb-3051/mdb-3051-202602171452/mdb-3051-202602171452.zip"

# The feed's MRT schedules silently skip most interchange stations (each
# line was generated in isolation), leaving the rail network chopped into
# stubs that never connect to each other. Reinsert them — see
# patch_rail_gtfs.py for the full explanation. Bus data is left untouched.
COPY patch_rail_gtfs.py /graph/
RUN python3 patch_rail_gtfs.py singapore-gtfs-raw.zip singapore-gtfs.zip && \
    rm singapore-gtfs-raw.zip

# --- TEMP DIAGNOSTIC ---------------------------------------------------------
# Verify the patch worked against the REAL feed (only tested against a tiny
# synthetic fixture locally) before spending ~10min on the full graph build.
# Remove this whole RUN block once confirmed.
RUN <<'SCRIPT'
set -e
cd /graph
python3 <<'PYEOF'
import csv, io, zipfile
from collections import defaultdict

with zipfile.ZipFile('singapore-gtfs.zip') as zf:
    def rd(name):
        with zf.open(name) as f:
            return list(csv.DictReader(io.TextIOWrapper(f, encoding='utf-8-sig')))
    stops = rd('stops.txt')
    trips = rd('trips.txt')
    stop_times = rd('stop_times.txt')

minted = [s for s in stops if s['stop_id'].startswith('SGX_')]
print('=== minted interchange/gap stop records ===', len(minted))
for s in sorted(minted, key=lambda s: s['stop_name']):
    print('  ', s['stop_id'], '|', s['stop_name'], '|', s['stop_lat'], s['stop_lon'])

route_by_trip = {t['trip_id']: t['route_id'] for t in trips}
lines_using = defaultdict(set)
for st in stop_times:
    sid = st['stop_id']
    if sid.startswith('SGX_'):
        route = route_by_trip.get(st['trip_id'])
        lines_using[sid].add(route)
print('=== which lines now stop at each minted station ===')
for sid, routes in sorted(lines_using.items()):
    print('  ', sid, '->', sorted(routes))

for needle in ('Punggol', 'Orchard', 'Dhoby Ghaut'):
    matches = [s for s in minted if needle.lower() in s['stop_name'].lower()]
    print(f'=== minted matching "{needle}" ===', [(m['stop_id'], m['stop_lat'], m['stop_lon']) for m in matches])

rail_stop_ids = {st['stop_id'] for st in stop_times if route_by_trip.get(st['trip_id']) in
                  ('NS','EW','NE','CC','DT','TE')}
print('=== total distinct rail stop_ids used now (was 110 before patch) ===', len(rail_stop_ids))
PYEOF
echo '=== DIAGNOSTIC DONE, ABORTING BUILD ON PURPOSE ==='
exit 1
SCRIPT
# --- END TEMP DIAGNOSTIC -----------------------------------------------------

# Street network for walk/transfer legs: Geofabrik's Malaysia/Singapore/Brunei
# extract, clipped down to just Singapore (+ a small border buffer) so the
# graph build stays fast and light.
RUN curl -fsSL -o mysgbn.osm.pbf \
    https://download.geofabrik.de/asia/malaysia-singapore-brunei-latest.osm.pbf && \
    osmium extract -b 103.55,1.13,104.13,1.485 mysgbn.osm.pbf -o singapore.osm.pbf --overwrite && \
    rm mysgbn.osm.pbf

COPY build-config.json router-config.json /graph/

RUN java -Xmx7g -jar otp.jar --build --save /graph

FROM eclipse-temurin:21-jre

WORKDIR /graph
COPY --from=graphbuild /graph/graph.obj /graph/graph.obj
COPY --from=graphbuild /graph/otp.jar /graph/otp.jar
COPY router-config.json /graph/router-config.json

EXPOSE 8080

CMD ["java", "-Xmx4g", "-jar", "/graph/otp.jar", "--load", "--serve", "/graph"]
