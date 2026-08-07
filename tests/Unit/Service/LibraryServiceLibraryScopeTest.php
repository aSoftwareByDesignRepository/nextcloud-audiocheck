<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use PHPUnit\Framework\TestCase;

/**
 * Browse/list queries must require an enabled library membership.
 */
final class LibraryServiceLibraryScopeTest extends TestCase
{
	private string $source;

	protected function setUp(): void
	{
		$raw = file_get_contents(dirname(__DIR__, 3) . '/lib/Service/LibraryService.php');
		$this->assertIsString($raw);
		$this->source = $raw;
	}

	public function testJoinRequiresEnabledLibraryInnerJoin(): void
	{
		$this->assertStringContainsString("innerJoin(\$trackAlias, 'ac_libraries'", $this->source);
		$this->assertStringContainsString("eq('lib.enabled'", $this->source);
		$pos = strpos($this->source, 'function joinLibraryForEffectiveKind');
		$this->assertNotFalse($pos);
		$window = substr($this->source, $pos, 520);
		$this->assertStringContainsString('innerJoin', $window);
		$this->assertStringNotContainsString('leftJoin', $window);
		$this->assertStringContainsString("lib.enabled", $window);
	}

	public function testFolderFacetsCapAncestorsAtLibraryRoots(): void
	{
		$this->assertStringContainsString('isFolderFacetPathInScope', $this->source);
		$this->assertStringContainsString('enabledLibraryFolderPaths', $this->source);
		$this->assertStringContainsString(
			'Stop at enabled library roots — do not surface / or parent folders outside scope.',
			$this->source,
		);
		$this->assertStringContainsString(
			'if ($this->isFolderFacetPathInScope($current, $libraryRoots))',
			$this->source,
		);
	}

	public function testFavoriteAndTagFacetsUseLibraryScope(): void
	{
		$this->assertMatchesRegularExpression(
			'/function\s+listFavoriteFacet.*?joinLibraryForEffectiveKind/s',
			$this->source,
		);
		$this->assertMatchesRegularExpression(
			'/function\s+listUserTrackFileIds.*?joinLibraryForEffectiveKind/s',
			$this->source,
		);
	}

	public function testNewLibraryRecommendsRescan(): void
	{
		$this->assertStringContainsString("'rescanRecommended' => true", $this->source);
	}
}
