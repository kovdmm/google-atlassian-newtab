// Board dialog that picks a link: a task or a page to link to a card, or to add to a column as a new card.

// =====================================================================================
// One dialog for every link – Jira tasks (my tasks, a task number, recently opened tasks), Confluence pages and
// any other page (history, Confluence search, a pasted address). Two uses:
//   ⋮ → "Add link" on a card – the link goes to the card's links;
//   "+ Link" under a column – the link becomes a new card there: a task – its Jira card, a pull request – its PR
//   card, any other page – a note with just that link. A task or PR that is already a card can't be picked again
// =====================================================================================

let docCard = null;    // card a task or a page is being linked to…
let docColumn = null;  // …or the column a new card is added to
let docTimer = null, docCtrl = null, docTasks = [];
let docNotice = "";    // "+ Link": why my Jira tasks aren't listed – no access, not signed in, the limit or an error
const DOC_ROWS = 12, DOC_TASKS = 5, DOC_MY_TASKS = 8;

// A pasted link gets a readable title from its address: …/pages/123/Release+notes → "Release notes"
function titleFromUrl(url) {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() || "").replace(/\+/g, " ");
    return /^\d+$/.test(last) || !last ? u.hostname : last;
  } catch {
    return url;
  }
}

// History titles: "Page - Space - Confluence" → "Page", "[SF-1] Summary - Jira" → "Summary"
const pageTitle = (title, url) =>
  (title || "").replace(/\s[-–]\s[^-–]+\s[-–]\sConfluence$/, "").replace(/\s[-–]\s(Confluence|Jira)$/, "")
    .replace(/^\[[A-Z][A-Z0-9]+-\d+\]\s*/, "").trim() || titleFromUrl(url);

const linkRef = url => confPageRefOf(url) || canonicalUrl(url);
const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
const canLinkTasks = () => hasJira();

// Recently visited pages and tasks; on an empty box Jira tasks and Confluence pages go before other sites
async function historyLinks(q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const found = await chrome.history.search({ text: q, maxResults: q ? 300 : 500, startTime: 0 });
  const seen = new Set(), rows = [];
  for (const h of found.sort((a, b) => b.lastVisitTime - a.lastVisitTime)) {
    if (!/^https?:/i.test(h.url) || googleQueryOf(h.url)) continue;
    const key = taskOfUrl(h.url);
    if (hasJira() && h.url.startsWith(jiraBase()) && (!key || !canLinkTasks())) continue;
    const title = pageTitle(h.title, h.url), ref = key || linkRef(h.url);
    if (seen.has(ref) || !words.every(w => (title + " " + h.url).toLowerCase().includes(w))) continue;
    seen.add(ref);
    rows.push(key ? { key, title: issueOf(key)?.summary || title } :
      { title, url: h.url, hint: isConfluenceUrl(h.url) ? "Confluence" : hostOf(h.url) });
  }
  const atlassian = r => r.key || isConfluenceUrl(r.url) ? 1 : 0;
  if (!q) rows.sort((a, b) => atlassian(b) - atlassian(a));
  return rows;
}

// My Jira tasks and a typed task number, for the text in the box; "+ Link" lists my tasks on an empty box too
function taskLinks(q) {
  if (!canLinkTasks()) return [];
  if (!q) return docColumn ? docTasks.slice(0, DOC_MY_TASKS).map(key => ({ key, title: issueOf(key)?.summary || "" })) : [];
  const f = q.toLowerCase();
  const keys = docTasks.filter(key => key.toLowerCase().includes(f) || (issueOf(key)?.summary || "").toLowerCase().includes(f));
  const typed = taskKeyOf(q);
  if (typed && !keys.includes(typed)) keys.unshift(typed);
  return keys.slice(0, DOC_TASKS).map(key => ({ key, title: issueOf(key)?.summary || t("boardAddKey", key) }));
}

// "+ Link": a task or PR that is already a card on the board
const onBoardRow = r => Boolean(docColumn) &&
  (r.key ? cardsOnBoard().has(r.key) : Boolean(prRefOf(r.url)) && prCardsOnBoard().has(prRefOf(r.url)));

function docRowHtml(r) {
  const there = onBoardRow(r), off = there ? " disabled" : "";
  const thereLabel = `<span class="pick-there">${esc(t("boardOnBoard"))}</span>`;
  return r.key
    ? `<button type="button" class="pick-row" data-key="${esc(r.key)}"${off}>${BOARD_ICONS.task}<span class="card-key">${esc(r.key)}</span>` +
      `<span class="pick-title">${esc(r.title)}</span>` + (there ? thereLabel : issueBadge(issueOf(r.key))) + `</button>`
    : `<button type="button" class="pick-row" data-url="${esc(r.url)}" data-title="${esc(r.title)}"${off}>` +
      `${linkIcon(r.url)}<span class="pick-title">${esc(r.title)}</span>` +
      (there ? thereLabel : `<span class="pick-there">${esc(r.hint)}</span>`) + `</button>`;
}

// what is already on the card, and the card itself, is left out; one task or page once
function showDocRows(rows) {
  const linked = new Set(docCard ? [...(docCard.links || []).map(l => l.key || linkRef(l.url)),
    docCard.key, docCard.pr && linkRef(docCard.url)].filter(Boolean) : []);
  const seen = new Set();
  const fresh = rows.filter(r => {
    const ref = r.key || linkRef(r.url);
    if (linked.has(ref) || seen.has(ref)) return false;
    seen.add(ref);
    return true;
  }).slice(0, DOC_ROWS);
  $("docList").innerHTML = (fresh.length
    ? fresh.map(docRowHtml).join("")
    : `<div class="pick-msg">${esc(t("boardDocHint"))}</div>`) + (docColumn && !$("docInput").value.trim() ? docNotice : "");
  $("docAccess")?.addEventListener("click", () => fixAccess(myTasksError, () => openDocDialog({ col: docColumn })));
}

async function renderDocList() {
  clearTimeout(docTimer);
  docCtrl?.abort();
  const q = $("docInput").value.trim();
  const current = () => $("docInput").value.trim() === q;
  // a pasted address: a Jira task link becomes the task, anything else – the page with its title from the history
  if (/^https?:\/\//i.test(q)) {
    const key = canLinkTasks() && taskOfUrl(q);
    const found = await chrome.history.search({ text: key || q, maxResults: 20, startTime: 0 });
    if (!current()) return;
    if (key) {
      const h = found.find(x => taskOfUrl(x.url) === key);
      return showDocRows([{ key, title: issueOf(key)?.summary || (h ? pageTitle(h.title, h.url) : t("boardAddKey", key)) }]);
    }
    const h = found.find(x => linkRef(x.url) === linkRef(q));
    $("docList").innerHTML = docRowHtml({ title: pageTitle(h?.title, q), url: q, hint: hostOf(q) });
    return;
  }
  docTimer = setTimeout(async () => {
    const local = [...taskLinks(q), ...await historyLinks(q)];
    if (!current()) return;
    showDocRows(local);
    if (q.length < SEARCH_MIN || !hasJira()) return;
    // then Confluence search results the history does not have yet
    docCtrl = new AbortController();
    let pages = null;
    try { pages = (await jiraReady()) ? await confluenceQuery(q, "", docCtrl.signal) : null; } catch {}
    if (!current() || !pages?.length) return;
    showDocRows([...local, ...pages.map(p => ({ title: p.text, url: p.url, hint: p.hint }))]);
  }, q ? 200 : 0);
}

// { card } – link to that card; { col } – add a new card to that column ("+ Link")
async function openDocDialog({ card = null, col = null }) {
  docCard = card;
  docColumn = col;
  docTasks = [];
  docNotice = "";
  $("docTitle").textContent = card ? t("boardDocTitle", cardName(card)) : t("boardPickTitle", col.name);
  $("docInput").placeholder = t(canLinkTasks() ? "boardDocPlaceholder" : "boardDocPlaceholderPages");
  $("docInput").value = "";
  $("docList").innerHTML = "";
  if (!$("docDlg").open) $("docDlg").showModal();
  $("docInput").focus();
  renderDocList();
  // my tasks arrive a bit later (cached for a while); the list is redrawn when they do.
  // "+ Link" asks for them even without access yet – the answer tells which button helps
  if (!canLinkTasks() || (!col && !(await jiraReady().catch(() => false)))) return;
  const keys = await myTasks();
  docTasks = keys || [];
  if (keys === null && col) {
    const { text, button } = accessNotice(myTasksError);
    const message = text ?? t("boardErrorText", myTasksError.replace("http ", "HTTP ") || "?");
    docNotice = `<div class="pick-access">${BOARD_ICONS.task}<div class="pick-access-text">${esc(message)}</div>` +
      `<button type="button" class="btn filled" id="docAccess">${esc(button)}</button></div>`;
  }
  if ($("docDlg").open && ($("docInput").value.trim() || col)) renderDocList();
}

// A link typed outside the dialog (in a note): the page with its title from the history, or from its address
async function pageLinkOf(url) {
  const found = await chrome.history.search({ text: url, maxResults: 20, startTime: 0 });
  const h = found.find(x => linkRef(x.url) === linkRef(url));
  return { title: pageTitle(h?.title, url), url };
}

// The link goes to the card's links, once; what the board doesn't know about it yet is loaded
function linkToCard(card, link) {
  const ref = l => l.key || linkRef(l.url);
  card.links ??= [];
  if (card.links.some(l => ref(l) === ref(link))) return;
  card.links.push(link);
  if (link.key && !issueOf(link.key)) refreshCardStatuses();
  if (link.url && prRefOf(link.url)) refreshPrCards();
}

// "+ Link": the picked link as a new card at the end of the column
function addLinkCard(row) {
  const { key, url, title } = row.dataset, ref = !key && prRefOf(url);
  const card = key ? jiraCard(key) : ref ? prCard(ref, url) : noteCard("", { links: [{ title, url }] });
  docColumn.cards.push(card);
  update();
  refreshFor(card);
}

$("docInput").addEventListener("input", renderDocList);
$("docInput").addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  $("docList").querySelector(".pick-row:not([disabled])")?.click();
});
// the dialog stays open: several tasks and pages can be linked (or added) in a row
$("docList").addEventListener("click", e => {
  const row = e.target.closest(".pick-row");
  if (!row || row.disabled) return;
  if (docColumn) {
    addLinkCard(row);
    $("docInput").value = "";
    renderDocList();
    return $("docInput").focus();
  }
  linkToCard(docCard, row.dataset.key ? { key: row.dataset.key } : { title: row.dataset.title, url: row.dataset.url });
  update();
  $("docInput").value = "";
  renderDocList();
  $("docInput").focus();
});
$("docClose").onclick = () => $("docDlg").close();
