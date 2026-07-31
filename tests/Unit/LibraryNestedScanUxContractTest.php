<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit;

use PHPUnit\Framework\TestCase;

/**
 * Keeps Library / Settings copy honest about multi-level audiobook layouts.
 */
final class LibraryNestedScanUxContractTest extends TestCase
{
	private string $root;

	protected function setUp(): void
	{
		$this->root = dirname(__DIR__, 2);
	}

	public function testLibraryExplainsNestedAudiobookLayouts(): void
	{
		$js = (string)file_get_contents($this->root . '/js/views/library.js');
		$this->assertStringContainsString('All nested folders', $js);
		$this->assertStringContainsString('Author / Book / files.mp3', $js);
		$this->assertStringContainsString('ac-library-layout-hint', $js);
		$this->assertStringContainsString('aria-describedby', $js);
		$this->assertStringNotContainsString("'Includes subfolders'", $js);
	}

	public function testSettingsHintNamesAuthorBookChapterPattern(): void
	{
		$js = (string)file_get_contents($this->root . '/js/views/settings.js');
		$this->assertStringContainsString('Author/Book/Chapter', $js);
	}

	public function testLocalesContainNestedScanStrings(): void
	{
		foreach (['en', 'de'] as $lang) {
			$json = json_decode((string)file_get_contents($this->root . '/l10n/' . $lang . '.json'), true);
			$this->assertIsArray($json);
			$t = $json['translations'] ?? [];
			$this->assertArrayHasKey('All nested folders', $t);
			$this->assertArrayHasKey(
				'Audiobook layout tip: Author / Book / files.mp3, or Author / Book / CD 1 / files.mp3. Keep “All nested folders” on so every level is scanned.',
				$t,
			);
			$this->assertNotSame('', trim((string)$t['All nested folders']));
		}
	}

	public function testLayoutHintHasReadableSpacing(): void
	{
		$css = (string)file_get_contents($this->root . '/css/app.css');
		$this->assertMatchesRegularExpression('/\.ac-library-layout-hint\s*\{[^}]*max-width:\s*42rem/s', $css);
	}
}
