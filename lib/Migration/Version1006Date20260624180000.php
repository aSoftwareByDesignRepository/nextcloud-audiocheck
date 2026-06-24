<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Migration;

use Closure;
use OCA\AudioCheck\Util\SearchTextNormalizer;
use OCP\DB\ISchemaWrapper;
use OCP\IDBConnection;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Normalized search shadow columns for accent/case-insensitive library search.
 *
 * AudioCheck text columns use utf8mb4_bin (Nextcloud default). Plain LIKE is
 * case-sensitive and accent-sensitive on those columns. These *_norm columns
 * store pre-normalized text (matching the mobile offline matcher) so search
 * can use portable LIKE with normalized query tokens.
 */
class Version1006Date20260624180000 extends SimpleMigrationStep
{
	public function __construct(
		private IDBConnection $db,
	) {
	}

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper
	{
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if ($schema->hasTable('ac_file_meta')) {
			$t = $schema->getTable('ac_file_meta');
			foreach ([
				'title_norm' => 512,
				'artist_norm' => 512,
				'album_norm' => 512,
				'album_artist_norm' => 512,
				'genre_norm' => 255,
				'series_norm' => 512,
			] as $column => $length) {
				if (!$t->hasColumn($column)) {
					$t->addColumn($column, 'string', ['length' => $length, 'notnull' => false]);
				}
			}
		}

		if ($schema->hasTable('ac_tracks')) {
			$t = $schema->getTable('ac_tracks');
			if (!$t->hasColumn('file_name_norm')) {
				$t->addColumn('file_name_norm', 'string', ['length' => 512, 'notnull' => false]);
			}
		}

		return $schema;
	}

	public function postSchemaChange(IOutput $output, Closure $schemaClosure, array $options): void
	{
		$this->backfillFileMetaNormColumns($output);
		$this->backfillTrackFileNameNormColumns($output);
	}

	private function backfillFileMetaNormColumns(IOutput $output): void
	{
		if (!$this->db->tableExists('ac_file_meta')) {
			return;
		}

		$lastId = 0;
		$updated = 0;
		while (true) {
			$qb = $this->db->getQueryBuilder();
			$qb->select('id', 'title', 'artist', 'album', 'album_artist', 'genre', 'series')
				->from('ac_file_meta')
				->where($qb->expr()->gt('id', $qb->createNamedParameter($lastId, \PDO::PARAM_INT)))
				->orderBy('id', 'ASC')
				->setMaxResults(500);
			$result = $qb->executeQuery();
			$rows = $result->fetchAll();
			$result->closeCursor();
			if ($rows === []) {
				break;
			}

			foreach ($rows as $row) {
				$lastId = (int)$row['id'];
				$uq = $this->db->getQueryBuilder();
				$uq->update('ac_file_meta')
					->set('title_norm', $uq->createNamedParameter(SearchTextNormalizer::normalize($row['title'] ?? null)))
					->set('artist_norm', $uq->createNamedParameter(SearchTextNormalizer::normalize($row['artist'] ?? null)))
					->set('album_norm', $uq->createNamedParameter(SearchTextNormalizer::normalize($row['album'] ?? null)))
					->set('album_artist_norm', $uq->createNamedParameter(SearchTextNormalizer::normalize($row['album_artist'] ?? null)))
					->set('genre_norm', $uq->createNamedParameter(SearchTextNormalizer::normalize($row['genre'] ?? null)))
					->set('series_norm', $uq->createNamedParameter(SearchTextNormalizer::normalize($row['series'] ?? null)))
					->where($uq->expr()->eq('id', $uq->createNamedParameter($lastId, \PDO::PARAM_INT)));
				$uq->executeStatement();
				$updated++;
			}
		}

		if ($updated > 0) {
			$output->info('AudioCheck: backfilled normalized search columns on ' . $updated . ' metadata row(s).');
		}
	}

	private function backfillTrackFileNameNormColumns(IOutput $output): void
	{
		if (!$this->db->tableExists('ac_tracks')) {
			return;
		}

		$lastId = 0;
		$updated = 0;
		while (true) {
			$qb = $this->db->getQueryBuilder();
			$qb->select('id', 'file_name')
				->from('ac_tracks')
				->where($qb->expr()->gt('id', $qb->createNamedParameter($lastId, \PDO::PARAM_INT)))
				->orderBy('id', 'ASC')
				->setMaxResults(500);
			$result = $qb->executeQuery();
			$rows = $result->fetchAll();
			$result->closeCursor();
			if ($rows === []) {
				break;
			}

			foreach ($rows as $row) {
				$lastId = (int)$row['id'];
				$uq = $this->db->getQueryBuilder();
				$uq->update('ac_tracks')
					->set('file_name_norm', $uq->createNamedParameter(SearchTextNormalizer::normalize($row['file_name'] ?? null)))
					->where($uq->expr()->eq('id', $uq->createNamedParameter($lastId, \PDO::PARAM_INT)));
				$uq->executeStatement();
				$updated++;
			}
		}

		if ($updated > 0) {
			$output->info('AudioCheck: backfilled normalized file names on ' . $updated . ' track row(s).');
		}
	}
}
