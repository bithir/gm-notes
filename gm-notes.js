import { sendDevMessage } from './devmessage.js';
class GMNote extends FormApplication {
	static alwaysHideLabelForSystem = ["dnd5e"];

	static get shouldHideLabel() {
		return game.settings.get("gm-notes", "hideLabel") || GMNote.alwaysHideLabelForSystem.includes(game.system.id);
	}

	static showGMNoteWindow() {
		const win = ui.activeWindow;
		let gmNoteObject = win?.object;
		let page = null;

		// Special handling for Journals
		if (gmNoteObject?.constructor.name === "JournalEntryPage") {
			page = gmNoteObject;
		} else if (gmNoteObject?.constructor.name === "JournalEntry") {
			page = gmNoteObject.pages.get(gmNoteObject._sheet.pagesInView[0]?.dataset?.pageId);
		}

		if (page) {
			gmNoteObject = page;
		}

		// Selection priority
		// Active window
		// If no active window, we instead select the controlled item on the canvas, if such exist
		// if the controlled item on the canvas is a TokenDocument, we get the Actor from that
		if (!win || win._state != Application.RENDER_STATES.RENDERED || !win.object) {
			const objs = canvas[ui.controls.control.layer].controlled;
			if (!objs || objs.length == 0) {
				return;
			}
			if (objs[0].document instanceof TokenDocument) {
				gmNoteObject = objs[0].document.actor;
			} else {
				gmNoteObject = objs[0].document;
			}
		}

		new gmnote.GMNote(gmNoteObject, { submitOnClose: true, closeOnSubmit: false, submitOnUnfocus: true }).render(true);
	}

	constructor(object, options) {
		super(object, options);
		this.object.apps[this.appId] = this;
	}

	get showExtraButtons() {
		return (game.dnd5e && this.object.constructor.name !== "RollTable") || this.object.constructor.name === "JournalEntryPage";
	}

	static get defaultOptions() {
		const options = super.defaultOptions;
		options.template = "modules/gm-notes/templates.html";
		options.width = "600";
		options.height = "700";
		options.classes = ["gm-notes", "sheet"];
		options.title = game.i18n.localize("GMNote.label");
		options.resizable = true;
		options.editable = true;
		return options;
	}

	async getData() {
		const data = super.getData();

		data.journalNotes = await foundry.applications.ux.TextEditor.enrichHTML(this.object.getFlag("gm-notes", "notes"), { async: true });
		data.flags = this.object.flags;
		data.owner = game.user.id;
		data.isGM = game.user.isGM;
		data.showExtraButtons = this.showExtraButtons;

		return data;
	}

	getCurrentPage() {
		if (this.object.constructor.name !== "JournalEntry") {
			return null;
		}
		// Find current page
		let pageIdentifier = $(this.object.sheet.pagesInView[0]).data("pageId");

		if (pageIdentifier) {
			return this.object.pages.get(pageIdentifier);
		}
		return null;
	}

	async sleep(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	activateListeners(html) {
		super.activateListeners(html);

		html.find(".moveToNote").click((ev) => this._moveToNotes());
		html.find(".moveToDescription").click((ev) => this._moveToDescription());

		// Update Title
		const elem = html[0];
		elem.closest(".window-app").querySelector("header > .window-title").textContent = game.i18n.format("GMNote.title", { document: this.object.name ?? `${this.object.documentName}[${this.object.id}]`});
	}

	async _updateObject(event, formData) {
		if (jQuery.isEmptyObject(formData)) {
			return;
		}
		if (game.user.isGM) {
			if (this.object.constructor.name === "JournalEntry") {
				let page = this.getCurrentPage();
				if (!page) {
					ui.notifications.error("No current page found");
					return;
				}
				await page.setFlag("gm-notes", "notes", formData["flags.gm-notes.notes"]);
			} else {
				await this.object.setFlag("gm-notes", "notes", formData["flags.gm-notes.notes"]);
			}
			// this.render();
		} else {
			ui.notifications.error("You have to be GM to edit GM Notes.");
		}
	}
		
	static async _addContentToJournal(app, html, data) {
		// If not GM - don't do anything
		if (!game.user.isGM) return;

		// Check if the object is a JournalEntry
		if (data.document.constructor.name !== "JournalEntryPage") return;

		// Get the current page
		const page = app.object;
		if (!page) return;

		// Check if the page has GM notes
		const gmNotes = page.getFlag("gm-notes", "notes");
		if (!gmNotes) return;

		// Check if GM notes have already been added to prevent duplicates
		const existingNotes = html.find('.gm-notes-content');
		if (existingNotes.length > 0) return;

		// Create a new div for the GM notes
		const gmNotesDiv = document.createElement('div');
		gmNotesDiv.classList.add('gm-notes-content');

		// Enrich the HTML content
		const enrichedContent = await TextEditor.enrichHTML(gmNotes, {async: true});
		gmNotesDiv.innerHTML = `<hr><h1>GM Notes</h1>${enrichedContent}`;

		// Append the GM notes to the journal content
		const journalContent = html[2];
		journalContent.append(gmNotesDiv);
	}

	static _attachHeaderButton(app, buttons) {
		// Ignore JournalTextPageSheets
		// if (app instanceof JournalTextPageSheet) return; // can use pages now

		// If user is not GM - don't do anything
		if (!game.user.isGM) return;
		
		const activateGMNote = (ev) =>
		{				
				if (app.constructor.name === "EnhancedJournal") {
					new GMNote(app.document.pages.get(app.subsheet.pagesInView[0]?.dataset?.pageId), { submitOnClose: true, closeOnSubmit: false, submitOnUnfocus: true }).render(true);
				} else if (app.document.constructor.name === "JournalEntry") {
					const page = app.document.pages.get(app.document._sheet.pagesInView[0]?.dataset?.pageId);
					new GMNote(page, { submitOnClose: true, closeOnSubmit: false, submitOnUnfocus: true }).render(true);
				} else {
					new GMNote(app.document, { submitOnClose: true, closeOnSubmit: false, submitOnUnfocus: true }).render(true);
				}
		};		
		
		const gmNoteButton = {
			// If hide label is true, don't show label
			label: game.i18n.localize("GMNote.label"),
			tooltip: game.i18n.localize("GMNote.label"),
			class: "open-gm-note",
			get icon() {
				// Get GM Notes
				let notes = "";
				if (app.constructor.name === "EnhancedJournal") {
					// Long delay to ensure the page is fully loaded
					setTimeout(() => {
						let notesID = app.subsheet.pagesInView[0]?.dataset?.pageId;
						notes = app.object.pages.get(notesID).getFlag("gm-notes", "notes");
					}, 800);
				} else {
					notes = app.document.getFlag("gm-notes", "notes");
				}
				return `fas ${notes ? "fa-clipboard-check" : "fas fa-clipboard"}`;
			},
			onClick: (ev) => activateGMNote(ev),
			onclick: (ev) => activateGMNote(ev)
		}
		
		if (app.constructor.name === "EnhancedJournal") {
			// Long delay to ensure the page is fully loaded, and different method to attach button
			setTimeout(() => {
				let fullscreenButton = app.element.find(".header-button.control.toggle-fullscreen");
				const buttonHtml = `<a class="${gmNoteButton.class}" title="${gmNoteButton.tooltip}"><i class="${gmNoteButton.icon}"></i></a>`;
				$(buttonHtml).insertBefore(fullscreenButton).click(gmNoteButton.onclick);
			}, 800);
		} else {
			// If app has document
			if (!(app.document instanceof foundry.abstract.Document)) return;
			buttons.unshift(gmNoteButton);
		}
	}

	static _updateHeaderButton(app, [elem], options) {
		// Ignore non-document apps
		if (!((app.document instanceof foundry.abstract.Document) || (app.constructor.name === "EnhancedJournal"))) return;


		// Make sure elem is parent
		elem = elem.closest(".window-app");

		// Check if user is GM
		if (!game.user.isGM) return;
		
		let delay = 150;
		if (app.constructor.name === "EnhancedJournal") {
			// Very long delay to ensure the page is fully loaded and we can get the notes (tested on a journal with over 1000 pages)
			delay = 5000;
		}
		
		// Introduce a delay to ensure the page is fully updated
		setTimeout(() => {
			// Check if elem has header button
			let gmNotesButton = elem?.querySelector(".open-gm-note");
        
			// For Enhanced Journal, we might need to re-add the button
			if (!gmNotesButton && app.constructor.name === "EnhancedJournal") {
				let fullscreenButton = $(elem).find(".header-button.control.toggle-fullscreen");
				const buttonHtml = `<a class="open-gm-note" title="${game.i18n.localize("GMNote.label")}"><i class="fas fa-clipboard"></i></a>`;
				gmNotesButton = $(buttonHtml).insertBefore(fullscreenButton).click(() => {
					const page = app.object.pages.get(app.subsheet.pagesInView[0]?.dataset?.pageId);
					new GMNote(page, { submitOnClose: true, closeOnSubmit: false, submitOnUnfocus: true }).render(true);
				})[0];
			}
	
			if (!gmNotesButton) return;

			let notes = "";
			// Get GM Notes
			if (app.constructor.name === "EnhancedJournal") {
				let notesID = app.subsheet.pagesInView[0]?.dataset?.pageId;
				notes = app.object.pages.get(notesID).getFlag("gm-notes", "notes");
			} else if (app.document.constructor.name === "JournalEntry") {
				const currentPageId = app.object._sheet.pagesInView[0]?.dataset?.pageId;
				const page = app.object.pages.get(currentPageId);
				notes = page ? page.getFlag("gm-notes", "notes") : "";
			} else {
				notes = app.document.getFlag("gm-notes", "notes");
			}

			// Set color to green if notes exist
			gmNotesButton.style.color = game.settings.get("gm-notes", "colorLabel") && notes ? "var(--palette-success, green)" : "";
			// Change icon to Check
			gmNotesButton.innerHTML = `<i class="fas ${notes ? "fa-clipboard-check" : "fas fa-clipboard"}"></i> ${
				GMNote.shouldHideLabel ? "" : game.i18n.localize("GMNote.label")
			}`;
		}, delay);
	}

	static _updateHeaderButtonV2(app, elem) {
		let gmNotesButton = elem?.querySelector(".open-gm-note");
		let notes = "";
		// Get GM Notes
		if (app.constructor.name === "EnhancedJournal") {
			let notesID = app.subsheet.pagesInView[0]?.dataset?.pageId;
			notes = app.object.pages.get(notesID).getFlag("gm-notes", "notes");
		} else if (app.document.constructor.name === "JournalEntry") {
			const currentPageId = app.object._sheet.pagesInView[0]?.dataset?.pageId;
			const page = app.object.pages.get(currentPageId);
			notes = page ? page.getFlag("gm-notes", "notes") : "";
		} else {
			notes = app.document.getFlag("gm-notes", "notes");
		}

		gmNotesButton.style.color = game.settings.get("gm-notes", "colorLabel") && notes ? "var(--palette-success, green)" : "";
		// Change icon to Check
		gmNotesButton.className = `open-gm-note fas ${notes ? "fa-clipboard-check" : "fa-clipboard"}`;
	}

	async _moveToNotes() {
		if (game.dnd5e && this.object.constructor.name !== "JournalEntryPage") {
			let descPath = "";
			switch (this.object.constructor.name) {
				case "Actor5e":
					descPath = "system.details.biography.value";
					break;
				case "Item5e":
					descPath = "system.description.value";
					break;
			}
			let description = foundry.utils.getProperty(this.object, descPath);
			let notes = foundry.utils.getProperty(this.object, "flags.gm-notes.notes");

			if (notes === undefined) notes = "";
			if (description === undefined) description = "";

			let obj = {};
			obj[descPath] = "";
			await this.object.setFlag("gm-notes", "notes", notes + description);
			await this.object.update(obj);
			// No longeer required - the update will re-render
			// this.render();
		} else if (this.object.constructor.name === "JournalEntryPage") {
			const selection = window.getSelection();
			if (selection.rangeCount === 0 || selection.toString().trim() === "") {
				ui.notifications.warn(game.i18n.localize("GMNote.noSelection"));
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
			div.querySelectorAll("[data-anchor]").forEach(el => {
				el.removeAttribute("data-anchor");
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
				ui.notifications.warn(game.i18n.localize("GMNote.copiedToNotes"));
			}

			let page = this.object;
			let description = foundry.utils.getProperty(page, "text.content") ?? "";
			let notes = page.getFlag("gm-notes", "notes") ?? "";
			
			// Update the GM notes with the selected HTML
			await page.setFlag("gm-notes", "notes", notes + selectedHTML);
			
			// If the selected text is from the current page, delete the selected text from the document
			if (selectedObjectId === pageId) {
				// Delete the selected text from the document
				range.deleteContents();
				let obj = {};
				if (description.includes(selectedHTML)) {
					obj["text.content"] = description.replace(selectedHTML, "");
					// Update the page content
					await page.update(obj);
				} else {
					ui.notifications.warn(game.i18n.localize("GMNote.formattingIssuesDescription"));
				}
			}
		}
	}

	async _moveToDescription() {
		if (game.dnd5e && this.object.constructor.name !== "JournalEntryPage") {
			let descPath = "";
			switch (this.object.constructor.name) {
				case "Actor5e":
					descPath = "system.details.biography.value";
					break;
				case "Item5e":
					descPath = "system.description.value";
					break;
			}
			let description = foundry.utils.getProperty(this.object, descPath);
			let notes = this.object.getFlag("gm-notes", "notes");

			if (notes === undefined) notes = "";
			if (description === undefined) description = "";

			let obj = {};
			obj[descPath] = description + notes;
			await this.object.setFlag("gm-notes", "notes", "");
			await this.object.update(obj); // this will re-render
		} else if (this.object.constructor.name === "JournalEntryPage") {
			const selection = window.getSelection();
			if (selection.rangeCount === 0 || selection.toString().trim() === "") {
				ui.notifications.warn(game.i18n.localize("GMNote.noSelection"));
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
				ui.notifications.warn(game.i18n.localize("GMNote.notFromNotes"));
				return;
			}

			// Delete the selected text from the GM notes
			range.deleteContents();
			
			let page = this.object;
			let description = foundry.utils.getProperty(page, "text.content") ?? "";
			let notes = page.getFlag("gm-notes", "notes") ?? "";

			// Update the description with the selected HTML
			let obj = {};
			obj["text.content"] = description + selectedHTML;

			// Update the GM notes by removing the selected HTML
			if (notes.includes(selectedHTML)) {
				await page.setFlag("gm-notes", "notes", notes.replace(selectedHTML, ""));
			} else {
				ui.notifications.warn(game.i18n.localize("GMNote.formattingIssuesNotes"));
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
        const gmNotes = journal.getFlag("gm-notes", "notes");
        if (!gmNotes) continue;

        // Get the first page of the journal entry
        const firstPage = journal.pages.contents[0];
        if (!firstPage) continue;

        // Check if the first page already has GM notes
        const pageNotes = firstPage.getFlag("gm-notes", "notes") || "";

        // Append the journal's GM notes to the first page's GM notes
        await firstPage.setFlag("gm-notes", "notes", pageNotes + gmNotes);

        // Clear the GM notes from the journal entry
        await journal.unsetFlag("gm-notes", "notes");
    }

    ui.notifications.info(game.i18n.localize("GMNote.migrationCompleted"));
}

Hooks.once('init', () => {
    game.settings.register("gm-notes", 'hideLabel', {
        name: game.i18n.localize('GMNote.setting'),
        hint: game.i18n.localize('GMNote.settingHint'),
        scope: "world",
        config: game.system.id != "dnd5e",
        default: game.system.id == "dnd5e",
        type: Boolean
    });
    game.settings.register("gm-notes", 'colorLabel', {
        name: game.i18n.localize('GMNote.colorSetting'),
        scope: "world",
        config: true,
        default: false,
        type: Boolean
    });
    game.settings.register("gm-notes", 'devMessageVersionNumber', {
        name: 'Development message version',
        scope: 'world',
        config: false,
        type: String,
        default: '0',
    });

    // Register a dummy setting to inject the button
    game.settings.register("gm-notes", 'migrateNotes', {
        name: game.i18n.localize("GMNote.migrateButton"),
        hint: game.i18n.localize("GMNote.migrateButtonHint"),
        scope: "world",
        config: true,
        type: Boolean,
        default: false
    });

    // Expose API
    globalThis.gmnote = {GMNote: GMNote };    

    // Register keybinding
    const hotkey = {
        name: 'GMNote.hotKeyName',
        hint: 'GMNote.hotKeyHint',
        restricted: true,
        onDown: () => { GMNote.showGMNoteWindow(); },
        onUp: () => {}
    };

    game.keybindings.register("gm-notes",'showGMNote',hotkey);
});

// Inject the button to migrate GM notes to the first page of each journal
Hooks.on('renderSettingsConfig', (app, html, data) => {
    const button = $(`<button type="button">${game.i18n.localize("GMNote.migrateButton")}</button>`);
    button.on('click', async () => {
        await migrateJournalNotes();
    });

    // Find the setting and replace its content with the button
    const setting = $(html).find('div.form-group:has([name="gm-notes.migrateNotes"])');
    setting.find('input').remove(); // Remove the checkbox
    setting.find('label').after(button); // Add the button after the label
});

Hooks.once('ready', async function() {
    if (game.user.isGM) {
        sendDevMessage();
    }
    console.info(`gm-notes | Module[gm-notes] ready hook complete`);
});

// Define Hooks to Montior
const watchedHooks = ['ActorSheet', 'ItemSheet', 'Application']
// Loop through hooks and attach header button and listener
watchedHooks.forEach(hook => {
    Hooks.on(`get${hook}HeaderButtons`, GMNote._attachHeaderButton);
    Hooks.on(`render${hook}`, GMNote._updateHeaderButton);
});

// Register the GM Note sheet for Tidy5e Sheet
Hooks.once('tidy5e-sheet.ready', (api) => {
	api.registerItemHeaderControls?.({
		controls: [
			{
				icon: 'fas fa-clipboard',
				label: game.i18n.localize("GMNote.label"),
				async onClickAction() {
					new GMNote(this.document, { submitOnClose: true, closeOnSubmit: false, submitOnUnfocus: true }).render(true);
				}
			}]
	})
});


const watchedHooksV2 = ['ActorSheetV2','ItemSheetV2','AmbientLightConfig','DrawingConfig','WallConfig','TileConfig','JournalEntrySheet','RollTableSheet'];
//getHeaderControlsAmbientLightConfig
watchedHooksV2.forEach(hook => {
	Hooks.on(`getHeaderControls${hook}`, GMNote._attachHeaderButton);
	// Do not believe this works on ItemSheetV2 - it for sure do not work on all TileConfig Hooks.on(`render${hook}`, GMNote._updateHeaderButtonV2);
});

// Add GM notes to journal pages on render
Hooks.on('renderJournalPageSheet', GMNote._addContentToJournal)
