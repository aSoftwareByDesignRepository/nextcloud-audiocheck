<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use OCA\AudioCheck\Exception\NotFoundException;
use OCA\AudioCheck\Service\FileAccessService;
use OCP\Encryption\IManager as IEncryptionManager;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use OCP\Files\Storage\IStorage;
use OCP\IConfig;
use PHPUnit\Framework\TestCase;

/**
 * Automated coverage for §9.12 AC-TST-* scenarios (mocked file layer).
 */
final class FileAccessSecurityMatrixTest extends TestCase
{
	private function service(
		IRootFolder $root,
		?IEncryptionManager $encryption = null,
	): FileAccessService {
		return new FileAccessService(
			$root,
			$encryption ?? $this->createMock(IEncryptionManager::class),
			$this->createMock(IConfig::class),
		);
	}

	private function userFolderReturning(string $userId, array $byIdMap): IRootFolder
	{
		$folder = $this->createMock(Folder::class);
		$folder->method('getById')->willReturnCallback(static function (int $id) use ($byIdMap): array {
			return $byIdMap[$id] ?? [];
		});
		$root = $this->createMock(IRootFolder::class);
		$root->method('getUserFolder')->with($userId)->willReturn($folder);
		return $root;
	}

	/** AC-TST-01 / AC-TST-02: foreign file not in user mount → 404 */
	public function testForeignFileReturnsNotFound(): void
	{
		$svc = $this->service($this->userFolderReturning('alice', []));
		$this->expectException(NotFoundException::class);
		$svc->resolveReadableFile('alice', 999);
	}

	/** AC-TST-04: invalid ids never resolve */
	public function testInvalidFileIdsRejected(): void
	{
		$root = $this->createMock(IRootFolder::class);
		$root->expects($this->never())->method('getUserFolder');
		$svc = $this->service($root);
		foreach ([0, -1] as $badId) {
			try {
				$svc->resolveReadableFile('alice', $badId);
				$this->fail('Expected NotFoundException for fileId ' . $badId);
			} catch (NotFoundException) {
				// expected
			}
		}
	}

	/** AC-TST-06 / AC-TST-07: permission downgrade → not readable */
	public function testUnreadableFileReturnsNotFound(): void
	{
		$file = $this->createMock(File::class);
		$file->method('isReadable')->willReturn(false);
		$file->method('getMimeType')->willReturn('audio/mpeg');
		$svc = $this->service($this->userFolderReturning('alice', [42 => [$file]]));
		$this->expectException(NotFoundException::class);
		$svc->resolveReadableFile('alice', 42);
	}

	/** AC-TST-08: non-audio mime rejected at gate */
	public function testNonAudioMimeRejected(): void
	{
		$file = $this->createMock(File::class);
		$file->method('isReadable')->willReturn(true);
		$file->method('getMimeType')->willReturn('video/mp4');
		$svc = $this->service($this->userFolderReturning('alice', [7 => [$file]]));
		$this->expectException(NotFoundException::class);
		$svc->resolveReadableFile('alice', 7);
	}

	/** AC-TST-12: encryption forbids local-file fast path */
	public function testEncryptionDisallowsLocalFilePath(): void
	{
		$encryption = $this->createMock(IEncryptionManager::class);
		$encryption->method('isEnabled')->willReturn(true);
		$file = $this->createMock(File::class);
		$svc = $this->service($this->createMock(IRootFolder::class), $encryption);
		$this->assertFalse($svc->mayUseLocalFilePath($file));
		$this->assertNull($svc->getLocalFilePathIfAllowed($file));
	}

	/** AC-TST-13: object storage (non-local) forbids local path */
	public function testObjectStorageDisallowsLocalFilePath(): void
	{
		$encryption = $this->createMock(IEncryptionManager::class);
		$encryption->method('isEnabled')->willReturn(false);
		$storage = $this->createMock(IStorage::class);
		$storage->method('instanceOfStorage')->willReturn(false);
		$file = $this->createMock(File::class);
		$file->method('getStorage')->willReturn($storage);
		$svc = $this->service($this->createMock(IRootFolder::class), $encryption);
		$this->assertFalse($svc->mayUseLocalFilePath($file));
	}

	/** AC-TST-20: duplicate nodes — first readable File wins */
	public function testPicksFirstReadableFileAmongDuplicates(): void
	{
		$unreadable = $this->createMock(File::class);
		$unreadable->method('isReadable')->willReturn(false);
		$readable = $this->createMock(File::class);
		$readable->method('isReadable')->willReturn(true);
		$readable->method('getMimeType')->willReturn('audio/mpeg');
		$svc = $this->service($this->userFolderReturning('alice', [55 => [$unreadable, $readable]]));
		$this->assertSame($readable, $svc->resolveReadableFile('alice', 55));
	}

	/** AC-TST-20: folder node skipped */
	public function testSkipsFolderNodes(): void
	{
		$folder = $this->createMock(Folder::class);
		$file = $this->createMock(File::class);
		$file->method('isReadable')->willReturn(true);
		$file->method('getMimeType')->willReturn('audio/flac');
		$svc = $this->service($this->userFolderReturning('alice', [10 => [$folder, $file]]));
		$this->assertSame($file, $svc->resolveReadableFile('alice', 10));
	}

	public function testIsFileAccessibleMirrorsResolve(): void
	{
		$svc = $this->service($this->userFolderReturning('bob', []));
		$this->assertFalse($svc->isFileAccessible('bob', 1));
	}

	public function testEmptyUserIdRejected(): void
	{
		$svc = $this->service($this->createMock(IRootFolder::class));
		$this->expectException(NotFoundException::class);
		$svc->resolveReadableFile('', 1);
	}

	public function testResolveReadableFolderRequiresFolder(): void
	{
		$file = $this->createMock(File::class);
		$file->method('isReadable')->willReturn(true);
		$svc = $this->service($this->userFolderReturning('alice', [3 => [$file]]));
		$this->expectException(NotFoundException::class);
		$svc->resolveReadableFolder('alice', 3);
	}

	public function testOpenReadStreamFailsWhenFopenFails(): void
	{
		$file = $this->createMock(File::class);
		$file->method('fopen')->with('rb')->willReturn(false);
		$svc = $this->service($this->createMock(IRootFolder::class));
		$this->expectException(NotFoundException::class);
		$svc->openReadStream($file);
	}

	/** AC-TST-09: cover path must use the same file gate */
	public function testCoverServiceUsesFileAccessGate(): void
	{
		$source = file_get_contents(dirname(__DIR__, 3) . '/lib/Service/CoverService.php');
		$this->assertIsString($source);
		$this->assertMatchesRegularExpression(
			'/function getCoverResponse\([^)]+\)[^{]*\{[^}]*resolveReadableFile/s',
			$source,
		);
	}

	/** AC-TST-12: getLocalFile only inside FileAccessService */
	public function testGetLocalFileOnlyInFileAccessService(): void
	{
		$root = dirname(__DIR__, 3);
		$violations = [];
		$iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root . '/lib'));
		foreach ($iterator as $file) {
			if (!$file->isFile() || !str_ends_with($file->getFilename(), '.php')) {
				continue;
			}
			$path = $file->getPathname();
			if (str_contains($path, '/Service/FileAccessService.php')) {
				continue;
			}
			$content = file_get_contents($path);
			if ($content !== false && preg_match('/getLocalFile\s*\(/', $content)) {
				$violations[] = $path;
			}
		}
		$this->assertSame([], $violations, 'getLocalFile must not appear outside FileAccessService');
	}
}
