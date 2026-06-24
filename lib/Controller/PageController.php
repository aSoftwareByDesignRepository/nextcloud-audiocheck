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
			'navigationGroups' => $this->buildNavigationGroups($viewId),
			'viewMeta' => $this->buildViewMeta(),
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
			'common/track-list-ui',
			'common/entity-picker',
			'common/folder-picker',
			'common/queue-merge',
			'common/queue-playback-mode',
			'common/global-search',
			'common/global-search-ui',
			'common/playlist-actions',
			'common/playback-start',
			'common/library-page-ui',
			'common/sleep-timer',
			'common/page-chrome',
			'common/router',
			'common/player',
			'common/media-library-page',
			'common/facet-browse-page',
			'common/mobile-nav',
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
	private function buildNavigationGroups(string $activeView): array
	{
		$userId = $this->access->currentUserId();
		$listen = [
			['id' => 'home', 'label' => $this->l10n->t('Home'), 'hint' => $this->l10n->t('Continue listening and shelves'), 'route' => 'audiocheck.page.index', 'icon' => 'home'],
			['id' => 'audiobooks', 'label' => $this->l10n->t('Audiobooks'), 'hint' => $this->l10n->t('Books and long-form audio'), 'route' => 'audiocheck.page.audiobooks', 'icon' => 'audiobook'],
			['id' => 'music', 'label' => $this->l10n->t('Music'), 'hint' => $this->l10n->t('Albums, artists, and tracks'), 'route' => 'audiocheck.page.music', 'icon' => 'music'],
			['id' => 'playlists', 'label' => $this->l10n->t('Playlists'), 'hint' => $this->l10n->t('Favorites and your lists'), 'route' => 'audiocheck.page.playlists', 'icon' => 'playlist'],
			['id' => 'browse', 'label' => $this->l10n->t('Browse'), 'hint' => $this->l10n->t('Artists, genres, folders, tags'), 'route' => 'audiocheck.page.browse', 'icon' => 'browse'],
			['id' => 'now-playing', 'label' => $this->l10n->t('Now playing'), 'hint' => $this->l10n->t('Full player, queue, chapters'), 'route' => 'audiocheck.page.nowPlaying', 'icon' => 'play'],
		];
		$library = [
			['id' => 'library', 'label' => $this->l10n->t('Library'), 'hint' => $this->l10n->t('Folders to scan and status'), 'route' => 'audiocheck.page.library', 'icon' => 'folder'],
		];
		$account = [
			['id' => 'settings', 'label' => $this->l10n->t('Settings'), 'hint' => $this->l10n->t('Playback and scan preferences'), 'route' => 'audiocheck.page.settings', 'icon' => 'settings'],
		];
		if ($this->access->isAppAdmin($userId)) {
			$account[] = ['id' => 'app-settings', 'label' => $this->l10n->t('App settings'), 'hint' => $this->l10n->t('Access policy and defaults'), 'route' => 'audiocheck.page.appSettings', 'icon' => 'admin-settings'];
		}
		$groups = [
			['title' => $this->l10n->t('Listen'), 'items' => $this->mapNavItems($listen, $activeView)],
			['title' => $this->l10n->t('Library'), 'items' => $this->mapNavItems($library, $activeView)],
			['title' => $this->l10n->t('Account'), 'items' => $this->mapNavItems($account, $activeView)],
		];
		return $groups;
	}

	/**
	 * @param list<array<string, string>> $items
	 * @return list<array<string, mixed>>
	 */
	private function mapNavItems(array $items, string $activeView): array
	{
		$out = [];
		foreach ($items as $item) {
			$out[] = [
				'id' => $item['id'],
				'label' => $item['label'],
				'hint' => $item['hint'] ?? '',
				'url' => $this->urlGenerator->linkToRoute($item['route']),
				'icon' => $item['icon'],
				'active' => $item['id'] === $activeView || ($activeView === 'playlist' && $item['id'] === 'playlists'),
			];
		}
		return $out;
	}

	/** @return array<string, array{title: string, help: string, icon: string}> */
	private function buildViewMeta(): array
	{
		return [
			'home' => ['title' => $this->l10n->t('Home'), 'help' => $this->l10n->t('Continue listening and discover your audio library.'), 'icon' => 'home'],
			'audiobooks' => ['title' => $this->l10n->t('Audiobooks'), 'help' => $this->l10n->t('Browse audiobook titles, folders, and books.'), 'icon' => 'audiobook'],
			'music' => ['title' => $this->l10n->t('Music'), 'help' => $this->l10n->t('Browse tracks, folders, and albums.'), 'icon' => 'music'],
			'playlists' => ['title' => $this->l10n->t('Playlists'), 'help' => $this->l10n->t('Built-in Favorites and playlists you create.'), 'icon' => 'playlist'],
			'playlist' => ['title' => $this->l10n->t('Playlist'), 'help' => $this->l10n->t('View and play playlist tracks.'), 'icon' => 'playlist'],
			'browse' => ['title' => $this->l10n->t('Browse'), 'help' => $this->l10n->t('Explore artists, genres, folders, and favorites.'), 'icon' => 'browse'],
			'now-playing' => ['title' => $this->l10n->t('Now playing'), 'help' => $this->l10n->t('Full player, queue, and chapters.'), 'icon' => 'play'],
			'library' => ['title' => $this->l10n->t('Library'), 'help' => $this->l10n->t('Choose folders to scan, then index your audio.'), 'icon' => 'folder'],
			'settings' => ['title' => $this->l10n->t('Settings'), 'help' => $this->l10n->t('Personal playback and scan preferences.'), 'icon' => 'settings'],
			'app-settings' => ['title' => $this->l10n->t('App settings'), 'help' => $this->l10n->t('Access policy and defaults for AudioCheck.'), 'icon' => 'admin-settings'],
		];
	}

	/** @return array<string, string> */
	private function buildUrls(): array
	{
		return [
			'home' => $this->urlGenerator->linkToRoute('audiocheck.page.index'),
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
