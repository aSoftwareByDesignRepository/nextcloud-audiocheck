<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Listener;

use OCA\AudioCheck\AppInfo\Application;
use OCA\AudioCheck\Service\AccessControlService;
use OCA\AudioCheck\Service\MiniPlayerMarkupService;
use OCA\AudioCheck\Service\PlaybackStateService;
use OCA\AudioCheck\Service\PlayQueueService;
use OCA\AudioCheck\Service\UserPrefsService;
use OCP\App\IAppManager;
use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Services\IInitialState;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\IURLGenerator;
use OCP\IUserSession;
use OCP\Util;

/** @implements IEventListener<BeforeTemplateRenderedEvent> */
class BeforeTemplateRenderedListener implements IEventListener {
	public function __construct(
		private IURLGenerator $urlGenerator,
		private IAppManager $appManager,
		private IUserSession $userSession,
		private AccessControlService $accessControl,
		private UserPrefsService $userPrefs,
		private MiniPlayerMarkupService $miniPlayerMarkup,
		private PlayQueueService $playQueue,
		private PlaybackStateService $playback,
		private IInitialState $initialState,
	) {
	}

	public function handle(Event $event): void {
		if (!$event instanceof BeforeTemplateRenderedEvent) {
			return;
		}

		$response = $event->getResponse();
		if ($response->getRenderAs() !== TemplateResponse::RENDER_AS_USER) {
			return;
		}

		$user = $this->userSession->getUser();
		if ($user === null || !$this->accessControl->canUseApp($user->getUID())) {
			return;
		}

		$version = $this->appManager->getAppVersion(Application::APP_ID);
		$isAudioCheck = $response->getApp() === Application::APP_ID;

		if ($isAudioCheck) {
			// Cache-bust on app upgrades: linkTo() emits a bare URL, and browsers hold
			// stale copies for months otherwise (theme fixes would not reach users).
			Util::addHeader('link', [
				'rel' => 'stylesheet',
				'href' => $this->urlGenerator->linkTo(Application::APP_ID, 'css/theme-bind.css') . '?v=' . urlencode($version),
			]);
			return;
		}

		$this->registerGlobalMiniPlayer($user->getUID());
	}

	private function registerGlobalMiniPlayer(string $userId): void {
		// Hard gate: users who opt out must not pay for scripts/CSS or a covering bar.
		if (!$this->userPrefs->wantsGlobalMiniPlayer($userId)) {
			return;
		}

		$nowPlayingUrl = $this->urlGenerator->linkToRouteAbsolute('audiocheck.page.nowPlaying');
		$payload = $this->miniPlayerMarkup->buildGlobalPayload($nowPlayingUrl);
		// Hints only — never skip loading the player (sessionStorage can still restore).
		// Used to avoid flashing an empty “Loading playback…” bar for users with nothing queued.
		$payload['hasServerPlayback'] = $this->playQueue->hasPersistedItems($userId)
			|| $this->playback->hasUnfinishedProgress($userId);
		$payload['showGlobalMiniPlayer'] = true;
		// Cache-bust dynamically loaded player stack scripts after app upgrades.
		$payload['assetVersion'] = $this->appManager->getAppVersion(Application::APP_ID);
		$this->initialState->provideInitialState('global-mini-player', $payload);

		// Self-contained overlay CSS only — never pull full app.css onto Files/Dashboard.
		Util::addStyle(Application::APP_ID, 'global-mini-player');
		// Boot script lazy-loads the player stack when hasServerPlayback or session hint.
		Util::addScript(Application::APP_ID, 'global-mini-player');
	}
}