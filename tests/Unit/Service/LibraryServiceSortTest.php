<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use OCA\AudioCheck\Service\LibraryService;
use PHPUnit\Framework\TestCase;

final class LibraryServiceSortTest extends TestCase
{
	public function testListCollectionsSupportsRecentlyPlayedSort(): void
	{
		$source = file_get_contents(dirname(__DIR__, 3) . '/lib/Service/LibraryService.php');
		$this->assertIsString($source);
		$this->assertStringContainsString('SORT_PLAYED', $source);
		$this->assertStringContainsString('last_played_at', $source);
		$this->assertStringContainsString("self::SORT_PLAYED => 'last_played_at'", $source);
	}

	public function testListCollectionsUsesSqlPagination(): void
	{
		$source = file_get_contents(dirname(__DIR__, 3) . '/lib/Service/LibraryService.php');
		$this->assertIsString($source);
		$this->assertStringContainsString('function countCollectionGroups', $source);
		$this->assertStringContainsString('setMaxResults($limit)->setFirstResult($offset)', $source);
		$this->assertStringContainsString('function formatTrackForUser', $source);
	}

	public function testListTracksJoinsPlayStateForPlayedSort(): void
	{
		$source = file_get_contents(dirname(__DIR__, 3) . '/lib/Service/LibraryService.php');
		$this->assertIsString($source);
		$this->assertStringContainsString("if (\$sort === self::SORT_PLAYED)", $source);
		$this->assertStringContainsString("leftJoin('t', 'ac_play_state', 'ps'", $source);
	}

	public function testListTracksCountsBeforeSelectingColumns(): void
	{
		$source = file_get_contents(dirname(__DIR__, 3) . '/lib/Service/LibraryService.php');
		$this->assertIsString($source);
		$this->assertStringContainsString('$countQb = clone $qb;', $source);
		$this->assertMatchesRegularExpression(
			'/\$countQb = clone \$qb;\s+\$countQb->select\(\$countQb->func\(\)->count\(\'t\.id\', \'c\'\)\);.*\$qb->select\(\'t\.file_id\'/s',
			$source,
		);
	}
}
