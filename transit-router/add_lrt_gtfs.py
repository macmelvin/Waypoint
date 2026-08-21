#!/usr/bin/env python3
"""
Adds the 3 LRT lines (Bukit Panjang / Sengkang / Punggol) to the community
Singapore GTFS feed as brand-new, headway-based (frequencies.txt) service.

Confirmed via direct inspection of the built OpenTripPlanner graph
(2026-08-20): the raw feed (mdb-3051) has ZERO LRT routes at all — not
routes-with-no-trips like the MRT interchange gaps patch_rail_gtfs.py fixes,
but nothing in routes.txt/trips.txt/stop_times.txt for any of the 3 LRT
lines. There's nothing to "patch" — this script synthesizes real GTFS
service from scratch:

  - Canonical station order per line/loop is hardcoded below (real-world
    LRT topology: Bukit Panjang is a loop-off-a-trunk with two directional
    services; Sengkang and Punggol are each two independent loops off a
    shared MRT-interchange station). Sourced from Land Transport Guru /
    Wikipedia / SGTrains, cross-checked against multiple sources.
  - Station coordinates are hardcoded from OneMap's official station
    dataset (github.com/xkjyeah/MRT-and-LRT-Stations, mrt_lrt.csv) rather
    than name-matched against bus stops — LRT station names are short/
    generic ("Segar", "Layar") and a fuzzy match risks a wrong hit, so
    real surveyed coordinates are used directly instead.
  - Bukit Panjang's two loop interchange points (Choa Chu Kang, Bukit
    Panjang) get their OWN new stop record at the LRT platform's actual
    coordinates (distinct from the MRT platform a short walk away) rather
    than reusing the MRT stop_id — this matches reality (a real, if short,
    concourse walk) and lets OTP compute that transfer via the OSM street
    graph like any other walk transfer.
  - Sengkang and Punggol are single unified station complexes shared by
    MRT and LRT (no separate LRT-platform coordinate exists in the OneMap
    dataset), so their LRT loops directly reuse the existing NE16/NE17 MRT
    stop_id for a free, zero-distance transfer — this matches reality too.
  - No literal timetable exists for these lines in the source data (or, per
    the finding above, anywhere), so service is expressed the standard GTFS
    way for headway-run systems: one representative round-trip pattern per
    direction in trips.txt/stop_times.txt (times are elapsed-offset, not
    clock time), expanded into real departures via frequencies.txt bands
    that roughly track published peak/off-peak service. This is materially
    less precise than a real timetable, but LRT headways are short enough
    (4-7 min modelled here) that it's accurate enough for trip planning.

Usage: python3 add_lrt_gtfs.py <input.zip> <output.zip>
"""
import csv
import io
import sys
import zipfile

# --- Real station coordinates (OneMap, via github.com/xkjyeah/MRT-and-LRT-Stations) ---
# name -> (lat, lon)
STATION_COORDS = {
    "Choa Chu Kang LRT": (1.38475541073, 103.744537697),
    "Bukit Panjang LRT": (1.37792612944, 103.763103024),
    "South View": (1.38029828722, 103.7452918),
    "Keat Hong": (1.37860276598, 103.749055519),
    "Teck Whye": (1.37668467944, 103.753712232),
    "Phoenix": (1.37861884445, 103.758034099),
    "Petir": (1.37775033382, 103.76666896),
    "Pending": (1.3761357435, 103.771261176),
    "Bangkit": (1.38002223, 103.772647371),
    "Fajar": (1.38452079708, 103.770808583),
    "Segar": (1.38777213086, 103.769598397),
    "Jelapang": (1.38670302501, 103.764503338),
    "Senja": (1.38269229582, 103.762367226),
    "Compassvale": (1.3944930462, 103.900492451),
    "Rumbia": (1.39146849684, 103.905973595),
    "Bakau": (1.38799293427, 103.905413992),
    "Kangkar": (1.38395911467, 103.902225371),
    "Ranggung": (1.38423356067, 103.89719467),
    "Cheng Lim": (1.39627763134, 103.893797181),
    "Farmway": (1.39717019646, 103.88930481),
    "Kupang": (1.3982128284, 103.881256222),
    "Thanggam": (1.3973181559, 103.875635156),
    "Fernvale": (1.39188588774, 103.876308611),
    "Layar": (1.39207983877, 103.880029601),
    "Tongkang": (1.38934795386, 103.88584415),
    "Renjong": (1.38672392153, 103.890539427),
    "Cove": (1.39928198502, 103.905961944),
    "Meridian": (1.39691205306, 103.908950217),
    "Coral Edge": (1.39390922612, 103.912580855),
    "Riviera": (1.39452449577, 103.916166059),
    "Kadaloor": (1.39950911282, 103.916574965),
    "Oasis": (1.40228667749, 103.912727356),
    "Damai": (1.40523483617, 103.908603544),
    "Sam Kee": (1.40961268509, 103.904831551),
    "Teck Lee": (1.41277089386, 103.906577623),
    "Punggol Point": (1.4168485205, 103.90665079),
    "Samudera": (1.41590171944, 103.902156316),
    "Nibong": (1.41187045845, 103.900313818),
    "Sumang": (1.40845242565, 103.898558454),
    "Soo Teck": (1.40508858485, 103.89720965),
}

# Fallback coords for the shared-interchange reuse points, only used if this
# script can't find the expected stop_id already in the feed (belt and
# braces — should not normally trigger).
FALLBACK_INTERCHANGE_COORDS = {
    ("NE", "sengkang"): (1.3916946261, 103.895484694),   # Sengkang MRT (OneMap)
    ("NE", "punggol"): (1.40454672779, 103.902072638),   # Punggol MRT (OneMap)
}

# code -> (stop_name, coord key into STATION_COORDS, or None if it reuses an
# existing MRT stop_id looked up at runtime instead)
BP_LOOP = [  # via Senja direction (Service A); trunk stations reused going both ways
    ("BP1", "Choa Chu Kang", "Choa Chu Kang LRT"),
    ("BP2", "South View", "South View"),
    ("BP3", "Keat Hong", "Keat Hong"),
    ("BP4", "Teck Whye", "Teck Whye"),
    ("BP5", "Phoenix", "Phoenix"),
    ("BP6", "Bukit Panjang", "Bukit Panjang LRT"),
]
BP_LOOP_VIA_SENJA = ["Senja", "Jelapang", "Segar", "Fajar", "Bangkit", "Pending", "Petir"]
BP_LOOP_VIA_PETIR = list(reversed(BP_LOOP_VIA_SENJA))

SE_LOOP = ["Compassvale", "Rumbia", "Bakau", "Kangkar", "Ranggung"]
SW_LOOP = ["Cheng Lim", "Farmway", "Kupang", "Thanggam", "Fernvale", "Layar", "Tongkang", "Renjong"]
PE_LOOP = ["Cove", "Meridian", "Coral Edge", "Riviera", "Kadaloor", "Oasis", "Damai"]
PW_LOOP = ["Sam Kee", "Teck Lee", "Punggol Point", "Samudera", "Nibong", "Sumang", "Soo Teck"]

# Approx running time between adjacent LRT stations. Real hops are short
# (~500-800m); this is deliberately a flat estimate, not a per-hop distance
# calc, since exact-minute precision isn't the point here.
HOP_SECONDS = 90

# (start_time, end_time, headway_secs) — repeated for every LRT trip_id.
# Loosely tracks published peak/off-peak service; end_time can exceed 24:00
# per GTFS convention for post-midnight service on the same operating day.
FREQUENCY_BANDS = [
    ("05:30:00", "07:00:00", 360),
    ("07:00:00", "09:30:00", 240),
    ("09:30:00", "17:00:00", 360),
    ("17:00:00", "20:00:00", 240),
    ("20:00:00", "24:40:00", 420),
]

ROUTE_META = {
    "BP": {"long_name": "Bukit Panjang LRT", "color": "748477", "text_color": "FFFFFF"},
    "SE": {"long_name": "Sengkang LRT (East Loop)", "color": "748477", "text_color": "FFFFFF"},
    "SW": {"long_name": "Sengkang LRT (West Loop)", "color": "748477", "text_color": "FFFFFF"},
    "PE": {"long_name": "Punggol LRT (East Loop)", "color": "748477", "text_color": "FFFFFF"},
    "PW": {"long_name": "Punggol LRT (West Loop)", "color": "748477", "text_color": "FFFFFF"},
}

SERVICE_ID = "SGX_LRT_DAILY"


def read_csv(zf, name):
    with zf.open(name) as f:
        text = io.TextIOWrapper(f, encoding="utf-8-sig", newline="")
        return list(csv.DictReader(text))


def write_csv(zf, name, fieldnames, rows):
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    zf.writestr(name, buf.getvalue())


def seconds_to_hms(total):
    total = int(round(total))
    h = total // 3600
    m = (total % 3600) // 60
    s = total % 60
    return f"{h:02d}:{m:02d}:{s:02d}"


def haversine_meters(lat1, lon1, lat2, lon2):
    import math
    r = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.asin(min(1, math.sqrt(a)))


def main():
    if len(sys.argv) != 3:
        print("Usage: add_lrt_gtfs.py <input.zip> <output.zip>")
        sys.exit(1)
    in_path, out_path = sys.argv[1], sys.argv[2]

    with zipfile.ZipFile(in_path) as zf:
        names = zf.namelist()
        stops = read_csv(zf, "stops.txt")
        routes = read_csv(zf, "routes.txt")
        trips = read_csv(zf, "trips.txt")
        stop_times = read_csv(zf, "stop_times.txt")
        calendar = read_csv(zf, "calendar.txt") if "calendar.txt" in names else []
        frequencies = read_csv(zf, "frequencies.txt") if "frequencies.txt" in names else []
        shapes = read_csv(zf, "shapes.txt") if "shapes.txt" in names else []
        other_names = [
            n for n in names
            if n not in ("stops.txt", "routes.txt", "trips.txt", "stop_times.txt",
                          "calendar.txt", "frequencies.txt", "shapes.txt")
        ]
        other_files = {n: zf.read(n) for n in other_names}

    stops_by_id = {s["stop_id"]: s for s in stops}

    def resolve_shared_stop(code, key, name):
        """Sengkang/Punggol: reuse the existing NE-line stop_id if present
        (either the raw literal code, or the SGX_ id patch_rail_gtfs.py
        mints if that station happened to be one of the dropped
        interchanges) — falls back to minting our own stop only if neither
        is found, which shouldn't normally happen."""
        if code in stops_by_id:
            return code
        sgx_id = f"SGX_{key.upper()}"
        if sgx_id in stops_by_id:
            return sgx_id
        # Fallback: mint it ourselves from OneMap's MRT coordinate.
        lat, lon = FALLBACK_INTERCHANGE_COORDS[("NE", key)]
        new_id = f"SGX_LRT_{key.upper()}"
        if new_id not in stops_by_id:
            stops.append({
                "stop_id": new_id,
                "stop_name": name,
                "stop_lat": f"{lat:.6f}",
                "stop_lon": f"{lon:.6f}",
                "location_type": "0",
                "parent_station": "",
            })
            stops_by_id[new_id] = stops[-1]
        return new_id

    minted_ids = {}  # station name -> stop_id, for STATION_COORDS entries

    def mint_stop(name):
        if name in minted_ids:
            return minted_ids[name]
        lat, lon = STATION_COORDS[name]
        stop_id = f"SGX_LRT_{name.upper().replace(' ', '_')}"
        stops.append({
            "stop_id": stop_id,
            "stop_name": f"{name} LRT",
            "stop_lat": f"{lat:.6f}",
            "stop_lon": f"{lon:.6f}",
            "location_type": "0",
            "parent_station": "",
        })
        stops_by_id[stop_id] = stops[-1]
        minted_ids[name] = stop_id
        return stop_id

    sengkang_id = resolve_shared_stop("NE16", "sengkang", "Sengkang")
    punggol_id = resolve_shared_stop("NE17", "punggol", "Punggol")
    cck_lrt_id = mint_stop("Choa Chu Kang LRT")
    bp_lrt_id = mint_stop("Bukit Panjang LRT")

    new_routes = []
    new_trips = []
    new_stop_times = []
    new_frequencies = list(frequencies)
    new_shapes = list(shapes)

    # The raw feed already uses short 2-letter route_ids for its own (non-LRT)
    # routes in places — confirmed the hard way: a private-operator route
    # already exists with route_id "BP" (agency "GAS"), and OTP hard-fails on
    # any duplicate route_id. So the *internal* route_id is namespaced
    # ("SGX_LRT_BP"), while route_short_name stays the clean "BP" the app
    # already keys its line badges/colors off of — those are independent
    # GTFS fields. Trip IDs get the same namespacing as a precaution, since
    # this feed has already shown its short-code IDs aren't as empty a
    # namespace as they looked from the outside.
    def add_route(short_code):
        meta = ROUTE_META[short_code]
        route_id = f"SGX_LRT_{short_code}"
        new_routes.append({
            "route_id": route_id,
            "agency_id": (routes[0].get("agency_id", "") if routes else ""),
            "route_short_name": short_code,
            "route_long_name": meta["long_name"],
            "route_type": "0",  # tram/light rail
            "route_color": meta["color"],
            "route_text_color": meta["text_color"],
        })
        return route_id

    def add_trip(route_id, trip_code, headsign, stop_sequence):
        """stop_sequence: list of stop_id, in order (a real physical LRT
        stop_id can repeat, e.g. Bukit Panjang appears twice on one BP
        loop-trip — that's correct, matches the real service).

        Explicitly generates shapes.txt (straight lines between consecutive
        stops) and shape_dist_traveled on every stop_times row. Frequency-
        based trips with no shape and no shape_dist_traveled apparently hit
        a real bug in this OTP version's distance computation — confirmed
        live: a query that had no viable non-LRT alternative (forcing OTP to
        actually consider one of these trips) crashed the whole /plan
        response with a "distanceMeters" DataFetchingException, while
        queries with a good bus alternative just silently produced zero LRT
        candidates instead of crashing. Giving OTP explicit geometry and
        cumulative distance removes the ambiguity/fallback path entirely."""
        trip_id = f"SGX_LRT_{trip_code}"
        shape_id = f"SGX_LRT_SHAPE_{trip_code}"
        new_trips.append({
            "route_id": route_id,
            "service_id": SERVICE_ID,
            "trip_id": trip_id,
            "trip_headsign": headsign,
            "direction_id": "0",
            "shape_id": shape_id,
        })
        t = 0
        dist = 0.0
        prev_latlon = None
        for seq, stop_id in enumerate(stop_sequence, start=1):
            stop_row = stops_by_id[stop_id]
            lat, lon = float(stop_row["stop_lat"]), float(stop_row["stop_lon"])
            if prev_latlon is not None:
                dist += haversine_meters(prev_latlon[0], prev_latlon[1], lat, lon)
            prev_latlon = (lat, lon)
            new_shapes.append({
                "shape_id": shape_id,
                "shape_pt_lat": f"{lat:.6f}",
                "shape_pt_lon": f"{lon:.6f}",
                "shape_pt_sequence": str(seq),
                "shape_dist_traveled": f"{dist:.1f}",
            })
            new_stop_times.append({
                "trip_id": trip_id,
                "arrival_time": seconds_to_hms(t),
                "departure_time": seconds_to_hms(t),
                "stop_id": stop_id,
                "stop_sequence": str(seq),
                "shape_dist_traveled": f"{dist:.1f}",
            })
            t += HOP_SECONDS
        for start, end, headway in FREQUENCY_BANDS:
            new_frequencies.append({
                "trip_id": trip_id,
                "start_time": start,
                "end_time": end,
                "headway_secs": str(headway),
                "exact_times": "0",
            })

    # --- Bukit Panjang: trunk + loop, two directional patterns ---
    bp_route_id = add_route("BP")
    trunk_ids = [cck_lrt_id, mint_stop("South View"), mint_stop("Keat Hong"),
                 mint_stop("Teck Whye"), mint_stop("Phoenix"), bp_lrt_id]
    for label, loop_names in (("A", BP_LOOP_VIA_SENJA), ("B", BP_LOOP_VIA_PETIR)):
        loop_ids = [mint_stop(n) for n in loop_names]
        sequence = trunk_ids + loop_ids + [bp_lrt_id] + list(reversed(trunk_ids[:-1]))
        add_trip(bp_route_id, f"BP-{label}", f"Bukit Panjang LRT (Service {label})", sequence)

    # --- Sengkang / Punggol: independent loops off a shared MRT stop ---
    def add_loop_route(short_code, hub_id, loop_names):
        route_id = add_route(short_code)
        loop_ids = [mint_stop(n) for n in loop_names]
        add_trip(route_id, f"{short_code}-CW", f"{short_code} Loop via {loop_names[0]}",
                  [hub_id] + loop_ids + [hub_id])
        add_trip(route_id, f"{short_code}-CCW", f"{short_code} Loop via {loop_names[-1]}",
                  [hub_id] + list(reversed(loop_ids)) + [hub_id])

    add_loop_route("SE", sengkang_id, SE_LOOP)
    add_loop_route("SW", sengkang_id, SW_LOOP)
    add_loop_route("PE", punggol_id, PE_LOOP)
    add_loop_route("PW", punggol_id, PW_LOOP)

    calendar_out = calendar + [{
        "service_id": SERVICE_ID,
        "monday": "1", "tuesday": "1", "wednesday": "1", "thursday": "1",
        "friday": "1", "saturday": "1", "sunday": "1",
        "start_date": "20200101", "end_date": "20301231",
    }]

    routes_out = routes + new_routes
    trips_out = trips + new_trips
    stop_times_out = stop_times + new_stop_times

    routes_fieldnames = list(routes[0].keys()) if routes else list(new_routes[0].keys())
    for extra in ("route_color", "route_text_color"):
        if extra not in routes_fieldnames:
            routes_fieldnames.append(extra)
    trips_fieldnames = list(trips[0].keys()) if trips else list(new_trips[0].keys())
    for extra in ("trip_headsign", "direction_id", "shape_id"):
        if extra not in trips_fieldnames:
            trips_fieldnames.append(extra)
    st_fieldnames = ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence",
                      "shape_dist_traveled"]
    stops_fieldnames = ["stop_id", "stop_name", "stop_lat", "stop_lon", "location_type", "parent_station"]
    calendar_fieldnames = (list(calendar[0].keys()) if calendar else
                            ["service_id", "monday", "tuesday", "wednesday", "thursday",
                             "friday", "saturday", "sunday", "start_date", "end_date"])
    frequencies_fieldnames = ["trip_id", "start_time", "end_time", "headway_secs", "exact_times"]
    shapes_fieldnames = ["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence",
                          "shape_dist_traveled"]

    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        write_csv(zf, "stops.txt", stops_fieldnames, stops)
        write_csv(zf, "routes.txt", routes_fieldnames, routes_out)
        write_csv(zf, "trips.txt", trips_fieldnames, trips_out)
        write_csv(zf, "stop_times.txt", st_fieldnames, stop_times_out)
        write_csv(zf, "calendar.txt", calendar_fieldnames, calendar_out)
        write_csv(zf, "frequencies.txt", frequencies_fieldnames, new_frequencies)
        write_csv(zf, "shapes.txt", shapes_fieldnames, new_shapes)
        for name, data in other_files.items():
            zf.writestr(name, data)

    print(f"Added {len(new_routes)} LRT routes, {len(new_trips)} trip patterns, "
          f"{len(minted_ids)} new LRT stops (plus reused existing MRT stops "
          f"{sengkang_id}/{punggol_id} as the Sengkang/Punggol interchange points).")
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
