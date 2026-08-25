<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use OCA\AudioCheck\Service\AppIconService;
use OCP\App\IAppManager;
use OCP\IURLGenerator;
use PHPUnit\Framework\TestCase;
use RuntimeException;

final class AppIconServiceTest extends TestCase
{
	public function testSurfacePrefersDashboardAssetWithCacheBust(): void
	{
		$url = $this->createMock(IURLGenerator::class);
		$url->method('imagePath')->willReturnCallback(static function (string $app, string $file): string {
			if ($file === 'app-dashboard.svg') {
				return '/apps/audiocheck/img/app-dashboard.svg';
			}
			if ($file === 'app.svg') {
				return '/apps/audiocheck/img/app.svg';
			}
			throw new RuntimeException('missing');
		});
		$url->method('getAbsoluteURL')->willReturnCallback(
			static fn (string $p) => 'https://nc.test' . $p
		);
		$apps = $this->createMock(IAppManager::class);
		$apps->method('getAppVersion')->willReturn('1.2.20');

		$svc = new AppIconService($url, $apps);
		$this->assertSame(
			'https://nc.test/apps/audiocheck/img/app-dashboard.svg?v=1.2.20',
			$svc->absoluteSurfaceIconUrl()
		);
		$this->assertStringContainsString('app.svg?v=1.2.20', $svc->headerIconPath());
	}

	public function testSurfaceFallsBackWhenDashboardMissing(): void
	{
		$url = $this->createMock(IURLGenerator::class);
		$url->method('imagePath')->willReturnCallback(static function (string $app, string $file): string {
			if (in_array($file, ['app-dashboard.svg', 'app-dark.svg'], true)) {
				throw new RuntimeException('missing');
			}
			if ($file === 'app.svg') {
				return '/apps/audiocheck/img/app.svg';
			}
			throw new RuntimeException('missing');
		});
		$url->method('getAbsoluteURL')->willReturnCallback(
			static fn (string $p) => 'https://nc.test' . $p
		);
		$apps = $this->createMock(IAppManager::class);
		$apps->method('getAppVersion')->willReturn('1.2.20');

		$svc = new AppIconService($url, $apps);
		$this->assertStringContainsString('app.svg?v=1.2.20', $svc->absoluteSurfaceIconUrl());
	}
}
