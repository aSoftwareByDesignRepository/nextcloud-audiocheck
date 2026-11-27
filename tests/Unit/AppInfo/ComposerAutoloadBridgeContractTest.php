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
		self::assertTrue(class_exists(\AudioCheck_getID3::class), 'getID3 must load through composer/autoload.php');
		self::assertFalse(
			class_exists('getID3'),
			'global getID3 must NOT be declared — another app (e.g. music) vendoring the same library fatals "Cannot redeclare class" (GH issue #14)'
		);
	}

	public function testPrefixedGetId3AnalyzesRealAudioEndToEnd(): void
	{
		$bridge = $this->root . '/composer/autoload.php';
		if (!is_file($this->root . '/vendor-prefixed/autoload.php')) {
			$this->markTestSkipped('vendor-prefixed/ not generated in this checkout');
		}
		require_once $bridge;

		// 100 ms of 8 kHz mono 16-bit PCM silence — enough for getID3 to parse
		// a real RIFF/WAVE header and exercise the dynamic module loader
		// ('AudioCheck_getid3_' . $module instantiation, which Strauss does
		// not rewrite on its own).
		$wav = $this->makeWav(8000, 1600);
		$tmp = (string)tempnam(sys_get_temp_dir(), 'acwav') . '.wav';
		file_put_contents($tmp, $wav);
		try {
			$getid3 = new \AudioCheck_getID3();
			$info = $getid3->analyze($tmp);
		} finally {
			@unlink($tmp);
		}
		self::assertSame('wav', $info['fileformat'] ?? null, json_encode($info['error'] ?? []));
		self::assertGreaterThan(0, $info['playtime_seconds'] ?? 0);
		self::assertSame(8000, $info['audio']['sample_rate'] ?? null);
	}

	private function makeWav(int $sampleRate, int $samples): string
	{
		$data = str_repeat("\x00\x00", $samples);
		$byteRate = $sampleRate * 2;
		return 'RIFF' . pack('V', 36 + strlen($data)) . 'WAVE'
			. 'fmt ' . pack('V', 16) . pack('v', 1) . pack('v', 1) . pack('V', $sampleRate)
			. pack('V', $byteRate) . pack('v', 2) . pack('v', 16)
			. 'data' . pack('V', strlen($data)) . $data;
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
