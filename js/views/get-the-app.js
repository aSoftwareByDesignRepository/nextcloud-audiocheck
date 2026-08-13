(function () {
	'use strict';

	const C = AudioCheckComponents;
	const PLAY_STORE_FALLBACK = 'https://play.google.com/store/apps/details?id=de.softwarebydesign.audiocheck';

	function readUrls() {
		try {
			const root = document.getElementById('app-content');
			const raw = root && root.dataset ? root.dataset.acUrls : '';
			if (!raw) return {};
			const parsed = JSON.parse(raw);
			return parsed && typeof parsed === 'object' ? parsed : {};
		} catch (_) {
			return {};
		}
	}

	function iconWell(name, extraClass) {
		const well = C.el('span', {
			className: 'ac-get-app__icon-well' + (extraClass ? ' ' + extraClass : ''),
			attrs: { 'aria-hidden': 'true' },
		});
		if (window.AudioCheckIcons && typeof AudioCheckIcons.mount === 'function') {
			AudioCheckIcons.mount(well, name);
		}
		return well;
	}

	function externalLink(href, className, children) {
		const a = C.el('a', {
			className: className,
			attrs: {
				href: href,
				target: '_blank',
				rel: 'noopener noreferrer',
			},
		});
		(Array.isArray(children) ? children : [children]).forEach((child) => {
			if (child == null || child === false) return;
			if (typeof child === 'string') a.appendChild(document.createTextNode(child));
			else a.appendChild(child);
		});
		return a;
	}

	function featureItem(icon, title, hint) {
		const li = C.el('li', { className: 'ac-get-app__feature' });
		li.appendChild(iconWell(icon, 'ac-get-app__icon-well--feature'));
		const copy = C.el('div', { className: 'ac-get-app__feature-copy' });
		copy.appendChild(C.el('span', { className: 'ac-get-app__feature-title', text: title }));
		copy.appendChild(C.el('span', { className: 'ac-get-app__feature-hint', text: hint }));
		li.appendChild(copy);
		return li;
	}

	function actionLink(href, label) {
		const a = externalLink(href, 'ac-get-app__action', [
			C.el('span', { className: 'ac-get-app__action-label', text: label }),
			C.el('span', {
				className: 'ac-get-app__action-external',
				attrs: { 'aria-hidden': 'true' },
				text: '↗',
			}),
		]);
		return a;
	}

	AudioCheckRouter.register('get-the-app', {
		render() {
			const urls = readUrls();
			const playStore = typeof urls.playStore === 'string' && urls.playStore.indexOf('https://play.google.com/') === 0
				? urls.playStore
				: PLAY_STORE_FALLBACK;
			const productPage = typeof urls.mobileProductPage === 'string' && urls.mobileProductPage.indexOf('https://') === 0
				? urls.mobileProductPage
				: '';
			const privacyPage = typeof urls.mobilePrivacyPage === 'string' && urls.mobilePrivacyPage.indexOf('https://') === 0
				? urls.mobilePrivacyPage
				: '';

			const frag = document.createDocumentFragment();
			const body = C.el('div', { className: 'ac-page-body ac-get-app-page ac-page-stack' });

			const hero = C.el('section', {
				className: 'ac-get-app__hero',
				attrs: { 'aria-labelledby': 'ac-get-app-intro-title' },
			});
			hero.appendChild(C.el('p', {
				className: 'ac-get-app__eyebrow',
				text: t('audiocheck', 'Official Android companion'),
			}));
			hero.appendChild(C.el('h2', {
				id: 'ac-get-app-intro-title',
				className: 'ac-get-app__title',
				text: t('audiocheck', 'AudioCheck Mobile'),
			}));
			hero.appendChild(C.el('p', {
				className: 'ac-get-app__lead',
				text: t('audiocheck', 'The official Android app connects to this Nextcloud. Stream or download your library — progress stays on your server.'),
			}));

			const cta = C.el('div', { className: 'ac-get-app__cta' });
			const playIcon = C.el('span', {
				className: 'ac-get-app__play-icon',
				attrs: { 'aria-hidden': 'true' },
			});
			if (window.AudioCheckIcons && typeof AudioCheckIcons.mount === 'function') {
				AudioCheckIcons.mount(playIcon, 'smartphone');
			}
			const playBtn = externalLink(playStore, 'ac-get-app__play', [
				playIcon,
				C.el('span', { className: 'ac-get-app__play-label', text: t('audiocheck', 'Get it on Google Play') }),
			]);
			cta.appendChild(playBtn);
			cta.appendChild(C.el('p', {
				className: 'ac-get-app__price-hint',
				text: t('audiocheck', 'One-time purchase in Google Play. The price for your country is shown on the listing. No public iOS app yet.'),
			}));
			hero.appendChild(cta);

			const features = C.el('section', {
				className: 'ac-get-app__features-block',
				attrs: { 'aria-labelledby': 'ac-get-app-features-title' },
			});
			features.appendChild(C.el('h2', {
				id: 'ac-get-app-features-title',
				className: 'ac-get-app__section-title',
				text: t('audiocheck', 'What you can do'),
			}));
			const list = C.el('ul', { className: 'ac-get-app__features' });
			const featureRows = [
				['browse', t('audiocheck', 'Your library on your phone'), t('audiocheck', 'Browse music and audiobooks from your Nextcloud — same library as the web app.')],
				['rotate-ccw', t('audiocheck', 'Continue where you left off'), t('audiocheck', 'Listening progress syncs to your server so phone and browser stay in step.')],
				['folder', t('audiocheck', 'Download for offline listening'), t('audiocheck', 'Save titles to the device and keep listening without a network.')],
				['play', t('audiocheck', 'Background playback controls'), t('audiocheck', 'Speed control, sleep timer, queue, favourites, and playlists while you are away from the screen.')],
				['admin-settings', t('audiocheck', 'Sign in safely'), t('audiocheck', 'Uses Nextcloud Login Flow — your main password is never stored in the app.')],
			];
			featureRows.forEach(([icon, title, hint]) => list.appendChild(featureItem(icon, title, hint)));
			features.appendChild(list);

			const actions = [];
			if (productPage) {
				actions.push(actionLink(productPage, t('audiocheck', 'Product page with screenshots')));
			}
			if (privacyPage) {
				actions.push(actionLink(privacyPage, t('audiocheck', 'Privacy policy for the mobile app')));
			}

			body.appendChild(hero);
			body.appendChild(features);
			if (actions.length > 0) {
				const nav = C.el('nav', {
					className: 'ac-get-app__actions',
					attrs: { 'aria-label': t('audiocheck', 'More information') },
				});
				actions.forEach((row) => nav.appendChild(row));
				body.appendChild(nav);
			}
			frag.appendChild(body);
			return frag;
		},
	});
})();
