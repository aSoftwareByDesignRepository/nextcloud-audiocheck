<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Integration;

use OCA\AudioCheck\Service\LibraryService;
use Test\TestCase;

/** listFacets must slice facet items server-side when limit > 0. */
final class FacetPaginationIntegrationTest extends TestCase
{
	protected function setUp(): void
	{
		if (!class_exists(\OC::class) || !isset(\OC::$server)) {
			$this->markTestSkipped('Nextcloud is not bootstrapped (run inside Docker with NEXTCLOUD_ROOT).');
		}
	}

	public function testListFacetsPaginatesItems(): void
	{
		/** @var LibraryService $library */
		$library = \OC::$server->get(LibraryService::class);
		$all = $library->listFacets('root', 'artists', null, null, 1, 0);
		$total = (int)($all['total'] ?? 0);
		if ($total < 2) {
			$this->markTestSkipped('Fewer than two artist facets for root in this instance.');
		}

		$limit = 1;
		$page1 = $library->listFacets('root', 'artists', null, null, 1, $limit);
		$this->assertSame($total, (int)$page1['total']);
		$this->assertCount($limit, $page1['items']);
		$this->assertSame(1, (int)$page1['page']);
		$this->assertSame($limit, (int)$page1['limit']);

		$page2 = $library->listFacets('root', 'artists', null, null, 2, $limit);
		$this->assertCount(1, $page2['items']);
		$this->assertNotSame(
			(string)($page1['items'][0]['name'] ?? ''),
			(string)($page2['items'][0]['name'] ?? ''),
			'Second facet page must differ when total >= 2',
		);
	}
}
