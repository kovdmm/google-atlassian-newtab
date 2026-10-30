// =====================================================================================
// Backup: the whole board in one JSON file (settings → Board). Import replaces the board right away,
// after a confirmation – it is not a form field waiting for Save
// =====================================================================================

const isIsoDate = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

// Only what the board understands gets in: a broken or foreign file can't break the page
function normalizeCard(c) {
  if (!c || typeof c !== "object") return null;
  // files exported before tasks and pages were one list keep them apart: links – task keys, docs – pages
  const links = mergedLinks({ links: Array.isArray(c.links) ? c.links : [], docs: Array.isArray(c.docs) ? c.docs : [] })
    .map(l => !l || typeof l !== "object" ? null
      : isTaskKey(l.key) ? { key: l.key }
      : /^https?:\/\//i.test(l.url) ? { title: String(l.title || l.url), url: String(l.url), ...(typeof l.state === "string" && l.state && { state: l.state }) }
      : null)
    .filter(Boolean);
  const due = isIsoDate(c.due) ? { due: c.due } : {};
  const text = typeof c.text === "string" && c.text.trim() ? { text: c.text.slice(0, 500) } : {};
  if (isTaskKey(c.key)) return jiraCard(c.key, { links, ...due, ...text });
  if (typeof c.pr === "string" && /^[^/]+\/[^/]+\/\d+$/.test(c.pr)) {
    const url = /^https:\/\/bitbucket\.org\//.test(c.url) ? c.url : undefined;
    return prCard(c.pr, url, String(c.title || ""), ["OPEN", "MERGED", "DECLINED", "SUPERSEDED"].includes(c.state) ? c.state : "",
      { links, ...due, ...text });
  }
  // a note is its text and its links: with neither it is not a card. Files exported before cards had "text" keep
  // a note's text in "title" – such notes go through the same migration as a saved board (migrateBoard)
  const legacy = typeof c.text !== "string" && typeof c.title === "string";
  const note = { id: String(c.id || "own-" + newId()), ...(legacy ? { title: c.title.slice(0, 500) } : text), links, ...due };
  return note.text || note.title?.trim() || links.length ? note : null;
}

function normalizeBoard(data) {
  const src = data?.board || data;
  if (!src || !Array.isArray(src.columns)) return null;
  const columns = src.columns.filter(c => c && typeof c === "object").map(c => {
    const name = String(c.name || "").slice(0, 40) || t("boardNewColumn");
    return { id: String(c.id || newId()), name, type: COLUMN_TYPES.includes(c.type) ? c.type : guessColumnType(name),
      cards: (Array.isArray(c.cards) ? c.cards : []).map(normalizeCard).filter(Boolean) };
  });
  return columns.length ? { expanded: false, columns } : null;
}

const countCards = b => b.columns.reduce((n, c) => n + c.cards.length, 0);

const boardMsg = (text, cls = "") => showMsg("sBoardMsg", text, cls);

// the board may be switched off and never loaded on this page – then it comes from the storage
$("sBoardExport").onclick = async () => downloadJson({
  app: "jumpstart",
  kind: "board",
  version: 1,
  board: board || await store.get("board", null) || defaultBoard(),
}, "jumpstart-board.json");

$("sBoardImport").onclick = () => $("sBoardFile").click();
$("sBoardFile").onchange = async e => {
  const data = await pickedJson(e);
  if (data === undefined) return;
  const imported = normalizeBoard(data);
  if (!imported) return boardMsg(t("boardImportBad"), "bad");
  const current = board || await store.get("board", null);
  if (current && countCards(current) &&
      !(await confirmDialog(t("boardImportTitle"), t("boardImportText", countCards(current)), t("boardImportOk")))) return;
  board = imported;
  migrateBoard();
  await saveBoard({ replace: true });
  if (settings.board) {
    renderBoard();
    refreshCardStatuses();
  }
  boardMsg(t("boardImported", imported.columns.length, countCards(imported)), "ok");
};
