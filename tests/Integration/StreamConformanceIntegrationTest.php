<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Integration;

use OCA\AudioCheck\Controller\StreamController;
use OCA\AudioCheck\Exception\NotFoundException;
use OCA\AudioCheck\Service\FileAccessService;
use OCA\AudioCheck\Service\StreamResponseFactory;
use OCA\AudioCheck\Tests\Shim\IntegrationTestUsers;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\JSONResponse;
use OCP\Files\File;
use OCP\IUserManager;
use OCP\IUserSession;
use Test\TestCase;

/** Streaming conformance: 200/206 headers and foreign-file 404 (§9.7, AC-TST-01). */
final class StreamConformanceIntegrationTest extends TestCase
{
	private const OWNER_FULL = 'ac_stream_owner_full';
	private const OWNER_FOREIGN = 'ac_stream_owner_for';
	private const ATTACKER = 'ac_stream_att';
	private const PASSWORD = 'ac-test-pass-9xK!';

	protected function setUp(): void
	{
		if (!class_exists(\OC::class) || !isset(\OC::$server)) {
			$this->markTestSkipped('Nextcloud is not bootstrapped (run inside Docker with NEXTCLOUD_ROOT).');
		}
		IntegrationTestUsers::remove(self::OWNER_FULL, self::OWNER_FOREIGN, self::ATTACKER);
	}

	protected function tearDown(): void
	{
		IntegrationTestUsers::clearSession();
		IntegrationTestUsers::remove(
			self::OWNER_FULL,
			self::OWNER_FOREIGN,
			self::ATTACKER,
			'ac_stream_owner_rng',
			'ac_stream_range_416',
		);
	}

	public function testOwnFileStreamsWithRangeHeaders(): void
	{
		$owner = 'ac_stream_owner_rng';
		IntegrationTestUsers::create($owner, self::PASSWORD);

		/** @var FileAccessService $access */
		$access = \OC::$server->get(FileAccessService::class);
		/** @var File $file */
		$file = $access->getUserFolder($owner)->newFile('stream-test.mp3');
		$content = $this->minimalMp3Bytes();
		$file->putContent($content);
		$fileId = (int)$file->getId();
		$file = $access->resolveReadableFile($owner, $fileId);

		/** @var StreamResponseFactory $factory */
		$factory = \OC::$server->get(StreamResponseFactory::class);
		$full = $factory->createFromFile($file, null, null, null);
		$this->assertSame(Http::STATUS_OK, $full->getStatus());
		$fullHeaders = $full->getHeaders();
		$this->assertSame('bytes', $fullHeaders['Accept-Ranges'] ?? null);
		$this->assertSame('nosniff', $fullHeaders['X-Content-Type-Options'] ?? null);
		$this->assertStringContainsString('private', $fullHeaders['Cache-Control'] ?? '');

		$partial = $factory->createFromFile($file, 'bytes=0-15', null, null);
		$this->assertSame(Http::STATUS_PARTIAL_CONTENT, $partial->getStatus());
		$partialHeaders = $partial->getHeaders();
		$this->assertStringStartsWith('bytes 0-15/', $partialHeaders['Content-Range'] ?? '');
		$this->assertSame('16', $partialHeaders['Content-Length'] ?? null);
	}

	public function testForeignStreamReturnsUniformNotFoundJson(): void
	{
		IntegrationTestUsers::create(self::OWNER_FOREIGN, self::PASSWORD);
		IntegrationTestUsers::create(self::ATTACKER, self::PASSWORD);

		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		/** @var FileAccessService $access */
		$access = \OC::$server->get(FileAccessService::class);
		$file = $access->getUserFolder(self::OWNER_FOREIGN)->newFile('stream-secret.mp3');
		$file->putContent($this->minimalMp3Bytes());
		$fileId = (int)$file->getId();

		IntegrationTestUsers::loginAs(self::ATTACKER);

		/** @var StreamController $controller */
		$controller = \OC::$server->get(StreamController::class);
		$response = $controller->play($fileId);

		$this->assertInstanceOf(JSONResponse::class, $response);
		$this->assertSame(Http::STATUS_NOT_FOUND, $response->getStatus());
		$data = $response->getData();
		$this->assertIsArray($data);
		$this->assertSame('not_found', $data['error']['code'] ?? null);

		try {
			$access->resolveReadableFile(self::ATTACKER, $fileId);
			$this->fail('Expected NotFoundException for foreign stream resolve');
		} catch (NotFoundException) {
			$this->addToAssertionCount(1);
		}
	}

	public function testInvalidRangeReturns416(): void
	{
		$owner = 'ac_stream_range_416';
		IntegrationTestUsers::create($owner, self::PASSWORD);

		/** @var FileAccessService $access */
		$access = \OC::$server->get(FileAccessService::class);
		$file = $access->getUserFolder($owner)->newFile('range-bad.mp3');
		$file->putContent($this->minimalMp3Bytes());
		$file = $access->resolveReadableFile($owner, (int)$file->getId());

		/** @var StreamResponseFactory $factory */
		$factory = \OC::$server->get(StreamResponseFactory::class);
		$response = $factory->createFromFile($file, 'bytes=5-1', null, null);
		$this->assertSame(Http::STATUS_REQUEST_RANGE_NOT_SATISFIABLE, $response->getStatus());
		$this->assertStringStartsWith('bytes */', $response->getHeaders()['Content-Range'] ?? '');
	}

	private function minimalMp3Bytes(): string
	{
		return "ID3\x03\x00\x00\x00\x00\x00\x00"
			. "\xFF\xFB\x90\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00";
	}
}
