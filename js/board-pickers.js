// Board dialogs that pick something: a Jira task for a column, a task or a page to link to a card.

// =====================================================================================
// "+ From Jira": my Jira tasks with a filter, or any task number, added to a column as cards
// =====================================================================================

let pickColumn = null; // column the tasks are added to
let pickKeys = [];
let pickNotice = ""; // why my Jira tasks aren't listed: no access, not signed in, the limit or an error

function renderPicker() {
  const filter = $("pickFilter").value.trim().toLowerCase();
  // already a card on the board
  const onBoard = cardsOnBoard();
  const takenLabel = t("boardOnBoard");
  const rows = pickKeys.filter(key => {
    const issue = issueOf(key);
    return !filter || key.toLowerCase().includes(filter) || (issue?.summary || "").toLowerCase().includes(filter);
  }).map(key => {
    const issue = issueOf(key), there = onBoard.has(key);
    return `
      <button type="button" class="pick-row" data-key="${esc(key)}"${there ? " disabled" : ""}>
        <span class="card-key">${esc(key)}</span>
        <span class="pick-title">${esc(issue?.summary || "")}</span>
        ${there ? `<span class="pick-there">${esc(takenLabel)}</span>` : issueBadge(issue)}
      </button>`;
  });
  // a task number that isn't in my list – add it anyway
  const typed = filter ? taskKeyOf(filter) : null;
  if (typed && !pickKeys.includes(typed) && !onBoard.has(typed)) {
    rows.unshift(`<button type="button" class="pick-row" data-key="${esc(typed)}"><span class="card-key">${esc(typed)}</span>` +
      `<span class="pick-title">${esc(t("boardAddKey", typed))}</span></button>`);
  }
  $("pickList").innerHTML = (rows.join("") || (pickNotice ? "" : `<div class="pick-msg">${esc(t("boardPickEmpty"))}</div>`)) + pickNotice;
  $("pickAccess")?.addEventListener("click", () => fixAccess(myTasksError, () => openTaskPicker(pickColumn)));
}

async function openTaskPicker(col) {
  pickColumn = col;
  pickKeys = [];
  pickNotice = "";
  $("pickTitle").textContent = t("boardPickTitle", col.name);
  $("pickFilter").value = "";
  if (!$("pickDlg").open) $("pickDlg").showModal();
  $("pickFilter").focus();

  $("pickList").innerHTML = `<div class="pick-msg">${esc(t("boardPickLoading"))}</div>`;
  const keys = await myTasks();
  if (keys === null) {
    const { text, button } = accessNotice(myTasksError);
    const message = text ?? t("boardErrorText", myTasksError.replace("http ", "HTTP ") || "?");
    pickNotice = `<div class="pick-access">${BOARD_ICONS.task}` +
      `<div class="pick-access-text">${esc(message)}</div>` +
      `<button type="button" class="btn filled" id="pickAccess">${esc(button)}</button></div>`;
  } else {
    pickKeys = keys;
  }
  renderPicker();
}

$("pickFilter").addEventListener("input", renderPicker);
$("pickFilter").addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  $("pickList").querySelector(".pick-row:not([disabled])")?.click();
});
$("pickList").addEventListener("click", e => {
  const row = e.target.closest(".pick-row");
  if (!row || row.disabled) return;
  const card = jiraCard(row.dataset.key);
  pickColumn.cards.push(card);
  update();
  refreshFor(card);
  renderPicker(); // the dialog stays open: several tasks can be added in a row
  $("pickFilter").focus();
});
$("pickClose").onclick = () => $("pickDlg").close();

// =====================================================================================
// "Add link": one dialog for everything a card can link to – Jira tasks (my tasks, a task number,
// recently opened tasks), Confluence pages and any other page (history, Confluence search, a pasted address).
// Every kind of card links both tasks and pages
// =====================================================================================

let docCard = null;    // card a task or a page is being linked to
let docTimer = null, docCtrl = null, docTasks = [];
const DOC_ROWS = 12, DOC_TASKS = 5;

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

// My Jira tasks and a typed task number, for the text in the box
function taskLinks(q) {
  if (!q || !canLinkTasks()) return [];
  const f = q.toLowerCase();
  const keys = docTasks.filter(key => key.toLowerCase().includes(f) || (issueOf(key)?.summary || "").toLowerCase().includes(f));
  const typed = taskKeyOf(q);
  if (typed && !keys.includes(typed)) keys.unshift(typed);
  return keys.slice(0, DOC_TASKS).map(key => ({ key, title: issueOf(key)?.summary || t("boardAddKey", key) }));
}

const docRowHtml = r => r.key
  ? `<button type="button" class="pick-row" data-key="${esc(r.key)}">${BOARD_ICONS.task}<span class="card-key">${esc(r.key)}</span>` +
    `<span class="pick-title">${esc(r.title)}</span>` +
    issueBadge(issueOf(r.key)) + `</button>`
  : `<button type="button" class="pick-row" data-url="${esc(r.url)}" data-title="${esc(r.title)}">` +
    `${linkIcon(r.url)}<span class="pick-title">${esc(r.title)}</span><span class="pick-there">${esc(r.hint)}</span></button>`;

// what is already on the card, and the card itself, is left out; one task or page once
function showDocRows(rows) {
  const linked = new Set([...(docCard.links || []).map(l => l.key || linkRef(l.url)),
    docCard.key, docCard.pr && linkRef(docCard.url)].filter(Boolean));
  const seen = new Set();
  const fresh = rows.filter(r => {
    const ref = r.key || linkRef(r.url);
    if (linked.has(ref) || seen.has(ref)) return false;
    seen.add(ref);
    return true;
  }).slice(0, DOC_ROWS);
  $("docList").innerHTML = fresh.length
    ? fresh.map(docRowHtml).join("")
    : `<div class="pick-msg">${esc(t("boardDocHint"))}</div>`;
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

async function openDocDialog(card) {
  docCard = card;
  docTasks = [];
  $("docTitle").textContent = t("boardDocTitle", cardName(card));
  $("docInput").placeholder = t(canLinkTasks() ? "boardDocPlaceholder" : "boardDocPlaceholderPages");
  $("docInput").value = "";
  $("docList").innerHTML = "";
  $("docDlg").showModal();
  $("docInput").focus();
  renderDocList();
  // my tasks arrive a bit later (cached for a while); the list is redrawn when they do
  if (canLinkTasks() && (await jiraReady().catch(() => false))) {
    docTasks = (await myTasks()) || [];
    if ($("docDlg").open && $("docInput").value.trim()) renderDocList();
  }
}

$("docInput").addEventListener("input", renderDocList);
$("docInput").addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  $("docList").querySelector(".pick-row")?.click();
});
// the dialog stays open: several tasks and pages can be linked in a row
$("docList").addEventListener("click", e => {
  const row = e.target.closest(".pick-row");
  if (!row) return;
  docCard.links ??= [];
  if (row.dataset.key) {
    docCard.links.push({ key: row.dataset.key });
    if (!issueOf(row.dataset.key)) refreshCardStatuses();
  } else {
    docCard.links.push({ title: row.dataset.title, url: row.dataset.url });
    if (prRefOf(row.dataset.url)) refreshPrCards();
  }
  update();
  $("docInput").value = "";
  renderDocList();
  $("docInput").focus();
});
$("docClose").onclick = () => $("docDlg").close();
