<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Integration;

use OCA\AudioCheck\Service\FileAccessService;
use OCA\AudioCheck\Service\PlaybackStateService;
use OCA\AudioCheck\Service\PlaylistService;
use OCA\AudioCheck\Service\ScanService;
use OCP\Files\File;
use OCP\IUserManager;
use Test\TestCase;

/** §10.8 / edge 17: deleting a user purges all per-user AudioCheck data. */
final class UserDeletedPurgeIntegrationTest extends TestCase
{
	private const USER = 'ac_purge_user';
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

	public function testUserDeletionPurgesTracksPlaylistsAndProgress(): void
	{
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		$userManager->createUser(self::USER, self::PASSWORD);

		/** @var FileAccessService $access */
		$access = \OC::$server->get(FileAccessService::class);
		/** @var File $file */
		$file = $access->getUserFolder(self::USER)->newFile('purge-me.mp3');
		$file->putContent($this->minimalMp3Bytes());
		$fileId = (int)$file->getId();

		/** @var ScanService $scan */
		$scan = \OC::$server->get(ScanService::class);
		$scan->handleNodeEvent(self::USER, $file, 'written');

		/** @var PlaylistService $playlists */
		$playlists = \OC::$server->get(PlaylistService::class);
		$playlist = $playlists->createPlaylist(self::USER, 'Purge test');
		$playlists->addItem(self::USER, (int)$playlist['id'], $fileId);

		/** @var PlaybackStateService $playback */
		$playback = \OC::$server->get(PlaybackStateService::class);
		$playback->saveProgress(self::USER, $fileId, 5000, 100, false, 120000);

		$this->assertTrue($this->rowExists('ac_tracks', self::USER));
		$this->assertTrue($this->rowExists('ac_playlists', self::USER));
		$this->assertTrue($this->rowExists('ac_play_state', self::USER));

		$userManager->get(self::USER)?->delete();

		$this->assertFalse($this->rowExists('ac_tracks', self::USER));
		$this->assertFalse($this->rowExists('ac_playlists', self::USER));
		$this->assertFalse($this->rowExists('ac_play_state', self::USER));
		$this->assertFalse($this->rowExists('ac_scan_state', self::USER));
		$this->assertFalse($this->metaRowExists($fileId));
	}

	private function rowExists(string $table, string $userId): bool
	{
		$db = \OC::$server->get(\OCP\IDBConnection::class);
		$qb = $db->getQueryBuilder();
		$qb->select('id')->from($table)
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->setMaxResults(1);

		return $qb->executeQuery()->fetch() !== false;
	}

	private function metaRowExists(int $fileId): bool
	{
		$db = \OC::$server->get(\OCP\IDBConnection::class);
		$qb = $db->getQueryBuilder();
		$qb->select('id')->from('ac_file_meta')
			->where($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, \PDO::PARAM_INT)))
			->setMaxResults(1);

		return $qb->executeQuery()->fetch() !== false;
	}

	private function minimalMp3Bytes(): string
	{
		return "ID3\x03\x00\x00\x00\x00\x00\x00"
			. "\xFF\xFB\x90\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00";
	}
}
