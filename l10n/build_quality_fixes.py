#!/usr/bin/env python3
"""Build complete _quality_fixes_{lang}.json from formal catalog + sibling seeds."""
from __future__ import annotations

import json
from pathlib import Path

L10N = Path(__file__).parent
APPS = L10N.parents[1]
LOCALES = ["de", "fr", "es", "da", "nl", "it", "pl", "sv", "nb", "pt_BR"]
SEED_APPS = [
    "budgetcheck",
    "ticketcheck",
    "mobilitycheck",
    "maintenancecheck",
    "arbeitszeitcheck",
    "snackcheck",
]

en = json.loads((L10N / "en.json").read_text(encoding="utf-8"))["translations"]
catalog: dict[str, dict[str, str]] = json.loads(
    (L10N / "_formal_catalog.json").read_text(encoding="utf-8")
)


def load_trans(app: str, lang: str) -> dict[str, str]:
    path = APPS / app / "l10n" / f"{lang}.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8")).get("translations", {})


def seeds(lang: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for app in SEED_APPS:
        if app == "budgetcheck":
            continue
        src = load_trans(app, lang)
        for k, ev in en.items():
            if k in src and src[k] != ev:
                out[k] = src[k]
    # BudgetCheck formal register wins over sibling app copies.
    bc = load_trans("budgetcheck", lang)
    for k, ev in en.items():
        if k in bc and bc[k] != ev:
            out[k] = bc[k]
    qf = APPS / "snackcheck" / "l10n" / f"_quality_fixes_{lang}.json"
    if qf.exists():
        for k, v in json.loads(qf.read_text(encoding="utf-8")).items():
            if k not in bc or bc.get(k) == en.get(k):
                out[k] = v
    return out


def main() -> None:
    for lang in LOCALES:
        fail_path = L10N / f"_fail_{lang}.json"
        if not fail_path.exists():
            continue
        fail = json.loads(fail_path.read_text(encoding="utf-8"))["all"]
        if not fail:
            (L10N / f"_quality_fixes_{lang}.json").write_text("{}\n", encoding="utf-8")
            print(f"{lang}: 0 fixes")
            continue
        seed = seeds(lang)
        cat = catalog.get(lang, {})
        fixes: dict[str, str] = {}
        missing: list[str] = []
        for key in fail:
            if key in cat:
                fixes[key] = cat[key]
            elif key in seed:
                fixes[key] = seed[key]
            else:
                missing.append(key)
        if missing:
            print(f"{lang}: WARNING missing {len(missing)} keys")
            (L10N / f"_missing_after_build_{lang}.json").write_text(
                json.dumps(missing, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
        out = L10N / f"_quality_fixes_{lang}.json"
        out.write_text(json.dumps(fixes, ensure_ascii=False, indent="\t") + "\n", encoding="utf-8")
        print(f"{lang}: {len(fixes)} fixes")


if __name__ == "__main__":
    main()
