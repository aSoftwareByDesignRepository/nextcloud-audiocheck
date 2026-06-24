<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Integration;

use OCA\AudioCheck\Service\LibraryService;
use OCA\AudioCheck\Util\SearchTextNormalizer;
use Test\TestCase;

/**
 * Library search must be case-insensitive and multi-token (AND across fields),
 * regardless of the database column collation. AudioCheck's text columns use
 * utf8mb4_bin on MySQL/MariaDB, which makes a plain LIKE case-sensitive; the
 * service must compensate with iLike so "hamish" finds "Hamish".
 */
final class CaseInsensitiveSearchIntegrationTest extends TestCase
{
	private const USER = 'root';

	protected function setUp(): void
	{
		if (!class_exists(\OC::class) || !isset(\OC::$server)) {
			$this->markTestSkipped('Nextcloud is not bootstrapped (run inside Docker with NEXTCLOUD_ROOT).');
		}
	}

	private function library(): LibraryService
	{
		/** @var LibraryService $library */
		$library = \OC::$server->get(LibraryService::class);
		return $library;
	}

	/**
	 * Find a searchable word (>= 3 chars, mixed alphabetic) from any indexed
	 * title so the test is meaningful regardless of the instance's content.
	 *
	 * @return array{0:string,1:array<int>} the token and the file ids that contain it
	 */
	private function findSearchableTokenWithCase(LibraryService $library): array
	{
		$page = $library->listTracks(self::USER, null, null, LibraryService::SORT_TITLE, 1, 100);
		if (($page['total'] ?? 0) === 0) {
			$this->markTestSkipped('No indexed tracks for ' . self::USER . ' in this instance.');
		}
		foreach ($page['items'] as $item) {
			$title = (string)($item['title'] ?? '');
			if (preg_match_all('/[A-Za-z]{3,}/u', $title, $matches) === false) {
				continue;
			}
			foreach ($matches[0] as $word) {
				// Needs at least one cased letter to make the assertion meaningful.
				if ($word !== mb_strtolower($word) || $word !== mb_strtoupper($word)) {
					return [$word, []];
				}
			}
		}
		$this->markTestSkipped('No cased alphabetic title token available to assert case-insensitivity.');
	}

	public function testLowerUpperAndMixedCaseReturnSameResults(): void
	{
		$library = $this->library();
		[$word] = $this->findSearchableTokenWithCase($library);

		$lower = $library->listTracks(self::USER, null, mb_strtolower($word), LibraryService::SORT_TITLE, 1, 100);
		$upper = $library->listTracks(self::USER, null, mb_strtoupper($word), LibraryService::SORT_TITLE, 1, 100);
		$mixed = $library->listTracks(self::USER, null, $word, LibraryService::SORT_TITLE, 1, 100);

		$this->assertGreaterThan(0, (int)$lower['total'], 'Lowercase query must match the cased title');
		$this->assertSame((int)$mixed['total'], (int)$lower['total'], 'Lowercase and mixed-case totals must match');
		$this->assertSame((int)$mixed['total'], (int)$upper['total'], 'Uppercase and mixed-case totals must match');

		$lowerIds = array_map(static fn ($i): int => (int)$i['fileId'], $lower['items']);
		$upperIds = array_map(static fn ($i): int => (int)$i['fileId'], $upper['items']);
		sort($lowerIds);
		sort($upperIds);
		$this->assertSame($lowerIds, $upperIds, 'Case variants must return the identical result set');
	}

	public function testMultiTokenSearchIsOrderIndependentAnd(): void
	{
		$library = $this->library();
		$page = $library->listTracks(self::USER, null, null, LibraryService::SORT_TITLE, 1, 100);
		if (($page['total'] ?? 0) === 0) {
			$this->markTestSkipped('No indexed tracks for ' . self::USER . ' in this instance.');
		}

		$twoWordTitle = null;
		foreach ($page['items'] as $item) {
			$title = (string)($item['title'] ?? '');
			if (preg_match_all('/[A-Za-z]{3,}/u', $title, $m) && count(array_unique($m[0])) >= 2) {
				$twoWordTitle = array_values(array_unique($m[0]));
				break;
			}
		}
		if ($twoWordTitle === null) {
			$this->markTestSkipped('No title with two distinct words to assert multi-token search.');
		}

		[$a, $b] = [mb_strtolower($twoWordTitle[0]), mb_strtolower($twoWordTitle[1])];

		$forward = $library->listTracks(self::USER, null, "$a $b", LibraryService::SORT_TITLE, 1, 100);
		$reverse = $library->listTracks(self::USER, null, "$b $a", LibraryService::SORT_TITLE, 1, 100);
		$this->assertGreaterThan(0, (int)$forward['total'], 'Multi-token query must match a title containing both words');
		$this->assertSame((int)$forward['total'], (int)$reverse['total'], 'Token order must not change results');

		$miss = $library->listTracks(self::USER, null, "$a zzqxznomatchzz", LibraryService::SORT_TITLE, 1, 100);
		$this->assertSame(0, (int)$miss['total'], 'AND semantics: an impossible token must yield no results');
	}

	public function testBlankQueryIsANoOp(): void
	{
		$library = $this->library();
		$baseline = $library->listTracks(self::USER, null, null, LibraryService::SORT_TITLE, 1, 5);
		$blank = $library->listTracks(self::USER, null, '   ', LibraryService::SORT_TITLE, 1, 5);
		$this->assertSame((int)$baseline['total'], (int)$blank['total'], 'Whitespace-only query must not filter results');
	}

	public function testAccentInsensitiveSearchMatchesNormalizedColumns(): void
	{
		$library = $this->library();
		$page = $library->listTracks(self::USER, null, null, LibraryService::SORT_TITLE, 1, 200);
		if (($page['total'] ?? 0) === 0) {
			$this->markTestSkipped('No indexed tracks for ' . self::USER . ' in this instance.');
		}

		$accentTitle = null;
		foreach ($page['items'] as $item) {
			$title = (string)($item['title'] ?? '');
			if (preg_match('/[^\x00-\x7F]/u', $title) === 1) {
				$accentTitle = $title;
				break;
			}
		}
		if ($accentTitle === null) {
			$this->markTestSkipped('No accent-bearing title available to assert accent-insensitive search.');
		}

		$tokens = SearchTextNormalizer::tokenize($accentTitle);
		if ($tokens === []) {
			$this->markTestSkipped('Accent title did not produce searchable tokens.');
		}

		$exact = $library->listTracks(self::USER, null, $tokens[0], LibraryService::SORT_TITLE, 1, 200);
		$this->assertGreaterThan(0, (int)$exact['total'], 'Normalized token from accent title must match via shadow columns');

		$asciiOnly = preg_replace('/[^a-z0-9 ]+/u', '', $tokens[0]) ?? '';
		if ($asciiOnly !== '' && $asciiOnly !== $tokens[0]) {
			$ascii = $library->listTracks(self::USER, null, $asciiOnly, LibraryService::SORT_TITLE, 1, 200);
			$this->assertGreaterThan(0, (int)$ascii['total'], 'ASCII-only query must match accent title via normalized columns');
		}
	}
}
