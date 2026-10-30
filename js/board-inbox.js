// =====================================================================================
// Inbox: Atlassian notifications – the same feed as the bell in Jira and Confluence (Jira, Confluence,
// Bitbucket). Read through the site's GraphQL gateway with the browser session; the settings (Board tab) pick
// which kinds get in. A notification dragged to a column becomes a card; × or the drag also marks it as read
// in Atlassian (the bell) and takes it off the Inbox
// =====================================================================================

const INBOX_LIMIT = 50;
const INBOX_REFRESH = 5 * 60 * 1000;     // a new look while the page is visible
const INBOX_HIDDEN_MAX = 500;
let inboxItems = null;                    // null – not loaded yet
let inboxError = "";                      // noperm | auth | limit | http <status> | network | graphql
let inboxHidden = [];
let inboxLoading = false;

const inboxOn = () => Boolean(settings.inbox?.on) && hasJira();
const inboxOptions = () => ({ ...DEFAULT_SETTINGS.inbox, ...(settings.inbox || {}) });

const INBOX_QUERY = `query JumpstartInbox($first: Int) { notifications { notificationFeed(first: $first) { nodes {
  headNotification { notificationId timestamp readState category
    content { type message url entity { title url } path { title url } }
    analyticsAttributes { key value } } } } } }`;

// What a notification is about, for the checkboxes: mentions | jira | confluence | views | bitbucket
function inboxKind(item) {
  if (item.type === "mentioned" || /mention/.test(item.template)) return "mentions";
  if (item.product === "confluence") return item.type === "viewed" ? "views" : "confluence";
  return item.product;
}

function toInboxItem(h) {
  const attrs = Object.fromEntries((h.analyticsAttributes || []).map(a => [a.key, a.value]));
  const template = attrs.messageTemplateId || "";
  const product = attrs.registrationProduct || template.split("-")[0] || "jira";
  const c = h.content || {};
  return {
    id: h.notificationId, ts: Date.parse(h.timestamp) || 0, unread: h.readState === "unread",
    type: c.type || "", template, product: ["jira", "confluence", "bitbucket"].includes(product) ? product : "jira",
    message: c.message || "", title: c.entity?.title || c.path?.[0]?.title || "", url: c.url || c.entity?.url || "",
    entityUrl: c.entity?.url || c.url || "",
  };
}

// The last loaded notifications live in the session (new tabs show them at once), hidden ones – for good
let inboxCheckedAt = 0;

async function restoreInbox() {
  inboxHidden = await store.get("inboxHidden", []);
  const saved = (await chrome.storage.session.get("inbox").catch(() => ({}))).inbox;
  if (saved?.items) { inboxItems = saved.items; inboxCheckedAt = saved.ts; }
}

const saveInbox = () => chrome.storage.session.set({ inbox: { ts: inboxCheckedAt, items: inboxItems } }).catch(() => {});

async function loadInbox(force = false) {
  if (!inboxOn() || inboxLoading) return;
  if (!force && inboxItems && Date.now() - inboxCheckedAt < CACHE_TTL) return;
  inboxLoading = true;
  renderInbox();
  try {
    if (!(await jiraReady())) {
      inboxError = accessError();
      return;
    }
    const r = await gatewayFetch("JumpstartInbox", INBOX_QUERY, { first: INBOX_LIMIT });
    if (r === null) { inboxError = "limit"; return; }
    if (r.status === 401) { jiraState = "auth"; inboxError = "auth"; return; }
    if (!r.ok) {
      console.warn("Jumpstart: inbox", r.status, await r.text().catch(() => ""));
      inboxError = "http " + r.status;
      return;
    }
    const data = await r.json();
    const nodes = data?.data?.notifications?.notificationFeed?.nodes;
    if (!Array.isArray(nodes)) {
      console.warn("Jumpstart: inbox", data?.errors);
      inboxError = "graphql";
      return;
    }
    inboxItems = nodes.map(node => toInboxItem(node.headNotification || {})).filter(item => item.id && item.url);
    inboxCheckedAt = Date.now();
    inboxError = "";
    saveInbox();
  } catch (e) {
    console.warn("Jumpstart: inbox", e);
    inboxError = "network";
  } finally {
    inboxLoading = false;
    renderInbox();
  }
}

setInterval(() => { if (document.visibilityState === "visible" && settings.board) loadInbox(); }, INBOX_REFRESH);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && settings.board) loadInbox(); });

// The notifications the settings let in, newest first
function visibleInbox() {
  const opt = inboxOptions(), hidden = new Set(inboxHidden);
  return (inboxItems || []).filter(item => !hidden.has(item.id) && opt[inboxKind(item)] !== false && (!opt.unread || item.unread))
    .sort((a, b) => b.ts - a.ts);
}

function timeAgo(ts) {
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const s = (ts - Date.now()) / 1000;
  for (const [unit, size] of [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]]) {
    if (Math.abs(s) >= size) return rtf.format(Math.round(s / size), unit);
  }
  return rtf.format(0, "minute");
}

const INBOX_ICONS = { jira: BOARD_ICONS.task, confluence: BOARD_ICONS.doc, bitbucket: BOARD_ICONS.pr };

function inboxItemHtml(item) {
  return `
    <a class="card inbox-item${item.unread ? " unread" : ""}" href="${esc(item.url)}" target="_blank" rel="noopener"
       draggable="true" data-inbox="${esc(item.id)}" data-col="inbox">
      <div class="inbox-top">
        <span class="inbox-icon inbox-${item.product}">${INBOX_ICONS[item.product]}</span>
        <span class="inbox-msg">${esc(item.message)}</span>
        <button type="button" class="inbox-hide" title="${esc(t("boardInboxHide"))}" aria-label="${esc(t("boardInboxHide"))}">${BOARD_ICONS.close}</button>
      </div>
      ${item.title ? `<div class="inbox-title">${esc(item.title)}</div>` : ""}
      <div class="inbox-time">${esc(timeAgo(item.ts))}</div>
    </a>`;
}

function inboxBodyHtml() {
  const items = visibleInbox();
  if (items.length) return items.map(inboxItemHtml).join("");
  if (inboxItems === null && (inboxLoading || !inboxError)) return `<div class="pick-msg">${esc(t("boardInboxLoading"))}</div>`;
  if (inboxError && inboxItems === null) {
    const { text, button } = accessNotice(inboxError);
    const message = text ?? t("boardInboxError", inboxError.replace("http ", "HTTP "));
    return `<div class="inbox-msg-box"><div>${esc(message)}</div><button type="button" class="btn tonal inbox-fix">${esc(button)}</button></div>`;
  }
  return `<div class="col-empty inbox-empty">${esc(t("boardInboxEmpty"))}</div>`;
}

function inboxColumnHtml() {
  if (!inboxOn()) return "";
  const unread = visibleInbox().filter(item => item.unread).length;
  return `
    <div class="col col-inbox" data-col="inbox">
      <div class="col-head">
        <span class="inbox-head-icon">${BOARD_ICONS.inbox}</span>
        <span class="col-name">${esc(t("boardInbox"))}</span>
        ${unread ? `<span class="inbox-count" title="${esc(t("boardInboxUnread"))}">${unread}</span>` : ""}
        <button type="button" class="menu-btn inbox-refresh${inboxLoading ? " spinning" : ""}" title="${esc(t("boardInboxRefresh"))}" aria-label="${esc(t("boardInboxRefresh"))}">${BOARD_ICONS.refresh}</button>
      </div>
      <div class="col-cards inbox-cards">${inboxBodyHtml()}</div>
    </div>`;
}

// only the Inbox column is redrawn: an edit or a composer elsewhere on the board stays as it is
function renderInbox() {
  const el = $("bCols").querySelector(".col-inbox");
  if (!el) return board && inboxOn() && renderBoard();
  const scroll = el.querySelector(".col-cards").scrollTop;
  el.outerHTML = inboxColumnHtml();
  const fresh = $("bCols").querySelector(".col-inbox .col-cards");
  if (fresh) fresh.scrollTop = scroll;
}

// Done with a notification: off the Inbox right away, and read in Atlassian too (if it wasn't)
function hideInboxItem(id) {
  inboxHidden = [id, ...inboxHidden.filter(x => x !== id)].slice(0, INBOX_HIDDEN_MAX);
  store.set("inboxHidden", inboxHidden);
  const item = (inboxItems || []).find(x => x.id === id);
  if (item?.unread) {
    item.unread = false;
    markInboxRead([id]);
  }
  renderInbox();
}

const MARK_READ = `mutation JumpstartMarkRead($ids: [String!]!) { notifications { markNotificationsByIdsAsRead(ids: $ids) } }`;

async function markInboxRead(ids) {
  try {
    const r = await gatewayFetch("JumpstartMarkRead", MARK_READ, { ids });
    const data = r?.ok ? await r.json() : null;
    if (!r?.ok || data?.errors?.length) console.warn("Jumpstart: mark as read", r?.status, data?.errors);
    saveInbox();
  } catch (e) {
    console.warn("Jumpstart: mark as read", e);
  }
}

function inboxClick(e) {
  if (e.target.closest(".inbox-refresh")) return loadInbox(true);
  const fix = e.target.closest(".inbox-fix");
  if (fix) return fixAccess(inboxError, () => loadInbox(true));
  const hide = e.target.closest(".inbox-hide");
  if (hide) {
    e.preventDefault();
    hideInboxItem(hide.closest(".inbox-item").dataset.inbox);
  }
  // a click on the item itself is a plain link: Ctrl/middle click open it in a background tab natively
}

// What the notification said and when – who did what: "Jane Doe commented on the page – 30 Oct, 14:05"
function inboxLine(item) {
  const when = item.ts && new Date(item.ts).toLocaleString(lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return [item.message || item.title, when].filter(Boolean).join(" – ");
}

// The card a notification adds to, if there is one: the PR's or the task's card, or a note linking the same page
function inboxTarget(ref, key, url) {
  const cards = board.columns.flatMap(c => c.cards);
  if (ref) return cards.find(c => c.pr === ref);
  if (key) return cards.find(c => c.key === key);
  return cards.find(c => !c.key && !c.pr && (c.links || []).some(l => l.url === url));
}

// Dropped on a column: a pull request notification becomes the PR card, a Jira one – the task's card,
// anything else – a note with the page linked. The card's text keeps what the notification said and when, a line
// each; a card already on the board (also a note on the same page) gets the line added instead of a new card
function inboxToCard(id, col, index) {
  const item = (inboxItems || []).find(x => x.id === id);
  if (!item || !col) return;
  const url = item.entityUrl || item.url, title = item.title || item.message, line = inboxLine(item);
  const ref = prRefOf(item.entityUrl) || prRefOf(item.url);
  const key = !ref && (taskOfUrl(item.entityUrl) || taskOfUrl(item.url));
  hideInboxItem(id);
  const existing = inboxTarget(ref, key, url);
  if (existing) {
    if (!(existing.text || "").split("\n").includes(line)) existing.text = existing.text ? existing.text + "\n" + line : line;
    update();
    return flashCard(cardId(existing));
  }
  const card = ref ? prCard(ref, url, item.title, "", { text: line })
    : key ? { ...jiraCard(key, { text: line }), summary: issueOf(key)?.summary || item.title }
    : noteCard(line, { links: [{ title, url }] });
  col.cards.splice(Math.max(0, index), 0, card);
  update();
  refreshFor(card);
}
