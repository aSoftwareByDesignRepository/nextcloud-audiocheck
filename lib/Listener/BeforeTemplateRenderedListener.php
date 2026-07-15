<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Listener;

use OCA\AudioCheck\AppInfo\Application;
use OCP\App\IAppManager;
use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\IURLGenerator;
use OCP\Util;

/** @implements IEventListener<BeforeTemplateRenderedEvent> */
class BeforeTemplateRenderedListener implements IEventListener {
	public function __construct(
		private IURLGenerator $urlGenerator,
		private IAppManager $appManager,
	) {
	}

	public function handle(Event $event): void {
		if (!$event instanceof BeforeTemplateRenderedEvent) {
			return;
		}

		$response = $event->getResponse();
		if ($response->getApp() !== Application::APP_ID) {
			return;
		}

		if ($response->getRenderAs() !== TemplateResponse::RENDER_AS_USER) {
			return;
		}

		// Cache-bust on app upgrades: linkTo() emits a bare URL, and browsers hold
		// stale copies for months otherwise (theme fixes would not reach users).
		$version = $this->appManager->getAppVersion(Application::APP_ID);
		Util::addHeader('link', [
			'rel' => 'stylesheet',
			'href' => $this->urlGenerator->linkTo(Application::APP_ID, 'css/theme-bind.css') . '?v=' . urlencode($version),
		]);
	}
}
