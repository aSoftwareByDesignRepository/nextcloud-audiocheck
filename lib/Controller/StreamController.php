<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Controller;

use OCA\AudioCheck\Exception\AccessDeniedException;
use OCA\AudioCheck\Exception\NotAuthenticatedException;
use OCA\AudioCheck\Exception\NotFoundException;
use OCA\AudioCheck\Exception\RateLimitExceededException;
use OCA\AudioCheck\Service\AccessControlService;
use OCA\AudioCheck\Service\FileAccessService;
use OCA\AudioCheck\Service\RateLimitService;
use OCA\AudioCheck\Service\StreamResponseFactory;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;

class StreamController extends Controller
{
	/**
	 * Per-user stream budget (sliding 60s window).
	 * Higher than cover (120): Range seeking generates many short GETs during
	 * normal playback, but still blocks sustained DoS loops.
	 */
	public const STREAM_RATE_MAX = 300;

	public const STREAM_RATE_WINDOW_SEC = 60;

	public function __construct(
		string $appName,
		IRequest $request,
		private AccessControlService $access,
		private FileAccessService $fileAccess,
		private StreamResponseFactory $streamFactory,
		private RateLimitService $rateLimit,
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function play(int $fileId)
	{
		try {
			$userId = $this->access->currentUserId();
			// Bound authenticated stream opens — cover already rate-limits extraction;
			// without this, a single entitled session can exhaust FPM/bandwidth.
			$this->rateLimit->assertAllowed(
				$userId,
				'stream',
				self::STREAM_RATE_MAX,
				self::STREAM_RATE_WINDOW_SEC,
			);
			$file = $this->fileAccess->resolveReadableFile($userId, $fileId);
			return $this->streamFactory->createFromFile(
				$file,
				$this->request->getHeader('Range') ?: null,
				$this->request->getHeader('If-None-Match') ?: null,
				$this->request->getHeader('If-Range') ?: null,
			);
		} catch (RateLimitExceededException) {
			return new JSONResponse([
				'ok' => false,
				'error' => ['code' => 'rate_limit_exceeded'],
				'message' => 'rate_limit_exceeded',
			], Http::STATUS_TOO_MANY_REQUESTS);
		} catch (NotFoundException|NotAuthenticatedException|AccessDeniedException) {
			// Uniform 404 on all access failures: do not reveal whether a file
			// exists to unauthenticated or unauthorized callers (§9.7 / AC-TST-01).
			return new JSONResponse([
				'ok' => false,
				'error' => ['code' => 'not_found'],
				'message' => 'not_found',
			], Http::STATUS_NOT_FOUND);
		} catch (\Throwable) {
			return new JSONResponse([
				'ok' => false,
				'error' => ['code' => 'not_found'],
				'message' => 'not_found',
			], Http::STATUS_NOT_FOUND);
		}
	}
}
