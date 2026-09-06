<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use OCA\AudioCheck\Service\MiniPlayerMarkupService;
use OCP\IL10N;
use OCP\L10N\IFactory;
use PHPUnit\Framework\TestCase;

/**
 * Global overlay builds markup via include+ob_start — NC template helpers
 * (p / print_unescaped) are NOT defined in that path. A crash here 500s Files.
 */
final class MiniPlayerMarkupServiceContractTest extends TestCase
{
	public function testBuildGlobalPayloadDoesNotRequireTemplateHelpers(): void
	{
		self::assertFalse(
			\function_exists('p'),
			'Test must run outside template scope so the bug can surface',
		);

		$l10n = $this->createMock(IL10N::class);
		$l10n->method('t')->willReturnCallback(static fn (string $s): string => $s);
		$factory = $this->createMock(IFactory::class);
		$factory->method('get')->willReturn($l10n);

		$svc = new MiniPlayerMarkupService($factory);
		$payload = $svc->buildGlobalPayload('https://example.test/apps/audiocheck/now-playing');

		self::assertArrayHasKey('markup', $payload);
		self::assertArrayHasKey('nowPlayingUrl', $payload);
		self::assertStringContainsString('id="ac-mini-player"', $payload['markup']);
		self::assertStringContainsString('ac-mini-player--global', $payload['markup']);
		self::assertStringContainsString('id="ac-mini-close"', $payload['markup']);
		self::assertStringContainsString('hidden', $payload['markup']);
		self::assertStringNotContainsString('<!DOCTYPE', $payload['markup']);
		self::assertStringNotContainsString('Internal Server Error', $payload['markup']);
	}
}
