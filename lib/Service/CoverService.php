<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Service;

use OCA\AudioCheck\AppInfo\Application;
use OCA\AudioCheck\Exception\NotFoundException;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\DataDisplayResponse;
use OCP\Files\File;
use OCP\Files\IAppData;
use OCP\Files\NotFoundException as FilesNotFoundException;
use OCP\Files\SimpleFS\ISimpleFolder;
use OCP\IDBConnection;
use Psr\Log\LoggerInterface;

class CoverService
{
	public function __construct(
		private IAppData $appData,
		private FileAccessService $fileAccess,
		private MetadataService $metadata,
		private IDBConnection $db,
		private LoggerInterface $logger,
	) {
	}

	public function getCoverResponse(string $userId, int $fileId): DataDisplayResponse
	{
		$file = $this->fileAccess->resolveReadableFile($userId, $fileId);
		$etag = $file->getEtag();
		$cacheKey = $this->coverCacheKey($fileId, $file);

		$cached = $this->readCache($cacheKey);
		if ($cached !== null) {
			return $this->imageResponse($cached['data'], $cached['mime'], $etag);
		}

		$image = $this->extractCover($file);
		if ($image === null) {
			return $this->defaultPlaceholder();
		}

		$this->writeCache($cacheKey, $image['data'], $image['mime']);
		$this->updateCoverState($fileId, $image['source']);

		return $this->imageResponse($image['data'], $image['mime'], $etag);
	}

	/** @return array{data:string,mime:string,source:string}|null */
	private function extractCover(File $audioFile): ?array
	{
		$tags = $this->metadata->extractTags($audioFile);
		if (($tags['cover_state'] ?? 'none') === 'embedded') {
			$embedded = $this->extractEmbeddedFromFile($audioFile);
			if ($embedded !== null) {
				return ['data' => $embedded['data'], 'mime' => $embedded['mime'], 'source' => 'embedded'];
			}
		}

		$folderCover = null;
		$parent = $audioFile->getParent();
		if ($parent !== null) {
			foreach (['cover.jpg', 'folder.jpg', 'front.png', 'cover.png'] as $name) {
				if ($parent->nodeExists($name)) {
					$node = $parent->get($name);
					if ($node instanceof File && $node->isReadable()) {
						$folderCover = $node;
						break;
					}
				}
			}
		}
		if ($folderCover instanceof File) {
			$data = $folderCover->getContent();
			if ($data !== '' && $this->fileAccess->isAllowedCoverMime($folderCover->getMimeType())) {
				return ['data' => $data, 'mime' => $folderCover->getMimeType(), 'source' => 'folder'];
			}
		}

		return null;
	}

	/** @return array{data:string,mime:string}|null */
	private function extractEmbeddedFromFile(File $file): ?array
	{
		$tempPath = null;
		try {
			$path = $this->resolveTempPath($file, $tempPath);
			if ($path === null || !class_exists(\getID3::class)) {
				return null;
			}
			$getID3 = new \getID3();
			$info = $getID3->analyze($path);
			$picture = $info['comments']['picture'][0] ?? $info['attached_picture'][0] ?? null;
			if (!is_array($picture) || empty($picture['data'])) {
				return null;
			}
			$mime = (string)($picture['image_mime'] ?? 'image/jpeg');
			if (!$this->fileAccess->isAllowedCoverMime($mime)) {
				return null;
			}
			return ['data' => $picture['data'], 'mime' => $mime];
		} catch (\Throwable $e) {
			$this->logger->info('Cover extraction failed', ['fileId' => $file->getId()]);
			return null;
		} finally {
			if ($tempPath !== null && is_file($tempPath)) {
				@unlink($tempPath);
			}
		}
	}

	private function resolveTempPath(File $file, ?string &$tempPath): ?string
	{
		$local = $this->fileAccess->getLocalFilePathIfAllowed($file);
		if ($local !== null) {
			return $local;
		}
		$tempPath = tempnam(sys_get_temp_dir(), 'ac_cover_');
		if ($tempPath === false) {
			return null;
		}
		chmod($tempPath, 0600);
		$in = $this->fileAccess->openReadStream($file);
		$out = fopen($tempPath, 'wb');
		if ($out === false) {
			fclose($in);
			return null;
		}
		stream_copy_to_stream($in, $out);
		fclose($in);
		fclose($out);
		return $tempPath;
	}

	/** @return array{data:string,mime:string}|null */
	private function readCache(string $cacheKey): ?array
	{
		try {
			$folder = $this->getCoversFolder();
			if (!$folder->fileExists($cacheKey)) {
				return null;
			}
			$node = $folder->getFile($cacheKey);
			$metaRaw = $node->getContent();
			$meta = json_decode($metaRaw, true);
			if (!is_array($meta) || !isset($meta['mime'])) {
				return null;
			}
			$dataFile = $cacheKey . '.bin';
			if (!$folder->fileExists($dataFile)) {
				return null;
			}
			return ['data' => $folder->getFile($dataFile)->getContent(), 'mime' => (string)$meta['mime']];
		} catch (\Throwable) {
			return null;
		}
	}

	private function writeCache(string $cacheKey, string $data, string $mime): void
	{
		try {
			$folder = $this->getCoversFolder();
			if ($folder->fileExists($cacheKey)) {
				$folder->getFile($cacheKey)->delete();
			}
			if ($folder->fileExists($cacheKey . '.bin')) {
				$folder->getFile($cacheKey . '.bin')->delete();
			}
			$folder->newFile($cacheKey, json_encode(['mime' => $mime], JSON_THROW_ON_ERROR));
			$folder->newFile($cacheKey . '.bin', $data);
		} catch (\Throwable $e) {
			$this->logger->info('Cover cache write failed', ['message' => $e->getMessage()]);
		}
	}

	private function getCoversFolder(): ISimpleFolder
	{
		try {
			return $this->appData->getFolder('covers');
		} catch (FilesNotFoundException) {
			return $this->appData->newFolder('covers');
		}
	}

	private function updateCoverState(int $fileId, string $source): void
	{
		$qb = $this->db->getQueryBuilder();
		$qb->update('ac_file_meta')
			->set('cover_state', $qb->createNamedParameter($source))
			->where($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, \PDO::PARAM_INT)));
		$qb->executeStatement();
	}

	private function coverCacheKey(int $fileId, File $file): string
	{
		$revision = $file->getEtag() . ':' . $file->getMTime() . ':' . $file->getSize();

		return $fileId . '_' . preg_replace('/[^a-zA-Z0-9_-]/', '_', $revision);
	}

	private function imageResponse(string $data, string $mime, string $etag): DataDisplayResponse
	{
		$response = new DataDisplayResponse($data, Http::STATUS_OK, [
			'Content-Type' => $mime,
			'ETag' => '"' . $etag . '"',
			'Cache-Control' => 'private, max-age=0, must-revalidate',
			'Pragma' => 'no-cache',
			'X-Content-Type-Options' => 'nosniff',
		]);
		return $response;
	}

	private function defaultPlaceholder(): DataDisplayResponse
	{
		$svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" role="img" aria-hidden="true">'
			. '<rect width="200" height="200" fill="#e5e5e5"/>'
			. '<circle cx="100" cy="80" r="30" fill="#999"/>'
			. '<rect x="60" y="120" width="80" height="12" rx="6" fill="#999"/>'
			. '</svg>';
		return new DataDisplayResponse($svg, Http::STATUS_OK, [
			'Content-Type' => 'image/svg+xml',
			'Cache-Control' => 'private, max-age=0, must-revalidate',
			'Pragma' => 'no-cache',
			'X-Content-Type-Options' => 'nosniff',
		]);
	}

	public function purgeCache(): void
	{
		try {
			$this->appData->getFolder('covers')->delete();
		} catch (\Throwable) {
			// folder may not exist
		}
	}
}
