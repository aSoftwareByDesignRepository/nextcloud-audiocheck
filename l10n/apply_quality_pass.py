#!/usr/bin/env python3
"""Apply manually curated l10n quality fixes for AudioCheck."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

L10N = Path(__file__).parent
ROOT = L10N.parents[2]


def load_json(lang: str) -> dict:
    with (L10N / f"{lang}.json").open(encoding="utf-8") as f:
        return json.load(f)


def save_json(lang: str, data: dict) -> None:
    with (L10N / f"{lang}.json").open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent="\t")
        f.write("\n")


def apply_fixes(lang: str, fixes: dict[str, str]) -> int:
    data = load_json(lang)
    trans = data["translations"]
    applied = 0
    for key, value in fixes.items():
        if key in trans and value:
            trans[key] = value
            applied += 1
    data["translations"] = trans
    save_json(lang, data)
    return applied


def main() -> None:
    total = 0
    for path in sorted(L10N.glob("_quality_fixes_*.json")):
        lang = path.stem.replace("_quality_fixes_", "")
        if lang.endswith(".json"):
            continue
        fixes = json.loads(path.read_text(encoding="utf-8"))
        if not fixes:
            print(f"{lang}: 0 fixes")
            continue
        n = apply_fixes(lang, fixes)
        print(f"{lang}: {n} fixes")
        total += n
    subprocess.run(
        ["php", str(ROOT / "scripts/l10n/regenerate-l10n-js.php"), "--app=audiocheck"],
        check=True,
        cwd=ROOT,
    )
    print(f"Total: {total}")


if __name__ == "__main__":
    main()
