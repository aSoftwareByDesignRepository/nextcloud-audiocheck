<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Dashboard;

use PHPUnit\Framework\TestCase;

/**
 * AudioCheck Continue desklet must register theme-safe CSS on load.
 */
final class DeskletStylesContractTest extends TestCase
{
	private string $root;

	protected function setUp(): void
	{
		parent::setUp();
		$this->root = dirname(__DIR__, 3);
	}

	public function testDeskletCssExistsWithAaTouchAndFocus(): void
	{
		$css = (string)file_get_contents($this->root . '/css/desklet-nextcloud.css');
		self::assertStringContainsString('#app-dashboard .panel:has(.panel--header img[src*="/audiocheck/"]', $css);
		self::assertStringContainsString('min-height: 44px', $css);
		self::assertStringContainsString(':focus-visible', $css);
		self::assertStringContainsString('app-dashboard.svg', $css);
		self::assertStringContainsString('background-invert-if-dark', $css);
		self::assertStringContainsString('prefers-reduced-motion', $css);
		self::assertStringContainsString('a.more', $css);
		self::assertStringContainsString('-webkit-line-clamp: 3', $css);
		self::assertStringContainsString('@media (max-width: 480px)', $css);
		self::assertStringContainsString('forced-colors: active', $css);
	}

	public function testContinueWidgetRegistersDeskletStylesOnLoad(): void
	{
		$trait = (string)file_get_contents($this->root . '/lib/Dashboard/RegistersDeskletStylesTrait.php');
		self::assertStringContainsString("Util::addStyle(Application::APP_ID, 'desklet-nextcloud')", $trait);
		self::assertStringContainsString('$deskletStylesRegistered', $trait);

		$src = (string)file_get_contents($this->root . '/lib/Dashboard/ContinueWidget.php');
		self::assertStringContainsString('RegistersDeskletStylesTrait', $src);
		self::assertMatchesRegularExpression(
			'/function load\(\): void\s*\{\s*\$this->registerDeskletStylesForWidget\(\);/s',
			$src,
			'ContinueWidget load() must register desklet styles',
		);
		self::assertStringContainsString('IConditionalWidget', $src);
		self::assertStringContainsString('linkToRouteAbsolute', $src);
		self::assertStringNotContainsString('icon-audio', $src);
	}
}
