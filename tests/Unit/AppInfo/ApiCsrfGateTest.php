<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\AppInfo;

use PHPUnit\Framework\TestCase;

/** JSON API: GET reads opt out of CSRF; mutations require CSRF (§11.3, UAT J1). */
final class ApiCsrfGateTest extends TestCase
{
	private const READ_METHODS = [
		'listTracks',
		'getTrackInfo',
		'getPlayableTrack',
		'listFolderTracks',
		'listCollections',
		'getCollection',
		'listFacets',
		'getProgress',
		'getQueue',
		'listPlaylists',
		'getPlaylist',
		'listLibraries',
		'scanStatus',
		'getPrefs',
		'searchUsers',
		'searchGroups',
		'getAppPolicy',
	];

	private const MUTATION_METHODS = [
		'saveProgress',
		'saveProgressBeacon',
		'deleteProgress',
		'saveQueue',
		'saveQueueBeacon',
		'clearQueue',
		'createPlaylist',
		'updatePlaylist',
		'deletePlaylist',
		'addPlaylistItem',
		'reorderPlaylistItems',
		'removePlaylistItem',
		'buildPlaylist',
		'addLibrary',
		'updateLibrary',
		'removeLibrary',
		'triggerScan',
		'savePrefs',
		'setFavorite',
		'saveAppPolicy',
	];

	public function testReadMethodsDeclareNoCsrfRequired(): void
	{
		$source = $this->controllerSource();
		foreach (self::READ_METHODS as $method) {
			$this->assertMatchesRegularExpression(
				'/#' . preg_quote('[NoAdminRequired]', '/') . '\s+#' . preg_quote('[NoCSRFRequired]', '/') . '\s+public function ' . preg_quote($method, '/') . '\(/',
				$source,
				'Expected #[NoCSRFRequired] on read method ' . $method,
			);
		}
	}

	public function testMutationMethodsDoNotDeclareNoCsrfRequired(): void
	{
		$source = $this->controllerSource();
		foreach (self::MUTATION_METHODS as $method) {
			$this->assertDoesNotMatchRegularExpression(
				'/#' . preg_quote('[NoCSRFRequired]', '/') . '\s+public function ' . preg_quote($method, '/') . '\(/',
				$source,
				'Mutation method must not use #[NoCSRFRequired]: ' . $method,
			);
		}
	}

	private function controllerSource(): string
	{
		$path = dirname(__DIR__, 3) . '/lib/Controller/ApiController.php';
		$source = file_get_contents($path);
		$this->assertIsString($source);

		return $source;
	}
}
