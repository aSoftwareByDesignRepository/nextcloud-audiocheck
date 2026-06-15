<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Controller;

use OCA\AudioCheck\AppInfo\Application;
use OCA\AudioCheck\Service\AccessControlService;
use OCA\AudioCheck\Service\PlaybackStateService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\RedirectResponse;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IL10N;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\Util;

/**
 * All page routes render the same persistent shell; client-side router swaps views.
 */
class PageController extends Controller
{
	public function __construct(
		string $appName,
		IRequest $request,
		private IURLGenerator $urlGenerator,
		private AccessControlService $access,
		private IL10N $l10n,
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function index(): TemplateResponse
	{
		return $this->shell('home', $this->l10n->t('Home'), $this->l10n->t('Continue listening and discover your audio library.'));
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function audiobooks(): TemplateResponse
	{
		return $this->shell('audiobooks', $this->l10n->t('Audiobooks'), $this->l10n->t('Browse audiobook titles, folders, and books.'));
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function music(): TemplateResponse
	{
		return $this->shell('music', $this->l10n->t('Music'), $this->l10n->t('Browse tracks, folders, and albums.'));
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function playlists(): TemplateResponse
	{
		return $this->shell('playlists', $this->l10n->t('Playlists'), $this->l10n->t('Built-in Favorites and playlists you create.'));
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function favoritesPlaylist(): TemplateResponse
	{
		return $this->shell('playlist', $this->l10n->t('Favorites'), $this->l10n->t('Tracks you have marked as favorites.'), ['playlistId' => 'favorites']);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function playlist(int $id): TemplateResponse
	{
		return $this->shell('playlist', $this->l10n->t('Playlist'), $this->l10n->t('View and play playlist tracks.'), ['playlistId' => $id]);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function browse(): TemplateResponse
	{
		return $this->shell('browse', $this->l10n->t('Browse'), $this->l10n->t('Explore artists, genres, folders, and favorites.'));
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function nowPlaying(): TemplateResponse
	{
		return $this->shell('now-playing', $this->l10n->t('Now playing'), $this->l10n->t('Full player, queue, and chapters.'));
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function library(): TemplateResponse
	{
		return $this->shell('library', $this->l10n->t('Library'), $this->l10n->t('Choose folders to scan, then index your audio.'));
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function settings(): TemplateResponse
	{
		return $this->shell('settings', $this->l10n->t('Settings'), $this->l10n->t('Personal playback and scan preferences.'));
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function appSettings(): RedirectResponse|TemplateResponse
	{
		try {
			$this->access->requireAppAdmin();
		} catch (\Throwable) {
			return new RedirectResponse($this->urlGenerator->linkToRoute('audiocheck.page.index'));
		}
		return $this->shell('app-settings', $this->l10n->t('App settings'), $this->l10n->t('Access policy and defaults for AudioCheck.'));
	}

	/** @param array<string, mixed> $extra */
	private function shell(string $viewId, string $title, string $help, array $extra = []): TemplateResponse
	{
		$userId = $this->access->currentUserId();
		$this->registerFrontEndAssets();

		$response = new TemplateResponse(Application::APP_ID, 'index', array_merge([
			'viewId' => $viewId,
			'pageTitle' => $title,
			'pageHelp' => $help,
			'isAppAdmin' => $this->access->isAppAdmin($userId),
			'navigation' => $this->buildNavigation($viewId),
			'appLogoUrl' => $this->urlGenerator->imagePath(Application::APP_ID, 'app.svg'),
			'urls' => $this->buildUrls(),
			'speedPresets' => PlaybackStateService::SPEED_PRESETS,
		], $extra));
		$response->renderAs('user');
		return $response;
	}

	private function registerFrontEndAssets(): void
	{
		Util::addStyle(Application::APP_ID, 'app');
		foreach ([
			'common/constants',
			'common/messaging',
			'common/time',
			'common/api',
			'common/icons',
			'common/components',
			'common/entity-picker',
			'common/folder-picker',
			'common/playlist-actions',
			'common/router',
			'common/player',
			'common/media-library-page',
			'common/facet-browse-page',
			'views/home',
			'views/audiobooks',
			'views/music',
			'views/browse',
			'views/playlists',
			'views/now-playing',
			'views/library',
			'views/settings',
			'views/app-settings',
			'app',
		] as $script) {
			Util::addScript(Application::APP_ID, $script);
		}
	}

	/** @return list<array<string, mixed>> */
	private function buildNavigation(string $activeView): array
	{
		$userId = $this->access->currentUserId();
		$items = [
			['id' => 'home', 'label' => $this->l10n->t('Home'), 'route' => 'audiocheck.page.index', 'icon' => 'home'],
			['id' => 'audiobooks', 'label' => $this->l10n->t('Audiobooks'), 'route' => 'audiocheck.page.audiobooks', 'icon' => 'audiobook'],
			['id' => 'music', 'label' => $this->l10n->t('Music'), 'route' => 'audiocheck.page.music', 'icon' => 'music'],
			['id' => 'playlists', 'label' => $this->l10n->t('Playlists'), 'route' => 'audiocheck.page.playlists', 'icon' => 'playlist'],
			['id' => 'browse', 'label' => $this->l10n->t('Browse'), 'route' => 'audiocheck.page.browse', 'icon' => 'browse'],
			['id' => 'now-playing', 'label' => $this->l10n->t('Now playing'), 'route' => 'audiocheck.page.nowPlaying', 'icon' => 'play'],
			['id' => 'library', 'label' => $this->l10n->t('Library'), 'route' => 'audiocheck.page.library', 'icon' => 'folder'],
			['id' => 'settings', 'label' => $this->l10n->t('Settings'), 'route' => 'audiocheck.page.settings', 'icon' => 'settings'],
		];
		if ($this->access->isAppAdmin($userId)) {
			$items[] = ['id' => 'app-settings', 'label' => $this->l10n->t('App settings'), 'route' => 'audiocheck.page.appSettings', 'icon' => 'admin-settings'];
		}
		$out = [];
		foreach ($items as $item) {
			$out[] = [
				'id' => $item['id'],
				'label' => $item['label'],
				'url' => $this->urlGenerator->linkToRoute($item['route']),
				'icon' => $item['icon'],
				'active' => $item['id'] === $activeView,
			];
		}
		return $out;
	}

	/** @return array<string, string> */
	private function buildUrls(): array
	{
		return [
			'apiTracks' => $this->urlGenerator->linkToRoute('audiocheck.api.listTracks'),
			'apiCollections' => $this->urlGenerator->linkToRoute('audiocheck.api.listCollections'),
			'apiProgress' => $this->urlGenerator->linkToRoute('audiocheck.api.getProgress'),
			'apiPlaylists' => $this->urlGenerator->linkToRoute('audiocheck.api.listPlaylists'),
			'apiLibraries' => $this->urlGenerator->linkToRoute('audiocheck.api.listLibraries'),
			'apiScan' => $this->urlGenerator->linkToRoute('audiocheck.api.scanStatus'),
			'apiPrefs' => $this->urlGenerator->linkToRoute('audiocheck.api.getPrefs'),
			'apiPolicy' => $this->urlGenerator->linkToRoute('audiocheck.api.getAppPolicy'),
			'stream' => $this->urlGenerator->linkToRoute('audiocheck.stream.play', ['fileId' => 'FILE_ID']),
			'cover' => $this->urlGenerator->linkToRoute('audiocheck.cover.get', ['fileId' => 'FILE_ID']),
		];
	}
}
