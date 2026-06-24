<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Integration;

use OCA\AudioCheck\Exception\NotFoundException;
use OCA\AudioCheck\Exception\ValidationException;
use OCA\AudioCheck\Service\FileAccessService;
use OCA\AudioCheck\Service\PlaylistService;
use OCA\AudioCheck\Tests\Shim\IntegrationTestUsers;
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
		IntegrationTestUsers::remove(self::OWNER, self::ATTACKER);
	}

	protected function tearDown(): void
	{
		IntegrationTestUsers::clearSession();
		IntegrationTestUsers::remove(
			self::OWNER,
			self::ATTACKER,
			'ac_pl_rm_owner',
			'ac_pl_rm_att',
			'ac_pl_reorder',
		);
	}

	public function testAttackerCannotRemoveOwnersPlaylistItem(): void
	{
		$owner = 'ac_pl_rm_owner';
		$attacker = 'ac_pl_rm_att';
		IntegrationTestUsers::create($owner, self::PASSWORD);
		IntegrationTestUsers::create($attacker, self::PASSWORD);

		/** @var FileAccessService $access */
		$access = \OC::$server->get(FileAccessService::class);
		/** @var \OCP\Files\File $file */
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
		IntegrationTestUsers::create($owner, self::PASSWORD);

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
