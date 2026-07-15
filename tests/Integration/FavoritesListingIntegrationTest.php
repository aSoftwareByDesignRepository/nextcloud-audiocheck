<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Integration;

use OCA\AudioCheck\Service\LibraryService;
use Test\TestCase;

/** Issue #3: favorites listing must never 500 when core tag lookup fails. */
final class FavoritesListingIntegrationTest extends TestCase
{
	protected function setUp(): void
	{
		if (!class_exists(\OC::class) || !isset(\OC::$server)) {
			$this->markTestSkipped('Nextcloud is not bootstrapped (run inside Docker with NEXTCLOUD_ROOT).');
		}
	}

	public function testListTracksFavoriteFilterReturnsPaginatedShape(): void
	{
		/** @var LibraryService $library */
		$library = \OC::$server->get(LibraryService::class);
		$result = $library->listTracks('root', null, null, LibraryService::SORT_TITLE, 1, 500, true);

		$this->assertSame(100, $result['limit'], 'Server clamps limit to 100 per page');
		$this->assertSame(1, $result['page']);
		$this->assertIsInt($result['total']);
		$this->assertIsArray($result['items']);
		$this->assertLessThanOrEqual(100, count($result['items']));
	}
}
