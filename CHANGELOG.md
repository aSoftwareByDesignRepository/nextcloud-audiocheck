# Changelog

All notable changes to AudioCheck are documented in this file.

## [1.0.0] — 2026-06-15

### Added

- Full audio library app for Nextcloud: scan, browse, play, playlists, progress sync
- Security-critical file access via `FileAccessService` choke point on every stream, cover, and API path
- Persistent shell with mini-player, client router, and now-playing view
- Audiobooks and music collections with search, sort, and pagination
- Playlists: create, rename, pin, reorder, add/remove tracks, build from collection
- Continue listening shelf, dashboard widget, and cross-device progress (with beacon saves)
- Files app integration: “Play in AudioCheck” and “Play folder as album”
- Deep links via `?fileId=` and `?folderId=` (playable API works before scan index)
- Browse facets: artists, authors, series, genres, folders, favorites, system tags
- System tag filter (accessible files only)
- Personal settings: default speed, resume on open, keyboard shortcut help
- App admin policy: restrict users/groups, default library folder, metadata temp cap
- EN + DE localization, WCAG 2.1 AA foundations (skip link, 44px targets, reduced motion)
- Background scan jobs, `occ audiocheck:scan`, incremental file event handling
- PHPUnit suite including Docker integration tests (file access, continue listening, upgrade repair)

### Security

- Rate limits on scan triggers, policy saves, and admin search
- Uniform 404 responses for inaccessible files (no enumeration)
- Playlist reorder validates full item-id permutation
- Uninstall drops all `ac_*` tables, config, migrations, and cover cache
- Cross-device progress: stale client writes rejected (T5.01); `clientUpdatedAt` token from server
- Metadata/cover freshness: `source_mtime` + `source_size` on `ac_file_meta` (Nextcloud etags may not change on in-place overwrites); write events force re-extract
- Integration tests: app gate (AC-TST-11), enumeration (04/08), foreign mutations (14/15), shared meta (18), metadata refresh (17), trash (06), share downgrade (07), cover 404 (09), user purge (§10.8)
- Route type gate unit test: all `{fileId}` / `{folderId}` controller params are `int` (AC-TST-05)
- User deletion purges per-user rows and GCs orphan `ac_file_meta`
- Stream conformance integration tests (200/206 headers, foreign 404 JSON)
- `browserPlayable` flag on tracks (FLAC/WMA/AIFF labelled in UI per §13.7)
- Files app actions only load for users who pass the app-use gate (§27 edge 28)
- Library scan status exposes `backgroundCron`; UI warns when system cron is disabled (§13 edge 22)
- `browserPlayable` on playlist items and continue-listening progress
- **Fix:** `StreamResponseFactory::createFromFile()` return type now includes `NotModifiedStreamResponse` (304 If-None-Match no longer fatals on PHP 8)
- Validation errors return HTTP **422** (planning §12.3 contract)
- Static **no-outbound-HTTP** gate (`scripts/check-no-outbound-http.sh`) — CI + PHPUnit
- Playlist ownership integration tests (foreign item remove, forged reorder ids — J4)
- Stream **416** integration test for invalid Range (J3 / AC-TST-16)
- **Fix:** `Http::STATUS_REQUEST_RANGE_NOT_SATISFIABLE` (correct Nextcloud constant for 416)
- **Fix:** `ApiController` JSON endpoints declare `#[NoCSRFRequired]` (fixes HTTP 412 on GET API calls)
- **Fix:** `api.js` substitutes `{fileId}` / `{type}` route params via `OC.generateUrl`
- Browse facet drill-down: `genre`, `artist`, `series`, `folder` filters on `listTracks` (fixes empty/wrong facet results)
- Artists vs authors facets filtered by `kind` (music vs audiobook)
- `ac_file_meta.series` column + tag extraction (migration `1002Date20260615140000`); re-scan populates series
- CSRF enforced on mutations only (GET keeps `#[NoCSRFRequired]` per §11.3 / UAT J1)
- Home empty state only when library is truly empty; “Nothing in progress” when library exists
- Reset progress button on Now Playing; playlist unavailable badge; modal error toasts
- Library: scan/load error feedback, supported-formats legend; Settings links to Library folders
- CSS: fixed broken `.ac-collection-toolbar` block; 320px Now Playing single-column; repeat `aria-pressed`

### Changed (post-release hardening)

- Off-canvas mobile navigation with focus management and Escape to close
- Library roots auto-disabled when folder becomes inaccessible
- `scanSubfolders` user preference wired to default scan and new library folders
