<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Integration;

use OCA\AudioCheck\Service\FileAccessService;
use OCA\AudioCheck\Service\PlaybackStateService;
use OCA\AudioCheck\Service\PlayQueueService;
use OCP\Files\File;
use OCP\IUserManager;
use Test\TestCase;

/**
 * Durable server-side queue: a multi-file audiobook queue survives a reload,
 * resumes at the exact saved position, keeps order, and only returns files the
 * user can still access.
 */
final class PlayQueuePersistenceIntegrationTest extends TestCase
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

	public function testQueueRoundTripResumesPositionAndOrder(): void
	{
		$user = $this->makeUser('roundtrip');

		/** @var FileAccessService $access */
		$access = \OC::$server->get(FileAccessService::class);
		$folder = $access->getUserFolder($user);

		$fileIds = [];
		foreach (['book-01.mp3', 'book-02.mp3', 'book-03.mp3'] as $name) {
			/** @var File $file */
			$file = $folder->newFile($name);
			$file->putContent($this->minimalMp3Bytes());
			$fileIds[] = (int)$file->getId();
		}

		/** @var PlaybackStateService $playback */
		$playback = \OC::$server->get(PlaybackStateService::class);
		// Mid-book: listening to the second file at 0:42.
		$playback->saveProgress($user, $fileIds[1], 42000, 125, false, 600000);

		/** @var PlayQueueService $queue */
		$queue = \OC::$server->get(PlayQueueService::class);
		$queue->saveQueue($user, $fileIds, 1, 125, false, 'all');

		$restored = $queue->getQueue($user);
		$this->assertCount(3, $restored['items']);
		$this->assertSame($fileIds, array_map(static fn (array $i): int => (int)$i['fileId'], $restored['items']), 'Order preserved');
		$this->assertSame(1, $restored['currentIndex']);
		$this->assertSame(42000, $restored['positionMs'], 'Resume position comes from ac_play_state');
		$this->assertSame(125, $restored['playbackSpeed']);
		$this->assertSame('all', $restored['repeatMode']);
		$this->assertFalse($restored['shuffle']);
		foreach ($restored['items'] as $item) {
			$this->assertFalse($item['unavailable']);
		}
	}

	public function testClearQueueRemovesEverything(): void
	{
		$user = $this->makeUser('clear');
		$fileId = $this->makeFile($user, 'clear-me.mp3');

		/** @var PlayQueueService $queue */
		$queue = \OC::$server->get(PlayQueueService::class);
		$queue->saveQueue($user, [$fileId], 0, 100, false, 'off');
		$this->assertNotEmpty($queue->getQueue($user)['items']);

		$queue->clearQueue($user);
		$this->assertSame([], $queue->getQueue($user)['items']);
	}

	public function testDeletedFileIsMarkedUnavailableNotLeaked(): void
	{
		$user = $this->makeUser('gone');
		$keep = $this->makeFile($user, 'keep.mp3');
		$gone = $this->makeFile($user, 'gone.mp3');

		/** @var PlayQueueService $queue */
		$queue = \OC::$server->get(PlayQueueService::class);
		$queue->saveQueue($user, [$keep, $gone], 0, 100, false, 'off');

		/** @var FileAccessService $access */
		$access = \OC::$server->get(FileAccessService::class);
		$access->getUserFolder($user)->get('gone.mp3')->delete();

		$restored = $queue->getQueue($user);
		$this->assertCount(2, $restored['items'], 'Order/index integrity preserved even when an item is gone');
		$this->assertFalse($restored['items'][0]['unavailable']);
		$this->assertTrue($restored['items'][1]['unavailable']);
		$this->assertSame('', $restored['items'][1]['title'], 'No metadata leaked for an inaccessible file');
	}

	public function testOutOfRangeIndexClampsToZero(): void
	{
		$user = $this->makeUser('clamp');
		$fileId = $this->makeFile($user, 'only.mp3');

		/** @var PlayQueueService $queue */
		$queue = \OC::$server->get(PlayQueueService::class);
		$queue->saveQueue($user, [$fileId], 99, 100, false, 'off');
		$this->assertSame(0, $queue->getQueue($user)['currentIndex']);
	}

	public function testStaleClientWriteDoesNotOverwriteNewerQueue(): void
	{
		$user = $this->makeUser('stale');
		$a = $this->makeFile($user, 'a.mp3');
		$b = $this->makeFile($user, 'b.mp3');

		/** @var PlayQueueService $queue */
		$queue = \OC::$server->get(PlayQueueService::class);
		$fresh = $queue->saveQueue($user, [$a, $b], 1, 110, false, 'off');
		$serverAt = (int)$fresh['updatedAt'];
		$this->assertGreaterThan(0, $serverAt);

		$stale = $queue->saveQueue($user, [$b], 0, 100, false, 'off', $serverAt - 60);
		$this->assertTrue($stale['stale'] ?? false);
		$this->assertSame($serverAt, $stale['updatedAt']);

		$restored = $queue->getQueue($user);
		$this->assertSame([$a, $b], array_map(static fn (array $i): int => (int)$i['fileId'], $restored['items']));
		$this->assertSame(1, $restored['currentIndex']);
		$this->assertSame(110, $restored['playbackSpeed']);
	}

	private function makeUser(string $suffix): string
	{
		$uid = 'ac_int_queue_' . $suffix;
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
