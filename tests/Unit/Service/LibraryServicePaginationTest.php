<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use Test\TestCase;

/** Regression guard: collection/facet pagination helpers stay in LibraryService. */
final class LibraryServicePaginationTest extends TestCase
{
	private string $source;

	protected function setUp(): void
	{
		$path = dirname(__DIR__, 3) . '/lib/Service/LibraryService.php';
		$this->source = is_readable($path) ? (string)file_get_contents($path) : '';
	}

	public function testGetCollectionAcceptsPageAndLimit(): void
	{
		$this->assertStringContainsString('public function getCollection(string $userId, string $key, int $page = 1, int $limit = 0)', $this->source);
		$this->assertStringContainsString('countCollectionTracks', $this->source);
		$this->assertStringContainsString('queryCollectionTracks', $this->source);
	}

	public function testListFacetsPaginatesViaHelper(): void
	{
		$this->assertStringContainsString('public function listFacets(string $userId, string $type, ?string $q, ?string $kind = null, int $page = 1, int $limit = 0)', $this->source);
		$this->assertStringContainsString('private function paginateFacetItems', $this->source);
	}
}
