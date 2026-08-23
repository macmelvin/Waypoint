#!/usr/bin/env python3
"""
Rebuilds data/ev-charging-points.json from LTA DataMall's quarterly
"Electric Vehicle Charging Points" CSV export.

LTA's raw CSV has one row per charging OUTLET (~11k rows) — many outlets
share the same physical location (a building/lot can have several plugs).
This groups them into one entry per physical station (~2.8k), combining
outlet counts and plug types, so the app's "nearest EV charger" feature
shows real distinct locations instead of listing the same car park five
times.

Usage:
  1. Download the latest zip from LTA DataMall's static datasets page
     (https://datamall.lta.gov.sg/content/datamall/en/static-data.html,
     under "Electric Vehicles and Charging Points"), unzip it.
  2. python3 scripts/build-ev-data.py path/to/Electric_Vehicle_Charging_Points_*.csv
  3. Commit the updated data/ev-charging-points.json.
"""
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path


def build(csv_path: str, out_path: str) -> int:
    rows = list(csv.DictReader(open(csv_path, encoding="utf-8-sig")))

    stations = {}
    for r in rows:
        if r.get("Is the charger publicly accessible?", "").strip().lower() != "yes":
            continue
        try:
            lat = round(float(r["latitude"]), 6)
            lon = round(float(r["longitude"]), 6)
        except (KeyError, ValueError):
            continue
        key = (lat, lon)
        if key not in stations:
            block = r.get("Block/House No", "").strip()
            street = r.get("Street Name", "").strip().title()
            building = r.get("Building Name", "").strip().title()
            addr_parts = [p for p in [block, street] if p]
            address = " ".join(addr_parts)
            if building:
                address = f"{building}, {address}" if address else building
            stations[key] = {
                "lat": lat,
                "lon": lon,
                "address": address,
                "postalCode": r.get("PostalCode", "").strip(),
                "operators": set(),
                "plugTypes": defaultdict(int),
                "outlets": 0,
            }
        s = stations[key]
        s["operators"].add(r.get("operator", "").strip().title())
        try:
            n = int((r.get("No. of Charging Outlets") or "1").strip())
        except ValueError:
            n = 1
        s["plugTypes"][r.get("plugType", "").strip()] += n
        s["outlets"] += n

    out = [
        {
            "lat": lat,
            "lon": lon,
            "address": s["address"],
            "postalCode": s["postalCode"],
            "operators": sorted(s["operators"]),
            "plugTypes": dict(s["plugTypes"]),
            "outlets": s["outlets"],
        }
        for (lat, lon), s in stations.items()
    ]

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(out, f, separators=(",", ":"))

    return len(out)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <path-to-lta-ev-charging-csv>")
        sys.exit(1)
    count = build(sys.argv[1], str(Path(__file__).resolve().parent.parent / "data" / "ev-charging-points.json"))
    print(f"Wrote {count} EV charging station locations to data/ev-charging-points.json")
