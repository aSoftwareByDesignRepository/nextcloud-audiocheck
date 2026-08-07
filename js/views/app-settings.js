(function () {
	'use strict';
	const C = AudioCheckComponents;
	const Picker = window.AudioCheckEntityPicker;

	/** Mirrors OCA\AudioCheck\Service\SettingsSectionCatalog::SECTIONS */
	const SECTION_ORDER = ['access', 'admins', 'defaults', 'support'];
	const DEFAULT_SECTION = 'access';

	function chipList(items, onRemove, labelFn) {
		const ul = C.createElement('ul', { class: 'ac-chip-list', attrs: { role: 'list' } });
		items.forEach((item) => {
			const label = labelFn(item);
			const li = C.createElement('li', { class: 'ac-chip', attrs: { role: 'listitem' } });
			li.appendChild(C.createElement('span', { class: 'ac-chip__text', text: label }));
			const rm = C.createElement('button', {
				type: 'button',
				class: 'ac-chip__remove',
				text: '×',
				attrs: { 'aria-label': t('audiocheck', 'Remove') + ' ' + label },
				on: { click: () => onRemove(item.id) },
			});
			li.appendChild(rm);
			ul.appendChild(li);
		});
		return ul;
	}

	function entityField(labelId, label, hintId, hint, inputId, suggestId, placeholder) {
		const wrap = C.createElement('div', { class: 'ac-field ac-field--full' });
		wrap.appendChild(C.createElement('span', { class: 'ac-field__label', attrs: { id: labelId }, text: label }));
		wrap.appendChild(C.createElement('p', { class: 'ac-field__hint', attrs: { id: hintId }, text: hint }));
		const picker = C.createElement('div', { class: 'ac-entity-picker' });
		picker.appendChild(C.createElement('label', {
			class: 'ac-sr-only',
			attrs: { for: inputId },
			text: placeholder,
		}));
		picker.appendChild(C.createElement('input', {
			id: inputId,
			type: 'search',
			className: 'ac-input ac-entity-picker__q',
			attrs: {
				autocomplete: 'off',
				maxlength: '120',
				'aria-describedby': hintId,
				placeholder,
			},
		}));
		picker.appendChild(C.createElement('div', {
			id: suggestId,
			class: 'ac-entity-picker__suggest',
			attrs: { hidden: true, 'aria-live': 'polite' },
		}));
		wrap.appendChild(picker);
		return wrap;
	}

	function topicSection(id, title, lead, contentNodes) {
		const section = C.createElement('section', {
			class: 'ac-settings-topic',
			attrs: { id: 'ac-settings-' + id, 'aria-labelledby': 'ac-settings-' + id + '-title' },
		});
		section.appendChild(C.createElement('h2', {
			id: 'ac-settings-' + id + '-title',
			class: 'ac-settings-topic__title',
			text: title,
		}));
		if (lead) {
			section.appendChild(C.createElement('p', { class: 'ac-settings-topic__lead', text: lead }));
		}
		(Array.isArray(contentNodes) ? contentNodes : [contentNodes]).forEach((node) => {
			if (node) section.appendChild(node);
		});
		return section;
	}

	function settingsChipBar(activeSection) {
		const urls = (function () {
			try {
				const raw = document.getElementById('app-content')?.dataset?.acUrls;
				return raw ? JSON.parse(raw) : {};
			} catch (_) {
				return {};
			}
		}());
		const sectionUrls = urls.settingsSections || {};
		const sections = [
			{ id: 'access', label: t('audiocheck', 'Access') },
			{ id: 'admins', label: t('audiocheck', 'Admins') },
			{ id: 'defaults', label: t('audiocheck', 'Defaults') },
			{ id: 'support', label: t('audiocheck', 'Support') },
		];
		const list = C.createElement('ul', {
			class: 'ac-settings-chips',
			attrs: {
				role: 'list',
				'aria-label': t('audiocheck', 'Settings pages'),
			},
		});
		sections.forEach((section) => {
			const li = C.createElement('li', { attrs: { role: 'listitem' } });
			const active = section.id === activeSection;
			const href = sectionUrls[section.id]
				|| (OC.generateUrl('/apps/audiocheck/app-settings/' + section.id));
			const link = C.createElement('a', {
				class: 'ac-settings-chips__btn' + (active ? ' is-active' : ''),
				text: section.label,
				attrs: {
					href,
					'data-ac-settings-chip': section.id,
					'aria-current': active ? 'page' : 'false',
				},
				on: {
					click: (e) => {
						if (e.metaKey || e.ctrlKey) return;
						e.preventDefault();
						AudioCheckRouter.navigate('app-settings', { settingsSection: section.id });
					},
				},
			});
			li.appendChild(link);
			list.appendChild(li);
		});
		return list;
	}

	function normalizeSection(raw) {
		const section = String(raw || '').toLowerCase();
		return SECTION_ORDER.indexOf(section) >= 0 ? section : DEFAULT_SECTION;
	}

	AudioCheckRouter.register('app-settings', {
		render(params) {
			const section = normalizeSection(params && params.settingsSection);
			const frag = document.createDocumentFragment();
			const body = C.el('div', { className: 'ac-page-body ac-app-settings-page ac-page-stack' });
			body.appendChild(settingsChipBar(section));

			const state = {
				allowedUsers: [],
				allowedGroups: [],
				appAdmins: [],
				restriction: false,
				defaultFolder: '/',
				maxMetaTempMb: 256,
				policyVersion: 0,
			};
			let mountAlive = true;
			const markDead = () => { mountAlive = false; };

			const form = C.createElement('form', { attrs: { 'data-ac-policy-form': '', 'data-ac-settings-section': section } });
			let openRadio = null;
			let restrictedRadio = null;
			let allowlists = null;
			let usersChipsHost = null;
			let groupsChipsHost = null;
			let adminsChipsHost = null;
			let folderInput = null;
			let mbInput = null;
			let saveBtn = null;

			if (section === 'support') {
				const supportMount = document.createElement('div');
				supportMount.id = 'ac-settings-support';
				supportMount.className = 'ac-support-us-mount ac-settings-topic';
				body.appendChild(supportMount);
				if (window.SbdSupportUs && typeof window.SbdSupportUs.render === 'function') {
					window.SbdSupportUs.render(supportMount, { appId: 'audiocheck' });
				}
				frag.appendChild(body);
				return frag;
			}

			if (section === 'access') {
				const accessFs = C.createElement('fieldset', { class: 'ac-fieldset ac-fieldset--plain' });
				accessFs.appendChild(C.createElement('legend', {
					class: 'ac-sr-only',
					text: t('audiocheck', 'Access mode'),
				}));
				const mode = C.createElement('div', {
					class: 'ac-access-mode',
					attrs: { role: 'radiogroup', 'aria-label': t('audiocheck', 'Access mode') },
				});
				openRadio = C.createElement('input', {
					type: 'radio',
					name: 'ac-access-mode',
					className: 'ac-access-mode__input',
					attrs: { id: 'ac-access-open', value: 'open' },
				});
				restrictedRadio = C.createElement('input', {
					type: 'radio',
					name: 'ac-access-mode',
					className: 'ac-access-mode__input',
					attrs: { id: 'ac-access-restricted', value: 'restricted' },
				});
				const openLabel = C.createElement('label', {
					class: 'ac-access-mode__option',
					attrs: { for: 'ac-access-open' },
				});
				openLabel.appendChild(openRadio);
				openLabel.appendChild(C.createElement('span', { class: 'ac-access-mode__copy' }, [
					C.createElement('span', { class: 'ac-access-mode__name', text: t('audiocheck', 'Open') }),
					C.createElement('span', {
						class: 'ac-access-mode__hint',
						text: t('audiocheck', 'Everyone with a Nextcloud login can open AudioCheck.'),
					}),
				]));
				const restrictedLabel = C.createElement('label', {
					class: 'ac-access-mode__option',
					attrs: { for: 'ac-access-restricted' },
				});
				restrictedLabel.appendChild(restrictedRadio);
				restrictedLabel.appendChild(C.createElement('span', { class: 'ac-access-mode__copy' }, [
					C.createElement('span', { class: 'ac-access-mode__name', text: t('audiocheck', 'Restricted') }),
					C.createElement('span', {
						class: 'ac-access-mode__hint',
						text: t('audiocheck', 'Only listed people and groups can open the app.'),
					}),
				]));
				mode.appendChild(openLabel);
				mode.appendChild(restrictedLabel);
				accessFs.appendChild(mode);

				allowlists = C.createElement('div', {
					class: 'ac-allowlists',
					attrs: { id: 'ac-access-allowlists', 'data-ac-access-allowlists': '', hidden: true },
				});
				usersChipsHost = C.createElement('div');
				allowlists.appendChild(usersChipsHost);
				allowlists.appendChild(entityField(
					'ac-allowed-users-label',
					t('audiocheck', 'Allowed users'),
					'ac-allowed-users-hint',
					t('audiocheck', 'Type at least two characters to search.'),
					'ac-policy-users-q',
					'ac-policy-users-suggest',
					t('audiocheck', 'Search users to add'),
				));
				groupsChipsHost = C.createElement('div');
				allowlists.appendChild(groupsChipsHost);
				allowlists.appendChild(entityField(
					'ac-allowed-groups-label',
					t('audiocheck', 'Allowed groups'),
					'ac-allowed-groups-hint',
					t('audiocheck', 'Type at least two characters to search.'),
					'ac-policy-groups-q',
					'ac-policy-groups-suggest',
					t('audiocheck', 'Search groups to add'),
				));
				accessFs.appendChild(allowlists);

				form.appendChild(topicSection(
					'access',
					t('audiocheck', 'Who may open the app'),
					t('audiocheck', 'Choose Open for everyone, or Restricted to pick people and groups.'),
					accessFs,
				));
			}

			if (section === 'admins') {
				const adminFs = C.createElement('fieldset', { class: 'ac-fieldset ac-fieldset--plain' });
				adminFs.appendChild(C.createElement('legend', {
					class: 'ac-sr-only',
					text: t('audiocheck', 'Delegated admins'),
				}));
				adminsChipsHost = C.createElement('div');
				adminFs.appendChild(adminsChipsHost);
				adminFs.appendChild(entityField(
					'ac-app-admin-label',
					t('audiocheck', 'App administrators'),
					'ac-app-admin-hint',
					t('audiocheck', 'Only real Nextcloud user accounts can be selected.'),
					'ac-policy-admins-q',
					'ac-policy-admins-suggest',
					t('audiocheck', 'Search users to add as administrators'),
				));
				form.appendChild(topicSection(
					'admins',
					t('audiocheck', 'App administrators'),
					t('audiocheck', 'Delegated admins can change policy here. They still only play their own files.'),
					adminFs,
				));
			}

			if (section === 'defaults') {
				const defaultsFs = C.createElement('fieldset', { class: 'ac-fieldset ac-fieldset--plain' });
				defaultsFs.appendChild(C.createElement('legend', {
					class: 'ac-sr-only',
					text: t('audiocheck', 'New user defaults'),
				}));
				const folderRow = C.createElement('div', { class: 'ac-form-row' });
				folderRow.appendChild(C.createElement('label', {
					attrs: { for: 'ac-default-folder' },
					text: t('audiocheck', 'Default library folder path'),
				}));
				folderInput = C.createElement('input', {
					id: 'ac-default-folder',
					type: 'text',
					name: 'defaultLibraryFolder',
					className: 'ac-input',
					attrs: { maxlength: '512', 'aria-describedby': 'ac-default-folder-hint' },
				});
				folderRow.appendChild(folderInput);
				defaultsFs.appendChild(folderRow);
				defaultsFs.appendChild(C.createElement('p', {
					id: 'ac-default-folder-hint',
					class: 'ac-field__hint',
					text: t('audiocheck', 'Relative path inside each user\'s Files home (for example Music or Audiobooks).'),
				}));
				const mbRow = C.createElement('div', { class: 'ac-form-row' });
				mbRow.appendChild(C.createElement('label', {
					attrs: { for: 'ac-max-meta-mb' },
					text: t('audiocheck', 'Max metadata temp size (MB)'),
				}));
				mbInput = C.createElement('input', {
					id: 'ac-max-meta-mb',
					type: 'number',
					name: 'maxMetaTempMb',
					className: 'ac-input',
					attrs: { min: '16', max: '2048', step: '1' },
				});
				mbRow.appendChild(mbInput);
				defaultsFs.appendChild(mbRow);
				form.appendChild(topicSection(
					'defaults',
					t('audiocheck', 'Defaults'),
					t('audiocheck', 'Suggested library folder and metadata extraction limits for new users.'),
					defaultsFs,
				));
			}

			const saveLabels = {
				access: t('audiocheck', 'Save access'),
				admins: t('audiocheck', 'Save admins'),
				defaults: t('audiocheck', 'Save defaults'),
			};
			const saveBar = C.createElement('div', {
				class: 'ac-form-actions',
				attrs: { 'data-ac-settings-savebar': '' },
			});
			saveBtn = C.createElement('button', {
				type: 'submit',
				className: 'ac-btn ac-btn--primary',
				text: saveLabels[section] || t('audiocheck', 'Save'),
			});
			saveBar.appendChild(saveBtn);
			form.appendChild(saveBar);
			body.appendChild(form);
			frag.appendChild(body);

			function syncAccessModeUi() {
				if (!restrictedRadio || !allowlists) return;
				const restricted = !!restrictedRadio.checked;
				state.restriction = restricted;
				allowlists.hidden = !restricted;
			}

			if (openRadio && restrictedRadio) {
				openRadio.addEventListener('change', syncAccessModeUi);
				restrictedRadio.addEventListener('change', syncAccessModeUi);
			}

			function renderChips() {
				if (usersChipsHost) {
					usersChipsHost.replaceChildren(chipList(state.allowedUsers, (id) => {
						state.allowedUsers = state.allowedUsers.filter((x) => x.id !== id);
						renderChips();
					}, (u) => u.displayName + ' (' + u.id + ')'));
				}
				if (groupsChipsHost) {
					groupsChipsHost.replaceChildren(chipList(state.allowedGroups, (id) => {
						state.allowedGroups = state.allowedGroups.filter((x) => x.id !== id);
						renderChips();
					}, (g) => g.displayName + ' (' + g.id + ')'));
				}
				if (adminsChipsHost) {
					adminsChipsHost.replaceChildren(chipList(state.appAdmins, (id) => {
						state.appAdmins = state.appAdmins.filter((x) => x.id !== id);
						renderChips();
					}, (a) => (a.displayName !== a.id ? a.displayName + ' (' + a.id + ')' : a.id)));
				}
			}

			function wirePickers() {
				if (!Picker || !form.isConnected) return;
				const accountStr = {
					noResults: t('audiocheck', 'No matching accounts.'),
					searchErrorNetwork: t('audiocheck', 'Search could not load (network).'),
					searchErrorServer: t('audiocheck', 'Search could not load.'),
				};
				const usersQ = form.querySelector('#ac-policy-users-q');
				const usersSuggest = form.querySelector('#ac-policy-users-suggest');
				if (usersQ && usersSuggest) {
					Picker.bindCombobox({
						input: usersQ,
						suggest: usersSuggest,
						minLen: 2,
						strings: accountStr,
						isTaken: (id) => state.allowedUsers.some((x) => x.id === id),
						fetchItems: async (query) => {
							try {
								const data = await AudioCheckApi.get('/apps/audiocheck/api/admin/users', { q: query });
								return { items: data.users || [], error: null };
							} catch (err) {
								return { items: [], error: err && err.status === 0 ? 'network' : 'server' };
							}
						},
						onPick: (item) => {
							if (!mountAlive || !form.isConnected) return;
							state.allowedUsers.push(item);
							renderChips();
						},
					});
				}
				const groupsQ = form.querySelector('#ac-policy-groups-q');
				const groupsSuggest = form.querySelector('#ac-policy-groups-suggest');
				if (groupsQ && groupsSuggest) {
					Picker.bindCombobox({
						input: groupsQ,
						suggest: groupsSuggest,
						minLen: 2,
						strings: { ...accountStr, noResults: t('audiocheck', 'No matching groups.') },
						isTaken: (id) => state.allowedGroups.some((x) => x.id === id),
						fetchItems: async (query) => {
							try {
								const data = await AudioCheckApi.get('/apps/audiocheck/api/admin/groups', { q: query });
								return { items: data.groups || [], error: null };
							} catch (err) {
								return { items: [], error: err && err.status === 0 ? 'network' : 'server' };
							}
						},
						onPick: (item) => {
							if (!mountAlive || !form.isConnected) return;
							state.allowedGroups.push(item);
							renderChips();
						},
					});
				}
				const adminsQ = form.querySelector('#ac-policy-admins-q');
				const adminsSuggest = form.querySelector('#ac-policy-admins-suggest');
				if (adminsQ && adminsSuggest) {
					Picker.bindCombobox({
						input: adminsQ,
						suggest: adminsSuggest,
						minLen: 2,
						strings: accountStr,
						isTaken: (id) => state.appAdmins.some((x) => x.id === id),
						fetchItems: async (query) => {
							try {
								const data = await AudioCheckApi.get('/apps/audiocheck/api/admin/users', { q: query });
								return { items: data.users || [], error: null };
							} catch (err) {
								return { items: [], error: err && err.status === 0 ? 'network' : 'server' };
							}
						},
						onPick: (item) => {
							if (!mountAlive || !form.isConnected) return;
							state.appAdmins.push(item);
							renderChips();
						},
					});
				}
			}

			form.addEventListener('submit', (e) => {
				e.preventDefault();
				if (!mountAlive || !form.isConnected || !saveBtn || saveBtn.disabled) return;
				const restricted = section === 'access'
					? !!(restrictedRadio && restrictedRadio.checked)
					: !!state.restriction;
				if (section === 'access' && restricted && state.allowedUsers.length === 0 && state.allowedGroups.length === 0) {
					AudioCheckMessaging.toast(t('audiocheck', 'When restriction is enabled, add at least one user or group.'), 'warning');
					if (restrictedRadio) restrictedRadio.focus();
					return;
				}
				const payload = {
					section,
					policyVersion: state.policyVersion,
				};
				if (section === 'access') {
					payload.accessRestrictionEnabled = restricted;
					payload.allowedUserIds = state.allowedUsers.map((u) => u.id);
					payload.allowedGroupIds = state.allowedGroups.map((g) => g.id);
				} else if (section === 'admins') {
					payload.appAdminUserIds = state.appAdmins.map((a) => a.id);
				} else if (section === 'defaults') {
					payload.defaultLibraryFolder = (folderInput ? folderInput.value.trim() : state.defaultFolder) || '/';
					payload.maxMetaTempMb = parseInt(mbInput ? mbInput.value : String(state.maxMetaTempMb), 10) || 256;
				}
				saveBtn.disabled = true;
				AudioCheckApi.post('/apps/audiocheck/api/admin/policy', payload).then((r) => {
					if (!mountAlive || !form.isConnected) return;
					const p = r.policy || {};
					if (typeof p.policyVersion === 'number') {
						state.policyVersion = p.policyVersion;
					} else {
						state.policyVersion += 1;
					}
					AudioCheckMessaging.toast(t('audiocheck', 'Policy saved.'));
				}).catch((err) => {
					if (!mountAlive || !form.isConnected) return;
					if (err && err.status === 409) {
						AudioCheckMessaging.toast(err.message || t('audiocheck', 'Policy was changed elsewhere. Reload and try again.'), 'error');
						AudioCheckRouter.navigate('app-settings', { settingsSection: section }, true);
						return;
					}
					AudioCheckMessaging.toast(err.message || t('audiocheck', 'Request failed.'), 'error');
				}).finally(() => {
					if (mountAlive && form.isConnected && saveBtn) {
						saveBtn.disabled = false;
					}
				});
			});

			AudioCheckApi.get('/apps/audiocheck/api/admin/policy').then((r) => {
				if (!mountAlive || !body.isConnected || !form.isConnected) return;
				const p = r.policy || {};
				state.allowedUsers = [...(p.allowedUsersPreview || [])];
				state.allowedGroups = [...(p.allowedGroupsPreview || [])];
				state.appAdmins = (p.appAdminsPreview && p.appAdminsPreview.length)
					? [...p.appAdminsPreview]
					: (p.appAdminUserIds || []).map((id) => ({ id, displayName: id }));
				state.restriction = !!p.accessRestrictionEnabled;
				state.defaultFolder = p.defaultLibraryFolder || '/';
				state.maxMetaTempMb = p.maxMetaTempMb || 256;
				state.policyVersion = typeof p.policyVersion === 'number' ? p.policyVersion : 0;
				if (restrictedRadio && openRadio) {
					restrictedRadio.checked = state.restriction;
					openRadio.checked = !state.restriction;
					syncAccessModeUi();
				}
				if (folderInput) folderInput.value = state.defaultFolder;
				if (mbInput) mbInput.value = String(state.maxMetaTempMb);
				renderChips();
				wirePickers();
			}).catch((err) => {
				if (!mountAlive || !body.isConnected) return;
				body.replaceChildren(C.loadErrorState(
					t('audiocheck', 'Could not load settings'),
					err.message || t('audiocheck', 'Request failed.'),
					() => AudioCheckRouter.navigate('app-settings', { settingsSection: section }, true),
					{ icon: 'settings' },
				));
				AudioCheckMessaging.toast(err.message || t('audiocheck', 'Request failed.'), 'error');
			});

			const teardownRoot = document.getElementById('ac-main-content') || document.body;
			const mo = new MutationObserver(() => {
				if (!body.isConnected) {
					markDead();
					mo.disconnect();
				}
			});
			mo.observe(teardownRoot, { childList: true, subtree: true });

			return frag;
		},
	});
})();
