<?php
/** @var array $_ * @var \OCP\IL10N $l */

use OCA\AudioCheck\Service\IconCatalog;
?>
<nav id="app-navigation" class="ac-nav" role="navigation" aria-label="<?php p($l->t('AudioCheck navigation')); ?>">
	<div class="ac-nav__brand">
		<span class="ac-nav__logo-badge" aria-hidden="true">
			<img class="ac-nav__logo" src="<?php p((string)($_['appLogoUrl'] ?? '')); ?>" alt="" width="20" height="20" decoding="async" />
		</span>
		<span class="ac-nav__name"><?php p($l->t('AudioCheck')); ?></span>
	</div>
	<ul class="ac-nav__list">
		<?php foreach (($_['navigation'] ?? []) as $item): ?>
		<li data-ac-nav-id="<?php p((string)$item['id']); ?>"<?php if (($item['id'] ?? '') === 'now-playing'): ?> hidden<?php endif; ?>>
			<a href="<?php p((string)$item['url']); ?>"
				class="ac-nav__link<?php if (!empty($item['active'])): ?> ac-nav__link--active<?php endif; ?>"
				<?php if (!empty($item['active'])): ?>aria-current="page"<?php endif; ?>>
				<span class="ac-nav__icon" aria-hidden="true">
					<?php print_unescaped(IconCatalog::render((string)($item['icon'] ?? 'browse'))); ?>
				</span>
				<span class="ac-nav__label"><?php p((string)$item['label']); ?></span>
			</a>
		</li>
		<?php endforeach; ?>
	</ul>
</nav>
