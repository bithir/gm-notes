import { sendDevMessage } from './devmessage.js';
class GMNote extends FormApplication {

    static alwaysHideLabelForSystem = [ 'dnd5e'];

    static get shouldHideLabel() {
        return  game.settings.get('gm-notes', 'hideLabel') || 
            GMNote.alwaysHideLabelForSystem.includes(game.system.id);
    }
    constructor(object, options) {
        super(object, options);
        this.object.apps[this.appId] = this;
    }

    get showExtraButtons() {
        return (game.dnd5e && this.object.constructor.name !== 'RollTable' || this.object.constructor.name === "JournalEntry");
    }

    static get defaultOptions() {
        const options = super.defaultOptions;
        options.template = "modules/gm-notes/templates.html";
        options.width = '600';
        options.height = '700';
        options.classes = ['gm-notes', 'sheet'];
        options.title = game.i18n.localize('GMNote.label');
        options.resizable = true;
        options.editable = true;
        return options;
    }

    async getData() {
        const data = super.getData();

    
        let page = null;
        if(this.object.constructor.name === 'JournalEntry') 
        {
            // Current page is on another event loop - wait for 50 millis solves it in majority of circumstances
            await this.sleep(100);
            page = this.getCurrentPage();
        }


        data.journalNotes = await TextEditor.enrichHTML(this.object.getFlag('gm-notes', 'notes'), { async:true});
        data.flags = this.object.flags;
        data.owner = game.user.id;
        data.isGM = game.user.isGM;
        data.showExtraButtons = this.showExtraButtons && page != null;

        return data;
    }

    getCurrentPage()
    {
        if(this.object.constructor.name !== 'JournalEntry') { 
            return null;
        }
        // Find current page
        let pageIdentifier = $(this.object.sheet.pagesInView[0]).data("pageId");

        if(pageIdentifier) {
            return this.object.pages.get(pageIdentifier);
        }
        return null;
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    activateListeners(html) {
        super.activateListeners(html);

        html.find('.moveToNote').click(ev => this._moveToNotes());
        html.find('.moveToDescription').click(ev => this._moveToDescription());

        // Update Title
        const elem = html[0];
        elem.closest('.window-app').querySelector('header > .window-title').textContent = game.i18n.format('GMNote.title', { document: this.object.name });
    }
    
    async _updateObject(event, formData) {
        if (jQuery.isEmptyObject(formData) ) {
            return;
        }
        if (game.user.isGM) {
            await this.object.setFlag('gm-notes', 'notes', formData["flags.gm-notes.notes"]);
            // this.render();
        } else {
            ui.notifications.error("You have to be GM to edit GM Notes.");
        }
    }

    static _attachHeaderButton(app, buttons) {
        // Ignore JournalTextPageSheets
        if(app instanceof JournalTextPageSheet) return;

        // If user is not GM - don't do anything
        if (!game.user.isGM) return;

        // If app has document
        if (!(app.document instanceof foundry.abstract.Document)) return;
        
        buttons.unshift({
            // If hide label is true, don't show label
            label: game.i18n.localize('GMNote.label'),
            tooltip: game.i18n.localize('GMNote.label'),
            class: 'open-gm-note',
            get icon() {
                // Get GM Notes
                const notes = app.document.getFlag('gm-notes', 'notes');
                return `fas ${notes ? 'fa-clipboard-check' : 'fas fa-clipboard'}`
            },
            onclick: ev => {
                new GMNote(app.document, { submitOnClose: true, closeOnSubmit: false, submitOnUnfocus: true }).render(true)
            }
        });
    }

    static _updateHeaderButton(app, [elem], options) {
        // Ignore JournalTextPageSheets
        if(app instanceof JournalTextPageSheet || !(app.document instanceof foundry.abstract.Document)) return;

        // Make sure elem is parent
        elem = elem.closest('.window-app');



        // Check if user is GM
        if (!game.user.isGM) return;

        // Check if elem has header button
        if (!elem?.querySelector('.open-gm-note')) return;

        // Get GM Notes Button
        const gmNotesButton = elem.querySelector('.open-gm-note');

        // Get GM Notes
        const notes = app.document.getFlag('gm-notes', 'notes');

        // Set color to green if notes exist
        gmNotesButton.style.color = game.settings.get('gm-notes', 'colorLabel') && notes ? 'var(--palette-success, green)' : '';
        // Change icon to Check
        gmNotesButton.innerHTML = `<i class="fas ${notes ? 'fa-clipboard-check' : 'fas fa-clipboard'}"></i> ${GMNote.shouldHideLabel ? '' : game.i18n.localize('GMNote.label')}`;
    }
    
    async _moveToNotes() {
        if (game.dnd5e && this.object.constructor.name !== 'JournalEntry') {
            let descPath = '';
            switch (this.object.constructor.name) {
                case 'Actor5e': descPath = 'system.details.biography.value'; break;
                case 'Item5e': descPath = 'system.description.value'; break;
            }
            let description = getProperty(this.object, descPath);
            let notes = getProperty(this.object, 'flags.gm-notes.notes');

            if (notes === undefined) notes = '';
            if (description === undefined) description = '';

            let obj = {};
            obj[descPath] = '';            
            await this.object.setFlag('gm-notes', 'notes' ,notes + description);
            await this.object.update(obj);
            // No longeer required - the update will re-render
            // this.render();
        } else if(this.object.constructor.name === 'JournalEntry') {

            let page = this.getCurrentPage();
            if(!page) { 
                // I no current page - don't do things
                return;
            }
            
            let notes = this.object.getFlag('gm-notes', 'notes') ?? '';
            let description = getProperty(page, 'text.content') ?? '';
            // Here can just move text
            let obj = {};
            obj["text.content"] = '';
            await this.object.setFlag('gm-notes', 'notes' ,notes + description);
            await page.update(obj);
        }
    }

    async _moveToDescription() {
        if (game.dnd5e && this.object.constructor.name !== 'JournalEntry') {
            let descPath = '';
            switch (this.object.constructor.name) {
                case 'Actor5e': descPath = 'system.details.biography.value'; break;
                case 'Item5e': descPath = 'system.description.value'; break;
            }
            let description = getProperty(this.object, descPath);
            let notes = this.object.getFlag('gm-notes','notes');

            if (notes === undefined) notes = '';
            if (description === undefined) description = '';

            let obj = {};
            obj[descPath] = description + notes;
            await this.object.setFlag('gm-notes','notes','');       
            await this.object.update(obj);  // this will re-render
        } else if(this.object.constructor.name === 'JournalEntry') {
            let page = this.getCurrentPage();
            if(!page) {
                return;
            }
            let notes = getProperty(this.object, 'flags.gm-notes.notes') ?? '';
            let description = getProperty(page, 'text.content') ?? '';

            let obj = {};            
            obj["text.content"] = description + notes;            
            await this.object.setFlag('gm-notes','notes','');
            await page.update(obj);
        }
    }
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