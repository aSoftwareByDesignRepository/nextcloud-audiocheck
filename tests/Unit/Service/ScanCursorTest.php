<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use OCA\AudioCheck\Service\ScanCursor;
use PHPUnit\Framework\TestCase;

final class ScanCursorTest extends TestCase
{
	private const EMPTY = ['scanGen' => 0, 'rootIdx' => 0, 'walkStack' => []];

	public function testRoundTripPreservesDeepWalkStack(): void
	{
		$cursor = [
			'scanGen' => 1_753_999_999,
			'rootIdx' => 2,
			'walkStack' => [
				['path' => '', 'offset' => 7],
				['path' => 'Autör Ünicode', 'offset' => 3],
				['path' => 'Autör Ünicode/Book Title', 'offset' => 1],
				['path' => 'Autör Ünicode/Book Title/CD 1', 'offset' => 0],
			],
		];

		$this->assertSame($cursor, ScanCursor::decode(ScanCursor::encode($cursor)));
	}

	public function testRoundTripWithSingleRootFrame(): void
	{
		$cursor = [
			'scanGen' => 42,
			'rootIdx' => 0,
			'walkStack' => [['path' => '', 'offset' => 250]],
		];

		$this->assertSame($cursor, ScanCursor::decode(ScanCursor::encode($cursor)));
	}

	public function testEmptyWalkStackRoundTrip(): void
	{
		$cursor = ['scanGen' => 5, 'rootIdx' => 1, 'walkStack' => []];
		$encoded = ScanCursor::encode($cursor);

		$this->assertStringNotContainsString('walk', $encoded);
		$this->assertSame($cursor, ScanCursor::decode($encoded));
	}

	public function testEncodedSizeStaysLinearForDeepTrees(): void
	{
		// The legacy format repeated every path prefix, growing quadratically
		// with depth and overflowing the varchar(4000) cursor column.
		$walkStack = [['path' => '', 'offset' => 9]];
		$path = '';
		for ($depth = 1; $depth <= 20; $depth++) {
			$path = $path === ''
				? str_repeat('x', 80) . $depth
				: $path . '/' . str_repeat('x', 80) . $depth;
			$walkStack[] = ['path' => $path, 'offset' => $depth];
		}
		$cursor = ['scanGen' => 1, 'rootIdx' => 0, 'walkStack' => $walkStack];

		$legacyLength = strlen(json_encode($cursor, JSON_THROW_ON_ERROR));
		$encoded = ScanCursor::encode($cursor);

		$this->assertGreaterThan(4000, $legacyLength);
		$this->assertLessThan(4000, strlen($encoded));
		$this->assertSame($cursor, ScanCursor::decode($encoded));
	}

	public function testDecodesLegacyVerboseFormatFromPreviousAppVersion(): void
	{
		$legacy = json_encode([
			'scanGen' => 99,
			'rootIdx' => 1,
			'walkStack' => [
				['path' => '', 'offset' => 4],
				['path' => 'Author/Book', 'offset' => 2],
			],
		], JSON_THROW_ON_ERROR);

		$this->assertSame([
			'scanGen' => 99,
			'rootIdx' => 1,
			'walkStack' => [
				['path' => '', 'offset' => 4],
				['path' => 'Author/Book', 'offset' => 2],
			],
		], ScanCursor::decode($legacy));
	}

	public function testDecodeToleratesMalformedInput(): void
	{
		$this->assertSame(self::EMPTY, ScanCursor::decode(null));
		$this->assertSame(self::EMPTY, ScanCursor::decode(''));
		$this->assertSame(self::EMPTY, ScanCursor::decode('{not json'));
		$this->assertSame(self::EMPTY, ScanCursor::decode('"just a string"'));
		$this->assertSame(self::EMPTY, ScanCursor::decode('42'));
	}

	public function testDecodeDropsWalkWhenOffsetsDoNotMatchPathDepth(): void
	{
		$corrupt = json_encode([
			'scanGen' => 7,
			'rootIdx' => 0,
			'walk' => ['path' => 'a/b/c', 'offsets' => [1, 2]],
		], JSON_THROW_ON_ERROR);

		// scanGen survives so generation pruning stays correct; the root is
		// simply re-walked (upserts are idempotent).
		$this->assertSame(
			['scanGen' => 7, 'rootIdx' => 0, 'walkStack' => []],
			ScanCursor::decode($corrupt),
		);
	}

	public function testDecodeClampsNegativeOffsetsAndRootIdx(): void
	{
		$raw = json_encode([
			'scanGen' => 3,
			'rootIdx' => -5,
			'walk' => ['path' => 'a', 'offsets' => [-2, -1]],
		], JSON_THROW_ON_ERROR);

		$this->assertSame([
			'scanGen' => 3,
			'rootIdx' => 0,
			'walkStack' => [
				['path' => '', 'offset' => 0],
				['path' => 'a', 'offset' => 0],
			],
		], ScanCursor::decode($raw));
	}

	public function testEncodeOmitsWalkWhenStackViolatesPrefixChain(): void
	{
		// Defensive: a stack the codec cannot reconstruct is not persisted —
		// resume restarts the current root instead of resuming somewhere wrong.
		$cursor = [
			'scanGen' => 11,
			'rootIdx' => 0,
			'walkStack' => [
				['path' => '', 'offset' => 1],
				['path' => 'unrelated/branch', 'offset' => 2],
			],
		];

		$encoded = ScanCursor::encode($cursor);
		$this->assertStringNotContainsString('"walk"', $encoded);
		$decoded = ScanCursor::decode($encoded);
		$this->assertSame(['scanGen' => 11, 'rootIdx' => 0, 'walkStack' => []], $decoded);
	}

	public function testDecodeRejectsNonNumericOffsets(): void
	{
		$raw = json_encode([
			'scanGen' => 8,
			'rootIdx' => 0,
			'walk' => ['path' => 'a', 'offsets' => [0, 'NaN']],
		], JSON_THROW_ON_ERROR);

		$this->assertSame(
			['scanGen' => 8, 'rootIdx' => 0, 'walkStack' => []],
			ScanCursor::decode($raw),
		);
	}
}
