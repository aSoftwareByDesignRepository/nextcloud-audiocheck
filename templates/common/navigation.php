<?php
/** @var array $_ * @var \OCP\IL10N $l */

use OCA\AudioCheck\Service\IconCatalog;

$navGroups = $_['navigationGroups'] ?? [];
?>
<nav id="app-navigation" class="ac-nav" role="navigation" aria-label="<?php p($l->t('AudioCheck navigation')); ?>">
	<div class="ac-nav__brand">
		<span class="ac-nav__logo-badge" aria-hidden="true">
			<img class="ac-nav__logo" src="<?php p((string)($_['appLogoUrl'] ?? '')); ?>" alt="" width="20" height="20" decoding="async" />
		</span>
		<div class="ac-nav__brand-text">
			<h2 class="ac-nav__title"><?php p($l->t('AudioCheck')); ?></h2>
			<p class="ac-nav__subtitle"><?php p($l->t('Music and audiobooks from your files')); ?></p>
		</div>
	</div>
	<?php foreach ($navGroups as $group): ?>
		<div class="ac-nav__group">
			<?php if (!empty($group['title'])): ?>
				<p class="ac-nav__group-title"><?php p((string)$group['title']); ?></p>
			<?php endif; ?>
			<ul class="ac-nav__list">
				<?php foreach (($group['items'] ?? []) as $item): ?>
				<li class="ac-nav__item<?php if (($item['id'] ?? '') === 'now-playing'): ?> ac-nav__item--now-playing<?php endif; ?>"
					data-ac-nav-id="<?php p((string)$item['id']); ?>"<?php if (($item['id'] ?? '') === 'now-playing'): ?> hidden<?php endif; ?>>
					<a href="<?php p((string)$item['url']); ?>"
						class="ac-nav__link<?php if (!empty($item['active'])): ?> ac-nav__link--active is-active active<?php endif; ?>"
						<?php if (!empty($item['active'])): ?>aria-current="page"<?php endif; ?>>
						<span class="ac-nav__icon" aria-hidden="true">
							<?php print_unescaped(IconCatalog::render((string)($item['icon'] ?? 'browse'))); ?>
						</span>
						<span class="ac-nav__label">
							<span class="ac-nav__name"><?php p((string)$item['label']); ?></span>
							<?php if (!empty($item['hint'])): ?>
								<span class="ac-nav__hint"><?php p((string)$item['hint']); ?></span>
							<?php endif; ?>
						</span>
					</a>
				</li>
				<?php endforeach; ?>
			</ul>
		</div>
	<?php endforeach; ?>
</nav>
