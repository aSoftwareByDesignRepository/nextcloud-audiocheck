<?php

declare(strict_types=1);

/**
 * Mutation gauntlet: audiocheck l10n/*.js must stay valid OC.L10N.register calls.
 *
 * Usage (Docker from nextcloud/):
 *   docker compose exec -u www-data nextcloud php /var/www/html/custom_apps/audiocheck/tests/Mutation/run-l10n-js-syntax-mutations.php
 */

$appRoot = dirname(__DIR__, 2);
$phpunit = $appRoot . '/vendor/bin/phpunit';
if (!is_file($phpunit)) {
	$phpunit = 'phpunit';
}

$target = $appRoot . '/l10n/en.js';
$original = (string)file_get_contents($target);
if ($original === '') {
	fwrite(STDERR, "Missing {$target}\n");
	exit(1);
}

$lockPath = $appRoot . '/.mutation.lock';
$lockFh = fopen($lockPath, 'c');
if ($lockFh === false || !flock($lockFh, LOCK_EX | LOCK_NB)) {
	fwrite(STDERR, "Another mutation run holds {$lockPath} — aborting.\n");
	exit(1);
}
register_shutdown_function(static function () use ($lockFh, $lockPath, $target, $original): void {
	file_put_contents($target, $original);
	flock($lockFh, LOCK_UN);
	fclose($lockFh);
	@unlink($lockPath);
});

$run = static function () use ($appRoot, $phpunit): int {
	$cmd = escapeshellarg(PHP_BINARY)
		. ' -d opcache.enable_cli=0 -d opcache.enable=0 '
		. escapeshellarg($phpunit)
		. ' -c ' . escapeshellarg($appRoot . '/phpunit.xml')
		. ' --filter L10nJsSyntaxContractTest';
	passthru($cmd, $code);

	return (int)$code;
};

echo "==> baseline\n";
if ($run() !== 0) {
	fwrite(STDERR, "Baseline L10nJsSyntaxContractTest failed\n");
	exit(1);
}

$mutated = preg_replace(
	'/\},\s*"nplurals=\d+;\s*plural=\([^"]+\)\s*;"\s*\)\s*;\s*$/',
	'}, "pluralForm" : "nplurals=2; plural=(n != 1);");' . "\n",
	$original,
	1,
	$count,
);
if ($count !== 1 || !is_string($mutated)) {
	fwrite(STDERR, "Could not apply pluralForm mutation to en.js\n");
	exit(1);
}

echo "==> mutant: l10n_js_uses_pluralForm_object_key\n";
file_put_contents($target, $mutated);
$code = $run();
file_put_contents($target, $original);
if ($code === 0) {
	fwrite(STDERR, "SURVIVED: l10n_js_uses_pluralForm_object_key\n");
	exit(1);
}
echo "killed: l10n_js_uses_pluralForm_object_key\n";
echo "AudioCheck l10n JS mutations: all killed.\n";
exit(0);
