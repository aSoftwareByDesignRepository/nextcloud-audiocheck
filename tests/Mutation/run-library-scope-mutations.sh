#!/usr/bin/env bash
# Host-side mutation gauntlet: mutate on host, verify via Docker phpunit.
set -euo pipefail
APP="$(cd "$(dirname "$0")/../.." && pwd)"
ROOT="$(cd "$APP/../.." && pwd)"
PHPUNIT=(docker compose -f "$ROOT/docker-compose.yml" exec -u www-data -e NEXTCLOUD_ROOT=/var/www/html nextcloud
	php -d opcache.enable_cli=0 -d opcache.enable=0
	custom_apps/audiocheck/vendor/bin/phpunit
	-c custom_apps/audiocheck/phpunit.xml
	--filter 'ScanServiceLibraryScopeTest|LibraryServiceLibraryScopeTest|LibraryServiceFolderFacetTest|ApiLibraryScopeContractTest')

run_unit() {
	( cd "$ROOT" && "${PHPUNIT[@]}" ) >/tmp/ac-scope-mut.out 2>&1
	return $?
}

echo "Baseline…"
if ! run_unit; then
	cat /tmp/ac-scope-mut.out
	echo "Baseline failed" >&2
	exit 1
fi

python3 - "$APP" <<'PY'
import pathlib, re, subprocess, sys, tempfile, os

app = pathlib.Path(sys.argv[1])
root = app.parent.parent
scan = (app / "lib/Service/ScanService.php").read_text()
library = (app / "lib/Service/LibraryService.php").read_text()
api = (app / "lib/Controller/ApiController.php").read_text()
originals = {"scan": scan, "library": library, "api": api}
paths = {
    "scan": app / "lib/Service/ScanService.php",
    "library": app / "lib/Service/LibraryService.php",
    "api": app / "lib/Controller/ApiController.php",
}

mutations = [
    ("scan", "remove out-of-library early return",
     "\t\t\tif ($libraryId < 1) {\n\t\t\t\t// Outside every enabled library (or no libraries): never index.\n\t\t\t\t$fileId = $this->safeNodeId($node);\n\t\t\t\tif ($fileId !== null) {\n\t\t\t\t\t$this->deleteTrackForFile($userId, $fileId);\n\t\t\t\t}\n\t\t\t\treturn;\n\t\t\t}",
     "\t\t\tif ($libraryId < 0) {\n\t\t\t\t$fileId = $this->safeNodeId($node);\n\t\t\t\tif ($fileId !== null) {\n\t\t\t\t\t$this->deleteTrackForFile($userId, $fileId);\n\t\t\t\t}\n\t\t\t\treturn;\n\t\t\t}"),
    ("library", "weaken join to leftJoin without enabled",
     "\t\t$qb->innerJoin($trackAlias, 'ac_libraries', 'lib', $qb->expr()->andX(\n\t\t\t$qb->expr()->eq('lib.id', $trackAlias . '.library_id'),\n\t\t\t$qb->expr()->eq('lib.user_id', $trackAlias . '.user_id'),\n\t\t\t$qb->expr()->eq('lib.enabled', $qb->createNamedParameter(1, \\PDO::PARAM_INT)),\n\t\t));",
     "\t\t$qb->leftJoin($trackAlias, 'ac_libraries', 'lib', $qb->expr()->andX(\n\t\t\t$qb->expr()->eq('lib.id', $trackAlias . '.library_id'),\n\t\t\t$qb->expr()->eq('lib.user_id', $trackAlias . '.user_id'),\n\t\t));"),
    ("library", "drop folder facet scope gate",
     "\t\t\t\t\tif ($this->isFolderFacetPathInScope($current, $libraryRoots)) {\n\t\t\t\t\t\t$items[$current] = ($items[$current] ?? 0) + $count;\n\t\t\t\t\t}",
     "\t\t\t\t\t$items[$current] = ($items[$current] ?? 0) + $count;"),
    ("api", "skip purge on removeLibrary",
     "\t\t\t$this->library->removeLibrary($userId, $id);\n\t\t\t// Drop catalog rows that no longer belong to any enabled library.\n\t\t\t$this->scan->purgeTracksOutsideLibraries($userId);\n\t\t\treturn [];",
     "\t\t\t$this->library->removeLibrary($userId, $id);\n\t\t\treturn [];"),
    ("scan", "empty roots without purge",
     "\t\t\tif ($roots === []) {\n\t\t\t\t// No configured libraries ⇒ empty catalog. Never fall back to the\n\t\t\t\t// whole user home (admin default_library_folder is a picker hint only).\n\t\t\t\t$this->purgeTracksOutsideLibraries($userId);\n\t\t\t\t$this->metadata->garbageCollectOrphans();\n\t\t\t\t$this->clearCursor($userId);\n\t\t\t\t$this->setStatus($userId, self::STATUS_IDLE, null, $now, 0);\n\t\t\t\treturn;\n\t\t\t}",
     "\t\t\tif ($roots === []) {\n\t\t\t\t$this->clearCursor($userId);\n\t\t\t\t$this->setStatus($userId, self::STATUS_IDLE, null, $now, 0);\n\t\t\t\treturn;\n\t\t\t}"),
    ("scan", "upsertTrack allows unresolved library",
     "\t\tif ($resolved === null) {\n\t\t\t// Never persist out-of-library audio — callers should already skip,\n\t\t\t// but harden against races and future entry points.\n\t\t\t$this->deleteTrackForFile($userId, (int)$file->getId());\n\t\t\treturn;\n\t\t}",
     "\t\tif (false) {\n\t\t\t$this->deleteTrackForFile($userId, (int)$file->getId());\n\t\t\treturn;\n\t\t}"),
]

def run_unit():
    cmd = [
        "docker", "compose", "-f", str(root / "docker-compose.yml"),
        "exec", "-u", "www-data", "-e", "NEXTCLOUD_ROOT=/var/www/html", "nextcloud",
        "php", "-d", "opcache.enable_cli=0", "-d", "opcache.enable=0",
        "custom_apps/audiocheck/vendor/bin/phpunit",
        "-c", "custom_apps/audiocheck/phpunit.xml",
        "--filter", "ScanServiceLibraryScopeTest|LibraryServiceLibraryScopeTest|LibraryServiceFolderFacetTest|ApiLibraryScopeContractTest",
    ]
    return subprocess.run(cmd, cwd=root, capture_output=True, text=True)

failed = 0
for i, (key, label, frm, to) in enumerate(mutations):
    src = originals[key]
    if frm not in src:
        print(f"Mutation #{i} ({label}): from-snippet not found", file=sys.stderr)
        failed += 1
        continue
    if src.count(frm) != 1:
        print(f"Mutation #{i} ({label}): expected 1 occurrence", file=sys.stderr)
        failed += 1
        continue
    paths[key].write_text(src.replace(frm, to, 1))
    print(f"Mutation #{i}: {label} — expect FAIL…")
    proc = run_unit()
    paths[key].write_text(originals[key])
    if proc.returncode == 0:
        print(f"Mutation #{i} SURVIVED\n{proc.stdout}\n{proc.stderr}", file=sys.stderr)
        failed += 1
    else:
        print("  killed.")

for key, text in originals.items():
    paths[key].write_text(text)

if failed:
    print(f"Library-scope mutations: {failed} failure(s)", file=sys.stderr)
    sys.exit(1)
print("Library-scope mutations: all killed.")
PY
