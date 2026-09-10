<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Integration;

use Test\TestCase;

/**
 * INV-AUTH-1 live HTTP: unauthenticated stream/cover must be uniform 404 JSON,
 * not framework 401 "Current user is not logged in" (existence / auth leak).
 *
 * Hits the real AppFramework stack (PublicPage + middleware + controller).
 */
final class MediaUnauthHttpIntegrationTest extends TestCase
{
	private const BASE = 'http://127.0.0.1/index.php/apps/audiocheck/api';

	protected function setUp(): void
	{
		if (!class_exists(\OC::class) || !isset(\OC::$server)) {
			$this->markTestSkipped('Nextcloud is not bootstrapped (run inside Docker with NEXTCLOUD_ROOT).');
		}
		if (!$this->httpReachable(self::BASE . '/stream/1')) {
			$this->markTestSkipped('HTTP to local Nextcloud unavailable from this process.');
		}
	}

	public function testUnauthStreamReturnsUniform404Not401(): void
	{
		[$status, $body] = $this->httpGet(self::BASE . '/stream/1');
		$this->assertUniformMediaNotFound($status, $body, 'stream');
	}

	public function testUnauthCoverReturnsUniform404Not401(): void
	{
		[$status, $body] = $this->httpGet(self::BASE . '/cover/1');
		$this->assertUniformMediaNotFound($status, $body, 'cover');
	}

	private function assertUniformMediaNotFound(int $status, string $body, string $label): void
	{
		self::assertNotSame(
			401,
			$status,
			$label . ' must not leak unauth via framework 401; body=' . substr($body, 0, 200),
		);
		self::assertSame(404, $status, $label . ' expected uniform 404; body=' . substr($body, 0, 200));
		$data = json_decode($body, true);
		self::assertIsArray($data, $label . ' body must be JSON');
		self::assertFalse($data['ok'] ?? true);
		self::assertSame('not_found', $data['error']['code'] ?? null);
		self::assertSame('not_found', $data['message'] ?? null);
		self::assertStringNotContainsString('not logged in', strtolower($body));
	}

	/** @return array{0:int,1:string} */
	private function httpGet(string $url): array
	{
		$ctx = stream_context_create([
			'http' => [
				'method' => 'GET',
				'ignore_errors' => true,
				'timeout' => 5,
				'header' => "Accept: application/json\r\n",
			],
		]);
		$body = @file_get_contents($url, false, $ctx);
		if ($body === false) {
			$body = '';
		}
		$status = 0;
		if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m)) {
			$status = (int)$m[1];
		}
		return [$status, $body];
	}

	private function httpReachable(string $url): bool
	{
		[$status] = $this->httpGet($url);
		return $status > 0;
	}
}
