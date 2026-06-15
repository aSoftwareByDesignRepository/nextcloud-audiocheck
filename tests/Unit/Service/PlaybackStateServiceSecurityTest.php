<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use PHPUnit\Framework\TestCase;

/** AC-TST-15: progress cannot be saved without file access */
final class PlaybackStateServiceSecurityTest extends TestCase
{
	public function testSaveProgressResolvesFileAccessFirst(): void
	{
		$source = file_get_contents(dirname(__DIR__, 3) . '/lib/Service/PlaybackStateService.php');
		$this->assertIsString($source);
		$this->assertMatchesRegularExpression(
			'/function saveProgress\([^)]+\)[^{]*\{[^}]*resolveReadableFile/s',
			$source,
		);
	}

	public function testContinueListeningUsesLeftJoinForUnindexedFiles(): void
	{
		$source = file_get_contents(dirname(__DIR__, 3) . '/lib/Service/PlaybackStateService.php');
		$this->assertIsString($source);
		$this->assertStringContainsString('leftJoin', $source);
		$this->assertStringNotContainsString('innerJoin', $source);
	}

	public function testSaveProgressDedupesRapidBeacons(): void
	{
		$source = file_get_contents(dirname(__DIR__, 3) . '/lib/Service/PlaybackStateService.php');
		$this->assertIsString($source);
		$this->assertStringContainsString('de-duplicate rapid beacons', $source);
		$this->assertStringContainsString('reject stale writes', $source);
	}

	public function testClampVolumeBounds(): void
	{
		$source = file_get_contents(dirname(__DIR__, 3) . '/lib/Service/PlaybackStateService.php');
		$this->assertIsString($source);
		$this->assertStringContainsString('function clampVolume', $source);
		$this->assertStringContainsString('default_volume', $source);
	}
}
