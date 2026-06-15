<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Controller;

use OCA\AudioCheck\Exception\NotFoundException;
use OCA\AudioCheck\Service\AccessControlService;
use OCA\AudioCheck\Service\FileAccessService;
use OCA\AudioCheck\Service\StreamResponseFactory;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\IRequest;

class StreamController extends Controller
{
	public function __construct(
		string $appName,
		IRequest $request,
		private AccessControlService $access,
		private FileAccessService $fileAccess,
		private StreamResponseFactory $streamFactory,
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function play(int $fileId)
	{
		try {
			$userId = $this->access->currentUserId();
			$file = $this->fileAccess->resolveReadableFile($userId, $fileId);
			return $this->streamFactory->createFromFile(
				$file,
				$this->request->getHeader('Range') ?: null,
				$this->request->getHeader('If-None-Match') ?: null,
				$this->request->getHeader('If-Range') ?: null,
			);
		} catch (NotFoundException) {
			return new \OCP\AppFramework\Http\JSONResponse([
				'ok' => false,
				'error' => ['code' => 'not_found'],
				'message' => 'not_found',
			], Http::STATUS_NOT_FOUND);
		} catch (\Throwable) {
			return new \OCP\AppFramework\Http\JSONResponse([
				'ok' => false,
				'error' => ['code' => 'not_found'],
				'message' => 'not_found',
			], Http::STATUS_NOT_FOUND);
		}
	}
}
