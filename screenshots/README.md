# Store screenshots

Files are named `audiocheck-screenshot-NN.png` (two-digit index) and referenced from `appinfo/info.xml` for [apps.nextcloud.com](https://apps.nextcloud.com).

Public URLs use branch **`main`**:

`https://raw.githubusercontent.com/aSoftwareByDesignRepository/nextcloud-audiocheck/refs/heads/main/screenshots/…`

| # | File | View shown |
|---|------|------------|
| 01 | `audiocheck-screenshot-01.png` | **Library** — folder roots, scan status, music vs audiobook classification |
| 02 | `audiocheck-screenshot-02.png` | **Music** — track list with search, sort, and persistent mini-player |
| 03 | `audiocheck-screenshot-03.png` | **Playlists** — built-in Favorites and user-created playlists |
| 04 | `audiocheck-screenshot-04.png` | **Favorites** — starred tracks ready to play |
| 05 | `audiocheck-screenshot-05.png` | **Browse** — artists, genres, folders, tags, and more |
| 06 | `audiocheck-screenshot-06.png` | **Settings** — playback speed, volume, resume, and scan options |
| 07 | `audiocheck-screenshot-07.png` | **App settings** — who may open AudioCheck (access policy) |

When adding or reordering shots: keep indices contiguous, update the `<screenshot>` blocks in `info.xml`, and push to `main` before submitting a store release (the store loads images from GitHub raw URLs).

Use demo data only — no real personal information. Screenshots are PNG (1024×469); re-export if you change the UI theme.
