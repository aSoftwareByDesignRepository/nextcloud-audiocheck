(function () {
	'use strict';
	const C = AudioCheckComponents;
	const Picker = window.AudioCheckEntityPicker;

	function chipList(items, onRemove, labelFn) {
		const ul = C.createElement('ul', { class: 'ac-chip-list', attrs: { role: 'list' } });
		items.forEach((item) => {
			const li = C.createElement('li', { class: 'ac-chip', attrs: { role: 'listitem' } });
			li.appendChild(C.createElement('span', { class: 'ac-chip__text', text: labelFn(item) }));
			const rm = C.createElement('button', {
				type: 'button',
				class: 'ac-chip__remove',
				text: '×',
				attrs: { 'aria-label': t('audiocheck', 'Remove') + ' ' + item.id },
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

	AudioCheckRouter.register('app-settings', {
		render() {
			const frag = document.createDocumentFragment();
			const body = C.el('div', { className: 'ac-page-body ac-app-settings-page' });

			const state = {
				allowedUsers: [],
				allowedGroups: [],
				appAdmins: [],
				restriction: false,
				defaultFolder: '/',
				maxMetaTempMb: 256,
			};

			const form = C.createElement('form', { attrs: { 'data-ac-policy-form': '' } });

			const accessFs = C.createElement('fieldset', { class: 'ac-fieldset' });
			accessFs.appendChild(C.createElement('legend', { class: 'ac-fieldset__legend', text: t('audiocheck', 'Access list') }));
			accessFs.appendChild(C.createElement('p', {
				class: 'ac-callout ac-callout--info',
				text: t('audiocheck', 'When restriction is enabled, only listed users and groups can open the app. Administrators always keep access.'),
			}));

			const restrictWrap = C.createElement('label', { class: 'ac-field ac-field--boolean' });
			const restrictCb = C.createElement('input', { type: 'checkbox', name: 'accessRestrictionEnabled' });
			restrictWrap.appendChild(restrictCb);
			restrictWrap.appendChild(C.createElement('span', { text: t('audiocheck', 'Restrict who may open the app') }));
			accessFs.appendChild(restrictWrap);

			const usersChipsHost = C.createElement('div');
			const usersField = entityField(
				'ac-allowed-users-label',
				t('audiocheck', 'Allowed users'),
				'ac-allowed-users-hint',
				t('audiocheck', 'Type at least two characters to search.'),
				'ac-policy-users-q',
				'ac-policy-users-suggest',
				t('audiocheck', 'Search users to add'),
			);
			accessFs.appendChild(usersChipsHost);
			accessFs.appendChild(usersField);

			const groupsChipsHost = C.createElement('div');
			const groupsField = entityField(
				'ac-allowed-groups-label',
				t('audiocheck', 'Allowed groups'),
				'ac-allowed-groups-hint',
				t('audiocheck', 'Type at least two characters to search.'),
				'ac-policy-groups-q',
				'ac-policy-groups-suggest',
				t('audiocheck', 'Search groups to add'),
			);
			accessFs.appendChild(groupsChipsHost);
			accessFs.appendChild(groupsField);
			form.appendChild(C.sectionCard(
				t('audiocheck', 'Who may open the app'),
				t('audiocheck', 'Control which users and groups can use AudioCheck. Server and app administrators always keep access.'),
				accessFs,
			));

			const adminFs = C.createElement('fieldset', { class: 'ac-fieldset' });
			adminFs.appendChild(C.createElement('legend', { class: 'ac-fieldset__legend', text: t('audiocheck', 'Delegated admins') }));
			const adminsChipsHost = C.createElement('div');
			const adminsField = entityField(
				'ac-app-admin-label',
				t('audiocheck', 'App administrators'),
				'ac-app-admin-hint',
				t('audiocheck', 'Only real Nextcloud user accounts can be selected.'),
				'ac-policy-admins-q',
				'ac-policy-admins-suggest',
				t('audiocheck', 'Search users to add as administrators'),
			);
			adminFs.appendChild(adminsChipsHost);
			adminFs.appendChild(adminsField);
			form.appendChild(C.sectionCard(
				t('audiocheck', 'App administrators'),
				t('audiocheck', 'Delegated admins can change policy here. They still only play their own files.'),
				adminFs,
			));

			const defaultsFs = C.createElement('fieldset', { class: 'ac-fieldset' });
			defaultsFs.appendChild(C.createElement('legend', { class: 'ac-fieldset__legend', text: t('audiocheck', 'New user defaults') }));
			const folderRow = C.createElement('div', { class: 'ac-form-row' });
			folderRow.appendChild(C.createElement('label', { attrs: { for: 'ac-default-folder' }, text: t('audiocheck', 'Default library folder path') }));
			const folderInput = C.createElement('input', {
				id: 'ac-default-folder',
				type: 'text',
				name: 'defaultLibraryFolder',
				className: 'ac-input',
				attrs: { maxlength: '512' },
			});
			folderRow.appendChild(folderInput);
			defaultsFs.appendChild(folderRow);
			defaultsFs.appendChild(C.createElement('p', {
				class: 'ac-field__hint',
				text: t('audiocheck', 'Relative path inside each user\'s Files home (for example Music or Audiobooks).'),
			}));

			const mbRow = C.createElement('div', { class: 'ac-form-row' });
			mbRow.appendChild(C.createElement('label', { attrs: { for: 'ac-max-meta-mb' }, text: t('audiocheck', 'Max metadata temp size (MB)') }));
			const mbInput = C.createElement('input', {
				id: 'ac-max-meta-mb',
				type: 'number',
				name: 'maxMetaTempMb',
				className: 'ac-input',
				attrs: { min: '16', max: '2048', step: '1' },
			});
			mbRow.appendChild(mbInput);
			defaultsFs.appendChild(mbRow);
			form.appendChild(C.sectionCard(
				t('audiocheck', 'Defaults'),
				t('audiocheck', 'Suggested library folder and metadata extraction limits for new users.'),
				defaultsFs,
			));

			const actions = C.createElement('div', { class: 'ac-form-actions' });
			actions.appendChild(C.createElement('button', {
				type: 'submit',
				className: 'ac-btn ac-btn--primary',
				text: t('audiocheck', 'Save policy'),
			}));
			form.appendChild(actions);
			body.appendChild(form);
			frag.appendChild(body);

			function renderChips() {
				usersChipsHost.replaceChildren(chipList(state.allowedUsers, (id) => {
					state.allowedUsers = state.allowedUsers.filter((x) => x.id !== id);
					renderChips();
				}, (u) => u.displayName + ' (' + u.id + ')'));
				groupsChipsHost.replaceChildren(chipList(state.allowedGroups, (id) => {
					state.allowedGroups = state.allowedGroups.filter((x) => x.id !== id);
					renderChips();
				}, (g) => g.displayName + ' (' + g.id + ')'));
				adminsChipsHost.replaceChildren(chipList(state.appAdmins, (id) => {
					state.appAdmins = state.appAdmins.filter((x) => x.id !== id);
					renderChips();
				}, (a) => (a.displayName !== a.id ? a.displayName + ' (' + a.id + ')' : a.id)));
			}

			function wirePickers() {
				if (!Picker) return;
				const accountStr = {
					noResults: t('audiocheck', 'No matching accounts.'),
					searchErrorNetwork: t('audiocheck', 'Search could not load (network).'),
					searchErrorServer: t('audiocheck', 'Search could not load.'),
				};
				Picker.bindCombobox({
					input: document.getElementById('ac-policy-users-q'),
					suggest: document.getElementById('ac-policy-users-suggest'),
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
						state.allowedUsers.push(item);
						renderChips();
					},
				});
				Picker.bindCombobox({
					input: document.getElementById('ac-policy-groups-q'),
					suggest: document.getElementById('ac-policy-groups-suggest'),
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
						state.allowedGroups.push(item);
						renderChips();
					},
				});
				Picker.bindCombobox({
					input: document.getElementById('ac-policy-admins-q'),
					suggest: document.getElementById('ac-policy-admins-suggest'),
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
						state.appAdmins.push(item);
						renderChips();
					},
				});
			}

			form.addEventListener('submit', (e) => {
				e.preventDefault();
				if (restrictCb.checked && state.allowedUsers.length === 0 && state.allowedGroups.length === 0) {
					AudioCheckMessaging.toast(t('audiocheck', 'When restriction is enabled, add at least one user or group.'), 'warning');
					restrictCb.focus();
					return;
				}
				AudioCheckApi.post('/apps/audiocheck/api/admin/policy', {
					appAdminUserIds: state.appAdmins.map((a) => a.id),
					accessRestrictionEnabled: restrictCb.checked,
					allowedUserIds: state.allowedUsers.map((u) => u.id),
					allowedGroupIds: state.allowedGroups.map((g) => g.id),
					defaultLibraryFolder: folderInput.value.trim() || '/',
					maxMetaTempMb: parseInt(mbInput.value, 10) || 256,
				}).then(() => {
					AudioCheckMessaging.toast(t('audiocheck', 'Policy saved.'));
				}).catch((err) => AudioCheckMessaging.toast(err.message || t('audiocheck', 'Request failed.'), 'error'));
			});

			AudioCheckApi.get('/apps/audiocheck/api/admin/policy').then((r) => {
				const p = r.policy || {};
				state.allowedUsers = [...(p.allowedUsersPreview || [])];
				state.allowedGroups = [...(p.allowedGroupsPreview || [])];
				state.appAdmins = (p.appAdminsPreview && p.appAdminsPreview.length)
					? [...p.appAdminsPreview]
					: (p.appAdminUserIds || []).map((id) => ({ id, displayName: id }));
				restrictCb.checked = !!p.accessRestrictionEnabled;
				folderInput.value = p.defaultLibraryFolder || '/';
				mbInput.value = String(p.maxMetaTempMb || 256);
				renderChips();
				wirePickers();
			}).catch((err) => AudioCheckMessaging.toast(err.message || t('audiocheck', 'Request failed.'), 'error'));

			return frag;
		},
	});
})();
