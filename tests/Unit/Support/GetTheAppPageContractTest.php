<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Support;

use OCA\AudioCheck\Support\MobileAppLinks;
use PHPUnit\Framework\TestCase;

/**
 * Contract: Get the App nav + route + SPA view + Play Store security attributes.
 */
final class GetTheAppPageContractTest extends TestCase
{
	private string $root;

	protected function setUp(): void
	{
		parent::setUp();
		$this->root = dirname(__DIR__, 3);
	}

	public function testRouteAndControllerExist(): void
	{
		$routes = (string) file_get_contents($this->root . '/appinfo/routes.php');
		self::assertStringContainsString("page#getTheApp", $routes);
		self::assertStringContainsString("'/get-the-app'", $routes);

		$php = (string) file_get_contents($this->root . '/lib/Controller/PageController.php');
		self::assertStringContainsString('function getTheApp(', $php);
		self::assertStringContainsString("'get-the-app'", $php);
		self::assertStringContainsString('Get the App', $php);
		self::assertStringContainsString('audiocheck.page.getTheApp', $php);
		self::assertStringContainsString('MobileAppLinks', $php);
		self::assertStringContainsString("'playStore'", $php);
		self::assertStringContainsString('views/get-the-app', $php);
	}

	public function testNavPlacedAfterSettings(): void
	{
		$php = (string) file_get_contents($this->root . '/lib/Controller/PageController.php');
		$settingsPos = strpos($php, "'id' => 'settings'");
		$getAppPos = strpos($php, "'id' => 'get-the-app'");
		$appSettingsPos = strpos($php, "'id' => 'app-settings'");
		self::assertNotFalse($settingsPos);
		self::assertNotFalse($getAppPos);
		self::assertNotFalse($appSettingsPos);
		self::assertGreaterThan($settingsPos, $getAppPos, 'Get the App must follow Settings in Account nav');
		self::assertGreaterThan($getAppPos, $appSettingsPos, 'App settings stays after Get the App for admins');
	}

	public function testRouterAndViewWirePlayStoreSafely(): void
	{
		$router = (string) file_get_contents($this->root . '/js/common/router.js');
		self::assertStringContainsString("'get-the-app': { path: '/get-the-app', view: 'get-the-app' }", $router);

		$js = (string) file_get_contents($this->root . '/js/views/get-the-app.js');
		self::assertStringContainsString("register('get-the-app'", $js);
		self::assertStringContainsString("rel: 'noopener noreferrer'", $js);
		self::assertStringContainsString("target: '_blank'", $js);
		self::assertStringContainsString(MobileAppLinks::PLAY_STORE_URL, $js);
		self::assertStringContainsString("t('audiocheck', 'Get it on Google Play')", $js);
		self::assertStringContainsString('ac-get-app__features', $js);
		self::assertStringContainsString('ac-get-app__hero', $js);
		self::assertStringContainsString('ac-get-app__actions', $js);
		self::assertStringContainsString('ac-get-app__action', $js);
		self::assertStringContainsString('ac-get-app__play', $js);
		self::assertStringNotContainsString('ac-get-app__icon-well--hero', $js);
		self::assertStringNotContainsString('ac-get-app__resources', $js);
		self::assertStringNotContainsString('ac-get-app__resource', $js);
		self::assertStringNotContainsString('ac-get-app__secondary', $js);
		self::assertStringNotContainsString('ac-get-app__footer', $js);
		self::assertStringNotContainsString('ac-get-app__note', $js);
		self::assertStringNotContainsString('ac-get-app__links', $js);
		self::assertStringNotContainsString('The Nextcloud web app stays free (AGPL)', $js);
		self::assertStringContainsString('AudioCheckIcons.mount', $js);
		self::assertStringContainsString("indexOf('https://play.google.com/') === 0", $js);
	}

	public function testIconsAndChromeIncludeSmartphone(): void
	{
		$catalog = (string) file_get_contents($this->root . '/lib/Service/IconCatalog.php');
		$iconsJs = (string) file_get_contents($this->root . '/js/common/icons.js');
		$start = (string) file_get_contents($this->root . '/templates/common/page-start.php');
		self::assertStringContainsString("'smartphone'", $catalog);
		self::assertStringContainsString('smartphone:', $iconsJs);
		self::assertStringContainsString("'get-the-app' => 'smartphone'", $start);
	}

	public function testCssSeparatesStaticFeaturesFromActionButtons(): void
	{
		$css = (string) file_get_contents($this->root . '/css/common/page-patterns.css');
		self::assertMatchesRegularExpression(
			'/\.ac-get-app__hero[^{]*\{[^}]*linear-gradient/s',
			$css,
		);
		self::assertMatchesRegularExpression(
			'/\.ac-get-app__feature-copy[^{]*\{[^}]*flex-direction:\s*column/s',
			$css,
		);
		self::assertMatchesRegularExpression(
			'/\.ac-get-app__feature-title[^{]*\{[^}]*display:\s*block/s',
			$css,
		);
		self::assertMatchesRegularExpression(
			'/\.ac-get-app__feature[^{]*\{[^}]*cursor:\s*default/s',
			$css,
		);
		self::assertMatchesRegularExpression(
			'/\.ac-get-app__feature[^{]*\{[^}]*background:\s*transparent/s',
			$css,
		);
		self::assertMatchesRegularExpression(
			'/\.ac-get-app__play[^{]*\{[^}]*min-height:\s*var\(--ac-touch/s',
			$css,
		);
		self::assertMatchesRegularExpression(
			'/\.ac-get-app__play[^{]*\{[^}]*background:\s*var\(--color-primary-element\)/s',
			$css,
		);
		self::assertMatchesRegularExpression(
			'/\.ac-get-app__action[^{]*\{[^}]*cursor:\s*pointer/s',
			$css,
		);
		self::assertMatchesRegularExpression(
			'/\.ac-get-app__action[^{]*\{[^}]*border:\s*2px\s+solid\s+var\(--color-primary-element\)/s',
			$css,
		);
		self::assertMatchesRegularExpression(
			'/\.ac-get-app__action[^{]*\{[^}]*text-decoration:\s*none/s',
			$css,
		);
		self::assertMatchesRegularExpression(
			'/\.ac-get-app__play(?:-icon)?\s+\.ac-icon[^{]*\{[^}]*color:\s*var\(--color-primary-element-text\)/s',
			$css,
		);
		self::assertMatchesRegularExpression(
			'/\.ac-get-app__icon-well--feature[^{]*\{[^}]*color:\s*var\(--color-main-text\)/s',
			$css,
		);
		self::assertDoesNotMatchRegularExpression(
			'/\.ac-get-app__resource\s*\{/',
			$css,
		);
		self::assertDoesNotMatchRegularExpression(
			'/\.ac-get-app__links\s*\{/',
			$css,
		);
	}
}
