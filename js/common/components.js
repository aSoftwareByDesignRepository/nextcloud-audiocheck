(function () {
	'use strict';

	function createElement(tag, props, children) {
		const el = document.createElement(tag);
		if (props) {
			Object.entries(props).forEach(([key, value]) => {
				if (value === undefined || value === null) return;
				if (key === 'class' || key === 'className') { el.className = String(value); return; }
				if (key === 'dataset') {
					Object.entries(value).forEach(([dk, dv]) => { el.dataset[dk] = String(dv); });
					return;
				}
				if (key === 'on') {
					Object.entries(value).forEach(([eventName, handler]) => el.addEventListener(eventName, handler));
					return;
				}
				if (key === 'attrs') {
					Object.entries(value).forEach(([ak, av]) => {
						if (av === null || av === undefined || av === false) { el.removeAttribute(ak); return; }
						if (av === true) { el.setAttribute(ak, ''); return; }
						el.setAttribute(ak, String(av));
					});
					return;
				}
				if (key === 'text') { el.textContent = String(value); return; }
				if (key.startsWith('on') && typeof value === 'function') {
					el.addEventListener(key.slice(2).toLowerCase(), value);
					return;
				}
				if (key in el && typeof el[key] !== 'object') {
					try { el[key] = value; return; } catch (_) { /* attr */ }
				}
				el.setAttribute(key, String(value));
			});
		}
		if (children !== undefined && children !== null) {
			(Array.isArray(children) ? children : [children]).forEach((child) => {
				if (child === null || child === undefined || child === false) return;
				if (typeof child === 'string' || typeof child === 'number') {
					el.appendChild(document.createTextNode(String(child)));
				} else {
					el.appendChild(child);
				}
			});
		}
		return el;
	}

	const el = createElement;

	const SVG_NS = 'http://www.w3.org/2000/svg';

	function getAppLogoUrl() {
		const root = document.getElementById('app-content');
		const fromData = root && root.dataset ? root.dataset.acAppLogo : '';
		if (fromData) return fromData;
		if (window.OC && typeof OC.imagePath === 'function') {
			return OC.imagePath('audiocheck', 'app.svg');
		}
		return '';
	}

	/** @type {Record<string, Array<Record<string, string>>>} */
	const EMPTY_STATE_ICONS = {
		playlist: [{ tag: 'path', d: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01' }],
		folder: [{ tag: 'path', d: 'M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z' }],
		audiobook: [
			{ tag: 'path', d: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20' },
			{ tag: 'path', d: 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z' },
			{ tag: 'path', d: 'M8 7h8' },
		],
		music: [
			{ tag: 'path', d: 'M9 18V5l12-2v13' },
			{ tag: 'circle', cx: '6', cy: '18', r: '3' },
			{ tag: 'circle', cx: '18', cy: '16', r: '3' },
		],
	};

	function appendSvgShapes(svg, shapes) {
		if (window.AudioCheckIcons && AudioCheckIcons.appendSvgShapes) {
			AudioCheckIcons.appendSvgShapes(svg, shapes);
			return;
		}
		(shapes || []).forEach((spec) => {
			const node = document.createElementNS(SVG_NS, spec.tag);
			Object.entries(spec).forEach(([key, value]) => {
				if (key === 'tag') return;
				node.setAttribute(key, String(value));
			});
			svg.appendChild(node);
		});
	}

	function emptyStateIcon(kind) {
		const resolved = kind || 'app';
		const wrap = el('div', {
			className: 'ac-empty__icon' + (resolved === 'app' ? ' ac-empty__icon--app' : ''),
			attrs: { 'aria-hidden': 'true' },
		});

		if (resolved === 'app') {
			const url = getAppLogoUrl();
			if (url) {
				wrap.appendChild(el('img', {
					className: 'ac-empty__app-logo',
					src: url,
					alt: '',
					width: '44',
					height: '44',
					decoding: 'async',
				}));
				return wrap;
			}
		}

		const svg = document.createElementNS(SVG_NS, 'svg');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('fill', 'none');
		svg.setAttribute('stroke', 'currentColor');
		svg.setAttribute('stroke-width', '1.75');
		svg.setAttribute('stroke-linecap', 'round');
		svg.setAttribute('stroke-linejoin', 'round');
		svg.setAttribute('class', 'ac-icon');
		const shapes = resolved === 'app'
			? EMPTY_STATE_ICONS.music
			: (EMPTY_STATE_ICONS[resolved] || EMPTY_STATE_ICONS.music);
		appendSvgShapes(svg, shapes);
		wrap.appendChild(svg);
		return wrap;
	}

	function kindIcon(kind, extraClass) {
		const resolved = kind === 'audiobook' ? 'audiobook' : (kind === 'music' ? 'music' : 'folder');
		const wrap = el('div', {
			className: 'ac-kind-icon ac-kind-icon--' + resolved + (extraClass ? ' ' + extraClass : ''),
			attrs: { 'aria-hidden': 'true' },
		});
		const svg = document.createElementNS(SVG_NS, 'svg');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('fill', 'none');
		svg.setAttribute('stroke', 'currentColor');
		svg.setAttribute('stroke-width', '1.75');
		svg.setAttribute('stroke-linecap', 'round');
		svg.setAttribute('stroke-linejoin', 'round');
		svg.setAttribute('class', 'ac-icon');
		appendSvgShapes(svg, EMPTY_STATE_ICONS[resolved] || EMPTY_STATE_ICONS.folder);
		wrap.appendChild(svg);
		return wrap;
	}

	function appendCoverImage(wrap, fileId) {
		const url = AudioCheckApi.coverUrl(fileId);
		if (url) {
			const img = el('img', {
				className: 'ac-card__cover',
				src: url,
				alt: '',
				loading: 'lazy',
			});
			img.addEventListener('error', () => {
				const placeholder = el('div', {
					className: 'ac-card__cover ac-card__cover--placeholder',
					attrs: { 'aria-hidden': 'true' },
				});
				img.replaceWith(placeholder);
			});
			wrap.appendChild(img);
		} else {
			wrap.appendChild(el('div', {
				className: 'ac-card__cover ac-card__cover--placeholder',
				attrs: { 'aria-hidden': 'true' },
			}));
		}
	}

	function browserCompatNote() {
		const label = t('audiocheck', 'May not play in this browser');
		const note = el('span', {
			className: 'ac-compat-note',
			attrs: { role: 'note', title: label, 'aria-label': label },
		});
		if (window.AudioCheckIcons) {
			note.appendChild(AudioCheckIcons.createSvg('alert-triangle'));
		}
		note.appendChild(el('span', { className: 'ac-compat-note__text', text: label }));
		return note;
	}

	window.AudioCheckComponents = {
		el,
		createElement,
		kindIcon,
		browserCompatNote,
		coverImageWrap(fileId, wrapClass) {
			const wrap = el('div', { className: wrapClass || 'ac-card__cover-wrap' });
			appendCoverImage(wrap, AudioCheckApi.validFileId(fileId));
			return wrap;
		},
		sectionCard(title, subtitle, content, controls, headingId) {
			const id = headingId || ('ac-section-' + Math.random().toString(36).slice(2));
			const section = el('section', {
				className: 'ac-card ac-section',
				attrs: { 'aria-labelledby': id },
			});
			const header = el('header', { className: 'ac-section__header' });
			const textWrap = el('div');
			textWrap.appendChild(el('h2', { id, className: 'ac-section__title', text: title }));
			if (subtitle) {
				textWrap.appendChild(el('p', { className: 'ac-section__sub', text: subtitle }));
			}
			header.appendChild(textWrap);
			if (controls) {
				const ctrlWrap = el('div', { className: 'ac-section__controls' });
				(Array.isArray(controls) ? controls : [controls]).forEach((node) => {
					if (node) ctrlWrap.appendChild(node);
				});
				header.appendChild(ctrlWrap);
			}
			section.appendChild(header);
			const body = el('div', { className: 'ac-section__body' });
			if (content) {
				(Array.isArray(content) ? content : [content]).forEach((node) => {
					if (node) body.appendChild(node);
				});
			}
			section.appendChild(body);
			return section;
		},
		collapsibleSectionCard(title, subtitle, content, headingId) {
			const id = headingId || ('ac-section-' + Math.random().toString(36).slice(2));
			const section = el('section', {
				className: 'ac-card ac-section ac-section--collapsible',
				attrs: { 'aria-labelledby': id },
			});
			const details = el('details', { className: 'ac-section-collapse' });
			const summary = el('summary', { className: 'ac-section-collapse__summary' });
			const textWrap = el('div', { className: 'ac-section__header' });
			textWrap.appendChild(el('h2', { id, className: 'ac-section__title', text: title }));
			if (subtitle) {
				textWrap.appendChild(el('p', { className: 'ac-section__sub', text: subtitle }));
			}
			summary.appendChild(textWrap);
			details.appendChild(summary);
			const body = el('div', { className: 'ac-section__body' });
			if (content) {
				(Array.isArray(content) ? content : [content]).forEach((node) => {
					if (node) body.appendChild(node);
				});
			}
			details.appendChild(body);
			section.appendChild(details);
			return section;
		},
		section(title, content) {
			const wrap = el('section', { className: 'ac-section' });
			if (title) wrap.appendChild(el('h2', { className: 'ac-section__title', text: title }));
			if (content) wrap.appendChild(content);
			return wrap;
		},
		emptyState(title, message, ctaLabel, onCta, options) {
			let opts = options || {};
			if (ctaLabel && typeof ctaLabel === 'object' && onCta === undefined) {
				opts = ctaLabel;
				ctaLabel = opts.ctaLabel;
				onCta = opts.onCta;
			}
			const isSection = opts.variant === 'section';
			const box = el('div', {
				className: 'ac-empty' + (isSection ? ' ac-empty--section' : ' ac-empty--page'),
				attrs: { role: 'status' },
			});
			if (!isSection) {
				box.appendChild(emptyStateIcon(opts.icon || 'app'));
			}
			box.appendChild(el(isSection ? 'h3' : 'h2', { text: title }));
			box.appendChild(el('p', { text: message }));
			if (ctaLabel && onCta) {
				box.appendChild(el('button', { type: 'button', className: 'ac-btn ac-btn--primary', text: ctaLabel, onClick: onCta }));
			}
			return box;
		},
		mediaCard(item, onPlay) {
			const isListened = !!(item.listened || item.finished);
			const title = item.title || item.fileName || '';
			const card = el('article', {
				className: 'ac-card ac-card--media',
				tabindex: '0',
				role: 'button',
				'aria-label': isListened
					? t('audiocheck', '{title}, listened', { title })
					: title,
				onClick: () => onPlay(item),
				onKeydown: (e) => {
					if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPlay(item); }
				},
			});
			const coverWrap = el('div', { className: 'ac-card__cover-wrap' });
			const coverId = AudioCheckApi.validFileId(item.coverFileId) ?? AudioCheckApi.validFileId(item.fileId);
			appendCoverImage(coverWrap, coverId);
			const pct = typeof item.progressPercent === 'number' ? item.progressPercent : 0;
			if (pct > 0 && pct < 100) {
				coverWrap.appendChild(el('div', {
					className: 'ac-card__progress',
					attrs: { 'aria-hidden': 'true', style: '--ac-progress:' + String(pct) },
				}));
			}
			card.appendChild(coverWrap);
			card.appendChild(el('h3', { className: 'ac-card__title', text: title }));
			if (item.subtitle || item.artist) {
				card.appendChild(el('p', { className: 'ac-card__subtitle', text: item.subtitle || item.artist || '' }));
			}
			if (isListened) {
				card.appendChild(el('span', {
					className: 'ac-badge ac-badge--ok ac-card__listened-badge',
					attrs: { role: 'status' },
					text: t('audiocheck', 'Listened'),
				}));
			}
			if (item.browserPlayable === false) {
				card.appendChild(browserCompatNote());
			}
			return card;
		},
		trackRow(track, onPlay, options) {
			const opts = options || {};
			const isListened = !!(track.listened || track.finished);
			const li = el('li', {
				className: 'ac-track-list__item'
					+ (track.unavailable ? ' ac-track-list__item--unavailable' : '')
					+ (isListened ? ' ac-track-list__item--listened' : '')
					+ (opts.active ? ' ac-track-list__item--active' : '')
					+ (opts.rowVariant === 'queue' ? ' ac-track-list__item--queue' : ''),
			});
			if (opts.active) {
				li.setAttribute('aria-current', opts.playing ? 'true' : 'step');
			}
			if (!opts.hidePlay) {
				const playIcon = opts.active && opts.playing ? 'pause' : 'play';
				const playBtn = el('button', {
					type: 'button',
					className: 'ac-btn ac-btn--icon ac-track-list__play'
						+ (opts.active ? ' ac-track-list__play--active' : ''),
					'aria-label': opts.active && opts.playing
						? t('audiocheck', 'Pause {title}', { title: track.title || track.fileName || '' })
						: t('audiocheck', 'Play {title}', { title: track.title || track.fileName || '' }),
					disabled: !onPlay || !!track.unavailable,
					onClick: () => {
						if (!onPlay) return;
						if (opts.active && opts.playing && window.AudioCheckPlayer) {
							AudioCheckPlayer.toggle();
							return;
						}
						onPlay(track);
					},
				});
				if (window.AudioCheckIcons) {
					playBtn.appendChild(AudioCheckIcons.createSvg(playIcon));
				} else {
					playBtn.appendChild(el('span', { className: 'icon icon-' + playIcon, 'aria-hidden': 'true' }));
				}
				li.appendChild(playBtn);
			}
			const meta = el('div', { className: 'ac-track-list__meta' });
			meta.appendChild(el('div', { className: 'ac-track-list__title', text: track.title || track.fileName || '' }));
			if (track.artist) {
				meta.appendChild(el('div', { className: 'ac-track-list__artist', text: track.artist }));
			}
			let listenedBadge = null;
			if (isListened) {
				listenedBadge = el('span', {
					className: 'ac-badge ac-badge--ok ac-track-list__listened-badge',
					attrs: { role: 'status' },
					text: t('audiocheck', 'Listened'),
				});
				meta.appendChild(listenedBadge);
			}
			if (opts.active) {
				meta.appendChild(el('span', {
					className: 'ac-track-list__status',
					text: opts.playing ? t('audiocheck', 'Now playing') : t('audiocheck', 'Paused in queue'),
				}));
			}
			if (track.browserPlayable === false) {
				meta.appendChild(browserCompatNote());
			}
			if (track.unavailable) {
				meta.appendChild(el('span', {
					className: 'ac-badge ac-badge--muted',
					attrs: { role: 'note' },
					text: t('audiocheck', 'Unavailable'),
				}));
			}
			li.appendChild(meta);

			const aside = el('div', { className: 'ac-track-list__actions' });
			const durationMs = Number(track.durationMs);
			if (Number.isFinite(durationMs) && durationMs > 0) {
				aside.appendChild(el('span', {
					className: 'ac-track-list__duration',
					text: AudioCheckTime.formatDuration(durationMs),
					attrs: { 'aria-label': AudioCheckTime.formatDurationLabel(durationMs) },
				}));
			}
			const mountIconBtn = (btn, iconName, fallbackClass) => {
				if (window.AudioCheckIcons) {
					btn.appendChild(AudioCheckIcons.createSvg(iconName));
				} else {
					btn.appendChild(el('span', { className: 'icon ' + fallbackClass, 'aria-hidden': 'true' }));
				}
			};
			if (opts.onToggleListened) {
				const listenedBtn = el('button', {
					type: 'button',
					className: 'ac-btn ac-btn--icon ac-track-list__listened'
						+ (isListened ? ' ac-btn--success' : ''),
					attrs: {
						'aria-label': isListened
							? t('audiocheck', 'Mark as not listened')
							: t('audiocheck', 'Mark as listened'),
						'aria-pressed': isListened ? 'true' : 'false',
					},
					onClick: (e) => {
						e.stopPropagation();
						listenedBtn.disabled = true;
						Promise.resolve(opts.onToggleListened(track))
							.then(() => {
								const on = !!(track.listened || track.finished);
								li.classList.toggle('ac-track-list__item--listened', on);
								listenedBtn.classList.toggle('ac-btn--success', on);
								listenedBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
								listenedBtn.setAttribute('aria-label', on
									? t('audiocheck', 'Mark as not listened')
									: t('audiocheck', 'Mark as listened'));
								if (window.AudioCheckIcons) {
									AudioCheckIcons.mount(listenedBtn, on ? 'circle-check' : 'circle');
								}
								if (on) {
									if (!listenedBadge) {
										listenedBadge = el('span', {
											className: 'ac-badge ac-badge--ok ac-track-list__listened-badge',
											attrs: { role: 'status' },
											text: t('audiocheck', 'Listened'),
										});
										meta.appendChild(listenedBadge);
									}
								} else if (listenedBadge) {
									listenedBadge.remove();
									listenedBadge = null;
								}
							})
							.catch((err) => {
								AudioCheckMessaging.toast(err.message || t('audiocheck', 'Request failed.'), 'error');
							})
							.finally(() => {
								listenedBtn.disabled = false;
							});
					},
				});
				mountIconBtn(listenedBtn, isListened ? 'circle-check' : 'circle', 'icon-checkmark');
				aside.appendChild(listenedBtn);
			}
			if (opts.onToggleFavorite) {
				const isFav = !!track.favorite;
				const favBtn = el('button', {
					type: 'button',
					className: 'ac-btn ac-btn--icon ac-track-list__favorite'
						+ (isFav ? ' ac-btn--success' : ''),
					attrs: {
						'aria-label': isFav ? t('audiocheck', 'Unfavorite') : t('audiocheck', 'Favorite'),
						'aria-pressed': isFav ? 'true' : 'false',
					},
					onClick: (e) => {
						e.stopPropagation();
						favBtn.disabled = true;
						Promise.resolve(opts.onToggleFavorite(track))
							.then(() => {
								const on = !!track.favorite;
								favBtn.classList.toggle('ac-btn--success', on);
								favBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
								favBtn.setAttribute('aria-label', on ? t('audiocheck', 'Unfavorite') : t('audiocheck', 'Favorite'));
								if (window.AudioCheckIcons) {
									AudioCheckIcons.mount(favBtn, on ? 'heart-filled' : 'heart');
								}
							})
							.catch((err) => {
								AudioCheckMessaging.toast(err.message || t('audiocheck', 'Request failed.'), 'error');
							})
							.finally(() => { favBtn.disabled = false; });
					},
				});
				mountIconBtn(favBtn, isFav ? 'heart-filled' : 'heart', 'icon-star');
				aside.appendChild(favBtn);
			}
			if (opts.onAddPlaylist) {
				const add = el('button', {
					type: 'button',
					className: 'ac-btn ac-btn--icon',
					'aria-label': t('audiocheck', 'Add to playlist'),
					onClick: (e) => { e.stopPropagation(); opts.onAddPlaylist(); },
				});
				mountIconBtn(add, 'add', 'icon-add');
				aside.appendChild(add);
			}
			if (opts.onEnqueue) {
				const queueBtn = el('button', {
					type: 'button',
					className: 'ac-btn ac-btn--icon',
					'aria-label': t('audiocheck', 'Add to queue'),
					onClick: (e) => { e.stopPropagation(); opts.onEnqueue(); },
				});
				mountIconBtn(queueBtn, 'queue', 'icon-queue');
				aside.appendChild(queueBtn);
			}
			if (opts.onPlayNext) {
				const nextBtn = el('button', {
					type: 'button',
					className: 'ac-btn ac-btn--icon',
					attrs: {
						'aria-label': t('audiocheck', 'Play next'),
						title: t('audiocheck', 'Plays this track right after the current one'),
					},
					onClick: (e) => { e.stopPropagation(); opts.onPlayNext(); },
				});
				mountIconBtn(nextBtn, 'next', 'icon-next');
				aside.appendChild(nextBtn);
			}
			if (opts.onRemove) {
				const rm = el('button', {
					type: 'button',
					className: 'ac-btn ac-btn--icon ac-track-list__remove',
					'aria-label': opts.removeLabel || t('audiocheck', 'Remove from queue'),
					onClick: (e) => { e.stopPropagation(); opts.onRemove(); },
				});
				mountIconBtn(rm, 'close', 'icon-close');
				aside.appendChild(rm);
			}
			if (opts.onMoveUp) {
				const up = el('button', {
					type: 'button',
					className: 'ac-btn ac-btn--icon',
					'aria-label': t('audiocheck', 'Move up'),
					disabled: !!opts.moveUpDisabled,
					onClick: (e) => { e.stopPropagation(); opts.onMoveUp(); },
				});
				mountIconBtn(up, 'arrow-up', 'icon-arrow-up');
				aside.appendChild(up);
			}
			if (opts.onMoveDown) {
				const down = el('button', {
					type: 'button',
					className: 'ac-btn ac-btn--icon',
					'aria-label': t('audiocheck', 'Move down'),
					disabled: !!opts.moveDownDisabled,
					onClick: (e) => { e.stopPropagation(); opts.onMoveDown(); },
				});
				mountIconBtn(down, 'arrow-down', 'icon-arrow-down');
				aside.appendChild(down);
			}
			li.appendChild(aside);
			return li;
		},
		volumeControl(options) {
			const opts = options || {};
			const prefix = opts.idPrefix || 'ac-volume';
			const compact = !!opts.compact;
			const wrap = el('div', {
				className: 'ac-volume' + (compact ? ' ac-volume--compact' : ''),
			});
			const muteBtn = el('button', {
				type: 'button',
				className: 'ac-btn ac-btn--icon' + (compact ? '' : ' ac-btn--icon-lg'),
				id: prefix + '-mute',
				attrs: {
					'aria-label': t('audiocheck', 'Mute'),
					'aria-pressed': 'false',
				},
			});
			if (window.AudioCheckIcons) {
				muteBtn.appendChild(AudioCheckIcons.createSvg('volume-high'));
			}
			const sliderId = prefix + '-slider';
			const slider = el('input', {
				type: 'range',
				id: sliderId,
				className: 'ac-volume__slider',
				attrs: {
					min: '0',
					max: '100',
					value: '100',
					'aria-label': t('audiocheck', 'Volume'),
					'aria-valuetext': t('audiocheck', 'Volume {percent}%', { percent: '100' }),
				},
			});
			const ui = { muteBtn, slider, wrap };
			muteBtn.addEventListener('click', () => AudioCheckPlayer.toggleMute());
			let dragging = false;
			slider.addEventListener('pointerdown', () => { dragging = true; });
			slider.addEventListener('pointerup', () => { dragging = false; });
			slider.addEventListener('pointercancel', () => { dragging = false; });
			slider.addEventListener('input', (e) => {
				AudioCheckPlayer.setVolumePercent(parseInt(e.target.value, 10), { persist: !dragging });
			});
			slider.addEventListener('change', () => {
				AudioCheckPlayer.setVolumePercent(parseInt(slider.value, 10), { persist: true });
			});
			if (compact) {
				const popover = el('details', { className: 'ac-volume-popover' });
				const toggle = el('summary', {
					className: 'ac-volume-popover__toggle',
					attrs: {
						'aria-label': t('audiocheck', 'Volume controls'),
					},
				});
				if (window.AudioCheckIcons) {
					toggle.appendChild(AudioCheckIcons.createSvg('volume-high'));
				}
				const panel = el('div', {
					className: 'ac-volume-popover__panel',
					attrs: { role: 'group', 'aria-label': t('audiocheck', 'Volume') },
				});
				panel.appendChild(slider);
				panel.appendChild(muteBtn);
				popover.appendChild(toggle);
				popover.appendChild(panel);
				popover.addEventListener('toggle', () => {
					if (!popover.open) {
						toggle.focus();
					}
				});
				wrap.appendChild(popover);
			} else {
				wrap.appendChild(muteBtn);
				wrap.appendChild(slider);
			}
			if (typeof AudioCheckPlayer.registerVolumeUi === 'function') {
				ui.unsub = AudioCheckPlayer.registerVolumeUi(ui);
			}
			return wrap;
		},
	};

	function focusables(root) {
		return Array.from(root.querySelectorAll(
			'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
		)).filter((node) => {
			if (node.closest('[hidden]')) return false;
			const style = window.getComputedStyle(node);
			return style.visibility !== 'hidden' && style.display !== 'none';
		});
	}

	let openModalInstance = null;

	/**
	 * Accessible modal dialog (focus trap, Escape, labelled title).
	 * @param {{ title: string, render: () => HTMLElement, primaryLabel?: string, cancelLabel?: string, onSubmit?: (ctx: object) => (boolean|Promise<boolean>), onCancel?: () => void }} options
	 */
	function openModal(options) {
		const opts = Object.assign({
			primaryLabel: t('audiocheck', 'Save'),
			cancelLabel: t('audiocheck', 'Cancel'),
			onSubmit: null,
			dialogClass: '',
			danger: false,
		}, options || {});

		if (openModalInstance) openModalInstance.close(false);
		const previousFocus = document.activeElement;
		const labelId = 'ac-modal-title-' + Math.random().toString(36).slice(2);
		let overlay;

		const instance = {
			close(ok) {
				document.body.classList.remove('ac-modal-open');
				if (overlay) overlay.remove();
				openModalInstance = null;
				document.removeEventListener('keydown', onKey);
				if (typeof opts.onCancel === 'function' && !ok) opts.onCancel();
				if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
			},
		};
		openModalInstance = instance;

		const body = typeof opts.render === 'function' ? opts.render({ close: (ok) => instance.close(ok !== false) }) : opts.render;
		const dialogChildren = [
			createElement('div', { class: 'ac-modal__header' }, [
				createElement('h2', { id: labelId, text: opts.title }),
				createElement('button', {
					type: 'button',
					class: 'ac-modal__close',
					attrs: { 'aria-label': t('audiocheck', 'Close') },
					text: '×',
					on: { click: () => instance.close(false) },
				}),
			]),
			createElement('div', { class: 'ac-modal__body' }, [body]),
		];
		if (!opts.hideDefaultActions) {
			dialogChildren.push(createElement('div', { class: 'ac-modal__actions' }, [
				createElement('button', {
					type: 'button',
					className: 'ac-btn',
					text: opts.cancelLabel,
					on: { click: () => instance.close(false) },
				}),
				createElement('button', {
					type: 'button',
					className: 'ac-btn' + (opts.danger ? ' ac-btn--danger' : ' ac-btn--primary'),
					text: opts.primaryLabel,
					on: {
						click: async () => {
							if (typeof opts.onSubmit !== 'function') {
								instance.close(true);
								return;
							}
							try {
								const ok = await opts.onSubmit({ body, close: (r) => instance.close(r) });
								if (ok !== false) instance.close(true);
							} catch (err) {
								AudioCheckMessaging.toast(err.message || t('audiocheck', 'Request failed.'), 'error');
							}
						},
					},
				}),
			]));
		}
		const dialog = createElement('div', {
			class: 'ac-modal__dialog' + (opts.dialogClass ? ' ' + opts.dialogClass : ''),
			attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': labelId },
		}, dialogChildren);

		overlay = createElement('div', {
			class: 'ac-modal',
			on: { click: (e) => { if (e.target === overlay) instance.close(false); } },
		}, [dialog]);

		function onKey(e) {
			if (e.key === 'Escape') { e.preventDefault(); instance.close(false); return; }
			if (e.key !== 'Tab') return;
			const list = focusables(dialog);
			if (!list.length) return;
			const first = list[0];
			const last = list[list.length - 1];
			if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
			else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
		}

		document.body.appendChild(overlay);
		document.body.classList.add('ac-modal-open');
		document.addEventListener('keydown', onKey);
		const preferred = dialog.querySelector('[autofocus]:not([disabled])');
		const firstInput = preferred || dialog.querySelector('input, button, select, textarea');
		if (firstInput) firstInput.focus();
		return instance;
	}

	/**
	 * @param {{ title: string, message: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean, onConfirm: () => (void|Promise<void>) }} options
	 */
	function confirmDialog(options) {
		return new Promise((resolve) => {
			openModal({
				title: options.title,
				primaryLabel: options.confirmLabel || t('audiocheck', 'Confirm'),
				cancelLabel: options.cancelLabel || t('audiocheck', 'Cancel'),
				danger: !!options.danger,
				render() {
					return createElement('p', { class: 'ac-confirm__message', text: options.message });
				},
				onSubmit: async () => {
					try {
						await options.onConfirm();
						resolve(true);
						return true;
					} catch (err) {
						AudioCheckMessaging.toast(err.message || t('audiocheck', 'Request failed.'), 'error');
						return false;
					}
				},
				onCancel: () => resolve(false),
			});
		});
	}

	window.AudioCheckComponents.openModal = openModal;
	window.AudioCheckComponents.confirmDialog = confirmDialog;
})();
