<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use OCA\AudioCheck\Exception\ValidationException;
use OCA\AudioCheck\Service\LibraryService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IDBConnection;
use OCP\ITagManager;
use OCP\SystemTag\ISystemTagManager;
use OCP\SystemTag\ISystemTagObjectMapper;
use PHPUnit\Framework\TestCase;

final class LibraryContentKindTest extends TestCase
{
	private LibraryService $library;

	protected function setUp(): void
	{
		$this->library = new LibraryService(
			$this->createMock(IDBConnection::class),
			$this->createMock(\OCA\AudioCheck\Service\FileAccessService::class),
			$this->createMock(ITimeFactory::class),
			$this->createMock(ITagManager::class),
			$this->createMock(ISystemTagManager::class),
			$this->createMock(ISystemTagObjectMapper::class),
			$this->createMock(\OCA\AudioCheck\Service\PlaybackStateService::class),
		);
	}

	public function testNormalizeContentKindAcceptsKnownValues(): void
	{
		$this->assertSame(LibraryService::CONTENT_KIND_AUTO, $this->library->normalizeContentKind('auto'));
		$this->assertSame(LibraryService::KIND_MUSIC, $this->library->normalizeContentKind('music'));
		$this->assertSame(LibraryService::KIND_AUDIOBOOK, $this->library->normalizeContentKind('audiobook'));
		$this->assertSame(LibraryService::KIND_AUDIOBOOK, $this->library->normalizeContentKind('audiobooks'));
	}

	public function testNormalizeContentKindRejectsUnknown(): void
	{
		$this->expectException(ValidationException::class);
		$this->library->normalizeContentKind('podcast');
	}
}
