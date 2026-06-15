<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Integration;

use OCA\AudioCheck\Service\FileAccessService;
use OCA\AudioCheck\Service\MetadataService;
use OCP\Files\File;
use OCP\IUserManager;
use Test\TestCase;

/** AC-TST-17: content change updates etag-keyed metadata. */
final class MetadataEtagRefreshIntegrationTest extends TestCase
{
	private const USER = 'ac_meta_etag';
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

	public function testMetadataEtagUpdatesAfterFileContentChange(): void
	{
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		$userManager->createUser(self::USER, self::PASSWORD);

		/** @var FileAccessService $access */
		$access = \OC::$server->get(FileAccessService::class);
		/** @var File $file */
		$file = $access->getUserFolder(self::USER)->newFile('etag-refresh.mp3');
		$file->putContent($this->minimalMp3Bytes('A'));
		$fileId = (int)$file->getId();

		/** @var MetadataService $metadata */
		$metadata = \OC::$server->get(MetadataService::class);
		$metadata->analyzeFile($file);

		$db = \OC::$server->get(\OCP\IDBConnection::class);
		$statsBefore = $this->readMetaSourceStats($db, $fileId);
		$this->assertGreaterThan(0, $statsBefore['source_size']);

		// Nextcloud may keep etag on in-place overwrites; metadata freshness uses mtime+size too.
		$file->putContent($this->minimalMp3Bytes('B', 256));
		$refreshed = $access->resolveReadableFile(self::USER, $fileId);
		$metadata->analyzeFile($refreshed);
		$statsAfter = $this->readMetaSourceStats($db, $fileId);

		$this->assertNotSame($statsBefore['source_size'], $statsAfter['source_size']);
		$this->assertSame((int)$refreshed->getSize(), $statsAfter['source_size']);
		$this->assertSame((int)$refreshed->getMTime(), $statsAfter['source_mtime']);
		$this->assertSame($refreshed->getEtag(), $statsAfter['etag']);
	}

	/** @return array{etag:string,source_mtime:int,source_size:int} */
	private function readMetaSourceStats(\OCP\IDBConnection $db, int $fileId): array
	{
		$qb = $db->getQueryBuilder();
		$qb->select('etag', 'source_mtime', 'source_size')->from('ac_file_meta')
			->where($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, \PDO::PARAM_INT)));
		$row = $qb->executeQuery()->fetch();
		if ($row === false) {
			return ['etag' => '', 'source_mtime' => 0, 'source_size' => 0];
		}

		return [
			'etag' => (string)($row['etag'] ?? ''),
			'source_mtime' => (int)($row['source_mtime'] ?? 0),
			'source_size' => (int)($row['source_size'] ?? 0),
		];
	}

	private function minimalMp3Bytes(string $salt, int $padLength = 1): string
	{
		$pad = str_repeat($salt, max(1, $padLength));

		return "ID3\x03\x00\x00\x00\x00\x00\x00"
			. $pad
			. "\xFF\xFB\x90\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00";
	}
}
