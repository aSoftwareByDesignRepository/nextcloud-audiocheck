<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Integration;

use OCA\AudioCheck\Exception\NotFoundException;
use OCA\AudioCheck\Service\FileAccessService;
use OCA\AudioCheck\Service\PlaybackStateService;
use OCA\AudioCheck\Service\PlaylistService;
use OCP\Files\File;
use OCP\IUserManager;
use Test\TestCase;

/** AC-TST-14 / AC-TST-15: foreign fileId rejected for playlist + progress. */
final class ForeignFileMutationIntegrationTest extends TestCase
{
	private const OWNER = 'ac_foreign_owner';
	private const ATTACKER = 'ac_foreign_attacker';
	private const PASSWORD = 'ac-test-pass-9xK!';

	protected function setUp(): void
	{
		if (!class_exists(\OC::class) || !isset(\OC::$server)) {
			$this->markTestSkipped('Nextcloud is not bootstrapped (run inside Docker with NEXTCLOUD_ROOT).');
		}
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		foreach ([self::OWNER, self::ATTACKER] as $uid) {
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
		foreach ([self::OWNER, self::ATTACKER] as $uid) {
			if ($userManager->userExists($uid)) {
				$userManager->get($uid)?->delete();
			}
		}
	}

	public function testCannotAddForeignFileToPlaylistOrSaveProgress(): void
	{
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		$userManager->createUser(self::OWNER, self::PASSWORD);
		$userManager->createUser(self::ATTACKER, self::PASSWORD);

		/** @var FileAccessService $access */
		$access = \OC::$server->get(FileAccessService::class);
		/** @var File $file */
		$file = $access->getUserFolder(self::OWNER)->newFile('foreign-guard.mp3');
		$file->putContent($this->minimalMp3Bytes());
		$fileId = (int)$file->getId();

		/** @var PlaylistService $playlists */
		$playlists = \OC::$server->get(PlaylistService::class);
		$playlist = $playlists->createPlaylist(self::ATTACKER, 'Probe', false);

		try {
			$playlists->addItem(self::ATTACKER, (int)$playlist['id'], $fileId);
			$this->fail('Expected NotFoundException when adding foreign file to playlist');
		} catch (NotFoundException) {
			$this->addToAssertionCount(1);
		}

		/** @var PlaybackStateService $playback */
		$playback = \OC::$server->get(PlaybackStateService::class);
		try {
			$playback->saveProgress(self::ATTACKER, $fileId, 1000, 100, false, 60000);
			$this->fail('Expected NotFoundException when saving foreign progress');
		} catch (NotFoundException) {
			$this->addToAssertionCount(1);
		}

		$this->assertFalse($this->progressExists(self::ATTACKER, $fileId));
	}

	private function progressExists(string $userId, int $fileId): bool
	{
		$db = \OC::$server->get(\OCP\IDBConnection::class);
		$qb = $db->getQueryBuilder();
		$qb->select('id')->from('ac_play_state')
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
