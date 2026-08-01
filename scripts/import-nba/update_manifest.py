"""Refreshes manifest content hashes and indexes for packaged artifacts.

Covers: pools, era simulation profiles, and opponent artifacts. Recomputes
SHA-256 hashes from the packaged files and rewrites `manifest.json`.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "apps" / "web" / "static" / "data"
MANIFEST_PATH = DATA_DIR / "manifest.json"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    manifest["pools"] = []
    pool_dir = DATA_DIR / "pools"
    for path in sorted(pool_dir.glob("*.json")):
        parts = path.stem.split("-", 1)
        manifest["pools"].append(
            {"franchiseId": parts[0], "eraId": parts[1], "url": f"pools/{path.name}", "contentHash": sha256(path)}
        )
    manifest["eraSimulationProfiles"] = []
    for path in sorted((DATA_DIR / "era-sim").glob("*.json")):
        profile = json.loads(path.read_text(encoding="utf-8"))
        manifest["eraSimulationProfiles"].append(
            {"eraId": profile["eraId"], "url": f"era-sim/{path.name}", "contentHash": sha256(path)}
        )
    manifest["opponents"] = []
    for path in sorted((DATA_DIR / "opponents").glob("*.json")):
        opponent = json.loads(path.read_text(encoding="utf-8"))
        if path.name == "bracket.json":
            manifest["bracket"] = {
                "url": f"opponents/{path.name}",
                "contentHash": sha256(path),
            }
            continue
        manifest["opponents"].append(
            {"opponentId": opponent["opponentId"], "url": f"opponents/{path.name}", "contentHash": sha256(path)}
        )
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"updated {MANIFEST_PATH}")
    print(f"pools={len(manifest['pools'])} profiles={len(manifest['eraSimulationProfiles'])} opponents={len(manifest['opponents'])}")


if __name__ == "__main__":
    main()
