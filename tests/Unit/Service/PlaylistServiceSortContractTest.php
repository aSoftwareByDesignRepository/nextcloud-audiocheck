<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use PHPUnit\Framework\TestCase;

/**
 * Contract test for the per-playlist order feature (ui_sort):
 * the chosen order must be remembered per playlist, manual drags must
 * reset it, and the sort write must stay atomic with the reorder.
 */
final class PlaylistServiceSortContractTest extends TestCase
{
	private static function src(string $rel): string
	{
		$path = dirname(__DIR__, 3) . '/' . $rel;
		$src = file_get_contents($path);
		self::assertIsString($src, $path . ' unreadable');
		return $src;
	}

	public function testSortModesAreWhitelisted(): void
	{
		$src = self::src('lib/Service/PlaylistService.php');
		$this->assertStringContainsString('SORT_MODES', $src);
		foreach (['manual', 'name', 'name_desc', 'track', 'track_desc'] as $mode) {
			$this->assertStringContainsString("'{$mode}'", $src, "missing mode {$mode}");
		}
		$this->assertMatchesRegularExpression(
			'/in_array\(\$mode, self::SORT_MODES, true\)/',
			$src,
			'sortItems must reject modes outside SORT_MODES',
		);
	}

	public function testManualModeDoesNotReorder(): void
	{
		$src = self::src('lib/Service/PlaylistService.php');
		$this->assertMatchesRegularExpression(
			'/if \(\$mode === \'manual\'\)\s*\{\s*\$this->setUiSort\(\$playlistId, \'manual\'\);\s*return/s',
			$src,
			"'manual' must only mark the order, never rewrite sort_order",
		);
	}

	public function testUiSortIsPersistedInsideReorderTransaction(): void
	{
		$src = self::src('lib/Service/PlaylistService.php');
		// The ui_sort write must live between beginTransaction() and commit()
		// in reorderItems so a crash cannot leave order/mode inconsistent.
		$this->assertMatchesRegularExpression(
			'/beginTransaction\(\)[\s\S]*set\(\'ui_sort\'[\s\S]*commit\(\)/',
			$src,
			'ui_sort must be written inside the reorder transaction',
		);
		$this->assertStringContainsString("array \$itemIds, string \$uiSort = 'manual'", $src);
	}

	public function testPlaylistPayloadExposesSortMode(): void
	{
		$src = self::src('lib/Service/PlaylistService.php');
		$this->assertStringContainsString("'sortMode' =>", $src);
	}

	public function testItemPayloadExposesTrackNumbers(): void
	{
		// The web client re-sorts playlist items locally for the 'track' modes;
		// without m.track_no/m.disc_no in the payload it silently title-sorts.
		$src = self::src('lib/Service/PlaylistService.php');
		$this->assertStringContainsString("'m.track_no'", $src);
		$this->assertStringContainsString("'m.disc_no'", $src);
		$this->assertStringContainsString("'trackNo' =>", $src);
		$this->assertStringContainsString("'discNo' =>", $src);
	}

	public function testMigrationAddsUiSortColumn(): void
	{
		$src = self::src('lib/Migration/Version1009Date20261031130000.php');
		$this->assertStringContainsString('ac_playlists', $src);
		$this->assertStringContainsString("'ui_sort'", $src);
		$this->assertStringContainsString("'default' => 'manual'", $src);
	}

	public function testRepairStepCoversUiSort(): void
	{
		$src = self::src('lib/Repair/EnsureAudioCheckSchema.php');
		$this->assertStringContainsString('missingUiSortColumn', $src);
		$this->assertStringContainsString("'ui_sort'", $src);
	}

	public function testRouteIsRegistered(): void
	{
		$src = self::src('appinfo/routes.php');
		$this->assertStringContainsString('sortPlaylistItems', $src);
		$this->assertStringContainsString('/api/playlists/{id}/items/sort', $src);
	}
}
