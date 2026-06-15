<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Service;

use OCA\AudioCheck\AppInfo\Application;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Files\File;
use OCP\IDBConnection;
use Psr\Log\LoggerInterface;

/**
 * getID3 metadata extraction with stream/temp fallback. Failures are non-fatal.
 */
class MetadataService
{
	private const CHAPTER_JSON_MAX = 65536;

	public function __construct(
		private IDBConnection $db,
		private FileAccessService $fileAccess,
		private AccessControlService $accessControl,
		private ITimeFactory $timeFactory,
		private LoggerInterface $logger,
	) {
	}

	/**
	 * Extract and upsert metadata for a file. Returns meta row id.
	 *
	 * @param bool $force When true, re-extract even if etag/mtime/size appear unchanged (filesystem write events).
	 */
	public function analyzeFile(File $file, bool $force = false): int
	{
		$fileId = $file->getId();
		$etag = $file->getEtag();
		$mtime = (int)$file->getMTime();
		$size = (int)$file->getSize();
		$existing = $this->findMetaByFileId($fileId);
		if (!$force && $existing !== null && $this->isMetaFresh($existing, $etag, $mtime, $size)) {
			return (int)$existing['id'];
		}

		$data = $this->extractTags($file);
		$now = $this->timeFactory->getTime();

		if ($existing !== null) {
			$this->updateMeta((int)$existing['id'], $fileId, $etag, $mtime, $size, $file->getMimeType() ?: 'audio/mpeg', $data, $now);
			return (int)$existing['id'];
		}

		return $this->insertMeta($fileId, $etag, $mtime, $size, $file->getMimeType() ?: 'audio/mpeg', $data, $now);
	}

	/** @param array<string, mixed> $existing */
	private function isMetaFresh(array $existing, string $etag, int $mtime, int $size): bool
	{
		if ((string)$existing['etag'] !== $etag) {
			return false;
		}

		return (int)($existing['source_mtime'] ?? 0) === $mtime
			&& (int)($existing['source_size'] ?? 0) === $size;
	}

	/**
	 * @return array<string, mixed>
	 */
	public function extractTags(File $file): array
	{
		$fallbackTitle = pathinfo($file->getName(), PATHINFO_FILENAME);
		$defaults = [
			'kind' => $this->guessKind($file),
			'duration_ms' => 0,
			'bitrate' => 0,
			'title' => $fallbackTitle,
			'artist' => null,
			'album' => $this->albumFallback($file, $this->bound($fallbackTitle, 512)),
			'album_artist' => null,
			'genre' => null,
			'series' => null,
			'track_no' => null,
			'disc_no' => null,
			'release_year' => null,
			'has_chapters' => 0,
			'chapters_json' => null,
			'cover_state' => 'none',
			'meta_partial' => false,
		];

		$tempPath = null;
		try {
			$analyzePath = $this->resolveAnalyzePath($file, $tempPath);
			if ($analyzePath === null) {
				$defaults['meta_partial'] = true;
				return $defaults;
			}

			if (!class_exists(\getID3::class)) {
				return $defaults;
			}

			$getID3 = new \getID3();
			$getID3->option_tag_id3v2 = true;
			$getID3->option_tag_apetag = true;
			$getID3->option_extra_info = false;
			$info = $getID3->analyze($analyzePath);
			if (!is_array($info)) {
				return $defaults;
			}

			$duration = 0;
			if (isset($info['playtime_seconds']) && is_numeric($info['playtime_seconds'])) {
				$duration = (int)round((float)$info['playtime_seconds'] * 1000);
			}

			$tags = [];
			if (isset($info['tags']) && is_array($info['tags'])) {
				foreach (['id3v2', 'id3v1', 'quicktime', 'ape', 'vorbiscomment'] as $format) {
					if (isset($info['tags'][$format]) && is_array($info['tags'][$format])) {
						$tags = array_merge($tags, $info['tags'][$format]);
					}
				}
			}

			$title = $this->firstTag($tags, ['title', 'track']) ?? $fallbackTitle;
			$artist = $this->firstTag($tags, ['artist', 'albumartist', 'album_artist', 'author', 'performer']);
			$album = $this->firstTag($tags, ['album']);
			$albumArtist = $this->firstTag($tags, ['albumartist', 'album_artist', 'band']);
			$genre = $this->firstTag($tags, ['genre']);
			$series = $this->firstTag($tags, ['series', 'seriestitle', 'series_name', 'series-name', 'grouping', 'movementname']);
			$trackNo = $this->firstTagInt($tags, ['track_number', 'tracknumber', 'track']);
			$discNo = $this->firstTagInt($tags, ['disc_number', 'discnumber', 'part_of_set', 'disc']);
			$year = $this->firstTagInt($tags, ['year', 'date', 'recordingtime']);

			$kind = $this->guessKind($file, $duration, $tags);
			$chapters = $this->extractChapters($info, $duration);
			$hasEmbeddedCover = isset($info['comments']['picture'][0]) || isset($info['attached_picture'][0]);
			$boundTitle = $this->bound($title, 512);
			if ($album === null || trim($album) === '') {
				$album = $this->albumFallback($file, $boundTitle);
			}

			return [
				'kind' => $kind,
				'duration_ms' => $duration,
				'bitrate' => isset($info['audio']['bitrate']) ? (int)$info['audio']['bitrate'] : 0,
				'title' => $boundTitle,
				'artist' => $artist !== null ? $this->bound($artist, 512) : null,
				'album' => $this->bound($album, 512),
				'album_artist' => $albumArtist !== null ? $this->bound($albumArtist, 512) : null,
				'genre' => $genre !== null ? $this->bound($genre, 255) : null,
				'series' => $series !== null ? $this->bound($series, 512) : null,
				'track_no' => $trackNo,
				'disc_no' => $discNo,
				'release_year' => $year !== null && $year > 1900 && $year < 3000 ? $year : null,
				'has_chapters' => $chapters !== null ? 1 : 0,
				'chapters_json' => $chapters,
				'cover_state' => $hasEmbeddedCover ? 'embedded' : 'none',
				'meta_partial' => false,
			];
		} catch (\Throwable $e) {
			$this->logger->info('AudioCheck metadata extraction failed', [
				'fileId' => $file->getId(),
				'message' => $e->getMessage(),
			]);
			return $defaults;
		} finally {
			if ($tempPath !== null && is_file($tempPath)) {
				@unlink($tempPath);
			}
		}
	}

	/**
	 * @param array<string, mixed> $info
	 */
	private function extractChapters(array $info, int $durationMs): ?string
	{
		$chapters = [];
		if (isset($info['quicktime']['chapters']) && is_array($info['quicktime']['chapters'])) {
			foreach ($info['quicktime']['chapters'] as $i => $ch) {
				if (!is_array($ch)) {
					continue;
				}
				$start = isset($ch['time']) ? (int)round((float)$ch['time'] * 1000) : 0;
				$title = isset($ch['title']) ? (string)$ch['title'] : ('Chapter ' . ($i + 1));
				$chapters[] = ['start_ms' => $start, 'end_ms' => 0, 'title' => $this->bound($title, 255)];
			}
		}
		if ($chapters === []) {
			return null;
		}
		for ($i = 0; $i < count($chapters); $i++) {
			$nextStart = $chapters[$i + 1]['start_ms'] ?? $durationMs;
			$chapters[$i]['end_ms'] = max($chapters[$i]['start_ms'], $nextStart);
		}
		$json = json_encode($chapters, JSON_THROW_ON_ERROR);
		if (strlen($json) > self::CHAPTER_JSON_MAX) {
			return null;
		}
		return $json;
	}

	private function resolveAnalyzePath(File $file, ?string &$tempPath): ?string
	{
		$local = $this->fileAccess->getLocalFilePathIfAllowed($file);
		if ($local !== null) {
			return $local;
		}

		$maxBytes = $this->accessControl->getMaxMetaTempMb() * 1024 * 1024;
		$size = $file->getSize();
		if ($size > $maxBytes) {
			return null;
		}

		$tempPath = tempnam(sys_get_temp_dir(), 'ac_meta_');
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

	private function albumFallback(File $file, string $title): string
	{
		try {
			$parent = $file->getParent();
			if ($parent !== null) {
				$name = trim($parent->getName());
				if ($name !== '' && $name !== '.') {
					return $this->bound($name, 512);
				}
			}
		} catch (\Throwable $e) {
			// Non-fatal: fall back to title.
		}
		return $title;
	}

	private function guessKind(File $file, int $durationMs = 0, array $tags = []): string
	{
		$mime = strtolower($file->getMimeType() ?: '');
		$name = strtolower($file->getName());
		if (str_contains($mime, 'm4b') || str_ends_with($name, '.m4b')) {
			return 'audiobook';
		}
		if ($durationMs >= 20 * 60 * 1000) {
			return 'audiobook';
		}
		$genre = strtolower((string)($this->firstTag($tags, ['genre']) ?? ''));
		if (str_contains($genre, 'audiobook') || str_contains($genre, 'speech')) {
			return 'audiobook';
		}
		return 'music';
	}

	/** @param array<string, list<string>> $tags */
	private function firstTag(array $tags, array $keys): ?string
	{
		foreach ($keys as $key) {
			if (!isset($tags[$key])) {
				continue;
			}
			$val = $tags[$key];
			if (is_array($val)) {
				$val = $val[0] ?? null;
			}
			if (is_string($val) && trim($val) !== '') {
				return trim($val);
			}
		}
		return null;
	}

	/** @param array<string, list<string>> $tags */
	private function firstTagInt(array $tags, array $keys): ?int
	{
		$raw = $this->firstTag($tags, $keys);
		if ($raw === null) {
			return null;
		}
		if (preg_match('/^(\d+)/', $raw, $m)) {
			return (int)$m[1];
		}
		return is_numeric($raw) ? (int)$raw : null;
	}

	private function bound(string $value, int $max): string
	{
		if (mb_strlen($value) <= $max) {
			return $value;
		}
		return mb_substr($value, 0, $max);
	}

	/** @return array<string, mixed>|null */
	private function findMetaByFileId(int $fileId): ?array
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from('ac_file_meta')
			->where($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, \PDO::PARAM_INT)));
		$result = $qb->executeQuery();
		$row = $result->fetch();
		$result->closeCursor();
		return $row === false ? null : $row;
	}

	/** @param array<string, mixed> $data */
	private function insertMeta(int $fileId, string $etag, int $mtime, int $size, string $mime, array $data, int $now): int
	{
		$qb = $this->db->getQueryBuilder();
		$qb->insert('ac_file_meta')
			->values([
				'file_id' => $qb->createNamedParameter($fileId, \PDO::PARAM_INT),
				'etag' => $qb->createNamedParameter($etag),
				'source_mtime' => $qb->createNamedParameter($mtime, \PDO::PARAM_INT),
				'source_size' => $qb->createNamedParameter($size, \PDO::PARAM_INT),
				'mimetype' => $qb->createNamedParameter($mime),
				'kind' => $qb->createNamedParameter((string)$data['kind']),
				'duration_ms' => $qb->createNamedParameter((int)$data['duration_ms'], \PDO::PARAM_INT),
				'bitrate' => $qb->createNamedParameter((int)$data['bitrate'], \PDO::PARAM_INT),
				'title' => $qb->createNamedParameter($data['title']),
				'artist' => $qb->createNamedParameter($data['artist']),
				'album' => $qb->createNamedParameter($data['album']),
				'album_artist' => $qb->createNamedParameter($data['album_artist']),
				'genre' => $qb->createNamedParameter($data['genre']),
				'series' => $qb->createNamedParameter($data['series'] ?? null),
				'track_no' => $qb->createNamedParameter($data['track_no'], $data['track_no'] === null ? \PDO::PARAM_NULL : \PDO::PARAM_INT),
				'disc_no' => $qb->createNamedParameter($data['disc_no'], $data['disc_no'] === null ? \PDO::PARAM_NULL : \PDO::PARAM_INT),
				'release_year' => $qb->createNamedParameter($data['release_year'], $data['release_year'] === null ? \PDO::PARAM_NULL : \PDO::PARAM_INT),
				'has_chapters' => $qb->createNamedParameter((int)$data['has_chapters'], \PDO::PARAM_INT),
				'chapters_json' => $qb->createNamedParameter($data['chapters_json']),
				'cover_state' => $qb->createNamedParameter((string)$data['cover_state']),
				'analyzed_at' => $qb->createNamedParameter($now, \PDO::PARAM_INT),
			]);
		$qb->executeStatement();
		return (int)$this->db->lastInsertId('ac_file_meta');
	}

	/** @param array<string, mixed> $data */
	private function updateMeta(int $id, int $fileId, string $etag, int $mtime, int $size, string $mime, array $data, int $now): void
	{
		$qb = $this->db->getQueryBuilder();
		$qb->update('ac_file_meta')
			->set('etag', $qb->createNamedParameter($etag))
			->set('source_mtime', $qb->createNamedParameter($mtime, \PDO::PARAM_INT))
			->set('source_size', $qb->createNamedParameter($size, \PDO::PARAM_INT))
			->set('mimetype', $qb->createNamedParameter($mime))
			->set('kind', $qb->createNamedParameter((string)$data['kind']))
			->set('duration_ms', $qb->createNamedParameter((int)$data['duration_ms'], \PDO::PARAM_INT))
			->set('bitrate', $qb->createNamedParameter((int)$data['bitrate'], \PDO::PARAM_INT))
			->set('title', $qb->createNamedParameter($data['title']))
			->set('artist', $qb->createNamedParameter($data['artist']))
			->set('album', $qb->createNamedParameter($data['album']))
			->set('album_artist', $qb->createNamedParameter($data['album_artist']))
			->set('genre', $qb->createNamedParameter($data['genre']))
			->set('series', $qb->createNamedParameter($data['series'] ?? null))
			->set('track_no', $qb->createNamedParameter($data['track_no'], $data['track_no'] === null ? \PDO::PARAM_NULL : \PDO::PARAM_INT))
			->set('disc_no', $qb->createNamedParameter($data['disc_no'], $data['disc_no'] === null ? \PDO::PARAM_NULL : \PDO::PARAM_INT))
			->set('release_year', $qb->createNamedParameter($data['release_year'], $data['release_year'] === null ? \PDO::PARAM_NULL : \PDO::PARAM_INT))
			->set('has_chapters', $qb->createNamedParameter((int)$data['has_chapters'], \PDO::PARAM_INT))
			->set('chapters_json', $qb->createNamedParameter($data['chapters_json']))
			->set('cover_state', $qb->createNamedParameter((string)$data['cover_state']))
			->set('analyzed_at', $qb->createNamedParameter($now, \PDO::PARAM_INT))
			->where($qb->expr()->eq('id', $qb->createNamedParameter($id, \PDO::PARAM_INT)));
		$qb->executeStatement();
	}

	public function garbageCollectOrphans(): int
	{
		$qb = $this->db->getQueryBuilder();
		$qb->selectDistinct('file_id')->from('ac_tracks');
		$result = $qb->executeQuery();
		$fileIds = [];
		while ($row = $result->fetch()) {
			$fileIds[] = (int)$row['file_id'];
		}
		$result->closeCursor();

		$dq = $this->db->getQueryBuilder();
		if ($fileIds === []) {
			return $dq->delete('ac_file_meta')->executeStatement();
		}
		$dq->delete('ac_file_meta')
			->where($dq->expr()->notIn('file_id', $dq->createNamedParameter($fileIds, \OCP\DB\QueryBuilder\IQueryBuilder::PARAM_INT_ARRAY)));
		return $dq->executeStatement();
	}
}
