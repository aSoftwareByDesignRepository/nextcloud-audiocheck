#!/usr/bin/env bash
# Host-side mutation gauntlet: mutate on host, verify via Docker phpunit.
# Covers LibraryService::listTrackFileIds — the member-ID set behind the
# mobile "X of Y saved" counter.
set -euo pipefail
APP="$(cd "$(dirname "$0")/../.." && pwd)"
ROOT="$(cd "$APP/../.." && pwd)"
PHPUNIT=(docker compose -f "$ROOT/docker-compose.yml" exec -u www-data -e NEXTCLOUD_ROOT=/var/www/html nextcloud
	php -d opcache.enable_cli=0 -d opcache.enable=0
	custom_apps/audiocheck/vendor/bin/phpunit
	-c custom_apps/audiocheck/phpunit.xml
	--filter 'TrackFileIdsIntegrationTest|ListTracksQueryIntegrationTest')

run_unit() {
	( cd "$ROOT" && "${PHPUNIT[@]}" ) >/tmp/ac-fileids-mut.out 2>&1
	return $?
}

echo "Baseline…"
if ! run_unit; then
	cat /tmp/ac-fileids-mut.out
	echo "Baseline failed" >&2
	exit 1
fi

python3 - "$APP" <<'PY'
import pathlib, subprocess, sys

app = pathlib.Path(sys.argv[1])
root = app.parent.parent
library = (app / "lib/Service/LibraryService.php").read_text()
path = app / "lib/Service/LibraryService.php"

mutations = [
    ("fetch loop yields nothing",
     "\t\t$qb->selectDistinct('t.file_id');\n\t\t$result = $qb->executeQuery();\n\t\t$fileIds = [];\n\t\twhile ($row = $result->fetch()) {\n\t\t\t$fileIds[] = (int)$row['file_id'];\n\t\t}",
     "\t\t$qb->selectDistinct('t.file_id');\n\t\t$result = $qb->executeQuery();\n\t\t$fileIds = [];\n\t\twhile ($row = $result->fetch()) {\n\t\t\tif (false) {\n\t\t\t\t$fileIds[] = (int)$row['file_id'];\n\t\t\t}\n\t\t}"),
    ("ids coerced to zero",
     "\t\twhile ($row = $result->fetch()) {\n\t\t\t$fileIds[] = (int)$row['file_id'];\n\t\t}\n\t\t$result->closeCursor();\n\n\t\treturn ['fileIds' => $fileIds, 'total' => count($fileIds)];",
     "\t\twhile ($row = $result->fetch()) {\n\t\t\t$fileIds[] = 0;\n\t\t}\n\t\t$result->closeCursor();\n\n\t\treturn ['fileIds' => $fileIds, 'total' => count($fileIds)];"),
    ("total off by one",
     "\t\treturn ['fileIds' => $fileIds, 'total' => count($fileIds)];",
     "\t\treturn ['fileIds' => $fileIds, 'total' => count($fileIds) + 1];"),
    ("empty-set short-circuit unconditional",
     "\t\tif ($qb === null) {\n\t\t\treturn ['fileIds' => [], 'total' => 0];\n\t\t}",
     "\t\treturn ['fileIds' => [], 'total' => 0];"),
    ("wrong id column",
     "\t\t$qb->selectDistinct('t.file_id');\n\t\t$result = $qb->executeQuery();",
     "\t\t$qb->selectDistinct('t.id');\n\t\t$result = $qb->executeQuery();"),
]

def run_unit():
    cmd = [
        "docker", "compose", "-f", str(root / "docker-compose.yml"),
        "exec", "-u", "www-data", "-e", "NEXTCLOUD_ROOT=/var/www/html", "nextcloud",
        "php", "-d", "opcache.enable_cli=0", "-d", "opcache.enable=0",
        "custom_apps/audiocheck/vendor/bin/phpunit",
        "-c", "custom_apps/audiocheck/phpunit.xml",
        "--filter", "TrackFileIdsIntegrationTest|ListTracksQueryIntegrationTest",
    ]
    return subprocess.run(cmd, cwd=root, capture_output=True, text=True)

failed = 0
for i, (label, frm, to) in enumerate(mutations):
    if frm not in library:
        print(f"Mutation #{i} ({label}): from-snippet not found", file=sys.stderr)
        failed += 1
        continue
    if library.count(frm) != 1:
        print(f"Mutation #{i} ({label}): expected 1 occurrence", file=sys.stderr)
        failed += 1
        continue
    path.write_text(library.replace(frm, to, 1))
    print(f"Mutation #{i}: {label} — expect FAIL…")
    proc = run_unit()
    path.write_text(library)
    if proc.returncode == 0:
        print(f"Mutation #{i} SURVIVED\n{proc.stdout}\n{proc.stderr}", file=sys.stderr)
        failed += 1
    else:
        print("  killed.")

path.write_text(library)

if failed:
    print(f"Track-file-ids mutations: {failed} failure(s)", file=sys.stderr)
    sys.exit(1)
print("Track-file-ids mutations: all killed.")
PY
