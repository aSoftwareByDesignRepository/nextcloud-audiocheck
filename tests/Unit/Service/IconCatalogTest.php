<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use OCA\AudioCheck\Service\IconCatalog;
use PHPUnit\Framework\TestCase;

final class IconCatalogTest extends TestCase
{
	public function testRenderUsesCurrentColorStrokeIcons(): void
	{
		$svg = IconCatalog::render('home');
		$this->assertStringContainsString('stroke="currentColor"', $svg);
		$this->assertStringContainsString('class="ac-icon"', $svg);
		$this->assertStringContainsString('aria-hidden="true"', $svg);
	}

	public function testTransportIconsExist(): void
	{
		foreach (['previous', 'next', 'pause', 'volume-high', 'volume-mute'] as $name) {
			$svg = IconCatalog::render($name);
			$this->assertStringContainsString('class="ac-icon"', $svg, $name);
			$this->assertStringContainsString('stroke="currentColor"', $svg, $name);
		}
	}

	public function testUnknownIconFallsBackToBrowse(): void
	{
		$svg = IconCatalog::render('does-not-exist');
		$this->assertStringContainsString('<rect x="3" y="3"', $svg);
	}
}
