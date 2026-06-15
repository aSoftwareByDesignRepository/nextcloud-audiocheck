<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Integration;

use OCA\AudioCheck\Exception\NotFoundException;
use OCA\AudioCheck\Service\FileAccessService;
use OCA\AudioCheck\Service\ScanService;
use OCP\Files\File;
use OCP\IUserManager;
use Test\TestCase;

/** AC-TST-06: trashed/deleted files are inaccessible and pruned from the index. */
final class FileAccessTrashIntegrationTest extends TestCase
{
	private const USER = 'ac_trash_user';
	private const PASSWORD = 'ac-test-pass-9xK!';

	protected function setUp(): void
	{
		if (!class_exists(\OC::class) || !isset(\OC::$server)) {
			$this->markTestSkipped('Nextcloud is not bootstrapped (run inside Docker with NEXTCLOUD_ROOT).');
		}
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		if ($userManager->userExists(self::USER)) {
			$userManager->get(self::USER)?->delete();
		}
	}

	protected function tearDown(): void
	{
		if (!isset(\OC::$server)) {
			return;
		}
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		if ($userManager->userExists(self::USER)) {
			$userManager->get(self::USER)?->delete();
		}
	}

	public function testDeletedFileIsNotReadableAndTrackRowPruned(): void
	{
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		$userManager->createUser(self::USER, self::PASSWORD);

		/** @var FileAccessService $access */
		$access = \OC::$server->get(FileAccessService::class);
		/** @var File $file */
		$file = $access->getUserFolder(self::USER)->newFile('trashed-track.mp3');
		$file->putContent($this->minimalMp3Bytes());
		$fileId = (int)$file->getId();

		/** @var ScanService $scan */
		$scan = \OC::$server->get(ScanService::class);
		$scan->handleNodeEvent(self::USER, $file, 'written');
		$this->assertTrue($this->trackExistsForUser(self::USER, $fileId));

		$file->delete();

		try {
			$access->resolveReadableFile(self::USER, $fileId);
			$this->fail('Expected NotFoundException for deleted file');
		} catch (NotFoundException) {
			$this->addToAssertionCount(1);
		}
		$this->assertFalse($access->isFileAccessible(self::USER, $fileId));

		$scan->scanUser(self::USER);
		$this->assertFalse($this->trackExistsForUser(self::USER, $fileId));
	}

	private function trackExistsForUser(string $userId, int $fileId): bool
	{
		$db = \OC::$server->get(\OCP\IDBConnection::class);
		$qb = $db->getQueryBuilder();
		$qb->select('id')->from('ac_tracks')
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, \PDO::PARAM_INT)));
		$row = $qb->executeQuery()->fetch();

		return $row !== false;
	}

	private function minimalMp3Bytes(): string
	{
		return "ID3\x03\x00\x00\x00\x00\x00\x00"
			. "\xFF\xFB\x90\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00";
	}
}
