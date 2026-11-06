// Jumpstart – shared by every script of the page: settings, small helpers, links and task keys, badges.
// The page scripts are plain scripts sharing one global scope; newtab.html loads them in dependency order.

// =====================================================================================
// Settings
// =====================================================================================

const MAX_LINKS = 8;

const DEFAULT_SETTINGS = {
  name: "",
  email: "",
  jiraUrl: "",          // Atlassian site, e.g. https://company.atlassian.net (Jira + Confluence)
  projectKey: "",       // "123" in the search box becomes "<projectKey>-123"
  confSpace: "",        // priority Confluence space key
  bbWorkspace: "",      // Bitbucket Cloud workspace slug
  bbRepos: [],          // repositories searched for pull requests (Bitbucket has no workspace-wide PR search)
  lang: "",             // "" – same as Chrome
  voiceLang: "",        // "" – same as Chrome
  bg: "",               // "" – light/dark by Chrome mode
  shortcuts: true,      // the row of shortcuts under the search box
  compact: false,       // compact view: a small logo and the search box in the top bar, no shortcuts
  aiSearch: false,      // Google AI Mode is the main search action (off: plain Google Search; AI Mode stays in the list)
  board: false,         // kanban board in the bottom half of the page (board*.js)
  boardLock: false,     // columns locked: no adding, renaming, retyping, deleting or reordering
  // "Inbox" column of the board: Atlassian notifications (the bell) – which kinds get in
  inbox: { on: false, mentions: true, jira: true, confluence: false, views: false, bitbucket: true, unread: false },
  // History Quick Search – what the empty search box shows from browser history
  focusSources: { jira: true, confluence: true, bitbucket: true, google: true, sites: true },
  // Autocomplete Quick Search – what is suggested while typing
  sources: { jira: true, confluence: true, bitbucket: true, prs: true, history: true },
};

let settings = { ...DEFAULT_SETTINGS };

// Every Atlassian feature is optional: it stays off until its address is set in the settings
const hasJira = () => Boolean(settings.jiraUrl);
const hasBitbucket = () => Boolean(settings.bbWorkspace);
const prRepos = () => (hasBitbucket() ? settings.bbRepos || [] : []);
const typingSource = name => settings.sources?.[name] !== false;
const focusSource = name => settings.focusSources?.[name] !== false;

const BITBUCKET = "https://bitbucket.org";
const jiraOrigin = () => settings.jiraUrl.replace(/\/+$/, "");
const jiraApiOrigin = () => new URL(settings.jiraUrl).origin;
const jiraBase = () => jiraOrigin() + "/browse/";

// =====================================================================================
// Helpers
// =====================================================================================

const $ = id => document.getElementById(id);

// Names of the keys in hints: macOS has Option and Command where Windows has Alt and Ctrl
const IS_MAC = /Mac/i.test(navigator.userAgentData?.platform || navigator.platform || "");
const KEY_ALT = IS_MAC ? "⌥" : "Alt";
const KEY_CTRL = IS_MAC ? "⌘" : "Ctrl";

const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const setInvalid = (id, on) => $(id).closest(".field").classList.toggle("invalid", on);

// A help line under a group of settings: a hint, or the result of an action (cls "ok" / "bad")
function showMsg(id, text, cls = "") {
  $(id).textContent = text;
  $(id).className = "help" + (cls ? " " + cls : "");
}

const store = {
  get: async (key, fallback) => (await chrome.storage.local.get(key))[key] ?? fallback,
  set: (key, value) => chrome.storage.local.set({ [key]: value }),
};

// Favicon from Chrome's own cache (needs the "favicon" permission)
const faviconUrl = url =>
  `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`;

// A new tab; background – without switching to it (a middle click or Ctrl/Cmd+click)
function openUrl(url, background = false) {
  if (background) chrome.tabs.create({ url, active: false });
  else window.open(url, "_blank", "noopener");
}

function downloadJson(data, fileName) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: fileName });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// The JSON file picked in an <input type="file"> (change event). The input is cleared, so the same file can be
// picked again. undefined – nothing picked, null – not JSON
async function pickedJson(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return undefined;
  try {
    return JSON.parse(await file.text());
  } catch {
    return null;
  }
}

// Confirmation in the same style as the settings. Cancel, Esc or a click outside – false
function confirmDialog(title, text, okLabel) {
  const dlg = $("confirmDlg");
  $("cTitle").textContent = title;
  $("cText").textContent = text;
  $("cOk").textContent = okLabel;
  dlg.returnValue = "";
  dlg.showModal();
  return new Promise(resolve => dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok"), { once: true }));
}

// =====================================================================================
// Links and task keys
// =====================================================================================

const urls = {
  google: q => "https://www.google.com/search?q=" + encodeURIComponent(q),
  ai: q => "https://www.google.com/search?udm=50&q=" + encodeURIComponent(q),
  jira: q => urls.jql(`text ~ "${q.replace(/"/g, '\\"')}" ORDER BY updated DESC`),
  jql: q => jiraOrigin() + "/issues/?jql=" + encodeURIComponent(q),
  confluence: q => jiraApiOrigin() + "/wiki/search?text=" + encodeURIComponent(q),
  cql: q => jiraApiOrigin() + "/wiki/dosearchsite.action?cql=" + encodeURIComponent(q),  bitbucket: q => `${BITBUCKET}/${encodeURIComponent(settings.bbWorkspace)}/workspace/repositories/?search=${encodeURIComponent(q)}`,
  task: key => jiraBase() + key,
};

const isTaskKey = id => typeof id === "string" && /^[A-Z][A-Z0-9]+-\d+$/.test(id);

// Task key from the input: "SF-123", "sf123" or just "123" with the default project key
function taskKeyOf(raw) {
  raw = raw.trim().toUpperCase();
  if (!hasJira()) return null;
  if (/^\d+$/.test(raw)) return settings.projectKey ? `${settings.projectKey}-${raw}` : null;
  const m = raw.match(/^([A-Z][A-Z0-9]+)-?(\d+)$/);
  return m ? `${m[1]}-${m[2]}` : null;
}

// Task key of a Jira task link: …/browse/SF-1[/…, ?…] → "SF-1"
const taskOfUrl = url =>
  hasJira() && url.startsWith(jiraBase()) ? url.slice(jiraBase().length).match(/^([A-Z][A-Z0-9]+-\d+)/)?.[1] || null : null;

const looksLikeUrl = q => /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(:\d+)?([/?#]\S*)?$/i.test(q);
const withScheme = url => (/^https?:\/\//i.test(url) ? url : "https://" + url);

// A previous Google / AI Mode search from history – shown as the query text, like Chrome does
function googleQueryOf(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)google\.[a-z.]+$/.test(u.hostname) || u.pathname !== "/search" || !u.searchParams.get("q")) return null;
    return { text: u.searchParams.get("q"), ai: u.searchParams.get("udm") === "50" };
  } catch {
    return null;
  }
}

// Bitbucket Cloud pull request link: bitbucket.org/<ws>/<repo>/pull-requests/<id>[/diff, /commits…] → "ws/repo/id"
function prRefOf(url) {
  const m = url.match(/^https:\/\/bitbucket\.org\/([^/?#]+)\/([^/?#]+)\/pull-requests\/(\d+)/i);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : null;
}

// Confluence page id from any of its links: …/wiki/spaces/SLAM/pages/123456/Title → "123456"
const confPageRefOf = url => url.match(/\/wiki\/spaces\/[^/]+\/pages\/(\d+)/)?.[1] || null;

const isConfluenceUrl = url => hasJira() && url.startsWith(jiraApiOrigin() + "/wiki/");

// The same page without the noise: no #anchor, no tracking parameters, no trailing slash
const TRACKING_PARAM = /^(utm_\w+|fbclid|gclid|yclid|mc_cid|mc_eid|ref_src)$/i;
function canonicalUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    [...u.searchParams.keys()].filter(k => TRACKING_PARAM.test(k)).forEach(k => u.searchParams.delete(k));
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.href;
  } catch {
    return url;
  }
}

// =====================================================================================
// Status badges: Jira status colors (category new | indeterminate | done); PR states use the same colors
// =====================================================================================

const PR_STATE_CATEGORY = { OPEN: "indeterminate", MERGED: "done", DECLINED: "new" };

// small – the compact variant for links on a card
const badgeHtml = (text, cat, small = false) =>
  `<span class="${small ? "att-status att-" : "st st-"}${esc(cat)}" title="${esc(text)}">${esc(text)}</span>`;
const issueBadge = (issue, small) => (issue?.status ? badgeHtml(issue.status, issue.cat || "new", small) : "");
const prBadge = (state, small) => (state ? badgeHtml(state, PR_STATE_CATEGORY[state] || "new", small) : "");
