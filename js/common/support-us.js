/**
 * Support & Us — JS render helper for SPA admin settings (AudioCheck / DeskCheck).
 * Prefix: ac · App: AudioCheck
 *
 * Security: URLs/mailtos come from SupportUsLinks-equivalent constants only.
 * No user input is interpolated into hrefs. textContent only for visible copy.
 */
(function (global) {
	'use strict';

	var CONTACT_EMAIL = 'info@software-by-design.de';
	var SPONSORS_URL = 'https://github.com/sponsors/aSoftwareByDesignRepository';
	var SITE_ORIGIN = 'https://nextcloud.software-by-design.de';
	var VENDOR_NAME = 'Software by Design GbR';
	var APP_NAME = 'AudioCheck';
	var PREFIX = 'ac';
	var DEFAULT_SHELL_PREFIX = 'ac';

	function isGermanLocale(lang) {
		var normalized = String(lang || '')
			.toLowerCase()
			.trim()
			.replace(/_/g, '-');
		if (!normalized) {
			return false;
		}
		return normalized === 'de' || normalized.indexOf('de-') === 0;
	}

	function mailtoSubject(subject) {
		return 'mailto:' + CONTACT_EMAIL + '?subject=' + encodeURIComponent(subject);
	}

	function isSafeLicenseUrl(url) {
		if (!url || typeof url !== 'string') {
			return false;
		}
		var trimmed = url.trim();
		if (!trimmed || /[\x00-\x1F\x7F\s]/.test(trimmed) || trimmed.indexOf('\\') !== -1) {
			return false;
		}
		if (trimmed.charAt(0) === '/') {
			// "//host/..." is protocol-relative (external origin), not app-relative.
			return trimmed.indexOf('//') !== 0
				&& trimmed.indexOf('://') === -1
				&& trimmed.indexOf('@') === -1;
		}
		if (trimmed.indexOf('https://') !== 0 && trimmed.indexOf('http://') !== 0) {
			return false;
		}
		if (/^https?:\/\/[^/]*@/.test(trimmed)) {
			return false;
		}
		return true;
	}

	function linksFor(lang, options) {
		var de = isGermanLocale(lang);
		var opts = options || {};
		var hasMobile = !!opts.hasOfficialMobileLicenses;
		var licensePageUrl = null;
		if (hasMobile) {
			if (!isSafeLicenseUrl(opts.licensePageUrl)) {
				throw new Error('SbdSupportUs: license page URL required and must be http(s) or relative');
			}
			licensePageUrl = String(opts.licensePageUrl).trim();
		}
		return {
			partnerMailto: mailtoSubject(
				de ? APP_NAME + ': Partner / Care Retainer' : APP_NAME + ': partner / care retainer'
			),
			onboardingMailto: mailtoSubject(APP_NAME + ': Einrichtung / Schulung'),
			featureMailto: mailtoSubject(APP_NAME + ': Feature-Auftrag'),
			supportPageUrl: SITE_ORIGIN + (de ? '/de/support.html' : '/en/support.html') + '#packages',
			appsPageUrl: SITE_ORIGIN + (de ? '/de/apps.html' : '/en/apps.html'),
			sponsorsUrl: SPONSORS_URL,
			contactMailto: 'mailto:' + CONTACT_EMAIL,
			contactEmail: CONTACT_EMAIL,
			vendorName: VENDOR_NAME,
			hasOfficialMobileLicenses: hasMobile,
			licensePageUrl: licensePageUrl,
			isGerman: de
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

	function sepDot() {
		return el('span', { 'aria-hidden': 'true', text: ' · ' });
	}

	/**
	 * @param {HTMLElement} mountParent
	 * @param {{
	 *   appId?: string,
	 *   language?: string,
	 *   hasOfficialMobileLicenses?: boolean,
	 *   licensePageUrl?: string,
	 *   primaryBtnClass?: string,
	 *   secondaryBtnClass?: string,
	 *   shellPrefix?: string
	 * }} options
	 */
	function renderSupportUsSection(mountParent, options) {
		if (!mountParent || mountParent.querySelector('[data-support-us="1"]')) {
			return null;
		}
		var opts = options || {};
		var appId = opts.appId || 'audiocheck';
		var lang = opts.language || (global.OC && OC.getLanguage && OC.getLanguage()) || 'en';
		var L = linksFor(lang, opts);
		var shell = opts.shellPrefix || DEFAULT_SHELL_PREFIX || PREFIX;
		var titleId = PREFIX + '-support-us-title';
		var introId = PREFIX + '-support-us-intro';
		var partnerTitleId = PREFIX + '-support-us-partner-title';
		var primaryBtn = opts.primaryBtnClass || ('button primary ' + PREFIX + '-support-us__cta ' + PREFIX + '-support-us__cta--primary');
		var secondaryBtn = opts.secondaryBtnClass || ('button ' + PREFIX + '-support-us__cta ' + PREFIX + '-support-us__cta--secondary');
		var hasMobile = !!(L.hasOfficialMobileLicenses && L.licensePageUrl);
		var secondaryLabelId = PREFIX + '-support-us-secondary-label';

		// Match Block A to Block E: never mention mobile when the license CTA is hidden.
		var introKey = hasMobile
			? '%s stays free (AGPL) on your Nextcloud. Bug reports and ideas on GitHub stay welcome — that is free open-source care. If your organisation needs bookable help on an invoice — or official mobile licenses — choose an option below:'
			: '%s stays free (AGPL) on your Nextcloud. Bug reports and ideas on GitHub stay welcome — that is free open-source care. If your organisation needs bookable help on an invoice, choose an option below:';
		var intro = t(appId, introKey, [APP_NAME]);

		var section = el('section', {
			className: shell + '-card ' + shell + '-section ' + PREFIX + '-support-us',
			id: PREFIX + '-support-us',
			'aria-labelledby': titleId,
			'aria-describedby': introId,
			'data-support-us': '1',
			'data-support-us-presentation': 'embed'
		});

		var header = el('header', { className: shell + '-section__header ' + PREFIX + '-support-us__header' }, [
			el('div', null, [
				el('h2', {
					id: titleId,
					className: shell + '-card__title ' + PREFIX + '-support-us__title',
					text: t(appId, 'Support & us')
				}),
				el('p', {
					id: introId,
					className: shell + '-section__sub ' + PREFIX + '-support-us__intro',
					text: intro
				})
			])
		]);

		function ctaClass(base, modifier) {
			var cls = String(base || '');
			if (cls.indexOf(PREFIX + '-support-us__cta') === -1) {
				cls += ' ' + PREFIX + '-support-us__cta';
			}
			if (modifier && cls.indexOf(PREFIX + '-support-us__cta--' + modifier) === -1) {
				cls += ' ' + PREFIX + '-support-us__cta--' + modifier;
			}
			return cls.replace(/^\s+/, '');
		}

		function newTabHint() {
			return el('span', {
				className: PREFIX + '-support-us__new-tab',
				text: t(appId, '(opens in a new tab)')
			});
		}

		function externalLink(href, label) {
			var a = el('a', {
				href: href,
				target: '_blank',
				rel: 'noopener noreferrer'
			});
			a.appendChild(document.createTextNode(label));
			a.appendChild(newTabHint());
			return a;
		}

		var primaryCta = el('a', {
			className: ctaClass(primaryBtn, 'primary'),
			href: L.partnerMailto,
			text: t(appId, 'Ask for a partner offer')
		});
		var hint = el('p', { className: PREFIX + '-support-us__hint' });
		hint.appendChild(document.createTextNode(t(appId, 'Packages and terms:') + ' '));
		hint.appendChild(externalLink(L.supportPageUrl, t(appId, 'Open support page')));

		var primary = el('div', {
			className: PREFIX + '-support-us__primary',
			'aria-labelledby': partnerTitleId
		}, [
			el('h3', {
				id: partnerTitleId,
				className: PREFIX + '-support-us__offer-title',
				text: t(appId, 'Check Partner')
			}),
			el('p', {
				className: PREFIX + '-support-us__benefit',
				text: t(appId, 'Annual hour packs — Small, Standard, or Premium — with priority email for your organisation. This is invoiceable service — not a donation. See packages on our support page.')
			}),
			el('p', {
				className: PREFIX + '-support-us__coverage',
				text: t(appId, 'List prices on our site apply to published Check apps. For this app, ask for an individual partner offer — we invoice only after you accept a quote.')
			}),
			primaryCta,
			hint
		]);

		function optionCard(href, title, label, hintText) {
			return el('div', { className: PREFIX + '-support-us__option' }, [
				el('h4', { className: PREFIX + '-support-us__option-title', text: title }),
				el('p', {
					className: PREFIX + '-support-us__option-hint',
					text: hintText
				}),
				el('a', {
					className: ctaClass(secondaryBtn, 'secondary'),
					href: href,
					text: label
				})
			]);
		}

		var optionNodes = [
			optionCard(
				L.onboardingMailto,
				t(appId, 'Setup & training'),
				t(appId, 'Ask about setup or training'),
				t(appId, 'Remote onboarding or a workshop so your team can roll out cleanly — billed as a service.')
			),
			optionCard(
				L.featureMailto,
				t(appId, 'Commissioned feature'),
				t(appId, 'Request a commissioned feature'),
				t(appId, 'A scoped change with acceptance criteria and a delivery date — billed as project work.')
			)
		];
		if (hasMobile) {
			optionNodes.push(optionCard(
				L.licensePageUrl,
				t(appId, 'Mobile & terminal'),
				t(appId, 'Official mobile & terminal licenses'),
				t(appId, 'Named seats for the official apps — a software licence on invoice.')
			));
		}

		var secondary = el('div', {
			className: PREFIX + '-support-us__secondary',
			role: 'group',
			'aria-labelledby': secondaryLabelId
		}, [
			el('h3', {
				id: secondaryLabelId,
				className: PREFIX + '-support-us__secondary-title',
				text: t(appId, 'Additional invoiceable options')
			}),
			el('div', { className: PREFIX + '-support-us__options' }, optionNodes)
		]);

		var more = el('p', { className: PREFIX + '-support-us__more' });
		more.appendChild(externalLink(L.appsPageUrl, t(appId, 'More Check apps')));
		more.appendChild(sepDot());
		more.appendChild(externalLink(L.sponsorsUrl, t(appId, 'GitHub Sponsors (voluntary, no invoice SLA)')));

		var contact = el('p', { className: PREFIX + '-support-us__contact' });
		contact.appendChild(el('a', { href: L.contactMailto, text: L.contactEmail }));
		contact.appendChild(sepDot());
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
	global.SbdSupportUs.isGermanLocale = isGermanLocale;
	global.SbdSupportUs.isSafeLicenseUrl = isSafeLicenseUrl;
})(typeof window !== 'undefined' ? window : globalThis);
