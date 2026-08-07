<?php

declare(strict_types=1);

/**
 * Mutation gauntlet for FileAccessService::walkAudioFilesBatch.
 *
 * Kills regressions of the last-sibling descent bug that skipped
 * /Audiobooks/Author/Book subtrees, plus the depth cap and non-recursive gate.
 *
 * Usage (from app root, inside Docker when applicable):
 *   php tests/Mutation/run-file-access-walker-mutations.php
 *
 * @copyright Copyright (c) 2026, Software by Design GbR
 * @license AGPL-3.0-or-later
 */

$appRoot = dirname(__DIR__, 2);
$source = $appRoot . '/lib/Service/FileAccessService.php';
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
		. ' --filter FileAccessWalkerTest';
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
	fwrite(STDERR, "Missing FileAccessService.php\n");
	exit(1);
}

if (is_file($lock)) {
	fwrite(STDERR, "Another mutation run holds .mutation.lock\n");
	exit(1);
}
file_put_contents($lock, (string)getmypid());

echo "== baseline FileAccessWalkerTest ==\n";
$baseline = run_unit_tests($appRoot, $phpunit);
if ($baseline !== 0) {
	@unlink($lock);
	fwrite(STDERR, "Baseline tests must pass before mutation run\n");
	exit(1);
}

$mutations = [
	'reintroduce_last_sibling_pop' => [
		'from' => "\t\t\t// Pop only the frame we just exhausted. When a child frame was pushed\n"
			. "\t\t\t// above, the top of the stack is that child — popping here would skip\n"
			. "\t\t\t// the entire subtree (e.g. the last book folder inside an author folder).\n"
			. "\t\t\tif (!\$descended && \$stack[\$frameIdx]['offset'] >= \$count) {\n"
			. "\t\t\t\tarray_pop(\$stack);\n"
			. "\t\t\t}",
		'to' => "\t\t\tif (\$stack[\$frameIdx]['offset'] >= \$count) {\n"
			. "\t\t\t\tarray_pop(\$stack);\n"
			. "\t\t\t}",
	],
	'never_descend_into_folders' => [
		'from' => "\t\t\t\tif (\n"
			. "\t\t\t\t\t\$recursive\n"
			. "\t\t\t\t\t&& \$depth < self::MAX_WALK_DEPTH\n"
			. "\t\t\t\t\t&& \$node instanceof Folder\n"
			. "\t\t\t\t\t&& \$node->isReadable()\n"
			. "\t\t\t\t) {",
		'to' => "\t\t\t\tif (\n"
			. "\t\t\t\t\tfalse\n"
			. "\t\t\t\t\t&& \$recursive\n"
			. "\t\t\t\t\t&& \$depth < self::MAX_WALK_DEPTH\n"
			. "\t\t\t\t\t&& \$node instanceof Folder\n"
			. "\t\t\t\t\t&& \$node->isReadable()\n"
			. "\t\t\t\t) {",
	],
	'ignore_recursive_flag' => [
		'from' => "\t\t\t\tif (\n"
			. "\t\t\t\t\t\$recursive\n"
			. "\t\t\t\t\t&& \$depth < self::MAX_WALK_DEPTH\n"
			. "\t\t\t\t\t&& \$node instanceof Folder\n"
			. "\t\t\t\t\t&& \$node->isReadable()\n"
			. "\t\t\t\t) {",
		'to' => "\t\t\t\tif (\n"
			. "\t\t\t\t\ttrue\n"
			. "\t\t\t\t\t&& \$depth < self::MAX_WALK_DEPTH\n"
			. "\t\t\t\t\t&& \$node instanceof Folder\n"
			. "\t\t\t\t\t&& \$node->isReadable()\n"
			. "\t\t\t\t) {",
	],
	'remove_depth_cap' => [
		'from' => "\t\t\t\tif (\n"
			. "\t\t\t\t\t\$recursive\n"
			. "\t\t\t\t\t&& \$depth < self::MAX_WALK_DEPTH\n"
			. "\t\t\t\t\t&& \$node instanceof Folder\n"
			. "\t\t\t\t\t&& \$node->isReadable()\n"
			. "\t\t\t\t) {",
		'to' => "\t\t\t\tif (\n"
			. "\t\t\t\t\t\$recursive\n"
			. "\t\t\t\t\t&& true\n"
			. "\t\t\t\t\t&& \$node instanceof Folder\n"
			. "\t\t\t\t\t&& \$node->isReadable()\n"
			. "\t\t\t\t) {",
	],
	'skip_audio_mime_check' => [
		'from' => "\t\t\t\tif (\$node instanceof File && \$node->isReadable() && \$this->isAllowedAudioFile(\$node)) {\n"
			. "\t\t\t\t\t\$files[] = \$node;\n"
			. "\t\t\t\t\tcontinue;\n"
			. "\t\t\t\t}",
		'to' => "\t\t\t\tif (\$node instanceof File && \$node->isReadable()) {\n"
			. "\t\t\t\t\t\$files[] = \$node;\n"
			. "\t\t\t\t\tcontinue;\n"
			. "\t\t\t\t}",
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

echo "\nAll walker mutations killed.\n";
exit(0);
