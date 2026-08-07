<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Integration;

use OCA\AudioCheck\Exception\NotFoundException;
use OCA\AudioCheck\Service\FileAccessService;
use OCA\AudioCheck\Service\ScanService;
use OCA\AudioCheck\Tests\Shim\IntegrationTestUsers;
use OCP\Constants;
use OCP\Files\File;
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

	/** @var list<string> */
	private array $users = [];

	protected function setUp(): void
	{
		if (!class_exists(\OC::class) || !isset(\OC::$server)) {
			$this->markTestSkipped('Nextcloud is not bootstrapped (run inside Docker with NEXTCLOUD_ROOT).');
		}
		$this->users = [];
		IntegrationTestUsers::remove(
			self::OWNER,
			self::RECIPIENT,
			self::OWNER_PRUNE,
			self::RECIPIENT_PRUNE,
		);
	}

	protected function tearDown(): void
	{
		if (isset(\OC::$server)) {
			IntegrationTestUsers::clearSession();
			$this->flushMounts();
			$uids = array_values(array_unique(array_merge($this->users, [
				self::OWNER,
				self::RECIPIENT,
				self::OWNER_PRUNE,
				self::RECIPIENT_PRUNE,
			])));
			IntegrationTestUsers::remove(...$uids);
		}
		parent::tearDown();
	}

	public function testSharedFileAccessibleUntilShareRevoked(): void
	{
		$this->freshUsers(self::OWNER, self::RECIPIENT);

		/** @var FileAccessService $access */
		$access = \OC::$server->get(FileAccessService::class);
		$ownerFolder = $access->getUserFolder(self::OWNER);
		$path = 'audiocheck-share-test-' . uniqid('', true) . '.mp3';
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
		$this->flushMounts();

		$this->assertTrue($access->isFileAccessible(self::RECIPIENT, $fileId));
		$access->resolveReadableFile(self::RECIPIENT, $fileId);

		$shareManager->deleteShare($created);
		$this->flushMounts();

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
		$this->freshUsers(self::OWNER_PRUNE, self::RECIPIENT_PRUNE);
		$this->purgeAudioCheckRows(self::RECIPIENT_PRUNE);

		/** @var FileAccessService $access */
		$access = \OC::$server->get(FileAccessService::class);
		$ownerFolder = $access->getUserFolder(self::OWNER_PRUNE)->newFolder('SharePruneLib');
		$path = 'audiocheck-share-prune-' . uniqid('', true) . '.mp3';
		/** @var File $file */
		$file = $ownerFolder->newFile($path);
		$file->putContent($this->minimalMp3Bytes());
		$fileId = (int)$file->getId();

		/** @var \OCA\AudioCheck\Service\LibraryService $libraries */
		$libraries = \OC::$server->get(\OCA\AudioCheck\Service\LibraryService::class);
		$libraries->addLibrary(self::OWNER_PRUNE, null, true, \OCA\AudioCheck\Service\LibraryService::CONTENT_KIND_AUTO, '/SharePruneLib');
		$this->seedRootLibrary(self::RECIPIENT_PRUNE);

		/** @var ShareManager $shareManager */
		$shareManager = \OC::$server->get(ShareManager::class);
		$share = $shareManager->newShare();
		$share->setShareType(IShare::TYPE_USER);
		$share->setSharedWith(self::RECIPIENT_PRUNE);
		$share->setSharedBy(self::OWNER_PRUNE);
		$share->setPermissions(Constants::PERMISSION_READ);
		$share->setNode($file);
		$created = $shareManager->createShare($share);
		$this->flushMounts();

		$sharedFile = $access->resolveReadableFile(self::RECIPIENT_PRUNE, $fileId);
		/** @var ScanService $scan */
		$scan = \OC::$server->get(ScanService::class);
		$scan->handleNodeEvent(self::RECIPIENT_PRUNE, $sharedFile, 'written');
		$this->assertTrue($this->trackExistsForUser(self::RECIPIENT_PRUNE, $fileId));

		$shareManager->deleteShare($created);
		$this->flushMounts();
		$this->assertFalse(
			$access->isFileAccessible(self::RECIPIENT_PRUNE, $fileId),
			'revoked share must not stay readable before prune scan',
		);

		$tries = 0;
		do {
			$scan->scanUser(self::RECIPIENT_PRUNE);
			$status = $scan->getStatus(self::RECIPIENT_PRUNE);
			$this->assertLessThan(40, ++$tries, 'scan did not reach idle');
		} while ($status['status'] !== ScanService::STATUS_IDLE);
		$this->assertNull($status['lastError'], 'scan error: ' . (string)$status['lastError']);
		$this->assertFalse($this->trackExistsForUser(self::RECIPIENT_PRUNE, $fileId));
	}

	private function freshUsers(string ...$uids): void
	{
		foreach ($uids as $uid) {
			IntegrationTestUsers::create($uid, self::PASSWORD);
			$this->users[] = $uid;
		}
	}

	private function seedRootLibrary(string $userId): void
	{
		/** @var FileAccessService $access */
		$access = \OC::$server->get(FileAccessService::class);
		$home = $access->getUserFolder($userId);
		$db = \OC::$server->get(\OCP\IDBConnection::class);
		$qb = $db->getQueryBuilder();
		$qb->insert('ac_libraries')
			->values([
				'user_id' => $qb->createNamedParameter($userId),
				'folder_path' => $qb->createNamedParameter('/'),
				'root_file_id' => $qb->createNamedParameter($home->getId(), \PDO::PARAM_INT),
				'include_subfolders' => $qb->createNamedParameter(1, \PDO::PARAM_INT),
				'content_kind' => $qb->createNamedParameter('auto'),
				'enabled' => $qb->createNamedParameter(1, \PDO::PARAM_INT),
				'created_at' => $qb->createNamedParameter(time(), \PDO::PARAM_INT),
			]);
		$qb->executeStatement();
	}

	private function flushMounts(): void
	{
		if (class_exists(\OC_Util::class)) {
			\OC_Util::tearDownFS();
		}
	}

	private function purgeAudioCheckRows(string $userId): void
	{
		$db = \OC::$server->get(\OCP\IDBConnection::class);
		foreach (['ac_tracks', 'ac_scan_state', 'ac_libraries', 'ac_play_state'] as $table) {
			$qb = $db->getQueryBuilder();
			$qb->delete($table)->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
			$qb->executeStatement();
		}
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
