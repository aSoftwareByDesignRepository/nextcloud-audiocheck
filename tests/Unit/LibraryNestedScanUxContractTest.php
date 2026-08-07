<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit;

use PHPUnit\Framework\TestCase;

/**
 * Keeps Library UX radical-simplicity contracts honest:
 * one-row folders, progressive options, auto-scan add, nested-layout tip.
 */
final class LibraryNestedScanUxContractTest extends TestCase
{
	private string $root;

	protected function setUp(): void
	{
		$this->root = dirname(__DIR__, 2);
	}

	public function testLibraryUsesProgressiveFolderOptions(): void
	{
		$js = (string)file_get_contents($this->root . '/js/views/library.js');
		$this->assertStringContainsString('Folder options', $js);
		$this->assertStringContainsString('Include nested folders', $js);
		$this->assertStringContainsString('ac-library-card__options', $js);
		$this->assertStringContainsString('ac-seg', $js);
		$this->assertStringContainsString('guessContentKindFromPath', $js);
		$this->assertStringContainsString('aria-describedby', $js);
		// Always-on clutter removed from the default surface
		$this->assertStringNotContainsString('ac-library-card__select', $js);
		$this->assertStringNotContainsString('pickContentKindModal', $js);
		$this->assertStringNotContainsString('ac-library-overlap-hint', $js);
		$this->assertStringNotContainsString("'Includes subfolders'", $js);
	}

	public function testLibraryExplainsNestedAudiobookLayoutsInHowItWorks(): void
	{
		$js = (string)file_get_contents($this->root . '/js/views/library.js');
		$this->assertStringContainsString('ac-library-layout-hint', $js);
		$this->assertStringContainsString('Author / Book / chapter', $js);
		$this->assertStringContainsString('Scanning starts automatically', $js);
		$this->assertStringContainsString('Add music folder', $js);
		$this->assertStringContainsString('Add audiobook folder', $js);
		$this->assertStringContainsString('only show audio inside these folders', $js);
		$this->assertStringContainsString('Only folders you add appear in your library.', $js);
		$this->assertStringContainsString('they are only removed from AudioCheck', $js);
	}

	public function testSettingsHintNamesAuthorBookChapterPattern(): void
	{
		$js = (string)file_get_contents($this->root . '/js/views/settings.js');
		$this->assertStringContainsString('Author/Book/Chapter', $js);
	}

	public function testLocalesContainSimplifiedLibraryStrings(): void
	{
		foreach (['en', 'de'] as $lang) {
			$json = json_decode((string)file_get_contents($this->root . '/l10n/' . $lang . '.json'), true);
			$this->assertIsArray($json);
			$t = $json['translations'] ?? [];
			$this->assertArrayHasKey('Folder options', $t);
			$this->assertArrayHasKey('Include nested folders', $t);
			$this->assertArrayHasKey(
				'Tip: Author / Book / chapter folders work best. Nested scanning stays on by default.',
				$t,
			);
			$this->assertArrayHasKey('Pick a folder from Files — scanning starts automatically.', $t);
			$this->assertArrayHasKey(
				'Browse, Music, and Audiobooks only show audio inside these folders.',
				$t,
			);
			$this->assertArrayHasKey(
				'AudioCheck will stop using this folder in your library. Files stay in Nextcloud Files — they are only removed from AudioCheck.',
				$t,
			);
			$this->assertNotSame('', trim((string)$t['Folder options']));
			$this->assertNotSame('', trim((string)$t['Include nested folders']));
		}
	}

	public function testLayoutHintHasReadableSpacing(): void
	{
		$css = (string)file_get_contents($this->root . '/css/app.css');
		$this->assertMatchesRegularExpression('/\.ac-library-layout-hint\s*\{[^}]*max-width:\s*42rem/s', $css);
		$this->assertMatchesRegularExpression('/\.ac-library-card__main\s*\{/s', $css);
		$this->assertMatchesRegularExpression('/\.ac-seg__option\s*\{[^}]*min-height:\s*var\(--ac-touch\)/s', $css);
	}
}
