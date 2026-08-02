"""Freezes an approved calibration baseline into an era profile.

Reads a `calibrate run --format json` report payload and rewrites
`apps/web/static/data/era-sim/<era>.json` so every target value equals the
observed baseline while the profile's documented tolerances are preserved.
The profile version advances to `m3-<era>-v2`, marking the targets as
intentionally approved (spec/06). Distribution gates below their minimum
sample are not re-evaluated; every gate keeps its documented minimum sample.

Usage:
  python scripts/import-nba/freeze_calibration_targets.py [eraId] <baseline-report.json>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "apps" / "web" / "static" / "data" / "era-sim"

# Distribution gates measured on real matchups require a larger sample.
MINIMUM_SAMPLES = {
    "closeGameRate": 2000,
    "blowoutRate": 2000,
    "overtimeRate": 2000,
    "strongVsWeakWinRate": 2000,
    "equalLineupHomeWinRate": 2000,
}


def extract_payload(raw: str) -> dict:
    start = raw.find("{")
    if start < 0:
        raise SystemExit("report contains no JSON payload")
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
    return payload


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("usage: freeze_calibration_targets.py [eraId] <baseline-report.json>")
    if len(sys.argv) == 2:
        era_id = "1990s"
        report_path = sys.argv[1]
    else:
        era_id = sys.argv[1]
        report_path = sys.argv[2]

    profile_path = DATA_DIR / f"{era_id}.json"
    if not profile_path.exists():
        raise SystemExit(f"no era profile at {profile_path}")
    payload = extract_payload(Path(report_path).read_text(encoding="utf-8-sig"))
    if payload["eraId"] != era_id:
        raise SystemExit(
            f"report is for era {payload['eraId']}, not {era_id}"
        )

    observed = {m["key"]: m["observed"] for m in payload["metrics"]}
    profile = json.loads(profile_path.read_text(encoding="utf-8"))
    new_version = f"m3-{era_id}-v2"
    profile["profileVersion"] = new_version
    profile["baselineReport"] = (
        f"calibrate run --samples {payload['samples']} "
        f"(engine {payload['engineVersion']})"
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
        node["minimumSample"] = MINIMUM_SAMPLES.get(path, node.get("minimumSample", 200))

    for key, value in observed.items():
        set_target(key, value)

    profile_path.write_text(json.dumps(profile, indent=2) + "\n", encoding="utf-8")
    print(f"froze {len(observed)} targets into {profile_path} ({new_version})")


if __name__ == "__main__":
    main()
