<?php

declare(strict_types=1);

/**
 * post-autoload-dump hook.
 *
 * 1. Runs Strauss when dev dependencies are installed (vendor/bin/strauss
 *    only exists then). Strauss copies getID3 into vendor-prefixed/ with all
 *    global classes renamed `AudioCheck_*` — shipping the library's global
 *    namespace unprefixed fatals "Cannot redeclare class" on instances where
 *    another app vendors the same library (GH issue #14, music app).
 *
 * 2. Always removes Strauss's dev-only alias autoloader (it lazily declares
 *    classes under their ORIGINAL names — would reintroduce the collision)
 *    and strips james-heinrich entries from the generated classmaps so the
 *    original global names are unreachable via our autoloader. The original
 *    files stay installed (composer reinstalls anything deleted) but can
 *    never be served; `make release` excludes them from the archive.
 *
 * 3. A bare `composer install --no-dev` on a clean checkout can never
 *    produce vendor-prefixed/ (Strauss is a dev tool); fail loudly instead
 *    of shipping an autoloader without getID3. Release/CI must run a full
 *    `composer install` first, then `composer install --no-dev`.
 *
 * SPDX-FileCopyrightText: 2026 Alexander Mäule <info@software-by-design.de>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

$root = dirname(__DIR__);
$strauss = $root . '/vendor/bin/strauss';
$prefixed = $root . '/vendor-prefixed/autoload.php';

if (is_file($strauss)) {
	passthru(PHP_BINARY . ' ' . escapeshellarg($strauss), $exitCode);
	if ($exitCode !== 0) {
		exit($exitCode);
	}
} elseif (!is_file($prefixed)) {
	fwrite(STDERR, "audiocheck: vendor-prefixed/ missing — run 'composer install' (with dev deps) once so Strauss generates it, then re-run --no-dev.\n");
	exit(1);
}

@unlink($root . '/vendor/composer/autoload_alias.php');
@unlink($root . '/vendor/composer/autoload_aliases.php');

// Strauss rewrites declared names only — dynamic class construction
// (`'getid3_'.$module`, `'getid3_'.$tag_name`) keeps the original names and
// fatals at runtime (proven: analyze() → "Class getid3_id3v2 not found").
// Rewrite those string literals to the prefixed names.
$iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root . '/vendor-prefixed', FilesystemIterator::SKIP_DOTS));
foreach ($iterator as $file) {
	if ($file->getExtension() !== 'php') {
		continue;
	}
	$src = file_get_contents($file->getPathname());
	$patched = str_replace("'getid3_'", "'AudioCheck_getid3_'", $src);
	if ($patched !== $src) {
		file_put_contents($file->getPathname(), $patched);
	}
}

// Refuse to serve a stale prefixed build: if the installed getid3 version
// moved since Strauss last ran (e.g. --no-dev update with dev deps absent),
// the prefixed copy no longer matches the lock. Require a full
// `composer install` to regenerate instead of silently shipping old code.
$installed = include $root . '/vendor/composer/installed.php';
$prefixedInstalled = is_file($root . '/vendor-prefixed/composer/installed.php')
	? include $root . '/vendor-prefixed/composer/installed.php'
	: [];
$want = $installed['versions']['james-heinrich/getid3']['pretty_version'] ?? null;
$have = $prefixedInstalled['versions']['james-heinrich/getid3']['pretty_version'] ?? null;
if ($want !== null && $want !== $have) {
	fwrite(STDERR, "audiocheck: vendor-prefixed getID3 is $have but composer requires $want — run 'composer install' (with dev deps) to regenerate.\n");
	exit(1);
}

// Strip every autoload-map entry pointing at the unprefixed package so the
// original global class names (getID3, getid3_*, …) are never loadable
// through our autoloader — only AudioCheck_* from vendor-prefixed/ is.
// Covers classmap/static plus psr4/namespaces/files in case a future
// getid3 release changes its autoload scheme.
foreach (['autoload_classmap.php', 'autoload_static.php', 'autoload_psr4.php', 'autoload_namespaces.php', 'autoload_files.php'] as $file) {
	$path = $root . '/vendor/composer/' . $file;
	if (!is_file($path)) {
		continue;
	}
	$lines = file($path);
	$kept = array_filter($lines, static fn(string $line): bool => stripos($line, 'james-heinrich') === false);
	if (count($kept) !== count($lines)) {
		file_put_contents($path, implode('', $kept));
	}
}
