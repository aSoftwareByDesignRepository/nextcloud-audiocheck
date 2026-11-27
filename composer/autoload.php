<?php

declare(strict_types=1);

/**
 * Nextcloud only registers Composer deps from <app>/composer/autoload.php
 * (see OC_App::registerAutoloading). Keep production packages in vendor/ and
 * bridge them here — otherwise getID3 (and any future require deps) never load.
 *
 * getID3 ships prefix-scoped in vendor-prefixed/ (Strauss, classmap_prefix
 * "AudioCheck_") because the library declares global-namespace classes —
 * shipping them unprefixed fatals "Cannot redeclare class" on any instance
 * where another app vendors the same library (see GH issue #14, music app).
 * The prefixed autoloader is loaded explicitly: Strauss's edit of
 * vendor/autoload.php does not survive composer dump-autoload regeneration.
 *
 * CRITICAL: Composer registers itself *prepended* by default. If vendor/ was
 * installed with require-dev (nextcloud/ocp stubs), a prepended loader shadows
 * the server's real OCP interfaces and can break the whole instance. Always
 * re-register appended so Nextcloud's autoloader wins for OCP and OC namespaces.
 *
 * SPDX-FileCopyrightText: 2026 Alexander Mäule <info@software-by-design.de>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

$audiocheckAppendLoader = static function (string $autoloadPath): void {
	if (!is_file($autoloadPath)) {
		return;
	}
	$loader = require $autoloadPath;
	// Strauss prefixes the ClassLoader too (OCA\AudioCheck\Vendor\Composer\…),
	// so duck-type instead of instanceof \Composer\Autoload\ClassLoader.
	if (is_object($loader) && method_exists($loader, 'unregister') && method_exists($loader, 'register')) {
		$loader->unregister();
		$loader->register(false);
	}
};

$audiocheckAppendLoader(__DIR__ . '/../vendor/autoload.php');
$audiocheckAppendLoader(__DIR__ . '/../vendor-prefixed/autoload.php');
