<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Util;

/**
 * Natural ("human") ordering for titles and file names: numeric runs compare by
 * value ("1" < "2" < "10"), everything else compares case-insensitively with
 * the same normalization as {@see SearchTextNormalizer} (accents fold, ß→ss).
 *
 * Mirrors mobile/audiocheck/src/utils/naturalSort.ts — the parity corpus in
 * tests/Unit/Util/NaturalSortTest.php and src/__tests__/naturalSort.test.ts must
 * stay identical so server and companion never disagree on order.
 *
 * Rules:
 *  - numeric runs: ASCII digits only; compare by numeric value; equal values
 *    tie-break on fewer leading zeros ("1" < "01"), then run length.
 *  - >18-digit runs compare as digit strings to avoid integer overflow.
 *  - empty string sorts before non-empty; identical keys tie-break on the
 *    raw (un-normalized) input so ordering is deterministic.
 */
final class NaturalSort
{
	public static function compare(?string $a, ?string $b): int
	{
		$a = $a ?? '';
		$b = $b ?? '';
		if ($a === $b) {
			return 0;
		}
		$ta = self::tokens($a);
		$tb = self::tokens($b);
		$count = max(count($ta), count($tb));
		for ($i = 0; $i < $count; $i++) {
			if (!array_key_exists($i, $ta)) {
				return -1;
			}
			if (!array_key_exists($i, $tb)) {
				return 1;
			}
			$cmp = self::compareToken($ta[$i], $tb[$i]);
			if ($cmp !== 0) {
				return $cmp;
			}
		}
		// Identical token streams (e.g. case-only difference) — deterministic.
		return strcmp($a, $b);
	}

	/**
	 * Split into alternating text/number runs.
	 * @return list<array{num:bool,value:string}>
	 */
	private static function tokens(string $input): array
	{
		$norm = SearchTextNormalizer::normalize($input) ?? '';
		if ($norm === '') {
			return [['num' => false, 'value' => '']];
		}
		if (!preg_match_all('/\d+|\D+/', $norm, $m)) {
			return [['num' => false, 'value' => $norm]];
		}
		$tokens = [];
		foreach ($m[0] as $piece) {
			$tokens[] = ['num' => ctype_digit($piece), 'value' => $piece];
		}
		return $tokens;
	}

	/** @param array{num:bool,value:string} $a @param array{num:bool,value:string} $b */
	private static function compareToken(array $a, array $b): int
	{
		if ($a['num'] && $b['num']) {
			// Strip leading zeros for value compare; huge runs stay string-compared.
			$an = ltrim($a['value'], '0');
			$bn = ltrim($b['value'], '0');
			$an = $an === '' ? '0' : $an;
			$bn = $bn === '' ? '0' : $bn;
			if (strlen($an) !== strlen($bn)) {
				return strlen($an) < strlen($bn) ? -1 : 1;
			}
			$cmp = strcmp($an, $bn);
			if ($cmp !== 0) {
				return $cmp;
			}
			// Same value — fewer leading zeros first ("1" < "01" < "001").
			$len = strlen($a['value']) <=> strlen($b['value']);
			if ($len !== 0) {
				return $len;
			}
			return strcmp($a['value'], $b['value']);
		}
		return strcmp($a['value'], $b['value']);
	}
}
