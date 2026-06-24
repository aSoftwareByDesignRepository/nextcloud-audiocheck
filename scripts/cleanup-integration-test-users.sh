#!/usr/bin/env bash
# Remove AudioCheck integration-test users and any leftover data directories.
#
# Integration tests create accounts with the ac_* prefix. When a prior run failed
# mid-test, or PHPUnit ran as root, data/ directories can remain root-owned while
# the account is gone — www-data cannot delete them and createUser() then fails.
#
# This script is safe to run before every docker test invocation.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if ! docker compose ps --status running --services 2>/dev/null | grep -qx 'nextcloud'; then
	echo "cleanup-integration-test-users: nextcloud container is not running" >&2
	exit 1
fi

echo "cleanup-integration-test-users: deleting ac_* accounts (if any)…"
docker compose exec -T --user www-data nextcloud php occ user:list --output=json 2>/dev/null \
	| php -r '
		$users = json_decode(stream_get_contents(STDIN), true);
		if (!is_array($users)) {
			exit(0);
		}
		foreach (array_keys($users) as $uid) {
			if (str_starts_with($uid, "ac_")) {
				echo $uid, "\n";
			}
		}
	' \
	| while IFS= read -r uid; do
		[ -z "$uid" ] && continue
		echo "  occ user:delete $uid"
		docker compose exec -T --user www-data nextcloud php occ user:delete "$uid" --force 2>/dev/null || true
	done

echo "cleanup-integration-test-users: removing orphan ac_* data directories…"
docker compose exec -T -u root nextcloud bash -lc '
	set -euo pipefail
	data="${NEXTCLOUD_DATADIR:-/var/www/html/data}"
	shopt -s nullglob
	removed=0
	for dir in "$data"/ac_*; do
		[ -d "$dir" ] || continue
		rm -rf "$dir"
		removed=$((removed + 1))
	done
	echo "  removed ${removed} director(ies)"
'

echo "cleanup-integration-test-users: done"
