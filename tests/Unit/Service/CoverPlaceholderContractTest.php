<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use PHPUnit\Framework\TestCase;

/**
 * Cover placeholders must stay visible under Nextcloud themes that do not
 * flip prefers-color-scheme (common: NC dark + OS light).
 */
final class CoverPlaceholderContractTest extends TestCase
{
	public function testDefaultPlaceholderDoesNotUsePrefersColorScheme(): void
	{
		$src = (string)file_get_contents(dirname(__DIR__, 3) . '/lib/Service/CoverService.php');
		$this->assertStringContainsString('Theme-agnostic cover placeholder', $src);
		$this->assertStringContainsString('fill="#4b5563"', $src);
		$this->assertStringContainsString('fill="#e5e7eb"', $src);
		$this->assertDoesNotMatchRegularExpression(
			'/\$svg\s*=.*prefers-color-scheme/s',
			$src,
			'SVG payload must not embed prefers-color-scheme media queries'
		);
		$this->assertStringNotContainsString("@media (prefers-color-scheme", $src);
	}
}
