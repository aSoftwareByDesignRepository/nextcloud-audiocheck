<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Settings;

use OCA\AudioCheck\AppInfo\Application;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\Settings\ISettings;

class AdminSettings implements ISettings
{
	public function __construct(
		private IL10N $l10n,
		private IURLGenerator $urlGenerator,
	) {
	}

	public function getForm(): TemplateResponse
	{
		return new TemplateResponse(Application::APP_ID, 'admin-settings', [
			'appSettingsUrl' => $this->urlGenerator->linkToRoute('audiocheck.page.appSettings'),
		], '');
	}

	public function getSection(): string
	{
		return Application::APP_ID;
	}

	public function getPriority(): int
	{
		return 50;
	}
}
