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
 * AC-TST-NODE-02: ScanService rename/copy semantics.
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

		$scan = $this->partialScanMock(['handleNodeEvent', 'deleteTrackForFile', 'queueScan']);
		$scan->expects($this->once())->method('handleNodeEvent')->with('alice', $target, 'written');
		$scan->expects($this->never())->method('deleteTrackForFile');
		$scan->expects($this->never())->method('queueScan');

		$scan->handleCopy('alice', $source, $target);
	}

	public function testHandleCopyNonAudioIsNoop(): void
	{
		$target = $this->nonAudioFile(40);
		$source = $this->nodeWithId(10);

		$scan = $this->partialScanMock(['handleNodeEvent', 'deleteTrackForFile', 'queueScan']);
		$scan->expects($this->never())->method('handleNodeEvent');
		$scan->expects($this->never())->method('deleteTrackForFile');
		$scan->expects($this->never())->method('queueScan');

		$scan->handleCopy('alice', $source, $target);
	}

	public function testHandleCopyFolderQueuesScanWhenUnderLibrary(): void
	{
		$target = $this->createMock(Folder::class);
		$target->method('getPath')->willReturn('/alice/files/Music/Album');
		$source = $this->nodeWithId(1);

		$fileAccess = $this->createMock(FileAccessService::class);
		$fileAccess->method('getUserHomePath')->with('alice')->willReturn('/alice/files');
		$fileAccess->method('isAllowedAudioFile')->willReturn(false);

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
			->onlyMethods(['queueScan', 'listLibraryRoots', 'handleNodeEvent', 'deleteTrackForFile'])
			->getMock();

		$scan->method('listLibraryRoots')->willReturn([
			['id' => 1, 'folder_path' => '/Music', 'content_kind' => 'auto'],
		]);
		$scan->expects($this->once())->method('queueScan')->with('alice');

		$scan->handleCopy('alice', $source, $target);
	}

	public function testHandleCopyFolderSkipsScanOutsideLibraries(): void
	{
		$target = $this->createMock(Folder::class);
		$target->method('getPath')->willReturn('/alice/files/Documents/Stuff');
		$source = $this->nodeWithId(1);

		$fileAccess = $this->createMock(FileAccessService::class);
		$fileAccess->method('getUserHomePath')->with('alice')->willReturn('/alice/files');

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
			->onlyMethods(['queueScan', 'listLibraryRoots', 'handleNodeEvent', 'deleteTrackForFile'])
			->getMock();

		$scan->method('listLibraryRoots')->willReturn([
			['id' => 1, 'folder_path' => '/Music', 'content_kind' => 'auto'],
		]);
		$scan->expects($this->never())->method('queueScan');

		$scan->handleCopy('alice', $source, $target);
	}

	public function testDeletedEventUsesSafeNodeId(): void
	{
		$node = $this->createMock(Node::class);
		$node->method('getId')->willThrowException(new \RuntimeException('gone'));

		$scan = $this->partialScanMock(['deleteTrackForFile']);
		$scan->expects($this->never())->method('deleteTrackForFile');

		$scan->handleNodeEvent('alice', $node, 'deleted');
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
