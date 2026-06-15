# AudioCheck

Nextcloud-native audio library and player for audiobooks, music, and lectures stored in your Files.

## Features (v1)

- Per-user library index with background/on-demand scan (`occ audiocheck:scan`)
- HTTP Range streaming with live `getUserFolder()->getById()` authorization (AC-FA-1)
- Persistent shell + mini-player (audio survives in-app navigation)
- Continue listening, playlists, derived albums/audiobooks, facets
- App-use gate + admin policy (BudgetCheck pattern)
- Dashboard "Continue listening" widget, Files app "Play in AudioCheck"
- EN + DE localization

## Development

```bash
cd nextcloud/apps/audiocheck
composer install
npm test
./vendor/bin/phpunit
bash scripts/check-file-access-gate.sh
```

Docker:

```bash
cd nextcloud
docker compose exec --user www-data nextcloud php occ app:enable audiocheck
docker compose exec --user www-data nextcloud php occ audiocheck:scan --user=admin
```

## Security

All file byte/metadata/cover access goes through `FileAccessService::resolveReadableFile()` only. See `planning/app-ideas/audiocheck/README.md` §9.
