#!/usr/bin/env bash
# §9.13 / J5: v1 must not make outbound HTTP calls.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VIOLATIONS=0
PATTERN='IClientService|\\\\curl_|curl_exec\s*\(|file_get_contents\s*\(\s*['\''"]https?://|fopen\s*\(\s*['\''"]https?://'
while IFS= read -r -d '' f; do
	case "$f" in
		*/vendor/*) continue ;;
	esac
	if grep -nE "$PATTERN" "$f" >/tmp/ac-outbound.txt 2>/dev/null; then
		echo "FORBIDDEN outbound pattern in $f:"
		cat /tmp/ac-outbound.txt
		VIOLATIONS=$((VIOLATIONS + 1))
	fi
done < <(find "$ROOT/lib" "$ROOT/js" \( -name '*.php' -o -name '*.js' \) -print0 2>/dev/null)
if [[ "$VIOLATIONS" -gt 0 ]]; then
	echo "No-outbound gate FAILED ($VIOLATIONS file(s))"
	exit 1
fi
echo "No-outbound gate OK"
