<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use OCA\AudioCheck\Service\FileAccessService;
use OCA\AudioCheck\Service\LibraryService;
use OCA\AudioCheck\Service\PlaybackStateService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IDBConnection;
use OCP\ITagManager;
use OCP\ITags;
use OCP\SystemTag\ISystemTagManager;
use OCP\SystemTag\ISystemTagObjectMapper;
use PHPUnit\Framework\TestCase;
use ReflectionClass;

/**
 * Regression guard for issue #3: ITags::getFavorites() may return false;
 * passing that to array_map() caused a TypeError and 500 on /api/tracks?favorite=1.
 */
final class LibraryServiceFavoritesTest extends TestCase
{
	private string $source;

	protected function setUp(): void
	{
		$path = dirname(__DIR__, 3) . '/lib/Service/LibraryService.php';
		$this->source = is_readable($path) ? (string)file_get_contents($path) : '';
	}

	public function testListTracksUsesHardenedFavoriteLoader(): void
	{
		$this->assertStringContainsString('$favoriteIds = $this->loadFavoriteFileIds();', $this->source);
		$this->assertStringNotContainsString("array_map('intval', \$tagger->getFavorites())", $this->source);
		$this->assertStringContainsString('IQueryBuilder::PARAM_INT_ARRAY', $this->source);
	}

	public function testLoadFavoriteFileIdsReturnsEmptyWhenGetFavoritesReturnsFalse(): void
	{
		$tagger = $this->createMock(ITags::class);
		$tagger->method('getFavorites')->willReturn(false);

		$tagManager = $this->createMock(ITagManager::class);
		$tagManager->method('load')->with('files')->willReturn($tagger);

		$this->assertSame([], $this->invokeLoadFavoriteFileIds($this->makeService($tagManager)));
	}

	public function testLoadFavoriteFileIdsReturnsEmptyWhenTagManagerLoadFails(): void
	{
		$tagManager = $this->createMock(ITagManager::class);
		$tagManager->method('load')->willThrowException(new \RuntimeException('db unavailable'));

		$this->assertSame([], $this->invokeLoadFavoriteFileIds($this->makeService($tagManager)));
	}

	public function testLoadFavoriteFileIdsNormalizesPositiveIntegers(): void
	{
		$tagger = $this->createMock(ITags::class);
		$tagger->method('getFavorites')->willReturn(['42', 7, 0, -1, '7']);

		$tagManager = $this->createMock(ITagManager::class);
		$tagManager->method('load')->with('files')->willReturn($tagger);

		$this->assertSame([42, 7], $this->invokeLoadFavoriteFileIds($this->makeService($tagManager)));
	}

	private function makeService(ITagManager $tagManager): LibraryService
	{
		return new LibraryService(
			$this->createMock(IDBConnection::class),
			$this->createMock(FileAccessService::class),
			$this->createMock(ITimeFactory::class),
			$tagManager,
			$this->createMock(ISystemTagManager::class),
			$this->createMock(ISystemTagObjectMapper::class),
			$this->createMock(PlaybackStateService::class),
		);
	}

	/** @return list<int> */
	private function invokeLoadFavoriteFileIds(LibraryService $service): array
	{
		$method = (new ReflectionClass($service))->getMethod('loadFavoriteFileIds');
		$method->setAccessible(true);
		/** @var list<int> $ids */
		$ids = $method->invoke($service);
		return $ids;
	}
}
