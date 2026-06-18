<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Service;

use OCA\AudioCheck\Exception\NotFoundException;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use OCP\Files\NotFoundException as FilesNotFoundException;
use OCP\IConfig;
use OCP\Encryption\IManager as IEncryptionManager;

/**
 * AC-FA-1: The only door to file content. All getUserFolder/getById/fopen
 * calls for content access must live in this class.
 */
class FileAccessService
{
	/** @var list<string> */
	public const ALLOWED_AUDIO_MIMES = [
		'audio/mpeg',
		'audio/mp4',
		'audio/x-m4a',
		'audio/m4a',
		'audio/m4b',
		'audio/x-m4b',
		'audio/flac',
		'audio/ogg',
		'audio/vorbis',
		'audio/opus',
		'audio/wav',
		'audio/x-wav',
		'audio/aac',
		'audio/aiff',
		'audio/x-aiff',
		'audio/webm',
		'audio/x-ms-wma',
	];

	/** @var list<string> File extensions scanned when MIME detection is incomplete (includes MP4 podcasts tagged as video/mp4). */
	public const AUDIO_CONTAINER_EXTENSIONS = [
		'mp3',
		'mp4',
		'm4a',
		'm4b',
		'flac',
		'ogg',
		'opus',
		'wav',
		'aac',
		'wma',
		'aiff',
	];

	/**
	 * Mimes commonly playable in modern desktop/mobile browsers without transcoding.
	 * Other allowed audio types may still stream but are labelled in the UI (§13.7).
	 *
	 * @var list<string>
	 */
	public const BROWSER_WELL_SUPPORTED_MIMES = [
		'audio/mpeg',
		'audio/mp4',
		'audio/x-m4a',
		'audio/m4a',
		'audio/m4b',
		'audio/x-m4b',
		'audio/ogg',
		'audio/vorbis',
		'audio/opus',
		'audio/wav',
		'audio/x-wav',
		'audio/aac',
		'audio/webm',
	];

	/** @var list<string> */
	public const COVER_IMAGE_MIMES = [
		'image/jpeg',
		'image/png',
		'image/webp',
		'image/gif',
	];

	/** @var list<string> */
	private const COVER_FILENAMES = ['cover.jpg', 'folder.jpg', 'front.png', 'cover.png', 'folder.png'];

	public function __construct(
		private IRootFolder $rootFolder,
		private IEncryptionManager $encryptionManager,
		private IConfig $config,
	) {
	}

	/**
	 * Resolve a readable audio file for the requesting user. Throws NotFoundException on any failure.
	 */
	public function resolveReadableFile(string $userId, int $fileId, bool $requireAudioMime = true): File
	{
		if ($userId === '' || $fileId < 1) {
			throw new NotFoundException();
		}

		$folder = $this->rootFolder->getUserFolder($userId);
		$nodes = $folder->getById($fileId);
		$file = $this->pickReadableFile($nodes);
		if ($file === null) {
			throw new NotFoundException();
		}

		if (!$file->isReadable()) {
			throw new NotFoundException();
		}

		if ($requireAudioMime && !$this->isAllowedAudioMime($file->getMimeType(), $file->getName())) {
			throw new NotFoundException();
		}

		return $file;
	}

	/**
	 * Resolve a readable folder for the user (library roots).
	 */
	public function resolveReadableFolder(string $userId, int $fileId): Folder
	{
		if ($userId === '' || $fileId < 1) {
			throw new NotFoundException();
		}
		$folder = $this->rootFolder->getUserFolder($userId);
		$nodes = $folder->getById($fileId);
		foreach ($nodes as $node) {
			if ($node instanceof Folder && $node->isReadable()) {
				return $node;
			}
		}
		throw new NotFoundException();
	}

	/**
	 * Resolve a readable library folder from a user-relative path (e.g. /Audiobooks).
	 *
	 * @throws NotFoundException
	 * @throws \OCA\AudioCheck\Exception\ValidationException
	 */
	public function resolveReadableFolderByRelativePath(string $userId, string $path): Folder
	{
		$relative = $this->normalizeLibraryFolderPath($userId, $path);
		$folder = $this->getFolderByRelativePath($userId, $relative);
		if ($folder === null || !$folder->isReadable()) {
			throw new NotFoundException();
		}
		return $folder;
	}

	/**
	 * Normalize a folder path from the file picker to a user-relative library path.
	 *
	 * @throws \OCA\AudioCheck\Exception\ValidationException
	 */
	public function normalizeLibraryFolderPath(string $userId, string $path): string
	{
		$path = trim(str_replace('\\', '/', $path));
		if ($path === '') {
			throw new \OCA\AudioCheck\Exception\ValidationException('A valid folder is required.');
		}
		if (str_contains($path, '..')) {
			throw new \OCA\AudioCheck\Exception\ValidationException('Invalid folder path.');
		}

		$home = $this->getUserHomePath($userId);
		if ($home !== '' && str_starts_with($path, $home)) {
			$path = substr($path, strlen($home)) ?: '/';
		}

		$filesMarker = '/' . $userId . '/files';
		$pos = stripos($path, $filesMarker);
		if ($pos !== false) {
			$path = substr($path, $pos + strlen($filesMarker)) ?: '/';
		}

		$davMarker = '/remote.php/dav/files/' . $userId;
		if (str_starts_with($path, $davMarker)) {
			$path = substr($path, strlen($davMarker)) ?: '/';
		}

		$path = '/' . trim($path, '/');
		if ($path === '/') {
			throw new \OCA\AudioCheck\Exception\ValidationException('Select a folder inside your Files, not your entire home.');
		}

		return $path;
	}

	/**
	 * Check whether a file is accessible without throwing (for listing validation).
	 */
	public function isFileAccessible(string $userId, int $fileId): bool
	{
		try {
			$this->resolveReadableFile($userId, $fileId);
			return true;
		} catch (NotFoundException) {
			return false;
		}
	}

	/**
	 * Open a read stream for content access. Caller must fclose in finally.
	 *
	 * @return resource
	 */
	public function openReadStream(File $file)
	{
		$stream = $file->fopen('rb');
		if ($stream === false) {
			throw new NotFoundException();
		}
		return $stream;
	}

	/**
	 * Whether getLocalFile fast-path is permitted (local + unencrypted).
	 */
	public function mayUseLocalFilePath(File $file): bool
	{
		if ($this->encryptionManager->isEnabled()) {
			return false;
		}
		$storage = $file->getStorage();
		if ($storage === null) {
			return false;
		}
		return $storage->instanceOfStorage(\OC\Files\Storage\Local::class);
	}

	/**
	 * Get local path only when AC-FA-6 permits it; otherwise null.
	 */
	public function getLocalFilePathIfAllowed(File $file): ?string
	{
		if (!$this->mayUseLocalFilePath($file)) {
			return null;
		}
		try {
			$path = $file->getStorage()->getLocalFile($file->getInternalPath());
			return is_string($path) && $path !== '' && is_readable($path) ? $path : null;
		} catch (\Throwable) {
			return null;
		}
	}

	/**
	 * Find a folder cover image sibling inside the user's folder view.
	 */
	public function resolveFolderCoverFile(string $userId, File $audioFile): ?File
	{
		$parent = $audioFile->getParent();
		if (!($parent instanceof Folder)) {
			return null;
		}
		foreach (self::COVER_FILENAMES as $name) {
			if (!$parent->nodeExists($name)) {
				continue;
			}
			$node = $parent->get($name);
			if ($node instanceof File && $node->isReadable() && $this->isAllowedCoverMime($node->getMimeType())) {
				return $node;
			}
		}
		return null;
	}

	public function getUserFolder(string $userId): Folder
	{
		return $this->rootFolder->getUserFolder($userId);
	}

	public function getUserHomePath(string $userId): string
	{
		return $this->getUserFolder($userId)->getPath();
	}

	/**
	 * Resolve a folder by path relative to the user's home (scan/display only).
	 */
	public function getFolderByRelativePath(string $userId, string $path): ?Folder
	{
		$userFolder = $this->getUserFolder($userId);
		try {
			$node = $path === '/' || $path === '' ? $userFolder : $userFolder->get(ltrim($path, '/'));
			return $node instanceof Folder ? $node : null;
		} catch (\Throwable) {
			return null;
		}
	}

	public function isAllowedAudioMime(string $mime, ?string $filename = null): bool
	{
		$mime = strtolower(trim($mime));
		if (in_array($mime, self::ALLOWED_AUDIO_MIMES, true)) {
			return true;
		}
		if ($mime === 'video/mp4' && $this->isAudioContainerFilename($filename)) {
			return true;
		}
		return str_starts_with($mime, 'audio/');
	}

	public function isAllowedAudioFile(File $file): bool
	{
		return $this->isAllowedAudioMime($file->getMimeType(), $file->getName());
	}

	private function isAudioContainerFilename(?string $filename): bool
	{
		if ($filename === null || $filename === '') {
			return false;
		}
		$ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
		return in_array($ext, ['mp4', 'm4a', 'm4b'], true);
	}

	public function isAllowedCoverMime(string $mime): bool
	{
		return in_array(strtolower(trim($mime)), self::COVER_IMAGE_MIMES, true);
	}

	public function isLikelyBrowserPlayable(string $mime, ?string $filename = null): bool
	{
		$mime = strtolower(trim($mime));
		if (in_array($mime, self::BROWSER_WELL_SUPPORTED_MIMES, true)) {
			return true;
		}
		if ($mime === 'video/mp4' && ($filename === null || $this->isAudioContainerFilename($filename))) {
			return true;
		}
		return false;
	}

	/**
	 * List readable audio files inside a folder the caller already resolved via resolveReadableFolder.
	 *
	 * @return list<File>
	 */
	public function listAudioFilesInFolder(Folder $folder, bool $recursive = false): array
	{
		$files = [];
		if ($recursive) {
			$seen = [];
			try {
				foreach ($folder->searchByMime('audio/%') as $node) {
					if ($node instanceof File && $node->isReadable() && $this->isAllowedAudioFile($node)) {
						$seen[$node->getId()] = true;
						$files[] = $node;
					}
				}
			} catch (\Throwable) {
				$files = [];
				$seen = [];
			}
			foreach (self::AUDIO_CONTAINER_EXTENSIONS as $ext) {
				try {
					foreach ($folder->searchRaw('*.{' . $ext . '}') as $node) {
						if ($node instanceof File && $node->isReadable() && $this->isAllowedAudioFile($node)) {
							$id = $node->getId();
							if (!isset($seen[$id])) {
								$seen[$id] = true;
								$files[] = $node;
							}
						}
					}
				} catch (\Throwable) {
					continue;
				}
			}
			if ($files === []) {
				$files = $this->collectAudioFilesRecursive($folder);
			}
		} else {
			foreach ($folder->getDirectoryListing() as $node) {
				if ($node instanceof File && $node->isReadable() && $this->isAllowedAudioFile($node)) {
					$files[] = $node;
				}
			}
		}

		usort($files, static fn (File $a, File $b): int => strnatcasecmp($a->getName(), $b->getName()));
		return $files;
	}

	/** @return list<File> */
	private function collectAudioFilesRecursive(Folder $folder): array
	{
		$files = [];
		foreach ($folder->getDirectoryListing() as $node) {
			if ($node instanceof File && $node->isReadable() && $this->isAllowedAudioFile($node)) {
				$files[] = $node;
				continue;
			}
			if ($node instanceof Folder && $node->isReadable()) {
				foreach ($this->collectAudioFilesRecursive($node) as $child) {
					$files[] = $child;
				}
			}
		}
		return $files;
	}

	/**
	 * @param list<\OCP\Files\Node> $nodes
	 */
	private function pickReadableFile(array $nodes): ?File
	{
		foreach ($nodes as $node) {
			if ($node instanceof File && $node->isReadable()) {
				return $node;
			}
		}
		return null;
	}
}
