<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Integration;

use OCA\AudioCheck\Service\FileAccessService;
use OCA\AudioCheck\Service\LibraryService;
use OCA\AudioCheck\Service\ScanService;
use OCA\AudioCheck\Tests\Shim\IntegrationTestUsers;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\IDBConnection;
use Test\TestCase;

/**
 * Browse/Music must never surface audio outside enabled library folders.
 * Covers indexing gates, list filters, folder facets, remove-library purge,
 * and empty-library scan cleanup.
 */
final class LibraryScopeIntegrationTest extends TestCase
{
	private const PASSWORD = 'ac-scope-pass-7wQ!';

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

	public function testOutsideLibraryWriteIsNotIndexedOrListed(): void
	{
		$user = $this->freshUser('ac_scope_out');
		$access = $this->fileAccess();
		$home = $access->getUserFolder($user);

		$music = $home->newFolder('Privat')->newFolder('Music');
		$outside = $home->newFolder('Downloads');
		$inFile = $this->newAudio($music, 'keep.mp3');
		$outFile = $this->newAudio($outside, 'noise.mp3');

		$libraries = $this->libraries();
		$added = $libraries->addLibrary($user, null, true, LibraryService::KIND_MUSIC, '/Privat/Music');
		$libraryId = (int)$added['library']['id'];

		$scan = $this->scan();
		$scan->handleNodeEvent($user, $inFile, 'written');
		$scan->handleNodeEvent($user, $outFile, 'written');

		$this->assertSame($libraryId, $this->trackLibraryId($user, (int)$inFile->getId()));
		$this->assertFalse($this->trackExists($user, (int)$outFile->getId()));

		$list = $libraries->listTracks($user, null, null, LibraryService::SORT_TITLE, 1, 50);
		$fileIds = array_map(static fn (array $t): int => (int)$t['fileId'], $list['items']);
		$this->assertContains((int)$inFile->getId(), $fileIds);
		$this->assertNotContains((int)$outFile->getId(), $fileIds);
		$this->assertSame(1, $list['total']);
	}

	public function testOrphanNullLibraryIdIsHiddenAndPurged(): void
	{
		$user = $this->freshUser('ac_scope_orphan');
		$access = $this->fileAccess();
		$home = $access->getUserFolder($user);
		$music = $home->newFolder('LibMusic');
		$outside = $home->newFolder('Other');
		$inFile = $this->newAudio($music, 'in.mp3');
		$orphan = $this->newAudio($outside, 'orphan.mp3');

		$libraries = $this->libraries();
		$added = $libraries->addLibrary($user, null, true, LibraryService::CONTENT_KIND_AUTO, '/LibMusic');
		$libraryId = (int)$added['library']['id'];

		$scan = $this->scan();
		$scan->handleNodeEvent($user, $inFile, 'written');
		$this->insertOrphanTrack($user, $orphan, '/Other/orphan.mp3');

		$list = $libraries->listTracks($user, null, null, LibraryService::SORT_TITLE, 1, 50);
		$fileIds = array_map(static fn (array $t): int => (int)$t['fileId'], $list['items']);
		$this->assertContains((int)$inFile->getId(), $fileIds);
		$this->assertNotContains((int)$orphan->getId(), $fileIds);

		$removed = $scan->purgeTracksOutsideLibraries($user);
		$this->assertGreaterThanOrEqual(1, $removed);
		$this->assertFalse($this->trackExists($user, (int)$orphan->getId()));
		$this->assertSame($libraryId, $this->trackLibraryId($user, (int)$inFile->getId()));
	}

	public function testRemoveLibraryPurgesItsTracksFromBrowse(): void
	{
		$user = $this->freshUser('ac_scope_rm');
		$access = $this->fileAccess();
		$home = $access->getUserFolder($user);
		$music = $home->newFolder('KeepMusic');
		$books = $home->newFolder('DropBooks');
		$mFile = $this->newAudio($music, 'song.mp3');
		$bFile = $this->newAudio($books, 'book.mp3');

		$libraries = $this->libraries();
		$musicLib = $libraries->addLibrary($user, null, true, LibraryService::KIND_MUSIC, '/KeepMusic');
		$bookLib = $libraries->addLibrary($user, null, true, LibraryService::KIND_AUDIOBOOK, '/DropBooks');
		$musicId = (int)$musicLib['library']['id'];
		$bookId = (int)$bookLib['library']['id'];

		$scan = $this->scan();
		$scan->handleNodeEvent($user, $mFile, 'written');
		$scan->handleNodeEvent($user, $bFile, 'written');
		$this->assertSame($musicId, $this->trackLibraryId($user, (int)$mFile->getId()));
		$this->assertSame($bookId, $this->trackLibraryId($user, (int)$bFile->getId()));

		$libraries->removeLibrary($user, $bookId);
		$scan->purgeTracksOutsideLibraries($user);

		$this->assertFalse($this->trackExists($user, (int)$bFile->getId()));
		$this->assertTrue($this->trackExists($user, (int)$mFile->getId()));

		$list = $libraries->listTracks($user, null, null, LibraryService::SORT_TITLE, 1, 50);
		$fileIds = array_map(static fn (array $t): int => (int)$t['fileId'], $list['items']);
		$this->assertSame([(int)$mFile->getId()], $fileIds);
	}

	public function testFolderFacetsDoNotInventAncestorsAboveLibraryRoots(): void
	{
		$user = $this->freshUser('ac_scope_facet');
		$access = $this->fileAccess();
		$home = $access->getUserFolder($user);
		$album = $home->newFolder('Privat')->newFolder('Music')->newFolder('Album');
		$this->newAudio($album, 'a.mp3');

		$libraries = $this->libraries();
		$libraries->addLibrary($user, null, true, LibraryService::KIND_MUSIC, '/Privat/Music');

		$scan = $this->scan();
		$scan->runInteractiveScan($user, 60);

		$facets = $libraries->listFacets($user, 'folders', null, null, 1, 0);
		$names = array_map(static fn (array $i): string => (string)$i['name'], $facets['items']);
		$this->assertContains('/Privat/Music', $names);
		$this->assertContains('/Privat/Music/Album', $names);
		$this->assertNotContains('/Privat', $names);
		$this->assertNotContains('/', $names);
	}

	public function testScanWithNoLibrariesEmptiesCatalog(): void
	{
		$user = $this->freshUser('ac_scope_empty');
		$access = $this->fileAccess();
		$home = $access->getUserFolder($user);
		$music = $home->newFolder('TempLib');
		$file = $this->newAudio($music, 'gone.mp3');

		$libraries = $this->libraries();
		$added = $libraries->addLibrary($user, null, true, LibraryService::CONTENT_KIND_AUTO, '/TempLib');
		$libId = (int)$added['library']['id'];
		$scan = $this->scan();
		$scan->handleNodeEvent($user, $file, 'written');
		$this->assertTrue($this->trackExists($user, (int)$file->getId()));

		$libraries->removeLibrary($user, $libId);
		$scan->runInteractiveScan($user, 30);

		$this->assertFalse($this->trackExists($user, (int)$file->getId()));
		$list = $libraries->listTracks($user, null, null, LibraryService::SORT_TITLE, 1, 50);
		$this->assertSame(0, $list['total']);
		$this->assertSame([], $list['items']);
	}

	private function freshUser(string $prefix): string
	{
		$uid = $prefix . '_' . substr(bin2hex(random_bytes(4)), 0, 8);
		IntegrationTestUsers::remove($uid);
		IntegrationTestUsers::create($uid, self::PASSWORD);
		IntegrationTestUsers::loginAs($uid);
		$this->users[] = $uid;

		return $uid;
	}

	private function fileAccess(): FileAccessService
	{
		/** @var FileAccessService $access */
		$access = \OC::$server->get(FileAccessService::class);
		return $access;
	}

	private function libraries(): LibraryService
	{
		/** @var LibraryService $libraries */
		$libraries = \OC::$server->get(LibraryService::class);
		return $libraries;
	}

	private function scan(): ScanService
	{
		/** @var ScanService $scan */
		$scan = \OC::$server->get(ScanService::class);
		return $scan;
	}

	private function newAudio(Folder $folder, string $name): File
	{
		/** @var File $file */
		$file = $folder->newFile($name);
		$file->putContent($this->minimalMp3Bytes());
		return $file;
	}

	private function insertOrphanTrack(string $userId, File $file, string $relPath): void
	{
		$db = \OC::$server->get(IDBConnection::class);
		$qb = $db->getQueryBuilder();
		$now = time();
		$qb->insert('ac_tracks')
			->values([
				'user_id' => $qb->createNamedParameter($userId),
				'file_id' => $qb->createNamedParameter($file->getId(), \PDO::PARAM_INT),
				'meta_id' => $qb->createNamedParameter(null, \PDO::PARAM_NULL),
				'rel_path' => $qb->createNamedParameter($relPath),
				'file_name' => $qb->createNamedParameter($file->getName()),
				'file_name_norm' => $qb->createNamedParameter(strtolower($file->getName())),
				'mtime' => $qb->createNamedParameter($file->getMTime(), \PDO::PARAM_INT),
				'size' => $qb->createNamedParameter($file->getSize(), \PDO::PARAM_INT),
				'etag' => $qb->createNamedParameter($file->getEtag()),
				'library_id' => $qb->createNamedParameter(null, \PDO::PARAM_NULL),
				'added_at' => $qb->createNamedParameter($now, \PDO::PARAM_INT),
				'last_seen_at' => $qb->createNamedParameter($now, \PDO::PARAM_INT),
			]);
		$qb->executeStatement();
		$this->assertTrue($this->trackExists($userId, (int)$file->getId()));
	}

	private function trackExists(string $userId, int $fileId): bool
	{
		return $this->trackRow($userId, $fileId) !== null;
	}

	private function trackLibraryId(string $userId, int $fileId): ?int
	{
		$row = $this->trackRow($userId, $fileId);
		if ($row === null || $row['library_id'] === null || $row['library_id'] === '') {
			return null;
		}
		return (int)$row['library_id'];
	}

	/** @return array<string, mixed>|null */
	private function trackRow(string $userId, int $fileId): ?array
	{
		$db = \OC::$server->get(IDBConnection::class);
		$qb = $db->getQueryBuilder();
		$qb->select('rel_path', 'library_id')->from('ac_tracks')
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, \PDO::PARAM_INT)));
		$row = $qb->executeQuery()->fetch();
		return $row === false ? null : $row;
	}

	private function minimalMp3Bytes(): string
	{
		return "ID3\x03\x00\x00\x00\x00\x00\x00"
			. "\xFF\xFB\x90\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00";
	}
}
