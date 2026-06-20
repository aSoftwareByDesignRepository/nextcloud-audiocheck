<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Integration;

use OCA\AudioCheck\Service\LibraryService;
use Test\TestCase;

/** getCollection must paginate tracks while preserving full-collection metadata. */
final class CollectionPaginationIntegrationTest extends TestCase
{
	protected function setUp(): void
	{
		if (!class_exists(\OC::class) || !isset(\OC::$server)) {
			$this->markTestSkipped('Nextcloud is not bootstrapped (run inside Docker with NEXTCLOUD_ROOT).');
		}
	}

	public function testGetCollectionPaginatesTracksAndPreservesTotals(): void
	{
		/** @var LibraryService $library */
		$library = \OC::$server->get(LibraryService::class);
		$collections = $library->listCollections('root', null, null, LibraryService::SORT_TITLE, 1, 5);
		if (($collections['total'] ?? 0) === 0) {
			$this->markTestSkipped('No indexed collections for root in this instance.');
		}

		$key = (string)$collections['items'][0]['key'];
		$full = $library->getCollection('root', $key, 1, 0);
		$totalTracks = (int)($full['trackCount'] ?? 0);
		if ($totalTracks < 2) {
			$this->markTestSkipped('First collection has fewer than two tracks.');
		}

		$limit = 1;
		$page = $library->getCollection('root', $key, 1, $limit);
		$this->assertSame($key, $page['key']);
		$this->assertSame($totalTracks, (int)$page['trackCount']);
		$this->assertCount($limit, $page['tracks']);
		$this->assertSame(1, (int)$page['page']);
		$this->assertSame($limit, (int)$page['limit']);
		$this->assertGreaterThanOrEqual(0, (int)$page['listenedCount']);
		$this->assertLessThanOrEqual($totalTracks, (int)$page['listenedCount']);
		$this->assertSame(
			$totalTracks > 0 && (int)$page['listenedCount'] >= $totalTracks,
			(bool)$page['fullyListened'],
		);

		if ($totalTracks > 1) {
			$page2 = $library->getCollection('root', $key, 2, $limit);
			$this->assertCount(1, $page2['tracks']);
			$this->assertNotSame(
				(int)($page['tracks'][0]['fileId'] ?? 0),
				(int)($page2['tracks'][0]['fileId'] ?? 0),
				'Second page must return a different track when total > 1',
			);
		}
	}
}
