<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Integration;

use OCA\AudioCheck\Exception\NotFoundException;
use OCA\AudioCheck\Service\FileAccessService;
use OCP\Files\File;
use OCP\IUserManager;
use Test\TestCase;

/**
 * Live AC-TST-01 / AC-TST-03 style checks against the real Nextcloud file layer.
 */
final class FileAccessCrossUserIntegrationTest extends TestCase
{
	private const OWNER = 'ac_int_owner';
	private const OTHER = 'ac_int_other';
	private const PASSWORD = 'ac-test-pass-9xK!';

	private ?int $ownerFileId = null;

	protected function setUp(): void
	{
		if (!class_exists(\OC::class) || !isset(\OC::$server)) {
			$this->markTestSkipped('Nextcloud is not bootstrapped (run inside Docker with NEXTCLOUD_ROOT).');
		}
	}

	protected function tearDown(): void
	{
		if (!isset(\OC::$server)) {
			return;
		}
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		foreach ([self::OWNER, self::OTHER] as $uid) {
			if ($userManager->userExists($uid)) {
				$userManager->get($uid)?->delete();
			}
		}
	}

	public function testOwnerCanReadOwnFileOtherUserCannot(): void
	{
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		if (!$userManager->userExists(self::OWNER)) {
			$userManager->createUser(self::OWNER, self::PASSWORD);
		}
		if (!$userManager->userExists(self::OTHER)) {
			$userManager->createUser(self::OTHER, self::PASSWORD);
		}

		/** @var FileAccessService $access */
		$access = \OC::$server->get(FileAccessService::class);
		$ownerFolder = $access->getUserFolder(self::OWNER);
		$path = 'audiocheck-integration-test.mp3';
		if ($ownerFolder->nodeExists($path)) {
			$ownerFolder->get($path)->delete();
		}
		/** @var File $file */
		$file = $ownerFolder->newFile($path);
		$file->putContent($this->minimalMp3Bytes());

		$fileId = (int)$file->getId();
		$this->ownerFileId = $fileId;
		$this->assertGreaterThan(0, $fileId);

		$resolved = $access->resolveReadableFile(self::OWNER, $fileId);
		$this->assertSame($fileId, (int)$resolved->getId());

		try {
			$access->resolveReadableFile(self::OTHER, $fileId);
			$this->fail('Expected NotFoundException for cross-user file access');
		} catch (NotFoundException) {
			$this->addToAssertionCount(1);
		}

		$this->assertFalse($access->isFileAccessible(self::OTHER, $fileId));
		$this->assertTrue($access->isFileAccessible(self::OWNER, $fileId));
	}

	private function minimalMp3Bytes(): string
	{
		// Minimal MPEG frame + ID3 header so mime detection yields audio/*
		return "ID3\x03\x00\x00\x00\x00\x00\x00"
			. "\xFF\xFB\x90\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00";
	}
}
