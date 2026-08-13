<?php

declare(strict_types=1);

/**
 * Mutation gauntlet for App settings nav expand/collapse.
 *
 * Baseline: CSS + JS contract tests must pass.
 * Then apply known-bad mutations and assert the suite fails.
 *
 * PHPUnit boots Nextcloud (needs DB) → prefer docker compose exec.
 * Node JS contracts run on the host (node is not in the Nextcloud image).
 *
 * Usage from repo (host):
 *   php nextcloud/apps/audiocheck/tests/Mutation/run-nav-settings-expand-mutations.php
 *
 * @copyright Copyright (c) 2026, Software by Design GbR
 * @license AGPL-3.0-or-later
 */

$appRoot = dirname(__DIR__, 2);
$workspaceRoot = dirname($appRoot, 2); // .../nextcloud
$css = $appRoot . '/css/app.css';
$js = $appRoot . '/js/common/router.js';

/**
 * @return int
 */
function run_php_contracts(string $appRoot, string $workspaceRoot): int {
	$filter = 'DesignSystemCssContractTest::testNavChildrenHiddenBeatsAuthorDisplayFlex'
		. '|SettingsPagesContractTest::testAppSettingsNavExpandsOnlyWhenActive'
		. '|SettingsPagesContractTest::testNavigationSupportsSettingsChildren';
	$insideContainer = is_file('/var/www/html/lib/base.php');
	if ($insideContainer) {
		$phpunit = is_file($appRoot . '/vendor/bin/phpunit')
			? $appRoot . '/vendor/bin/phpunit'
			: 'phpunit';
		$cmd = 'php -d opcache.enable_cli=0 -d opcache.enable=0 '
			. escapeshellarg($phpunit)
			. ' -c ' . escapeshellarg($appRoot . '/phpunit.xml')
			. ' --filter ' . escapeshellarg($filter);
	} else {
		$cmd = 'docker compose -f ' . escapeshellarg($workspaceRoot . '/docker-compose.yml')
			. ' exec -u www-data -T nextcloud php -d opcache.enable_cli=0 -d opcache.enable=0 '
			. '/var/www/html/custom_apps/audiocheck/vendor/bin/phpunit '
			. '-c /var/www/html/custom_apps/audiocheck/phpunit.xml '
			. '--filter ' . escapeshellarg($filter);
	}
	passthru($cmd, $code);
	return (int) $code;
}

/**
 * @return int
 */
function run_js_contract(string $appRoot): int {
	$node = trim((string) shell_exec('command -v node 2>/dev/null'));
	if ($node === '') {
		fwrite(STDERR, "node not found on PATH (run this mutation script on the host)\n");
		return 127;
	}
	$cmd = escapeshellarg($node) . ' --test '
		. escapeshellarg($appRoot . '/tests/js/nav-settings-expand.test.mjs');
	passthru($cmd, $code);
	return (int) $code;
}

/**
 * @param callable():void $mutate
 * @param callable():void $restore
 * @param callable():int $run
 */
function expect_fail(string $label, callable $mutate, callable $restore, callable $run): void {
	echo "== mutate: {$label} ==\n";
	$mutate();
	try {
		$code = $run();
		if ($code === 0) {
			fwrite(STDERR, "Mutation '{$label}' was NOT caught by tests\n");
			$restore();
			exit(1);
		}
		echo "caught OK (exit {$code})\n";
	} finally {
		$restore();
	}
}

echo "== baseline php contracts ==\n";
if (run_php_contracts($appRoot, $workspaceRoot) !== 0) {
	fwrite(STDERR, "Baseline PHP contracts must pass\n");
	exit(1);
}
echo "== baseline js contract ==\n";
if (run_js_contract($appRoot) !== 0) {
	fwrite(STDERR, "Baseline JS contract must pass\n");
	exit(1);
}

$cssOrig = (string) file_get_contents($css);
$jsOrig = (string) file_get_contents($js);

expect_fail(
	'css_drop_nav_hidden_override',
	static function () use ($css, $cssOrig): void {
		$broken = preg_replace(
			'/#app-navigation\.ac-nav \.ac-nav__children\[hidden\],\s*'
			. '#app-navigation\.ac-nav \.ac-nav__item--has-children:not\(\.is-expanded\) > \.ac-nav__children \{\s*'
			. 'display:\s*none\s*!important;\s*\}/s',
			'/* MUTATED: nav children always visible */',
			$cssOrig,
			1,
			$count,
		);
		if ($count !== 1 || !is_string($broken)) {
			fwrite(STDERR, "Failed to locate CSS override for mutation\n");
			exit(1);
		}
		file_put_contents($css, $broken);
	},
	static function () use ($css, $cssOrig): void {
		file_put_contents($css, $cssOrig);
	},
	static function () use ($appRoot, $workspaceRoot): int {
		$php = run_php_contracts($appRoot, $workspaceRoot);
		$js = run_js_contract($appRoot);
		return ($php !== 0 || $js !== 0) ? 1 : 0;
	},
);

expect_fail(
	'js_force_always_expanded',
	static function () use ($js, $jsOrig): void {
		$broken = str_replace(
			"syncAppSettingsNavExpansion(li, viewId === 'app-settings');",
			'syncAppSettingsNavExpansion(li, true);',
			$jsOrig,
			$count,
		);
		if ($count !== 1) {
			fwrite(STDERR, "Failed to locate sync call for mutation\n");
			exit(1);
		}
		file_put_contents($js, $broken);
	},
	static function () use ($js, $jsOrig): void {
		file_put_contents($js, $jsOrig);
	},
	static function () use ($appRoot, $workspaceRoot): int {
		$php = run_php_contracts($appRoot, $workspaceRoot);
		$jsCode = run_js_contract($appRoot);
		return ($php !== 0 || $jsCode !== 0) ? 1 : 0;
	},
);

expect_fail(
	'js_collapse_never_sets_hidden',
	static function () use ($js, $jsOrig): void {
		$broken = str_replace(
			"kids.hidden = !open;",
			'kids.hidden = false;',
			$jsOrig,
			$count,
		);
		if ($count !== 1) {
			fwrite(STDERR, "Failed to locate kids.hidden assignment for mutation\n");
			exit(1);
		}
		file_put_contents($js, $broken);
	},
	static function () use ($js, $jsOrig): void {
		file_put_contents($js, $jsOrig);
	},
	static fn (): int => run_js_contract($appRoot),
);

echo "== all nav expand mutations caught ==\n";
exit(0);
