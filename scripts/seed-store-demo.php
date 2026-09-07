<?php

declare(strict_types=1);

/**
 * Seed dense DE store-demo content for AudioCheck App Store shots.
 * Real cover.jpg per album/book, ≥20 music tracks, multi-file audiobooks,
 * artists/genres/authors/series/tags facets populated.
 *
 * Run: docker exec -u www-data nextcloud-app php /var/www/html/custom_apps/audiocheck/scripts/seed-store-demo.php
 */

if (php_sapi_name() !== 'cli') {
	fwrite(STDERR, "CLI only\n");
	exit(1);
}

require_once '/var/www/html/lib/base.php';

use OCP\IDBConnection;
use OCP\IUserManager;
use OCP\Files\IRootFolder;
use OCP\Files\Folder;
use OCP\Files\NotFoundException;
use OCP\Server;
use OCP\SystemTag\ISystemTagManager;
use OCP\SystemTag\ISystemTagObjectMapper;

$userId = getenv('AC_STORE_USER') ?: 'admin';
$db = Server::get(IDBConnection::class);
$users = Server::get(IUserManager::class);
$root = Server::get(IRootFolder::class);

if (!$users->userExists($userId)) {
	fwrite(STDERR, "User $userId missing\n");
	exit(1);
}

echo "Seeding AudioCheck store demo for {$userId}…\n";

$userFolder = $root->getUserFolder($userId);

/** @return Folder */
function ensureFolder(Folder $parent, string $name): Folder {
	if ($parent->nodeExists($name)) {
		$n = $parent->get($name);
		if ($n instanceof Folder) {
			return $n;
		}
		$n->delete();
	}
	return $parent->newFolder($name);
}

function putBytes(Folder $folder, string $name, string $bytes): int {
	if ($folder->nodeExists($name)) {
		$folder->get($name)->delete();
	}
	$file = $folder->newFile($name);
	$file->putContent($bytes);
	return (int)$file->getId();
}

function makeCoverJpeg(string $title, string $subtitle, array $rgb): string {
	$im = imagecreatetruecolor(640, 640);
	[$r, $g, $b] = $rgb;
	$bg = imagecolorallocate($im, $r, $g, $b);
	imagefilledrectangle($im, 0, 0, 639, 639, $bg);
	$light = imagecolorallocate($im, min(255, $r + 40), min(255, $g + 40), min(255, $b + 40));
	imagefilledellipse($im, 480, 160, 280, 280, $light);
	$dark = imagecolorallocate($im, max(0, $r - 50), max(0, $g - 50), max(0, $b - 50));
	imagefilledrectangle($im, 0, 420, 639, 639, $dark);
	$white = imagecolorallocate($im, 255, 255, 255);
	$muted = imagecolorallocate($im, 220, 230, 235);
	imagestring($im, 5, 36, 460, mb_strimwidth($title, 0, 28, '…', 'UTF-8'), $white);
	imagestring($im, 3, 36, 500, mb_strimwidth($subtitle, 0, 36, '…', 'UTF-8'), $muted);
	ob_start();
	imagejpeg($im, null, 88);
	$bytes = (string)ob_get_clean();
	imagedestroy($im);
	return $bytes;
}

function wipeChildren(Folder $folder, array $keepNames = []): void {
	foreach ($folder->getDirectoryListing() as $node) {
		if (in_array($node->getName(), $keepNames, true)) {
			continue;
		}
		try {
			$node->delete();
		} catch (Throwable $e) {
			echo "  ! delete {$node->getName()}: {$e->getMessage()}\n";
		}
	}
}

// Template audio — reuse any existing demo mp3 (flat or nested album paths)
$templateBytes = null;
$templateCandidates = [
	'Music/04-Skyline.mp3',
	'Music/02-Quiet-Harbor.mp3',
	'Music/01-Morning-Light.mp3',
	'Music/Fahrspur Duo - Unterwegs/02-Skyline.mp3',
	'Music/Nordlicht Ensemble - Kuestenwege/01-Morgenlicht.mp3',
	'Music/Hafenfunk - Frequenz/01-Signal.mp3',
];
foreach ($templateCandidates as $cand) {
	try {
		if ($userFolder->nodeExists($cand)) {
			$templateBytes = $userFolder->get($cand)->getContent();
			if (strlen($templateBytes) > 1000) {
				echo "  · template audio from {$cand} (" . strlen($templateBytes) . " bytes)\n";
				break;
			}
		}
	} catch (Throwable $e) {
		/* try next */
	}
}
if ($templateBytes === null || strlen($templateBytes) < 1000) {
	// Last resort: walk Music/ for any playable mp3 (skip smoke-mobile)
	try {
		$musicWalk = $userFolder->nodeExists('Music') ? $userFolder->get('Music') : null;
		if ($musicWalk instanceof Folder) {
			$stack = [$musicWalk];
			while ($stack && ($templateBytes === null || strlen((string)$templateBytes) < 1000)) {
				$folder = array_pop($stack);
				foreach ($folder->getDirectoryListing() as $node) {
					if ($node instanceof Folder) {
						$stack[] = $node;
						continue;
					}
					$name = $node->getName();
					if (!str_ends_with(strtolower($name), '.mp3') || str_contains($name, 'smoke-mobile')) {
						continue;
					}
					$bytes = $node->getContent();
					if (strlen($bytes) > 1000) {
						$templateBytes = $bytes;
						echo "  · template audio from walk {$name} (" . strlen($bytes) . " bytes)\n";
						break;
					}
				}
			}
		}
	} catch (Throwable $e) {
		echo "  ! template walk: {$e->getMessage()}\n";
	}
}
if ($templateBytes === null || strlen($templateBytes) < 1000) {
	fwrite(STDERR, "No template MP3 under Music/\n");
	exit(1);
}

$musicRoot = ensureFolder($userFolder, 'Music');
$booksRoot = ensureFolder($userFolder, 'Audiobooks');
wipeChildren($musicRoot);
wipeChildren($booksRoot);

$musicAlbums = [
	[
		'dir' => 'Nordlicht Ensemble - Kuestenwege',
		'artist' => 'Nordlicht Ensemble',
		'album' => 'Küstenwege',
		'genre' => 'Ambient',
		'rgb' => [28, 78, 128],
		'tracks' => ['Morgenlicht', 'Stiller Hafen', 'Salzwind', 'Leuchtturm', 'Dünenlage'],
	],
	[
		'dir' => 'Fahrspur Duo - Unterwegs',
		'artist' => 'Fahrspur Duo',
		'album' => 'Unterwegs',
		'genre' => 'Indie',
		'rgb' => [180, 72, 42],
		'tracks' => ['Offene Straße', 'Skyline', 'Tankstelle', 'Nachtfahrt'],
	],
	[
		'dir' => 'Klarheit Quartett - Glaswerk',
		'artist' => 'Klarheit Quartett',
		'album' => 'Glaswerk',
		'genre' => 'Klassik',
		'rgb' => [72, 52, 120],
		'tracks' => ['Präludium', 'Spiegelung', 'Kanon', 'Finale'],
	],
	[
		'dir' => 'Hafenfunk - Frequenz',
		'artist' => 'Hafenfunk',
		'album' => 'Frequenz',
		'genre' => 'Elektronik',
		'rgb' => [16, 120, 96],
		'tracks' => ['Signal', 'Rauschen', 'Bake', 'Welle', 'Anker'],
	],
	[
		'dir' => 'Strandcafé Trio - Espresso',
		'artist' => 'Strandcafé Trio',
		'album' => 'Espresso',
		'genre' => 'Jazz',
		'rgb' => [140, 90, 40],
		'tracks' => ['Erster Schluck', 'Milchschaum', 'Mittagssonne', 'Letzte Tasse'],
	],
	[
		'dir' => 'Waldschritt - Pfade',
		'artist' => 'Waldschritt',
		'album' => 'Pfade',
		'genre' => 'Folk',
		'rgb' => [48, 96, 48],
		'tracks' => ['Laubdach', 'Bachlauf', 'Moosstein', 'Heimweg'],
	],
];

$audiobooks = [
	[
		'author' => 'Clara Weiss',
		'album' => 'Die letzte Fähre',
		'series' => 'Nordseeküste',
		'genre' => 'Hörbuch',
		'rgb' => [40, 60, 100],
		'chapters' => ['Ankunft', 'Nebel', 'Die Fähre', 'Sturm', 'Landung', 'Epilog'],
	],
	[
		'author' => 'Clara Weiss',
		'album' => 'Nebel über dem Hafen',
		'series' => 'Nordseeküste',
		'genre' => 'Hörbuch',
		'rgb' => [60, 70, 110],
		'chapters' => ['Dämmerung', 'Signalhorn', 'Verschollen', 'Rückkehr'],
	],
	[
		'author' => 'Elias Brandt',
		'album' => 'Chronik der Gezeiten',
		'series' => 'Gezeiten-Chronik',
		'genre' => 'Hörbuch',
		'rgb' => [90, 50, 40],
		'chapters' => ['Flut', 'Ebbe', 'Springtide', 'Ruhe', 'Nachspiel'],
	],
];

$createdMusic = []; // title => fileId
$createdBooks = []; // title => fileId
$albumCoverIds = []; // album => first file id (for playlist covers)

foreach ($musicAlbums as $albumDef) {
	$dir = ensureFolder($musicRoot, $albumDef['dir']);
	putBytes($dir, 'cover.jpg', makeCoverJpeg($albumDef['album'], $albumDef['artist'], $albumDef['rgb']));
	$n = 1;
	foreach ($albumDef['tracks'] as $title) {
		$fname = sprintf('%02d-%s.mp3', $n, preg_replace('/[^A-Za-z0-9_-]+/', '-', $title) ?: 'track');
		$fid = putBytes($dir, $fname, $templateBytes);
		$createdMusic[$title] = [
			'file_id' => $fid,
			'artist' => $albumDef['artist'],
			'album' => $albumDef['album'],
			'genre' => $albumDef['genre'],
			'album_artist' => $albumDef['artist'],
			'track_no' => $n,
			'kind' => 'music',
		];
		if ($n === 1) {
			$albumCoverIds[$albumDef['album']] = $fid;
		}
		$n++;
	}
	echo "  + music album {$albumDef['album']} (" . count($albumDef['tracks']) . " tracks)\n";
}

foreach ($audiobooks as $book) {
	$authorDir = ensureFolder($booksRoot, $book['author']);
	$bookDir = ensureFolder($authorDir, $book['album']);
	putBytes($bookDir, 'cover.jpg', makeCoverJpeg($book['album'], $book['author'], $book['rgb']));
	$n = 1;
	$chapterMarks = [];
	$durPer = 120000;
	foreach ($book['chapters'] as $chTitle) {
		$chapterMarks[] = [
			'start_ms' => ($n - 1) * $durPer,
			'end_ms' => $n * $durPer,
			'title' => 'Kapitel ' . $n . ' — ' . $chTitle,
		];
		$n++;
	}
	$n = 1;
	foreach ($book['chapters'] as $chTitle) {
		$fname = sprintf('Kapitel-%02d.mp3', $n);
		$fid = putBytes($bookDir, $fname, $templateBytes);
		$title = 'Kapitel ' . $n . ' — ' . $chTitle;
		$createdBooks[$title] = [
			'file_id' => $fid,
			'artist' => $book['author'],
			'album' => $book['album'],
			'album_artist' => $book['author'],
			'genre' => $book['genre'],
			'series' => $book['series'],
			'track_no' => $n,
			'kind' => 'audiobook',
			// Inject multi-chapter markers on every chapter file so now-playing shows Kapitel list
			'chapters' => $chapterMarks,
		];
		if ($n === 1) {
			$albumCoverIds[$book['album']] = $fid;
		}
		$n++;
	}
	echo "  + audiobook {$book['album']} (" . count($book['chapters']) . " chapters)\n";
}

echo '  music tracks=' . count($createdMusic) . ' audiobook files=' . count($createdBooks) . "\n";

// Libraries
$qb = $db->getQueryBuilder();
$existing = $qb->select('id', 'folder_path')
	->from('ac_libraries')
	->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
	->executeQuery()
	->fetchAll();
$paths = array_column($existing, 'folder_path');

function ensureLib(IDBConnection $db, string $userId, string $path, string $kind, IRootFolder $root, array &$paths): void {
	if (in_array($path, $paths, true)) {
		return;
	}
	$folder = $root->getUserFolder($userId);
	$rel = ltrim($path, '/');
	if (!$folder->nodeExists($rel)) {
		$folder->newFolder($rel);
	}
	$node = $folder->get($rel);
	$now = time();
	$db->insertIfNotExist('*PREFIX*ac_libraries', [
		'user_id' => $userId,
		'folder_path' => $path,
		'root_file_id' => $node->getId(),
		'include_subfolders' => 1,
		'content_kind' => $kind,
		'enabled' => 1,
		'created_at' => $now,
	], ['user_id', 'folder_path']);
	$paths[] = $path;
	echo "  + library {$path} ({$kind})\n";
}

ensureLib($db, $userId, '/Music', 'music', $root, $paths);
ensureLib($db, $userId, '/Audiobooks', 'audiobook', $root, $paths);

passthru('php /var/www/html/occ files:scan --path="' . $userId . '/files/Music" 2>&1', $scanFiles1);
passthru('php /var/www/html/occ files:scan --path="' . $userId . '/files/Audiobooks" 2>&1', $scanFiles2);
passthru('php /var/www/html/occ audiocheck:scan -u ' . escapeshellarg($userId) . ' 2>&1', $scanCode);
echo "  files:scan Music={$scanFiles1} Audiobooks={$scanFiles2}; audiocheck:scan={$scanCode}\n";

// Purge smoke / flat lab leftovers from index (not album/book nested paths)
$db->executeStatement(
	'DELETE FROM `*PREFIX*ac_tracks` WHERE `user_id` = ? AND (`file_name` LIKE ? OR `rel_path` REGEXP ? OR `rel_path` REGEXP ?)',
	[$userId, '%smoke-mobile%', '^/Music/[^/]+\\.mp3$', '^/Audiobooks/Chapter-[^/]+\\.mp3$']
);
$db->executeStatement(
	'DELETE FROM `*PREFIX*ac_file_meta` WHERE `title` LIKE ?',
	['%smoke-mobile%']
);

function upsertMeta(IDBConnection $db, string $userId, array $fields): void {
	$fileId = (int)$fields['file_id'];
	$qb = $db->getQueryBuilder();
	$exists = $qb->select('id')
		->from('ac_file_meta')
		->where($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId)))
		->executeQuery()
		->fetchOne();

	$set = [
		'title' => $fields['title'],
		'artist' => $fields['artist'],
		'album' => $fields['album'],
		'album_artist' => $fields['album_artist'],
		'genre' => $fields['genre'],
		'kind' => $fields['kind'],
		'track_no' => $fields['track_no'],
		'cover_state' => 'folder',
		'duration_ms' => $fields['duration_ms'] ?? 210000,
		'bitrate' => 192000,
		'analyzed_at' => time(),
		'series' => $fields['series'] ?? null,
	];
	foreach (['title', 'artist', 'album', 'album_artist', 'genre', 'series'] as $col) {
		$val = $set[$col] ?? null;
		$set[$col . '_norm'] = $val !== null && $val !== '' ? mb_strtolower((string)$val, 'UTF-8') : null;
	}
	if (!empty($fields['chapters'])) {
		$set['has_chapters'] = 1;
		$set['chapters_json'] = json_encode($fields['chapters'], JSON_THROW_ON_ERROR);
	} else {
		$set['has_chapters'] = 0;
		$set['chapters_json'] = null;
	}

	if ($exists) {
		$parts = [];
		$params = [];
		foreach ($set as $col => $val) {
			$parts[] = "`{$col}` = ?";
			$params[] = $val;
		}
		$params[] = $fileId;
		$db->executeStatement('UPDATE `*PREFIX*ac_file_meta` SET ' . implode(', ', $parts) . ' WHERE `file_id` = ?', $params);
	} else {
		$cols = array_merge(['file_id', 'etag', 'mimetype', 'source_mtime', 'source_size'], array_keys($set));
		$placeholders = implode(', ', array_fill(0, count($cols), '?'));
		$params = array_merge(
			[$fileId, 'store-seed', 'audio/mpeg', time(), 100000],
			array_values($set)
		);
		$db->executeStatement(
			'INSERT INTO `*PREFIX*ac_file_meta` (`' . implode('`, `', $cols) . '`) VALUES (' . $placeholders . ')',
			$params
		);
	}

	$qb = $db->getQueryBuilder();
	$metaId = (int)$qb->select('id')
		->from('ac_file_meta')
		->where($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId)))
		->executeQuery()
		->fetchOne();
	if ($metaId > 0) {
		$db->executeStatement(
			'UPDATE `*PREFIX*ac_tracks` SET `meta_id` = ? WHERE `user_id` = ? AND `file_id` = ?',
			[$metaId, $userId, $fileId]
		);
	}
}

foreach ($createdMusic as $title => $row) {
	upsertMeta($db, $userId, array_merge($row, ['title' => $title]));
}
foreach ($createdBooks as $title => $row) {
	upsertMeta($db, $userId, array_merge($row, ['title' => $title, 'duration_ms' => 720000]));
}
echo "  + enriched file_meta + cover_state=folder\n";

// Re-resolve file ids from DB by album+title in case files:scan remapped
$resolveId = static function (IDBConnection $db, string $userId, string $title, string $album) use (&$createdMusic, &$createdBooks): int {
	$qb = $db->getQueryBuilder();
	$id = $qb->select('t.file_id')
		->from('ac_tracks', 't')
		->innerJoin('t', 'ac_file_meta', 'm', $qb->expr()->eq('t.meta_id', 'm.id'))
		->where($qb->expr()->eq('t.user_id', $qb->createNamedParameter($userId)))
		->andWhere($qb->expr()->eq('m.title', $qb->createNamedParameter($title)))
		->andWhere($qb->expr()->eq('m.album', $qb->createNamedParameter($album)))
		->executeQuery()
		->fetchOne();
	return (int)$id;
};

$morgenlicht = $resolveId($db, $userId, 'Morgenlicht', 'Küstenwege') ?: ($createdMusic['Morgenlicht']['file_id'] ?? 0);
$stiller = $resolveId($db, $userId, 'Stiller Hafen', 'Küstenwege') ?: ($createdMusic['Stiller Hafen']['file_id'] ?? 0);
$skyline = $resolveId($db, $userId, 'Skyline', 'Unterwegs') ?: ($createdMusic['Skyline']['file_id'] ?? 0);
$strasse = $resolveId($db, $userId, 'Offene Straße', 'Unterwegs') ?: ($createdMusic['Offene Straße']['file_id'] ?? 0);
$signal = $resolveId($db, $userId, 'Signal', 'Frequenz') ?: ($createdMusic['Signal']['file_id'] ?? 0);
$ankunft = $resolveId($db, $userId, 'Kapitel 1 — Ankunft', 'Die letzte Fähre') ?: ($createdBooks['Kapitel 1 — Ankunft']['file_id'] ?? 0);
$nebel = $resolveId($db, $userId, 'Kapitel 2 — Nebel', 'Die letzte Fähre') ?: ($createdBooks['Kapitel 2 — Nebel']['file_id'] ?? 0);
$faehre = $resolveId($db, $userId, 'Kapitel 3 — Die Fähre', 'Die letzte Fähre') ?: ($createdBooks['Kapitel 3 — Die Fähre']['file_id'] ?? 0);
$sturm = $resolveId($db, $userId, 'Kapitel 4 — Sturm', 'Die letzte Fähre') ?: ($createdBooks['Kapitel 4 — Sturm']['file_id'] ?? 0);

// Playlists
$playlistDefs = [
	'Abendmix' => ['pinned' => 1, 'tracks' => ['Morgenlicht', 'Skyline', 'Signal', 'Erster Schluck', 'Laubdach'], 'cover_album' => 'Küstenwege'],
	'Fokus am Schreibtisch' => ['pinned' => 0, 'tracks' => ['Präludium', 'Spiegelung', 'Kanon', 'Moosstein'], 'cover_album' => 'Glaswerk'],
	'Wochenende' => ['pinned' => 0, 'tracks' => ['Offene Straße', 'Tankstelle', 'Milchschaum', 'Welle', 'Heimweg'], 'cover_album' => 'Unterwegs'],
	'Abendlesen' => ['pinned' => 0, 'tracks' => ['Kapitel 1 — Ankunft', 'Kapitel 2 — Nebel', 'Kapitel 3 — Die Fähre'], 'cover_album' => 'Die letzte Fähre'],
];

$titleToId = [];
$qb = $db->getQueryBuilder();
$rows = $qb->select('t.file_id', 'm.title')
	->from('ac_tracks', 't')
	->innerJoin('t', 'ac_file_meta', 'm', $qb->expr()->eq('t.meta_id', 'm.id'))
	->where($qb->expr()->eq('t.user_id', $qb->createNamedParameter($userId)))
	->executeQuery()
	->fetchAll();
foreach ($rows as $r) {
	$titleToId[(string)$r['title']] = (int)$r['file_id'];
}

foreach (['Evening mix', 'Evening Mix'] as $enName) {
	$qb = $db->getQueryBuilder();
	$enPl = $qb->select('id')->from('ac_playlists')
		->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
		->andWhere($qb->expr()->eq('name', $qb->createNamedParameter($enName)))
		->executeQuery()->fetchOne();
	if ($enPl) {
		$db->executeStatement('DELETE FROM `*PREFIX*ac_playlist_items` WHERE `playlist_id` = ?', [(int)$enPl]);
		$db->executeStatement('DELETE FROM `*PREFIX*ac_playlists` WHERE `id` = ?', [(int)$enPl]);
	}
}

foreach ($playlistDefs as $name => $def) {
	$qb = $db->getQueryBuilder();
	$pid = (int)$qb->select('id')->from('ac_playlists')
		->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
		->andWhere($qb->expr()->eq('name', $qb->createNamedParameter($name)))
		->executeQuery()->fetchOne();
	$coverFid = $albumCoverIds[$def['cover_album']] ?? ($titleToId[$def['tracks'][0]] ?? null);
	$now = time();
	if ($pid < 1) {
		$db->insertIfNotExist('*PREFIX*ac_playlists', [
			'user_id' => $userId,
			'name' => $name,
			'kind' => 'manual',
			'is_pinned' => $def['pinned'],
			'default_speed' => 100,
			'cover_file_id' => $coverFid,
			'created_at' => $now,
			'updated_at' => $now,
		], ['user_id', 'name']);
		$qb = $db->getQueryBuilder();
		$pid = (int)$qb->select('id')->from('ac_playlists')
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->eq('name', $qb->createNamedParameter($name)))
			->executeQuery()->fetchOne();
	} else {
		$db->executeStatement(
			'UPDATE `*PREFIX*ac_playlists` SET `is_pinned` = ?, `cover_file_id` = ?, `updated_at` = ? WHERE `id` = ?',
			[$def['pinned'], $coverFid, $now, $pid]
		);
	}
	$db->executeStatement('DELETE FROM `*PREFIX*ac_playlist_items` WHERE `playlist_id` = ?', [$pid]);
	$order = 1;
	foreach ($def['tracks'] as $tname) {
		$fid = $titleToId[$tname] ?? 0;
		if ($fid < 1) {
			continue;
		}
		$qb = $db->getQueryBuilder();
		$qb->insert('ac_playlist_items')->values([
			'playlist_id' => $qb->createNamedParameter($pid),
			'file_id' => $qb->createNamedParameter($fid),
			'sort_order' => $qb->createNamedParameter($order++),
			'added_at' => $qb->createNamedParameter($now),
		])->executeStatement();
	}
	echo "  + playlist {$name}\n";
}

// Continue listening + dense queue (audiobook with chapters first for shot 07)
$now = time();
$db->executeStatement('DELETE FROM `*PREFIX*ac_play_state` WHERE `user_id` = ?', [$userId]);
foreach (
	[
		[$ankunft, 185000, 720000, 100, 0, 0],
		[$morgenlicht, 95000, 210000, 100, 0, 3600],
		[$signal, 42000, 210000, 100, 0, 7200],
		[$nebel, 90000, 720000, 125, 0, 10800],
	] as [$fid, $pos, $dur, $spd, $fin, $ago]
) {
	if ($fid < 1) {
		continue;
	}
	$qb = $db->getQueryBuilder();
	$qb->insert('ac_play_state')->values([
		'user_id' => $qb->createNamedParameter($userId),
		'file_id' => $qb->createNamedParameter($fid),
		'position_ms' => $qb->createNamedParameter($pos),
		'duration_ms' => $qb->createNamedParameter($dur),
		'playback_speed' => $qb->createNamedParameter($spd),
		'finished' => $qb->createNamedParameter($fin),
		'updated_at' => $qb->createNamedParameter($now - $ago),
		'listened' => $qb->createNamedParameter(0),
	])->executeStatement();
}

$qb = $db->getQueryBuilder();
$qid = (int)$qb->select('id')->from('ac_queue')
	->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
	->executeQuery()->fetchOne();
if ($qid < 1) {
	$qb = $db->getQueryBuilder();
	$qb->insert('ac_queue')->values([
		'user_id' => $qb->createNamedParameter($userId),
		'current_index' => $qb->createNamedParameter(0),
		'playback_speed' => $qb->createNamedParameter(100),
		'shuffle' => $qb->createNamedParameter(0),
		'repeat_mode' => $qb->createNamedParameter('off'),
		'updated_at' => $qb->createNamedParameter($now),
	])->executeStatement();
	$qb = $db->getQueryBuilder();
	$qid = (int)$qb->select('id')->from('ac_queue')
		->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
		->executeQuery()->fetchOne();
} else {
	$db->executeStatement(
		'UPDATE `*PREFIX*ac_queue` SET `current_index` = 0, `playback_speed` = 100, `shuffle` = 0, `repeat_mode` = ?, `updated_at` = ? WHERE `id` = ?',
		['off', $now, $qid]
	);
}
$db->executeStatement('DELETE FROM `*PREFIX*ac_queue_items` WHERE `queue_id` = ?', [$qid]);
$queueIds = array_values(array_filter([$ankunft, $nebel, $faehre, $sturm, $morgenlicht, $stiller, $skyline, $strasse, $signal]));
$order = 0;
foreach ($queueIds as $fid) {
	$qb = $db->getQueryBuilder();
	$qb->insert('ac_queue_items')->values([
		'queue_id' => $qb->createNamedParameter($qid),
		'file_id' => $qb->createNamedParameter($fid),
		'sort_order' => $qb->createNamedParameter($order++),
	])->executeStatement();
}
echo '  + play_state + queue (' . count($queueIds) . " items)\n";

// Favorites + Tags facets
try {
	$tagMgr = Server::get(ISystemTagManager::class);
	$objMapper = Server::get(ISystemTagObjectMapper::class);
	$tags = $tagMgr->getAllTags(true);
	$favId = null;
	foreach ($tags as $tag) {
		if ($tag->getName() === '_$!<Favorite>!$_') {
			$favId = $tag->getId();
			break;
		}
	}
	if ($favId === null) {
		$favId = $tagMgr->createTag('_$!<Favorite>!$_', true, false)->getId();
	}
	$favTitles = ['Morgenlicht', 'Skyline', 'Signal', 'Präludium', 'Erster Schluck', 'Kapitel 1 — Ankunft'];
	foreach ($favTitles as $tname) {
		$fid = $titleToId[$tname] ?? 0;
		if ($fid > 0) {
			$objMapper->assignTags((string)$fid, 'files', [$favId]);
		}
	}
	echo "  + favorites tagged\n";

	$demoTagNames = ['Urlaub', 'Konzentration', 'Abend'];
	$demoTagIds = [];
	$all = array_merge($tagMgr->getAllTags(true), $tagMgr->getAllTags(false));
	foreach ($demoTagNames as $tn) {
		$found = null;
		foreach ($all as $tag) {
			if ($tag->getName() === $tn) {
				$found = (int)$tag->getId();
				break;
			}
		}
		if ($found === null) {
			try {
				$found = (int)$tagMgr->createTag($tn, true, false)->getId();
			} catch (Throwable $e) {
				$all = array_merge($tagMgr->getAllTags(true), $tagMgr->getAllTags(false));
				foreach ($all as $tag) {
					if ($tag->getName() === $tn) {
						$found = (int)$tag->getId();
						break;
					}
				}
			}
		}
		if ($found === null || $found < 1) {
			echo "  ! could not resolve tag {$tn}\n";
			continue;
		}
		$demoTagIds[$tn] = $found;
	}
	$tagAssign = [
		'Urlaub' => ['Morgenlicht', 'Stiller Hafen', 'Offene Straße', 'Skyline'],
		'Konzentration' => ['Präludium', 'Spiegelung', 'Signal', 'Rauschen'],
		'Abend' => ['Kapitel 1 — Ankunft', 'Kapitel 2 — Nebel', 'Letzte Tasse', 'Heimweg'],
	];
	foreach ($tagAssign as $tn => $titles) {
		$tid = $demoTagIds[$tn];
		foreach ($titles as $tname) {
			$fid = $titleToId[$tname] ?? 0;
			if ($fid > 0) {
				$objMapper->assignTags((string)$fid, 'files', [$tid]);
			}
		}
	}
	echo "  + system tags for Tags facet\n";
} catch (Throwable $e) {
	echo "  ! favorites/tags: {$e->getMessage()}\n";
}

$qb = $db->getQueryBuilder();
$musicCount = (int)$qb->select($qb->func()->count('*'))
	->from('ac_tracks', 't')
	->innerJoin('t', 'ac_file_meta', 'm', $qb->expr()->eq('t.meta_id', 'm.id'))
	->where($qb->expr()->eq('t.user_id', $qb->createNamedParameter($userId)))
	->andWhere($qb->expr()->eq('m.kind', $qb->createNamedParameter('music')))
	->executeQuery()->fetchOne();
$qb = $db->getQueryBuilder();
$bookCount = (int)$qb->select($qb->func()->count('*'))
	->from('ac_tracks', 't')
	->innerJoin('t', 'ac_file_meta', 'm', $qb->expr()->eq('t.meta_id', 'm.id'))
	->where($qb->expr()->eq('t.user_id', $qb->createNamedParameter($userId)))
	->andWhere($qb->expr()->eq('m.kind', $qb->createNamedParameter('audiobook')))
	->executeQuery()->fetchOne();

echo "Done. Indexed music={$musicCount} audiobooks={$bookCount}\n";
if ($musicCount < 20) {
	fwrite(STDERR, "WARNING: expected ≥20 music tracks, got {$musicCount}\n");
	exit(2);
}
