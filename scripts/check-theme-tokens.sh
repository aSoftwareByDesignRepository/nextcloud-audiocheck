#!/usr/bin/env bash
# Guard: theme-dependent --ac-* tokens must be scoped to body / app shell (Nextcloud sets --color-* on body[data-theme-*]).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CSS="$ROOT/css/app.css"

if ! grep -qE '^body,' "$CSS" && ! grep -qE '^body \{' "$CSS"; then
	echo "check-theme-tokens: css/app.css must define theme tokens on body { ... }" >&2
	exit 1
fi

if ! grep -qF '#content[class*="app-audiocheck"]' "$CSS"; then
	echo "check-theme-tokens: theme tokens must also be scoped to #content[class*=\"app-audiocheck\"]" >&2
	exit 1
fi

if ! grep -qF '#app-content.ac-app' "$CSS"; then
	echo "check-theme-tokens: theme tokens must be re-bound on #app-content.ac-app" >&2
	exit 1
fi

theme_blocks=$(awk '
	/^body,|^body \{|^#content\[class\*="app-audiocheck"\]|^#app-content\.ac-app \{/ { inblock=1; block="" }
	inblock { block = block $0 "\n" }
	/^\}/ && inblock { print block; inblock=0; block="" }
' "$CSS")

for token in --ac-bg-soft --ac-bg-card --ac-surface --ac-muted --ac-text; do
	if ! echo "$theme_blocks" | grep -F -q -- "$token"; then
		echo "check-theme-tokens: theme scope missing $token" >&2
		exit 1
	fi
done

root_block=$(awk '/^:root \{/,/^\}/' "$CSS")
if echo "$root_block" | grep -qE '^\s*--ac-(bg|muted|text|surface|border|shadow)'; then
	echo "check-theme-tokens: :root must not define theme-derived --ac-* tokens" >&2
	exit 1
fi

if echo "$theme_blocks" | grep -qE '^\s*--ac-muted-strong:.*97%'; then
	echo "check-theme-tokens: --ac-muted-strong must not use 97% main-text mix" >&2
	exit 1
fi

echo "theme token scope OK"
