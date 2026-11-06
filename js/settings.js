// Settings: applying them to the page and the settings dialog (General, Board and Atlassian tabs).

// =====================================================================================
// Applying settings to the page
// =====================================================================================

const DEFAULT_AVATAR = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#5f6368"/>' +
  '<circle cx="16" cy="12.5" r="5.5" fill="#e8eaed"/><path d="M5 29c1-6 5.5-9 11-9s10 3 11 9z" fill="#e8eaed"/></svg>');

async function sha256(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function avatarUrl(email) {
  email = email.trim().toLowerCase();
  return email.includes("@") ? `https://www.gravatar.com/avatar/${await sha256(email)}?s=128&d=identicon` : DEFAULT_AVATAR;
}

function setAvatar(img, url) {
  img.onerror = () => { img.onerror = null; img.src = DEFAULT_AVATAR; };
  img.src = url;
}

const savedLang = () => (settings.lang && I18N[settings.lang] ? settings.lang : browserLang());

async function applySettings() {
  lang = savedLang();
  // "enhanced with Atlassian" and the search placeholder – only when something from Atlassian is connected
  const atlassian = hasJira() || hasBitbucket();
  $("q").dataset.i18nPh = atlassian ? "searchPlaceholderAtlassian" : "searchPlaceholder";
  $("tagline").hidden = !atlassian;
  applyLayout({ compact: Boolean(settings.compact), "with-board": Boolean(settings.board), atlassian });
  applyI18n();
  applyTheme(settings.bg);
  $("shortcuts").hidden = settings.shortcuts === false;
  renderLinks();
  applyBoard();
  $("avatar").title = settings.name || settings.email;
  setAvatar($("avatar"), await avatarUrl(settings.email));
}

// =====================================================================================
// Settings dialog
// =====================================================================================

// ---- Tabs: "General" first, everything about Atlassian on its own tab ----

function switchTab(name) {
  document.querySelectorAll("#setDlg .tab").forEach(btn => {
    const on = btn.dataset.tab === name;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", String(on));
  });
  document.querySelectorAll("#setDlg .panel").forEach(panel => { panel.hidden = panel.dataset.tab !== name; });
  document.querySelector("#setDlg .body").scrollTop = 0;
}
document.querySelectorAll("#setDlg .tab").forEach(btn => { btn.onclick = () => switchTab(btn.dataset.tab); });

// An invalid field on the other tab – switch there first
function focusInvalid(id) {
  switchTab($(id).closest(".panel").dataset.tab);
  $(id).focus();
}

// ---- Profile ----

let avatarTimer = null;
function previewAvatar() {
  clearTimeout(avatarTimer);
  avatarTimer = setTimeout(async () => setAvatar($("sAvatar"), await avatarUrl($("sEmail").value)), 300);
}
$("sEmail").addEventListener("input", previewAvatar);

// ---- Background: the choice is previewed on the page, Cancel restores the saved one ----

let draftBg = "";

function renderSwatches() {
  const isPreset = BG_PRESETS.includes(draftBg);
  const custom = draftBg && !isPreset;
  $("sBg").innerHTML =
    `<button type="button" class="swatch auto${draftBg ? "" : " selected"}" data-bg="" ` +
      `title="${esc(t("bgAuto"))}" aria-label="${esc(t("bgAuto"))}"></button>` +
    BG_PRESETS.map(c =>
      `<button type="button" class="swatch${draftBg === c ? " selected" : ""}" data-bg="${c}" ` +
        `style="--c:${c}" title="${c}" aria-label="${c}"></button>`).join("") +
    `<label class="swatch custom${custom ? " selected" : ""}" title="${esc(t("bgCustom"))}" ` +
      `${custom ? `style="background:${draftBg}"` : ""}>` +
      `<input type="color" id="sBgCustom" value="${draftBg || "#3c3c3c"}" aria-label="${esc(t("bgCustom"))}"></label>`;
}

function pickBg(bg) {
  draftBg = bg;
  applyTheme(bg);
  renderSwatches();
}
$("sBg").addEventListener("click", e => {
  const btn = e.target.closest("button.swatch");
  if (btn) pickBg(btn.dataset.bg);
});
$("sBg").addEventListener("input", e => {
  if (e.target.id !== "sBgCustom") return;
  draftBg = e.target.value;
  applyTheme(draftBg);
});
$("sBg").addEventListener("change", e => {
  if (e.target.id === "sBgCustom") pickBg(e.target.value);
});

// ---- Language: the page switches immediately so the result is visible; Cancel restores it ----

// Speech recognition works with one language at a time
const VOICE_LANGS = [
  ["ru-RU", "Русский"], ["en-US", "English (US)"], ["en-GB", "English (UK)"], ["de-DE", "Deutsch"],
  ["uk-UA", "Українська"], ["fr-FR", "Français"], ["es-ES", "Español"], ["it-IT", "Italiano"], ["pl-PL", "Polski"],
];

function fillLangOptions(selected) {
  $("sLang").innerHTML = `<option value="auto">${esc(t("languageAuto", LANG_NAMES[browserLang()]))}</option>` +
    Object.keys(I18N).map(code => `<option value="${code}">${LANG_NAMES[code]}</option>`).join("");
  $("sLang").value = selected || "auto";
}

function fillVoiceOptions(selected) {
  $("sVoice").innerHTML = `<option value="">${esc(t("languageAuto", navigator.language))}</option>` +
    VOICE_LANGS.map(([code, name]) => `<option value="${code}">${name}</option>`).join("");
  $("sVoice").value = selected || "";
}

$("sLang").addEventListener("change", () => {
  const value = $("sLang").value;
  lang = value !== "auto" && I18N[value] ? value : browserLang();
  applyI18n($("setDlg"));
  setDialogTitle();
  fillLangOptions(value);
  fillVoiceOptions($("sVoice").value);
  previewTaskUrl();
});

// ---- Atlassian connections ----

const cleanUrl = raw => {
  const url = withScheme(raw.trim());
  try {
    const u = new URL(url);
    return u.hostname.includes(".") || u.hostname === "localhost" ? u.origin + u.pathname.replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
};
const validKey = key => /^[A-Z][A-Z0-9]*$/.test(key);

// "123 → https://…/browse/SF-123"
function previewTaskUrl() {
  const base = cleanUrl($("sJira").value) || "https://…";
  const key = $("sKey").value.trim().toUpperCase() || "KEY";
  $("sPreview").innerHTML = esc(t("projectKeyHint", "\u0000")).replace("\u0000", `<b>${esc(`${base}/browse/${key}-123`)}</b>`);
}
$("sJira").addEventListener("input", () => { setInvalid("sJira", false); previewTaskUrl(); });
$("sKey").addEventListener("input", () => { setInvalid("sKey", false); previewTaskUrl(); });

// ---- Quick search: two groups of checkboxes ----

// [name, label, settings field(s) the service needs – "a+b" means both]
const SOURCE_GROUPS = [
  ["focusSrc", "focusSources", [
    ["jira", "srcJiraLabel", "sJira"],
    ["confluence", "srcConfluenceLabel", "sJira"],
    ["bitbucket", "srcBitbucketLabel", "sBb"],
    ["google", "srcGoogleLabel"],
    ["sites", "srcSitesLabel"],
  ]],
  ["typeSrc", "sources", [
    ["jira", "srcJiraLabel", "sJira"],
    ["confluence", "srcConfluenceLabel", "sJira"],
    ["bitbucket", "srcBitbucketLabel", "sBb"],
    ["prs", "srcPrLabel", "sBb+sBbRepos"],
    ["history", "srcHistoryLabel"],
  ]],
];

function fillSourceChecks(s) {
  SOURCE_GROUPS.forEach(([el, key, rows]) => {
    const values = { ...DEFAULT_SETTINGS[key], ...(s[key] || {}) };
    $(el).innerHTML = rows.map(([name, label, needs]) =>
      `<label class="check"><input type="checkbox" data-name="${name}" data-needs="${needs || ""}"` +
        `${values[name] !== false ? " checked" : ""}><span>${esc(t(label))}</span></label>`).join("");
  });
  updateSourceChecks();
}

// A source of a service that isn't connected has no row at all
function updateSourceChecks() {
  document.querySelectorAll(".checks input").forEach(cb => {
    const off = Boolean(cb.dataset.needs) && cb.dataset.needs.split("+").some(id => !$(id).value.trim());
    cb.disabled = off;
    cb.closest(".check").hidden = off;
  });
}

const readSourceChecks = el =>
  Object.fromEntries([...$(el).querySelectorAll("input")].map(cb => [cb.dataset.name, cb.checked]));

// Nothing extra until an address is entered: no project key, space or repositories,
// and no Quick search at all while neither Jira/Confluence nor Bitbucket is set
function updateDependentFields() {
  const jira = Boolean($("sJira").value.trim()), bb = Boolean($("sBb").value.trim());
  $("sKey").closest(".field").hidden = !jira;
  $("sSpace").closest(".field").hidden = !jira;
  $("sPreview").hidden = !jira;
  $("sBbRepos").closest(".field").hidden = !bb;
  $("focusSrc").closest("section").hidden = !jira && !bb;
  updateSourceChecks();
}
["sJira", "sBb", "sBbRepos"].forEach(id => $(id).addEventListener("input", updateDependentFields));

// ---- Shortcuts: hidden – no options for them either; compact view has no shortcuts at all ----
function updateShortcutsSection() {
  $("shortcutsOptions").hidden = !$("sShortcuts").checked;
  $("sShortcuts").closest("section").hidden = $("sCompact").checked;
}
$("sShortcuts").addEventListener("change", updateShortcutsSection);
$("sCompact").addEventListener("change", updateShortcutsSection);

// ---- Board tab: with the board off, the tab is just its checkbox ----
function updateBoardTab() {
  document.querySelectorAll("#setDlg .board-only").forEach(el => { el.hidden = !$("sBoard").checked; });
}
$("sBoard").addEventListener("change", updateBoardTab);

// ---- Board tab: what gets into the Inbox column ----
// The notifications come from the Atlassian site: without its address there is nothing to set up
function updateInboxChecks() {
  const site = Boolean(cleanUrl($("sJira").value));
  $("sInbox").disabled = !site;
  $("inboxSrc").hidden = !site || !$("sInbox").checked;
  $("inboxNoSite").hidden = site;
}
$("sInbox").addEventListener("change", updateInboxChecks);
$("sJira").addEventListener("input", updateInboxChecks);

// ---- Atlassian settings transfer (JSON) ----
// Addresses, space, repositories and Quick search checkboxes – no name, email or shortcuts, so the file can be
// shared with a team. Export takes what the form shows; import fills the form and is applied by Save, like any edit

const atlassianMsg = (key, cls = "") => showMsg("sAtlMsg", t(key), cls);

// The Atlassian tab from saved settings or from an imported file
function fillAtlassianFields(a) {
  $("sJira").value = String(a.jiraUrl || "");
  $("sKey").value = String(a.projectKey || "");
  $("sSpace").value = String(a.confSpace || "");
  $("sBb").value = String(a.bbWorkspace || "");
  $("sBbRepos").value = Array.isArray(a.bbRepos) ? a.bbRepos.join(", ") : String(a.bbRepos || "");
  ["sJira", "sKey", "sSpace", "sBb", "sBbRepos"].forEach(id => setInvalid(id, false));
  fillSourceChecks({ focusSources: a.focusSources, sources: a.sources });
  updateDependentFields();
  previewTaskUrl();
}

$("sAtlExport").onclick = () => downloadJson({
  app: "jumpstart",
  kind: "atlassian",
  version: 1,
  atlassian: {
    jiraUrl: $("sJira").value.trim(),
    projectKey: $("sKey").value.trim().toUpperCase(),
    confSpace: $("sSpace").value.trim(),
    bbWorkspace: $("sBb").value.trim(),
    bbRepos: $("sBbRepos").value.split(/[\s,;]+/).filter(Boolean),
    focusSources: readSourceChecks("focusSrc"),
    sources: readSourceChecks("typeSrc"),
  },
}, "jumpstart-atlassian.json");

$("sAtlImport").onclick = () => $("sAtlFile").click();
$("sAtlFile").onchange = async e => {
  const data = await pickedJson(e);
  if (data === undefined) return;
  // our export, or just an object with the same fields
  const a = data?.atlassian || data;
  const fields = ["jiraUrl", "projectKey", "confSpace", "bbWorkspace", "bbRepos", "focusSources", "sources"];
  if (!a || typeof a !== "object" || !fields.some(f => f in a)) return atlassianMsg("transferBad", "bad");

  fillAtlassianFields(a);
  atlassianMsg("transferImported", "ok");
};

// ---- Open / fill / close ----

// Plain on/off settings: checkbox id → settings field. A new one needs just a line here and the checkbox in newtab.html
const CHECKBOXES = { sShortcuts: "shortcuts", sCompact: "compact", sBoard: "board", sBoardLock: "boardLock", sAiSearch: "aiSearch" };

const readCheckboxes = () => Object.fromEntries(Object.entries(CHECKBOXES).map(([id, key]) => [key, $(id).checked]));
const readInboxChecks = () =>
  ({ on: $("sInbox").checked, ...Object.fromEntries([...document.querySelectorAll("#inboxSrc input")].map(cb => [cb.dataset.name, cb.checked])) });

function fillSettings(s) {
  $("sName").value = s.name;
  $("sEmail").value = s.email;
  fillAtlassianFields(s);
  fillLangOptions(s.lang);
  fillVoiceOptions(s.voiceLang);
  pickBg(s.bg || "");

  Object.entries(CHECKBOXES).forEach(([id, key]) => { $(id).checked = Boolean(s[key] ?? DEFAULT_SETTINGS[key]); });
  const inbox = { ...DEFAULT_SETTINGS.inbox, ...(s.inbox || {}) };
  $("sInbox").checked = Boolean(inbox.on);
  document.querySelectorAll("#inboxSrc input").forEach(cb => { cb.checked = inbox[cb.dataset.name] !== false; });
  updateShortcutsSection();
  updateInboxChecks();
  updateBoardTab();

  $("sTopSites").disabled = false;
  $("sTopSites").textContent = t("shortcutsFromTop");
  linksMsg("shortcutsHint");
  atlassianMsg("transferHint");
  boardMsg(t("boardTransferHint"));
  setAvatar($("sAvatar"), DEFAULT_AVATAR);
  previewAvatar();
}

const setDialogTitle = () => {
  $("sTitle").textContent = t($("sWelcome").hidden ? "settings" : "welcomeTitle");
};

function openSettings(welcome = false) {
  fillSettings(settings);
  switchTab("general");
  $("sWelcome").hidden = !welcome;
  setDialogTitle();
  $("setDlg").showModal();
  // showModal focuses the first control itself – the welcome dialog shouldn't focus anything
  if (welcome) document.activeElement?.blur();
}

$("setBtn").onclick = () => openSettings();
$("sClose").onclick = $("sCancel").onclick = () => $("setDlg").close();
$("setDlg").addEventListener("close", () => {
  store.set("onboarded", true);
  // drop previews that weren't saved: background and language
  applyTheme(settings.bg);
  if (lang !== savedLang()) applySettings();
});

$("sReset").onclick = async () => {
  if (await confirmDialog(t("resetTitle"), t("resetText"), t("resetOk"))) fillSettings(DEFAULT_SETTINGS);
};

// ---- Save ----

$("setForm").onsubmit = async e => {
  e.preventDefault();

  // Jira/Confluence address and project key
  const rawJira = $("sJira").value.trim();
  const jiraUrl = rawJira ? cleanUrl(rawJira) : "";
  const projectKey = $("sKey").value.trim().toUpperCase();
  const keyOk = !projectKey || validKey(projectKey);
  setInvalid("sJira", jiraUrl === null);
  setInvalid("sKey", !keyOk);
  if (jiraUrl === null) return focusInvalid("sJira");
  if (!keyOk) return focusInvalid("sKey");

  // Bitbucket workspace: "my-team" or any link like bitbucket.org/my-team/…
  const rawBb = $("sBb").value.trim();
  const bbWorkspace = (rawBb.match(/bitbucket\.org\/([^/?#\s]+)/i)?.[1] || rawBb).replace(/^\/+|\/+$/g, "");
  const bbOk = !bbWorkspace || /^[\w.-]+$/.test(bbWorkspace);
  setInvalid("sBb", !bbOk);
  if (!bbOk) return focusInvalid("sBb");

  // Priority space: a key ("SLAM") or a link to any of its pages (…/wiki/spaces/SLAM/…)
  const rawSpace = $("sSpace").value.trim();
  const confSpace = rawSpace.match(/\/spaces\/([^/?#\s]+)/i)?.[1] || rawSpace;
  const spaceOk = !confSpace || /^~?[\w-]+$/.test(confSpace);
  setInvalid("sSpace", !spaceOk);
  if (!spaceOk) return focusInvalid("sSpace");

  // Repositories for PR search: comma- or space-separated, links allowed (bitbucket.org/<ws>/<repo>/…)
  const bbRepos = [...new Set($("sBbRepos").value.split(/[\s,;]+/).filter(Boolean)
    .map(r => r.match(/bitbucket\.org\/[^/?#\s]+\/([^/?#\s]+)/i)?.[1] || r))];
  const reposOk = bbRepos.length <= 5 && bbRepos.every(r => /^[\w.-]+$/.test(r));
  setInvalid("sBbRepos", !reposOk);
  if (!reposOk) return focusInvalid("sBbRepos");

  // The permission request must come straight from the click/Enter, before any await – one request for all sites
  const origins = [...(jiraUrl ? [new URL(jiraUrl).origin + "/*"] : []), ...(bbWorkspace ? [BITBUCKET + "/*"] : [])];
  if (origins.length) chrome.permissions.request({ origins }).catch(() => {});

  // cached results of the old services are no longer valid
  const reposChanged = bbRepos.join() !== (settings.bbRepos || []).join();
  if (bbWorkspace !== settings.bbWorkspace || confSpace !== settings.confSpace || reposChanged) searchCache.clear();
  if (jiraUrl !== settings.jiraUrl) {
    jiraCache.clear();
    searchCache.clear();
    jiraState = "unknown";
  }

  const pageLang = $("sLang").value;
  settings = {
    name: $("sName").value.trim(),
    email: $("sEmail").value.trim(),
    jiraUrl, projectKey, confSpace, bbWorkspace, bbRepos,
    lang: pageLang === "auto" ? "" : pageLang,
    voiceLang: $("sVoice").value,
    bg: draftBg,
    ...readCheckboxes(),
    inbox: readInboxChecks(),
    focusSources: readSourceChecks("focusSrc"),
    sources: readSourceChecks("typeSrc"),
  };
  await saveSettings();
  await applySettings();
  $("setDlg").close();
};
