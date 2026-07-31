<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use PHPUnit\Framework\TestCase;

/**
 * Structural + mutation-oriented coverage for scan batch pause control flow.
 *
 * Critical invariant: never persist an empty walkStack pause while still on the
 * root that just finished — that restarts the same root forever and skips prune.
 */
final class ScanServiceBatchingTest extends TestCase
{
	private string $source;

	protected function setUp(): void
	{
		parent::setUp();
		$source = file_get_contents(dirname(__DIR__, 3) . '/lib/Service/ScanService.php');
		$this->assertIsString($source);
		$this->source = $source;
	}

	public function testScanUsesBatchSizeAndCursor(): void
	{
		$this->assertStringContainsString('SCAN_BATCH_SIZE', $this->source);
		$this->assertStringContainsString('saveCursor', $this->source);
		$this->assertStringContainsString('pruneByScanGeneration', $this->source);
		$this->assertStringContainsString("'scanGen'", $this->source);
		$this->assertStringContainsString('walkStack', $this->source);
		$this->assertStringContainsString('tryClaimScan', $this->source);
		$this->assertStringContainsString('touchScanLease', $this->source);
		$this->assertStringContainsString('walkAudioFilesBatch', $this->source);
		$this->assertStringContainsString('backgroundCron', $this->source);
		$this->assertStringContainsString('usesSystemCron', $this->source);
		$this->assertStringContainsString('runAjaxCronScanBatch', $this->source);
		$this->assertStringContainsString('isStaleRunning', $this->source);
		$this->assertStringContainsString('STALE_RUNNING_SECONDS', $this->source);
		$this->assertStringContainsString('ScanCursor::encode', $this->source);
		$this->assertStringContainsString('ScanCursor::decode', $this->source);
		$this->assertStringContainsString('maxTrackLastSeen', $this->source);
		$this->assertMatchesRegularExpression(
			'/if\s*\(\s*!\$isResume\s*\)\s*\{[^}]*maxTrackLastSeen\(\$userId\)\s*\+\s*1/s',
			$this->source,
			'Fresh scans must bump scanGen above existing last_seen_at values',
		);
	}

	public function testPauseOnlyWhenRootWalkStillHasWork(): void
	{
		$this->assertStringContainsString('pauseScanBatch', $this->source);
		$this->assertMatchesRegularExpression(
			'/\$processed\s*>=\s*self::SCAN_BATCH_SIZE\s*&&\s*!\$batch\[[\'"]done[\'"]\]/',
			$this->source,
			'Must not pause after a completed root walk on the exact batch boundary',
		);
	}

	public function testPauseBetweenRootsWhenBudgetExhausted(): void
	{
		// After finishing root N at the batch boundary, the next root must
		// pause with the advanced rootIdx before walking — not re-enter root N.
		$scanUser = $this->scanUserMethodBody();
		$betweenRoots = strpos($scanUser, 'if ($ri !== $rootIdx)');
		$this->assertNotFalse($betweenRoots);
		$pauseBeforeWalk = strpos($scanUser, 'if ($processed >= self::SCAN_BATCH_SIZE)', $betweenRoots);
		$this->assertNotFalse($pauseBeforeWalk);
		$walkCall = strpos($scanUser, 'walkAudioFilesBatch', $pauseBeforeWalk);
		$this->assertNotFalse($walkCall);
		$this->assertLessThan($walkCall, $pauseBeforeWalk);
	}

	public function testResumeRequiresInProgressWalkOrAdvancedRoot(): void
	{
		$this->assertMatchesRegularExpression(
			'/\$isResume\s*=\s*\$cursor\[[\'"]scanGen[\'"]\]\s*>\s*0\s*&&\s*\(\$cursor\[[\'"]walkStack[\'"]\]\s*!==\s*\[\]\s*\|\|\s*\$cursor\[[\'"]rootIdx[\'"]\]\s*>\s*0\)/',
			$this->source,
		);
	}

	private function scanUserMethodBody(): string
	{
		$start = strpos($this->source, 'public function scanUser(string $userId): void');
		$this->assertNotFalse($start);
		$end = strpos($this->source, 'public function handleNodeEvent', $start);
		$this->assertNotFalse($end);

		return substr($this->source, $start, $end - $start);
	}
}
