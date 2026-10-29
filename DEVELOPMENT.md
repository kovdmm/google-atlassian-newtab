# Jumpstart – development notes

A Chrome MV3 extension that replaces the new tab page. No build step: plain HTML, CSS and JavaScript, loaded unpacked from this folder (chrome://extensions → Load unpacked; after a change press Reload there).

## Files

- `manifest.json`, `background.js` – the extension itself; the service worker only opens a new tab after the first install.
- `newtab.html` – the page markup, all dialogs included.
- `_locales/` – the extension name and description for the Chrome Web Store and chrome://extensions.
- `tools/make_icons.py` – generates `icons/`.
- `docs/board-states.md` – board card kinds and what each button does to them (Mermaid source); `docs/board-states.svg` is the same picture rendered. Update both when card behavior changes.

Styles, in cascade order (later files win on equal specificity):

- `css/newtab.css` – theme tokens, header, logo, search box and dropdown, shortcuts, dialogs, settings.
- `css/board.css` – the board.
- `css/compact.css` – compact view; it overrides the two above, so it stays last.

Scripts are plain scripts that share one global scope. `newtab.html` loads them in this order, and a script may use at load time only what the scripts before it define:

- `js/theme.js` – in `<head>`, before the first paint: the background and the layout classes from `localStorage`, so the page doesn't flash.
- `js/i18n.js` – texts in en / ru / de, `t()`, `applyI18n()`.
- `js/core.js` – `DEFAULT_SETTINGS` and `settings`, DOM and storage helpers, link and task-key parsing, status badges.
- `js/atlassian.js` – every request to Jira, Confluence, Bitbucket and the GraphQL gateway: the hourly limit, the pause after 429, caches.
- `js/shortcuts.js` – the tiles and their part of the settings dialog.
- `js/search.js` – the search box and its dropdown.
- `js/settings.js` – `applySettings()` and the settings dialog.
- `js/board.js` – the board model, card constructors, rendering, menus, deadlines; the header comment lists the other `board-*.js` files.
- `js/main.js` – startup; loaded last.

## Conventions

- One source of truth for a setting: add it to `DEFAULT_SETTINGS` in `core.js` with a comment. A plain on/off setting also needs one line in `CHECKBOXES` in `settings.js` and the checkbox in `newtab.html`.
- Texts go to `js/i18n.js` in all three languages; markup uses `data-i18n` and code uses `t(key, ...args)`.
- Every Atlassian request goes through `apiFetch()`, which returns `null` when nothing was sent (limit or pause). Results that came from `null` are not cached.
- Board cards are created only with `jiraCard()`, `prCard()` or `noteCard()`. Every kind of card can link Jira tasks and pages; both go to one list, `links`, in the order they were linked (the data model is in the header of `board.js`). Every card can have its own text (`text`): a note's text or a Jira or PR card's description. A card never changes its kind after it is created – editing changes only the text. After adding a card, call `update()` and then `refreshFor(card)`. A card with nothing left – no task or PR of its own, no text, no links – is removed (`isEmptyCard()`). Data saved by earlier versions is brought to this model by `migrateBoard()`, on load and on import.
- A user-visible error offers the one button that helps: `accessNotice()` gives the text and the button, `fixAccess()` handles the click.
- HTML is built with template strings. Every value from data or the network goes through `esc()`.
- Code comments are in English; there is no linter, so match the surrounding style.

## Testing

There are no automated tests in this folder. Changes were checked in headless Chrome with playwright-core. The test opens `newtab.html` as a file and stubs `chrome.*` and `fetch` with `addInitScript`, so no real Atlassian site or signed-in profile is involved.
