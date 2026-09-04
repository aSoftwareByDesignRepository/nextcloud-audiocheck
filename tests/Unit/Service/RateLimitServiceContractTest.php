<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use PHPUnit\Framework\TestCase;

/**
 * Source contracts for multi-node-safe cover rate limiting.
 */
class RateLimitServiceContractTest extends TestCase
{
	private string $root;

	protected function setUp(): void
	{
		$this->root = dirname(__DIR__, 3);
	}

	public function testUsesSharedDbTableAndExclusiveLock(): void
	{
		$src = (string)file_get_contents($this->root . '/lib/Service/RateLimitService.php');
		self::assertStringContainsString('ac_rate_limits', $src);
		self::assertStringContainsString('ILockingProvider', $src);
		self::assertStringContainsString('LOCK_EXCLUSIVE', $src);
		self::assertStringContainsString('LockedException', $src);
		self::assertStringContainsString('fail-closed', $src);
		// Count before insert — under lock — so burst concurrency cannot overshoot.
		self::assertMatchesRegularExpression(
			'/count\s*\(\s*[\'\*"][\s\S]*?>=\s*\$max[\s\S]*?insert\s*\(\s*[\'"]ac_rate_limits/i',
			$src,
		);
		// Must not use preference / temp-file TOCTOU again.
		self::assertStringNotContainsString('getUserValue', $src);
		self::assertStringNotContainsString('sys_get_temp_dir', $src);
		self::assertStringNotContainsString('flock', $src);
	}

	public function testMigrationAndCatalogRegisterTable(): void
	{
		$mig = (string)file_get_contents($this->root . '/lib/Migration/Version1007Date20260904190000.php');
		self::assertStringContainsString('ac_rate_limits', $mig);
		self::assertStringContainsString('ac_rl_buc_usr_at_idx', $mig);
		$cat = (string)file_get_contents($this->root . '/lib/Migration/AudioCheckTableCatalog.php');
		self::assertStringContainsString("'ac_rate_limits'", $cat);
	}

	public function testApplicationWiresLockingProvider(): void
	{
		$src = (string)file_get_contents($this->root . '/lib/AppInfo/Application.php');
		self::assertStringContainsString('ILockingProvider::class', $src);
		self::assertStringContainsString('RateLimitService::class', $src);
	}
}
