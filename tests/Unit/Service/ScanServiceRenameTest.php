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
use OCP\Files\Folder;
use OCP\Files\Node;
use OCP\IDBConnection;
use OCP\IConfig;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * AC-TST-NODE-02: ScanService rename/copy semantics + immediate library_id reconcile.
 */
final class ScanServiceRenameTest extends TestCase
{
	public function testHandleRenameSameFileIdUpsertsTargetOnly(): void
	{
		$target = $this->audioFile(10);
		$source = $this->nodeWithId(10);

		$scan = $this->partialScanMock(['handleNodeEvent', 'deleteTrackForFile', 'rewritePathsAfterFolderMove']);
		$scan->expects($this->never())->method('deleteTrackForFile');
		$scan->expects($this->never())->method('rewritePathsAfterFolderMove');
		$scan->expects($this->once())->method('handleNodeEvent')->with('alice', $target, 'written');

		$scan->handleRename('alice', $source, $target);
	}

	public function testHandleRenameCrossStoragePurgesSourceThenUpsertsTarget(): void
	{
		$target = $this->audioFile(20);
		$source = $this->nodeWithId(10);

		$scan = $this->partialScanMock(['handleNodeEvent', 'deleteTrackForFile', 'rewritePathsAfterFolderMove']);
		$scan->expects($this->once())->method('deleteTrackForFile')->with('alice', 10);
		$scan->expects($this->once())->method('handleNodeEvent')->with('alice', $target, 'written');

		$scan->handleRename('alice', $source, $target);
	}

	public function testHandleRenameNonAudioDropsSourceAndTargetIds(): void
	{
		$target = $this->nonAudioFile(20);
		$source = $this->nodeWithId(10);

		$scan = $this->partialScanMock(['handleNodeEvent', 'deleteTrackForFile', 'rewritePathsAfterFolderMove']);
		$scan->expects($this->never())->method('handleNodeEvent');
		$scan->expects($this->exactly(2))
			->method('deleteTrackForFile')
			->withConsecutive(['alice', 10], ['alice', 20]);

		$scan->handleRename('alice', $source, $target);
	}

	public function testHandleRenameNonAudioSameIdDeletesOnce(): void
	{
		$target = $this->nonAudioFile(10);
		$source = $this->nodeWithId(10);

		$scan = $this->partialScanMock(['handleNodeEvent', 'deleteTrackForFile', 'rewritePathsAfterFolderMove']);
		$scan->expects($this->once())->method('deleteTrackForFile')->with('alice', 10);
		$scan->expects($this->never())->method('handleNodeEvent');

		$scan->handleRename('alice', $source, $target);
	}

	public function testHandleRenameFolderRewritesPathsAndNeverDeletesByFolderId(): void
	{
		$target = $this->createMock(Folder::class);
		$source = $this->nodeWithId(99);

		$scan = $this->partialScanMock(['handleNodeEvent', 'deleteTrackForFile', 'rewritePathsAfterFolderMove']);
		$scan->expects($this->once())->method('rewritePathsAfterFolderMove')->with('alice', $source, $target);
		$scan->expects($this->never())->method('deleteTrackForFile');
		$scan->expects($this->never())->method('handleNodeEvent');

		$scan->handleRename('alice', $source, $target);
	}

	public function testHandleRenameIgnoresEmptyUser(): void
	{
		$target = $this->audioFile(1);
		$source = $this->nodeWithId(1);

		$scan = $this->partialScanMock(['handleNodeEvent', 'deleteTrackForFile', 'rewritePathsAfterFolderMove']);
		$scan->expects($this->never())->method('handleNodeEvent');
		$scan->expects($this->never())->method('deleteTrackForFile');
		$scan->expects($this->never())->method('rewritePathsAfterFolderMove');

		$scan->handleRename('', $source, $target);
	}

	public function testHandleRenameSurvivesSourceIdThrowing(): void
	{
		$target = $this->audioFile(30);
		$source = $this->createMock(Node::class);
		$source->method('getId')->willThrowException(new \RuntimeException('nonexisting'));

		$scan = $this->partialScanMock(['handleNodeEvent', 'deleteTrackForFile', 'rewritePathsAfterFolderMove']);
		$scan->expects($this->never())->method('deleteTrackForFile');
		$scan->expects($this->once())->method('handleNodeEvent')->with('alice', $target, 'written');

		$scan->handleRename('alice', $source, $target);
	}

	public function testHandleCopyUpsertsAudioTargetWithoutDeletingSource(): void
	{
		$target = $this->audioFile(40);
		$source = $this->nodeWithId(10);

		$scan = $this->partialScanMock(['handleNodeEvent', 'deleteTrackForFile', 'indexFolderIntoLibraries']);
		$scan->expects($this->once())->method('handleNodeEvent')->with('alice', $target, 'written');
		$scan->expects($this->never())->method('deleteTrackForFile');
		$scan->expects($this->never())->method('indexFolderIntoLibraries');

		$scan->handleCopy('alice', $source, $target);
	}

	public function testHandleCopyNonAudioIsNoop(): void
	{
		$target = $this->nonAudioFile(40);
		$source = $this->nodeWithId(10);

		$scan = $this->partialScanMock(['handleNodeEvent', 'deleteTrackForFile', 'indexFolderIntoLibraries']);
		$scan->expects($this->never())->method('handleNodeEvent');
		$scan->expects($this->never())->method('deleteTrackForFile');
		$scan->expects($this->never())->method('indexFolderIntoLibraries');

		$scan->handleCopy('alice', $source, $target);
	}

	public function testHandleCopyFolderDelegatesToIndexFolderIntoLibraries(): void
	{
		$target = $this->createMock(Folder::class);
		$source = $this->nodeWithId(1);

		$scan = $this->partialScanMock(['handleNodeEvent', 'deleteTrackForFile', 'indexFolderIntoLibraries']);
		$scan->expects($this->once())->method('indexFolderIntoLibraries')->with('alice', $target);
		$scan->expects($this->never())->method('handleNodeEvent');

		$scan->handleCopy('alice', $source, $target);
	}

	public function testIndexFolderIntoLibrariesQueuesScanOnlyWhenWalkTruncated(): void
	{
		$folder = $this->createMock(Folder::class);
		$scan = $this->partialScanMock(['folderIntersectsLibrary', 'indexAudioUnderFolder', 'queueScan']);
		$scan->method('folderIntersectsLibrary')->willReturn(true);
		$scan->expects($this->once())->method('indexAudioUnderFolder')->willReturn(false);
		$scan->expects($this->once())->method('queueScan')->with('alice');

		$scan->indexFolderIntoLibraries('alice', $folder);
	}

	public function testIndexFolderIntoLibrariesDoesNotQueueScanWhenComplete(): void
	{
		$folder = $this->createMock(Folder::class);
		$scan = $this->partialScanMock(['folderIntersectsLibrary', 'indexAudioUnderFolder', 'queueScan']);
		$scan->method('folderIntersectsLibrary')->willReturn(true);
		$scan->expects($this->once())->method('indexAudioUnderFolder')->willReturn(true);
		$scan->expects($this->never())->method('queueScan');

		$scan->indexFolderIntoLibraries('alice', $folder);
	}

	public function testIndexFolderIntoLibrariesSkipsOutsideLibraries(): void
	{
		$folder = $this->createMock(Folder::class);
		$scan = $this->partialScanMock(['folderIntersectsLibrary', 'indexAudioUnderFolder', 'queueScan']);
		$scan->method('folderIntersectsLibrary')->willReturn(false);
		$scan->expects($this->never())->method('indexAudioUnderFolder');
		$scan->expects($this->never())->method('queueScan');

		$scan->indexFolderIntoLibraries('alice', $folder);
	}

	public function testDeletedEventUsesSafeNodeId(): void
	{
		$node = $this->createMock(Node::class);
		$node->method('getId')->willThrowException(new \RuntimeException('gone'));

		$scan = $this->partialScanMock(['deleteTrackForFile']);
		$scan->expects($this->never())->method('deleteTrackForFile');

		$scan->handleNodeEvent('alice', $node, 'deleted');
	}

	public function testResolveLibraryForRelPathHonoursIncludeSubfolders(): void
	{
		$fileAccess = $this->createMock(FileAccessService::class);
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
			->onlyMethods(['listLibraryRoots'])
			->getMock();

		$scan->method('listLibraryRoots')->willReturn([
			[
				'id' => 7,
				'folder_path' => '/Music',
				'include_subfolders' => 0,
				'content_kind' => 'auto',
			],
		]);

		$direct = $scan->resolveLibraryForRelPath('alice', '/Music/track.mp3');
		$this->assertNotNull($direct);
		$this->assertSame(7, (int)$direct['id']);

		$nested = $scan->resolveLibraryForRelPath('alice', '/Music/Album/track.mp3');
		$this->assertNull($nested);
	}

	public function testResolveLibraryForRelPathLongestPrefixWins(): void
	{
		$scan = $this->getMockBuilder(ScanService::class)
			->setConstructorArgs([
				$this->createMock(IDBConnection::class),
				$this->createMock(FileAccessService::class),
				$this->createMock(MetadataService::class),
				$this->createMock(CoverService::class),
				$this->createMock(ITimeFactory::class),
				$this->createMock(IJobList::class),
				$this->createMock(IConfig::class),
				$this->createMock(LoggerInterface::class),
			])
			->onlyMethods(['listLibraryRoots'])
			->getMock();

		$scan->method('listLibraryRoots')->willReturn([
			['id' => 1, 'folder_path' => '/Music', 'include_subfolders' => 1, 'content_kind' => 'auto'],
			['id' => 2, 'folder_path' => '/Music/Jazz', 'include_subfolders' => 1, 'content_kind' => 'auto'],
		]);

		$hit = $scan->resolveLibraryForRelPath('alice', '/Music/Jazz/x.mp3');
		$this->assertNotNull($hit);
		$this->assertSame(2, (int)$hit['id']);
	}

	public function testRewritePathsDoesNotQueueScanForLibraryId(): void
	{
		$source = file_get_contents(dirname(__DIR__, 3) . '/lib/Service/ScanService.php');
		$this->assertIsString($source);
		$this->assertStringContainsString('rewriteTrackPathsAndLibraryIds', $source);
		$this->assertStringContainsString('indexFolderIntoLibraries', $source);
		$this->assertDoesNotMatchRegularExpression(
			'/rewriteTrackPathsAndLibraryIds\([^;]+;\s*[^}]*queueScan/s',
			$source,
		);
		// Immediate library_id assignment must happen in the rewrite loop.
		$this->assertMatchesRegularExpression(
			'/function\s+rewriteTrackPathsAndLibraryIds.*?set\(\'library_id\'/s',
			$source,
		);
	}

	/**
	 * @param list<string> $methods
	 */
	private function partialScanMock(array $methods): ScanService&MockObject
	{
		$fileAccess = $this->createMock(FileAccessService::class);
		$fileAccess->method('isAllowedAudioFile')->willReturnCallback(
			static function (File $file): bool {
				return str_starts_with((string)$file->getMimeType(), 'audio/');
			},
		);

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
			->onlyMethods($methods)
			->getMock();

		return $scan;
	}

	private function audioFile(int $id): File&MockObject
	{
		$file = $this->createMock(File::class);
		$file->method('getId')->willReturn($id);
		$file->method('getMimeType')->willReturn('audio/mpeg');
		$file->method('getName')->willReturn('track.mp3');
		return $file;
	}

	private function nonAudioFile(int $id): File&MockObject
	{
		$file = $this->createMock(File::class);
		$file->method('getId')->willReturn($id);
		$file->method('getMimeType')->willReturn('image/jpeg');
		$file->method('getName')->willReturn('photo.jpg');
		return $file;
	}

	private function nodeWithId(int $id): Node&MockObject
	{
		$node = $this->createMock(Node::class);
		$node->method('getId')->willReturn($id);
		return $node;
	}
}
