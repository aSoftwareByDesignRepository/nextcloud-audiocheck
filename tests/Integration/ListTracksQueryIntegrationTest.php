<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Integration;

use OCA\AudioCheck\Service\LibraryService;
use Test\TestCase;

/**
 * listTracks must return real row data, not an empty placeholder after the count query.
 */
final class ListTracksQueryIntegrationTest extends TestCase
{
	protected function setUp(): void
	{
		if (!class_exists(\OC::class) || !isset(\OC::$server)) {
			$this->markTestSkipped('Nextcloud is not bootstrapped (run inside Docker with NEXTCLOUD_ROOT).');
		}
	}

	public function testListTracksReturnsPopulatedRowsWhenTotalPositive(): void
	{
		/** @var LibraryService $library */
		$library = \OC::$server->get(LibraryService::class);
		$limit = 8;
		$result = $library->listTracks('root', null, null, LibraryService::SORT_ADDED, 1, $limit);
		if ($result['total'] === 0) {
			$this->markTestSkipped('No indexed tracks for root in this instance.');
		}
		$this->assertNotEmpty($result['items'], 'Expected items when total > 0');
		$first = $result['items'][0];
		$this->assertGreaterThan(0, (int)($first['fileId'] ?? 0));
		$this->assertNotSame('', (string)($first['title'] ?? ''));
		// The first page is populated with real rows (not an empty placeholder
		// after the count query): it holds min(total, limit) items.
		$this->assertSame(min($result['total'], $limit), count($result['items']), 'First page must be fully populated up to the page limit');
	}
}
