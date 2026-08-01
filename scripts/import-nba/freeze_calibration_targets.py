"""Freezes the approved 10,000-seed calibration baseline into the era profile.

Reads a `calibrate run --format json` report payload and rewrites
`apps/web/static/data/era-sim/1990s.json` so every target equals the observed
baseline with a documented tolerance. Tolerances are sized to catch material
regressions while remaining stable at CI sample sizes. The profile version
advances, marking the targets as intentionally approved (spec/06).

Usage:
  python scripts/import-nba/freeze_calibration_targets.py <baseline-report.json>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROFILE_PATH = ROOT / "apps" / "web" / "static" / "data" / "era-sim" / "1990s.json"
NEW_VERSION = "m2-1990s-v2"

# Metric key -> absolute tolerance around the observed baseline.
TOLERANCES = {
    "possessionsPerGame": 1.5,
    "pointsPerGame": 3.0,
    "offensiveRating": 3.0,
    "fieldGoalPct": 0.010,
    "efgPct": 0.010,
    "tsPct": 0.010,
    "threePointRate": 0.010,
    "threePointPct": 0.015,
    "freeThrowsAttemptedPerGame": 2.0,
    "freeThrowPct": 0.015,
    "turnoversPerGame": 1.0,
    "turnoversPerPossession": 0.008,
    "offensiveReboundsPerGame": 1.0,
    "offensiveReboundRate": 0.012,
    "assistsPerGame": 2.0,
    "assistRate": 0.020,
    "personalFoulsPerGame": 2.0,
    "zoneMix.rim": 0.015,
    "zoneMix.shortMid": 0.015,
    "zoneMix.longMid": 0.015,
    "zoneMix.cornerThree": 0.012,
    "zoneMix.aboveBreakThree": 0.015,
    "closeGameRate": 0.030,
    "blowoutRate": 0.030,
    "overtimeRate": 0.012,
    "strongVsWeakWinRate": 0.005,
    "equalLineupHomeWinRate": 0.030,
}

MINIMUM_SAMPLES = {
    "strongVsWeakWinRate": 2000,
    "equalLineupHomeWinRate": 2000,
    "closeGameRate": 2000,
    "blowoutRate": 2000,
    "overtimeRate": 2000,
}


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("usage: freeze_calibration_targets.py <baseline-report.json>")
    raw = Path(sys.argv[1]).read_text(encoding="utf-8-sig")
    start = raw.find("{")
    if start < 0:
        raise SystemExit("report contains no JSON payload")
    # The report may carry trailing banner lines; slice the first JSON object.
    depth = 0
    end = None
    for i in range(start, len(raw)):
        if raw[i] == "{":
            depth += 1
        elif raw[i] == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end is None:
        raise SystemExit("report JSON payload is not closed")
    report = json.loads(raw[start:end])
    payload = report["payload"]
    if payload["command"] != "calibrate run":
        raise SystemExit(f"expected a calibrate run report, got {payload['command']}")
    observed = {m["key"]: m["observed"] for m in payload["metrics"]}
    for key in observed:
        if key not in TOLERANCES:
            raise SystemExit(f"report metric {key} has no frozen tolerance")

    profile = json.loads(PROFILE_PATH.read_text(encoding="utf-8"))
    profile["profileVersion"] = NEW_VERSION
    profile["baselineReport"] = (
        f"frozen from approved 10,000-seed baseline "
        f"({payload['samples']} samples, engine {payload['engineVersion']}, "
        f"observed targets with tolerances per spec/06)"
    )
    targets = profile["targets"]

    def set_target(path: str, value: float) -> None:
        node = targets
        for part in path.split("."):
            if part in node:
                node = node[part]
            else:
                raise SystemExit(f"profile has no target {path}")
        node["value"] = round(value, 4)
        node["tolerance"] = TOLERANCES[path]
        node["minimumSample"] = MINIMUM_SAMPLES.get(path, node.get("minimumSample", 1000))

    for key, value in observed.items():
        set_target(key, value)

    PROFILE_PATH.write_text(json.dumps(profile, indent=2) + "\n", encoding="utf-8")
    print(f"froze {len(observed)} targets into {PROFILE_PATH} ({NEW_VERSION})")


if __name__ == "__main__":
    main()
