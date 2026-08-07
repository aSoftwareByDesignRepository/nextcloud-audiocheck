<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use OCA\AudioCheck\Service\SettingsSectionCatalog;
use OCP\IL10N;
use PHPUnit\Framework\TestCase;

final class SettingsSectionCatalogTest extends TestCase
{
	public function testDefaultIsAllowlisted(): void
	{
		self::assertSame('access', SettingsSectionCatalog::DEFAULT_SECTION);
		self::assertContains(SettingsSectionCatalog::DEFAULT_SECTION, SettingsSectionCatalog::SECTIONS);
	}

	public function testRouteRequirementMatchesSections(): void
	{
		self::assertSame(implode('|', SettingsSectionCatalog::SECTIONS), SettingsSectionCatalog::routeRequirement());
	}

	public function testIsSectionRejectsUnknown(): void
	{
		$cat = new SettingsSectionCatalog();
		foreach (SettingsSectionCatalog::SECTIONS as $section) {
			self::assertTrue($cat->isSection($section));
		}
		self::assertFalse($cat->isSection('nope'));
		self::assertFalse($cat->isSection(''));
	}

	public function testLabelsAreNonEmpty(): void
	{
		$l = $this->createMock(IL10N::class);
		$l->method('t')->willReturnCallback(static fn (string $s): string => $s);
		$cat = new SettingsSectionCatalog();
		foreach (SettingsSectionCatalog::SECTIONS as $section) {
			self::assertNotSame('', $cat->label($l, $section));
			self::assertNotSame('', $cat->navLabel($l, $section));
			self::assertNotSame('', $cat->help($l, $section));
		}
	}
}
