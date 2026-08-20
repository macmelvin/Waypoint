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
RUN python3 patch_rail_gtfs.py singapore-gtfs-raw.zip singapore-gtfs-mrt.zip && \
    rm singapore-gtfs-raw.zip

# The feed has ZERO LRT service at all (Bukit Panjang / Sengkang / Punggol
# routes don't exist, not even as empty timetables) — see add_lrt_gtfs.py
# for the full explanation and sourcing. Synthesizes real GTFS service for
# all 3 lines from scratch (real station topology + coordinates, headway-
# based frequencies.txt) on top of the MRT-patched feed above.
COPY add_lrt_gtfs.py /graph/
RUN python3 add_lrt_gtfs.py singapore-gtfs-mrt.zip singapore-gtfs.zip && \
    rm singapore-gtfs-mrt.zip

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
