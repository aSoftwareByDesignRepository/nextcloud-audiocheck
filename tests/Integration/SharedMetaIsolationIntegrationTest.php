<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Integration;

use OCA\AudioCheck\Service\FileAccessService;
use OCA\AudioCheck\Service\MetadataService;
use OCP\Constants;
use OCP\Files\File;
use OCP\IUserManager;
use OCP\Share\IManager as ShareManager;
use OCP\Share\IShare;
use Test\TestCase;

/** AC-TST-18: shared file → one meta row, per-user track rows. */
final class SharedMetaIsolationIntegrationTest extends TestCase
{
	private const OWNER = 'ac_meta_owner';
	private const RECIPIENT = 'ac_meta_rcpt';
	private const PASSWORD = 'ac-test-pass-9xK!';

	protected function setUp(): void
	{
		if (!class_exists(\OC::class) || !isset(\OC::$server)) {
			$this->markTestSkipped('Nextcloud is not bootstrapped (run inside Docker with NEXTCLOUD_ROOT).');
		}
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		foreach ([self::OWNER, self::RECIPIENT] as $uid) {
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
		foreach ([self::OWNER, self::RECIPIENT] as $uid) {
			if ($userManager->userExists($uid)) {
				$userManager->get($uid)?->delete();
			}
		}
	}

	public function testSharedFileHasSingleMetaRowAndPerUserTracks(): void
	{
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		$userManager->createUser(self::OWNER, self::PASSWORD);
		$userManager->createUser(self::RECIPIENT, self::PASSWORD);

		/** @var FileAccessService $access */
		$access = \OC::$server->get(FileAccessService::class);
		/** @var File $file */
		$file = $access->getUserFolder(self::OWNER)->newFile('shared-meta.mp3');
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
		$shareManager->createShare($share);

		$ownerFile = $access->resolveReadableFile(self::OWNER, $fileId);
		$recipientFile = $access->resolveReadableFile(self::RECIPIENT, $fileId);

		/** @var MetadataService $metadata */
		$metadata = \OC::$server->get(MetadataService::class);
		$metaIdOwner = $metadata->analyzeFile($ownerFile);
		$metaIdRecipient = $metadata->analyzeFile($recipientFile);
		$this->assertSame($metaIdOwner, $metaIdRecipient);

		/** @var \OCA\AudioCheck\Service\ScanService $scan */
		$scan = \OC::$server->get(\OCA\AudioCheck\Service\ScanService::class);
		$scan->handleNodeEvent(self::OWNER, $ownerFile, 'written');
		$scan->handleNodeEvent(self::RECIPIENT, $recipientFile, 'written');

		$db = \OC::$server->get(\OCP\IDBConnection::class);
		$qb = $db->getQueryBuilder();
		$qb->select($qb->func()->count('id', 'c'))->from('ac_file_meta')
			->where($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, \PDO::PARAM_INT)));
		$metaCount = (int)($qb->executeQuery()->fetch()['c'] ?? 0);

		$qb2 = $db->getQueryBuilder();
		$qb2->select('user_id')->from('ac_tracks')
			->where($qb2->expr()->eq('file_id', $qb2->createNamedParameter($fileId, \PDO::PARAM_INT)));
		$result = $qb2->executeQuery();
		$users = [];
		while ($row = $result->fetch()) {
			$users[] = (string)$row['user_id'];
		}
		$result->closeCursor();

		$this->assertSame(1, $metaCount);
		$this->assertContains(self::OWNER, $users);
		$this->assertContains(self::RECIPIENT, $users);
	}

	private function minimalMp3Bytes(): string
	{
		return "ID3\x03\x00\x00\x00\x00\x00\x00"
			. "\xFF\xFB\x90\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00";
	}
}
