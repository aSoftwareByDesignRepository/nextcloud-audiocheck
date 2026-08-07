<?php
/**
 * @var array $_
 * @var \OCP\IL10N $l
 */
\OCP\Util::addStyle('audiocheck', 'app');
?>
<div id="app-content" class="ac-app ac-app--access-denied">
	<a class="ac-skip-link" href="#ac-denied-main"><?php p($l->t('Skip to main content')); ?></a>
	<div class="ac-denied">
		<section id="ac-denied-main" class="ac-empty-state ac-empty--page" role="alert" aria-labelledby="ac-denied-title" tabindex="-1">
			<h1 id="ac-denied-title" class="ac-empty-state__title"><?php p($l->t('Access denied')); ?></h1>
			<p class="ac-empty-state__text"><?php p($_['message'] ?? $l->t('You are not allowed to use AudioCheck right now.')); ?></p>
			<p class="ac-empty-state__actions">
				<a class="ac-btn ac-btn--primary" href="<?php p((string)($_['homeUrl'] ?? '/')); ?>"><?php p($l->t('Back to Nextcloud')); ?></a>
			</p>
		</section>
	</div>
</div>
