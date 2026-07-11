<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Service;

use OCP\AppFramework\Http;
use OCP\AppFramework\Http\ICallbackResponse;
use OCP\AppFramework\Http\IOutput;
use OCP\AppFramework\Http\Response;
use OCP\Files\File;

/**
 * HTTP Range-aware streaming response (AC-FA-6: fopen through abstraction).
 */
class RangeStreamResponse extends Response implements ICallbackResponse
{
	/** @var resource|null */
	private $stream;

	public function __construct(
		private File $file,
		/** @var resource */
		$stream,
		private int $fileSize,
		private string $mimeType,
		private string $etag,
		private ?array $range,
		private int $statusCode,
	) {
		$this->stream = $stream;
		parent::__construct($statusCode, $this->buildHeaders());
	}

	/** @return array<string, string> */
	private function buildHeaders(): array
	{
		$headers = [
			'Content-Type' => $this->mimeType,
			'Accept-Ranges' => 'bytes',
			'ETag' => '"' . $this->etag . '"',
			'Cache-Control' => 'private, max-age=0, must-revalidate',
			'Pragma' => 'no-cache',
			'X-Content-Type-Options' => 'nosniff',
		];

		if ($this->range !== null) {
			$start = $this->range['start'];
			$end = $this->range['end'];
			$length = $end - $start + 1;
			$headers['Content-Range'] = sprintf('bytes %d-%d/%d', $start, $end, $this->fileSize);
			$headers['Content-Length'] = (string)$length;
		} elseif ($this->statusCode === Http::STATUS_REQUEST_RANGE_NOT_SATISFIABLE) {
			$headers['Content-Range'] = sprintf('bytes */%d', $this->fileSize);
		} else {
			$headers['Content-Length'] = (string)$this->fileSize;
		}

		return $headers;
	}

	public function callback(IOutput $output): void
	{
		if (!is_resource($this->stream)) {
			$output->setHttpResponseCode(Http::STATUS_NOT_FOUND);
			return;
		}

		$output->setHttpResponseCode($this->statusCode);

		if ($this->range !== null) {
			$this->seekTo($this->range['start']);
			$remaining = $this->range['end'] - $this->range['start'] + 1;
			$this->streamChunked($output, $remaining);
		} else {
			$this->streamChunked($output, $this->fileSize);
		}

		fclose($this->stream);
		$this->stream = null;
	}

	private function seekTo(int $offset): void
	{
		if ($offset <= 0) {
			return;
		}
		if (@fseek($this->stream, $offset, SEEK_SET) === 0) {
			return;
		}
		// Non-seekable: read-and-discard
		$discarded = 0;
		while ($discarded < $offset) {
			$chunk = fread($this->stream, min(8192, $offset - $discarded));
			if ($chunk === false || $chunk === '') {
				break;
			}
			$discarded += strlen($chunk);
		}
	}

	private function streamChunked(IOutput $output, int $bytesToSend): void
	{
		$sent = 0;
		while ($sent < $bytesToSend) {
			$read = min(8192, $bytesToSend - $sent);
			$chunk = fread($this->stream, $read);
			if ($chunk === false || $chunk === '') {
				break;
			}
			echo $chunk;
			$sent += strlen($chunk);
		}
	}
}

class NotModifiedStreamResponse extends Response implements ICallbackResponse
{
	public function __construct(
		private string $etag,
		private string $mimeType,
	) {
		parent::__construct(Http::STATUS_NOT_MODIFIED, [
			'ETag' => '"' . $etag . '"',
			'Content-Type' => $mimeType,
			'Cache-Control' => 'private, max-age=0, must-revalidate',
		]);
	}

	public function callback(IOutput $output): void
	{
		$output->setHttpResponseCode(Http::STATUS_NOT_MODIFIED);
	}
}

class StreamResponseFactory
{
	public function __construct(
		private FileAccessService $fileAccess,
	) {
	}

	public function createFromFile(File $file, ?string $rangeHeader, ?string $ifNoneMatch, ?string $ifRange): RangeStreamResponse|NotModifiedStreamResponse
	{
		$fileSize = $file->getSize();
		if ($fileSize < 0) {
			$fileSize = 0;
		}
		$etag = $file->getEtag();
		$mime = $file->getMimeType() ?: 'application/octet-stream';

		if ($ifNoneMatch !== null && $this->etagMatches($ifNoneMatch, $etag) && ($ifRange === null || $this->etagMatches($ifRange, $etag))) {
			return new NotModifiedStreamResponse($etag, $mime);
		}

		$range = $rangeHeader !== null ? $this->parseRange($rangeHeader, $fileSize) : null;

		// RFC 7233 §3.2: an If-Range validator that no longer matches means the
		// client's stored partial is stale — ignore the Range and serve the full
		// file (200) so resumed downloads never splice bytes of two versions.
		if ($rangeHeader !== null && $ifRange !== null && !$this->etagMatches($ifRange, $etag)) {
			$range = null;
		}

		if ($range === false) {
			return new RangeStreamResponse($file, fopen('php://memory', 'rb'), $fileSize, $mime, $etag, null, Http::STATUS_REQUEST_RANGE_NOT_SATISFIABLE);
		}

		$stream = $this->fileAccess->openReadStream($file);
		$status = $range !== null ? Http::STATUS_PARTIAL_CONTENT : Http::STATUS_OK;

		return new RangeStreamResponse($file, $stream, $fileSize, $mime, $etag, $range, $status);
	}

	/**
	 * @return array{start:int,end:int}|null|false null = full file, false = unsatisfiable
	 */
	public function parseRange(string $header, int $fileSize): array|null|false
	{
		$header = trim($header);
		if (!str_starts_with(strtolower($header), 'bytes=')) {
			return null;
		}
		$spec = trim(substr($header, 6));
		// Reject multi-range
		if (str_contains($spec, ',')) {
			return false;
		}

		if (preg_match('/^(\d+)-(\d*)$/', $spec, $m)) {
			$start = (int)$m[1];
			$end = $m[2] !== '' ? (int)$m[2] : $fileSize - 1;
		} elseif (preg_match('/^-(\d+)$/', $spec, $m)) {
			$suffix = (int)$m[1];
			if ($suffix <= 0) {
				return false;
			}
			$start = max(0, $fileSize - $suffix);
			$end = $fileSize - 1;
		} else {
			return false;
		}

		if ($fileSize === 0) {
			return ($start === 0 && $end === 0) ? ['start' => 0, 'end' => 0] : false;
		}

		if ($start > $end || $start >= $fileSize) {
			return false;
		}
		$end = min($end, $fileSize - 1);

		return ['start' => $start, 'end' => $end];
	}

	private function etagMatches(string $header, string $etag): bool
	{
		$etag = trim($etag, '"');
		foreach (explode(',', $header) as $part) {
			$part = trim($part);
			if ($part === '*' || trim($part, '"') === $etag) {
				return true;
			}
		}
		return false;
	}
}
