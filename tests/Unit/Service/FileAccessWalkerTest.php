<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use PHPUnit\Framework\TestCase;

final class FileAccessWalkerTest extends TestCase
{
	public function testWalkAudioFilesBatchUsesDepthFirstStack(): void
	{
		$source = file_get_contents(dirname(__DIR__, 3) . '/lib/Service/FileAccessService.php');
		$this->assertIsString($source);
		$this->assertStringContainsString('function walkAudioFilesBatch', $source);
		$this->assertStringContainsString('sortedDirectoryListing', $source);
		$this->assertStringContainsString('folderAtRelativePath', $source);
		$this->assertStringContainsString("'stack'", $source);
	}
}
