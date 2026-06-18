<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use OCA\AudioCheck\Exception\NotFoundException;
use OCA\AudioCheck\Service\FileAccessService;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use OCP\IConfig;
use OCP\Encryption\IManager as IEncryptionManager;
use PHPUnit\Framework\TestCase;

final class FileAccessServiceTest extends TestCase
{
	public function testResolveReadableFileThrowsWhenNoNodes(): void
	{
		$folder = $this->createMock(Folder::class);
		$folder->method('getById')->with(42)->willReturn([]);
		$root = $this->createMock(IRootFolder::class);
		$root->method('getUserFolder')->with('alice')->willReturn($folder);
		$svc = new FileAccessService($root, $this->createMock(IEncryptionManager::class), $this->createMock(IConfig::class));
		$this->expectException(NotFoundException::class);
		$svc->resolveReadableFile('alice', 42);
	}

	public function testResolveReadableFileReturnsReadableAudio(): void
	{
		$file = $this->createMock(File::class);
		$file->method('isReadable')->willReturn(true);
		$file->method('getMimeType')->willReturn('audio/mpeg');
		$folder = $this->createMock(Folder::class);
		$folder->method('getById')->willReturn([$file]);
		$root = $this->createMock(IRootFolder::class);
		$root->method('getUserFolder')->willReturn($folder);
		$svc = new FileAccessService($root, $this->createMock(IEncryptionManager::class), $this->createMock(IConfig::class));
		$this->assertSame($file, $svc->resolveReadableFile('alice', 7));
	}

	public function testAllowedAudioMimePrefixes(): void
	{
		$root = $this->createMock(IRootFolder::class);
		$svc = new FileAccessService($root, $this->createMock(IEncryptionManager::class), $this->createMock(IConfig::class));
		$this->assertTrue($svc->isAllowedAudioMime('audio/mpeg'));
		$this->assertTrue($svc->isAllowedAudioMime('audio/mp3')); // audio/* prefix
		$this->assertTrue($svc->isAllowedAudioMime('video/mp4', 'podcast.mp4'));
		$this->assertTrue($svc->isAllowedAudioMime('video/mp4', 'chapter.m4a'));
		$this->assertFalse($svc->isAllowedAudioMime('video/mp4'));
		$this->assertFalse($svc->isAllowedAudioMime('video/mp4', 'movie.mov'));
		$this->assertFalse($svc->isAllowedAudioMime('video/quicktime'));
	}

	public function testResolveReadableFileAcceptsMp4AudioContainer(): void
	{
		$file = $this->createMock(File::class);
		$file->method('isReadable')->willReturn(true);
		$file->method('getMimeType')->willReturn('video/mp4');
		$file->method('getName')->willReturn('audiobook.mp4');
		$folder = $this->createMock(Folder::class);
		$folder->method('getById')->willReturn([$file]);
		$root = $this->createMock(IRootFolder::class);
		$root->method('getUserFolder')->willReturn($folder);
		$svc = new FileAccessService($root, $this->createMock(IEncryptionManager::class), $this->createMock(IConfig::class));
		$this->assertSame($file, $svc->resolveReadableFile('alice', 7));
	}

	public function testBrowserPlayableClassification(): void
	{
		$root = $this->createMock(IRootFolder::class);
		$svc = new FileAccessService($root, $this->createMock(IEncryptionManager::class), $this->createMock(IConfig::class));
		$this->assertTrue($svc->isLikelyBrowserPlayable('audio/mpeg'));
		$this->assertTrue($svc->isLikelyBrowserPlayable('audio/mp4'));
		$this->assertTrue($svc->isLikelyBrowserPlayable('video/mp4', 'podcast.mp4'));
		$this->assertFalse($svc->isLikelyBrowserPlayable('video/mp4', 'movie.mov'));
		$this->assertFalse($svc->isLikelyBrowserPlayable('audio/flac'));
		$this->assertFalse($svc->isLikelyBrowserPlayable('audio/x-ms-wma'));
		$this->assertFalse($svc->isLikelyBrowserPlayable('audio/aiff'));
	}

	public function testNormalizeLibraryFolderPathStripsUserFilesPrefix(): void
	{
		$userFolder = $this->createMock(Folder::class);
		$userFolder->method('getPath')->willReturn('/root/files');
		$root = $this->createMock(IRootFolder::class);
		$root->method('getUserFolder')->with('root')->willReturn($userFolder);
		$svc = new FileAccessService($root, $this->createMock(IEncryptionManager::class), $this->createMock(IConfig::class));
		$this->assertSame('/Audiobooks', $svc->normalizeLibraryFolderPath('root', '/root/files/Audiobooks'));
		$this->assertSame('/Music', $svc->normalizeLibraryFolderPath('root', '/remote.php/dav/files/root/Music'));
	}
}
