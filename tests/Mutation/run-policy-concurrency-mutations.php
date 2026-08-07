<?php

declare(strict_types=1);

/**
 * Mutation gauntlet for AccessControlService section-scoped policy saves.
 *
 * Baseline must pass; then known-bad source mutations must make
 * AccessControlPolicyConcurrencyTest fail.
 *
 * Usage (Docker):
 *   docker compose exec -u www-data -e NEXTCLOUD_ROOT=/var/www/html nextcloud \
 *     php custom_apps/audiocheck/tests/Mutation/run-policy-concurrency-mutations.php
 */

$appRoot = dirname(__DIR__, 2);
$source = $appRoot . '/lib/Service/AccessControlService.php';
$backup = $source . '.mutation-bak';
$phpunit = $appRoot . '/vendor/bin/phpunit';
if (!is_file($phpunit)) {
	$phpunit = 'phpunit';
}

function run_unit_tests(string $appRoot, string $phpunit): int {
	$cmd = escapeshellarg('php')
		. ' -d opcache.enable_cli=0 -d opcache.enable=0 '
		. escapeshellarg($phpunit)
		. ' -c ' . escapeshellarg($appRoot . '/phpunit.xml')
		. ' --filter AccessControlPolicyConcurrencyTest';
	passthru($cmd, $code);
	return (int)$code;
}

function restore(string $source, string $backup): void {
	if (!is_file($backup)) {
		return;
	}
	// Prefer content copy over rename so a www-data-owned backup does not
	// replace the bind-mounted source inode with a root/www-data-only path.
	$contents = (string)file_get_contents($backup);
	file_put_contents($source, $contents);
	@unlink($backup);
}

if (!is_file($source)) {
	fwrite(STDERR, "Missing AccessControlService.php\n");
	exit(1);
}

echo "== baseline AccessControlPolicyConcurrencyTest ==\n";
$baseline = run_unit_tests($appRoot, $phpunit);
if ($baseline !== 0) {
	fwrite(STDERR, "Baseline tests must pass before mutation run\n");
	exit(1);
}

$mutations = [
	'ignore_section_scope' => [
		'from' => "\$sectionScoped = \$section !== null && \$section !== '';",
		'to' => "\$sectionScoped = false;",
	],
	'skip_version_check' => [
		'from' => "if (\$clientVersion !== \$currentVersion) {\n\t\t\t\tthrow new ConflictException('Policy was changed elsewhere. Reload and try again.');\n\t\t\t}",
		'to' => "if (false && \$clientVersion !== \$currentVersion) {\n\t\t\t\tthrow new ConflictException('Policy was changed elsewhere. Reload and try again.');\n\t\t\t}",
	],
	'never_bump_version' => [
		'from' => "\$this->bumpPolicyVersion();",
		'to' => "/* mutated: no bump */",
	],
];

$failedToKill = [];
foreach ($mutations as $name => $pair) {
	echo "== mutation: {$name} ==\n";
	copy($source, $backup);
	$src = (string)file_get_contents($source);
	if (!str_contains($src, $pair['from'])) {
		restore($source, $backup);
		fwrite(STDERR, "Mutation anchor not found for {$name}\n");
		$failedToKill[] = $name . ' (anchor missing)';
		continue;
	}
	file_put_contents($source, str_replace($pair['from'], $pair['to'], $src));
	$code = run_unit_tests($appRoot, $phpunit);
	restore($source, $backup);
	if ($code === 0) {
		$failedToKill[] = $name;
		fwrite(STDERR, "SURVIVED: {$name}\n");
	} else {
		echo "Killed {$name}\n";
	}
}

if ($failedToKill !== []) {
	fwrite(STDERR, "Mutations not killed: " . implode(', ', $failedToKill) . "\n");
	exit(1);
}

echo "All policy concurrency mutations killed\n";
exit(0);
