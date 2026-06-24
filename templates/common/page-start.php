<?php
/**
 * AudioCheck persistent shell — sidebar + content chrome (BudgetCheck / MobilityCheck parity).
 *
 * @var array $_
 * @var \OCP\IL10N $l
 */

use OCA\AudioCheck\Service\IconCatalog;

$pageId = (string)($_['viewId'] ?? 'home');
$pageTitle = (string)($_['pageTitle'] ?? $l->t('AudioCheck'));
$pageHelp = (string)($_['pageHelp'] ?? '');
$urls = (array)($_['urls'] ?? []);
$viewMeta = $_['viewMeta'] ?? [];
$headerIcons = [
	'home' => 'home',
	'audiobooks' => 'audiobook',
	'music' => 'music',
	'playlists' => 'playlist',
	'playlist' => 'playlist',
	'browse' => 'browse',
	'now-playing' => 'play',
	'library' => 'folder',
	'settings' => 'settings',
	'app-settings' => 'admin-settings',
];
$headerIcon = $headerIcons[$pageId] ?? 'home';
$viewMetaJson = htmlspecialchars(json_encode($viewMeta, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE), ENT_QUOTES, 'UTF-8');
$urlsJson = htmlspecialchars(json_encode($urls, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE), ENT_QUOTES, 'UTF-8');
?>
<?php include __DIR__ . '/navigation.php'; ?>
<div id="ac-nav-backdrop" class="ac-nav-backdrop" hidden></div>
<div id="app-content" class="ac-app ac-app--<?php p($pageId); ?>"
	data-ac-view="<?php p($pageId); ?>"
	data-ac-app-logo="<?php p((string)($_['appLogoUrl'] ?? '')); ?>"
	data-ac-is-admin="<?php p(!empty($_['isAppAdmin']) ? '1' : '0'); ?>"
	data-ac-urls="<?php print_unescaped($urlsJson); ?>"
	data-ac-view-meta="<?php print_unescaped($viewMetaJson); ?>"
	data-ac-speed-presets="<?php p(json_encode($_['speedPresets'] ?? range(50, 400, 25), JSON_THROW_ON_ERROR)); ?>">
	<a class="ac-skip-link" href="#ac-main"><?php p($l->t('Skip to main content')); ?></a>
	<div id="ac-live-region" class="ac-sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
	<div id="ac-alert-region" class="ac-sr-only" role="alert" aria-live="assertive" aria-atomic="true"></div>
	<button type="button" id="ac-nav-toggle" class="ac-nav-toggle" aria-controls="app-navigation" aria-expanded="false"
		data-ac-nav-toggle
		data-aria-label-open="<?php p($l->t('Open menu')); ?>"
		data-aria-label-close="<?php p($l->t('Close menu')); ?>"
		aria-label="<?php p($l->t('Open menu')); ?>">
		<span class="ac-nav-toggle__icon" aria-hidden="true"><?php print_unescaped(IconCatalog::render('menu')); ?></span>
		<span class="ac-nav-toggle__label"><?php p($l->t('Menu')); ?></span>
	</button>
	<div id="app-content-wrapper" class="ac-shell">
		<header class="ac-page-header" aria-labelledby="ac-page-title">
			<nav class="ac-breadcrumb" aria-label="<?php p($l->t('Breadcrumb')); ?>">
				<ol>
					<li><a class="ac-breadcrumb__brand" href="<?php p((string)($urls['home'] ?? '#')); ?>"><?php p($l->t('AudioCheck')); ?></a></li>
					<li class="ac-breadcrumb__sep" aria-hidden="true">/</li>
					<li class="ac-breadcrumb__current" id="ac-breadcrumb-current" aria-current="page"><?php p($pageTitle); ?></li>
				</ol>
			</nav>
			<div class="ac-page-header__main">
				<div class="ac-page-header__icon" id="ac-page-header-icon" aria-hidden="true">
					<?php print_unescaped(IconCatalog::render($headerIcon, 'ac-page-header__icon-svg')); ?>
				</div>
				<div class="ac-page-header__text">
					<h1 id="ac-page-title"><?php p($pageTitle); ?></h1>
					<p class="ac-page-header__lead" id="ac-page-lead"><?php p($pageHelp); ?></p>
				</div>
				<div id="ac-page-actions" class="ac-page-header__actions" aria-live="polite"></div>
			</div>
			<div class="ac-scope-strip" id="ac-scope-strip" aria-label="<?php p($l->t('Playback context')); ?>">
				<span class="ac-scope-strip__label"><?php p($l->t('Status')); ?></span>
				<span class="ac-badge ac-scope-strip__badge" id="ac-scope-status"><?php p($l->t('Ready')); ?></span>
				<span aria-hidden="true">·</span>
				<span class="ac-scope-strip__value" id="ac-scope-detail"><?php p($l->t('Your audio library in Nextcloud')); ?></span>
			</div>
			<div id="ac-global-search" class="ac-global-search" hidden aria-hidden="true"></div>
		</header>
		<main id="ac-main" class="ac-main" role="main" tabindex="-1" data-ac-view="<?php p($pageId); ?>">
