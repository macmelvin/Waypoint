#!/usr/bin/env python3
"""
Patches the community Singapore GTFS feed's MRT schedules.

The feed (mdb-3051) has real, well-formed rail routes/trips/stop_times for
all 6 MRT lines, but each line's trip schedules silently skip most of their
interchange stations (confirmed: North-South Line is missing 11 of its 27
stations, and 10 of those are interchanges with another line). The result is
a rail network chopped into disconnected stubs that can't hand off to each
other, so the router falls back to bus-only itineraries for almost every
real trip.

This script reinserts the missing stations into each line's existing trips:
  - Canonical station order per line is hardcoded below (from known MRT
    topology), only station *names* and interchange linkage — no
    coordinates are hardcoded.
  - Coordinates for newly-inserted stations are looked up by matching
    station names against the feed's bus stop data (e.g. "Dhoby Ghaut Stn
    Exit B"), which is accurate and already present in the feed. This
    avoids relying on hand-typed coordinates for ~30 stations.
  - Arrival/departure times for inserted stops are linearly interpolated
    between the nearest real stops that already exist in that specific
    trip, so trips that don't run the full line (short workings) are left
    alone rather than corrupted.
  - Bus data (routes, trips, stop_times, stops) is left completely
    untouched; only the 6 MRT routes' trips are modified, and 3 LRT routes
    (Bukit Panjang / Sengkang / Punggol) are left as-is since they have no
    existing schedule to patch (out of scope for this pass).

Usage: python3 patch_rail_gtfs.py <input.zip> <output.zip>
"""
import csv
import io
import sys
import zipfile
from collections import defaultdict

# --- Canonical MRT line topology --------------------------------------------
# (code, key, display name). `key` is shared across lines at real
# interchanges so they resolve to the SAME synthetic stop_id.
LINES = {
    "NS": [
        ("NS1", "jurong_east", "Jurong East"),
        ("NS2", "bukit_batok", "Bukit Batok"),
        ("NS3", "bukit_gombak", "Bukit Gombak"),
        ("NS4", "choa_chu_kang", "Choa Chu Kang"),
        ("NS5", "yew_tee", "Yew Tee"),
        ("NS7", "kranji", "Kranji"),
        ("NS8", "marsiling", "Marsiling"),
        ("NS9", "woodlands", "Woodlands"),
        ("NS10", "admiralty", "Admiralty"),
        ("NS11", "sembawang", "Sembawang"),
        ("NS12", "canberra", "Canberra"),
        ("NS13", "yishun", "Yishun"),
        ("NS14", "khatib", "Khatib"),
        ("NS15", "yio_chu_kang", "Yio Chu Kang"),
        ("NS16", "ang_mo_kio", "Ang Mo Kio"),
        ("NS17", "bishan", "Bishan"),
        ("NS18", "braddell", "Braddell"),
        ("NS19", "toa_payoh", "Toa Payoh"),
        ("NS20", "novena", "Novena"),
        ("NS21", "newton", "Newton"),
        ("NS22", "orchard", "Orchard"),
        ("NS23", "somerset", "Somerset"),
        ("NS24", "dhoby_ghaut", "Dhoby Ghaut"),
        ("NS25", "city_hall", "City Hall"),
        ("NS26", "raffles_place", "Raffles Place"),
        ("NS27", "marina_bay", "Marina Bay"),
        ("NS28", "marina_south_pier", "Marina South Pier"),
    ],
    "EW": [
        ("EW1", "pasir_ris", "Pasir Ris"),
        ("EW2", "tampines", "Tampines"),
        ("EW3", "simei", "Simei"),
        ("EW4", "tanah_merah", "Tanah Merah"),
        ("EW5", "bedok", "Bedok"),
        ("EW6", "kembangan", "Kembangan"),
        ("EW7", "eunos", "Eunos"),
        ("EW8", "paya_lebar", "Paya Lebar"),
        ("EW9", "aljunied", "Aljunied"),
        ("EW10", "kallang", "Kallang"),
        ("EW11", "lavender", "Lavender"),
        ("EW12", "bugis", "Bugis"),
        ("EW13", "city_hall", "City Hall"),
        ("EW14", "raffles_place", "Raffles Place"),
        ("EW15", "tanjong_pagar", "Tanjong Pagar"),
        ("EW16", "outram_park", "Outram Park"),
        ("EW17", "tiong_bahru", "Tiong Bahru"),
        ("EW18", "redhill", "Redhill"),
        ("EW19", "queenstown", "Queenstown"),
        ("EW20", "commonwealth", "Commonwealth"),
        ("EW21", "buona_vista", "Buona Vista"),
        ("EW22", "dover", "Dover"),
        ("EW23", "clementi", "Clementi"),
        ("EW24", "jurong_east", "Jurong East"),
        ("EW25", "chinese_garden", "Chinese Garden"),
        ("EW26", "lakeside", "Lakeside"),
        ("EW27", "boon_lay", "Boon Lay"),
        ("EW28", "pioneer", "Pioneer"),
        ("EW29", "joo_koon", "Joo Koon"),
        ("EW30", "gul_circle", "Gul Circle"),
        ("EW31", "tuas_crescent", "Tuas Crescent"),
        ("EW32", "tuas_west_road", "Tuas West Road"),
        ("EW33", "tuas_link", "Tuas Link"),
    ],
    "NE": [
        ("NE1", "harbourfront", "HarbourFront"),
        ("NE3", "outram_park", "Outram Park"),
        ("NE4", "chinatown", "Chinatown"),
        ("NE5", "clarke_quay", "Clarke Quay"),
        ("NE6", "dhoby_ghaut", "Dhoby Ghaut"),
        ("NE7", "little_india", "Little India"),
        ("NE8", "farrer_park", "Farrer Park"),
        ("NE9", "boon_keng", "Boon Keng"),
        ("NE10", "potong_pasir", "Potong Pasir"),
        ("NE11", "woodleigh", "Woodleigh"),
        ("NE12", "serangoon", "Serangoon"),
        ("NE13", "kovan", "Kovan"),
        ("NE14", "hougang", "Hougang"),
        ("NE15", "buangkok", "Buangkok"),
        ("NE16", "sengkang", "Sengkang"),
        ("NE17", "punggol", "Punggol"),
        ("NE18", "punggol_coast", "Punggol Coast"),
    ],
    "CC": [
        ("CC1", "dhoby_ghaut", "Dhoby Ghaut"),
        ("CC2", "bras_basah", "Bras Basah"),
        ("CC3", "esplanade", "Esplanade"),
        ("CC4", "promenade", "Promenade"),
        ("CC5", "nicoll_highway", "Nicoll Highway"),
        ("CC6", "stadium", "Stadium"),
        ("CC7", "mountbatten", "Mountbatten"),
        ("CC8", "dakota", "Dakota"),
        ("CC9", "paya_lebar", "Paya Lebar"),
        ("CC10", "macpherson", "MacPherson"),
        ("CC11", "tai_seng", "Tai Seng"),
        ("CC12", "bartley", "Bartley"),
        ("CC13", "serangoon", "Serangoon"),
        ("CC14", "lorong_chuan", "Lorong Chuan"),
        ("CC15", "bishan", "Bishan"),
        ("CC16", "marymount", "Marymount"),
        ("CC17", "caldecott", "Caldecott"),
        ("CC19", "botanic_gardens", "Botanic Gardens"),
        ("CC20", "farrer_road", "Farrer Road"),
        ("CC21", "holland_village", "Holland Village"),
        ("CC22", "buona_vista", "Buona Vista"),
        ("CC23", "one_north", "one-north"),
        ("CC24", "kent_ridge", "Kent Ridge"),
        ("CC25", "haw_par_villa", "Haw Par Villa"),
        ("CC26", "pasir_panjang", "Pasir Panjang"),
        ("CC27", "labrador_park", "Labrador Park"),
        ("CC28", "telok_blangah", "Telok Blangah"),
        ("CC29", "harbourfront", "HarbourFront"),
    ],
    "DT": [
        ("DT1", "bukit_panjang", "Bukit Panjang"),
        ("DT2", "cashew", "Cashew"),
        ("DT3", "hillview", "Hillview"),
        ("DT4", "hume", "Hume"),
        ("DT5", "beauty_world", "Beauty World"),
        ("DT6", "king_albert_park", "King Albert Park"),
        ("DT7", "sixth_avenue", "Sixth Avenue"),
        ("DT8", "tan_kah_kee", "Tan Kah Kee"),
        ("DT9", "botanic_gardens", "Botanic Gardens"),
        ("DT10", "stevens", "Stevens"),
        ("DT11", "newton", "Newton"),
        ("DT12", "little_india", "Little India"),
        ("DT13", "rochor", "Rochor"),
        ("DT14", "bugis", "Bugis"),
        ("DT15", "promenade", "Promenade"),
        ("DT16", "bayfront", "Bayfront"),
        ("DT17", "downtown", "Downtown"),
        ("DT18", "telok_ayer", "Telok Ayer"),
        ("DT19", "chinatown", "Chinatown"),
        ("DT20", "fort_canning", "Fort Canning"),
        ("DT21", "bencoolen", "Bencoolen"),
        ("DT22", "jalan_besar", "Jalan Besar"),
        ("DT23", "bendemeer", "Bendemeer"),
        ("DT24", "geylang_bahru", "Geylang Bahru"),
        ("DT25", "mattar", "Mattar"),
        ("DT26", "macpherson", "MacPherson"),
        ("DT27", "ubi", "Ubi"),
        ("DT28", "kaki_bukit", "Kaki Bukit"),
        ("DT29", "bedok_north", "Bedok North"),
        ("DT30", "bedok_reservoir", "Bedok Reservoir"),
        ("DT31", "tampines_west", "Tampines West"),
        ("DT32", "tampines", "Tampines"),
        ("DT33", "tampines_east", "Tampines East"),
        ("DT34", "upper_changi", "Upper Changi"),
        ("DT35", "expo", "Expo"),
    ],
    "TE": [
        ("TE1", "woodlands_north", "Woodlands North"),
        ("TE2", "woodlands", "Woodlands"),
        ("TE3", "woodlands_south", "Woodlands South"),
        ("TE4", "springleaf", "Springleaf"),
        ("TE5", "lentor", "Lentor"),
        ("TE6", "mayflower", "Mayflower"),
        ("TE7", "bright_hill", "Bright Hill"),
        ("TE8", "upper_thomson", "Upper Thomson"),
        ("TE9", "caldecott", "Caldecott"),
        ("TE11", "stevens", "Stevens"),
        ("TE12", "napier", "Napier"),
        ("TE13", "orchard_boulevard", "Orchard Boulevard"),
        ("TE14", "orchard", "Orchard"),
        ("TE15", "great_world", "Great World"),
        ("TE16", "havelock", "Havelock"),
        ("TE17", "outram_park", "Outram Park"),
        ("TE18", "maxwell", "Maxwell"),
        ("TE19", "shenton_way", "Shenton Way"),
        ("TE20", "marina_bay", "Marina Bay"),
        ("TE22", "gardens_by_the_bay", "Gardens by the Bay"),
        ("TE23", "tanjong_rhu", "Tanjong Rhu"),
        ("TE24", "katong_park", "Katong Park"),
        ("TE25", "tanjong_katong", "Tanjong Katong"),
        ("TE26", "marine_parade", "Marine Parade"),
        ("TE27", "marine_terrace", "Marine Terrace"),
        ("TE28", "siglap", "Siglap"),
        ("TE29", "bayshore", "Bayshore"),
    ],
}


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


ABBREVIATIONS = {
    "bukit": "bt",
    "jalan": "jln",
    "taman": "tmn",
    "kampung": "kg",
    "sungei": "sg",
    "lorong": "lor",
}


def _name_variants(name):
    needle = name.lower()
    variants = {needle}
    words = needle.split(" ")
    abbrev_words = [ABBREVIATIONS.get(w, w) for w in words]
    if abbrev_words != words:
        variants.add(" ".join(abbrev_words))
    return variants


def find_station_coords(all_stops, name):
    """Look up real coordinates for `name` by matching it against the feed's
    (accurate) bus stop names, e.g. 'Dhoby Ghaut' -> 'Dhoby Ghaut Stn Exit B'.
    Tries common Singapore bus-stop abbreviations (Bukit -> Bt, etc.) and
    accepts "Int" (bus interchange) as well as "Stn"/"MRT"/"Station" markers,
    since many MRT stations are named only via their co-located bus
    interchange in this feed's bus stop data. Returns centroid of all
    matches, or None if nothing matched."""
    needles = _name_variants(name)
    marker_words = ("stn", "mrt", "station", "int")
    matches = []
    for s in all_stops:
        sname = (s.get("stop_name") or "").lower()
        sname_words = set(sname.replace("/", " ").replace(".", " ").split(" "))
        if any(n in sname for n in needles) and (sname_words & set(marker_words)):
            try:
                matches.append((float(s["stop_lat"]), float(s["stop_lon"])))
            except (ValueError, KeyError):
                continue
    if not matches:
        return None
    lat = sum(m[0] for m in matches) / len(matches)
    lon = sum(m[1] for m in matches) / len(matches)
    return lat, lon


def main():
    if len(sys.argv) != 3:
        print("Usage: patch_rail_gtfs.py <input.zip> <output.zip>")
        sys.exit(1)
    in_path, out_path = sys.argv[1], sys.argv[2]

    with zipfile.ZipFile(in_path) as zf:
        stops = read_csv(zf, "stops.txt")
        routes = read_csv(zf, "routes.txt")
        trips = read_csv(zf, "trips.txt")
        stop_times = read_csv(zf, "stop_times.txt")
        other_names = [n for n in zf.namelist() if n not in
                        ("stops.txt", "routes.txt", "trips.txt", "stop_times.txt")]
        other_files = {n: zf.read(n) for n in other_names}

    existing_stop_ids = {s["stop_id"] for s in stops}
    stops_by_id = {s["stop_id"]: s for s in stops}
    trips_by_route = defaultdict(list)
    for t in trips:
        trips_by_route[t["route_id"]].append(t["trip_id"])

    stop_times_by_trip = defaultdict(list)
    for st in stop_times:
        stop_times_by_trip[st["trip_id"]].append(st)
    for rows in stop_times_by_trip.values():
        rows.sort(key=lambda r: int(r["stop_sequence"]))

    # A `key` is a real interchange when it's shared by 2+ lines. These MUST
    # always resolve to one shared stop_id across every line that touches
    # them, even when the raw feed already defines a native stop_id for one
    # line's version of the station (e.g. Serangoon already existed natively
    # as NE12 on the North East Line's own trips, while Circle Line's CC13
    # was missing and would otherwise get its own separate synthetic stop —
    # two different stop_ids at the "same" station meant OTP had no free
    # transfer there, so itineraries could never continue via Circle Line
    # through Serangoon). Non-interchange keys keep the old behaviour: reuse
    # the line's own native stop_id when present, only mint a synthetic one
    # when genuinely missing from stops.txt.
    key_lines = defaultdict(set)
    for line, stations in LINES.items():
        for code, key, name in stations:
            key_lines[key].add(line)
    interchange_keys = {k for k, lines_for_key in key_lines.items() if len(lines_for_key) > 1}

    def native_coords_for_key(key):
        """Prefer a real coordinate already in the feed (from whichever
        line's native stop_id happens to exist) over the fuzzy bus-stop-name
        match, so interchanges that were already working aren't nudged onto
        a less precise location."""
        for ln, sts in LINES.items():
            for c, k, n in sts:
                if k != key or c not in stops_by_id:
                    continue
                s = stops_by_id[c]
                try:
                    return float(s["stop_lat"]), float(s["stop_lon"])
                except (ValueError, KeyError):
                    continue
        return None

    # Figure out which canonical stations are missing, and mint one shared
    # stop_id per interchange key (always) or per genuinely-missing
    # non-interchange station (reused across every line that needs it) so
    # transfers are free (same physical stop).
    minted_stop_id = {}   # key -> stop_id
    minted_rows = []      # new stops.txt rows to append
    missing_report = defaultdict(list)

    for line, stations in LINES.items():
        for code, key, name in stations:
            is_missing = code not in existing_stop_ids
            is_interchange = key in interchange_keys
            if is_missing:
                missing_report[line].append(f"{code} {name}")
            if not is_missing and not is_interchange:
                continue  # native stop already covers this non-interchange station
            if key in minted_stop_id:
                continue
            coords = native_coords_for_key(key) if is_interchange else None
            if coords is None:
                coords = find_station_coords(stops, name)
            stop_id = f"SGX_{key.upper()}"
            minted_stop_id[key] = stop_id
            if coords is None:
                print(f"WARNING: no coordinate match for '{name}' ({code}) — skipping, will not be patched in")
                continue
            lat, lon = coords
            minted_rows.append({
                "stop_id": stop_id,
                "stop_name": f"{name} {code}",
                "stop_lat": f"{lat:.6f}",
                "stop_lon": f"{lon:.6f}",
                "location_type": "0",
                "parent_station": "",
            })

    for line, missing in missing_report.items():
        print(f"Line {line}: {len(missing)} missing canonical stations -> {missing}")

    # Only keep entries we actually minted a stop record for (i.e. found coordinates).
    minted_keys_with_coords = {r["stop_id"] for r in minted_rows}
    resolved_stop_id = {k: v for k, v in minted_stop_id.items() if v in minted_keys_with_coords}
    print(f"Unified {len(resolved_stop_id.keys() & interchange_keys)} of {len(interchange_keys)} interchange "
          f"stations onto shared stop_ids.")

    new_stop_times = []
    patched_trip_count = 0
    inserted_row_count = 0

    for line, stations in LINES.items():
        route_id = line
        canon_codes = [c for c, k, n in stations]
        canon_key_by_code = {c: k for c, k, n in stations}
        canon_index = {c: i for i, c in enumerate(canon_codes)}

        for trip_id in trips_by_route.get(route_id, []):
            existing_rows = stop_times_by_trip.get(trip_id, [])
            if not existing_rows:
                continue

            # Map of canonical code -> (arrival_seconds, departure_seconds) for
            # stops this trip actually already serves.
            served = {}
            for row in existing_rows:
                code = row["stop_id"]
                if code in canon_index:
                    served[code] = (
                        hms_to_seconds(row["arrival_time"]),
                        hms_to_seconds(row["departure_time"]),
                    )

            if len(served) < 2:
                # Trip doesn't clearly run on this canonical line shape; leave untouched.
                for row in existing_rows:
                    new_stop_times.append(row)
                continue

            served_indices = sorted(canon_index[c] for c in served)
            lo_idx, hi_idx = served_indices[0], served_indices[-1]
            direction_forward = True
            first_code = [c for c in canon_codes if canon_index[c] == lo_idx][0]
            last_code = [c for c in canon_codes if canon_index[c] == hi_idx][0]
            if served[first_code][0] > served[last_code][0]:
                direction_forward = False

            ordered_positions = (
                range(lo_idx, hi_idx + 1) if direction_forward
                else range(hi_idx, lo_idx - 1, -1)
            )
            positions_list = list(ordered_positions)

            rebuilt = build_trip_stops(
                positions_list, canon_codes, served, resolved_stop_id, canon_key_by_code, interchange_keys
            )
            if rebuilt is None or len(rebuilt) < 2:
                for row in existing_rows:
                    new_stop_times.append(row)
                continue

            for seq, (code_or_id, arr, dep, is_new) in enumerate(rebuilt, start=1):
                new_stop_times.append({
                    "trip_id": trip_id,
                    "arrival_time": seconds_to_hms(arr),
                    "departure_time": seconds_to_hms(dep),
                    "stop_id": code_or_id,
                    "stop_sequence": str(seq),
                })
                if is_new:
                    inserted_row_count += 1
            patched_trip_count += 1

    # Any stop_times rows for trips we never touched (buses, and any rail
    # trip that fell through the "len(served) < 2" branch above and was
    # already appended) are already in new_stop_times. Now add every
    # non-rail (bus) trip's original rows, which we haven't touched yet.
    rail_trip_ids = set()
    for line in LINES:
        rail_trip_ids.update(trips_by_route.get(line, []))
    for st in stop_times:
        if st["trip_id"] not in rail_trip_ids:
            new_stop_times.append(st)

    print(f"Patched {patched_trip_count} rail trips, inserted {inserted_row_count} stop_times rows, "
          f"minted {len(minted_rows)} new stop records.")

    stops_out = stops + minted_rows
    st_fieldnames = ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"]
    stops_fieldnames = ["stop_id", "stop_name", "stop_lat", "stop_lon", "location_type", "parent_station"]

    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        write_csv(zf, "stops.txt", stops_fieldnames, stops_out)
        write_csv(zf, "routes.txt", list(routes[0].keys()) if routes else [], routes)
        write_csv(zf, "trips.txt", list(trips[0].keys()) if trips else [], trips)
        write_csv(zf, "stop_times.txt", st_fieldnames, new_stop_times)
        for name, data in other_files.items():
            zf.writestr(name, data)

    print(f"Wrote {out_path}")


def build_trip_stops(positions_list, canon_codes, served, resolved_stop_id, canon_key_by_code, interchange_keys):
    """Walk positions_list (already in this trip's direction order) and
    return a list of (stop_id, arrival_s, departure_s, is_newly_inserted)."""
    # First pass: collect served entries with their walk-order index. (Kept
    # keyed by the line's own native code -- interchange stop_id unification
    # below only swaps the *output* stop_id, not the real schedule times used
    # for interpolation here.)
    served_walk = []
    for i, pos in enumerate(positions_list):
        code = canon_codes[pos]
        if code in served:
            served_walk.append((i, code, served[code][0], served[code][1]))
    if len(served_walk) < 2:
        return None

    result = []
    for i, pos in enumerate(positions_list):
        code = canon_codes[pos]
        key = canon_key_by_code[code]
        # Real interchanges always route through the shared stop_id, even if
        # this line's own native code for the station already exists --
        # otherwise two lines can each faithfully serve "the same" station
        # under two different stop_ids that OTP never links with a transfer.
        shared_stop_id = resolved_stop_id.get(key) if key in interchange_keys else None

        if code in served:
            arr, dep = served[code]
            out_id = shared_stop_id or code
            result.append((out_id, arr, dep, out_id != code))
            continue

        stop_id = shared_stop_id or resolved_stop_id.get(key)
        if stop_id is None:
            continue
        # find bracketing served entries by walk-order index i
        prev_sw = None
        next_sw = None
        for sw in served_walk:
            if sw[0] < i:
                prev_sw = sw
            elif sw[0] > i and next_sw is None:
                next_sw = sw
        if prev_sw is None or next_sw is None:
            continue  # outside this trip's actual coverage; skip
        frac = (i - prev_sw[0]) / (next_sw[0] - prev_sw[0])
        arr = prev_sw[2] + frac * (next_sw[2] - prev_sw[2])
        dep = arr
        result.append((stop_id, arr, dep, True))

    return result


if __name__ == "__main__":
    main()
