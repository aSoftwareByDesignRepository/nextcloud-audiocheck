<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use OCA\AudioCheck\Service\FileAccessService;
use OCP\Encryption\IManager as IEncryptionManager;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use OCP\Files\NotFoundException as FilesNotFoundException;
use OCP\IConfig;
use PHPUnit\Framework\TestCase;

/**
 * Behavioral coverage for FileAccessService::walkAudioFilesBatch.
 *
 * Regression focus: a subfolder that sorts last among its siblings (including
 * an only-child folder such as Author/Book) must be descended into — the
 * original implementation popped the just-pushed child frame and silently
 * skipped whole book subtrees.
 */
final class FileAccessWalkerTest extends TestCase
{
	/** @var array<string, Folder> */
	private array $folderRegistry = [];

	private FileAccessService $service;

	protected function setUp(): void
	{
		parent::setUp();
		$this->service = new FileAccessService(
			$this->createMock(IRootFolder::class),
			$this->createMock(IEncryptionManager::class),
			$this->createMock(IConfig::class),
		);
	}

	public function testScansBookFolderThatIsOnlyChildOfAuthorFolder(): void
	{
		// Exact user report: /Audiobooks/Author/Book/*.mp3 — Book is the only
		// (therefore last-sorted) entry inside Author.
		$root = $this->buildTree([
			'Author Name' => [
				'Book Title' => ['01 - Chapter.mp3', '02 - Chapter.mp3'],
			],
		]);

		$this->assertSame(
			['01 - Chapter.mp3', '02 - Chapter.mp3'],
			$this->walkAll($root),
		);
	}

	public function testScansFolderThatSortsAfterAllSiblingFiles(): void
	{
		$root = $this->buildTree([
			'a-direct.mp3',
			'zz Last Folder' => ['nested.mp3'],
		]);

		$this->assertSame(['a-direct.mp3', 'nested.mp3'], $this->walkAll($root));
	}

	public function testScansArbitraryDepthIncludingChapterFolders(): void
	{
		$root = $this->buildTree([
			'Author One' => [
				'Book Alpha' => [
					'Chapter 1' => ['a1.mp3'],
					'Chapter 2' => ['a2.mp3'],
				],
				'Book Beta' => ['b1.mp3'],
			],
			'Author Two' => [
				'Book Gamma' => [
					'CD 1' => ['g1.mp3'],
					'CD 2' => ['g2.mp3', 'g3.mp3'],
				],
			],
			'loose.mp3',
		]);

		$found = $this->walkAll($root);
		sort($found);
		$this->assertSame(['a1.mp3', 'a2.mp3', 'b1.mp3', 'g1.mp3', 'g2.mp3', 'g3.mp3', 'loose.mp3'], $found);
	}

	public function testBatchedWalkWithCursorResumeFindsEveryFileExactlyOnce(): void
	{
		$root = $this->buildTree([
			'Author' => [
				'Book One' => [
					'Part 1' => ['1a.mp3', '1b.mp3'],
					'Part 2' => ['2a.mp3'],
				],
				'Book Two' => ['3a.mp3', '3b.mp3'],
			],
			'top.mp3',
		]);

		$found = [];
		$stack = [];
		$iterations = 0;
		do {
			$batch = $this->service->walkAudioFilesBatch($root, true, $stack, 1);
			$this->assertLessThanOrEqual(1, count($batch['files']));
			foreach ($batch['files'] as $file) {
				$found[] = $file->getName();
			}
			$stack = $batch['stack'];
			$this->assertLessThan(50, ++$iterations, 'walk did not terminate');
		} while (!$batch['done']);

		sort($found);
		$this->assertSame(['1a.mp3', '1b.mp3', '2a.mp3', '3a.mp3', '3b.mp3', 'top.mp3'], $found);
	}

	public function testNonRecursiveWalkIgnoresSubfolders(): void
	{
		$root = $this->buildTree([
			'direct.mp3',
			'Book' => ['nested.mp3'],
		]);

		$batch = $this->service->walkAudioFilesBatch($root, false, [], 100);
		$this->assertTrue($batch['done']);
		$this->assertSame(['direct.mp3'], $this->names($batch['files']));
	}

	public function testSkipsUnreadableFoldersAndFilesAndNonAudio(): void
	{
		$root = $this->buildTree([
			'Locked|unreadable' => ['hidden.mp3'],
			'Open' => [
				'cover.jpg',
				'notes.txt',
				'secret.mp3|unreadable',
				'track.mp3',
			],
		]);

		$this->assertSame(['track.mp3'], $this->walkAll($root));
	}

	public function testVanishedFolderInResumedStackIsSkippedNotFatal(): void
	{
		$root = $this->buildTree([
			'Author' => ['book.mp3'],
		]);

		// Simulate a cursor persisted before the folder was deleted.
		$stack = [
			['path' => '', 'offset' => 0],
			['path' => 'Deleted Folder', 'offset' => 3],
		];
		$batch = $this->service->walkAudioFilesBatch($root, true, $stack, 100);

		$this->assertTrue($batch['done']);
		$this->assertSame(['book.mp3'], $this->names($batch['files']));
	}

	public function testLimitIsHonoredAndWalkResumesWhereItStopped(): void
	{
		$root = $this->buildTree([
			'Book' => ['01.mp3', '02.mp3', '03.mp3', '04.mp3', '05.mp3'],
		]);

		$first = $this->service->walkAudioFilesBatch($root, true, [], 3);
		$this->assertFalse($first['done']);
		$this->assertSame(['01.mp3', '02.mp3', '03.mp3'], $this->names($first['files']));

		$second = $this->service->walkAudioFilesBatch($root, true, $first['stack'], 3);
		$this->assertSame(['04.mp3', '05.mp3'], $this->names($second['files']));
		$this->assertTrue($second['done']);
	}

	public function testEmptyLibraryCompletesImmediately(): void
	{
		$root = $this->buildTree([
			'Empty Author' => [
				'Empty Book' => [],
			],
		]);

		$batch = $this->service->walkAudioFilesBatch($root, true, [], 10);
		$this->assertTrue($batch['done']);
		$this->assertSame([], $batch['files']);
		$this->assertSame([], $batch['stack']);
	}

	public function testWalkStopsAtMaxDepthWithoutSkippingShallowerFiles(): void
	{
		// Build a chain deeper than MAX_WALK_DEPTH, with audio both above and
		// beyond the cap. Files past the cap must be ignored; shallower ones kept.
		$deep = ['too-deep.mp3'];
		for ($i = 0; $i < FileAccessService::MAX_WALK_DEPTH + 2; $i++) {
			$deep = ['level-' . $i => $deep];
		}
		$root = $this->buildTree(array_merge($deep, ['shallow.mp3']));

		$found = $this->walkAll($root);
		$this->assertContains('shallow.mp3', $found);
		$this->assertNotContains('too-deep.mp3', $found);
	}

	public function testFileAtExactMaxDepthFolderIsIndexed(): void
	{
		$nested = ['edge.mp3'];
		for ($i = 0; $i < FileAccessService::MAX_WALK_DEPTH; $i++) {
			$nested = ['d' . $i => $nested];
		}
		$root = $this->buildTree($nested);

		$this->assertSame(['edge.mp3'], $this->walkAll($root));
	}

	/** @return list<string> */
	private function walkAll(Folder $root): array
	{
		$found = [];
		$stack = [];
		$iterations = 0;
		do {
			$batch = $this->service->walkAudioFilesBatch($root, true, $stack, 4);
			foreach ($batch['files'] as $file) {
				$found[] = $file->getName();
			}
			$stack = $batch['stack'];
			$this->assertLessThan(100, ++$iterations, 'walk did not terminate');
		} while (!$batch['done']);

		return $found;
	}

	/** @param list<File> $files @return list<string> */
	private function names(array $files): array
	{
		return array_map(static fn (File $file): string => $file->getName(), $files);
	}

	/**
	 * Build a fake folder tree.
	 *
	 * Spec: integer keys with string values are files ("name.mp3", suffix
	 * "|unreadable" marks them unreadable, MIME derives from the extension);
	 * string keys with array values are subfolders (same "|unreadable" suffix).
	 */
	private function buildTree(array $spec): Folder
	{
		$this->folderRegistry = [];
		$root = $this->buildFolder('', '', $spec, true, true);

		return $root;
	}

	private function buildFolder(string $name, string $path, array $spec, bool $readable, bool $isRoot = false): Folder
	{
		$children = [];
		foreach ($spec as $key => $value) {
			if (is_string($key)) {
				[$childName, $childReadable] = $this->parseMarker($key);
				$childPath = $path === '' ? $childName : $path . '/' . $childName;
				$children[] = $this->buildFolder($childName, $childPath, (array)$value, $childReadable);
				continue;
			}
			$children[] = $this->makeFile((string)$value);
		}

		$folder = $this->createMock(Folder::class);
		$folder->method('getName')->willReturn($name);
		$folder->method('isReadable')->willReturn($readable);
		$folder->method('getDirectoryListing')->willReturn($children);
		if ($isRoot) {
			$folder->method('get')->willReturnCallback(function (string $relPath) {
				$relPath = trim($relPath, '/');
				if (!isset($this->folderRegistry[$relPath])) {
					throw new FilesNotFoundException($relPath);
				}

				return $this->folderRegistry[$relPath];
			});
		}
		if ($path !== '') {
			$this->folderRegistry[$path] = $folder;
		}

		return $folder;
	}

	private function makeFile(string $spec): File
	{
		[$name, $readable] = $this->parseMarker($spec);
		$ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
		$mime = match ($ext) {
			'jpg' => 'image/jpeg',
			'txt' => 'text/plain',
			default => 'audio/mpeg',
		};

		$file = $this->createMock(File::class);
		$file->method('getName')->willReturn($name);
		$file->method('isReadable')->willReturn($readable);
		$file->method('getMimeType')->willReturn($mime);

		return $file;
	}

	/** @return array{0:string,1:bool} */
	private function parseMarker(string $spec): array
	{
		if (str_ends_with($spec, '|unreadable')) {
			return [substr($spec, 0, -strlen('|unreadable')), false];
		}

		return [$spec, true];
	}
}
