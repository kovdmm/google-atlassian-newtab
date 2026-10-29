// Kanban board: the bottom half of the new tab page, can be expanded to the whole page.
// Columns are customizable and have a fixed width, like Trello. Cards are Jira tasks with a live status
// or plain notes written by hand (requests from a manager or colleagues), or pull requests.
// Cards are dragged between columns; any card can link Jira tasks, Confluence pages and other pages.
// Every action is visible: a ⋮ menu on each column and card, two explicit "add" buttons under each column.
// Turned on in the settings (the "Board" tab), off by default. Uses core.js and the Atlassian API from atlassian.js.
//
// The board is split into files that share one global scope:
//   board.js          – the model, card constructors, rendering, ⋮ menus, columns, full screen, deadlines
//   board-actions.js  – adding notes, editing card text, clicks, drag and drop
//   board-inbox.js    – the Inbox column (Atlassian notifications)
//   board-pickers.js  – the link dialog: "Add link" on a card and "+ Link" under a column
//   board-backup.js   – export / import of the whole board (settings → Board)

// board = { expanded, columns: [{ id, name, type, cards: [card] }] }
// type – what the column means: hold | todo | progress | done (drives how deadlines look)
// card – one of (see the constructors below):
//   Jira task:     { key, summary, text?, links, due }
//   pull request:  { id: "pr:ws/repo/id", pr: "ws/repo/id", url, title, state, text?, links, due }
//   note:          { id: "own-…", text, links, due }
// A card never changes its kind: a Jira card stays that task, a PR card – that pull request, a note – a note.
// text – what the user wrote: a note's text, a description of a Jira or PR card;
// due: "YYYY-MM-DD"; links – what the card links to, in the order it was linked: [{ key } | { title, url, state? }],
// a Jira task or a page (a PR keeps its last known state).
// A card with nothing left – no task or PR of its own, no text, no links – goes (see isEmptyCard)
let board = null;
let composerColumn = null; // column whose "own task" composer is open
let dueCard = null;    // card whose deadline is being set

const COLUMN_TYPES = ["hold", "todo", "progress", "done"];

const BOARD_ICONS = {
  expand: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>',
  collapse: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>',
  more: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>',
  doc: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>',
  close: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',
  edit: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
  open: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>',
  link: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7a5 5 0 0 0 0 10h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4a5 5 0 0 0 0-10z"/></svg>',
  clock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/></svg>',
  check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
  pause: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>',
  calendar: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2z"/></svg>',
  // Jira "task" type icon: a check in a rounded square
  task: '<svg width="16" height="16" viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="3" fill="currentColor"/><path d="M4.6 8.2l2.2 2.2 4.6-4.7" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  // Bitbucket pull request
  pr: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 3a3 3 0 0 0-1 5.83v6.34A3 3 0 1 0 7 15.17V8.83A3 3 0 0 0 6 3zm0 2a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm0 12a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm12-1.83V9a4 4 0 0 0-4-4h-1.17l1.58-1.59L13 2 9 6l4 4 1.41-1.41L12.83 7H14a2 2 0 0 1 2 2v6.17A3 3 0 1 0 18 15.17zM17 18a1 1 0 1 1 2 0 1 1 0 0 1-2 0z"/></svg>',
  inbox: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 12h-4a3 3 0 0 1-6 0H5V5h14v10z"/></svg>',
  refresh: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>',
  blank: '<svg width="16" height="16" viewBox="0 0 24 24"></svg>',
  addNote: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M14 10H3v2h11v-2zm0-4H3v2h11V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM3 16h7v-2H3v2z"/></svg>',
  trash: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
};

const newId = () => Math.random().toString(36).slice(2, 10);

function defaultBoard() {
  return {
    expanded: false,
    columns: [["boardColTodo", "todo"], ["boardColProgress", "progress"], ["boardColDone", "done"]]
      .map(([name, type]) => ({ id: newId(), name: t(name), type, cards: [] })),
  };
}

// Boards saved before column types existed: guess the type by the default column names in any language
function guessColumnType(name) {
  const n = name.trim().toLowerCase();
  const names = key => Object.values(I18N).map(l => l[key].toLowerCase());
  if (names("boardColProgress").includes(n)) return "progress";
  if (names("boardColDone").includes(n)) return "done";
  return "todo";
}

const saveBoard = () => store.set("board", board);
// locked columns (settings → Board): no "+ Add column", no column menu, no renaming or reordering – cards still move
const columnsLocked = () => Boolean(settings.boardLock);
const columnOf = id => board.columns.find(c => c.id === id);
const cardId = card => card.key || card.id;
const prCardId = ref => "pr:" + ref;
const prCardsOnBoard = () => new Set(board.columns.flatMap(c => c.cards.map(card => card.pr).filter(Boolean)));
const findCard = (col, id) => col.cards.find(card => cardId(card) === id);
// Jira keys that are cards on the board (notes have none)
const cardsOnBoard = () => new Set(board.columns.flatMap(c => c.cards.map(card => card.key).filter(Boolean)));
// Jira keys a card links to
const linkedKeys = card => (card.links || []).filter(l => l.key).map(l => l.key);
// every Jira key shown on the board: cards and linked tasks – for live statuses
const keysOnBoard = () => new Set(board.columns.flatMap(c => c.cards.flatMap(card => [card.key, ...linkedKeys(card)].filter(Boolean))));

// Every change of the board: save it and draw it again
function update() {
  saveBoard();
  renderBoard();
}

// short name of a card for dialog titles: the task, "repo #7", the note text or, without text, its first link
function cardName(card) {
  const name = card.key || (card.pr && card.pr.replace(/^[^/]+\/([^/]+)\/(\d+)$/, "$1 #$2")) || card.text ||
    card.links?.[0]?.key || card.links?.[0]?.title || "";
  return name.length > 30 ? name.slice(0, 30) + "…" : name;
}

// =====================================================================================
// Cards: constructors
// =====================================================================================

// What a card takes from the one it is made of (a migrated note, an imported card): text, links, deadline
const carryOver = (from = {}) =>
  ({ ...(from.text && { text: from.text }), links: [...(from.links || [])], ...(from.due && { due: from.due }) });

// a task card never links itself
function jiraCard(key, from) {
  const card = { key, summary: issueOf(key)?.summary || "", ...carryOver(from) };
  card.links = card.links.filter(l => l.key !== key);
  return card;
}

const noteCard = (text, from) => ({ id: "own-" + newId(), ...carryOver(from), ...(text && { text }) });

// title and state are the last known ones (no blink after a reload), refreshed from Bitbucket;
// from – the card it is made of (see carryOver); a PR card never links itself
function prCard(ref, url, title = "", state = "", from) {
  const card = { id: prCardId(ref), pr: ref, url: url || `${BITBUCKET}/${ref.replace(/\/(\d+)$/, "/pull-requests/$1")}`,
    title, ...(state && { state }), ...carryOver(from) };
  card.links = card.links.filter(l => !l.url || prRefOf(l.url) !== ref);
  return card;
}

const isEmptyCard = card => !card.key && !card.pr && !card.text && !card.links?.length;

// A card just added or converted: load what the board doesn't know about it yet
function refreshFor(card) {
  if (card?.key && !issueOf(card.key)) refreshCardStatuses();
  if (card?.pr) refreshPrCards();
}

// The Jira task can't be listed: the text and the one button that helps – allow access, sign in, or try again.
// err – noperm | auth | limit | http <status> | network | …
function accessNotice(err) {
  const host = new URL(jiraOrigin()).host;
  if (err === "noperm") return { text: t("boardAccessText", host), button: t("boardAllowAccess") };
  if (err === "auth") return { text: t("boardSignInText", host), button: t("boardOpenJira") };
  if (err === "limit") return { text: t("boardLimitText"), button: t("boardRetry") };
  return { text: null, button: t("boardRetry") }; // the caller words the error itself
}

// The click on that button. It has to ask for access right from the click (before any await), as Chrome requires
function fixAccess(err, retry) {
  if (err === "auth") return openUrl(jiraOrigin());
  if (err === "noperm") return chrome.permissions.request(jiraPerm()).then(ok => ok && retry());
  retry();
}

// =====================================================================================
// Show / hide (called from applySettings in settings.js)
// =====================================================================================

async function applyBoard() {
  const on = Boolean(settings.board);
  $("board").hidden = !on;
  if (!on) return;
  board ??= await store.get("board", null) || defaultBoard();
  board.columns.forEach(col => { col.type ??= guessColumnType(col.name); });
  if (migrateBoard()) saveBoard();
  await restoreIssues();
  await restoreInbox();
  renderBoard();
  refreshCardStatuses();
  loadInbox();
}

// Boards saved by earlier versions (also from an imported file) – brought to the current model
const migrateBoard = () => migrateLinks() | migratePrNotes() | migrateNoteText();

// Boards saved when tasks (links: keys) and pages (docs) were two lists: one list, tasks first as they were shown
const mergedLinks = card => [...(card.links || []).map(l => (typeof l === "string" ? { key: l } : l)), ...(card.docs || [])];

function migrateLinks() {
  let changed = false;
  board.columns.forEach(col => col.cards.forEach(card => {
    if (!card.docs && (card.links || []).every(l => typeof l === "object")) return;
    card.links = mergedLinks(card);
    delete card.docs;
    changed = true;
  }));
  return changed;
}

// Notes made from a pull request before PR cards existed: just a title and the PR's link with the same title
// ("#8359: SF-1 …" and "SF-1 …" count as the same) – they become PR cards, keeping their deadline
function migratePrNotes() {
  const plain = s => (s || "").replace(/^#\d+:\s*/, "").trim();
  let changed = false;
  board.columns.forEach(col => {
    col.cards = col.cards.map(card => {
      const doc = card.links?.length === 1 && card.links[0];
      const ref = doc?.url && !card.key && !card.pr && card.title && prRefOf(doc.url);
      if (!ref || plain(card.title) !== plain(doc.title) || prCardsOnBoard().has(ref)) return card;
      changed = true;
      return { ...prCard(ref, doc.url, plain(doc.title)), ...(card.due && { due: card.due }) };
    });
  });
  return changed;
}

// Notes saved when their text was "title" and a Jira card's description was a note linked to that one task:
// the text moves to "text"; a note linked to exactly one task (not a card yet) becomes that Jira card with the text
function migrateNoteText() {
  let changed = false;
  board.columns.forEach(col => {
    col.cards = col.cards.map(card => {
      if (card.key || card.pr || card.title === undefined) return card;
      changed = true;
      const { title, ...rest } = card;
      const note = { ...rest, ...(title.trim() && { text: title }) };
      const keys = linkedKeys(note);
      return keys.length === 1 && !cardsOnBoard().has(keys[0]) ? jiraCard(keys[0], note) : note;
    });
  });
  return changed;
}

// Pull request cards: title and state from Bitbucket (needs access to bitbucket.org), kept on the card
// …and pull requests linked to cards: their last known title and state are kept on the link
async function refreshPrCards() {
  const linked = board.columns.flatMap(c => c.cards.flatMap(card => (card.links || []).filter(l => l.url && prRefOf(l.url))));
  const refs = [...new Set([...prCardsOnBoard(), ...linked.map(d => prRefOf(d.url))])];
  if (!refs.length) return;
  await prLookup(refs);
  let changed = false;
  board.columns.forEach(col => col.cards.filter(card => card.pr).forEach(card => {
    const pr = prOf(card.pr);
    if (pr && (pr.title !== card.title || pr.state !== card.state)) {
      Object.assign(card, { title: pr.title, state: pr.state });
      changed = true;
    }
  }));
  linked.forEach(doc => {
    const pr = prOf(prRefOf(doc.url));
    if (pr && (pr.title !== doc.title || pr.state !== doc.state)) {
      Object.assign(doc, { title: pr.title, state: pr.state });
      changed = true;
    }
  });
  if (changed) update();
}

// Last known summary and status of every task on the board, kept in chrome.storage.local: after a browser
// restart (the session cache is empty then) the board is drawn as it was, and fresh data replaces it quietly.
// Restored entries count as stale (ts 0), so they are still refreshed
const ISSUES_KEY = "boardIssues";

async function restoreIssues() {
  const saved = await store.get(ISSUES_KEY, {});
  Object.entries(saved || {}).forEach(([key, v]) => { if (!jiraCache.get(key)?.v && v) jiraCache.set(key, { ts: 0, v }); });
}

function saveIssues() {
  const snapshot = {};
  keysOnBoard().forEach(key => { const v = issueOf(key); if (v) snapshot[key] = v; });
  store.set(ISSUES_KEY, snapshot);
}

// Live statuses through the shared Jira cache (TTL, hourly limit, pause after 429)
async function refreshCardStatuses() {
  refreshPrCards();
  const keys = [...keysOnBoard()];
  if (!keys.length || !hasJira()) return;
  await jiraLookup(keys);
  let changed = false;
  board.columns.forEach(col => col.cards.filter(card => card.key).forEach(card => {
    const issue = issueOf(card.key);
    if (issue && issue.summary !== card.summary) { card.summary = issue.summary; changed = true; }
  }));
  if (changed) saveBoard();
  saveIssues();
  renderBoard();
}

// =====================================================================================
// Rendering
// =====================================================================================

// Deadline, drawn by the column type and how close the date is:
// done – a green check, hold – a gray pause (no urgency), to do – colored outline, in progress – filled
const DAY = 24 * 60 * 60 * 1000;
const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function dueHtml(due, type) {
  if (!due) return "";
  const date = new Date(due + "T00:00:00"), today = new Date(new Date().toDateString());
  const days = Math.round((date - today) / DAY);
  const label = date.toLocaleDateString(lang, { day: "numeric", month: "short", ...(date.getFullYear() !== today.getFullYear() && { year: "numeric" }) });
  let state = "later", text = label, icon = BOARD_ICONS.clock;
  if (type === "done") { state = "done"; icon = BOARD_ICONS.check; }
  else if (type === "hold") { state = "hold"; icon = BOARD_ICONS.pause; }
  else if (days < 0) { state = "overdue"; text = t("boardDueOverdue", label); }
  else if (days === 0) { state = "today"; text = t("boardDueToday"); }
  else if (days === 1) { state = "soon"; text = t("boardDueTomorrow"); }
  else if (days <= 3) { state = "soon"; }
  const full = date.toLocaleDateString(lang, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  // a button: a click opens the deadline dialog
  return `<button type="button" class="due due-${state} due-in-${type}" title="${esc(full)}">${icon}<span>${esc(text)}</span></button>`;
}

const dueRowHtml = (card, columnType) => (card.due ? `<div class="card-meta">${dueHtml(card.due, columnType)}</div>` : "");

const linkIcon = url => isConfluenceUrl(url) ? BOARD_ICONS.doc : `<img class="fav" draggable="false" src="${esc(faviconUrl(url))}" width="16" height="16" alt="">`;

// Links are not draggable themselves: a drag that starts on one moves the whole card
// A linked pull request reads like a linked task: "repo #7", its state and its title from Bitbucket
function prAttachmentHtml(doc, i, close) {
  const ref = prRefOf(doc.url), [, repo, id] = ref.split("/"), pr = prOf(ref);
  const state = pr?.state || doc.state;
  return `
      <div class="att att-pr">
        <a href="${esc(doc.url)}" target="_blank" rel="noopener" draggable="false" title="${esc(doc.url)}">
          <span class="att-icon">${BOARD_ICONS.pr}</span>
          <span class="att-body">
            <span class="att-head"><span class="card-key">${esc(repo)} #${esc(id)}</span>${prBadge(state, true)}</span>
            <span class="att-title">${esc(pr?.title || doc.title)}</span>
          </span>
        </a>${close(i)}
      </div>`;
}

// Linked Jira tasks and pages (Confluence or any site): one list of rows under the text, separated by a thin line,
// in the order they were linked. Every row is a real link (middle click works natively); × shows up on hover
function attachmentsHtml(card) {
  const close = i => `<button type="button" class="link-del" data-link="${i}" title="${esc(t("remove"))}">${BOARD_ICONS.close}</button>`;
  const rows = (card.links || []).map((link, i) => {
    if (link.key) return taskAttachmentHtml(link.key, i, close);
    if (prRefOf(link.url)) return prAttachmentHtml(link, i, close);
    return `
      <div class="att att-doc">
        <a href="${esc(link.url)}" target="_blank" rel="noopener" draggable="false" title="${esc(link.url)}">
          <span class="att-icon">${linkIcon(link.url)}</span>
          <span class="att-body"><span class="att-title">${esc(link.title)}</span></span>
        </a>${close(i)}
      </div>`;
  }).join("");
  return rows ? `<div class="card-links">${rows}</div>` : "";
}

function taskAttachmentHtml(key, i, close) {
  const issue = issueOf(key);
  const href = hasJira() ? ` href="${esc(urls.task(key))}" target="_blank" rel="noopener"` : "";
  const status = issueBadge(issue, true);
  return `
      <div class="att att-task">
        <a${href} draggable="false" title="${esc([key, issue?.summary].filter(Boolean).join(" · "))}">
          <span class="att-icon">${BOARD_ICONS.task}</span>
          <span class="att-body">
            <span class="att-head"><span class="card-key">${esc(key)}</span>${status}</span>
            ${issue?.summary ? `<span class="att-title">${esc(issue.summary)}</span>` : ""}
          </span>
        </a>${close(i)}
      </div>`;
}

// The user's text on a Jira or PR card, under the summary; "Add description" next to ⋮ while there is none
const textHtml = card => (card.text ? `<div class="card-text">${esc(card.text)}</div>` : "");
const descButtonHtml = card => (card.text ? "" :
  `<button type="button" class="card-desc" title="${esc(t("boardAddDescription"))}" aria-label="${esc(t("boardAddDescription"))}">${BOARD_ICONS.addNote}</button>`);

function cardHtml(card, columnId, columnType) {
  const issue = card.key ? issueOf(card.key) : null;
  const status = issueBadge(issue);
  const menuBtn = `<button type="button" class="menu-btn card-menu" title="${esc(t("boardMenu"))}" aria-label="${esc(t("boardMenu"))}">${BOARD_ICONS.more}</button>`;
  if (card.pr) return prCardHtml(card, columnId, columnType, menuBtn);
  return `
    <div class="card${card.key ? "" : " own"}" draggable="true" data-card="${esc(cardId(card))}" data-col="${columnId}">
      ${card.key
        ? `<div class="card-top"><span class="card-key">${esc(card.key)}</span>${status}` +
          // in the top row, next to ⋮: appears on hover and takes no extra height
          `${descButtonHtml(card)}${menuBtn}</div>
      <div class="card-title">${esc(issue?.summary || card.summary || "")}</div>${textHtml(card)}`
        : `<div class="note">${menuBtn}<div class="card-title card-text">${esc(card.text || "")}</div></div>`}
      ${attachmentsHtml(card)}
      ${dueRowHtml(card, columnType)}
    </div>`;
}

// "repo #7", the state (OPEN / MERGED / DECLINED in Jira status colors) and the title
function prCardHtml(card, columnId, columnType, menuBtn) {
  const [, repo, id] = card.pr.split("/");
  const badge = prBadge(prOf(card.pr)?.state || card.state);
  return `
    <div class="card pr-card" draggable="true" data-card="${esc(cardId(card))}" data-col="${columnId}">
      <div class="card-top"><span class="pr-icon">${BOARD_ICONS.pr}</span><span class="card-key">${esc(repo)} #${esc(id)}</span>${badge}${descButtonHtml(card)}${menuBtn}</div>
      <div class="card-title">${esc(prOf(card.pr)?.title || card.title || "")}</div>${textHtml(card)}
      ${attachmentsHtml(card)}
      ${dueRowHtml(card, columnType)}
    </div>`;
}

function columnHtml(col) {
  // the hint is always there; CSS shows it only while the column has no visible cards –
  // so it also appears when the last card is being dragged out
  const cards = col.cards.map(card => cardHtml(card, col.id, col.type)).join("") +
    `<div class="col-empty">${esc(t("boardEmptyCol"))}</div>`;
  const composer = composerColumn === col.id ? `
    <div class="composer">
      <textarea class="composer-input" rows="3" maxlength="500" placeholder="${esc(t("boardOwnPlaceholder"))}"></textarea>
      <div class="composer-actions">
        <button type="button" class="btn filled composer-add">${esc(t("boardAdd"))}</button>
        <button type="button" class="btn text composer-cancel">${esc(t("cancel"))}</button>
      </div>
    </div>` : "";
  const addButtons = composerColumn === col.id ? "" : `
    <div class="col-actions">
      <button type="button" class="col-add col-add-own">+ ${esc(t("boardOwnAdd"))}</button>
      <button type="button" class="col-add col-add-link">+ ${esc(t("boardAddLinkCard"))}</button>
    </div>`;
  return `
    <div class="col" data-col="${col.id}">
      <div class="col-head"${columnsLocked() ? "" : ' draggable="true"'}>
        <span class="col-type col-type-${col.type}" title="${esc(t("boardType_" + col.type))}"></span>
        <span class="col-name">${esc(col.name)}</span>
        <span class="col-count">${col.cards.length}</span>
        ${columnsLocked() ? "" : `<button type="button" class="menu-btn col-menu" title="${esc(t("boardMenu"))}" aria-label="${esc(t("boardMenu"))}">${BOARD_ICONS.more}</button>`}
      </div>
      <div class="col-cards" data-col="${col.id}">${cards}</div>
      ${composer}${addButtons}
    </div>`;
}

function renderBoard() {
  if (!board) return;
  closeMenu();
  // compact view already gives the page to the board: no full screen there (and no button for it)
  $("board").classList.toggle("full", Boolean(board.expanded) && !settings.compact);
  $("bExpand").hidden = Boolean(settings.compact);
  $("bExpand").innerHTML = (board.expanded ? BOARD_ICONS.collapse : BOARD_ICONS.expand) +
    `<span>${esc(t(board.expanded ? "boardCollapseShort" : "boardExpandShort"))}</span>`;
  $("bExpand").title = t(board.expanded ? "boardCollapse" : "boardExpand");
  $("bCols").innerHTML = inboxColumnHtml() + board.columns.map(columnHtml).join("") +
    (columnsLocked() ? "" : `<button type="button" class="col-new" id="bAddCol">+ ${esc(t("boardAddColumn"))}</button>`);

  const input = $("bCols").querySelector(".composer-input");
  if (input) input.focus();
}

// =====================================================================================
// ⋮ menus: one floating menu, positioned under its button
// =====================================================================================

const menu = Object.assign(document.createElement("div"), { className: "board-menu", hidden: true });
document.body.append(menu);
let menuItems = [];

function openMenu(button, items) {
  menuItems = items;
  menu.innerHTML = items.map((item, i) => "heading" in item
    ? `<div class="menu-heading">${esc(item.heading)}</div>`
    : `<button type="button" class="menu-item${item.danger ? " danger" : ""}" data-i="${i}">${item.icon}<span>${esc(item.label)}</span></button>`).join("");
  menu.hidden = false;
  const r = button.getBoundingClientRect();
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + "px";
  menu.style.top = (r.bottom + h + 8 > innerHeight ? r.top - h - 4 : r.bottom + 4) + "px";
}

function closeMenu() {
  menu.hidden = true;
}

menu.addEventListener("click", e => {
  const item = e.target.closest(".menu-item");
  if (!item) return;
  closeMenu();
  menuItems[+item.dataset.i].run();
});
document.addEventListener("mousedown", e => {
  if (!menu.hidden && !menu.contains(e.target) && !e.target.closest(".menu-btn")) closeMenu();
});
document.addEventListener("scroll", closeMenu, true);
addEventListener("resize", closeMenu);

function columnMenu(button, col) {
  openMenu(button, [
    { icon: BOARD_ICONS.edit, label: t("boardRename"), run: () => renameColumn(button.closest(".col")) },
    { heading: t("boardColumnType") },
    ...COLUMN_TYPES.map(type => ({
      icon: col.type === type ? BOARD_ICONS.check : BOARD_ICONS.blank,
      label: t("boardType_" + type),
      run: () => { col.type = type; update(); },
    })),
    { heading: "" },
    { icon: BOARD_ICONS.trash, label: t("boardDeleteColumn"), danger: true, run: () => deleteColumn(col) },
  ]);
}

function cardMenu(button, col, card) {
  openMenu(button, [
    ...(card.key && hasJira() ? [{ icon: BOARD_ICONS.open, label: t("boardOpenTask"), run: () => openTask(card.key, false) }] : []),
    ...(card.pr ? [{ icon: BOARD_ICONS.open, label: t("boardOpenPr"), run: () => openUrl(card.url) }] : []),
    { icon: BOARD_ICONS.edit, label: t(!card.key && !card.pr ? "boardEditText" : card.text ? "boardEditDescription" : "boardAddDescription"),
      run: () => editCardText(button.closest(".card")) },
    { heading: "" },
    { icon: BOARD_ICONS.link, label: t("boardAddDoc"), run: () => openDocDialog({ card }) },
    { heading: "" },
    { icon: BOARD_ICONS.calendar, label: t("boardDue"), run: () => openDueDialog(card) },
    { heading: "" },
    { icon: BOARD_ICONS.trash, label: t("boardRemoveCard"), danger: true, run: () => {
      col.cards = col.cards.filter(c => c !== card);
      update();
    } },
  ]);
}

// =====================================================================================
// Columns: add, rename, delete, reorder by dragging the header
// =====================================================================================

function renameColumn(colEl, isNew = false) {
  const col = columnOf(colEl.dataset.col);
  const nameEl = colEl.querySelector(".col-name");
  const input = Object.assign(document.createElement("input"), { className: "col-input", value: col.name, maxLength: 40 });
  nameEl.replaceWith(input);
  colEl.querySelector(".col-head").draggable = false;
  input.focus();
  input.select();
  let done = false;
  const finish = save => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (save && name) col.name = name;
    else if (isNew && !name) board.columns = board.columns.filter(c => c !== col); // an unnamed new column is dropped
    update();
  };
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") { e.stopPropagation(); finish(false); }
  });
  input.addEventListener("blur", () => finish(true));
}

async function deleteColumn(col) {
  const ok = !col.cards.length ||
    await confirmDialog(t("boardDeleteColumnTitle"), t("boardDeleteColumnText", col.name, col.cards.length), t("remove"));
  if (!ok) return;
  board.columns = board.columns.filter(c => c !== col);
  update();
}

// =====================================================================================
// Expand to the whole page and back
// =====================================================================================

function setExpanded(on) {
  board.expanded = on;
  update();
}
$("bExpand").onclick = () => setExpanded(!board.expanded);
document.addEventListener("keydown", e => {
  if (e.key !== "Escape" || !board || $("board").hidden || document.querySelector("dialog[open]")) return;
  if (!menu.hidden) return closeMenu();
  if (board.expanded) setExpanded(false);
});

// =====================================================================================
// Deadline: a date, or one click on Today / Tomorrow / In a week
// =====================================================================================

function openDueDialog(card) {
  dueCard = card;
  $("dueTitle").textContent = t("boardDueTitle", cardName(card));
  $("dueInput").value = card.due || isoDate(new Date()); // no deadline yet – start from today
  $("dueClear").hidden = !card.due;
  $("dueDlg").showModal();
}

function setDue(value) {
  if (value) dueCard.due = value;
  else delete dueCard.due;
  update();
  $("dueDlg").close();
}

$("dueForm").onsubmit = e => {
  e.preventDefault();
  setDue($("dueInput").value);
};
document.querySelectorAll("#dueDlg [data-days]").forEach(btn => {
  btn.onclick = () => {
    const d = new Date();
    d.setDate(d.getDate() + Number(btn.dataset.days));
    setDue(isoDate(d));
  };
});
$("dueClear").onclick = () => setDue("");
$("dueCancel").onclick = () => $("dueDlg").close();
