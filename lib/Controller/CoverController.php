<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Controller;

use OCA\AudioCheck\Exception\AccessDeniedException;
use OCA\AudioCheck\Exception\NotAuthenticatedException;
use OCA\AudioCheck\Exception\NotFoundException;
use OCA\AudioCheck\Exception\RateLimitExceededException;
use OCA\AudioCheck\Service\AccessControlService;
use OCA\AudioCheck\Service\CoverService;
use OCA\AudioCheck\Service\RateLimitService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;

class CoverController extends Controller
{
	public function __construct(
		string $appName,
		IRequest $request,
		private AccessControlService $access,
		private CoverService $cover,
		private RateLimitService $rateLimit,
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function get(int $fileId)
	{
		try {
			$userId = $this->access->currentUserId();
			// Cover extraction can be CPU/temp heavy on cache miss — bound per user.
			$this->rateLimit->assertAllowed($userId, 'cover', 120, 60);
			return $this->cover->getCoverResponse($userId, $fileId);
		} catch (RateLimitExceededException) {
			return new JSONResponse([
				'ok' => false,
				'error' => ['code' => 'rate_limit_exceeded'],
				'message' => 'rate_limit_exceeded',
			], Http::STATUS_TOO_MANY_REQUESTS);
		} catch (NotFoundException|NotAuthenticatedException|AccessDeniedException) {
			// Uniform 404 on all access failures (AC-TST-09).
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
