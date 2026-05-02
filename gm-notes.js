import { sendDevMessage } from './devmessage.js';

const HandlebarsApplication =
	foundry.applications.api.HandlebarsApplicationMixin(
		foundry.applications.api.ApplicationV2
	);

class GMNote extends HandlebarsApplication {
	static alwaysHideLabelForSystem = ['dnd5e'];

	static get shouldHideLabel() {
		return (
			game.settings.get('gm-notes', 'hideLabel') ||
			GMNote.alwaysHideLabelForSystem.includes(game.system.id)
		);
	}

	/** @param {Application | foundry.applications.api.ApplicationV2 | null | undefined} win */
	static _isActiveWindowUsable(win) {
		if (!win) return false;
		if (typeof win.rendered === 'boolean') return win.rendered;
		const V2 = foundry.applications.api.ApplicationV2;
		if (V2?.RENDER_STATES?.RENDERED != null && win.state != null) {
			return win.state === V2.RENDER_STATES.RENDERED;
		}
		const V1 = foundry.appv1?.api?.Application;
		if (V1?.RENDER_STATES?.RENDERED != null && win.state != null) {
			return win.state === V1.RENDER_STATES.RENDERED;
		}
		return true;
	}

	/** Notes HTML flag for header display; `app` is a sheet application (V1 or V2). */
	static _getGmNotesForHeaderApp(app) {
		if (app.constructor.name === 'EnhancedJournal') {
			const notesID = app.subsheet?.pagesInView?.[0]?.dataset?.pageId;
			return notesID
				? app.object?.pages?.get(notesID)?.getFlag('gm-notes', 'notes') ?? ''
				: '';
		}
		if (app.document?.constructor?.name === 'JournalEntry') {
			const journal = app.document;
			const pagesInView =
				journal.sheet?.pagesInView ?? journal._sheet?.pagesInView;
			const currentPageId = pagesInView?.[0]?.dataset?.pageId;
			const page = currentPageId ? journal.pages.get(currentPageId) : null;
			return page ? page.getFlag('gm-notes', 'notes') ?? '' : '';
		}
		return app.document?.getFlag?.('gm-notes', 'notes') ?? '';
	}

	static _applyGmNoteV1HeaderAnchor(gmNotesButton, notes) {
		if (!gmNotesButton) return;
		const hasNotes = !!notes;
		gmNotesButton.style.color =
			game.settings.get('gm-notes', 'colorLabel') && hasNotes
				? 'var(--palette-success, green)'
				: '';
		const iconClass = hasNotes ? 'fa-clipboard-check' : 'fa-clipboard';
		gmNotesButton.innerHTML = `<i class="fas ${iconClass}"></i> ${
			GMNote.shouldHideLabel ? '' : game.i18n.localize('GMNote.label')
		}`;
	}

	/** @param {foundry.abstract.Document} doc Actor/Item/JournalEntry/… owning a sheet */
	static _v2GmNoteIconSelector(doc) {
		if (!doc) return null;
		const sheetOwner = doc instanceof JournalEntryPage ? doc.parent : doc;
		const id = sheetOwner?.sheet?.id;
		return id
			? `#${id} li[data-action="open-gm-note"] button.control i`
			: null;
	}

	static _setV2GmNoteIconFromDocument(doc, notes) {
		const sel = GMNote._v2GmNoteIconSelector(doc);
		const gmNotesButton = sel ? document.querySelector(sel) : null;
		if (!gmNotesButton) return;
		const colorChange =
			game.settings.get('gm-notes', 'colorLabel') && notes
				? 'gm-notes.green'
				: '';
		gmNotesButton.className = `open-gm-note fas ${
			notes ? 'fa-clipboard-check' : 'fa-clipboard'
		} ${colorChange}`.replace(/\s+$/, '');
	}

	static showGMNoteWindow() {
		const win = ui.activeWindow;
		let gmNoteObject = win?.object ?? win?.document;
		let page = null;

		// Special handling for Journals
		if (gmNoteObject?.constructor.name === 'JournalEntryPage') {
			page = gmNoteObject;
		} else if (gmNoteObject?.constructor.name === 'JournalEntry') {
			const pagesInView =
				gmNoteObject.sheet?.pagesInView ??
				gmNoteObject._sheet?.pagesInView;
			page = gmNoteObject.pages.get(
				pagesInView?.[0]?.dataset?.pageId
			);
		}

		if (page) {
			gmNoteObject = page;
		}		

		// Selection priority
		// Active window
		// If no active window, we instead select the controlled item on the canvas, if such exist
		// if the controlled item on the canvas is a TokenDocument, we get the Actor from that
		if (
			!win ||
			!GMNote._isActiveWindowUsable(win) ||
			!gmNoteObject
		) {
			const objs = canvas[ui.controls.control.name]?.controlled;
			if (!objs || objs.length == 0) {
				return;
			}
			if (objs[0].document instanceof TokenDocument) {
				gmNoteObject = objs[0].document.actor;
			} else {
				gmNoteObject = objs[0].document;
			}
		}
		if( !gmNoteObject ) {
			// Can't find suitable document
			return;
		}
		new gmnote.GMNote(gmNoteObject, {
			submitOnClose: true,
			closeOnSubmit: false,
			submitOnUnfocus: true,
		}).render(true);
	}

	/** @returns {foundry.abstract.Document} */
	get object() {
		return this.options.document;
	}

	/** @override */
	get title() {
		const doc = this.object;
		if (!doc) return game.i18n.localize('GMNote.label');
		return game.i18n.format('GMNote.title', {
			document: doc.name ?? `${doc.documentName}[${doc.id}]`,
		});
	}

	constructor(first, ...rest) {
		super(GMNote._migrateConstructorParams(first, rest));
	}

	/**
	 * @param {unknown} first
	 * @param {unknown[]} rest
	 * @returns {object}
	 */
	static _migrateConstructorParams(first, rest) {
		const legacy = rest[0] instanceof Object ? rest[0] : {};
		if (first instanceof foundry.abstract.Document) {
			return GMNote.#buildOptions(first, legacy);
		}
		if (
			first instanceof Object &&
			first.document instanceof foundry.abstract.Document &&
			!(first instanceof foundry.abstract.Document)
		) {
			const merged = foundry.utils.mergeObject(
				foundry.utils.mergeObject({}, first),
				legacy
			);
			return GMNote.#buildOptions(merged.document, merged);
		}
		throw new Error(
			'GMNote requires a Document instance or an options object with { document }'
		);
	}

	static #buildOptions(document, legacy) {
		const leg = foundry.utils.mergeObject({}, legacy);
		delete leg.document;
		const {
			submitOnClose = true,
			closeOnSubmit = false,
			submitOnUnfocus = true,
			form: legacyForm,
			...passThrough
		} = leg;
		return {
			document,
			submitOnClose,
			submitOnUnfocus,
			form: foundry.utils.mergeObject(
				{
					handler: GMNote.#onSubmitForm,
					submitOnChange: false,
					closeOnSubmit,
				},
				legacyForm ?? {}
			),
			...passThrough,
		};
	}

	static DEFAULT_OPTIONS = {
		id: 'gm-note-{id}',
		tag: 'form',
		classes: ['gm-notes', 'sheet'],
		window: {
			title: 'GMNote.label',
			resizable: true,
		},
		position: { width: 600, height: 700 },
		document: null,
		submitOnClose: true,
		/** Accepted for API compatibility; App V2 has no core submit-on-unfocus (see FormApplication options). */
		submitOnUnfocus: true,
		form: {
			handler: GMNote.#onSubmitForm,
			submitOnChange: false,
			closeOnSubmit: false,
		},
		actions: {
			moveToNote: GMNote.#onMoveToNote,
			moveToDescription: GMNote.#onMoveToDescription,
		},
	};

	static PARTS = {
		body: {
			template: 'modules/gm-notes/templates.html',
			root: true,
		},
	};

	/**
	 * Rich-text editor registrations (same role as {@link FormApplication#editors}).
	 * @type {Record<string, object>}
	 */
	editors = {};

	get isEditable() {
		return game.user.isGM;
	}

	get showExtraButtons() {
		const onlyShow = ['JournalEntryPage'];
		return !game.dnd5e && onlyShow.includes(this.object.documentName);
	}

	/**
	 * Serialize form data including active ProseMirror instances ({@link foundry.applications.ux.FormDataExtended}).
	 * @override
	 */
	async _onSubmitForm(formConfig, event) {
		event.preventDefault();
		const form = event.currentTarget;
		const { handler, closeOnSubmit } = formConfig;
		const formData = new foundry.applications.ux.FormDataExtended(form, {
			editors: this.editors,
		});
		if (typeof handler === 'function') {
			try {
				await handler.call(this, event, form, formData);
			} catch (err) {
				ui.notifications.error(err, { console: true });
				return;
			}
		}
		if (closeOnSubmit) await this.close({ submitted: true });
	}

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const doc = this.object;
		context.journalNotes = await foundry.applications.ux.TextEditor.enrichHTML(
			doc.getFlag('gm-notes', 'notes'),
			{ async: true }
		);
		context.flags = doc.flags;
		context.owner = game.user.id;
		context.isGM = game.user.isGM;
		context.showExtraButtons = this.showExtraButtons;
		context.editable = true;
		return context;
	}

	/** @override */
	async _onFirstRender(context, options) {
		await super._onFirstRender(context, options);
		this.object.apps[this.id] = this;
	}

	/** @override */
	async _onRender(context, options) {
		await super._onRender(context, options);
		this.#tearDownEditors();
		if (!this.isEditable || !this.form) return;
		for (const div of this.form.querySelectorAll('.editor-content[data-edit]')) {
			this._activateEditor(div);
		}
	}

	/** @override */
	_onClose(options) {
		this.#tearDownEditors();
		super._onClose(options);
		delete this.object.apps[this.id];
	}

	#tearDownEditors() {
		for (const ed of Object.values(this.editors)) {
			if (ed.instance) {
				try {
					ed.instance.destroy();
				} catch (_) {
					/* ignore */
				}
			}
		}
		this.editors = {};
	}

	/** @override */
	async _preClose(options) {
		if (!options.submitted && this.options.submitOnClose && this.form) {
			const event = new Event('submit', { cancelable: true });
			Object.defineProperty(event, 'currentTarget', {
				value: this.form,
				configurable: true,
			});
			await this._onSubmitForm(this.options.form, event);
		}
		await super._preClose(options);
	}

	/**
	 * submitOnUnfocus is accepted for API compatibility with legacy callers; core does not implement it for App V2.
	 * @type {ApplicationFormSubmission}
	 */
	static async #onSubmitForm(_event, _form, formData) {
		const raw = formData.object ?? {};
		if (foundry.utils.isEmpty(raw)) return;
		const expanded = foundry.utils.expandObject(raw);
		let notes = expanded.flags?.['gm-notes']?.notes;
		if (notes === undefined) notes = raw['flags.gm-notes.notes'];
		if (notes === undefined) return;
		if (game.user.isGM) {
			if (this.object.constructor.name === 'JournalEntry') {
				const page = this.getCurrentPage();
				if (!page) {
					ui.notifications.error('No current page found');
					return;
				}
				await page.setFlag('gm-notes', 'notes', notes);
			} else {
				await this.object.setFlag('gm-notes', 'notes', notes);
			}
		} else {
			ui.notifications.error('You have to be GM to edit GM Notes.');
		}
	}

	static #onMoveToNote(_event, _target) {
		return this._moveToNotes();
	}

	static #onMoveToDescription(_event, _target) {
		return this._moveToDescription();
	}

	/**
	 * Register one {{editor}} field (mirrors {@link FormApplication#_activateEditor}).
	 * @param {HTMLElement} div  `.editor-content[data-edit]`
	 */
	_activateEditor(div) {
		const name = div.dataset.edit;
		const engine = div.dataset.engine || 'prosemirror';
		const collaborate = div.dataset.collaborate === 'true';
		const button = div.previousElementSibling;
		const hasButton = button && button.classList.contains('editor-edit');
		const wrap = div.parentElement?.parentElement;
		const wc = div.closest('.window-content');
		const heights = [wrap?.offsetHeight, wc ? wc.offsetHeight : null];
		if (div.offsetHeight > 0) heights.push(div.offsetHeight);
		const height = Math.min(...heights.filter(h => Number.isFinite(h)));

		const options = {
			target: div,
			fieldName: name,
			save_onsavecallback: () => this.saveEditor(name),
			height,
			engine,
			collaborate,
		};
		if (engine === 'prosemirror') {
			options.plugins = this._configureProseMirrorPlugins(name, {
				remove: hasButton,
			});
		} else if (!(engine in CONFIG.TextEditor.engines)) {
			console.warn(`Unrecognized text editor engine '${engine}'`);
			return;
		}

		const initial = foundry.utils.getProperty(this.object, name);
		const editor = (this.editors[name] = {
			options,
			target: name,
			button,
			hasButton,
			mce: null,
			instance: null,
			active: !hasButton,
			changed: false,
			initial,
		});

		const activate = () => {
			editor.initial = foundry.utils.getProperty(this.object, name);
			this.activateEditor(name, {}, editor.initial);
		};
		if (hasButton) button.onclick = activate;
		else activate();
	}

	_configureProseMirrorPlugins(name, { remove = true } = {}) {
		return {
			menu: ProseMirror.ProseMirrorMenu.build(ProseMirror.defaultSchema, {
				destroyOnSave: remove,
				onSave: () => this.saveEditor(name, { remove }),
			}),
			keyMaps: ProseMirror.ProseMirrorKeyMaps.build(ProseMirror.defaultSchema, {
				onSave: () => this.saveEditor(name, { remove }),
			}),
		};
	}

	async activateEditor(name, options = {}, initialContent = '') {
		const editor = this.editors[name];
		if (!editor) throw new Error(`${name} is not a registered editor name!`);
		options = foundry.utils.mergeObject(editor.options, options);
		if (!options.fitToSize) options.height = options.target.offsetHeight;
		if (editor.hasButton) editor.button.style.display = 'none';
		const TextEditor = foundry.applications.ux.TextEditor;
		const instance = (editor.instance = editor.mce =
			await TextEditor.implementation.create(
				options,
				initialContent || editor.initial
			));
		options.target.closest('.editor')?.classList.add(options.engine ?? 'prosemirror');
		editor.changed = false;
		editor.active = true;
		Hooks.callAll('activateEditorLegacy', editor, options, initialContent);
		return instance;
	}

	async saveEditor(name, { remove = true, preventRender } = {}) {
		const editor = this.editors[name];
		if (!editor?.instance) {
			throw new Error(`${name} is not an active editor name!`);
		}
		editor.active = false;
		const instance = editor.instance;
		const event = new Event('submit', { cancelable: true });
		Object.defineProperty(event, 'currentTarget', {
			value: this.form,
			configurable: true,
		});
		await this._onSubmitForm(this.options.form, event);
		if (remove) {
			instance.destroy();
			editor.instance = editor.mce = null;
			if (editor.hasButton) editor.button.style.display = 'block';
			if (!preventRender) await this.render({ force: true });
		}
		editor.changed = false;
	}

	getCurrentPage() {
		if (this.object.constructor.name !== 'JournalEntry') {
			return null;
		}
		const pagesInView =
			this.object.sheet?.pagesInView ?? this.object._sheet?.pagesInView;
		const pageIdentifier = pagesInView?.[0]?.dataset?.pageId;

		if (pageIdentifier) {
			return this.object.pages.get(pageIdentifier);
		}
		return null;
	}

	async sleep(ms) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	static async _addContentToJournal(app, html, data) {
		if (!game.user.isGM) return;

		const page = app.document ?? app.object;
		if (!(page instanceof JournalEntryPage)) return;

		const root =
			html instanceof HTMLElement
				? html
				: html?.get?.(0) ?? html?.[0] ?? null;
		if (!root) return;

		if (root.querySelector('.gm-notes-content')) return;

		const gmNotes = page.getFlag('gm-notes', 'notes');
		if (!gmNotes) return;

		const journalContent =
			root.querySelector('.journal-page-content') ??
			root.querySelector('.editor-content') ??
			root.querySelector('.prosemirror-editor') ??
			root.querySelector('article') ??
			root;

		const gmNotesDiv = document.createElement('div');
		gmNotesDiv.classList.add('gm-notes-content');

		const enrichedContent =
			await foundry.applications.ux.TextEditor.enrichHTML(gmNotes, {
				async: true,
			});
		gmNotesDiv.innerHTML = `<hr><h1>GM Notes</h1>${enrichedContent}`;
		journalContent.append(gmNotesDiv);
	}

	static _attachHeaderButton(app, buttons) {
		// If user is not GM - don't do anything, similar if the app lacks document or is not one of the supported types
		if (!game.user.isGM || !app.document) return;
		const supportedTypes = [
			'Tile',
			'Actor',
			'Item',
			'AmbientLight',
			'Wall',
			'RollTable',
			'Drawing',
			'JournalEntry',
			'JournalEntryPage',
			'Scene'
		];
		if(!supportedTypes.includes(app.document.documentName)) {
			return;
		}

		const activateGMNote = ev => {
			if (app.constructor.name === 'EnhancedJournal') {
				new GMNote(
					app.document.pages.get(app.subsheet.pagesInView[0]?.dataset?.pageId),
					{ submitOnClose: true, closeOnSubmit: false, submitOnUnfocus: true }
				).render(true);
			} else if (app.document instanceof JournalEntryPage) {
				if (app.constructor.name === 'JournalEntryPageProseMirrorSheet') {
					ui.notifications.warn(
						game.i18n.localize('GMNote.noGMNotesInEditPage')
					);
					return;
				}
				new GMNote(app.document, {
					submitOnClose: true,
					closeOnSubmit: false,
					submitOnUnfocus: true,
				}).render(true);
			} else if (app.document.constructor.name === 'JournalEntry') {
				const pagesInView =
					app.document.sheet?.pagesInView ??
					app.document._sheet?.pagesInView;
				const page = app.document.pages.get(
					pagesInView?.[0]?.dataset?.pageId
				);
				if (!page) {
					ui.notifications.warn(game.i18n.localize('GMNote.noPageInJournal'));
					return;
				} else if (app.constructor.name === 'JournalEntryPageProseMirrorSheet') {
					ui.notifications.warn(
						game.i18n.localize('GMNote.noGMNotesInEditPage')
					);
					return;
				}
				new GMNote(page, {
					submitOnClose: true,
					closeOnSubmit: false,
					submitOnUnfocus: true,
				}).render(true);
			} else {
				new GMNote(app.document, {
					submitOnClose: true,
					closeOnSubmit: false,
					submitOnUnfocus: true,
				}).render(true);
			}
		};

		const gmNoteIconClass = () => {
			const notes = GMNote._getGmNotesForHeaderApp(app);
			return `fas ${notes ? 'fa-clipboard-check' : 'fa-clipboard'}`;
		};

		const gmNoteButton = {
			label: game.i18n.localize('GMNote.label'),
			tooltip: game.i18n.localize('GMNote.label'),
			action: 'open-gm-note',
			class: 'open-gm-note',
			icon: gmNoteIconClass(),
			onClick: ev => activateGMNote(ev),
			onclick: ev => activateGMNote(ev),
		};

		if (app.constructor.name === 'EnhancedJournal') {
			setTimeout(() => {
				let fullscreenButton = app.element.find(
					'.header-button.control.toggle-fullscreen'
				);
				const iconClass = gmNoteIconClass();
				const buttonHtml = `<a class="${gmNoteButton.class}" title="${gmNoteButton.tooltip}"><i class="${iconClass}"></i></a>`;
				const buttonElement = document.createElement('div');
				buttonElement.innerHTML = buttonHtml;
				const button = buttonElement.firstChild;
				button.addEventListener('click', gmNoteButton.onclick);
				fullscreenButton.parentNode.insertBefore(button, fullscreenButton);
			}, 800);
		} else {
			// If app has document
			if (!(app.document instanceof foundry.abstract.Document)) return;
			buttons.unshift(gmNoteButton);
		}
	}

	static _updateHeaderButton(app, [elem], options) {
		// Ignore non-document apps
		if (
			!(
				app.document instanceof foundry.abstract.Document ||
				app.constructor.name === 'EnhancedJournal'
			)
		)
			return;

		// Make sure elem is parent
		elem = elem.closest('.window-app');

		// Check if user is GM
		if (!game.user.isGM) return;

		let delay = 150;
		if (app.constructor.name === 'EnhancedJournal') {
			// Very long delay to ensure the page is fully loaded and we can get the notes (tested on a journal with over 1000 pages)
			delay = 5000;
		}

		// Introduce a delay to ensure the page is fully updated
		setTimeout(() => {
			// Check if elem has header button
			let gmNotesButton = elem?.querySelector('.open-gm-note');

			// For Enhanced Journal, we might need to re-add the button
			if (!gmNotesButton && app.constructor.name === 'EnhancedJournal') {
				let fullscreenButton = elem.querySelector(
					'.header-button.control.toggle-fullscreen'
				);
				const buttonHtml = `<a class="open-gm-note" title="${game.i18n.localize(
					'GMNote.label'
				)}"><i class="fas fa-clipboard"></i></a>`;
				const buttonElement = document.createElement('div');
				buttonElement.innerHTML = buttonHtml;
				const button = buttonElement.firstChild;
				button.addEventListener('click', () => {
					const page = app.object.pages.get(
						app.subsheet.pagesInView[0]?.dataset?.pageId
					);
					new GMNote(page, {
						submitOnClose: true,
						closeOnSubmit: false,
						submitOnUnfocus: true,
					}).render(true);
				});
				fullscreenButton.parentNode.insertBefore(button, fullscreenButton);
				gmNotesButton = button;
			}

			if (!gmNotesButton) return;

			const notes = GMNote._getGmNotesForHeaderApp(app);
			GMNote._applyGmNoteV1HeaderAnchor(gmNotesButton, notes);
			if (app.document instanceof foundry.abstract.Document) {
				GMNote._setV2GmNoteIconFromDocument(app.document, notes);
			}
		}, delay);
	}

	/** After closing the GM Note window, refresh the parent sheet V2 header icon. */
	static _updateHeaderButtonV2(gmNoteApp) {
		if (!(gmNoteApp instanceof GMNote)) return;
		const doc = gmNoteApp.object;
		if (!doc) return;
		const notes = doc.getFlag?.('gm-notes', 'notes') ?? '';
		GMNote._setV2GmNoteIconFromDocument(doc, notes);
	}

	/** Journal page sheet render: inject GM note preview and sync header control. */
	static async _onRenderJournalPageSheet(app, html, data) {
		try {
			await GMNote._addContentToJournal(app, html, data);
		} catch (err) {
			console.error('gm-notes | journal GM note preview failed', err);
		}
		if (!game.user.isGM) return;
		const page = app.document ?? app.object;
		if (!(page instanceof JournalEntryPage)) return;
		const journal = page.parent;
		const pagesInView =
			journal?.sheet?.pagesInView ?? journal?._sheet?.pagesInView;
		const currentPageId = pagesInView?.[0]?.dataset?.pageId;
		const pageForIcon = currentPageId
			? journal.pages.get(currentPageId)
			: page;
		const notes = pageForIcon?.getFlag('gm-notes', 'notes') ?? '';
		GMNote._setV2GmNoteIconFromDocument(pageForIcon ?? page, notes);
	}

	/** ApplicationV2 render: refresh GM note header visuals (V1 anchor + V2 control icon). */
	static _updateHeaderButtonApplicationV2(app, element, context, options) {
		if (!game.user.isGM) return;
		if (
			!(
				app.document instanceof foundry.abstract.Document ||
				app.constructor.name === 'EnhancedJournal'
			)
		)
			return;

		const windowApp =
			element?.closest?.('.window-app') ??
			document.getElementById(app.id)?.closest?.('.window-app');

		let delay = 150;
		if (app.constructor.name === 'EnhancedJournal') delay = 5000;

		setTimeout(() => {
			const win =
				windowApp ??
				document.getElementById(app.id)?.closest?.('.window-app');
			const notes = GMNote._getGmNotesForHeaderApp(app);

			if (app.document instanceof foundry.abstract.Document) {
				GMNote._setV2GmNoteIconFromDocument(app.document, notes);
			}

			if (!win) return;
			let gmNotesButton = win.querySelector('.open-gm-note');
			if (!gmNotesButton && app.constructor.name === 'EnhancedJournal') {
				const fullscreenButton = win.querySelector(
					'.header-button.control.toggle-fullscreen'
				);
				if (fullscreenButton) {
					const buttonHtml = `<a class="open-gm-note" title="${game.i18n.localize(
						'GMNote.label'
					)}"><i class="fas fa-clipboard"></i></a>`;
					const wrap = document.createElement('div');
					wrap.innerHTML = buttonHtml;
					const button = wrap.firstChild;
					button.addEventListener('click', () => {
						const page = app.object.pages.get(
							app.subsheet.pagesInView[0]?.dataset?.pageId
						);
						new GMNote(page, {
							submitOnClose: true,
							closeOnSubmit: false,
							submitOnUnfocus: true,
						}).render(true);
					});
					fullscreenButton.parentNode.insertBefore(button, fullscreenButton);
					gmNotesButton = button;
				}
			}
			if (gmNotesButton) {
				GMNote._applyGmNoteV1HeaderAnchor(gmNotesButton, notes);
			}
		}, delay);
	}

	async _moveToNotes() {
		if (game.dnd5e && this.object.constructor.name !== 'JournalEntryPage') {
			let descPath = '';
			switch (this.object.constructor.name) {
				case 'Actor5e':
					descPath = 'system.details.biography.value';
					break;
				case 'Item5e':
					descPath = 'system.description.value';
					break;
			}
			let description = foundry.utils.getProperty(this.object, descPath);
			let notes = foundry.utils.getProperty(
				this.object,
				'flags.gm-notes.notes'
			);

			if (notes === undefined) notes = '';
			if (description === undefined) description = '';

			let obj = {};
			obj[descPath] = '';
			await this.object.setFlag('gm-notes', 'notes', notes + description);
			await this.object.update(obj);
			// No longeer required - the update will re-render
			// this.render();
		} else if (this.object.constructor.name === 'JournalEntryPage') {
			const selection = window.getSelection();
			if (selection.rangeCount === 0 || selection.toString().trim() === '') {
				ui.notifications.warn(game.i18n.localize('GMNote.noSelection'));
				return;
			}

			const range = selection.getRangeAt(0);
			const selectedContent = range.cloneContents();
			const div = document.createElement('div');
			div.appendChild(selectedContent);

			// Normalize links (doesn't work all the time)
			div.querySelectorAll('a.content-link').forEach(link => {
				const dataPack = link.getAttribute('data-pack');
				const dataId = link.getAttribute('data-id');
				const text = link.textContent;
				if (dataPack && dataId) {
					link.outerHTML = `@Compendium[${dataPack}.${dataId}]{${text}}`;
				} else {
					const dataType = link.getAttribute('data-type');
					if (dataType === 'JournalEntry') {
						const uuid = link.getAttribute('data-uuid') || text; // Use UUID if available
						link.outerHTML = `@JournalEntry[${uuid}]{${text}}`;
					}
				}
			});

			// Remove data-anchor attributes (helps sometimes)
			div.querySelectorAll('[data-anchor]').forEach(el => {
				el.removeAttribute('data-anchor');
			});

			const selectedHTML = div.innerHTML;

			// Attempt to find the parent element with a page ID
			let selectedObjectId = null;
			let node = range.startContainer;
			while (node) {
				if (node.dataset && node.dataset.pageId) {
					selectedObjectId = node.dataset.pageId;
					break;
				}
				node = node.parentNode;
			}
			const pageId = this.object._id;
			if (selectedObjectId !== pageId) {
				ui.notifications.warn(game.i18n.localize('GMNote.copiedToNotes'));
			}

			let page = this.object;
			let description = foundry.utils.getProperty(page, 'text.content') ?? '';
			let notes = page.getFlag('gm-notes', 'notes') ?? '';

			// Update the GM notes with the selected HTML
			await page.setFlag('gm-notes', 'notes', notes + selectedHTML);

			// If the selected text is from the current page, delete the selected text from the document
			if (selectedObjectId === pageId) {
				// Delete the selected text from the document
				range.deleteContents();
				let obj = {};
				if (description.includes(selectedHTML)) {
					obj['text.content'] = description.replace(selectedHTML, '');
					// Update the page content
					await page.update(obj);
				} else {
					ui.notifications.warn(
						game.i18n.localize('GMNote.formattingIssuesDescription')
					);
				}
			}
		}
	}

	async _moveToDescription() {
		if (game.dnd5e && this.object.constructor.name !== 'JournalEntryPage') {
			let descPath = '';
			switch (this.object.constructor.name) {
				case 'Actor5e':
					descPath = 'system.details.biography.value';
					break;
				case 'Item5e':
					descPath = 'system.description.value';
					break;
			}
			let description = foundry.utils.getProperty(this.object, descPath);
			let notes = this.object.getFlag('gm-notes', 'notes');

			if (notes === undefined) notes = '';
			if (description === undefined) description = '';

			let obj = {};
			obj[descPath] = description + notes;
			await this.object.setFlag('gm-notes', 'notes', '');
			await this.object.update(obj); // this will re-render
		} else if (this.object.constructor.name === 'JournalEntryPage') {
			const selection = window.getSelection();
			if (selection.rangeCount === 0 || selection.toString().trim() === '') {
				ui.notifications.warn(game.i18n.localize('GMNote.noSelection'));
				return;
			}

			const range = selection.getRangeAt(0);
			const selectedContent = range.cloneContents();
			const div = document.createElement('div');
			div.appendChild(selectedContent);
			const selectedHTML = div.innerHTML;

			// Find if the current window is the GM notes window
			let currentWindowIsGMNotes = null;
			let node = range.startContainer;
			while (node) {
				if (node.dataset && node.id) {
					currentWindowIsGMNotes = node.classList.contains('gm-notes');
					break;
				}
				node = node.parentNode;
			}
			if (!currentWindowIsGMNotes) {
				ui.notifications.warn(game.i18n.localize('GMNote.notFromNotes'));
				return;
			}

			// Delete the selected text from the GM notes
			range.deleteContents();

			let page = this.object;
			let description = foundry.utils.getProperty(page, 'text.content') ?? '';
			let notes = page.getFlag('gm-notes', 'notes') ?? '';

			// Update the description with the selected HTML
			let obj = {};
			obj['text.content'] = description + selectedHTML;

			// Update the GM notes by removing the selected HTML
			if (notes.includes(selectedHTML)) {
				await page.setFlag(
					'gm-notes',
					'notes',
					notes.replace(selectedHTML, '')
				);
			} else {
				ui.notifications.warn(
					game.i18n.localize('GMNote.formattingIssuesNotes')
				);
			}

			// Update the page content
			await page.update(obj);
		}
	}
}

// Migrate journal GM notes to the first page of each journal to align with the change in how journal pages are handled
async function migrateJournalNotes() {
	// Get all journal entries
	const journals = game.journal.contents;

	for (let journal of journals) {
		// Check if the journal entry has GM notes
		const gmNotes = journal.getFlag('gm-notes', 'notes');
		if (!gmNotes) continue;

		// Get the first page of the journal entry
		const firstPage = journal.pages.contents[0];
		if (!firstPage) continue;

		// Check if the first page already has GM notes
		const pageNotes = firstPage.getFlag('gm-notes', 'notes') || '';

		// Append the journal's GM notes to the first page's GM notes
		await firstPage.setFlag('gm-notes', 'notes', pageNotes + gmNotes);

		// Clear the GM notes from the journal entry
		await journal.unsetFlag('gm-notes', 'notes');
	}

	ui.notifications.info(game.i18n.localize('GMNote.migrationCompleted'));
}

Hooks.once('init', () => {
	game.settings.register('gm-notes', 'hideLabel', {
		name: game.i18n.localize('GMNote.setting'),
		hint: game.i18n.localize('GMNote.settingHint'),
		scope: 'world',
		config: game.system.id != 'dnd5e',
		default: game.system.id == 'dnd5e',
		type: Boolean,
	});
	game.settings.register('gm-notes', 'colorLabel', {
		name: game.i18n.localize('GMNote.colorSetting'),
		scope: 'world',
		config: true,
		default: false,
		type: Boolean,
	});

	game.settings.register('gm-notes', 'showInTokenNoteHover', {
		name: game.i18n.localize('GMNote.showInTokenNoteHover'),
		scope: 'user',
		config: game.modules.get('token-note-hover')?.active,
		default: true,
		type: Boolean,
	});	

	game.settings.register('gm-notes', 'devMessageVersionNumber', {
		name: 'Development message version',
		scope: 'world',
		config: false,
		type: String,
		default: '0',
	});

	// Register a dummy setting to inject the button
	game.settings.register('gm-notes', 'migrateNotes', {
		name: game.i18n.localize('GMNote.migrateButton'),
		hint: game.i18n.localize('GMNote.migrateButtonHint'),
		scope: 'world',
		config: true,
		type: Boolean,
		default: false,
	});

	// Expose API
	globalThis.gmnote = { GMNote: GMNote };

	// Register keybinding
	const hotkey = {
		name: 'GMNote.hotKeyName',
		hint: 'GMNote.hotKeyHint',
		restricted: true,
		onDown: () => {
			GMNote.showGMNoteWindow();
		},
		onUp: () => {},
	};

	game.keybindings.register('gm-notes', 'showGMNote', hotkey);
});

// Inject the button to migrate GM notes to the first page of each journal
Hooks.on('renderSettingsConfig', (app, html, data) => {
	const button = document.createElement('button');
	button.type = 'button';
	button.textContent = game.i18n.localize('GMNote.migrateButton');
	button.addEventListener('click', async () => {
		await migrateJournalNotes();
	});

	// Find the setting and replace its content with the button
	const setting = html.querySelector(
		'div.form-group:has([name="gm-notes.migrateNotes"])'
	);
	if (setting) {
		const input = setting.querySelector('input');
		if (input) input.remove(); // Remove the checkbox
		const label = setting.querySelector('label');
		if (label) label.insertAdjacentElement('afterend', button); // Add the button after the label
	}
});

Hooks.once('ready', async function () {
	if (game.user.isGM) {
		sendDevMessage();
// Support for other modules
		Hooks.on('tokenNoteHover.createContent', (actor, imageDisplay, contentMap) => {			
			if(game.settings.get('gm-notes', 'showInTokenNoteHover') && actor.flags['gm-notes']?.notes ) {
				const html = `<div class="gm-notes"><h4 class="header">${game.i18n.localize('GMNote.label')}</h4><p>${actor.flags['gm-notes']?.notes}</p></div>`;
				contentMap.content = contentMap.content+html; 
			}
		});		
	}
	console.info(`gm-notes | Module[gm-notes] ready hook complete`);
});

// Define Hooks to Montior
const watchedHooks = ['ActorSheet', 'ItemSheet', 'Application'];
// Loop through hooks and attach header button and listener
watchedHooks.forEach(hook => {
	Hooks.on(`get${hook}HeaderButtons`, GMNote._attachHeaderButton);
	Hooks.on(`render${hook}`, GMNote._updateHeaderButton);
});

// Register the GM Note sheet for Tidy5e Sheet
Hooks.once('tidy5e-sheet.ready', api => {
	api.registerItemHeaderControls?.({
		controls: [
			{
				icon: 'fas fa-clipboard',
				label: game.i18n.localize('GMNote.label'),
				async onClickAction() {
					new GMNote(this.document, {
						submitOnClose: true,
						closeOnSubmit: false,
						submitOnUnfocus: true,
					}).render(true);
				},
			},
		],
	});
});

const watchedHooksV2 = [
	'ActorSheetV2',
	'ItemSheetV2',
	'AmbientLightConfig',
	'DrawingConfig',
	'WallConfig',
	'TileConfig',
	'JournalEntrySheet',
	'RollTableSheet',
];

Hooks.on('closeApplication', GMNote._updateHeaderButtonV2);
Hooks.on('closeApplicationV2', GMNote._updateHeaderButtonV2);

Hooks.on('getHeaderControlsApplicationV2', GMNote._attachHeaderButton);

Hooks.on('renderApplicationV2', GMNote._updateHeaderButtonApplicationV2);
watchedHooksV2.forEach(hook => {
	Hooks.on(`render${hook}`, GMNote._updateHeaderButtonApplicationV2);
});

Hooks.on('renderJournalPageSheet', GMNote._onRenderJournalPageSheet);
