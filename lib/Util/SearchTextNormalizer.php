<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Util;

/**
 * Shared text normalization for library search.
 *
 * Mirrors the mobile client's {@see mobile/audiocheck/src/search/textMatch.ts} so
 * online SQL search and offline filtering behave identically: accent/diacritic
 * insensitive, lowercase, punctuation tolerant, German sharp-s friendly.
 */
final class SearchTextNormalizer
{
	/** @return list<string> */
	public static function tokenize(?string $query, int $maxTokens = 8): array
	{
		$normalized = self::normalize($query);
		if ($normalized === null) {
			return [];
		}
		$parts = preg_split('/ +/', $normalized, -1, PREG_SPLIT_NO_EMPTY);
		if ($parts === false || $parts === []) {
			return [];
		}
		$tokens = array_values(array_unique($parts));

		return array_slice($tokens, 0, max(1, $maxTokens));
	}

	public static function normalize(?string $value): ?string
	{
		if ($value === null) {
			return null;
		}
		$trimmed = trim($value);
		if ($trimmed === '') {
			return null;
		}

		if (class_exists(\Normalizer::class)) {
			$decomposed = \Normalizer::normalize($trimmed, \Normalizer::FORM_D);
			if (is_string($decomposed)) {
				$trimmed = $decomposed;
			}
		}

		$stripped = preg_replace('/\p{M}/u', '', $trimmed);
		if (!is_string($stripped)) {
			return null;
		}

		$stripped = str_replace('ß', 'ss', $stripped);
		$lower = mb_strtolower($stripped, 'UTF-8');
		$collapsed = preg_replace('/[^\p{L}\p{N}]+/u', ' ', $lower);
		if (!is_string($collapsed)) {
			return null;
		}

		$result = trim($collapsed);

		return $result === '' ? null : $result;
	}
}
