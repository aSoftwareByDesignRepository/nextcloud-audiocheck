<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Controller;

use OCA\AudioCheck\Exception\AccessDeniedException;
use OCA\AudioCheck\Exception\NotAuthenticatedException;
use OCA\AudioCheck\Exception\NotFoundException;
use OCA\AudioCheck\Service\AccessControlService;
use OCA\AudioCheck\Service\CoverService;
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
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function get(int $fileId)
	{
		try {
			$userId = $this->access->currentUserId();
			return $this->cover->getCoverResponse($userId, $fileId);
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
