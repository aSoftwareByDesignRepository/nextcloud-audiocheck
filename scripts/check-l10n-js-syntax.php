<?php

declare(strict_types=1);

/**
 * Fail CI when l10n/*.js is not a valid OC.L10N.register(app, map, pluralString) script.
 */
$base = dirname(__DIR__) . '/l10n';
$files = glob($base . '/*.js') ?: [];
if ($files === []) {
	fwrite(STDERR, "No l10n/*.js files found\n");
	exit(1);
}

$failed = 0;
foreach ($files as $path) {
	$src = (string)file_get_contents($path);
	$name = basename($path);
	if (preg_match('/["\']pluralForm["\']\s*:/', $src) === 1) {
		fwrite(STDERR, "{$name}: illegal pluralForm object key in OC.L10N.register call\n");
		$failed++;
		continue;
	}
	if (preg_match('/\},\s*"nplurals=\d+;\s*plural=\([^"]+\)\s*;"\s*\)\s*;\s*$/', $src) !== 1) {
		fwrite(STDERR, "{$name}: missing valid plural string third argument\n");
		$failed++;
		continue;
	}
	$cmd = 'node -e ' . escapeshellarg(
		'try { new Function(require("fs").readFileSync(process.argv[1], "utf8")); }'
		. ' catch (e) { console.error(e.message); process.exit(1); }'
	) . ' ' . escapeshellarg($path);
	exec($cmd . ' 2>&1', $out, $code);
	if ($code !== 0) {
		fwrite(STDERR, "{$name}: JS parse failed: " . implode(' ', $out) . "\n");
		$failed++;
	}
}

if ($failed > 0) {
	exit(1);
}
echo "l10n JS syntax OK\n";
