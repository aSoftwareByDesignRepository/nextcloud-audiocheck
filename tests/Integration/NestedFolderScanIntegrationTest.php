<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Integration;

use OCA\AudioCheck\Service\FileAccessService;
use OCA\AudioCheck\Service\LibraryService;
use OCA\AudioCheck\Service\ScanService;
use OCA\AudioCheck\Tests\Shim\IntegrationTestUsers;
use OCP\Files\Folder;
use OCP\IDBConnection;
use Test\TestCase;

/**
 * Scanning must index audio at every folder depth. Regression coverage for the
 * walker bug that skipped a subfolder sorting last among its siblings — which
 * dropped whole /Audiobooks/Author/Book subtrees (multi-file books).
 */
final class NestedFolderScanIntegrationTest extends TestCase
{
	private const PASSWORD = 'ac-test-pass-9xK!';

	/** @var list<string> */
	private array $users = [];

	protected function setUp(): void
	{
		if (!class_exists(\OC::class) || !isset(\OC::$server)) {
			$this->markTestSkipped('Nextcloud is not bootstrapped (run inside Docker with NEXTCLOUD_ROOT).');
		}
		$this->users = [];
	}

	protected function tearDown(): void
	{
		if (isset(\OC::$server)) {
			IntegrationTestUsers::clearSession();
			if ($this->users !== []) {
				IntegrationTestUsers::remove(...$this->users);
			}
		}
		parent::tearDown();
	}

	public function testScanIndexesBooksNestedAtEveryDepth(): void
	{
		$user = $this->freshUser('ac_nested_depth');

		/** @var FileAccessService $access */
		$access = \OC::$server->get(FileAccessService::class);
		$home = $access->getUserFolder($user);

		$library = $home->newFolder('Audiobooks');
		$this->newAudio($library, 'direct.mp3');

		// Only-child book folder (the exact reported layout).
		$authorOne = $library->newFolder('Author One');
		$bookAlpha = $authorOne->newFolder('Book Alpha');
		$this->newAudio($bookAlpha, '01 - Chapter One.mp3');
		$this->newAudio($bookAlpha, '02 - Chapter Two.mp3');

		// Book folder sorting after its sibling book.
		$bookOmega = $authorOne->newFolder('zz Book Omega');
		$this->newAudio($bookOmega, '01.mp3');

		// Chapter/disc depth: /Audiobooks/Author/Book/CD n/file.mp3.
		$authorTwo = $library->newFolder('Author Two');
		$bookBeta = $authorTwo->newFolder('Book Beta');
		$cd1 = $bookBeta->newFolder('CD 1');
		$cd2 = $bookBeta->newFolder('CD 2');
		$cd1File = $this->newAudio($cd1, '01.mp3');
		$cd2File = $this->newAudio($cd2, '01.mp3');

		/** @var LibraryService $libraries */
		$libraries = \OC::$server->get(LibraryService::class);
		$libraries->addLibrary($user, null, true, LibraryService::KIND_AUDIOBOOK, '/Audiobooks');

		/** @var ScanService $scan */
		$scan = \OC::$server->get(ScanService::class);
		$this->runScanToIdle($scan, $user);

		$relPaths = $this->indexedRelPaths($user);
		$this->assertSame([
			'/Audiobooks/Author One/Book Alpha/01 - Chapter One.mp3',
			'/Audiobooks/Author One/Book Alpha/02 - Chapter Two.mp3',
			'/Audiobooks/Author One/zz Book Omega/01.mp3',
			'/Audiobooks/Author Two/Book Beta/CD 1/01.mp3',
			'/Audiobooks/Author Two/Book Beta/CD 2/01.mp3',
			'/Audiobooks/direct.mp3',
		], $relPaths);

		$tracks = $libraries->listTracks($user, LibraryService::KIND_AUDIOBOOK, null, LibraryService::SORT_TITLE, 1, 100);
		$this->assertSame(6, $tracks['total'], 'all nested files must be listed as audiobooks');

		// Disc folders collapse into one book with playable disc order.
		$collections = $libraries->listCollections($user, LibraryService::KIND_AUDIOBOOK, 'Book Beta', LibraryService::SORT_TITLE, 1, 100);
		$this->assertSame(1, $collections['total']);
		$this->assertSame('Book Beta', $collections['items'][0]['title']);
		$this->assertSame(2, $collections['items'][0]['trackCount']);

		$collection = $libraries->getCollection($user, (string)$collections['items'][0]['key']);
		$this->assertSame(
			[(int)$cd1File->getId(), (int)$cd2File->getId()],
			array_map(static fn (array $track): int => (int)$track['fileId'], $collection['tracks']),
			'CD 1 must play before CD 2',
		);
	}

	public function testRescanAfterAddingBookToExistingAuthorPicksItUp(): void
	{
		$user = $this->freshUser('ac_nested_rescan');

		/** @var FileAccessService $access */
		$access = \OC::$server->get(FileAccessService::class);
		$home = $access->getUserFolder($user);
		$library = $home->newFolder('Audiobooks');
		$author = $library->newFolder('Author');
		$firstBook = $author->newFolder('A First Book');
		$this->newAudio($firstBook, '01.mp3');

		/** @var LibraryService $libraries */
		$libraries = \OC::$server->get(LibraryService::class);
		$libraries->addLibrary($user, null, true, LibraryService::KIND_AUDIOBOOK, '/Audiobooks');

		/** @var ScanService $scan */
		$scan = \OC::$server->get(ScanService::class);
		$this->runScanToIdle($scan, $user);
		$this->assertCount(1, $this->indexedRelPaths($user));

		// New book sorting last inside the author folder — previously skipped.
		$secondBook = $author->newFolder('Z Second Book');
		$this->newAudio($secondBook, '01.mp3');
		$this->newAudio($secondBook, '02.mp3');

		$this->runScanToIdle($scan, $user);
		$this->assertSame([
			'/Audiobooks/Author/A First Book/01.mp3',
			'/Audiobooks/Author/Z Second Book/01.mp3',
			'/Audiobooks/Author/Z Second Book/02.mp3',
		], $this->indexedRelPaths($user));
	}

	private function freshUser(string $uid): string
	{
		IntegrationTestUsers::remove($uid);
		IntegrationTestUsers::create($uid, self::PASSWORD);
		IntegrationTestUsers::loginAs($uid);
		$this->users[] = $uid;

		return $uid;
	}

	private function runScanToIdle(ScanService $scan, string $user): void
	{
		$tries = 0;
		do {
			$scan->scanUser($user);
			$status = $scan->getStatus($user);
			$this->assertLessThan(20, ++$tries, 'scan did not reach idle');
		} while ($status['status'] !== ScanService::STATUS_IDLE);
		$this->assertNull($status['lastError']);
	}

	/** @return list<string> */
	private function indexedRelPaths(string $user): array
	{
		/** @var IDBConnection $db */
		$db = \OC::$server->get(IDBConnection::class);
		$qb = $db->getQueryBuilder();
		$qb->select('rel_path')->from('ac_tracks')
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($user)));
		$result = $qb->executeQuery();
		$paths = [];
		while ($row = $result->fetch()) {
			$paths[] = (string)$row['rel_path'];
		}
		$result->closeCursor();
		sort($paths);

		return $paths;
	}

	private function newAudio(Folder $folder, string $name): \OCP\Files\File
	{
		$file = $folder->newFile($name);
		$file->putContent(
			"ID3\x03\x00\x00\x00\x00\x00\x00"
			. "\xFF\xFB\x90\x00" . str_repeat("\x00", 64)
		);

		return $file;
	}
}
