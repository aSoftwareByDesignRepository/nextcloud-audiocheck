<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Integration;

use OCA\AudioCheck\Exception\NotFoundException;
use OCA\AudioCheck\Service\FileAccessService;
use OCA\AudioCheck\Service\LibraryService;
use OCP\Files\File;
use OCP\IUserManager;
use Test\TestCase;

/** AC-TST-04 / AC-TST-08: enumeration and metadata access fail closed. */
final class FileAccessEnumerationIntegrationTest extends TestCase
{
	private const OWNER_ENUM = 'ac_enum_owner_enum';
	private const ATTACKER_ENUM = 'ac_enum_att_enum';
	private const OWNER_META = 'ac_enum_owner_meta';
	private const ATTACKER_META = 'ac_enum_att_meta';
	private const PASSWORD = 'ac-test-pass-9xK!';

	protected function setUp(): void
	{
		if (!class_exists(\OC::class) || !isset(\OC::$server)) {
			$this->markTestSkipped('Nextcloud is not bootstrapped (run inside Docker with NEXTCLOUD_ROOT).');
		}
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		foreach ([self::OWNER_ENUM, self::ATTACKER_ENUM, self::OWNER_META, self::ATTACKER_META] as $uid) {
			if ($userManager->userExists($uid)) {
				$userManager->get($uid)?->delete();
			}
		}
	}

	protected function tearDown(): void
	{
		if (!isset(\OC::$server)) {
			return;
		}
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		foreach ([self::OWNER_ENUM, self::ATTACKER_ENUM, self::OWNER_META, self::ATTACKER_META] as $uid) {
			if ($userManager->userExists($uid)) {
				$userManager->get($uid)?->delete();
			}
		}
	}

	public function testAttackerCannotEnumerateOwnerFileIds(): void
	{
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		$userManager->createUser(self::OWNER_ENUM, self::PASSWORD);
		$userManager->createUser(self::ATTACKER_ENUM, self::PASSWORD);

		/** @var FileAccessService $access */
		$access = \OC::$server->get(FileAccessService::class);
		$folder = $access->getUserFolder(self::OWNER_ENUM);
		/** @var File $file */
		$file = $folder->newFile('enum-secret.mp3');
		$file->putContent($this->minimalMp3Bytes());
		$ownerFileId = (int)$file->getId();
		$this->assertGreaterThan(0, $ownerFileId);

		$notFoundBodies = [];
		for ($probe = 1; $probe <= 64; $probe++) {
			if ($probe === $ownerFileId) {
				continue;
			}
			try {
				$access->resolveReadableFile(self::ATTACKER_ENUM, $probe);
				$this->fail('Attacker resolved foreign fileId ' . $probe);
			} catch (NotFoundException) {
				$notFoundBodies[] = 'not_found';
			}
		}
		$this->assertGreaterThan(60, count($notFoundBodies));

		try {
			$access->resolveReadableFile(self::ATTACKER_ENUM, $ownerFileId);
			$this->fail('Attacker must not read owner file');
		} catch (NotFoundException) {
			$this->addToAssertionCount(1);
		}
	}

	public function testForeignTrackMetadataReturnsNotFound(): void
	{
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		$userManager->createUser(self::OWNER_META, self::PASSWORD);
		$userManager->createUser(self::ATTACKER_META, self::PASSWORD);

		/** @var FileAccessService $access */
		$access = \OC::$server->get(FileAccessService::class);
		$file = $access->getUserFolder(self::OWNER_META)->newFile('enum-meta.mp3');
		$file->putContent($this->minimalMp3Bytes());
		$fileId = (int)$file->getId();

		/** @var \OCA\AudioCheck\Service\ScanService $scan */
		$scan = \OC::$server->get(\OCA\AudioCheck\Service\ScanService::class);
		$scan->handleNodeEvent(self::OWNER_META, $file, 'written');

		/** @var LibraryService $library */
		$library = \OC::$server->get(LibraryService::class);
		try {
			$library->getTrackInfo(self::ATTACKER_META, $fileId);
			$this->fail('Expected NotFoundException for foreign track metadata');
		} catch (NotFoundException) {
			$this->addToAssertionCount(1);
		}
	}

	private function minimalMp3Bytes(): string
	{
		return "ID3\x03\x00\x00\x00\x00\x00\x00"
			. "\xFF\xFB\x90\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00";
	}
}
