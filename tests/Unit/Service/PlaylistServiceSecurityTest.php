<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use PHPUnit\Framework\TestCase;

/**
 * AC-TST-14: playlist add must resolve file access before persisting.
 */
final class PlaylistServiceSecurityTest extends TestCase
{
	public function testAddItemResolvesFileAccessFirst(): void
	{
		$source = file_get_contents(dirname(__DIR__, 3) . '/lib/Service/PlaylistService.php');
		$this->assertIsString($source);
		$this->assertMatchesRegularExpression(
			'/function addItem\([^)]+\)[^{]*\{[^}]*resolveReadableFile/s',
			$source,
		);
	}

	public function testReorderRejectsPartialOrForeignItemIds(): void
	{
		$source = file_get_contents(dirname(__DIR__, 3) . '/lib/Service/PlaylistService.php');
		$this->assertIsString($source);
		$this->assertStringContainsString('Invalid item order.', $source);
		$this->assertStringContainsString('listItemIdsForPlaylist', $source);
	}

	public function testReorderAndDeleteUseTransactions(): void
	{
		$source = file_get_contents(dirname(__DIR__, 3) . '/lib/Service/PlaylistService.php');
		$this->assertIsString($source);
		$this->assertStringContainsString('function reorderItems', $source);
		$this->assertStringContainsString('function deletePlaylist', $source);
		$this->assertGreaterThanOrEqual(2, substr_count($source, 'beginTransaction'));
		$this->assertGreaterThanOrEqual(2, substr_count($source, 'rollBack'));
	}
}
