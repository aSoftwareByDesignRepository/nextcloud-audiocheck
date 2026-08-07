<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Service;

/**
 * Serializes the resumable scan position (ac_scan_state.cursor, varchar 4000).
 *
 * The depth-first walk stack is an invariant prefix chain: frame 0 is the
 * library root ('') and every deeper frame appends exactly one folder name.
 * Persisting every frame path repeats each prefix, so the stored size grows
 * quadratically with tree depth and can overflow the 4000-char column on
 * deeply nested libraries. The compact format stores the deepest path once
 * plus one offset per frame, so size stays linear in the path length —
 * bounded well below 4000 because Nextcloud caps file paths at 4000 bytes.
 *
 * decode() also accepts the legacy verbose format ({"walkStack":[...]}) so
 * scans that were mid-flight during an app upgrade resume without loss.
 */
final class ScanCursor
{
	/** @var array{scanGen:int,rootIdx:int,walkStack:list<array{path:string,offset:int}>} */
	private const EMPTY = ['scanGen' => 0, 'rootIdx' => 0, 'walkStack' => []];

	private function __construct()
	{
	}

	/**
	 * @param array{scanGen:int,rootIdx:int,walkStack:list<array{path:string,offset:int}>} $cursor
	 * @throws \JsonException
	 */
	public static function encode(array $cursor): string
	{
		$payload = [
			'scanGen' => (int)($cursor['scanGen'] ?? 0),
			'rootIdx' => max(0, (int)($cursor['rootIdx'] ?? 0)),
		];
		$walkStack = is_array($cursor['walkStack'] ?? null) ? $cursor['walkStack'] : [];
		$compact = self::compactWalkStack($walkStack);
		if ($compact !== null) {
			$payload['walk'] = $compact;
		}

		return json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
	}

	/**
	 * Never throws: a malformed or truncated cursor degrades to a fresh walk
	 * of the current root (upserts are idempotent, generation pruning is safe).
	 *
	 * @return array{scanGen:int,rootIdx:int,walkStack:list<array{path:string,offset:int}>}
	 */
	public static function decode(?string $raw): array
	{
		if ($raw === null || $raw === '') {
			return self::EMPTY;
		}
		try {
			$data = json_decode($raw, true, 8, JSON_THROW_ON_ERROR);
		} catch (\JsonException) {
			return self::EMPTY;
		}
		if (!is_array($data)) {
			return self::EMPTY;
		}

		$walkStack = [];
		if (isset($data['walk']) && is_array($data['walk'])) {
			$walkStack = self::expandWalk($data['walk']);
		} elseif (isset($data['walkStack']) && is_array($data['walkStack'])) {
			$walkStack = self::sanitizeLegacyWalkStack($data['walkStack']);
		}

		return [
			'scanGen' => (int)($data['scanGen'] ?? 0),
			'rootIdx' => max(0, (int)($data['rootIdx'] ?? 0)),
			'walkStack' => $walkStack,
		];
	}

	/**
	 * @param list<array{path:string,offset:int}> $walkStack
	 * @return array{path:string,offsets:list<int>}|null Null when empty (or when
	 *         the prefix-chain invariant does not hold — encode omits the walk
	 *         rather than persisting a stack it cannot reconstruct).
	 */
	private static function compactWalkStack(array $walkStack): ?array
	{
		if ($walkStack === []) {
			return null;
		}
		$offsets = [];
		$previous = null;
		foreach ($walkStack as $index => $frame) {
			if (!is_array($frame)) {
				return null;
			}
			$path = trim(str_replace('\\', '/', (string)($frame['path'] ?? '')), '/');
			if ($index === 0) {
				if ($path !== '') {
					return null;
				}
			} else {
				$prefix = $previous === '' ? '' : $previous . '/';
				if (!str_starts_with($path, $prefix) || strlen($path) <= strlen($prefix)) {
					return null;
				}
				if (str_contains(substr($path, strlen($prefix)), '/')) {
					return null;
				}
			}
			$offsets[] = max(0, (int)($frame['offset'] ?? 0));
			$previous = $path;
		}

		return ['path' => (string)$previous, 'offsets' => $offsets];
	}

	/**
	 * @param array<mixed> $walk
	 * @return list<array{path:string,offset:int}>
	 */
	private static function expandWalk(array $walk): array
	{
		$path = trim(str_replace('\\', '/', (string)($walk['path'] ?? '')), '/');
		$offsets = $walk['offsets'] ?? null;
		if (!is_array($offsets) || $offsets === []) {
			return [];
		}
		$segments = $path === '' ? [] : explode('/', $path);
		if (count($offsets) !== count($segments) + 1) {
			return [];
		}
		$stack = [];
		$current = '';
		$index = 0;
		foreach ($offsets as $offset) {
			if (!is_int($offset) && !is_numeric($offset)) {
				return [];
			}
			$stack[] = ['path' => $current, 'offset' => max(0, (int)$offset)];
			if ($index < count($segments)) {
				$current = $current === '' ? $segments[$index] : $current . '/' . $segments[$index];
			}
			$index++;
		}

		return $stack;
	}

	/**
	 * @param array<mixed> $frames
	 * @return list<array{path:string,offset:int}>
	 */
	private static function sanitizeLegacyWalkStack(array $frames): array
	{
		$stack = [];
		foreach ($frames as $frame) {
			if (!is_array($frame)) {
				continue;
			}
			$stack[] = [
				'path' => (string)($frame['path'] ?? ''),
				'offset' => max(0, (int)($frame['offset'] ?? 0)),
			];
		}

		return $stack;
	}
}
