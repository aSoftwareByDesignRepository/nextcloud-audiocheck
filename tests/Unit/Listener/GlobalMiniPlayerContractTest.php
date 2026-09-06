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
		self::assertStringContainsString('wantsGlobalMiniPlayer', $src);
		self::assertStringContainsString('provideInitialState', $src);
		self::assertStringContainsString('hasServerPlayback', $src);
		self::assertStringContainsString('showGlobalMiniPlayer', $src);
		self::assertStringContainsString('hasPersistedItems', $src);
		self::assertStringContainsString('hasUnfinishedProgress', $src);
		self::assertStringContainsString('assetVersion', $src);
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
		self::assertStringContainsString('loadStateFromDom', $js);
		self::assertStringContainsString("loadState('audiocheck', 'global-mini-player')", $js);
		self::assertStringContainsString('initial-state-audiocheck-global-mini-player', $js);
		self::assertStringContainsString('decodeBase64Utf8', $js);
		self::assertStringContainsString('assetVersion', $js);
		self::assertStringContainsString('__acGlobalMiniPlayerBooted', $js);
		self::assertStringContainsString('fetchPrefs', $js);
		self::assertStringContainsString('audiocheck_global_player_dismissed', $js);
		self::assertStringContainsString('isGloballyDismissed', $js);
		self::assertStringContainsString('r.prefs', $js);
	}

	public function testPlayerSupportsGlobalOpenAndScopedShortcuts(): void
	{
		$js = (string)file_get_contents($this->root . '/js/common/player.js');
		self::assertStringContainsString('isGlobalPlayerMode', $js);
		self::assertStringContainsString('AudioCheckGlobalPlayer', $js);
		self::assertStringContainsString('syncPlayerClearance', $js);
		self::assertStringContainsString('/apps/audiocheck/now-playing', $js);
		self::assertStringContainsString('!isGlobalPlayerMode()', $js);
		self::assertStringContainsString('dismissMiniPlayer', $js);
		self::assertStringContainsString('GLOBAL_DISMISS_KEY', $js);
		self::assertStringContainsString('fromRestore', $js);
		self::assertStringContainsString('ac-mini-close', $js);
		self::assertStringContainsString('restoreEpoch', $js);
	}

	public function testInfoXmlNc35AndHonestNavigationLimit(): void
	{
		$xml = (string)file_get_contents($this->root . '/appinfo/info.xml');
		self::assertStringContainsString('max-version="35"', $xml);
		self::assertStringContainsString('<version>1.3.7</version>', $xml);
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
		self::assertStringContainsString('ac-mini-player--needs-gesture', $css);
		self::assertStringContainsString('--ac-radius-md', $css);
		self::assertStringContainsString('--ac-touch: 44px', $css);
		self::assertStringContainsString('ac-mini-player__close', $css);
		self::assertStringContainsString('#ac-mini-player[hidden]', $css);
	}

	public function testMiniPlayerPartialHasCloseControl(): void
	{
		$src = (string)file_get_contents($this->root . '/templates/partials/mini-player.php');
		self::assertStringContainsString('id="ac-mini-close"', $src);
		self::assertStringContainsString('Close player', $src);
		self::assertStringContainsString("IconCatalog::render('close'", $src);
		self::assertStringContainsString('ac-mini-player--idle', $src);
		self::assertStringContainsString('data-ac-mini-state="idle"', $src);
	}

	public function testMiniPlayerBachusSimplificationContracts(): void
	{
		$js = (string)file_get_contents($this->root . '/js/common/player.js');
		self::assertStringContainsString('syncMiniPlayerMode', $js);
		self::assertStringContainsString('ac-mini-player--active', $js);
		self::assertStringContainsString('data-ac-mini-state', $js);
		$css = (string)file_get_contents($this->root . '/css/global-mini-player.css');
		self::assertStringContainsString('ac-mini-player--idle', $css);
		self::assertStringContainsString('max-width: 639px', $css);
		self::assertStringContainsString('.ac-mini-player .ac-transport-btn--jump', $css);
		self::assertStringContainsString('ac-mini-player__transport[hidden]', $css);
		$appCss = (string)file_get_contents($this->root . '/css/app.css');
		self::assertStringContainsString('ac-mini-player--idle', $appCss);
		self::assertStringContainsString('max-width: 639px', $appCss);
		self::assertFileExists($this->root . '/tests/e2e/mini-player-ux.spec.js');
	}

	public function testPrefsServiceGatesGlobalMiniPlayer(): void
	{
		$src = (string)file_get_contents($this->root . '/lib/Service/UserPrefsService.php');
		self::assertStringContainsString('showGlobalMiniPlayer', $src);
		self::assertStringContainsString('wantsGlobalMiniPlayer', $src);
		self::assertStringContainsString('show_global_mini_player', $src);
		// Opt-in: unset preference must default to disabled ('0'), never '1'.
		self::assertStringContainsString("show_global_mini_player', '0')", $src);
		self::assertStringNotContainsString("show_global_mini_player', '1')", $src);
		$settings = (string)file_get_contents($this->root . '/js/views/settings.js');
		self::assertStringContainsString('ac-show-global-mini', $settings);
		self::assertStringContainsString('Show player on other pages', $settings);
		self::assertStringContainsString('showGlobalMiniPlayer', $settings);
		self::assertStringContainsString('showGlobalMiniPlayer === true', $settings);
		self::assertStringContainsString('Off by default', $settings);
		$boot = (string)file_get_contents($this->root . '/js/global-mini-player.js');
		self::assertStringContainsString('showGlobalMiniPlayer !== true', $boot);
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
