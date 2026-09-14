#!/usr/bin/env python3
"""
Adds the East-West Line's Changi Airport spur (Tanah Merah EW4 -> Expo CG1
-> Changi Airport CG2) to the GTFS feed as brand-new service.

Confirmed via direct inspection of the built OpenTripPlanner graph
(2026-09-14, after patch_rail_gtfs.py's terminus-extension fix landed):
every EW line pattern now runs the full trunk end-to-end, but the Changi
Airport spur was never part of that trunk to begin with -- it's a
structurally different gap than the truncations patch_rail_gtfs.py fixes.
No route, trip, or stop_times row anywhere in the raw feed references CG1
Expo or CG2 Changi Airport. There's no existing trip to extend; like the 3
LRT lines, this has to be synthesized from scratch (see add_lrt_gtfs.py,
which this follows the same shape as).

  - Modelled as its own shuttle service between Tanah Merah and Changi
    Airport via Expo, matching how it actually operates in reality (a
    same-platform/cross-platform transfer at Tanah Merah to/from the main
    EW trunk, not through-running trains) -- two new-to-this-graph
    stations plus one already-being-patched-in interchange, one new route,
    trips timed in both directions across the service day.
  - Tanah Merah and Expo are each resolved at runtime rather than assumed:
    neither has a native stop_id in the raw feed (confirmed via
    patch_rail_gtfs.py's own build-time "missing canonical stations"
    report), so patch_rail_gtfs.py -- which MUST run before this script --
    already minted synthetic stop_ids for both while patching the EW and
    DT trunks respectively. Reusing those exact ids (instead of, say,
    "EW4"/"DT35" literally) is what makes the transfer free: same
    physical stop_id patch_rail_gtfs.py already wired the EW trunk (Tanah
    Merah) and DT trunk (Expo) through. Changi Airport (CG2) has no other
    line and no existing stop at all, so it's minted fresh here, the same
    way add_lrt_gtfs.py mints brand-new LRT stations.
  - Changi Airport's coordinate is Wikipedia-sourced (station infobox),
    matching the sourcing already used for the interchange overrides in
    patch_rail_gtfs.py's STATION_COORD_OVERRIDES.
  - route_short_name "CG": the app's own line-name table (app.js's
    MRT_LINE_NAMES) already has an entry for this exact code ("East West
    Line (Changi Airport)"), and it's the code Singapore's own station
    signage uses for CG1/CG2 even though the branded rail line itself
    stays the same East-West green. route_color/route_text_color are
    copied from the feed's own real "EW" route entry so the line badge
    matches the actual line color instead of a guessed one. The internal
    route_id is namespaced ("SGX_CG") rather than the bare short code, on
    the same precaution add_lrt_gtfs.py already took after finding this
    feed's short route_ids aren't as free a namespace as they look (a
    private bus operator already owned route_id "BP" there).
  - Literal, individually-timed trips across the service day rather than
    frequencies.txt -- add_lrt_gtfs.py found frequencies.txt-expanded
    trips reliably crash OTP's /plan endpoint the moment a query has no
    viable non-branch alternative (a real risk here too: an itinerary to
    Changi Airport has no "just don't use this branch" fallback), so the
    same literal-trip approach is used pre-emptively rather than waiting
    to hit that bug live against actual airport-bound queries.
  - Running time (210s/hop) and headways are flat estimates matching real
    published schedules loosely (Tanah Merah -> Changi Airport is ~7 min
    across 2 hops in reality; shuttle frequency is roughly 4-10 min
    depending on time of day) -- exact-minute precision isn't the point,
    matching add_lrt_gtfs.py's own stated philosophy for its LRT timings.

Usage: python3 add_changi_airport_branch.py <input.zip> <output.zip>
"""
import csv
import io
import sys
import zipfile

# Wikipedia infobox coordinate for Changi Airport MRT station (CG2) -- see
# patch_rail_gtfs.py's STATION_COORD_OVERRIDES for the same sourcing
# approach used on other stations this feed can't locate on its own.
CHANGI_AIRPORT_COORD = (1.35750, 103.98833)

# Real Tanah Merah -> Changi Airport journey is ~7 minutes across the 2
# hops (Tanah Merah->Expo, Expo->Changi Airport) -- longer than a typical
# adjacent-MRT-station hop since this spur covers more ground than most.
HOP_SECONDS = 210

# (start_time, end_time, headway_secs) -- loosely tracks the real shuttle's
# published peak/off-peak frequency (~4-10 min); end_time can exceed 24:00
# per GTFS convention for post-midnight service on the same operating day.
FREQUENCY_BANDS = [
    ("05:30:00", "07:00:00", 480),
    ("07:00:00", "09:30:00", 360),
    ("09:30:00", "17:00:00", 480),
    ("17:00:00", "20:00:00", 360),
    ("20:00:00", "24:00:00", 600),
    ("24:00:00", "24:30:00", 900),
]

SERVICE_ID = "SGX_CG_DAILY"


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


def hms_to_seconds(s):
    h, m, sec = s.split(":")
    return int(h) * 3600 + int(m) * 60 + int(sec)


def seconds_to_hms(total):
    total = int(round(total))
    h = total // 3600
    m = (total % 3600) // 60
    s = total % 60
    return f"{h:02d}:{m:02d}:{s:02d}"


def main():
    if len(sys.argv) != 3:
        print("Usage: add_changi_airport_branch.py <input.zip> <output.zip>")
        sys.exit(1)
    in_path, out_path = sys.argv[1], sys.argv[2]

    with zipfile.ZipFile(in_path) as zf:
        names = zf.namelist()
        stops = read_csv(zf, "stops.txt")
        routes = read_csv(zf, "routes.txt")
        trips = read_csv(zf, "trips.txt")
        stop_times = read_csv(zf, "stop_times.txt")
        calendar = read_csv(zf, "calendar.txt") if "calendar.txt" in names else []
        other_names = [n for n in names if n not in
                        ("stops.txt", "routes.txt", "trips.txt", "stop_times.txt", "calendar.txt")]
        other_files = {n: zf.read(n) for n in other_names}

    stops_by_id = {s["stop_id"]: s for s in stops}

    def resolve_stop(native_code, key):
        """Find whichever stop_id patch_rail_gtfs.py actually ended up
        using for this station: its own native code if the raw feed had
        one, or the SGX_<key> id patch_rail_gtfs.py mints for a
        genuinely-missing station (the case for both Tanah Merah and Expo,
        confirmed via a live build -- neither has a native stop_id in this
        feed). Raises rather than silently minting a duplicate stop if
        neither is found: a duplicate would give this branch its own
        disconnected stop_id at the "same" station, recreating exactly the
        free-transfer failure this whole effort is trying to fix elsewhere,
        just somewhere new -- better to fail loudly at build time so it
        gets noticed instead of shipping a silently broken transfer."""
        if native_code in stops_by_id:
            return native_code
        sgx_id = f"SGX_{key.upper()}"
        if sgx_id in stops_by_id:
            return sgx_id
        raise RuntimeError(
            f"add_changi_airport_branch.py: can't find a stop_id for '{key}' "
            f"(tried '{native_code}' and '{sgx_id}') -- make sure "
            f"patch_rail_gtfs.py ran first and actually minted this "
            f"station (check its 'no coordinate match' warnings)."
        )

    tanah_merah_id = resolve_stop("EW4", "tanah_merah")
    expo_id = resolve_stop("DT35", "expo")

    changi_airport_id = "SGX_CHANGI_AIRPORT"
    if changi_airport_id not in stops_by_id:
        lat, lon = CHANGI_AIRPORT_COORD
        stops.append({
            "stop_id": changi_airport_id,
            "stop_name": "Changi Airport CG2",
            "stop_lat": f"{lat:.6f}",
            "stop_lon": f"{lon:.6f}",
            "location_type": "0",
            "parent_station": "",
        })
        stops_by_id[changi_airport_id] = stops[-1]

    # Copy the real EW route's own color so this branch's line badge
    # matches the actual East-West Line green instead of a guessed one.
    ew_route = next((r for r in routes if r.get("route_short_name") == "EW"), None)
    route_color = (ew_route or {}).get("route_color") or "009645"
    route_text_color = (ew_route or {}).get("route_text_color") or "FFFFFF"
    agency_id = routes[0].get("agency_id", "") if routes else ""

    route_id = "SGX_CG"
    routes.append({
        "route_id": route_id,
        "agency_id": agency_id,
        "route_short_name": "CG",
        "route_long_name": "East West Line (Changi Airport Branch)",
        "route_type": "1",
        "route_color": route_color,
        "route_text_color": route_text_color,
    })

    new_trips = []
    new_stop_times = []

    def add_direction(trip_code, direction_id, headsign, stop_sequence):
        trip_num = 0
        for start_hms, end_hms, headway in FREQUENCY_BANDS:
            start_s, end_s = hms_to_seconds(start_hms), hms_to_seconds(end_hms)
            dep = start_s
            while dep < end_s:
                trip_num += 1
                trip_id = f"SGX_CG_{trip_code}_{trip_num:04d}"
                new_trips.append({
                    "route_id": route_id,
                    "service_id": SERVICE_ID,
                    "trip_id": trip_id,
                    "trip_headsign": headsign,
                    "direction_id": direction_id,
                })
                t = dep
                for seq, stop_id in enumerate(stop_sequence, start=1):
                    new_stop_times.append({
                        "trip_id": trip_id,
                        "arrival_time": seconds_to_hms(t),
                        "departure_time": seconds_to_hms(t),
                        "stop_id": stop_id,
                        "stop_sequence": str(seq),
                    })
                    t += HOP_SECONDS
                dep += headway
        return trip_num

    n_out = add_direction("OUT", "0", "To Changi Airport", [tanah_merah_id, expo_id, changi_airport_id])
    n_in = add_direction("IN", "1", "To Tanah Merah", [changi_airport_id, expo_id, tanah_merah_id])

    calendar_out = calendar + [{
        "service_id": SERVICE_ID,
        "monday": "1", "tuesday": "1", "wednesday": "1", "thursday": "1",
        "friday": "1", "saturday": "1", "sunday": "1",
        "start_date": "20200101", "end_date": "20301231",
    }]

    trips_out = trips + new_trips
    stop_times_out = stop_times + new_stop_times

    stops_fieldnames = ["stop_id", "stop_name", "stop_lat", "stop_lon", "location_type", "parent_station"]
    routes_fieldnames = list(routes[0].keys()) if routes else list(routes[-1].keys())
    for extra in ("route_color", "route_text_color"):
        if extra not in routes_fieldnames:
            routes_fieldnames.append(extra)
    trips_fieldnames = list(trips[0].keys()) if trips else list(new_trips[0].keys())
    for extra in ("trip_headsign", "direction_id"):
        if extra not in trips_fieldnames:
            trips_fieldnames.append(extra)
    st_fieldnames = ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"]
    calendar_fieldnames = (list(calendar[0].keys()) if calendar else
                            ["service_id", "monday", "tuesday", "wednesday", "thursday",
                             "friday", "saturday", "sunday", "start_date", "end_date"])

    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        write_csv(zf, "stops.txt", stops_fieldnames, stops)
        write_csv(zf, "routes.txt", routes_fieldnames, routes)
        write_csv(zf, "trips.txt", trips_fieldnames, trips_out)
        write_csv(zf, "stop_times.txt", st_fieldnames, stop_times_out)
        write_csv(zf, "calendar.txt", calendar_fieldnames, calendar_out)
        for name, data in other_files.items():
            zf.writestr(name, data)

    print(f"Added Changi Airport branch: route {route_id} ({n_out} outbound + {n_in} inbound trips), "
          f"1 new stop (Changi Airport). Tanah Merah resolved to '{tanah_merah_id}', "
          f"Expo resolved to '{expo_id}'.")
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
