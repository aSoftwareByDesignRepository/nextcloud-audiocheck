<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Nextcloud DB-Standards (auto-generated)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
namespace OCA\AudioCheck\Repair;

use OCA\AudioCheck\Service\CoverService;
use OCP\IConfig;
use OCP\IDBConnection;
use OCP\Migration\IOutput;
use OCP\Migration\IRepairStep;

final class UninstallDropTables implements IRepairStep
{
	public const APP_ID = 'audiocheck';

	public const REPAIR_PASS_KEY = 'uninstall_repair_pass';

	public const PASSES_BEFORE_DROP = 2;

	public const TABLES = [
		'ac_file_meta',
		'ac_libraries',
		'ac_play_state',
		'ac_playlist_items',
		'ac_playlists',
		'ac_scan_state',
		'ac_tracks',
	];

	public function __construct(
		private readonly IDBConnection $connection,
		private readonly IConfig $config,
		private readonly CoverService $coverService,
	) {
	}

	public function getName(): string
	{
		return 'Drop AudioCheck tables and install metadata on uninstall';
	}

	public function run(IOutput $output): void
	{
		$pass = (int)$this->config->getAppValue(self::APP_ID, self::REPAIR_PASS_KEY, '0') + 1;
		if ($pass < self::PASSES_BEFORE_DROP) {
			$this->config->setAppValue(self::APP_ID, self::REPAIR_PASS_KEY, (string)$pass);
			$output->info(sprintf(
				'audiocheck: preserving data on disable (uninstall repair pass %d/%d).',
				$pass,
				self::PASSES_BEFORE_DROP,
			));
			return;
		}

		$this->config->deleteAppValue(self::APP_ID, self::REPAIR_PASS_KEY);

		$platform = $this->connection->getDatabasePlatform()->getName();
		if ($platform === 'mysql') {
			$this->connection->executeStatement('SET FOREIGN_KEY_CHECKS=0');
		}

		$prefix = $this->connection->getPrefix();
		foreach (self::TABLES as $table) {
			$full = $prefix . $table;
			$this->connection->executeStatement('DROP TABLE IF EXISTS `' . $full . '`');
			$output->info('Dropped table ' . $full);
		}

		if ($platform === 'mysql') {
			$this->connection->executeStatement('SET FOREIGN_KEY_CHECKS=1');
		}

		$this->connection->executeStatement(
			'DELETE FROM `' . $prefix . 'migrations` WHERE `app` = ?',
			[self::APP_ID],
		);
		$this->config->deleteAppValues(self::APP_ID);

		$this->coverService->purgeCache();
		$output->info('Purged cover art cache.');

		$output->info('AudioCheck uninstall cleanup complete.');
	}
}
