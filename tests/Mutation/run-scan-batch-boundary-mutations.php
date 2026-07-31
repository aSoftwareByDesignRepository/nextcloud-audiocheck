<?php

declare(strict_types=1);

/**
 * Mutation gauntlet for ScanService batch-boundary pause control flow.
 *
 * Usage (from app root, inside Docker when applicable):
 *   php tests/Mutation/run-scan-batch-boundary-mutations.php
 *
 * @copyright Copyright (c) 2026, Software by Design GbR
 * @license AGPL-3.0-or-later
 */

$appRoot = dirname(__DIR__, 2);
$source = $appRoot . '/lib/Service/ScanService.php';
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
		. ' --filter ScanServiceBatchingTest';
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
	fwrite(STDERR, "Missing ScanService.php\n");
	exit(1);
}

if (is_file($lock)) {
	fwrite(STDERR, "Another mutation run holds .mutation.lock\n");
	exit(1);
}
file_put_contents($lock, (string)getmypid());

echo "== baseline ScanServiceBatchingTest ==\n";
$baseline = run_unit_tests($appRoot, $phpunit);
if ($baseline !== 0) {
	@unlink($lock);
	fwrite(STDERR, "Baseline tests must pass before mutation run\n");
	exit(1);
}

$mutations = [
	'pause_even_when_root_done' => [
		'from' => "\t\t\t\t\tif (\$processed >= self::SCAN_BATCH_SIZE && !\$batch['done']) {\n"
			. "\t\t\t\t\t\t\$this->pauseScanBatch(\$userId, \$scanGen, \$ri, \$walkStack);\n"
			. "\t\t\t\t\t\treturn;\n"
			. "\t\t\t\t\t}",
		'to' => "\t\t\t\t\tif (\$processed >= self::SCAN_BATCH_SIZE) {\n"
			. "\t\t\t\t\t\t\$this->pauseScanBatch(\$userId, \$scanGen, \$ri, \$walkStack);\n"
			. "\t\t\t\t\t\treturn;\n"
			. "\t\t\t\t\t}",
	],
	'skip_between_root_budget_check' => [
		'from' => "\t\t\t\tif (\$processed >= self::SCAN_BATCH_SIZE) {\n"
			. "\t\t\t\t\t\$this->pauseScanBatch(\$userId, \$scanGen, \$ri, \$walkStack);\n"
			. "\t\t\t\t\treturn;\n"
			. "\t\t\t\t}\n"
			. "\t\t\t\tdo {",
		'to' => "\t\t\t\tdo {",
	],
	'resume_on_bare_scangen' => [
		'from' => "\t\t\$isResume = \$cursor['scanGen'] > 0\n"
			. "\t\t\t&& (\$cursor['walkStack'] !== [] || \$cursor['rootIdx'] > 0);",
		'to' => "\t\t\$isResume = \$cursor['scanGen'] > 0;",
	],
	'drop_scangen_bump' => [
		'from' => "\t\tif (!\$isResume) {\n"
			. "\t\t\t// Strictly newer than any existing last_seen_at so same-second\n"
			. "\t\t\t// handleNodeEvent upserts are still pruned if the file vanishes.\n"
			. "\t\t\t\$scanGen = max(\$scanGen, \$this->maxTrackLastSeen(\$userId) + 1);\n"
			. "\t\t}",
		'to' => "\t\tif (false && !\$isResume) {\n"
			. "\t\t\t\$scanGen = max(\$scanGen, \$this->maxTrackLastSeen(\$userId) + 1);\n"
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

echo "\nAll scan batch-boundary mutations killed.\n";
exit(0);
