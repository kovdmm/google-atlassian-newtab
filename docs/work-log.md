# Jumpstart – work log and status

Status as of 2026-10-29. Jumpstart is a Chrome MV3 extension that replaces the new tab page: a Google-style page with search "enhanced with Atlassian", shortcuts and a kanban board for Jira tasks, pull requests and own notes. It was built in one long working session from 2026-10-21 to 2026-10-29.

- Code: `C:\Projects\jumpstart`, git, one branch `main`, remote `https://github.com/kovdmm/google-atlassian-newtab.git`.
- Loaded in Chrome as an unpacked extension from that folder (version 1.5.0 in `manifest.json`).
- How the code is organized and how to run the tests: [DEVELOPMENT.md](../DEVELOPMENT.md).
- Board card behavior: [board-states.md](board-states.md) and its picture [board-states.svg](board-states.svg).

## What the extension does today

### Page and search

- A new tab page that looks like Chrome's own: logo, search box, a row of shortcuts, the user's avatar (Gravatar by the e-mail in the settings) and a ⋮ settings button.
- The Chrome theme and light/dark mode are followed; a custom background color can be picked in the settings.
- Plain Google search is the main action; Google AI Mode is a setting ("Prefer Google AI Mode", off by default because AI Mode shows a notice on every request) and is on Alt+Enter while the setting is off. Key hints name only the keys of the system in use (Alt/Ctrl+Enter, or Option/Cmd+Return on a Mac). Search in Jira is in the dropdown too. The search box doesn't take focus on its own when a tab opens.
- Voice input with a choice of language (Google's own microphone understood English only).
- History Quick Search – on focus, the empty box shows recent pages from browser history: Jira tasks, Confluence pages, Bitbucket, previous Google searches and other sites, each kind switchable in the settings; duplicates are removed and the list scrolls.
- Autocomplete Quick Search – while typing, suggestions come from Jira, Confluence, Bitbucket repositories, pull requests and history, mixed by relevance rather than grouped; each source is switchable.
- A task number ("123", "sf123", "SF-123") opens the task (a bare number needs the project key in the settings; the dropdown says so when it is missing); `jql: …` runs a JQL query in Jira, `cql: …` a CQL query in Confluence.
- Every Atlassian part is optional: nothing about Jira, Confluence or Bitbucket shows up until its address is set.

### Shortcuts

- Up to 8 tiles in one row, draggable, stored in the extension storage, edited in a dialog; Google-style icons and hover.
- First run fills them from Chrome's most visited sites.
- Import (own export, a plain list, or Chrome's Preferences file with the native new tab shortcuts) and export.
- Can be hidden ("Show shortcuts").

### Board

- A kanban board in the bottom half of the page, off by default; can be expanded to the whole page. Columns are customizable, fixed width like Trello, can be renamed, reordered, retyped (to do, in progress, on hold, done) and locked.
- Three kinds of cards, set when a card is created and never changed later:
  - Jira card – the task with its live status and summary;
  - PR card – a Bitbucket pull request with its state and title;
  - note – own text, for requests from a manager or colleagues.
- Every card has its own optional text (a note's text or a card's description, shown on top; double click edits it), a list of links (Jira tasks and pages, in the order they were linked) and an optional deadline. A card with nothing left is removed.
- Adding: "+ Note" (a task key or link, or a PR link, makes its card; a lone page link makes a note with just that link) and "+ Link" (one dialog for my Jira tasks, history, Confluence search and any pasted address; what is already on the board can't be picked twice).
- Cards open like links: a click opens the task or PR in a new tab, a middle click or Ctrl+click in a background tab; a click on a linked page opens only the page.
- Deadlines with Today / Tomorrow / In a week, colored by how close the date is and by the column type.
- Columns: ⋮ → Clear column removes all cards (with a confirmation) and stays available when the columns are locked; Delete column removes the column. A card moved into a "done" column plays a small fireworks from the bottom corners.
- Dragging works the same for cards in columns and in the Inbox: an empty slot of the card's size stays until the pointer is over a column, then it goes away; dropped nowhere, the card is back. The Inbox can't be reordered or dropped into.
- Statuses and titles are cached, so a reload draws the board as it was, without blinking.
- Inbox column: Atlassian notifications (the same as the bell in Jira and Confluence), filtered in the settings. × marks a notification as read; dragging one to a column makes it a card and marks it as read too. The card's text keeps what the notification said and when ("Jane Doe commented on SF-1 – Oct 30, 15:15"), a line per notification; a card already on the board – the task, the PR or a note on the same page – gets the line added instead of a new card.
- Dragging a card shows the card itself under the pointer rather than Chrome's faded copy.
- Board export and import (settings → Board).
- Several open tabs stay in sync: a change in one tab shows up in the others at once (after an edit in progress there is finished), and saves merge – a column, a card's place and a card's content each keep the latest change made to them – instead of one tab overwriting another.

### Settings

- Tabs: General (look, shortcuts), Board (the board switch, columns lock, Inbox filters, board backup; only the switch while the board is off), Atlassian (addresses, Confluence space, Bitbucket workspace and repositories, Quick Search sources, import and export of these settings to share with a team), Data.
- Compact view: a small logo and the search box in the top bar, no shortcuts and no full-screen button, so the board gets the page. It applies before the first paint, so the page doesn't flash the standard layout.
- Settings → Data: all data – settings with every checkbox, shortcuts and the board – exported and imported in one file, to move to another computer or another copy of the extension at once.
- Texts in English, Russian and German, by the Chrome language or picked in the settings.

### Atlassian access and API load

- Requests use the browser's own sign-in; access to the Atlassian site is asked for once, with a button that explains why.
- Every request goes through one place with an hourly limit and a pause after HTTP 429, and results are cached – so the extension never floods Jira with requests.
- Notifications are read through the Atlassian GraphQL gateway. It requires an Origin header the extension can't send by itself, so a declarativeNetRequest session rule rewrites it for those requests only. This was agreed as acceptable because the tool is for own use.

## How it got there

### 2026-10-21 – the new tab page and search

- A home page with the avatar, shortcuts set in a ⋮ dialog, and a box that opens a task by its number, with a history of opened tasks. It soon became an extension with 8 draggable shortcuts kept in the extension storage.
- Browser history instead of own history; Google AI Mode as the default search, with search in Jira second in the list; the page was made to look as close as possible to Chrome's own new tab page.
- Jira statuses in the dropdown; the API load question led to the hourly limit, the 429 pause and caching.
- Shortcuts from the most visited sites on first run, shortcut import, no autofocus, the Chrome theme, the background color setting.
- JQL search with `jql:`, then Confluence and Bitbucket search, pull requests with their state; the label "enhanced with Atlassian"; names specific to one employer removed.
- History Quick Search and Autocomplete Quick Search as sets of checkboxes; longer history without duplicates.
- Settings split so the look comes first and Atlassian has its own tab; anything that isn't configured stays hidden; Atlassian settings import and export; comments in English.
- The question of publishing to the Chrome Web Store was discussed; nothing was published.

### 2026-10-28 – the board

- The kanban board: customizable fixed-width columns, Jira tasks with name and status, drag and drop, links to Confluence pages, full-screen mode.
- Own tasks written by hand, then simplified into plain notes that can link Jira tasks.
- Middle click and Ctrl+click open cards in a background tab; linked pages open on their own.
- Placeholders of a one-line card's height while dragging (no layout shift), deadline dialog starting from today, deadline at the bottom of a card and editable by a click, more air and a cleaner look for cards and linked items, Jira and Confluence links in one dialog.
- A note whose text is a Jira link becomes the Jira card; pull requests became cards with their state.
- Status and summary caching against blinking on reload.
- The Inbox column with filters in the settings; the Origin header rewrite for the GraphQL gateway; × and dragging mark notifications as read.
- A Board tab in the settings with the board backup; lock columns fixed to show no drag cursor.
- "Show shortcuts", space above the board, the compact view, and removing the flash of the standard layout on load.
- A light refactor for easier development: `js/` and `css/` modules instead of two big files, shared helpers instead of copies, `DEVELOPMENT.md`. Behavior was checked to be the same before and after.

### 2026-10-29 – the card model, moving and backup

- Inconsistencies in what erasing a note's text did (sometimes the note stayed, sometimes it was removed or turned into another card). Several rules were tried; a state diagram (`docs/board-states.md`) made the problem visible: one action led to four different outcomes depending on hidden conditions.
- The current state was saved in git, and the card model was reworked: a card never changes its kind, it has its own text, links and deadline, and older boards are migrated on load and on import.
- Links of every card in one list in the order they were added; any card can link tasks and pages.
- "+ Jira Ticket" replaced with "+ Link"; a note that is only a link keeps it as a link.
- The description on top of a Jira or PR card like a note's text, edited with a double click; the card itself is dragged instead of Chrome's faded copy.
- The project moved to `C:\Projects\jumpstart` with its tests; settings → Data for moving all data at once; the data was moved to the new copy, the old folder deleted, and the work branch merged into `main`.

### 2026-10-30 – several tabs

- Dropping an Inbox item into a column left the dragged copy on the page: the item leaves the page on the drop, so its dragend never came. The drop now ends the drag itself.
- Tabs overwrote each other's board, settings and shortcuts. Each tab now picks up changes from the others, and the board and the settings are saved with a three-way merge (`js/sync.js`).
- A notification dropped on the board kept only the page title, so who did what and when was lost – and the same page came up again and again. The card's text now keeps the notification message and time, and later notifications about the same task, PR or page add a line to the card already there.

## Key decisions

- No build step and no dependencies in the extension folder: plain scripts load in a fixed order, and `node_modules` would break loading an unpacked extension. The tests take playwright-core from outside the project.
- Every Atlassian feature is optional and uses the browser's own sign-in: no tokens are stored.
- The API load is limited in one place (`apiFetch()` in `js/atlassian.js`) rather than per feature.
- Cards don't convert between kinds: conversions on text edits made the board unpredictable. A card's kind is chosen when it is created.
- Import never trusts a file: every part is checked the way its own import checks it, and anything unknown is left out.

## Testing

- Browser tests in `tests/` run the page in headless Chrome with `chrome.*` and `fetch` stubbed: smoke (search, settings, shortcuts), the card model and migration, "+ Link", notes that are only a link, descriptions, drag and drop, all-data export and import, two tabs on one storage, Inbox notifications turned into cards. Run one with `node tests/<name>.cjs`.
- The tests print what they found as JSON rather than asserting; a run is read by eye, with `errors` expected to be empty.
- Nothing is tested against a real Atlassian site; that was checked by hand in Chrome.

## Open items

- Dragging on Windows: Chrome's faded drag image was still visible under the card copy; the fix (a 1px, almost transparent drag image) is in, but not yet confirmed on the real machine – Playwright can't show the native drag image. If the double image is still there, card dragging should move from HTML5 drag and drop to pointer events.
- Migration heuristic: a note from before the card rework that was linked to exactly one task became that Jira card with the note text as its description. Notes where one task was linked by hand were converted too.
- Pull requests picked from browser history show the tab title ("Pull Request — repo — Bitbucket") in the dialog until the card loads the real title from Bitbucket.
- Access to Atlassian sites isn't part of the data export: after moving to another copy, Chrome asks for it again.
- The tests are not assertions and there is no CI; inbox and search have only light coverage.
- Not published to the Chrome Web Store.
