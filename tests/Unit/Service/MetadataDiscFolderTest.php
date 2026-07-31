<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use OCA\AudioCheck\Service\AccessControlService;
use OCA\AudioCheck\Service\FileAccessService;
use OCA\AudioCheck\Service\MetadataService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\IDBConnection;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * Multi-disc / chapter-folder audiobooks (Book/CD 1/01.mp3) must group by the
 * book folder — not one "book" per disc folder — and keep disc order playable.
 */
final class MetadataDiscFolderTest extends TestCase
{
	private MetadataService $service;

	/** @var FileAccessService&\PHPUnit\Framework\MockObject\MockObject */
	private $fileAccess;

	protected function setUp(): void
	{
		parent::setUp();
		$this->fileAccess = $this->createMock(FileAccessService::class);
		$accessControl = $this->createMock(AccessControlService::class);
		// Force the "no analyzable path" branch by default: metadata falls back
		// to filesystem-derived defaults, which is the code under test here.
		$this->fileAccess->method('getLocalFilePathIfAllowed')->willReturn(null);
		$accessControl->method('getMaxMetaTempMb')->willReturn(0);

		$this->service = new MetadataService(
			$this->createMock(IDBConnection::class),
			$this->fileAccess,
			$accessControl,
			$this->createMock(ITimeFactory::class),
			$this->createMock(LoggerInterface::class),
		);
	}

	public function testUntaggedFileInDiscFolderGroupsByBookFolder(): void
	{
		$file = $this->makeFile('01 - Anfang.mp3', 'CD 1', 'Momo');

		$tags = $this->service->extractTags($file);

		$this->assertSame('Momo', $tags['album']);
		$this->assertSame(1, $tags['disc_no']);
		$this->assertSame('01 - Anfang', $tags['title']);
	}

	/** @dataProvider discFolderNames */
	public function testDiscFolderNamingVariantsAreCollapsed(string $folderName, int $expectedDisc): void
	{
		$file = $this->makeFile('track.mp3', $folderName, 'Book Title');

		$tags = $this->service->extractTags($file);

		$this->assertSame('Book Title', $tags['album']);
		$this->assertSame($expectedDisc, $tags['disc_no']);
	}

	/** @return array<string, array{0:string,1:int}> */
	public static function discFolderNames(): array
	{
		return [
			'CD with space' => ['CD 2', 2],
			'cd lowercase glued' => ['cd3', 3],
			'Disc' => ['Disc 4', 4],
			'Disk underscore' => ['Disk_5', 5],
			'Part dash' => ['Part-6', 6],
			'Chapter padded' => ['Chapter 07', 7],
			'German Kapitel' => ['Kapitel 8', 8],
			'German Teil dotted' => ['Teil.9', 9],
		];
	}

	/** @dataProvider nonDiscFolderNames */
	public function testRealBookFolderNamesAreNotCollapsed(string $folderName): void
	{
		$file = $this->makeFile('track.mp3', $folderName, 'Author Name');

		$tags = $this->service->extractTags($file);

		$this->assertSame($folderName, $tags['album']);
		$this->assertNull($tags['disc_no']);
	}

	/** @return array<string, array{0:string}> */
	public static function nonDiscFolderNames(): array
	{
		return [
			'book title containing part' => ['Harry Potter Part 1'],
			'plain book title' => ['Die unendliche Geschichte'],
			'bare number' => ['2'],
			'disc word without number' => ['CD'],
			'cd zero' => ['CD 0'],
		];
	}

	public function testDiscFolderDirectlyUnderUserHomeKeepsDiscFolderAsAlbum(): void
	{
		// 'files' is the user-home container node, never a real book folder.
		$file = $this->makeFile('track.mp3', 'CD 1', 'files');

		$tags = $this->service->extractTags($file);

		$this->assertSame('CD 1', $tags['album']);
		$this->assertSame(1, $tags['disc_no']);
	}

	public function testFileWithoutResolvableParentFallsBackToTitle(): void
	{
		$file = $this->createMock(File::class);
		$file->method('getName')->willReturn('lonely.mp3');
		$file->method('getMimeType')->willReturn('audio/mpeg');
		$file->method('getSize')->willReturn(10);
		$file->method('getParent')->willThrowException(new \RuntimeException('no parent'));

		$tags = $this->service->extractTags($file);

		$this->assertSame('lonely', $tags['album']);
		$this->assertNull($tags['disc_no']);
	}

	public function testTaggedAlbumAndDiscNumberWinOverFolderInference(): void
	{
		if (!class_exists(\getID3::class)) {
			$this->markTestSkipped('getID3 is not installed.');
		}

		$tempPath = tempnam(sys_get_temp_dir(), 'ac_test_');
		$this->assertIsString($tempPath);
		file_put_contents($tempPath, $this->mp3WithId3v2Tags(['TALB' => 'Tagged Album', 'TPOS' => '7']));

		try {
			$file = $this->makeFile('01.mp3', 'CD 1', 'Folder Book');
			$fileAccess = $this->createMock(FileAccessService::class);
			$fileAccess->method('getLocalFilePathIfAllowed')->willReturn($tempPath);
			$service = new MetadataService(
				$this->createMock(IDBConnection::class),
				$fileAccess,
				$this->createMock(AccessControlService::class),
				$this->createMock(ITimeFactory::class),
				$this->createMock(LoggerInterface::class),
			);

			$tags = $service->extractTags($file);

			$this->assertSame('Tagged Album', $tags['album']);
			$this->assertSame(7, $tags['disc_no']);
		} finally {
			@unlink($tempPath);
		}
	}

	private function makeFile(string $name, string $parentName, string $grandParentName): File
	{
		$grandParent = $this->createMock(Folder::class);
		$grandParent->method('getName')->willReturn($grandParentName);

		$parent = $this->createMock(Folder::class);
		$parent->method('getName')->willReturn($parentName);
		$parent->method('getParent')->willReturn($grandParent);

		$file = $this->createMock(File::class);
		$file->method('getName')->willReturn($name);
		$file->method('getMimeType')->willReturn('audio/mpeg');
		$file->method('getSize')->willReturn(10);
		$file->method('getParent')->willReturn($parent);

		return $file;
	}

	/** @param array<string, string> $frames ID3v2.3 text frames (frame id => value). */
	private function mp3WithId3v2Tags(array $frames): string
	{
		$body = '';
		foreach ($frames as $frameId => $value) {
			$data = "\x00" . $value; // ISO-8859-1 text encoding marker
			$body .= $frameId . pack('N', strlen($data)) . "\x00\x00" . $data;
		}
		$size = strlen($body);
		$synchsafe = chr(($size >> 21) & 0x7F) . chr(($size >> 14) & 0x7F) . chr(($size >> 7) & 0x7F) . chr($size & 0x7F);

		return 'ID3' . "\x03\x00" . "\x00" . $synchsafe . $body
			. "\xFF\xFB\x90\x00" . str_repeat("\x00", 128);
	}
}
