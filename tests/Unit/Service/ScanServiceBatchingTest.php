<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use PHPUnit\Framework\TestCase;

final class ScanServiceBatchingTest extends TestCase
{
	public function testScanUsesBatchSizeAndCursor(): void
	{
		$source = file_get_contents(dirname(__DIR__, 3) . '/lib/Service/ScanService.php');
		$this->assertIsString($source);
		$this->assertStringContainsString('SCAN_BATCH_SIZE', $source);
		$this->assertStringContainsString('saveCursor', $source);
		$this->assertStringContainsString('pruneByScanGeneration', $source);
		$this->assertStringContainsString("'scanGen'", $source);
		$this->assertStringContainsString('backgroundCron', $source);
		$this->assertStringContainsString('usesSystemCron', $source);
	}
}
