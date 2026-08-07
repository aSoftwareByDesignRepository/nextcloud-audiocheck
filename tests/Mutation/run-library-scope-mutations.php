<?php

declare(strict_types=1);

/**
 * Mutation gauntlet: library-scope indexing + browse filters.
 *
 * Prefer the host/Docker hybrid script (bind-mount safe writes):
 *   bash tests/Mutation/run-library-scope-mutations.sh
 *
 * This PHP entrypoint delegates to that script when available.
 */

$script = __DIR__ . '/run-library-scope-mutations.sh';
if (!is_file($script)) {
	fwrite(STDERR, "Missing {$script}\n");
	exit(1);
}

passthru('bash ' . escapeshellarg($script), $code);
exit((int)$code);
