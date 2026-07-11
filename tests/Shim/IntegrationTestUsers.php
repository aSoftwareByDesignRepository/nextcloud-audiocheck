<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Shim;

use OCP\IConfig;
use OCP\IUser;
use OCP\IUserManager;
use OCP\IUserSession;

/**
 * Reliable integration-test user lifecycle.
 *
 * Nextcloud rejects createUser when a data directory already exists for the uid
 * (orphaned after a failed test run). These helpers delete the account and any
 * leftover data directory before creating a fresh user.
 */
final class IntegrationTestUsers
{
	public static function remove(string ...$uids): void
	{
		if (!isset(\OC::$server)) {
			return;
		}

		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		foreach ($uids as $uid) {
			if ($userManager->userExists($uid)) {
				$userManager->get($uid)?->delete();
			}
			self::removeOrphanDataDirectory($uid);
		}
	}

	public static function create(string $uid, string $password): IUser
	{
		if (!isset(\OC::$server)) {
			throw new \RuntimeException('Nextcloud server is not bootstrapped.');
		}

		self::remove($uid);

		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		try {
			if (!$userManager->createUser($uid, $password)) {
				throw new \RuntimeException('Failed to create integration test user: ' . $uid);
			}
		} catch (\InvalidArgumentException $e) {
			if (self::orphanDataDirectoryExists($uid) && str_contains($e->getMessage(), 'files already exist')) {
				throw new \RuntimeException(
					'Orphan data directory for "' . $uid . '" could not be removed (often root-owned after a failed test run). '
					. 'Run: bash custom_apps/audiocheck/scripts/cleanup-integration-test-users.sh',
					0,
					$e,
				);
			}
			throw $e;
		}

		$user = $userManager->get($uid);
		if ($user === null) {
			throw new \RuntimeException('Created user could not be loaded: ' . $uid);
		}

		return $user;
	}

	/**
	 * Simulate a logged-in user in PHPUnit (CLI boots with incognito mode on).
	 */
	public static function loginAs(IUser|string $user): void
	{
		if (!isset(\OC::$server)) {
			return;
		}

		if (is_string($user)) {
			/** @var IUserManager $userManager */
			$userManager = \OC::$server->get(IUserManager::class);
			$resolved = $userManager->get($user);
			if ($resolved === null) {
				throw new \RuntimeException('Integration test user not found: ' . $user);
			}
			$user = $resolved;
		}

		\OC_User::setIncognitoMode(false);
		/** @var IUserSession $session */
		$session = \OC::$server->get(IUserSession::class);
		$session->setUser($user);
	}

	public static function clearSession(): void
	{
		if (!isset(\OC::$server)) {
			return;
		}
		/** @var IUserSession $session */
		$session = \OC::$server->get(IUserSession::class);
		$session->setUser(null);
		\OC_User::setIncognitoMode(true);
	}

	private static function removeOrphanDataDirectory(string $uid): void
	{
		/** @var IConfig $config */
		$config = \OC::$server->get(IConfig::class);
		$dataDirectory = rtrim($config->getSystemValueString('datadirectory', \OC::$SERVERROOT . '/data'), '/');
		$path = $dataDirectory . '/' . $uid;
		if (!is_dir($path)) {
			return;
		}

		self::removeDirectoryRecursively($path);
	}

	private static function orphanDataDirectoryExists(string $uid): bool
	{
		if (!isset(\OC::$server)) {
			return false;
		}
		/** @var IConfig $config */
		$config = \OC::$server->get(IConfig::class);
		$dataDirectory = rtrim($config->getSystemValueString('datadirectory', \OC::$SERVERROOT . '/data'), '/');
		return is_dir($dataDirectory . '/' . $uid);
	}

	private static function removeDirectoryRecursively(string $path): void
	{
		if (!is_dir($path)) {
			return;
		}

		$items = scandir($path);
		if ($items === false) {
			return;
		}

		foreach ($items as $item) {
			if ($item === '.' || $item === '..') {
				continue;
			}
			$full = $path . '/' . $item;
			if (is_dir($full)) {
				self::removeDirectoryRecursively($full);
			} else {
				@unlink($full);
			}
		}

		@rmdir($path);
	}
}
