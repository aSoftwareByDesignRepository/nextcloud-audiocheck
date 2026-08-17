#!/usr/bin/env python3
"""Sync l10n/*.json from existing l10n/*.js catalogs."""
from __future__ import annotations

import json
import re
from pathlib import Path

L10N = Path(__file__).parent
LOCALES = ["en", "de", "fr", "es", "da", "nl", "it", "pl", "sv", "nb", "pt_BR"]
PLURALS = {
    "en": "nplurals=2; plural=(n != 1);",
    "de": "nplurals=2; plural=(n != 1);",
    "fr": "nplurals=2; plural=(n > 1);",
    "es": "nplurals=2; plural=(n != 1);",
    "da": "nplurals=2; plural=(n != 1);",
    "nl": "nplurals=2; plural=(n != 1);",
    "it": "nplurals=2; plural=(n != 1);",
    "nb": "nplurals=2; plural=(n != 1);",
    "pl": "nplurals=3; plural=(n==1 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);",
    "sv": "nplurals=2; plural=(n != 1);",
    "pt_BR": "nplurals=2; plural=(n != 1);",
}


def parse_js(lang: str) -> dict[str, str]:
    path = L10N / f"{lang}.js"
    text = path.read_text(encoding="utf-8")
    m = re.search(
        r'OC\.L10N\.register\(\s*"audiocheck"\s*,\s*(\{.*\})\s*,\s*(?:\{|"nplurals)',
        text,
        re.S,
    )
    if not m:
        m = re.search(r'OC\.L10N\.register\("audiocheck",\s*(\{.*\}),\s*\{', text, re.S)
    if not m:
        raise RuntimeError(f"Cannot parse {path}")
    return json.loads(m.group(1))


def main() -> None:
    en = parse_js("en")
    for lang in LOCALES:
        if lang == "en":
            trans = en
        else:
            js_path = L10N / f"{lang}.js"
            if not js_path.exists():
                print(f"skip {lang}: no js")
                continue
            trans = parse_js(lang)
        data = {"translations": trans, "pluralForm": PLURALS[lang]}
        out = L10N / f"{lang}.json"
        out.write_text(json.dumps(data, ensure_ascii=False, indent="\t") + "\n", encoding="utf-8")
        print(f"synced {lang}.json ({len(trans)} keys)")


if __name__ == "__main__":
    main()
