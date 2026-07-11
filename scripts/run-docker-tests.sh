#!/usr/bin/env bash
# Run PHPUnit with Nextcloud bootstrapped (integration tests included).
set -euo pipefail
APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$APP_ROOT/../.." && pwd)"
cd "$ROOT"
export NEXTCLOUD_ROOT=/var/www/html
bash "$APP_ROOT/scripts/cleanup-integration-test-users.sh"
docker compose exec --user www-data -e NEXTCLOUD_ROOT="$NEXTCLOUD_ROOT" nextcloud \
	php custom_apps/audiocheck/vendor/bin/phpunit -c custom_apps/audiocheck/phpunit.xml
