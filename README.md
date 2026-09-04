# AudioCheck

[![Nextcloud](https://img.shields.io/badge/Nextcloud-32–35-0082c9?logo=nextcloud&logoColor=white)](https://nextcloud.com/)
[![PHP](https://img.shields.io/badge/PHP-8.2–8.5-777BB4?logo=php&logoColor=white)](https://www.php.net/)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)

**[English](#english)** · **[Deutsch](#deutsch)**

Audiobooks and music from your Nextcloud Files — with resume, queues, chapters and playlists.

---

## English

**Your audio library inside Nextcloud.**

AudioCheck indexes folders you choose in Files, streams with live permission checks, and keeps a persistent mini-player while you navigate — including on Files and other Nextcloud apps when you have something in your queue. Music and audiobooks use separate library roots.

The app is **free** under AGPL-3.0-or-later. No seat license is required for this web app.

### What is included

- Scan chosen folders (UI or `occ audiocheck:scan`); multi-file audiobooks as one queue
- Resume on the server per account; durable queue; optional resume on open; dashboard Continue listening
- Playlists; Favorites synced with Files stars; chapter jumps on M4B; speed 0.5×–4.0×
- Files actions: Play in AudioCheck / Play folder as album
- Optional access restriction (admins retain access)
- EN + DE UI; accessibility foundations aimed at WCAG 2.1 AA (not a certification)

### Formats

Server indexes common `audio/*` types including MP3, M4A/M4B, OGG, Opus, FLAC, WAV, AAC. Browser decode depends on the browser — FLAC and some others may need a different browser.

### Requirements

- Nextcloud 32–35 · PHP 8.2–8.5 · MySQL or PostgreSQL

### Install from Git

```bash
cd /path/to/nextcloud/apps/
git clone https://github.com/aSoftwareByDesignRepository/nextcloud-audiocheck.git audiocheck
cd audiocheck && composer install --no-dev
# Nextcloud loads deps via composer/autoload.php (bridge to vendor/) — do not delete it.
php occ app:enable audiocheck
```

### Security

All file byte, metadata and cover access goes through a single file-access gate with live permissions. No outbound HTTP for playback. Report sensitive findings privately to the maintainer (`appinfo/info.xml`).

### License

[AGPL-3.0-or-later](LICENSE).

---

## Deutsch

**Ihre Audiothek in Nextcloud.**

AudioCheck indexiert gewählte Ordner in Dateien, streamt mit Live-Berechtigungsprüfung und hält einen dauerhaften Mini-Player — auch in Dateien und anderen Nextcloud-Apps, wenn etwas in der Warteschlange liegt. Musik und Hörbücher haben getrennte Bibliothekswurzeln.

Die App ist unter AGPL-3.0-or-later **kostenfrei**. Für diese Web-App ist keine Sitzlizenz nötig.

### Was enthalten ist

- Ordner scannen (UI oder `occ audiocheck:scan`); mehrteilige Hörbücher als eine Warteschlange
- Fortschritt auf dem Server; dauerhafte Warteschlange; Dashboard „Weiterhören“
- Playlists; Favoriten mit Dateien-Sternen; Kapitel bei M4B; Geschwindigkeit 0,5×–4,0×
- Dateien-Aktionen; optionale Zugriffsbeschränkung
- DE + EN; Barrierefreiheits-Grundlagen mit Ziel WCAG 2.1 AA (keine Zertifizierung)

### Formate

Server indexiert gängige `audio/*`-Typen. Browser-Wiedergabe hängt vom Browser ab — FLAC und manche Formate brauchen ggf. einen anderen Browser.

### Voraussetzungen

- Nextcloud 32–35 · PHP 8.2–8.5 · MySQL oder PostgreSQL

### Installation aus Git

```bash
cd /path/to/nextcloud/apps/
git clone https://github.com/aSoftwareByDesignRepository/nextcloud-audiocheck.git audiocheck
cd audiocheck && composer install --no-dev
php occ app:enable audiocheck
```
