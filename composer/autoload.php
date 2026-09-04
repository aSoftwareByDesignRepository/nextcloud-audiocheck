<?php

declare(strict_types=1);

/**
 * Nextcloud only registers Composer deps from <app>/composer/autoload.php
 * (see OC_App::registerAutoloading). Keep production packages in vendor/ and
 * bridge them here — otherwise getID3 (and any future require deps) never load.
 *
 * CRITICAL: Composer registers itself *prepended* by default. If vendor/ was
 * installed with require-dev (nextcloud/ocp stubs), a prepended loader shadows
 * the server's real OCP interfaces and can break the whole instance. Always
 * re-register appended so Nextcloud's autoloader wins for OCP and OC namespaces.
 *
 * SPDX-FileCopyrightText: 2026 Alexander Mäule <info@software-by-design.de>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

$audiocheckVendorAutoload = __DIR__ . '/../vendor/autoload.php';
if (!is_file($audiocheckVendorAutoload)) {
	return;
}

$audiocheckLoader = require $audiocheckVendorAutoload;
if ($audiocheckLoader instanceof \Composer\Autoload\ClassLoader) {
	$audiocheckLoader->unregister();
	$audiocheckLoader->register(false);
}
