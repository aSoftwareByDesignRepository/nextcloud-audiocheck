<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Integration;

use OCA\AudioCheck\Service\FileAccessService;
use OCA\AudioCheck\Service\PlaybackStateService;
use OCP\Files\File;
use OCP\IUserManager;
use Test\TestCase;

/** T5.01: stale client writes must not overwrite newer server progress. */
final class PlaybackStateStaleWriteIntegrationTest extends TestCase
{
	private const USER = 'ac_int_stale';
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

	public function testStaleClientWriteIsRejected(): void
	{
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		if (!$userManager->userExists(self::USER)) {
			$userManager->createUser(self::USER, self::PASSWORD);
		}

		/** @var FileAccessService $access */
		$access = \OC::$server->get(FileAccessService::class);
		$folder = $access->getUserFolder(self::USER);
		$path = 'audiocheck-stale-progress.mp3';
		if ($folder->nodeExists($path)) {
			$folder->get($path)->delete();
		}
		/** @var File $file */
		$file = $folder->newFile($path);
		$file->putContent($this->minimalMp3Bytes());
		$fileId = (int)$file->getId();

		/** @var PlaybackStateService $playback */
		$playback = \OC::$server->get(PlaybackStateService::class);
		$fresh = $playback->saveProgress(self::USER, $fileId, 120000, 100, false, 180000, null);
		$this->assertSame(120000, $fresh['positionMs']);
		$serverAt = (int)$fresh['updatedAt'];
		$this->assertGreaterThan(0, $serverAt);

		$stale = $playback->saveProgress(self::USER, $fileId, 30000, 100, false, 180000, $serverAt - 60);
		$this->assertSame(120000, $stale['positionMs'], 'Stale device must not rewind progress');
		$this->assertSame($serverAt, $stale['updatedAt']);

		$seek = $playback->saveProgress(self::USER, $fileId, 150000, 100, false, 180000, $serverAt - 60);
		$this->assertSame(150000, $seek['positionMs'], 'Forward seek from stale client is allowed');
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
