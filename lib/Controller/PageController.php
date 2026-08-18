<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Controller;

use OCA\AudioCheck\AppInfo\Application;
use OCA\AudioCheck\Service\AccessControlService;
use OCA\AudioCheck\Service\PlaybackStateService;
use OCA\AudioCheck\Service\SettingsSectionCatalog;
use OCA\AudioCheck\Support\MobileAppLinks;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\RedirectResponse;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IConfig;
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
		private IConfig $config,
		private SettingsSectionCatalog $settingsSections,
		private MobileAppLinks $mobileAppLinks,
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
	public function getTheApp(): TemplateResponse
	{
		return $this->shell(
			'get-the-app',
			$this->l10n->t('Get the App'),
			$this->l10n->t('Official Android app — features and Google Play download.'),
		);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function appSettingsIndex(): RedirectResponse
	{
		try {
			$this->access->requireAppAdmin();
		} catch (\Throwable) {
			return new RedirectResponse($this->urlGenerator->linkToRoute('audiocheck.page.index'));
		}
		return new RedirectResponse($this->urlGenerator->linkToRoute(
			'audiocheck.page.appSettings',
			['section' => SettingsSectionCatalog::DEFAULT_SECTION],
		));
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function appSettings(string $section): RedirectResponse|TemplateResponse
	{
		try {
			$this->access->requireAppAdmin();
		} catch (\Throwable) {
			return new RedirectResponse($this->urlGenerator->linkToRoute('audiocheck.page.index'));
		}
		if (!$this->settingsSections->isSection($section)) {
			return new RedirectResponse($this->urlGenerator->linkToRoute(
				'audiocheck.page.appSettings',
				['section' => SettingsSectionCatalog::DEFAULT_SECTION],
			));
		}
		return $this->shell(
			'app-settings',
			$this->settingsSections->label($this->l10n, $section),
			$this->settingsSections->help($this->l10n, $section),
			['settingsSection' => $section],
		);
	}

	/** @param array<string, mixed> $extra */
	private function shell(string $viewId, string $title, string $help, array $extra = []): TemplateResponse
	{
		$userId = $this->access->currentUserId();
		$this->registerFrontEndAssets();

		$timezone = 'UTC';
		if ($userId !== '') {
			$timezone = $this->config->getUserValue(
				$userId,
				'core',
				'timezone',
				$this->config->getSystemValueString('default_timezone', 'UTC'),
			) ?: 'UTC';
		}
		$htmlLang = str_replace('_', '-', $this->l10n->getLanguageCode());

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
			'htmlLang' => $htmlLang,
			'timezone' => $timezone,
			'locale' => $this->l10n->getLocaleCode(),
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
			'common/app-feedback',
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
			'common/seek-jump',
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
			'views/get-the-app',
			'common/support-us',
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
			['id' => 'get-the-app', 'label' => $this->l10n->t('Get the App'), 'hint' => $this->l10n->t('Android app on Google Play'), 'route' => 'audiocheck.page.getTheApp', 'icon' => 'smartphone'],
		];
		if ($this->access->isAppAdmin($userId)) {
			$settingsChildren = [];
			foreach (SettingsSectionCatalog::SECTIONS as $sectionId) {
				$settingsChildren[] = [
					'id' => 'app-settings-' . $sectionId,
					'label' => $this->settingsSections->navLabel($this->l10n, $sectionId),
					'hint' => '',
					'url' => $this->urlGenerator->linkToRoute('audiocheck.page.appSettings', ['section' => $sectionId]),
					'section' => $sectionId,
				];
			}
			$account[] = [
				'id' => 'app-settings',
				'label' => $this->l10n->t('App settings'),
				'hint' => $this->l10n->t('Access policy and defaults'),
				'route' => 'audiocheck.page.appSettings',
				'routeParams' => ['section' => SettingsSectionCatalog::DEFAULT_SECTION],
				'icon' => 'admin-settings',
				'children' => $settingsChildren,
			];
		}
		$groups = [
			['title' => $this->l10n->t('Listen'), 'items' => $this->mapNavItems($listen, $activeView)],
			['title' => $this->l10n->t('Library'), 'items' => $this->mapNavItems($library, $activeView)],
			['title' => $this->l10n->t('Account'), 'items' => $this->mapNavItems($account, $activeView)],
		];
		return $groups;
	}

	/**
	 * @param list<array<string, mixed>> $items
	 * @return list<array<string, mixed>>
	 */
	private function mapNavItems(array $items, string $activeView): array
	{
		$activeSection = $this->request->getParam('section');
		$out = [];
		foreach ($items as $item) {
			$routeParams = is_array($item['routeParams'] ?? null) ? $item['routeParams'] : [];
			$url = isset($item['url'])
				? (string)$item['url']
				: $this->urlGenerator->linkToRoute((string)$item['route'], $routeParams);
			$isAppSettings = ($item['id'] ?? '') === 'app-settings';
			$active = ($item['id'] === $activeView)
				|| ($activeView === 'playlist' && $item['id'] === 'playlists')
				|| ($isAppSettings && $activeView === 'app-settings');
			$mapped = [
				'id' => $item['id'],
				'label' => $item['label'],
				'hint' => $item['hint'] ?? '',
				'url' => $url,
				'icon' => $item['icon'] ?? 'browse',
				'active' => $active,
			];
			if (!empty($item['children']) && is_array($item['children'])) {
				$children = [];
				foreach ($item['children'] as $child) {
					$section = (string)($child['section'] ?? '');
					$childActive = $activeView === 'app-settings' && $section !== '' && $section === $activeSection;
					$children[] = [
						'id' => $child['id'],
						'label' => $child['label'],
						'hint' => $child['hint'] ?? '',
						'url' => $child['url'],
						'active' => $childActive,
					];
				}
				$mapped['children'] = $children;
				$mapped['expanded'] = $activeView === 'app-settings';
			}
			$out[] = $mapped;
		}
		return $out;
	}

	/** @return array<string, array{title: string, help: string, icon: string}> */
	private function buildViewMeta(): array
	{
		$meta = [
			'home' => ['title' => $this->l10n->t('Home'), 'help' => $this->l10n->t('Continue listening and discover your audio library.'), 'icon' => 'home'],
			'audiobooks' => ['title' => $this->l10n->t('Audiobooks'), 'help' => $this->l10n->t('Browse audiobook titles, folders, and books.'), 'icon' => 'audiobook'],
			'music' => ['title' => $this->l10n->t('Music'), 'help' => $this->l10n->t('Browse tracks, folders, and albums.'), 'icon' => 'music'],
			'playlists' => ['title' => $this->l10n->t('Playlists'), 'help' => $this->l10n->t('Built-in Favorites and playlists you create.'), 'icon' => 'playlist'],
			'playlist' => ['title' => $this->l10n->t('Playlist'), 'help' => $this->l10n->t('View and play playlist tracks.'), 'icon' => 'playlist'],
			'browse' => ['title' => $this->l10n->t('Browse'), 'help' => $this->l10n->t('Explore artists, genres, folders, and favorites.'), 'icon' => 'browse'],
			'now-playing' => ['title' => $this->l10n->t('Now playing'), 'help' => $this->l10n->t('Full player, queue, and chapters.'), 'icon' => 'play'],
			'library' => ['title' => $this->l10n->t('Library'), 'help' => $this->l10n->t('Choose folders to scan, then index your audio.'), 'icon' => 'folder'],
			'settings' => ['title' => $this->l10n->t('Settings'), 'help' => $this->l10n->t('Personal playback and scan preferences.'), 'icon' => 'settings'],
			'get-the-app' => ['title' => $this->l10n->t('Get the App'), 'help' => $this->l10n->t('Official Android app — features and Google Play download.'), 'icon' => 'smartphone'],
			'app-settings' => ['title' => $this->l10n->t('App settings'), 'help' => $this->l10n->t('Access policy and defaults for AudioCheck.'), 'icon' => 'admin-settings'],
		];
		foreach (SettingsSectionCatalog::SECTIONS as $sectionId) {
			$meta['app-settings:' . $sectionId] = [
				'title' => $this->settingsSections->label($this->l10n, $sectionId),
				'help' => $this->settingsSections->help($this->l10n, $sectionId),
				'icon' => 'admin-settings',
			];
		}
		return $meta;
	}

	/** @return array<string, mixed> */
	private function buildUrls(): array
	{
		$settingsSections = [];
		foreach (SettingsSectionCatalog::SECTIONS as $sectionId) {
			$settingsSections[$sectionId] = $this->urlGenerator->linkToRoute(
				'audiocheck.page.appSettings',
				['section' => $sectionId],
			);
		}
		$lang = $this->l10n->getLanguageCode();
		return [
			'home' => $this->urlGenerator->linkToRoute('audiocheck.page.index'),
			'appSettings' => $this->urlGenerator->linkToRoute(
				'audiocheck.page.appSettings',
				['section' => SettingsSectionCatalog::DEFAULT_SECTION],
			),
			'settingsSections' => $settingsSections,
			'getTheApp' => $this->urlGenerator->linkToRoute('audiocheck.page.getTheApp'),
			'playStore' => $this->mobileAppLinks->playStoreUrl(),
			'mobileProductPage' => $this->mobileAppLinks->productPageUrl($lang),
			'mobilePrivacyPage' => $this->mobileAppLinks->privacyPageUrl($lang),
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
