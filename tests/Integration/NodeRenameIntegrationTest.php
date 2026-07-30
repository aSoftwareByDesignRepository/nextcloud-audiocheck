<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Integration;

use OCA\AudioCheck\Listener\NodeEventListener;
use OCA\AudioCheck\Service\FileAccessService;
use OCA\AudioCheck\Service\ScanService;
use OCP\Files\Events\Node\NodeRenamedEvent;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\Node;
use OCP\Files\NotFoundException;
use OCP\IUserManager;
use Test\TestCase;

/**
 * AC-TST-NODE-03: rename/move must not fatal, and audio track rel_path must update.
 */
final class NodeRenameIntegrationTest extends TestCase
{
	private const USER = 'ac_rename_user';
	private const PASSWORD = 'ac-test-pass-9xK!';

	protected function setUp(): void
	{
		if (!class_exists(\OC::class) || !isset(\OC::$server)) {
			$this->markTestSkipped('Nextcloud is not bootstrapped (run inside Docker with NEXTCLOUD_ROOT).');
		}
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		if ($userManager->userExists(self::USER)) {
			$userManager->get(self::USER)?->delete();
		}
	}

	protected function tearDown(): void
	{
		if (!isset(\OC::$server)) {
			return;
		}
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		if ($userManager->userExists(self::USER)) {
			$userManager->get(self::USER)?->delete();
		}
	}

	public function testListenerHandlesRenamedEventWithoutFatal(): void
	{
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		$userManager->createUser(self::USER, self::PASSWORD);

		/** @var FileAccessService $access */
		$access = \OC::$server->get(FileAccessService::class);
		$home = $access->getUserFolder(self::USER);
		/** @var Folder $srcDir */
		$srcDir = $home->newFolder('RenameSrc');
		/** @var Folder $dstDir */
		$dstDir = $home->newFolder('RenameDst');
		/** @var File $file */
		$file = $srcDir->newFile('move-me.jpg');
		$file->putContent('not-audio-but-must-not-fatal');

		$file->move($dstDir->getPath() . '/move-me.jpg');
		$target = $dstDir->get('move-me.jpg');
		$this->assertInstanceOf(File::class, $target);

		/** @var NodeEventListener $listener */
		$listener = \OC::$server->get(NodeEventListener::class);
		$listener->handle(new NodeRenamedEvent($this->vacatedSourceNode(), $target));
		$this->addToAssertionCount(1);
	}

	public function testAudioRenameUpdatesTrackRelPath(): void
	{
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		$userManager->createUser(self::USER, self::PASSWORD);

		/** @var FileAccessService $access */
		$access = \OC::$server->get(FileAccessService::class);
		$home = $access->getUserFolder(self::USER);
		/** @var Folder $srcDir */
		$srcDir = $home->newFolder('AudioSrc');
		/** @var Folder $dstDir */
		$dstDir = $home->newFolder('AudioDst');
		/** @var File $file */
		$file = $srcDir->newFile('chapter.mp3');
		$file->putContent($this->minimalMp3Bytes());
		$fileId = (int)$file->getId();

		/** @var ScanService $scan */
		$scan = \OC::$server->get(ScanService::class);
		$scan->handleNodeEvent(self::USER, $file, 'written');
		$this->assertTrue($this->trackExists(self::USER, $fileId));
		$beforePath = $this->trackRelPath(self::USER, $fileId);
		$this->assertNotNull($beforePath);
		$this->assertStringContainsString('AudioSrc', (string)$beforePath);

		$file->move($dstDir->getPath() . '/chapter.mp3');
		/** @var File $target */
		$target = $dstDir->get('chapter.mp3');
		$this->assertSame($fileId, (int)$target->getId());

		$scan->handleRename(self::USER, $this->vacatedSourceNode(), $target);

		$afterPath = $this->trackRelPath(self::USER, $fileId);
		$this->assertNotNull($afterPath);
		$this->assertStringContainsString('AudioDst', (string)$afterPath);
		$this->assertStringNotContainsString('AudioSrc', (string)$afterPath);
	}

	public function testFilesystemMoveDoesNotFatalWithListenerRegistered(): void
	{
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		$userManager->createUser(self::USER, self::PASSWORD);

		/** @var FileAccessService $access */
		$access = \OC::$server->get(FileAccessService::class);
		$home = $access->getUserFolder(self::USER);
		$src = $home->newFolder('LiveSrc');
		$dst = $home->newFolder('LiveDst');
		$file = $src->newFile('photo.png');
		$file->putContent('png-bytes');

		// Real rename dispatches NodeRenamedEvent through HookConnector; must not fatal.
		$file->move($dst->getPath() . '/photo.png');
		$this->assertTrue($dst->nodeExists('photo.png'));
		$this->assertFalse($src->nodeExists('photo.png'));
	}

	public function testFolderRenameRewritesDescendantTrackPaths(): void
	{
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		$userManager->createUser(self::USER, self::PASSWORD);

		/** @var FileAccessService $access */
		$access = \OC::$server->get(FileAccessService::class);
		$home = $access->getUserFolder(self::USER);
		/** @var Folder $book */
		$book = $home->newFolder('BookOld');
		/** @var File $file */
		$file = $book->newFile('ch1.mp3');
		$file->putContent($this->minimalMp3Bytes());
		$fileId = (int)$file->getId();

		/** @var ScanService $scan */
		$scan = \OC::$server->get(ScanService::class);
		$scan->handleNodeEvent(self::USER, $file, 'written');
		$before = $this->trackRelPath(self::USER, $fileId);
		$this->assertNotNull($before);
		$this->assertStringContainsString('BookOld', (string)$before);

		$oldBookPath = $book->getPath();
		$book->move($home->getPath() . '/BookNew');
		/** @var Folder $renamed */
		$renamed = $home->get('BookNew');
		$this->assertInstanceOf(Folder::class, $renamed);

		// Supply vacated source that still exposes the old path (NonExistingFile shape).
		$sourceWithPath = $this->createMock(Node::class);
		$sourceWithPath->method('getId')->willThrowException(new NotFoundException());
		$sourceWithPath->method('getPath')->willReturn($oldBookPath);
		$sourceWithPath->method('getOwner')->willThrowException(new NotFoundException());

		$scan->handleRename(self::USER, $sourceWithPath, $renamed);

		$after = $this->trackRelPath(self::USER, $fileId);
		$this->assertNotNull($after);
		$this->assertStringContainsString('BookNew', (string)$after);
		$this->assertStringNotContainsString('BookOld', (string)$after);
	}

	/**
	 * Post-rename source path is gone; getId()/getOwner() throw — mirrors NonExistingFile.
	 */
	private function vacatedSourceNode(): Node
	{
		$node = $this->createMock(Node::class);
		$node->method('getId')->willThrowException(new NotFoundException());
		$node->method('getOwner')->willThrowException(new NotFoundException());
		return $node;
	}

	private function trackExists(string $userId, int $fileId): bool
	{
		return $this->trackRelPath($userId, $fileId) !== null;
	}

	private function trackRelPath(string $userId, int $fileId): ?string
	{
		$db = \OC::$server->get(\OCP\IDBConnection::class);
		$qb = $db->getQueryBuilder();
		$qb->select('rel_path')->from('ac_tracks')
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, \PDO::PARAM_INT)));
		$row = $qb->executeQuery()->fetch();
		if ($row === false) {
			return null;
		}
		return (string)$row['rel_path'];
	}

	private function minimalMp3Bytes(): string
	{
		return "ID3\x03\x00\x00\x00\x00\x00\x00"
			. "\xFF\xFB\x90\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00";
	}
}
