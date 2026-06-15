<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Integration;

use OCA\AudioCheck\Service\FileAccessService;
use OCA\AudioCheck\Service\PlaybackStateService;
use OCP\Files\File;
use OCP\IUserManager;
use Test\TestCase;

/**
 * Progress saved for a file not yet in ac_tracks must appear in continue listening.
 */
final class ContinueListeningWithoutIndexIntegrationTest extends TestCase
{
	private const USER = 'ac_int_continue';
	private const PASSWORD = 'ac-test-pass-9xK!';

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
		if ($userManager->userExists(self::USER)) {
			$userManager->get(self::USER)?->delete();
		}
	}

	public function testContinueListeningIncludesUnindexedFile(): void
	{
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		if (!$userManager->userExists(self::USER)) {
			$userManager->createUser(self::USER, self::PASSWORD);
		}

		/** @var FileAccessService $access */
		$access = \OC::$server->get(FileAccessService::class);
		$folder = $access->getUserFolder(self::USER);
		$path = 'audiocheck-continue-unindexed.mp3';
		if ($folder->nodeExists($path)) {
			$folder->get($path)->delete();
		}
		/** @var File $file */
		$file = $folder->newFile($path);
		$file->putContent($this->minimalMp3Bytes());
		$fileId = (int)$file->getId();
		$this->assertGreaterThan(0, $fileId);

		/** @var PlaybackStateService $playback */
		$playback = \OC::$server->get(PlaybackStateService::class);
		$playback->saveProgress(self::USER, $fileId, 45000, 100, false, 180000);

		$items = $playback->getContinueListening(self::USER, 10);
		$match = null;
		foreach ($items as $item) {
			if ((int)$item['fileId'] === $fileId) {
				$match = $item;
				break;
			}
		}
		$this->assertNotNull($match, 'Unindexed file should appear in continue listening');
		$this->assertSame('audiocheck-continue-unindexed', $match['title']);
		$this->assertSame(45000, $match['positionMs']);
	}

	/** @return non-empty-string */
	private function minimalMp3Bytes(): string
	{
		return base64_decode(
			'//uQxAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAACAAACcQCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4Ljc2LjEwMAAAAAAAAAAAAAAA//uQxAADwlQGkAAAAFAAA//uQxAADwlQGkAAAAFAAA',
			true,
		) ?: 'ID3';
	}
}
