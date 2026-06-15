<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Integration;

use OCA\AudioCheck\Exception\NotFoundException;
use OCA\AudioCheck\Exception\ValidationException;
use OCA\AudioCheck\Service\FileAccessService;
use OCA\AudioCheck\Service\PlaylistService;
use OCP\Files\File;
use OCP\IUserManager;
use Test\TestCase;

/** J4 / AC-TST-14: playlist mutations enforce ownership and file access. */
final class PlaylistOwnershipIntegrationTest extends TestCase
{
	private const OWNER = 'ac_pl_owner';
	private const ATTACKER = 'ac_pl_att';
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

	public function testAttackerCannotRemoveOwnersPlaylistItem(): void
	{
		$owner = 'ac_pl_rm_owner';
		$attacker = 'ac_pl_rm_att';
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		foreach ([$owner, $attacker] as $uid) {
			if ($userManager->userExists($uid)) {
				$userManager->get($uid)?->delete();
			}
		}
		$userManager->createUser($owner, self::PASSWORD);
		$userManager->createUser($attacker, self::PASSWORD);

		/** @var FileAccessService $access */
		$access = \OC::$server->get(FileAccessService::class);
		/** @var File $file */
		$file = $access->getUserFolder($owner)->newFile('pl-item.mp3');
		$file->putContent($this->minimalMp3Bytes());
		$fileId = (int)$file->getId();

		/** @var PlaylistService $playlists */
		$playlists = \OC::$server->get(PlaylistService::class);
		$playlist = $playlists->createPlaylist($owner, 'Owner list');
		$playlists->addItem($owner, (int)$playlist['id'], $fileId);
		$full = $playlists->getPlaylist($owner, (int)$playlist['id']);
		$itemId = (int)($full['items'][0]['id'] ?? 0);
		$this->assertGreaterThan(0, $itemId);

		try {
			$playlists->removeItem($attacker, $itemId);
			$this->fail('Expected NotFoundException for foreign playlist item removal');
		} catch (NotFoundException) {
			$this->addToAssertionCount(1);
		}
	}

	public function testReorderRejectsForeignItemIds(): void
	{
		$owner = 'ac_pl_reorder';
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		if ($userManager->userExists($owner)) {
			$userManager->get($owner)?->delete();
		}
		$userManager->createUser($owner, self::PASSWORD);

		/** @var FileAccessService $access */
		$access = \OC::$server->get(FileAccessService::class);
		$file = $access->getUserFolder($owner)->newFile('pl-reorder.mp3');
		$file->putContent($this->minimalMp3Bytes());

		/** @var PlaylistService $playlists */
		$playlists = \OC::$server->get(PlaylistService::class);
		$playlist = $playlists->createPlaylist($owner, 'Reorder test');
		$playlists->addItem($owner, (int)$playlist['id'], (int)$file->getId());
		$full = $playlists->getPlaylist($owner, (int)$playlist['id']);
		$itemId = (int)($full['items'][0]['id'] ?? 0);

		try {
			$playlists->reorderItems($owner, (int)$playlist['id'], [$itemId + 9999]);
			$this->fail('Expected ValidationException for forged item id');
		} catch (ValidationException) {
			$this->addToAssertionCount(1);
		}
	}

	private function minimalMp3Bytes(): string
	{
		return "ID3\x03\x00\x00\x00\x00\x00\x00"
			. "\xFF\xFB\x90\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00";
	}
}
