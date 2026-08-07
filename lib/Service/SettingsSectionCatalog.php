<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Service;

use OCP\IL10N;

/**
 * Single source of truth for AudioCheck app-settings sub-pages.
 *
 * Artifacts that must stay in sync (pinned by contract tests):
 *  - appinfo/routes.php `{section}` requirement
 *  - PageController validation / titles / URL map / sidebar children
 *  - js/common/router.js path regex
 *  - js/views/app-settings.js SECTION_ORDER / chip bar
 */
final class SettingsSectionCatalog
{
	public const DEFAULT_SECTION = 'access';

	/**
	 * Ordered section slugs — order drives sidebar + chip bar.
	 *
	 * @var list<string>
	 */
	public const SECTIONS = [
		'access',
		'admins',
		'defaults',
		'support',
	];

	public function isSection(string $section): bool
	{
		return in_array($section, self::SECTIONS, true);
	}

	public static function routeRequirement(): string
	{
		return implode('|', self::SECTIONS);
	}

	public function label(IL10N $l, string $section): string
	{
		return match ($section) {
			'access' => $l->t('Access control'),
			'admins' => $l->t('App administrators'),
			'defaults' => $l->t('New user defaults'),
			'support' => $l->t('Support & us'),
			default => $l->t('App settings'),
		};
	}

	public function navLabel(IL10N $l, string $section): string
	{
		return match ($section) {
			'access' => $l->t('Access'),
			'admins' => $l->t('Admins'),
			'defaults' => $l->t('Defaults'),
			'support' => $l->t('Support'),
			default => $l->t('App settings'),
		};
	}

	public function help(IL10N $l, string $section): string
	{
		return match ($section) {
			'access' => $l->t('Choose Open for everyone, or Restricted to pick people and groups.'),
			'admins' => $l->t('Delegated admins can change policy here. They still only play their own files.'),
			'defaults' => $l->t('Suggested library folder and metadata extraction limits for new users.'),
			'support' => $l->t('How to get help, report bugs, and support AudioCheck development.'),
			default => $l->t('Access policy and defaults for AudioCheck.'),
		};
	}
}
