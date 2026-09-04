<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\AppInfo;

use PHPUnit\Framework\TestCase;

/**
 * Nextcloud only loads <app>/composer/autoload.php for Composer deps.
 * Without this bridge, getID3 never loads and metadata silently degrades.
 */
final class ComposerAutoloadBridgeContractTest extends TestCase
{
	private string $root;

	protected function setUp(): void
	{
		parent::setUp();
		$this->root = dirname(__DIR__, 3);
	}

	public function testComposerAutoloadBridgeExistsAndRequiresVendor(): void
	{
		$bridge = $this->root . '/composer/autoload.php';
		self::assertFileExists($bridge);
		$src = (string)file_get_contents($bridge);
		self::assertStringContainsString("'/../vendor/autoload.php'", $src);
		self::assertStringContainsString('ClassLoader', $src);
		self::assertStringContainsString('register(false)', $src);
		self::assertStringContainsString('unregister()', $src);
	}

	public function testGetId3AutoloadsViaBridgeWhenVendorPresent(): void
	{
		$bridge = $this->root . '/composer/autoload.php';
		$vendor = $this->root . '/vendor/autoload.php';
		if (!is_file($vendor)) {
			$this->markTestSkipped('vendor/ not installed in this checkout');
		}
		require_once $bridge;
		self::assertTrue(class_exists(\getID3::class), 'getID3 must load through composer/autoload.php');
	}

	public function testMakefileReleaseRequiresComposerProdAndBridge(): void
	{
		$make = (string)file_get_contents($this->root . '/Makefile');
		self::assertStringContainsString('composer install --no-dev', $make);
		self::assertStringContainsString('composer/autoload.php', $make);
		self::assertStringContainsString('james-heinrich/getid3', $make);
		self::assertMatchesRegularExpression('/^release:\s*composer-prod/m', $make);
	}

	public function testCiAssertsComposerBridgeAndGetId3(): void
	{
		$ci = (string)file_get_contents($this->root . '/.github/workflows/ci.yml');
		self::assertStringContainsString('composer/autoload.php', $ci);
		self::assertStringContainsString('class_exists("getID3")', $ci);
		self::assertStringContainsString('composer install --no-dev', $ci);
	}
}
