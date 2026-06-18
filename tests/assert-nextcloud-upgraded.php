<?php

declare(strict_types=1);

/**
 * Integration tests use IUserSession; Nextcloud boots in incognito mode while
 * needsDbUpgrade is true, so getUser() is always null and middleware tests lie.
 */
if (!class_exists(\OC::class) || !isset(\OC::$server)) {
	return;
}
if (!class_exists(\OCP\Util::class)) {
	return;
}
if (!\OCP\Util::needUpgrade()) {
	return;
}

throw new RuntimeException(
	"Nextcloud requires 'php occ upgrade' before integration tests.\n" .
	'While the database is behind, IUserSession::getUser() stays null (incognito mode) ' .
	'and access-gate integration tests produce false results.'
);
