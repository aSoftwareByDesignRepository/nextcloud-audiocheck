#!/usr/bin/env bash
# Guard: feature CSS must not hardcode HEX/RGB brand colours (mask #000 for CSS masks is allowed).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CSS="$ROOT/css/app.css"
BIND="$ROOT/css/theme-bind.css"
errors=0

check_file() {
	local file="$1"
	# Strip mask/radial-gradient mask alpha stops using #000 / #fff (not painted colours).
	local filtered
	filtered=$(grep -vE '(-webkit-)?mask(-image)?:|mask:' "$file" || true)
	if echo "$filtered" | grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(' >/tmp/ac-hex-hits.txt; then
		echo "check-hardcoded-colors: forbidden colour literals in $file:" >&2
		cat /tmp/ac-hex-hits.txt >&2
		errors=1
	fi
}

check_file "$CSS"
check_file "$BIND"

# Tint tokens must mix INTO main-background (not transparent) so they remain visible in every theme.
if grep -nE -- '--ac-tint-(info|success|warning|danger):[^;]*transparent' "$CSS" "$BIND"; then
	echo "check-hardcoded-colors: --ac-tint-* must mix into --color-main-background, not transparent" >&2
	errors=1
fi

# Success ink must not use hardcoded green fallbacks.
if grep -nE -- 'color-success[^;]*#2[ed]7' "$CSS"; then
	echo "check-hardcoded-colors: remove hardcoded success HEX fallbacks" >&2
	errors=1
fi

if [[ "$errors" -ne 0 ]]; then
	exit 1
fi
echo "hardcoded colour gate OK"
