#!/usr/bin/env python3
"""Final formal catalog patches for remaining quality-gate gaps."""
from __future__ import annotations

import json
from pathlib import Path

L10N = Path(__file__).parent
APPS = L10N.parents[1]
cat = json.loads((L10N / "_formal_catalog.json").read_text(encoding="utf-8"))


def bc(lang: str) -> dict[str, str]:
    return json.loads((APPS / "budgetcheck" / "l10n" / f"{lang}.json").read_text())["translations"]


patch = {
    "fr": {"Albums": "Album"},
    "nl": {
        "Albums": "Album",
        "Volume": "Geluidsniveau",
        "Shift + ← / →": "Shift + pijltjestoetsen ← / →",
    },
    "pl": {"Shift + ← / →": "Shift + strzałki ← / →"},
    "pt_BR": {
        "Volume": "Volume do som",
        "Shift + ← / →": "Shift + setas ← / →",
        "A yearly pack of hours you can book with us, plus priority email replies for your organisation. This is invoiceable service — not a donation.": "Pacote anual de horas reservável conosco, além de respostas prioritárias por e-mail para a organização. Serviço faturável, não doação.",
    },
    "da": {
        "Could not reach the server. Check your connection and try again.": "Serveren kunne ikke nås. Kontrollér forbindelsen, og prøv igen.",
        "How the mobile app handles your data.": "Sådan håndterer mobilappen data.",
        "Remote onboarding or a workshop so your team can roll out cleanly — billed as a service.": "Fjern onboarding eller workshop til et rent udrulning — faktureres som ydelse.",
    },
    "sv": {
        "Could not reach the server. Check your connection and try again.": "Servern kunde inte nås. Kontrollera anslutningen och försök igen.",
    },
    "nb": {
        "Could not reach the server. Check your connection and try again.": "Serveren kunne ikke nås. Kontroller tilkoblingen, og prøv igjen.",
        "How the mobile app handles your data.": "Slik håndterer mobilappen data.",
        "What you can do": "Dette er mulig",
    },
}

for lang in ("da", "nb", "sv", "pt_BR", "fr", "es", "nl", "it", "pl"):
    src = bc(lang)
    for key in [
        "%s stays free (AGPL) on your Nextcloud. Bug reports and ideas on GitHub stay welcome — that is free open-source care. If your organisation needs bookable help on an invoice — or official mobile licenses — choose an option below:",
        "%s stays free (AGPL) on your Nextcloud. Bug reports and ideas on GitHub stay welcome — that is free open-source care. If your organisation needs bookable help on an invoice, choose an option below:",
        "%s stays free (AGPL) on your Nextcloud. GitHub issues for bugs and ideas remain welcome. For bookable help on an invoice — setup, hour packs, commissioned work — or the official mobile app:",
        "%s stays free (AGPL) on your Nextcloud. GitHub issues for bugs and ideas remain welcome. For bookable help on an invoice — setup, hour packs, or commissioned work:",
        "A yearly pack of hours you can book with us, plus priority email replies for your organisation. This is invoiceable service — not a donation.",
        "Annual hour packs — Small, Standard, or Premium — with priority email for your organisation. This is invoiceable service — not a donation. See packages on our support page.",
        "List prices on our site apply to published Check apps. For this app, ask for an individual partner offer — we invoice only after you accept a quote.",
    ]:
        if key in src and src[key] != json.loads((L10N / "en.json").read_text())["translations"].get(key):
            patch.setdefault(lang, {})[key] = src[key]

for lang, fixes in patch.items():
    cat.setdefault(lang, {}).update(fixes)

(L10N / "_formal_catalog.json").write_text(json.dumps(cat, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Final patch applied")
