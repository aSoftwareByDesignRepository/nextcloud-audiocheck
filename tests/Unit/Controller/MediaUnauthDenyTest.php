<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Controller;

use OCA\AudioCheck\Controller\CoverController;
use OCA\AudioCheck\Controller\StreamController;
use OCA\AudioCheck\Exception\NotAuthenticatedException;
use OCA\AudioCheck\Service\AccessControlService;
use OCA\AudioCheck\Service\CoverService;
use OCA\AudioCheck\Service\FileAccessService;
use OCA\AudioCheck\Service\RateLimitService;
use OCA\AudioCheck\Service\StreamResponseFactory;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;
use PHPUnit\Framework\TestCase;
use ReflectionMethod;

/**
 * INV-AUTH-1: unauthenticated stream/cover must deny with uniform media 404
 * (same shape as foreign/unauthorized — no existence leak via 401 vs 404).
 *
 * The framework returns 401 "Current user is not logged in" unless the action
 * is PublicPage. Controller-only mocks that throw NotAuthenticatedException
 * are necessary but not sufficient — attribute contracts gate the HTTP path.
 */
final class MediaUnauthDenyTest extends TestCase
{
	public function testStreamPlayHasPublicPageSoFrameworkDoesNot401(): void
	{
		$this->assertMediaActionReachableWhenUnauth(StreamController::class, 'play');
	}

	public function testCoverGetHasPublicPageSoFrameworkDoesNot401(): void
	{
		$this->assertMediaActionReachableWhenUnauth(CoverController::class, 'get');
	}

	public function testStreamPlayUnauthReturnsUniform404AndDoesNotResolveFile(): void
	{
		$request = $this->createMock(IRequest::class);
		$access = $this->createMock(AccessControlService::class);
		$access->expects($this->once())
			->method('currentUserId')
			->willThrowException(new NotAuthenticatedException());

		$rate = $this->createMock(RateLimitService::class);
		$rate->expects($this->never())->method('assertAllowed');

		$fileAccess = $this->createMock(FileAccessService::class);
		$fileAccess->expects($this->never())->method('resolveReadableFile');

		$factory = $this->createMock(StreamResponseFactory::class);
		$factory->expects($this->never())->method('createFromFile');

		$controller = new StreamController(
			'audiocheck',
			$request,
			$access,
			$fileAccess,
			$factory,
			$rate,
		);

		$response = $controller->play(42);
		$this->assertUniformMediaNotFound($response);
	}

	public function testCoverGetUnauthReturnsUniform404AndDoesNotFetchCover(): void
	{
		$request = $this->createMock(IRequest::class);
		$access = $this->createMock(AccessControlService::class);
		$access->expects($this->once())
			->method('currentUserId')
			->willThrowException(new NotAuthenticatedException());

		$rate = $this->createMock(RateLimitService::class);
		$rate->expects($this->never())->method('assertAllowed');

		$cover = $this->createMock(CoverService::class);
		$cover->expects($this->never())->method('getCoverResponse');

		$controller = new CoverController(
			'audiocheck',
			$request,
			$access,
			$cover,
			$rate,
		);

		$response = $controller->get(42);
		$this->assertUniformMediaNotFound($response);
	}

	/**
	 * Same JSON body shape as foreign/denied media (INV-AUTH-3) — no auth-state leak.
	 */
	public function testUnauthDenyBodyMatchesForeignDenyContract(): void
	{
		$expected = [
			'ok' => false,
			'error' => ['code' => 'not_found'],
			'message' => 'not_found',
		];

		$request = $this->createMock(IRequest::class);
		$access = $this->createMock(AccessControlService::class);
		$access->method('currentUserId')->willThrowException(new NotAuthenticatedException());
		$rate = $this->createMock(RateLimitService::class);

		$stream = new StreamController(
			'audiocheck',
			$request,
			$access,
			$this->createMock(FileAccessService::class),
			$this->createMock(StreamResponseFactory::class),
			$rate,
		);
		$cover = new CoverController(
			'audiocheck',
			$request,
			$access,
			$this->createMock(CoverService::class),
			$rate,
		);

		self::assertSame($expected, $stream->play(1)->getData());
		self::assertSame($expected, $cover->get(1)->getData());
	}

	private function assertMediaActionReachableWhenUnauth(string $class, string $method): void
	{
		$ref = new ReflectionMethod($class, $method);
		$public = $ref->getAttributes(PublicPage::class);
		self::assertNotEmpty(
			$public,
			$class . '::' . $method . ' must be #[PublicPage] so unauth requests reach uniform 404 instead of framework 401',
		);
		$csrf = $ref->getAttributes(NoCSRFRequired::class);
		self::assertNotEmpty(
			$csrf,
			$class . '::' . $method . ' must be #[NoCSRFRequired] for media GET without CSRF token',
		);
	}

	private function assertUniformMediaNotFound(mixed $response): void
	{
		self::assertInstanceOf(JSONResponse::class, $response);
		self::assertSame(Http::STATUS_NOT_FOUND, $response->getStatus());
		$data = $response->getData();
		self::assertFalse($data['ok'] ?? true);
		self::assertSame('not_found', $data['error']['code'] ?? null);
		self::assertSame('not_found', $data['message'] ?? null);
	}
}
