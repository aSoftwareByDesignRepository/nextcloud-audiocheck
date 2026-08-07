<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use OCA\AudioCheck\Service\CoverService;
use OCA\AudioCheck\Service\FileAccessService;
use OCA\AudioCheck\Service\MetadataService;
use OCA\AudioCheck\Service\ScanService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\IJobList;
use OCP\Files\File;
use OCP\IDBConnection;
use OCP\IConfig;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * Library-scope indexing: audio outside enabled roots must never enter ac_tracks.
 */
final class ScanServiceLibraryScopeTest extends TestCase
{
	public function testHandleNodeEventOutsideLibraryDeletesExistingAndDoesNotUpsert(): void
	{
		$file = $this->createMock(File::class);
		$file->method('getId')->willReturn(42);
		$file->method('getMimeType')->willReturn('audio/mpeg');
		$file->method('getPath')->willReturn('/alice/files/Downloads/noise.mp3');

		$fileAccess = $this->createMock(FileAccessService::class);
		$fileAccess->method('isAllowedAudioFile')->willReturn(true);
		$fileAccess->method('getUserHomePath')->willReturn('/alice/files');

		/** @var ScanService&MockObject $scan */
		$scan = $this->getMockBuilder(ScanService::class)
			->setConstructorArgs([
				$this->createMock(IDBConnection::class),
				$fileAccess,
				$this->createMock(MetadataService::class),
				$this->createMock(CoverService::class),
				$this->createMock(ITimeFactory::class),
				$this->createMock(IJobList::class),
				$this->createMock(IConfig::class),
				$this->createMock(LoggerInterface::class),
			])
			->onlyMethods(['listLibraryRoots', 'deleteTrackForFile'])
			->getMock();

		$scan->method('listLibraryRoots')->willReturn([
			[
				'id' => 9,
				'folder_path' => '/Privat/Music',
				'include_subfolders' => 1,
				'content_kind' => 'music',
			],
		]);
		$scan->expects($this->once())->method('deleteTrackForFile')->with('alice', 42);

		$scan->handleNodeEvent('alice', $file, 'written');
	}

	public function testHandleNodeEventSourceRejectsOutOfLibraryBeforeUpsert(): void
	{
		$source = (string)file_get_contents(dirname(__DIR__, 3) . '/lib/Service/ScanService.php');
		$this->assertStringContainsString('Outside every enabled library (or no libraries): never index.', $source);
		$this->assertStringContainsString('if ($libraryId < 1)', $source);
		$pos = strpos($source, 'Outside every enabled library (or no libraries): never index.');
		$this->assertNotFalse($pos);
		$window = substr($source, max(0, $pos - 120), 360);
		$this->assertStringContainsString('deleteTrackForFile', $window);
		$this->assertStringContainsString('return;', $window);
	}

	public function testSourceNeverFallsBackToWholeHomeWhenLibrariesEmpty(): void
	{
		$source = (string)file_get_contents(dirname(__DIR__, 3) . '/lib/Service/ScanService.php');
		$this->assertStringContainsString('purgeTracksOutsideLibraries', $source);
		$this->assertStringContainsString('No configured libraries ⇒ empty catalog', $source);
		$this->assertStringNotContainsString('KEY_DEFAULT_LIBRARY_FOLDER', $source);
		$pos = strpos($source, 'No configured libraries ⇒ empty catalog');
		$this->assertNotFalse($pos);
		$window = substr($source, max(0, $pos - 80), 420);
		$this->assertStringContainsString('purgeTracksOutsideLibraries', $window);
		$this->assertStringNotContainsString("\$roots[] =", $window);
	}

	public function testUpsertTrackHardRejectsUnresolvedLibrary(): void
	{
		$source = (string)file_get_contents(dirname(__DIR__, 3) . '/lib/Service/ScanService.php');
		$this->assertMatchesRegularExpression(
			'/function\s+upsertTrack.*?if\s*\(\s*\$resolved\s*===\s*null\s*\)\s*\{[^}]*deleteTrackForFile/s',
			$source,
		);
	}

	public function testRewriteOutOfLibraryDeletesTrack(): void
	{
		$source = (string)file_get_contents(dirname(__DIR__, 3) . '/lib/Service/ScanService.php');
		$this->assertMatchesRegularExpression(
			'/function\s+rewriteTrackPathsAndLibraryIds.*?if\s*\(\s*\$libraryId\s*<\s*1\s*\)\s*\{[^}]*deleteTrackForFile/s',
			$source,
		);
	}
}
