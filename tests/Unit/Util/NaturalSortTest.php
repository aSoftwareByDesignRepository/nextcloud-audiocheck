<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Util;

use OCA\AudioCheck\Util\NaturalSort;
use PHPUnit\Framework\TestCase;

/**
 * Parity corpus with mobile/audiocheck/src/__tests__/naturalSort.test.ts —
 * every case must produce the identical order on both platforms.
 */
final class NaturalSortTest extends TestCase
{
	public static function orderedFixtures(): array
	{
		// [input array in scrambled order, expected sorted order]
		return [
			'plain numbers' => [
				['10.mp3', '2.mp3', '1.mp3', '11.mp3', '20.mp3'],
				['1.mp3', '2.mp3', '10.mp3', '11.mp3', '20.mp3'],
			],
			'zero padding' => [
				['10.mp3', '01.mp3', '002.mp3', '1.mp3'],
				['1.mp3', '01.mp3', '002.mp3', '10.mp3'],
			],
			'prefixed chapters' => [
				['Kapitel 10', 'Kapitel 2', 'Kapitel 01'],
				['Kapitel 01', 'Kapitel 2', 'Kapitel 10'],
			],
			'cd discs' => [
				['CD10 - x', 'CD2 - x', 'CD1 - x'],
				['CD1 - x', 'CD2 - x', 'CD10 - x'],
			],
			'mixed text segments' => [
				['Teil 3b', 'Teil 10a', 'Teil 2a'],
				['Teil 2a', 'Teil 3b', 'Teil 10a'],
			],
			'letters sort after number compare' => [
				['1b', '10a', '1a'],
				['1a', '1b', '10a'],
			],
			'empty first' => [
				['b', '', 'a'],
				['', 'a', 'b'],
			],
			'equal values fewer zeros first' => [
				['01', '1', '001'],
				['1', '01', '001'],
			],
			'huge numeric runs' => [
				['x99999999999999999999', 'x100000000000000000000'],
				['x99999999999999999999', 'x100000000000000000000'],
			],
		];
	}

	/** @dataProvider orderedFixtures */
	public function testOrder(array $scrambled, array $expected): void
	{
		usort($scrambled, [NaturalSort::class, 'compare']);
		$this->assertSame($expected, $scrambled);
	}

	public function testNullAndIdentical(): void
	{
		$this->assertSame(0, NaturalSort::compare('a', 'a'));
		$this->assertSame(0, NaturalSort::compare(null, ''));
		$this->assertLessThan(0, NaturalSort::compare(null, 'a'));
	}

	public function testDeterministicOnCaseOnlyDiff(): void
	{
		// Same token stream → deterministic raw tie-break.
		$this->assertNotSame(0, NaturalSort::compare('Chapter 1', 'chapter 1'));
		$this->assertSame(
			NaturalSort::compare('Chapter 1', 'chapter 1'),
			-NaturalSort::compare('chapter 1', 'Chapter 1'),
		);
	}
}
