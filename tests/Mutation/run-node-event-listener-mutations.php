<?php

declare(strict_types=1);

/**
 * Lightweight mutation gauntlet for NodeEventListener rename/copy handling.
 *
 * Usage (from app root, inside Docker when applicable):
 *   php tests/Mutation/run-node-event-listener-mutations.php
 *
 * @copyright Copyright (c) 2026, Software by Design GbR
 * @license AGPL-3.0-or-later
 */

$appRoot = dirname(__DIR__, 2);
$source = $appRoot . '/lib/Listener/NodeEventListener.php';
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
		. ' --filter NodeEventListenerTest';
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
	fwrite(STDERR, "Missing NodeEventListener.php\n");
	exit(1);
}

echo "== baseline NodeEventListenerTest ==\n";
$baseline = run_unit_tests($appRoot, $phpunit);
if ($baseline !== 0) {
	fwrite(STDERR, "Baseline tests must pass before mutation run\n");
	exit(1);
}

$mutations = [
	'restore_getNode_on_nodes_event' => [
		'from' => "\tprivate function handleNodesEvent(Node \$source, Node \$target, string \$op): void\n\t{\n\t\t// Prefer the destination: source may be NonExisting* after rename (getOwner/getId throw).\n\t\t\$userId = \$this->ownerUid(\$target) ?? \$this->ownerUid(\$source);\n\t\tif (\$userId === null) {\n\t\t\treturn;\n\t\t}\n\n\t\tif (\$op === 'copy') {\n\t\t\t\$this->scan->handleCopy(\$userId, \$source, \$target);\n\t\t\treturn;\n\t\t}\n\t\t\$this->scan->handleRename(\$userId, \$source, \$target);\n\t}",
		'to' => "\tprivate function handleNodesEvent(Node \$source, Node \$target, string \$op): void\n\t{\n\t\t\$broken = \$source->getNode();\n\t\t\$this->scan->handleRename('x', \$broken, \$broken);\n\t}",
	],
	'drop_exception_swallow' => [
		'from' => "\tpublic function handle(Event \$event): void\n\t{\n\t\ttry {\n\t\t\t\$this->dispatch(\$event);\n\t\t} catch (\\Throwable \$e) {\n\t\t\t// Never break Files/DAV operations because of indexing side effects.\n\t\t\t\$this->logger->error('AudioCheck node listener failed', ['exception' => \$e]);\n\t\t}\n\t}",
		'to' => "\tpublic function handle(Event \$event): void\n\t{\n\t\t\$this->dispatch(\$event);\n\t}",
	],
	'skip_handleCopy' => [
		'from' => "\t\tif (\$op === 'copy') {\n\t\t\t\$this->scan->handleCopy(\$userId, \$source, \$target);\n\t\t\treturn;\n\t\t}",
		'to' => "\t\tif (\$op === 'copy') {\n\t\t\t\$this->scan->handleRename(\$userId, \$source, \$target);\n\t\t\treturn;\n\t\t}",
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
}

if ($failedToKill !== []) {
	fwrite(STDERR, "\nMutation gauntlet FAILED — survivors: " . implode(', ', $failedToKill) . "\n");
	exit(1);
}

echo "\nAll NodeEventListener mutations killed.\n";
exit(0);
