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
}
