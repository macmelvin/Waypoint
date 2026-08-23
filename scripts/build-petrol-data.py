#!/usr/bin/env python3
"""
Rebuilds data/petrol-stations.json from an OpenStreetMap Overpass API export
of Singapore's `amenity=fuel` points (retail petrol/fuel stations).

LTA DataMall and data.gov.sg do NOT publish a retail petrol station location
dataset — their closest match ("Licensed Premises for Petroleum Products")
is a list of ~21 industrial bulk-fuel depots/terminals (Jurong Island, Tuas,
etc), not petrol kiosks. OpenStreetMap's community-mapped `amenity=fuel`
tag is the practical free/keyless alternative and covers real branded
stations (Shell, Esso, Caltex, SPC, Sinopec, Cnergy, SMART Energy, etc).

Usage:
  1. Run this Overpass QL query (e.g. via curl) and save the JSON response:

     curl -s -m 30 "https://overpass-api.de/api/interpreter" \\
       --data-urlencode 'data=[out:json][timeout:25];area["ISO3166-1"="SG"][admin_level=2]->.sg;(node["amenity"="fuel"](area.sg);way["amenity"="fuel"](area.sg););out center tags;' \\
       -o petrol-stations-overpass.json

  2. python3 scripts/build-petrol-data.py path/to/petrol-stations-overpass.json
  3. Commit the updated data/petrol-stations.json.

Notes:
  - `node` elements have lat/lon directly; `way` elements (the station's
    building footprint) come back with a `center` point instead — we use
    whichever is present.
  - No live fuel-price or occupancy data exists for Singapore, so this is
    locations only, same as the EV charging feature.
  - Overpass/OSM data quality varies — roughly 4% of entries have no
    name/brand/operator tag at all; those are kept but labelled generically
    ("Petrol station") rather than dropped, since the pin location itself
    is still useful.
"""
import json
import sys
from pathlib import Path


def build(json_path: str, out_path: str) -> int:
    raw = json.loads(open(json_path, encoding="utf-8").read())
    elements = raw.get("elements", [])

    stations = []
    seen = set()
    for e in elements:
        if e.get("type") == "node":
            lat, lon = e.get("lat"), e.get("lon")
        else:
            center = e.get("center") or {}
            lat, lon = center.get("lat"), center.get("lon")
        if lat is None or lon is None:
            continue

        # A handful of ways/nodes map to the exact same physical pump
        # island (rounded coords) — dedupe so we don't show near-duplicate
        # pins right next to each other.
        key = (round(lat, 5), round(lon, 5))
        if key in seen:
            continue
        seen.add(key)

        tags = e.get("tags", {})
        name = tags.get("name") or tags.get("brand") or tags.get("operator") or "Petrol station"

        street = tags.get("addr:street", "").strip()
        housenumber = tags.get("addr:housenumber", "").strip()
        address_parts = [p for p in [housenumber, street] if p]
        address = " ".join(address_parts) if address_parts else None

        stations.append({
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "name": name,
            "brand": tags.get("brand") or tags.get("operator") or None,
            "address": address,
            "open24h": tags.get("opening_hours") == "24/7",
        })

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(stations, f, separators=(",", ":"))

    return len(stations)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <path-to-overpass-petrol-json>")
        sys.exit(1)
    count = build(sys.argv[1], str(Path(__file__).resolve().parent.parent / "data" / "petrol-stations.json"))
    print(f"Wrote {count} petrol station locations to data/petrol-stations.json")
