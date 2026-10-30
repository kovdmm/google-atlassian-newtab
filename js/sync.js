// =====================================================================================
// Several open tabs: each keeps the board, the settings and the shortcuts in memory and saves them whole.
// - Sync: a change saved in another tab is picked up at once (chrome.storage.onChanged) and drawn again –
//   not while something is being edited here (a card text, a dialog, a drag): then right after it.
// - Merge: a save compares three versions – the last one this tab read or wrote (base), its own (mine) and
//   the one in the storage now (theirs) – and keeps what each side changed, so a tab never undoes another one's work
// =====================================================================================

const json = v => JSON.stringify(v ?? null);
const same = (a, b) => json(a) === json(b);
const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)));

// ---- Board: a three-way merge by columns and cards ----

let boardBase = null;     // the board as last read from or written to the storage
let boardWritten = "";    // JSON of this tab's last write: its own change event is not a change from another tab
let boardSaving = Promise.resolve();

// Where each card sits: its column and the card before it, counting only cards both versions have
// (a card added or removed next to it doesn't count as moving it); above – every card before it, nearest first
function cardPlaces(board, other) {
  const keep = new Set(other.columns.flatMap(c => c.cards.map(cardId)));
  const places = new Map();
  board.columns.forEach(col => {
    let prev = null;
    col.cards.forEach((card, i) => {
      const id = cardId(card);
      places.set(id, { col: col.id, prev, card, above: col.cards.slice(0, i).map(cardId).reverse() });
      if (keep.has(id)) prev = id;
    });
  });
  return places;
}

function mergeBoards(base, mine, theirs) {
  const baseCols = new Map(base.columns.map(c => [c.id, c]));
  const mineCols = new Map(mine.columns.map(c => [c.id, c]));

  // columns: theirs, without the ones I removed, with the name and type I changed
  const columns = theirs.columns
    .filter(c => !(baseCols.has(c.id) && !mineCols.has(c.id)))
    .map(c => {
      const b = baseCols.get(c.id), m = mineCols.get(c.id);
      const pick = field => (b && m && m[field] !== b[field] ? m[field] : c[field]);
      return { ...c, name: pick("name"), type: pick("type"), cards: [...c.cards] };
    });
  const colOf = id => columns.find(c => c.id === id);
  // the columns I added, after the column before them (a column they removed comes back only for a card I put there)
  mine.columns.forEach((c, i) => {
    if (colOf(c.id) || baseCols.has(c.id)) return;
    const at = i ? columns.indexOf(colOf(mine.columns[i - 1].id)) + 1 : 0;
    columns.splice(at, 0, { ...c, cards: [] });
  });
  // the order of columns, if I changed it
  const order = cols => cols.map(c => c.id).filter(id => baseCols.has(id) && mineCols.has(id));
  if (!same(order(mine.columns), order(base.columns))) {
    const rank = id => (mineCols.has(id) ? mine.columns.findIndex(c => c.id === id) : Infinity);
    columns.sort((a, b) => rank(a.id) - rank(b.id));
  }

  // cards: theirs, without the ones I removed; the ones I changed are taken from me, the ones I added or moved go
  // where I put them – after the same card as in my column
  const basePlaces = cardPlaces(base, mine), minePlaces = cardPlaces(mine, base);
  const removed = new Set([...basePlaces.keys()].filter(id => !minePlaces.has(id)));
  const placed = [];
  minePlaces.forEach((m, id) => {
    const b = basePlaces.get(id);
    if (b && b.col === m.col && b.prev === m.prev) {
      if (same(b.card, m.card)) return;
      // only the content changed: in place, wherever they have it now
      const col = columns.find(c => c.cards.some(card => cardId(card) === id));
      if (col) col.cards = col.cards.map(card => (cardId(card) === id ? m.card : card));
      else placed.push(id); // they removed it, I changed it: mine stays
    } else {
      placed.push(id);
    }
  });
  const moving = new Set(placed);
  columns.forEach(col => { col.cards = col.cards.filter(card => !removed.has(cardId(card)) && !moving.has(cardId(card))); });
  placed.forEach(id => {
    const { col: colId, card, above } = minePlaces.get(id);
    let col = colOf(colId);
    if (!col) columns.push(col = { ...mineCols.get(colId), cards: [] });
    const ids = col.cards.map(cardId);
    const prev = above.find(x => ids.includes(x));
    col.cards.splice(prev ? ids.indexOf(prev) + 1 : 0, 0, card);
  });

  const expanded = mine.expanded !== base.expanded ? mine.expanded : theirs.expanded;
  return { ...theirs, expanded, columns };
}

// replace: the board is taken as it is (an import), not merged with what another tab saved
function saveBoard({ replace = false } = {}) {
  boardSaving = boardSaving.then(async () => {
    const theirs = await store.get("board", null);
    if (!replace && theirs && boardBase && !same(theirs, boardBase) && !same(theirs, board)) {
      board = mergeBoards(boardBase, board, theirs);
      renderBoard();
    }
    boardBase = clone(board);
    boardWritten = json(board);
    await store.set("board", board);
  }).catch(e => console.warn("Jumpstart: saving the board", e));
  return boardSaving;
}

// Something is being done on the board right now: a text, a name, a dialog or a menu still holds its cards
function boardBusy() {
  const input = $("bCols").querySelector(".composer-input");
  return Boolean(dragCard || dragColumn || $("bCols").querySelector(".card-edit, .col-input") || input?.value.trim() ||
    !menu.hidden || ["docDlg", "dueDlg", "confirmDlg"].some(id => $(id).open));
}

// A change from another tab: taken when this tab is done saving and nothing is being edited here
let boardSyncTimer = 0;
function syncBoard() {
  clearTimeout(boardSyncTimer);
  boardSyncTimer = setTimeout(async () => {
    if (!board) return;
    if (boardBusy()) return syncBoard();
    await boardSaving;
    const theirs = await store.get("board", null);
    if (!theirs || same(theirs, board)) return;
    board = theirs;
    boardBase = clone(theirs);
    renderBoard();
    refreshCardStatuses();
  }, 300);
}

// ---- Settings: merged key by key ----

let settingsBase = null;

async function saveSettings() {
  const theirs = { ...DEFAULT_SETTINGS, ...(await store.get("settings", {})) };
  if (settingsBase && !same(theirs, settingsBase)) {
    settings = Object.fromEntries(Object.keys({ ...theirs, ...settings })
      .map(key => [key, same(settings[key], settingsBase[key]) ? theirs[key] : settings[key]]));
  }
  settingsBase = clone(settings);
  await store.set("settings", settings);
}

let settingsSyncTimer = 0;
function syncSettings() {
  clearTimeout(settingsSyncTimer);
  settingsSyncTimer = setTimeout(async () => {
    if ($("setDlg").open) return syncSettings();
    const theirs = { ...DEFAULT_SETTINGS, ...(await store.get("settings", {})) };
    if (same(theirs, settings)) return;
    settings = theirs;
    settingsBase = clone(theirs);
    applySettings();
  }, 300);
}

// ---- Shortcuts and hidden notifications ----

let linksSyncTimer = 0;
function syncLinks(value) {
  clearTimeout(linksSyncTimer);
  linksSyncTimer = setTimeout(() => {
    if (dragFrom !== null || $("addDlg").open) return syncLinks(value);
    if (!Array.isArray(value) || same(value, links)) return;
    links = value.slice(0, MAX_LINKS);
    renderLinks();
  }, 300);
}

function syncInboxHidden(value) {
  if (!Array.isArray(value)) return;
  const known = new Set(inboxHidden);
  if (value.every(id => known.has(id))) return;
  inboxHidden = [...new Set([...inboxHidden, ...value])].slice(0, INBOX_HIDDEN_MAX);
  if (board && inboxOn()) renderInbox();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.board?.newValue && json(changes.board.newValue) !== boardWritten) syncBoard();
  if (changes.settings?.newValue) syncSettings();
  if (changes.links) syncLinks(changes.links.newValue);
  if (changes.inboxHidden) syncInboxHidden(changes.inboxHidden.newValue);
});
