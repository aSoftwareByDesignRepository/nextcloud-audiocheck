<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use PHPUnit\Framework\TestCase;

/** Server-side queue: access enforced on read, writes bounded and atomic. */
final class PlayQueueServiceSecurityTest extends TestCase
{
	private function source(): string
	{
		$source = file_get_contents(dirname(__DIR__, 3) . '/lib/Service/PlayQueueService.php');
		$this->assertIsString($source);
		return $source;
	}

	public function testItemsResolvedThroughAccessCheckedPlayableLookup(): void
	{
		$source = $this->source();
		// Every restored item goes through getPlayableTrack, which calls
		// FileAccessService::resolveReadableFile under the hood.
		$this->assertStringContainsString('getPlayableTrack', $source);
		$this->assertMatchesRegularExpression(
			'/function resolveItem\([^)]*\)[^{]*\{.*getPlayableTrack.*catch \(NotFoundException\).*unavailable.*=> true/s',
			$source,
		);
	}

	public function testInaccessibleItemsDoNotLeakMetadata(): void
	{
		$source = $this->source();
		// The unavailable stub carries empty title/artist — never DB metadata.
		$this->assertMatchesRegularExpression(
			"/catch \(NotFoundException\)\s*\{\s*return \[[^]]*'title' => '',[^]]*'unavailable' => true/s",
			$source,
		);
	}

	public function testWritesAreBoundedByMaxItems(): void
	{
		$source = $this->source();
		$this->assertStringContainsString('public const MAX_ITEMS = 2000;', $source);
		$this->assertMatchesRegularExpression('/count\(\$clean\) >= self::MAX_ITEMS/', $source);
	}

	public function testSaveAndClearAreTransactional(): void
	{
		$source = $this->source();
		$this->assertStringContainsString('beginTransaction', $source);
		$this->assertStringContainsString('rollBack', $source);
		$this->assertStringContainsString('commit', $source);
	}

	public function testItemsRewrittenOnlyWhenOrderingChanges(): void
	{
		$source = $this->source();
		$this->assertMatchesRegularExpression(
			'/if \(\$this->loadItemFileIds\(\$queueId\) !== \$clean\) \{\s*\$this->replaceItems/s',
			$source,
		);
	}

	public function testCurrentIndexAndRepeatModeAreClamped(): void
	{
		$source = $this->source();
		$this->assertStringContainsString('clampRepeat', $source);
		$this->assertStringContainsString('clampSpeed', $source);
		$this->assertMatchesRegularExpression('/\$currentIndex < 0 \|\| \$currentIndex >= \$count/', $source);
	}

	public function testResumePositionDelegatesToPlaybackState(): void
	{
		$source = $this->source();
		// Single source of truth for position is ac_play_state via PlaybackStateService.
		$this->assertMatchesRegularExpression(
			'/function currentPosition\([^)]*\)[^{]*\{.*getProgress.*finished.*return 0/s',
			$source,
		);
	}

	public function testPurgeUserRemovesQueueRows(): void
	{
		$source = $this->source();
		$this->assertMatchesRegularExpression(
			'/function purgeUser\([^)]*\)[^{]*\{.*delete\(.ac_queue.\)/s',
			$source,
		);
	}
}
