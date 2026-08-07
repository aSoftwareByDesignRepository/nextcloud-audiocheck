<?php

declare(strict_types=1);

/**
 * Mutation gauntlet for ScanCursor compact encode/decode.
 *
 * Usage (from app root, inside Docker when applicable):
 *   php tests/Mutation/run-scan-cursor-mutations.php
 *
 * @copyright Copyright (c) 2026, Software by Design GbR
 * @license AGPL-3.0-or-later
 */

$appRoot = dirname(__DIR__, 2);
$source = $appRoot . '/lib/Service/ScanCursor.php';
$backup = $source . '.mutation-bak';
$lock = $appRoot . '/.mutation.lock';
$phpunit = $appRoot . '/vendor/bin/phpunit';
if (!is_file($phpunit)) {
	$phpunit = 'phpunit';
}

function run_unit_tests(string $appRoot, string $phpunit): int
{
	$cmd = escapeshellarg('php')
		. ' -d opcache.enable_cli=0 -d opcache.enable=0 '
		. escapeshellarg($phpunit)
		. ' -c ' . escapeshellarg($appRoot . '/phpunit.xml')
		. ' --filter ScanCursorTest';
	passthru($cmd, $code);
	return (int)$code;
}

function restore(string $source, string $backup): void
{
	if (is_file($backup)) {
		rename($backup, $source);
	}
	if (is_file($backup)) {
		@unlink($backup);
	}
}

if (!is_file($source)) {
	fwrite(STDERR, "Missing ScanCursor.php\n");
	exit(1);
}

if (is_file($lock)) {
	fwrite(STDERR, "Another mutation run holds .mutation.lock\n");
	exit(1);
}
file_put_contents($lock, (string)getmypid());

echo "== baseline ScanCursorTest ==\n";
$baseline = run_unit_tests($appRoot, $phpunit);
if ($baseline !== 0) {
	@unlink($lock);
	fwrite(STDERR, "Baseline tests must pass before mutation run\n");
	exit(1);
}

$mutations = [
	'drop_compact_walk' => [
		'from' => "\t\t\$compact = self::compactWalkStack(\$walkStack);\n"
			. "\t\tif (\$compact !== null) {\n"
			. "\t\t\t\$payload['walk'] = \$compact;\n"
			. "\t\t}",
		'to' => "\t\t\$payload['walkStack'] = \$walkStack;",
	],
	'ignore_legacy_walk_stack' => [
		'from' => "\t\tif (isset(\$data['walk']) && is_array(\$data['walk'])) {\n"
			. "\t\t\t\$walkStack = self::expandWalk(\$data['walk']);\n"
			. "\t\t} elseif (isset(\$data['walkStack']) && is_array(\$data['walkStack'])) {\n"
			. "\t\t\t\$walkStack = self::sanitizeLegacyWalkStack(\$data['walkStack']);\n"
			. "\t\t}",
		'to' => "\t\tif (isset(\$data['walk']) && is_array(\$data['walk'])) {\n"
			. "\t\t\t\$walkStack = self::expandWalk(\$data['walk']);\n"
			. "\t\t}",
	],
	'accept_broken_prefix_chain' => [
		'from' => "\t\t\tif (\$index === 0) {\n"
			. "\t\t\t\tif (\$path !== '') {\n"
			. "\t\t\t\t\treturn null;\n"
			. "\t\t\t\t}\n"
			. "\t\t\t} else {\n"
			. "\t\t\t\t\$prefix = \$previous === '' ? '' : \$previous . '/';\n"
			. "\t\t\t\tif (!str_starts_with(\$path, \$prefix) || strlen(\$path) <= strlen(\$prefix)) {\n"
			. "\t\t\t\t\treturn null;\n"
			. "\t\t\t\t}\n"
			. "\t\t\t\tif (str_contains(substr(\$path, strlen(\$prefix)), '/')) {\n"
			. "\t\t\t\t\treturn null;\n"
			. "\t\t\t\t}\n"
			. "\t\t\t}",
		'to' => "\t\t\t// mutated: no prefix-chain validation",
	],
	'miscount_offsets_ok' => [
		'from' => "\t\tif (count(\$offsets) !== count(\$segments) + 1) {\n"
			. "\t\t\treturn [];\n"
			. "\t\t}",
		'to' => "\t\tif (false && count(\$offsets) !== count(\$segments) + 1) {\n"
			. "\t\t\treturn [];\n"
			. "\t\t}",
	],
];

$failedToKill = [];
copy($source, $backup);

try {
	foreach ($mutations as $name => $mutation) {
		echo "\n== mutation: {$name} ==\n";
		$contents = file_get_contents($backup);
		if ($contents === false) {
			fwrite(STDERR, "Cannot read backup\n");
			exit(1);
		}
		if (!str_contains($contents, $mutation['from'])) {
			fwrite(STDERR, "Mutation anchor not found for {$name}\n");
			$failedToKill[] = $name . ' (anchor missing)';
			continue;
		}
		$mutated = str_replace($mutation['from'], $mutation['to'], $contents);
		file_put_contents($source, $mutated);
		$code = run_unit_tests($appRoot, $phpunit);
		if ($code === 0) {
			$failedToKill[] = $name;
			fwrite(STDERR, "MUTATION SURVIVED: {$name}\n");
		} else {
			echo "Killed {$name}\n";
		}
		copy($backup, $source);
	}
} finally {
	restore($source, $backup);
	@unlink($lock);
}

if ($failedToKill !== []) {
	fwrite(STDERR, "\nSurviving mutations:\n- " . implode("\n- ", $failedToKill) . "\n");
	exit(1);
}

echo "\nAll ScanCursor mutations killed.\n";
exit(0);
