<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use OCA\AudioCheck\AppInfo\Application;
use OCA\AudioCheck\Service\PlaybackStateService;
use OCA\AudioCheck\Service\UserPrefsService;
use OCP\IConfig;
use PHPUnit\Framework\TestCase;

/**
 * Prefs must treat JSON/string falsey values as OFF — PHP truthiness is not a security model.
 */
final class UserPrefsServiceBooleanCoercionTest extends TestCase
{
	/** @var array<string, string> */
	private array $store = [];

	private function service(): UserPrefsService
	{
		$this->store = [];
		$config = $this->createMock(IConfig::class);
		$config->method('getUserValue')->willReturnCallback(
			function (string $userId, string $app, string $key, string $default = '') {
				return $this->store[$key] ?? $default;
			}
		);
		$config->method('setUserValue')->willReturnCallback(
			function (string $userId, string $app, string $key, string $value): void {
				$this->store[$key] = $value;
			}
		);
		$playback = $this->createMock(PlaybackStateService::class);
		$playback->method('getDefaultSpeed')->willReturn(100);
		$playback->method('getDefaultVolume')->willReturn(100);
		$playback->method('getListenedThresholdPercent')->willReturn(95);

		return new UserPrefsService($config, $playback);
	}

	public function testDefaultGlobalMiniPlayerIsOff(): void
	{
		$svc = $this->service();
		$this->assertFalse($svc->wantsGlobalMiniPlayer('alice'));
		$prefs = $svc->getPrefs('alice');
		$this->assertFalse($prefs['showGlobalMiniPlayer']);
	}

	/**
	 * @dataProvider falseyPayloadProvider
	 */
	public function testFalseyShowGlobalMiniPlayerDoesNotEnable(mixed $payloadValue): void
	{
		$svc = $this->service();
		// First enable for real.
		$svc->savePrefs('alice', ['showGlobalMiniPlayer' => true]);
		$this->assertTrue($svc->wantsGlobalMiniPlayer('alice'));

		// Attacker / buggy client sends a string that PHP treats as truthy but means "off".
		$svc->savePrefs('alice', ['showGlobalMiniPlayer' => $payloadValue]);
		$this->assertFalse(
			$svc->wantsGlobalMiniPlayer('alice'),
			'Payload ' . json_encode($payloadValue) . ' must disable global mini-player, not enable it'
		);
		$this->assertSame('0', $this->store['show_global_mini_player'] ?? null);
	}

	/**
	 * @return array<string, array{0: mixed}>
	 */
	public static function falseyPayloadProvider(): array
	{
		return [
			'json false' => [false],
			'int 0' => [0],
			'string false' => ['false'],
			'string 0' => ['0'],
			'string no' => ['no'],
			'string off' => ['off'],
			'empty string' => [''],
			'null' => [null],
		];
	}

	/**
	 * @dataProvider truthyPayloadProvider
	 */
	public function testTruthyShowGlobalMiniPlayerEnables(mixed $payloadValue): void
	{
		$svc = $this->service();
		$svc->savePrefs('alice', ['showGlobalMiniPlayer' => $payloadValue]);
		$this->assertTrue($svc->wantsGlobalMiniPlayer('alice'));
		$this->assertSame('1', $this->store['show_global_mini_player'] ?? null);
	}

	/**
	 * @return array<string, array{0: mixed}>
	 */
	public static function truthyPayloadProvider(): array
	{
		return [
			'json true' => [true],
			'int 1' => [1],
			'string true' => ['true'],
			'string 1' => ['1'],
			'string yes' => ['yes'],
			'string on' => ['on'],
		];
	}

	public function testUnknownPrefKeysAreIgnored(): void
	{
		$svc = $this->service();
		$svc->savePrefs('alice', [
			'showGlobalMiniPlayer' => false,
			'role' => 'admin',
			'isAppAdmin' => true,
			'mobile' => ['features' => ['offlineDownloads' => false]],
		]);
		$this->assertFalse($svc->wantsGlobalMiniPlayer('alice'));
		$this->assertArrayNotHasKey('role', $this->store);
		$this->assertArrayNotHasKey('isAppAdmin', $this->store);
	}

	public function testAppIdConstantUsed(): void
	{
		$this->assertSame('audiocheck', Application::APP_ID);
	}
}
