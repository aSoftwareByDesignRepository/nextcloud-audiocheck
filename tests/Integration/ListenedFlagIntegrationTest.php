<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Integration;

use OCA\AudioCheck\Service\FileAccessService;
use OCA\AudioCheck\Service\LibraryService;
use OCA\AudioCheck\Service\PlaybackStateService;
use OCP\Files\File;
use OCP\IUserManager;
use Test\TestCase;

/** Plan §3.5: explicit listened flag per user/file, independent of position. */
final class ListenedFlagIntegrationTest extends TestCase
{
	private const PASSWORD = 'ac-test-pass-9xK!';

	/** @var list<string> */
	private array $createdUsers = [];

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
		foreach ($this->createdUsers as $uid) {
			if ($userManager->userExists($uid)) {
				$userManager->get($uid)?->delete();
			}
		}
		$this->createdUsers = [];
	}

	public function testManualListenedTogglePreservesPosition(): void
	{
		$user = $this->makeUser('manual');
		$fileId = $this->makeFile($user, 'toggle.mp3');
		/** @var PlaybackStateService $playback */
		$playback = \OC::$server->get(PlaybackStateService::class);

		$progress = $playback->saveProgress($user, $fileId, 45000, 100, false, 180000, null);
		$this->assertFalse($progress['listened']);

		$marked = $playback->setListened($user, $fileId, true);
		$this->assertTrue($marked['listened']);
		$this->assertTrue($marked['finished']);
		$this->assertSame(45000, $marked['positionMs']);

		$unmarked = $playback->setListened($user, $fileId, false);
		$this->assertFalse($unmarked['listened']);
		$this->assertFalse($unmarked['finished']);
		$this->assertSame(45000, $unmarked['positionMs'], 'Unmarking listened must preserve playback position');
	}

	public function testListenedTrackExcludedFromContinueShelf(): void
	{
		$user = $this->makeUser('continue');
		$fileId = $this->makeFile($user, 'shelf.mp3');
		/** @var PlaybackStateService $playback */
		$playback = \OC::$server->get(PlaybackStateService::class);
		$playback->saveProgress($user, $fileId, 60000, 100, false, 180000, null);
		$this->assertNotEmpty($playback->getContinueListening($user, 10));

		$playback->setListened($user, $fileId, true);
		$continue = $playback->getContinueListening($user, 10);
		$ids = array_map(static fn (array $row): int => (int)$row['fileId'], $continue);
		$this->assertNotContains($fileId, $ids);
	}

	public function testAutoListenedAtThreshold(): void
	{
		$user = $this->makeUser('threshold');
		$fileId = $this->makeFile($user, 'auto.mp3');
		/** @var PlaybackStateService $playback */
		$playback = \OC::$server->get(PlaybackStateService::class);
		$progress = $playback->saveProgress($user, $fileId, 171000, 100, false, 180000, null);
		$this->assertTrue($progress['listened'], '95% threshold should mark listened');
		$this->assertTrue($progress['finished']);
	}

	public function testBulkListenedMarksAllAccessibleTracks(): void
	{
		$user = $this->makeUser('bulk');
		$fileIds = [
			$this->makeFile($user, 'bulk-01.mp3'),
			$this->makeFile($user, 'bulk-02.mp3'),
			$this->makeFile($user, 'bulk-03.mp3'),
		];
		/** @var PlaybackStateService $playback */
		$playback = \OC::$server->get(PlaybackStateService::class);
		$result = $playback->setListenedBulk($user, $fileIds, true);
		$this->assertSame(3, $result['updated']);
		$this->assertSame(0, $result['skipped']);
		$map = $playback->getListenedMap($user, $fileIds);
		foreach ($fileIds as $fileId) {
			$this->assertTrue($map[$fileId] ?? false);
		}

		$playback->setListenedBulk($user, $fileIds, false);
		$map = $playback->getListenedMap($user, $fileIds);
		foreach ($fileIds as $fileId) {
			$this->assertFalse($map[$fileId] ?? true);
		}
	}

	public function testLibraryListenedBulkApiWrapper(): void
	{
		$user = $this->makeUser('bulk-api');
		$fileIds = [
			$this->makeFile($user, 'api-01.mp3'),
			$this->makeFile($user, 'api-02.mp3'),
		];
		/** @var \OCA\AudioCheck\Service\LibraryService $library */
		$library = \OC::$server->get(\OCA\AudioCheck\Service\LibraryService::class);
		$result = $library->setListenedBulk($user, $fileIds, true);
		$this->assertSame(2, $result['updated']);
		$this->assertSame(0, $result['skipped']);
	}

	public function testHideListenedExcludesMarkedTracksFromListTracks(): void
	{
		$user = $this->makeUser('hide-listened');
		$heard = $this->makeFile($user, 'heard.mp3');
		$fresh = $this->makeFile($user, 'fresh.mp3');
		/** @var PlaybackStateService $playback */
		$playback = \OC::$server->get(PlaybackStateService::class);
		$playback->setListened($user, $heard, true);

		/** @var \OCA\AudioCheck\Service\LibraryService $library */
		$library = \OC::$server->get(\OCA\AudioCheck\Service\LibraryService::class);
		$all = $library->listTracks($user, null, null, LibraryService::SORT_TITLE, 1, 50, false, null, null, null, null, null, false);
		$hidden = $library->listTracks($user, null, null, LibraryService::SORT_TITLE, 1, 50, false, null, null, null, null, null, true);
		$allIds = array_map(static fn (array $row): int => (int)$row['fileId'], $all['items']);
		$hiddenIds = array_map(static fn (array $row): int => (int)$row['fileId'], $hidden['items']);

		$this->assertContains($heard, $allIds);
		$this->assertContains($fresh, $allIds);
		$this->assertNotContains($heard, $hiddenIds, 'hideListened must exclude listened tracks');
		$this->assertContains($fresh, $hiddenIds);
	}

	private function makeUser(string $suffix): string
	{
		$uid = 'ac_int_listened_' . $suffix;
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		if ($userManager->userExists($uid)) {
			$userManager->get($uid)?->delete();
		}
		$userManager->createUser($uid, self::PASSWORD);
		$this->createdUsers[] = $uid;
		// Touch the home folder so the files mount is fully initialised before writes.
		\OC::$server->get(FileAccessService::class)->getUserFolder($uid);

		return $uid;
	}

	private function makeFile(string $user, string $name): int
	{
		/** @var FileAccessService $access */
		$access = \OC::$server->get(FileAccessService::class);
		$folder = $access->getUserFolder($user);
		if ($folder->nodeExists($name)) {
			$folder->get($name)->delete();
		}
		/** @var File $file */
		$file = $folder->newFile($name);
		$file->putContent($this->minimalMp3Bytes());

		return (int)$file->getId();
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
