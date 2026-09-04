<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Listener;

use PHPUnit\Framework\TestCase;

/**
 * Global mini-player must load outside AudioCheck pages (not only PageController).
 * Store description no longer advertises it; behaviour remains access-gated in code.
 */
final class GlobalMiniPlayerContractTest extends TestCase
{
	private string $root;

	protected function setUp(): void
	{
		parent::setUp();
		$this->root = dirname(__DIR__, 3);
	}

	public function testListenerRegistersGlobalPlayerOutsideAudioCheck(): void
	{
		$src = (string)file_get_contents($this->root . '/lib/Listener/BeforeTemplateRenderedListener.php');
		self::assertStringContainsString('registerGlobalMiniPlayer', $src);
		self::assertStringContainsString("'global-mini-player'", $src);
		self::assertStringContainsString("Util::addStyle(Application::APP_ID, 'global-mini-player')", $src);
		self::assertStringNotContainsString("Util::addStyle(Application::APP_ID, 'app')", $src);
		self::assertStringContainsString('canUseApp', $src);
		self::assertStringContainsString('provideInitialState', $src);
		self::assertStringContainsString('hasServerPlayback', $src);
		self::assertStringContainsString('hasPersistedItems', $src);
		self::assertStringContainsString('hasUnfinishedProgress', $src);
		// Must not return early for every non-AudioCheck page anymore.
		self::assertStringNotContainsString(
			"if (\$response->getApp() !== Application::APP_ID) {\n\t\t\treturn;\n\t\t}",
			$src,
		);
	}

	public function testGlobalAssetsExist(): void
	{
		self::assertFileExists($this->root . '/js/global-mini-player.js');
		self::assertFileExists($this->root . '/css/global-mini-player.css');
		self::assertFileExists($this->root . '/templates/partials/mini-player.php');
		self::assertFileExists($this->root . '/lib/Service/MiniPlayerMarkupService.php');
		$js = (string)file_get_contents($this->root . '/js/global-mini-player.js');
		self::assertStringContainsString('hasSessionHint', $js);
		self::assertStringContainsString('hasServerPlayback', $js);
		self::assertStringContainsString('expectRestore', $js);
		self::assertStringContainsString('loadPlayerStack', $js);
		self::assertStringContainsString('PLAYER_SCRIPTS', $js);
	}

	public function testPlayerSupportsGlobalOpenAndScopedShortcuts(): void
	{
		$js = (string)file_get_contents($this->root . '/js/common/player.js');
		self::assertStringContainsString('isGlobalPlayerMode', $js);
		self::assertStringContainsString('AudioCheckGlobalPlayer', $js);
		self::assertStringContainsString('syncPlayerClearance', $js);
		self::assertStringContainsString('/apps/audiocheck/now-playing', $js);
		self::assertStringContainsString('!isGlobalPlayerMode()', $js);
	}

	public function testInfoXmlNc35AndHonestNavigationLimit(): void
	{
		$xml = (string)file_get_contents($this->root . '/appinfo/info.xml');
		self::assertStringContainsString('max-version="35"', $xml);
		self::assertStringContainsString('<version>1.3.4</version>', $xml);
		// Store copy must not advertise the global mini-player.
		self::assertStringNotContainsString('mini-player', $xml);
		self::assertStringNotContainsString('Mini-Player', $xml);
		// Keep honest browser autoplay limit after full navigations.
		self::assertStringContainsString('require a click to resume', $xml);
	}

	public function testGlobalCssKeepsExpandVisibleAndSummaryFocus(): void
	{
		$css = (string)file_get_contents($this->root . '/css/global-mini-player.css');
		self::assertStringContainsString('summary:focus-visible', $css);
		self::assertStringContainsString('ac-mini-player--global .ac-mini-player__open', $css);
		self::assertStringContainsString('display: inline-flex !important', $css);
	}

	public function testCoverPathDoesNotDoubleAnalyzeViaExtractTags(): void
	{
		$src = (string)file_get_contents($this->root . '/lib/Service/CoverService.php');
		// Must not invoke MetadataService::extractTags (double getID3). Doc comments may name it.
		self::assertStringNotContainsString('->extractTags(', $src);
		self::assertStringNotContainsString('metadata->extractTags', $src);
		self::assertStringContainsString('extractEmbeddedFromFile', $src);
		$ctrl = (string)file_get_contents($this->root . '/lib/Controller/CoverController.php');
		self::assertStringContainsString("assertAllowed(\$userId, 'cover'", $ctrl);
	}

	public function testInsertMetaRaceUpdatesWinnerRow(): void
	{
		$src = (string)file_get_contents($this->root . '/lib/Service/MetadataService.php');
		self::assertStringContainsString('REASON_UNIQUE_CONSTRAINT_VIOLATION', $src);
		self::assertMatchesRegularExpression(
			'/UNIQUE_CONSTRAINT_VIOLATION[\s\S]*updateMeta\s*\(/',
			$src,
		);
	}

	public function testMiniPlayerPartialSafeOutsideTemplateEngine(): void
	{
		$src = (string)file_get_contents($this->root . '/templates/partials/mini-player.php');
		self::assertStringContainsString('$acP', $src);
		self::assertStringContainsString('function_exists(\'p\')', $src);
		self::assertStringContainsString('htmlspecialchars', $src);
	}
}
