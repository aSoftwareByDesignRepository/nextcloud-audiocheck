<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Integration;

use OCA\AudioCheck\Exception\NotFoundException;
use OCA\AudioCheck\Service\FileAccessService;
use OCP\Constants;
use OCP\Files\File;
use OCP\IUserManager;
use OCP\Share\IManager as ShareManager;
use OCP\Share\IShare;
use Test\TestCase;

/**
 * AC-TST-03: access via share, then 404 after revoke.
 */
final class FileAccessShareRevokeIntegrationTest extends TestCase
{
	private const OWNER = 'ac_share_owner';
	private const RECIPIENT = 'ac_share_rcpt';
	private const OWNER_PRUNE = 'ac_share_owner2';
	private const RECIPIENT_PRUNE = 'ac_share_rcpt2';
	private const PASSWORD = 'ac-test-pass-9xK!';

	protected function setUp(): void
	{
		if (!class_exists(\OC::class) || !isset(\OC::$server)) {
			$this->markTestSkipped('Nextcloud is not bootstrapped (run inside Docker with NEXTCLOUD_ROOT).');
		}
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		foreach ([self::OWNER, self::RECIPIENT, self::OWNER_PRUNE, self::RECIPIENT_PRUNE] as $uid) {
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
		foreach ([self::OWNER, self::RECIPIENT, self::OWNER_PRUNE, self::RECIPIENT_PRUNE] as $uid) {
			if ($userManager->userExists($uid)) {
				$userManager->get($uid)?->delete();
			}
		}
	}

	public function testSharedFileAccessibleUntilShareRevoked(): void
	{
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		if (!$userManager->userExists(self::OWNER)) {
			$userManager->createUser(self::OWNER, self::PASSWORD);
		}
		if (!$userManager->userExists(self::RECIPIENT)) {
			$userManager->createUser(self::RECIPIENT, self::PASSWORD);
		}

		/** @var FileAccessService $access */
		$access = \OC::$server->get(FileAccessService::class);
		$ownerFolder = $access->getUserFolder(self::OWNER);
		$path = 'audiocheck-share-test.mp3';
		if ($ownerFolder->nodeExists($path)) {
			$ownerFolder->get($path)->delete();
		}
		/** @var File $file */
		$file = $ownerFolder->newFile($path);
		$file->putContent($this->minimalMp3Bytes());
		$fileId = (int)$file->getId();

		/** @var ShareManager $shareManager */
		$shareManager = \OC::$server->get(ShareManager::class);
		$share = $shareManager->newShare();
		$share->setShareType(IShare::TYPE_USER);
		$share->setSharedWith(self::RECIPIENT);
		$share->setSharedBy(self::OWNER);
		$share->setPermissions(Constants::PERMISSION_READ);
		$share->setNode($file);
		$created = $shareManager->createShare($share);

		$this->assertTrue($access->isFileAccessible(self::RECIPIENT, $fileId));
		$access->resolveReadableFile(self::RECIPIENT, $fileId);

		$shareManager->deleteShare($created);

		try {
			$access->resolveReadableFile(self::RECIPIENT, $fileId);
			$this->fail('Expected NotFoundException after share revoke');
		} catch (NotFoundException) {
			$this->addToAssertionCount(1);
		}
		$this->assertFalse($access->isFileAccessible(self::RECIPIENT, $fileId));
	}

	public function testSharedTrackRowPrunedAfterScan(): void
	{
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		if (!$userManager->userExists(self::OWNER_PRUNE)) {
			$userManager->createUser(self::OWNER_PRUNE, self::PASSWORD);
		}
		if (!$userManager->userExists(self::RECIPIENT_PRUNE)) {
			$userManager->createUser(self::RECIPIENT_PRUNE, self::PASSWORD);
		}

		/** @var FileAccessService $access */
		$access = \OC::$server->get(FileAccessService::class);
		$ownerFolder = $access->getUserFolder(self::OWNER_PRUNE);
		$path = 'audiocheck-share-prune.mp3';
		if ($ownerFolder->nodeExists($path)) {
			$ownerFolder->get($path)->delete();
		}
		/** @var File $file */
		$file = $ownerFolder->newFile($path);
		$file->putContent($this->minimalMp3Bytes());
		$fileId = (int)$file->getId();

		/** @var ShareManager $shareManager */
		$shareManager = \OC::$server->get(ShareManager::class);
		$share = $shareManager->newShare();
		$share->setShareType(IShare::TYPE_USER);
		$share->setSharedWith(self::RECIPIENT_PRUNE);
		$share->setSharedBy(self::OWNER_PRUNE);
		$share->setPermissions(Constants::PERMISSION_READ);
		$share->setNode($file);
		$created = $shareManager->createShare($share);

		$sharedFile = $access->resolveReadableFile(self::RECIPIENT_PRUNE, $fileId);
		/** @var \OCA\AudioCheck\Service\ScanService $scan */
		$scan = \OC::$server->get(\OCA\AudioCheck\Service\ScanService::class);
		$scan->handleNodeEvent(self::RECIPIENT_PRUNE, $sharedFile, 'written');
		$this->assertTrue($this->trackExistsForUser(self::RECIPIENT_PRUNE, $fileId));

		$shareManager->deleteShare($created);
		$scan->scanUser(self::RECIPIENT_PRUNE);
		$this->assertFalse($this->trackExistsForUser(self::RECIPIENT_PRUNE, $fileId));
	}

	private function trackExistsForUser(string $userId, int $fileId): bool
	{
		$db = \OC::$server->get(\OCP\IDBConnection::class);
		$qb = $db->getQueryBuilder();
		$qb->select('id')->from('ac_tracks')
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, \PDO::PARAM_INT)));
		$result = $qb->executeQuery();
		$row = $result->fetch();
		$result->closeCursor();
		return $row !== false;
	}

	private function minimalMp3Bytes(): string
	{
		return "ID3\x03\x00\x00\x00\x00\x00\x00"
			. "\xFF\xFB\x90\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00";
	}
}
