<?php
/** @var array $_ * @var \OCP\IL10N $l */

use OCA\AudioCheck\Service\IconCatalog;

\OCP\Util::addStyle('audiocheck', 'app');
?>
<?php include __DIR__ . '/navigation.php'; ?>
<div id="ac-nav-backdrop" class="ac-nav-backdrop" hidden></div>
<div id="app-content" class="ac-app"
	data-ac-view="<?php p($_['viewId'] ?? 'home'); ?>"
	data-ac-app-logo="<?php p((string)($_['appLogoUrl'] ?? '')); ?>"
	data-ac-is-admin="<?php p(!empty($_['isAppAdmin']) ? '1' : '0'); ?>"
	data-ac-urls="<?php p(json_encode($_['urls'] ?? [], JSON_THROW_ON_ERROR | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT)); ?>"
	data-ac-speed-presets="<?php p(json_encode($_['speedPresets'] ?? range(50, 400, 25), JSON_THROW_ON_ERROR)); ?>">
	<a class="ac-skip-link" href="#ac-main"><?php p($l->t('Skip to main content')); ?></a>
	<button type="button" id="ac-nav-toggle" class="ac-nav-toggle" aria-controls="app-navigation" aria-expanded="false"
		data-ac-nav-toggle
		data-aria-label-open="<?php p($l->t('Open menu')); ?>"
		data-aria-label-close="<?php p($l->t('Close menu')); ?>"
		aria-label="<?php p($l->t('Open menu')); ?>">
		<span class="ac-nav-toggle__icon" aria-hidden="true"><?php print_unescaped(IconCatalog::render('menu')); ?></span>
		<span class="ac-nav-toggle__label"><?php p($l->t('Menu')); ?></span>
	</button>
	<div class="ac-app__shell">
		<div class="ac-app__stage">
			<main id="ac-main" class="ac-main" role="main">
