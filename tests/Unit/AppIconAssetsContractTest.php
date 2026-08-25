<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit;

use PHPUnit\Framework\TestCase;

/**
 * AudioCheck must ship theme-safe icons for NC header invert + dashboard surfaces.
 */
final class AppIconAssetsContractTest extends TestCase
{
	private string $imgDir;
	private string $root;

	protected function setUp(): void
	{
		parent::setUp();
		$this->root = dirname(__DIR__, 2);
		$this->imgDir = $this->root . '/img';
	}

	public function testRequiredIconFilesExist(): void
	{
		foreach (['app.svg', 'app-dark.svg', 'app-dashboard.svg'] as $file) {
			$path = $this->imgDir . '/' . $file;
			$this->assertFileExists($path, $file);
			$this->assertGreaterThan(200, (int)filesize($path), $file . ' must not be a stub');
		}
	}

	public function testHeaderIconIsWhiteForNcInvertFilter(): void
	{
		$svg = (string)file_get_contents($this->imgDir . '/app.svg');
		$this->assertStringContainsString('AudioCheck', $svg);
		$this->assertStringContainsString('stroke="#ffffff"', $svg, 'Header glyph must be white for NC invert filters');
		$this->assertStringContainsString('fill="#ffffff"', $svg);
		$this->assertStringNotContainsString('currentColor', $svg, 'currentColor does not work inside img tags');
		$this->assertStringNotContainsString('stroke="#000', $svg);
		$this->assertStringContainsString('viewBox="0 0 32 32"', $svg);
	}

	public function testDarkAndDashboardIconsHaveNoWhiteStroke(): void
	{
		foreach (['app-dark.svg', 'app-dashboard.svg'] as $file) {
			$svg = (string)file_get_contents($this->imgDir . '/' . $file);
			$this->assertStringNotContainsString('stroke="#ffffff"', $svg, $file . ' must be dark/uncoloured for dashboard');
			$this->assertStringNotContainsString('fill="#ffffff"', $svg, $file);
			$this->assertStringNotContainsString('currentColor', $svg, $file);
			$this->assertStringContainsString('stroke="#000000"', $svg, $file);
			$this->assertStringContainsString('AudioCheck', $svg);
			$this->assertStringContainsString('width="44"', $svg, $file . ' should be 44px for dashboard');
			$this->assertStringContainsString('viewBox="0 0 32 32"', $svg);
		}
	}

	public function testSvgCommentsAreStrictXmlSafe(): void
	{
		foreach (['app.svg', 'app-dark.svg', 'app-dashboard.svg'] as $file) {
			$svg = (string)file_get_contents($this->imgDir . '/' . $file);
			if (preg_match_all('/<!--(.*?)-->/s', $svg, $matches) === false) {
				$this->fail($file . ' comment parse failed');
			}
			foreach ($matches[1] as $commentBody) {
				$this->assertStringNotContainsString(
					'--',
					$commentBody,
					$file . ' XML comment must not contain double-hyphen (breaks librsvg / strict parsers)'
				);
			}
		}
	}

	public function testAppIconServiceIsWiredForSurfaces(): void
	{
		$svc = (string)file_get_contents($this->root . '/lib/Service/AppIconService.php');
		$this->assertStringContainsString('withCacheBust', $svc);
		$this->assertStringContainsString('getAppVersion', $svc);
		$this->assertStringContainsString('headerIconPath', $svc);
		$this->assertStringContainsString('absoluteSurfaceIconUrl', $svc);

		$app = (string)file_get_contents($this->root . '/lib/AppInfo/Application.php');
		$this->assertStringContainsString('AppIconService', $app);
		$this->assertStringContainsString('headerIconPath()', $app);
		$this->assertStringNotContainsString(
			"imagePath(self::APP_ID, 'app.svg')",
			$app,
			'Navigation must use cache-busted white header icon'
		);

		$widget = (string)file_get_contents($this->root . '/lib/Dashboard/ContinueWidget.php');
		$this->assertStringContainsString('AppIconService', $widget);
		$this->assertStringContainsString('absoluteSurfaceIconUrl', $widget);
		$this->assertStringNotContainsString(
			"imagePath(Application::APP_ID, 'app.svg')",
			$widget,
			'ContinueWidget must not hard-code white header icon for dashboard'
		);
	}

	public function testInfoXmlVersionMatchesAppinfoVersionFile(): void
	{
		$info = (string)file_get_contents($this->root . '/appinfo/info.xml');
		$ver = trim((string)file_get_contents($this->root . '/appinfo/version'));
		$this->assertMatchesRegularExpression('/<version>\s*' . preg_quote($ver, '/') . '\s*<\/version>/', $info);
		$this->assertSame('1.2.20', $ver);
	}
}
