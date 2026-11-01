<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use PHPUnit\Framework\TestCase;

/**
 * Contract test for live-queue sorting:
 * queue items are built from the shared track serializer, so trackNo/discNo
 * must be emitted by formatTrack (and redacted for unavailable items) or the
 * 'track' modes silently degrade to name order — the exact defect this
 * feature exists to prevent.
 */
final class QueueSortPayloadContractTest extends TestCase
{
	private static function src(string $rel): string
	{
		$path = dirname(__DIR__, 3) . '/' . $rel;
		$src = file_get_contents($path);
		self::assertIsString($src, $path . ' unreadable');
		return $src;
	}

	public function testFormatTrackSerializesTrackNumbers(): void
	{
		$src = self::src('lib/Service/LibraryService.php');
		$this->assertMatchesRegularExpression(
			'/\'trackNo\'\s*=>\s*isset\(\$row\[\'track_no\'\]\)\s*\?\s*\(int\)\$row\[\'track_no\'\]\s*:\s*null/',
			$src,
			'formatTrack must emit trackNo (nullable int) from m.track_no',
		);
		$this->assertMatchesRegularExpression(
			'/\'discNo\'\s*=>\s*isset\(\$row\[\'disc_no\'\]\)\s*\?\s*\(int\)\$row\[\'disc_no\'\]\s*:\s*null/',
			$src,
			'formatTrack must emit discNo (nullable int) from m.disc_no',
		);
	}

	public function testTrackListQuerySelectsSortColumns(): void
	{
		// listTracks feeds formatTrack; without the columns in the SELECT the
		// keys serialize as null and 'track' sort becomes a hidden name sort.
		$src = self::src('lib/Service/LibraryService.php');
		$this->assertMatchesRegularExpression(
			'/select\([^\)]*\'m\.track_no\'[^\)]*\'m\.disc_no\'[^\)]*\)/',
			$src,
			'the formatTrack list query must select m.track_no and m.disc_no',
		);
	}

	public function testUnavailableTracksRedactSortMetadata(): void
	{
		$src = self::src('lib/Service/LibraryService.php');
		$this->assertMatchesRegularExpression(
			'/redactUnavailableMetadata[\s\S]*\$track\[\'trackNo\'\]\s*=\s*null;\s*\$track\[\'discNo\'\]\s*=\s*null;/',
			$src,
			'unavailable items must not leak sort metadata either',
		);
	}

	public function testQueueUnavailableStubKeepsShape(): void
	{
		$src = self::src('lib/Service/PlayQueueService.php');
		$this->assertMatchesRegularExpression(
			'/unavailable\'\s*=>\s*true[\s\S]{0,200}\'trackNo\'\s*=>\s*null|\'trackNo\'\s*=>\s*null[\s\S]{0,200}unavailable\'\s*=>\s*true/',
			$src,
			'the unavailable queue stub must keep the same field shape',
		);
	}

	public function testPlayerExposesSortQueue(): void
	{
		$src = self::src('js/common/player.js');
		$this->assertStringContainsString('sortQueue(mode)', $src);
		$this->assertStringContainsString('sorted.indexOf(curTrack)', $src);
		$this->assertStringContainsString('policyAfterQueueEdit', $src);
	}

	public function testNaturalSortExportsQueueHelpers(): void
	{
		$src = self::src('js/common/natural-sort.js');
		foreach (['sortQueueTracks', 'queueSortModeFor', 'QUEUE_SORT_MODES'] as $name) {
			$this->assertStringContainsString($name, $src, "missing export {$name}");
		}
	}

	public function testQueuePayloadSendsClientTimestamp(): void
	{
		// Without clientUpdatedAt the server's stale-write guard (PlayQueueService
		// stale rejection) is silently disabled for the web path — an older
		// fetch landing after a newer beacon/mobile write would win.
		$src = self::src('js/common/player.js');
		$this->assertStringContainsString('clientUpdatedAt', $src);
		$this->assertMatchesRegularExpression(
			'/clientUpdatedAt:\s*Math\.floor\(Date\.now\(\)\s*\/\s*1000\)/',
			$src,
			'clientUpdatedAt must be unix seconds (mobile contract)',
		);
	}
}
