<?php

declare(strict_types=1);

/**
 * Mutation gauntlet for MetadataService disc/chapter folder inference.
 *
 * Usage (from app root, inside Docker when applicable):
 *   php tests/Mutation/run-metadata-disc-folder-mutations.php
 *
 * @copyright Copyright (c) 2026, Software by Design GbR
 * @license AGPL-3.0-or-later
 */

$appRoot = dirname(__DIR__, 2);
$source = $appRoot . '/lib/Service/MetadataService.php';
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
		. ' --filter MetadataDiscFolderTest';
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
	fwrite(STDERR, "Missing MetadataService.php\n");
	exit(1);
}

if (is_file($lock)) {
	fwrite(STDERR, "Another mutation run holds .mutation.lock\n");
	exit(1);
}
file_put_contents($lock, (string)getmypid());

echo "== baseline MetadataDiscFolderTest ==\n";
$baseline = run_unit_tests($appRoot, $phpunit);
if ($baseline !== 0) {
	@unlink($lock);
	fwrite(STDERR, "Baseline tests must pass before mutation run\n");
	exit(1);
}

$mutations = [
	'no_disc_album_collapse' => [
		'from' => "\t\t\t\t\tif (\$this->discFolderNumber(\$name) !== null) {\n"
			. "\t\t\t\t\t\t\$bookName = \$this->containingBookFolderName(\$parent);\n"
			. "\t\t\t\t\t\tif (\$bookName !== null) {\n"
			. "\t\t\t\t\t\t\treturn \$this->bound(\$bookName, 512);\n"
			. "\t\t\t\t\t\t}\n"
			. "\t\t\t\t\t}",
		'to' => "\t\t\t\t\tif (false && \$this->discFolderNumber(\$name) !== null) {\n"
			. "\t\t\t\t\t\t\$bookName = \$this->containingBookFolderName(\$parent);\n"
			. "\t\t\t\t\t\tif (\$bookName !== null) {\n"
			. "\t\t\t\t\t\t\treturn \$this->bound(\$bookName, 512);\n"
			. "\t\t\t\t\t\t}\n"
			. "\t\t\t\t\t}",
	],
	'loose_disc_folder_regex' => [
		'from' => "\t\tif (!preg_match('/^(?:cd|disc|disk|part|chapter|kapitel|teil)[\\s._-]*0*(\\d{1,4})$/i', trim(\$folderName), \$m)) {\n"
			. "\t\t\treturn null;\n"
			. "\t\t}",
		'to' => "\t\tif (!preg_match('/(?:cd|disc|disk|part|chapter|kapitel|teil)[\\s._-]*0*(\\d{1,4})/i', trim(\$folderName), \$m)) {\n"
			. "\t\t\treturn null;\n"
			. "\t\t}",
	],
	'allow_disc_zero' => [
		'from' => "\t\treturn \$number > 0 ? \$number : null;",
		'to' => "\t\treturn \$number >= 0 ? \$number : null;",
	],
	'treat_files_as_book' => [
		'from' => "\t\tif (\$name === '' || \$name === '.' || \$name === 'files') {\n"
			. "\t\t\treturn null;\n"
			. "\t\t}",
		'to' => "\t\tif (\$name === '' || \$name === '.') {\n"
			. "\t\t\treturn null;\n"
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

echo "\nAll MetadataDiscFolder mutations killed.\n";
exit(0);
