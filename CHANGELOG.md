# Changelog

All notable changes to AudioCheck are documented in this file.

## [1.2.0] — 2026-06-15

### Added

- **App Store listing assets** — seven screenshots (`screenshots/audiocheck-screenshot-01.png` … `07.png`) covering Library, Music, Playlists, Favorites, Browse, Settings, and App settings.
- Expanded **EN + DE** store descriptions in `appinfo/info.xml` with quick-start steps, feature highlights, and accessibility notes.

### Changed

- `README.md` updated with feature list, quick start, and App Store release checklist.

## [1.1.1] — 2026-06-15

### Fixed

- **Queue lost on F5 / reload.** `setSpeed()` during bootstrap scheduled a delayed
  `persistSession()` that **wiped `sessionStorage`** before restore could finish;
  restore now starts immediately (before prefs), default speed applies only when
  nothing was restored, and empty snapshots no longer clear storage during
  bootstrap.
- **Server queue never saved on reload.** `sendBeacon` only supports POST (added
  `POST /api/queue` beacon route); queue now persists immediately on `playQueue`,
  uses `validFileId()` for string IDs, and flushes via `pagehide` / `beforeunload`.
- **Restore fallback** when playable API is slow: session snapshot still loads the
  full queue from cached track metadata.

## [1.1.0] — 2026-06-15

### Added

- **Durable, cross-device playback queue.** The full queue (all tracks of a
  multi-file audiobook), the current track, playback speed, shuffle, and repeat
  are now persisted server-side and restored after a browser reload, a new tab,
  a browser restart, or on another device — not just a same-tab reload. New
  `ac_queue` + `ac_queue_items` tables (migration `1004Date20260618120000`) and
  `GET/PUT/DELETE /api/queue`.

### Changed

- Resume position remains the single source of truth in `ac_play_state`; the
  queue only stores ordering + pointer + settings, so frequent saves stay cheap
  (items are only rewritten when the ordering actually changes; debounced PUTs).
- `sessionStorage` is now an instant same-tab cache layered on top of the
  durable server queue; restore order is local cache → server queue → single
  continue-listening track.
- Every queue mutation (reorder, remove, speed/shuffle/repeat) now persists.
- Screen-reader announcement when a queue is restored ("Restored your queue with
  N tracks where you left off").

### Security

- Queue items are authorised on read: each restored file is resolved through the
  `FileAccessService` choke point and marked unavailable (no metadata leaked) if
  the user can no longer access it. Persisted writes are bounded
  (`MAX_ITEMS = 2000`) and atomic (transactional save/clear).
- User deletion purges `ac_queue` + `ac_queue_items`; uninstall drops both tables.

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
