# AudioCheck

Nextcloud-native audio library and player for **audiobooks**, **music**, and lectures stored in your Files.

Turn folders you already have into a polished library: scan, browse, play, resume where you left off, and keep listening while you navigate the app.

## Features

- **Your files stay in Files** — AudioCheck indexes folders you choose; nothing is uploaded elsewhere
- **Music and audiobooks** — separate library roots, collections, albums, and folder browsing
- **Resume everywhere** — cross-device progress, durable playback queue, and optional “resume on open”
- **Persistent mini-player** — audio keeps playing while you browse Home, Library, Playlists, and more
- **Playlists & Favorites** — built-in Favorites (synced with Files stars) plus manual playlists
- **Browse facets** — artists, authors, genres, series, folders, tags, and favorites
- **Adjustable speed** — 0.5×–4.0× for audiobooks and podcasts
- **Chapter navigation** — for `.m4b` and tagged chapter metadata
- **Files integration** — “Play in AudioCheck” and “Play folder as album” actions
- **Dashboard widget** — Continue listening on the Nextcloud dashboard
- **Access control** — restrict who may open the app; server admins always retain access
- **EN + DE** — localized interface
- **Accessible UI** — WCAG 2.1 AA foundations (skip link, 44px targets, reduced motion, screen-reader live regions)

## Requirements

- Nextcloud 32–34
- PHP 8.2–8.5
- MySQL or PostgreSQL

## Install from Git

```bash
cd /path/to/nextcloud/apps/
git clone https://github.com/aSoftwareByDesignRepository/nextcloud-audiocheck.git audiocheck
cd audiocheck
composer install --no-dev
```

Enable the app in Nextcloud (Apps → AudioCheck) or run `php occ app:enable audiocheck`.

Add library folders in the app, then run `php occ audiocheck:scan --user=<uid>` or use **Scan now** in the UI.

## Development

```bash
composer install
npm test
./vendor/bin/phpunit
bash scripts/check-file-access-gate.sh
```

## Releasing

Bump `appinfo/info.xml` `<version>`, update `CHANGELOG.md`, run `make release-signed` with Nextcloud `occ` and app signing certificates (`~/.nextcloud/certificates/audiocheck.key` / `.crt`, or set `APP_CERT_KEY_PATH` / `APP_CERT_CRT_PATH`), then upload the tarball to [apps.nextcloud.com](https://apps.nextcloud.com).

Store listing images live under `screenshots/` as `audiocheck-screenshot-NN.png`; push them to `main` on GitHub before submitting a release (the store loads raw GitHub URLs from `info.xml`).

## Security

All file byte, metadata, and cover access goes through `FileAccessService::resolveReadableFile()` only. Every stream and cover is checked against live file permissions; revoked shares stop playback immediately. The app makes no outbound HTTP calls for playback.

Do not open issues or pull requests that contain production secrets, personal data, or internal hostnames. Report sensitive findings privately to the maintainer (see `appinfo/info.xml` author).

## License

AGPL-3.0-or-later — see [LICENSE](LICENSE).
