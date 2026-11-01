<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Util;

/**
 * Derives the "book folder" a track belongs to from its library-relative path.
 * Mirrors MetadataService's disc-folder rule: when the immediate parent folder
 * is a disc/CD folder ("CD 1", "Disc 2", "CD1"), the book is the grandparent.
 * Root-level files return '' (grouped by library root — album fallback wins).
 */
final class CollectionFolder
{
	/** Matches MetadataService::discFolderNumber folder shapes. */
	private const DISC_PATTERN = '/^(?:cd|disc|disk|teil|part|vol(?:ume)?|seite|side|kapitel|chapter)\s*[-_.#]?\s*\d+$/i';

	public static function fromRelPath(string $relPath): string
	{
		$relPath = trim(str_replace('\\', '/', $relPath), '/');
		if ($relPath === '' || !str_contains($relPath, '/')) {
			return '';
		}
		$parent = dirname($relPath);
		if ($parent === '.' || $parent === '' || $parent === '/') {
			return '';
		}
		$leaf = basename($parent);
		if (self::isDiscFolder($leaf)) {
			$grand = dirname($parent);
			if ($grand !== '.' && $grand !== '' && $grand !== '/') {
				return str_replace('\\', '/', $grand);
			}
			return '';
		}
		return str_replace('\\', '/', $parent);
	}

	public static function isDiscFolder(string $name): bool
	{
		return preg_match(self::DISC_PATTERN, trim($name)) === 1;
	}
}
