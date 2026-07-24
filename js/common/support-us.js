/**
 * Support & Us — JS render helper for SPA admin settings (AudioCheck / DeskCheck).
 * Prefix: ac · App: AudioCheck
 *
 * Security: URLs/mailtos come from SupportUsLinks-equivalent constants only.
 * No user input is interpolated into hrefs.
 */
(function (global) {
	'use strict';

	var CONTACT_EMAIL = 'info@software-by-design.de';
	var SPONSORS_URL = 'https://github.com/sponsors/aSoftwareByDesignRepository';
	var SITE_ORIGIN = 'https://nextcloud.software-by-design.de';
	var VENDOR_NAME = 'Software by Design GbR';
	var APP_NAME = 'AudioCheck';
	var PREFIX = 'ac';

	function isGermanLocale(lang) {
		var normalized = String(lang || '').toLowerCase().replace('_', '-');
		return normalized.indexOf('de') === 0;
	}

	function mailtoSubject(subject) {
		return 'mailto:' + CONTACT_EMAIL + '?subject=' + encodeURIComponent(subject);
	}

	function linksFor(lang) {
		var de = isGermanLocale(lang);
		return {
			partnerMailto: mailtoSubject(
				de ? APP_NAME + ': Partner / Care Retainer' : APP_NAME + ': partner / care retainer'
			),
			onboardingMailto: mailtoSubject(APP_NAME + ': Einrichtung / Schulung'),
			featureMailto: mailtoSubject(APP_NAME + ': Feature-Auftrag'),
			supportPageUrl: SITE_ORIGIN + (de ? '/de/support.html' : '/en/support.html'),
			appsPageUrl: SITE_ORIGIN + (de ? '/de/apps.html' : '/en/apps.html'),
			sponsorsUrl: SPONSORS_URL,
			contactMailto: 'mailto:' + CONTACT_EMAIL,
			contactEmail: CONTACT_EMAIL,
			vendorName: VENDOR_NAME
		};
	}

	function t(appId, key, args) {
		if (typeof global.t === 'function') {
			return global.t(appId, key, args);
		}
		if (args && args[0] !== undefined && key.indexOf('%s') !== -1) {
			return key.replace('%s', String(args[0]));
		}
		return key;
	}

	function el(tag, attrs, children) {
		var node = document.createElement(tag);
		if (attrs) {
			Object.keys(attrs).forEach(function (k) {
				if (k === 'className') {
					node.className = attrs[k];
				} else if (k === 'text') {
					node.textContent = attrs[k];
				} else if (attrs[k] !== undefined && attrs[k] !== null) {
					node.setAttribute(k, String(attrs[k]));
				}
			});
		}
		(children || []).forEach(function (child) {
			if (child) {
				node.appendChild(child);
			}
		});
		return node;
	}

	/**
	 * @param {HTMLElement} mountParent
	 * @param {{ appId: string, language?: string }} options
	 */
	function renderSupportUsSection(mountParent, options) {
		if (!mountParent || mountParent.querySelector('[data-support-us="1"]')) {
			return null;
		}
		var appId = (options && options.appId) || 'audiocheck';
		var lang = (options && options.language) || (global.OC && OC.getLanguage && OC.getLanguage()) || 'en';
		var L = linksFor(lang);
		var titleId = PREFIX + '-support-us-title';
		var introId = PREFIX + '-support-us-intro';

		var intro = t(
			appId,
			'%s stays free (AGPL) on your Nextcloud. GitHub issues for bugs and ideas remain welcome. For bookable help on an invoice — setup, hour packs, commissioned work — or the official mobile app:',
			[APP_NAME]
		);

		var section = el('section', {
			className: PREFIX + '-card ' + PREFIX + '-section ' + PREFIX + '-support-us',
			id: PREFIX + '-support-us',
			'aria-labelledby': titleId,
			'aria-describedby': introId,
			'data-support-us': '1'
		});

		var header = el('header', { className: PREFIX + '-section__header ' + PREFIX + '-support-us__header' }, [
			el('div', null, [
				el('h2', { id: titleId, className: PREFIX + '-support-us__title', text: t(appId, 'Support & us') }),
				el('p', { id: introId, className: PREFIX + '-support-us__intro', text: intro })
			])
		]);

		var primaryCta = el('a', {
			className: 'button primary ' + PREFIX + '-support-us__cta ' + PREFIX + '-support-us__cta--primary',
			href: L.partnerMailto,
			text: t(appId, 'Ask for a partner offer')
		});
		var hint = el('p', { className: PREFIX + '-support-us__hint' });
		hint.appendChild(document.createTextNode(t(appId, 'Annual hour pack + priority response — details in the offer / on our site.') + ' '));
		hint.appendChild(el('a', {
			href: L.supportPageUrl,
			target: '_blank',
			rel: 'noopener noreferrer',
			text: t(appId, 'Open support page')
		}));

		var primary = el('div', { className: PREFIX + '-support-us__primary' }, [primaryCta, hint]);

		var secondary = el('div', {
			className: PREFIX + '-support-us__secondary',
			role: 'group',
			'aria-label': t(appId, 'Additional support options')
		}, [
			el('a', {
				className: 'button ' + PREFIX + '-support-us__cta',
				href: L.onboardingMailto,
				text: t(appId, 'Ask about setup or training')
			}),
			el('a', {
				className: 'button ' + PREFIX + '-support-us__cta',
				href: L.featureMailto,
				text: t(appId, 'Request a commissioned feature')
			})
		]);

		var more = el('p', { className: PREFIX + '-support-us__more' });
		more.appendChild(el('a', {
			href: L.appsPageUrl,
			target: '_blank',
			rel: 'noopener noreferrer',
			text: t(appId, 'More Check apps')
		}));
		more.appendChild(document.createTextNode(' · '));
		more.appendChild(el('a', {
			href: L.sponsorsUrl,
			target: '_blank',
			rel: 'noopener noreferrer',
			text: t(appId, 'GitHub Sponsors (voluntary, no invoice SLA)')
		}));

		var contact = el('p', { className: PREFIX + '-support-us__contact' });
		contact.appendChild(el('a', { href: L.contactMailto, text: L.contactEmail }));
		contact.appendChild(document.createTextNode(' · '));
		contact.appendChild(document.createTextNode(L.vendorName));

		var tertiary = el('div', { className: PREFIX + '-support-us__tertiary' }, [more, contact]);
		var body = el('div', { className: PREFIX + '-support-us__body' }, [primary, secondary, tertiary]);

		section.appendChild(header);
		section.appendChild(body);
		mountParent.appendChild(section);
		return section;
	}

	global.SbdSupportUs = global.SbdSupportUs || {};
	global.SbdSupportUs.render = renderSupportUsSection;
	global.SbdSupportUs.linksFor = linksFor;
})(typeof window !== 'undefined' ? window : globalThis);
