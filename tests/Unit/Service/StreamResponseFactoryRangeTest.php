<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use OCA\AudioCheck\Service\StreamResponseFactory;
use PHPUnit\Framework\TestCase;

final class StreamResponseFactoryRangeTest extends TestCase
{
	private StreamResponseFactory $factory;

	protected function setUp(): void
	{
		$fileAccess = $this->createMock(\OCA\AudioCheck\Service\FileAccessService::class);
		$this->factory = new StreamResponseFactory($fileAccess);
	}

	public function testFullFileWhenNoRange(): void
	{
		$this->assertNull($this->factory->parseRange('', 1000));
	}

	public function testValidRange(): void
	{
		$this->assertSame(['start' => 0, 'end' => 99], $this->factory->parseRange('bytes=0-99', 1000));
	}

	public function testSuffixRange(): void
	{
		$this->assertSame(['start' => 900, 'end' => 999], $this->factory->parseRange('bytes=-100', 1000));
	}

	public function testUnsatisfiableRange(): void
	{
		$this->assertFalse($this->factory->parseRange('bytes=5-1', 1000));
		$this->assertFalse($this->factory->parseRange('bytes=2000-3000', 1000));
	}

	public function testRangeEndClampedToFileSize(): void
	{
		$this->assertSame(['start' => 0, 'end' => 999], $this->factory->parseRange('bytes=0-1500', 1000));
	}

	public function testSuffixZeroRejected(): void
	{
		$this->assertFalse($this->factory->parseRange('bytes=-0', 1000));
	}

	public function testMultiRangeRejected(): void
	{
		$this->assertFalse($this->factory->parseRange('bytes=0-1,2-3', 1000));
	}

	public function testNotModifiedWhenEtagMatches(): void
	{
		$fileAccess = $this->createMock(\OCA\AudioCheck\Service\FileAccessService::class);
		$factory = new StreamResponseFactory($fileAccess);
		$file = $this->createMock(\OCP\Files\File::class);
		$file->method('getSize')->willReturn(100);
		$file->method('getEtag')->willReturn('abc123');
		$file->method('getMimeType')->willReturn('audio/mpeg');

		$response = $factory->createFromFile($file, null, '"abc123"', null);
		$this->assertSame(\OCP\AppFramework\Http::STATUS_NOT_MODIFIED, $response->getStatus());
	}

	private function makeFactoryAndFile(): array
	{
		$fileAccess = $this->createMock(\OCA\AudioCheck\Service\FileAccessService::class);
		$fileAccess->method('openReadStream')->willReturn(fopen('php://memory', 'rb'));
		$factory = new StreamResponseFactory($fileAccess);
		$file = $this->createMock(\OCP\Files\File::class);
		$file->method('getSize')->willReturn(1000);
		$file->method('getEtag')->willReturn('abc123');
		$file->method('getMimeType')->willReturn('audio/mpeg');
		return [$factory, $file];
	}

	public function testIfRangeMismatchIgnoresRangeAndServesFullFile(): void
	{
		[$factory, $file] = $this->makeFactoryAndFile();

		$response = $factory->createFromFile($file, 'bytes=500-', null, '"stale-etag"');
		$this->assertSame(\OCP\AppFramework\Http::STATUS_OK, $response->getStatus());
		$headers = $response->getHeaders();
		$this->assertArrayNotHasKey('Content-Range', $headers);
		$this->assertSame('1000', $headers['Content-Length']);
	}

	public function testIfRangeMatchServesRequestedRange(): void
	{
		[$factory, $file] = $this->makeFactoryAndFile();

		$response = $factory->createFromFile($file, 'bytes=500-', null, '"abc123"');
		$this->assertSame(\OCP\AppFramework\Http::STATUS_PARTIAL_CONTENT, $response->getStatus());
		$this->assertSame('bytes 500-999/1000', $response->getHeaders()['Content-Range']);
	}

	public function testIfRangeMismatchOnUnsatisfiableRangeServesFullFile(): void
	{
		// Resume offset past EOF after the file changed — must restart cleanly, not 416.
		[$factory, $file] = $this->makeFactoryAndFile();

		$response = $factory->createFromFile($file, 'bytes=2000-', null, '"stale-etag"');
		$this->assertSame(\OCP\AppFramework\Http::STATUS_OK, $response->getStatus());
	}
}
