<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Integration;

use OCA\AudioCheck\Service\LibraryService;
use Test\TestCase;

/**
 * listTrackFileIds must return the FULL member set under the /api/tracks
 * filters — the mobile "X of Y saved" counter was capped at one page.
 */
final class TrackFileIdsIntegrationTest extends TestCase
{
	protected function setUp(): void
	{
		if (!class_exists(\OC::class) || !isset(\OC::$server)) {
			$this->markTestSkipped('Nextcloud is not bootstrapped (run inside Docker with NEXTCLOUD_ROOT).');
		}
	}

	/**
	 * Collect every fileId listTracks would return for the same filters by
	 * paging through it — the reference set listTrackFileIds must reproduce.
	 *
	 * @return list<int>
	 */
	private function listAllFileIdsViaPages(LibraryService $library, ?string $kind): array
	{
		$fileIds = [];
		$page = 1;
		do {
			$result = $library->listTracks('root', $kind, null, LibraryService::SORT_TITLE, $page, 50);
			foreach ($result['items'] as $item) {
				$fileIds[] = (int)$item['fileId'];
			}
			$page += 1;
		} while (count($fileIds) < (int)$result['total'] && $result['items'] !== []);
		return $fileIds;
	}

	public function testFileIdsMatchListTracksTotalWithoutPaginationCap(): void
	{
		/** @var LibraryService $library */
		$library = \OC::$server->get(LibraryService::class);
		$expected = $this->listAllFileIdsViaPages($library, null);
		if ($expected === []) {
			$this->markTestSkipped('No indexed tracks for root in this instance.');
		}

		$result = $library->listTrackFileIds('root', null, null);
		$this->assertSame(count($expected), $result['total'], 'fileIds total must equal the unpaginated listTracks total');
		$this->assertSame(
			count($result['fileIds']),
			count(array_unique($result['fileIds'])),
			'fileIds must be distinct',
		);

		$actual = array_map('intval', $result['fileIds']);
		sort($expected);
		sort($actual);
		$this->assertSame($expected, $actual, 'fileIds must be exactly the set listTracks returns across all pages');
		foreach ($result['fileIds'] as $fileId) {
			$this->assertGreaterThan(0, $fileId);
		}
	}

	public function testFileIdsRespectKindFilterParity(): void
	{
		/** @var LibraryService $library */
		$library = \OC::$server->get(LibraryService::class);
		foreach (['music', 'audiobook'] as $kind) {
			$expected = $this->listAllFileIdsViaPages($library, $kind);
			$ids = $library->listTrackFileIds('root', $kind, null);
			$this->assertSame(
				count($expected),
				$ids['total'],
				"kind=$kind fileIds total must match listTracks total",
			);
			$actual = array_map('intval', $ids['fileIds']);
			sort($expected);
			sort($actual);
			$this->assertSame($expected, $actual, "kind=$kind fileIds must equal the paged listTracks set");
		}
	}
}
