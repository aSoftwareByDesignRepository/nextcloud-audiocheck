#!/usr/bin/env bash
# AC-FA static guards (§9.13): file access must stay in FileAccessService.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VIOLATIONS=0
PATTERN='getUserFolder\(|->getById\(|->fopen\(|getLocalFile\('
while IFS= read -r -d '' f; do
	case "$f" in
		*/lib/Service/FileAccessService.php) continue ;;
		*/tests/Integration/*) continue ;;
		*/vendor/*) continue ;;
	esac
	if grep -nE "$PATTERN" "$f" >/tmp/ac-gate.txt 2>/dev/null; then
		echo "FORBIDDEN pattern in $f:"
		cat /tmp/ac-gate.txt
		VIOLATIONS=$((VIOLATIONS + 1))
	fi
done < <(find "$ROOT/lib" "$ROOT/tests" -name '*.php' -print0 2>/dev/null)
if [[ "$VIOLATIONS" -gt 0 ]]; then
	echo "File-access gate FAILED ($VIOLATIONS file(s))"
	exit 1
fi
echo "File-access gate OK"
