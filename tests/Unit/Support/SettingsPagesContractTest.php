<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Support;

use OCA\AudioCheck\Service\SettingsSectionCatalog;
use PHPUnit\Framework\TestCase;

/**
 * Pins SETTINGS-PAGES-STANDARD artifacts to SettingsSectionCatalog.
 */
final class SettingsPagesContractTest extends TestCase
{
	private string $root;

	protected function setUp(): void
	{
		parent::setUp();
		$this->root = dirname(__DIR__, 3);
	}

	public function testRoutesAllowlistMatchesCatalog(): void
	{
		$routes = (string) file_get_contents($this->root . '/appinfo/routes.php');
		self::assertStringContainsString('/app-settings/{section}', $routes);
		self::assertStringContainsString(SettingsSectionCatalog::routeRequirement(), $routes);
		self::assertStringContainsString('page#appSettingsIndex', $routes);
	}

	public function testPageControllerUsesCatalog(): void
	{
		$src = (string) file_get_contents($this->root . '/lib/Controller/PageController.php');
		self::assertStringContainsString('SettingsSectionCatalog', $src);
		self::assertStringContainsString('appSettingsIndex', $src);
		self::assertStringContainsString('settingsSection', $src);
	}

	public function testRouterPathMatchesCatalog(): void
	{
		$js = (string) file_get_contents($this->root . '/js/common/router.js');
		self::assertStringContainsString(SettingsSectionCatalog::routeRequirement(), $js);
		self::assertStringContainsString('/app-settings/', $js);
	}

	public function testAppSettingsJsUsesCatalogSlugs(): void
	{
		$js = (string) file_get_contents($this->root . '/js/views/app-settings.js');
		foreach (SettingsSectionCatalog::SECTIONS as $section) {
			self::assertStringContainsString("'" . $section . "'", $js);
		}
		self::assertStringContainsString('settingsSection', $js);
		self::assertStringContainsString('Save access', $js);
		self::assertStringContainsString('Save admins', $js);
		self::assertStringContainsString('Save defaults', $js);
	}

	public function testNavigationSupportsSettingsChildren(): void
	{
		$nav = (string) file_get_contents($this->root . '/templates/common/navigation.php');
		self::assertStringContainsString('children', $nav);
		self::assertStringContainsString('ac-nav__children', $nav);
		self::assertStringContainsString('is-expanded', $nav);
		self::assertStringContainsString('aria-expanded', $nav);
		self::assertStringContainsString("empty(\$item['expanded'])", $nav);
		self::assertMatchesRegularExpression(
			'/class="ac-nav__children"[\s\S]*?empty\(\$item\[\'expanded\'\]\)[\s\S]*?hidden/s',
			$nav,
		);
	}

	public function testAppSettingsNavExpandsOnlyWhenActive(): void
	{
		$php = (string) file_get_contents($this->root . '/lib/Controller/PageController.php');
		self::assertMatchesRegularExpression(
			"/\\\$mapped\\['expanded'\\]\\s*=\\s*\\\$activeView\\s*===\\s*'app-settings'/s",
			$php,
		);
		$js = (string) file_get_contents($this->root . '/js/common/router.js');
		self::assertStringContainsString('syncAppSettingsNavExpansion', $js);
		self::assertStringContainsString("syncAppSettingsNavExpansion(li, viewId === 'app-settings')", $js);
		self::assertDoesNotMatchRegularExpression(
			"/is-expanded['\"],\\s*true\\)/s",
			$js,
			'Must not force App settings permanently expanded.',
		);
	}
}
