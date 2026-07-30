<?php

declare(strict_types=1);

/**
 * Lightweight mutation gauntlet for ScanService::handleRename.
 *
 * Usage (from app root, inside Docker when applicable):
 *   php tests/Mutation/run-scan-service-rename-mutations.php
 *
 * @copyright Copyright (c) 2026, Software by Design GbR
 * @license AGPL-3.0-or-later
 */

$appRoot = dirname(__DIR__, 2);
$source = $appRoot . '/lib/Service/ScanService.php';
$backup = $source . '.mutation-bak';
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
		. ' --filter ScanServiceRenameTest';
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

echo "== baseline ScanServiceRenameTest ==\n";
$baseline = run_unit_tests($appRoot, $phpunit);
if ($baseline !== 0) {
	fwrite(STDERR, "Baseline tests must pass before mutation run\n");
	exit(1);
}

$mutations = [
	'skip_cross_storage_purge' => [
		'from' => "\t\tif (\$target instanceof File && \$this->fileAccess->isAllowedAudioFile(\$target)) {\n\t\t\tif (\$sourceId !== null && \$targetId !== null && \$sourceId !== \$targetId) {\n\t\t\t\t\$this->deleteTrackForFile(\$userId, \$sourceId);\n\t\t\t}\n\t\t\t\$this->handleNodeEvent(\$userId, \$target, 'written');\n\t\t\treturn;\n\t\t}",
		'to' => "\t\tif (\$target instanceof File && \$this->fileAccess->isAllowedAudioFile(\$target)) {\n\t\t\t\$this->handleNodeEvent(\$userId, \$target, 'written');\n\t\t\treturn;\n\t\t}",
	],
	'never_delete_non_audio' => [
		'from' => "\t\t// Non-audio file: drop any index rows for the involved file id(s).\n\t\tif (\$sourceId !== null) {\n\t\t\t\$this->deleteTrackForFile(\$userId, \$sourceId);\n\t\t}\n\t\tif (\$targetId !== null && \$targetId !== \$sourceId) {\n\t\t\t\$this->deleteTrackForFile(\$userId, \$targetId);\n\t\t}",
		'to' => "\t\treturn;",
	],
	'folder_falls_through_to_delete' => [
		'from' => "\t\tif (\$target instanceof Folder) {\n\t\t\t\$this->rewritePathsAfterFolderMove(\$userId, \$source, \$target);\n\t\t\treturn;\n\t\t}",
		'to' => "\t\tif (false && \$target instanceof Folder) {\n\t\t\t\$this->rewritePathsAfterFolderMove(\$userId, \$source, \$target);\n\t\t\treturn;\n\t\t}",
	],
	'defer_library_id_to_scan' => [
		'from' => "\t\t\$this->rewriteLibraryPathPrefixes(\$userId, \$oldRel, \$newRel, \$targetId);\n\t\t\$this->rewriteTrackPathsAndLibraryIds(\$userId, \$oldRel, \$newRel);\n\n\t\t// Discover audio that entered a library via the move (no prior ac_tracks row).\n\t\tif (\$target instanceof Folder) {\n\t\t\t\$this->indexFolderIntoLibraries(\$userId, \$target);\n\t\t}",
		'to' => "\t\t\$this->rewriteLibraryPathPrefixes(\$userId, \$oldRel, \$newRel, \$targetId);\n\t\t\$this->rewriteTrackPathsAndLibraryIds(\$userId, \$oldRel, \$newRel);\n\t\t\$this->queueScan(\$userId);",
	],
	'ignore_empty_user_gate' => [
		'from' => "\t\tif (\$userId === '') {\n\t\t\treturn;\n\t\t}\n\n\t\tif (\$target instanceof Folder) {",
		'to' => "\t\tif (\$target instanceof Folder) {",
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
		// handleRename and handleNodeEvent both have empty-user gates; replace only first in handleRename context via count limit.
		if ($name === 'ignore_empty_user_gate') {
			$pos = strpos($contents, 'public function handleRename');
			if ($pos === false) {
				$failedToKill[] = $name . ' (handleRename missing)';
				continue;
			}
			$chunk = substr($contents, $pos);
			if (!str_contains($chunk, $mutation['from'])) {
				$failedToKill[] = $name . ' (anchor missing in handleRename)';
				continue;
			}
			$chunkMut = str_replace($mutation['from'], $mutation['to'], $chunk);
			$mutated = substr($contents, 0, $pos) . $chunkMut;
		}
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
}

if ($failedToKill !== []) {
	fwrite(STDERR, "\nMutation gauntlet FAILED — survivors: " . implode(', ', $failedToKill) . "\n");
	exit(1);
}

echo "\nAll ScanService rename mutations killed.\n";
exit(0);
