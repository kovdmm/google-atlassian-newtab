// Search box: Google search (AI Mode by default) with Jira, Confluence and Bitbucket results
// and browser history suggestions in one dropdown.

// =====================================================================================
// Search targets
// =====================================================================================

// "jql: summary ~ "Bridger"" – everything after the prefix goes to Jira as is
const jqlOf = q => q.match(/^jql:\s*(.*)$/is)?.[1].trim() ?? null;

// Highlight the matched part (bold, like Chrome)
function hl(text, q) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return esc(text);
  return esc(text.slice(0, i)) + "<mark>" + esc(text.slice(i, i + q.length)) + "</mark>" + esc(text.slice(i + q.length));
}

// Tasks and found Atlassian pages open in a new tab, searches – in this one
function go(kind, value) {
  if (kind === "task") {
    openUrl(urls.task(value));
    $("q").value = "";
    closeDropdown();
  } else if (kind === "open") {
    location.href = value;
  } else if (kind === "newtab") {
    openUrl(value);
  } else {
    location.href = urls[kind](value);
  }
}

// =====================================================================================
// Browser history (chrome.history)
// =====================================================================================

const HISTORY_LIMIT = 50; // history rows in the dropdown (it scrolls), for the empty box and while typing

// Kind of a history entry; each kind is switched on/off in History Quick Search
function historyKind(url) {
  if (hasJira() && url.startsWith(jiraBase())) return "jira";
  if (isConfluenceUrl(url)) return "confluence";
  if (hasBitbucket() && url.startsWith(BITBUCKET + "/")) return "bitbucket";
  if (googleQueryOf(url)) return "google";
  return "sites";
}

function taskItem(h, key) {
  return {
    hist: true, task: true, key: isTaskKey(key) ? key : null, text: h.title || h.url, url: h.url, hint: key,
    run: () => openUrl(h.url),
  };
}

// Any other page: Confluence page, pull request, repository or just a site.
// Bitbucket names every PR tab "Pull Request — Repo — Bitbucket", so the real title comes from the API later
function pageItem(h, kind) {
  const pr = prRefOf(h.url);
  return {
    hist: true,
    conf: kind === "confluence",
    bb: kind === "bitbucket" || Boolean(pr),
    pr: Boolean(pr),
    prRef: pr,
    pageRef: confPageRefOf(h.url),
    url: h.url,
    text: pr ? `#${pr.split("/")[2]} · ${pr.split("/")[1]}` : h.title || h.url,
    hint: new URL(h.url).hostname,
    run: () => go("open", h.url),
  };
}

// One row per thing, however many times and under whatever links it was visited:
// a task, a pull request, a Confluence page, a Google query, a page of a site
function historyId(url, kind) {
  if (kind === "jira") return url.slice(jiraBase().length).split(/[/?#]/)[0];
  if (kind === "google") return "q:" + googleQueryOf(url).text.trim().toLowerCase();
  const pr = prRefOf(url), page = confPageRefOf(url);
  return pr ? "pr:" + pr : page ? "conf:" + page : canonicalUrl(url);
}

function historyItem(h, kind, id) {
  if (kind === "jira") return taskItem(h, id);
  if (kind === "google") {
    const query = googleQueryOf(h.url);
    return { hist: true, url: h.url, text: query.text, hint: query.ai ? t("aiMode") : "Google", run: () => go("open", h.url) };
  }
  return pageItem(h, kind);
}

// Empty box (q = ""): latest entries by time, filtered by History Quick Search.
// While typing: entries matching the text; for a task key – only that task's pages
async function browserHistory(q, key) {
  // plenty of raw entries: after removing duplicates there should still be enough for a long list
  const found = await chrome.history.search({ text: key || q, maxResults: 2000, startTime: 0 });
  const seenIds = new Set(), seenTitles = new Set(), out = [];
  for (const h of found) {
    if (!/^https?:/i.test(h.url)) continue;
    const kind = historyKind(h.url);
    if (key ? kind !== "jira" : !q && !focusSource(kind)) continue;

    const id = historyId(h.url, kind);
    // different addresses of a site with the same title are the same page for the user;
    // not for tasks, queries and pull requests – Bitbucket gives every PR tab the same title
    const titleId = kind === "sites" || (kind === "bitbucket" && !prRefOf(h.url))
      ? `${new URL(h.url).host}|${(h.title || "").trim().toLowerCase()}`
      : null;
    if (seenIds.has(id) || (titleId && h.title && seenTitles.has(titleId))) continue;
    seenIds.add(id);
    if (titleId && h.title) seenTitles.add(titleId);

    out.push(historyItem(h, kind, id));
    if (out.length >= HISTORY_LIMIT) break;
  }
  return out;
}

// =====================================================================================
// Dropdown model
// =====================================================================================

// The dropdown is assembled from parts that arrive asynchronously:
// actions – immediately, browser history – a moment later, Atlassian results and statuses – after a short pause
let items = [], active = 0, token = 0;
let view = { q: "", acts: [], hist: [], jira: [], other: [], notice: null };
let lookupTimer = null, searchTimer = null;

// How well an item matches: task key > title starts with the query > a word starts with it > somewhere inside > other
// ("other" – e.g. Jira found the word in a description, or history matched the URL)
function relevance(it, q) {
  if (!q) return 0;
  const ql = q.toLowerCase(), issue = issueOf(it.key), pr = prOf(it.prRef), key = (it.key || "").toLowerCase();
  // compare with the title itself: no task key and no "[SF-123] " prefix from a Jira tab title
  const text = (issue ? issue.summary : pr ? pr.title : (it.text || "").replace(/^\[[A-Z][A-Z0-9]+-\d+\]\s*/, "")).toLowerCase();
  if (key && (key === ql || key.endsWith("-" + ql))) return 5;
  if (text.startsWith(ql)) return 4;
  if (new RegExp(`(^|[^\\p{L}\\p{N}])${escRe(ql)}`, "u").test(text)) return 3;
  if (text.includes(ql)) return 2;
  return 1;
}

// Jira, Confluence, Bitbucket and history – one list by relevance, without duplicates.
// seen – ids already shown above (e.g. the typed task key)
function mergeResults(q, lists, seen) {
  const scored = [];
  lists.forEach(list => list.forEach((it, idx) => {
    if (it.jiraMore) return;
    // a task, PR or Confluence page found by search and also in history is shown once
    const id = it.key || it.prRef || it.pageRef || it.url || it.text;
    if (seen.has(id)) return;
    seen.add(id);
    // the priority Confluence space is one step higher; equal relevance keeps the source order
    scored.push({ it, score: (relevance(it, q) + (it.priority ? 1 : 0)) * 1000 - idx });
  }));
  return scored.sort((a, b) => b.score - a.score).map(x => x.it);
}

function compose() {
  const current = items[active];
  const { q, acts, hist, jira, other, notice } = view;
  const jiraAct = acts.find(a => a.jiraAct);
  const rest = acts.filter(a => a !== jiraAct);
  const more = jira.find(it => it.jiraMore);
  items = [
    ...rest.slice(0, 1),                  // main action: AI Mode / open task / open site
    ...(jiraAct ? [jiraAct] : []),        // "search in Jira" – always second
    ...(notice ? [notice] : []),          // right below, not hidden behind scrolling
    ...mergeResults(q, [jira, other, hist], new Set(acts.map(a => a.key).filter(Boolean))),
    ...(more ? [more] : []),
    ...rest.slice(1),
  ];
  // keep the selection on the same item even if something was added above it
  const i = items.indexOf(current);
  active = i >= 0 ? i : 0;
  render(q);
}

async function build() {
  const q = $("q").value.trim(), key = q ? taskKeyOf(q) : null, my = ++token;
  clearTimeout(lookupTimer);
  clearTimeout(searchTimer);
  jiraSearchCtrl?.abort();
  otherSearchCtrl?.abort();

  const jql = hasJira() ? jqlOf(q) : null;
  if (jql !== null) return buildJql(jql, my);

  // actions
  const url = !key && looksLikeUrl(q);
  const acts = [];
  if (url) acts.push({ text: q, hint: t("openSite"), icon: "link", run: () => go("open", withScheme(q)) });
  if (key) acts.push({ key, text: key, hint: t("openTask"), icon: "task", run: () => go("task", key) });
  if (q) {
    acts.push({ text: q, hint: t("aiMode"), icon: "spark", run: () => go("ai", q) });
    if (hasJira()) {
      acts.push({ text: q, hint: t("jiraSearch"), jiraAct: true, run: () => go("jira", q) });
      acts.push({ text: q, hint: t("confluenceSearch"), icon: "conf", run: () => go("confluence", q) });
    }
    if (hasBitbucket()) acts.push({ text: q, hint: t("bitbucketSearch"), icon: "bb", run: () => go("bitbucket", q) });
    acts.push({ text: q, hint: t("googleSearch"), run: () => go("google", q) });
  }
  items = [];
  active = 0;
  view = { q, acts, hist: [], jira: [], other: [], notice: null };
  compose();

  // empty box – History Quick Search; while typing – browser history if it is on in Autocomplete Quick Search
  if (!q || typingSource("history")) {
    try { view.hist = await browserHistory(q, key); } catch {}
  }
  if (my !== token) return;
  compose();

  // statuses of tasks from history and of the typed key; title and status of pull requests from history
  const keys = [...new Set([...acts, ...view.hist].map(it => it.key).filter(Boolean))];
  const prRefs = [...new Set(view.hist.map(it => it.prRef).filter(Boolean))];
  if (keys.length || prRefs.length) {
    lookupTimer = setTimeout(async () => {
      await Promise.all([keys.length ? jiraLookup(keys) : null, prRefs.length ? prLookup(prRefs) : null]);
      if (my !== token) return;
      view.notice = q ? jiraNotice() : null; // the empty box shows only history, no service rows
      compose();
    }, 200);
  }

  // Text search in Jira, Confluence and Bitbucket – from 3 characters, after a pause, in parallel.
  // Pull requests are also searched by a task key: it is usually in the PR title or branch name
  const text = q.length >= SEARCH_MIN && !key && !url;
  const wantJira = text && hasJira() && typingSource("jira");
  const wantConf = text && hasJira() && typingSource("confluence");
  const wantBb = text && hasBitbucket() && typingSource("bitbucket");
  const wantPrs = (text || Boolean(key)) && prRepos().length > 0 && typingSource("prs");
  if (!(wantJira || wantConf || wantBb || wantPrs)) return;

  searchTimer = setTimeout(async () => {
    otherSearchCtrl = new AbortController();
    const signal = otherSearchCtrl.signal;
    const [found, conf, repos, prs] = await Promise.all([
      wantJira ? jiraSearch(q) : NOTHING_FOUND,
      wantConf ? confluenceSearch(q, signal) : [],
      wantBb ? repositorySearch(q, signal) : [],
      wantPrs ? pullRequestSearch(key || q, signal) : [],
    ]);
    if (my !== token) return;
    view.jira = jiraItems(found, () => go("jira", q));
    view.other = [...conf, ...repos, ...prs];
    view.notice = wantJira || wantConf ? jiraNotice() : null;
    compose();
  }, 300);
}

// "jql:" mode – Enter opens the query in Jira, found tasks are listed below.
// Longer pause: JQL takes longer to type and Jira can't parse it half-written anyway
function buildJql(jql, my) {
  items = [];
  active = 0;
  const acts = jql ? [{ text: jql, hint: t("openJql"), icon: "task", run: () => go("jql", jql) }] : [];
  view = { q: "", acts, hist: [], jira: [], other: [], notice: null };
  compose();
  if (jql.length < SEARCH_MIN) return;
  searchTimer = setTimeout(async () => {
    const found = await jiraSearch(jql, true);
    if (my !== token) return;
    view.jira = jiraItems(found, () => go("jql", jql));
    view.notice = jiraNotice();
    compose();
  }, 600);
}

// Found tasks + "Show all in Jira" when not everything fit into one response
const jiraItems = ({ keys, more }, openAll) => [
  ...keys.map(k => ({ key: k, jira: true, text: k, run: () => go("task", k) })),
  ...(more ? [{ text: t("showAllInJira"), icon: "search", jiraMore: true, run: openAll }] : []),
];

// Service row when Jira can't be reached: access not granted yet, or not signed in
function jiraNotice() {
  if (jiraState === "noperm") {
    return { notice: true, icon: "task", text: t("jiraAllow"), hint: t("jiraAllowHint"),
      run: () => chrome.permissions.request(jiraPerm()).then(ok => ok && build()) };
  }
  if (jiraState === "auth") {
    return { notice: true, icon: "task", text: t("jiraLogin"), hint: new URL(settings.jiraUrl).host,
      run: () => openUrl(jiraOrigin()) };
  }
  return null;
}

// =====================================================================================
// Dropdown rendering
// =====================================================================================

// Atlassian sources use brand colors so it's clear where a result comes from
const ICONS = {
  task: '<svg width="20" height="20" viewBox="0 0 24 24" fill="#1868db"><path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1s-2.4.84-2.82 2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-7 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm-2 14l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg>',
  conf: '<svg width="20" height="20" viewBox="0 0 24 24" fill="#1868db"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>',
  bb: '<svg width="20" height="20" viewBox="0 0 24 24" fill="#2684ff"><path d="M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/></svg>',
  pr: '<svg width="20" height="20" viewBox="0 0 24 24" fill="#2684ff"><path d="M6 3a3 3 0 0 0-1 5.83v6.34A3 3 0 1 0 7 15.17V8.83A3 3 0 0 0 6 3zm0 2a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm0 12a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm12-1.83V9a4 4 0 0 0-4-4h-1.17l1.58-1.59L13 2 9 6l4 4 1.41-1.41L12.83 7H14a2 2 0 0 1 2 2v6.17A3 3 0 1 0 18 15.17zM17 19a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/></svg>',
  clock: '<svg width="20" height="20" viewBox="0 0 24 24" fill="#5f6368"><path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.25 2.52.77-1.28-3.52-2.09V8z"/></svg>',
  search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="#5f6368"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14"/></svg>',
  spark: '<svg width="20" height="20" viewBox="0 0 24 24" fill="#5f6368"><path d="M12 2l2.2 6.3L20.5 10.5l-6.3 2.2L12 19l-2.2-6.3L3.5 10.5l6.3-2.2z"/></svg>',
  link: '<svg width="20" height="20" viewBox="0 0 24 24" fill="#5f6368"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95a15.65 15.65 0 0 0-1.38-3.56A8.03 8.03 0 0 1 18.92 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2s.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56A7.987 7.987 0 0 1 5.08 16zm2.95-8H5.08a7.987 7.987 0 0 1 4.33-3.56A15.65 15.65 0 0 0 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2s.07-1.35.16-2h4.68c.09.65.16 1.32.16 2s-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 0 1-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2s-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z"/></svg>',
};

function iconOf(it) {
  if (it.conf) return "conf";
  if (it.pr) return "pr";
  if (it.bb) return "bb";
  if (it.hist) return it.task ? "task" : "clock";
  if (it.jira) return "task";
  return it.icon || "search";
}

function render(q) {
  const html = items.map((it, i) => {
    // real task / PR data replaces the placeholder text once it has been loaded
    const issue = issueOf(it.key), pr = prOf(it.prRef);
    const text = issue ? `${it.key} ${issue.summary}` : pr ? pr.title : it.text;
    const hint = issue ? issue.assignee || t("unassigned")
      : pr ? `#${it.prRef.split("/")[2]} · ${pr.author || it.prRef.split("/")[1]}`
      : it.hint;
    const prState = pr?.state || it.prState;
    const badge = issueBadge(issue) || prBadge(prState);
    const highlighted = it.hist || it.key || it.conf || it.bb ? hl(text, q) : esc(text);
    const sub = hint ? `<span class="s"> – ${esc(hint)}</span>` : "";
    const cls = "it" + (i === active ? " active" : "") + (it.notice ? " notice" : "");
    return `<div class="${cls}" data-i="${i}"><span class="ico">${ICONS[iconOf(it)]}</span>` +
      `<span class="t">${highlighted}${sub}</span>${badge}</div>`;
  }).join("");
  $("dd").innerHTML = html;
  $("dd").classList.toggle("open", Boolean(html));
  $("smart").classList.toggle("open", Boolean(html));
}

function closeDropdown() {
  token++; // drops results that are still on the way
  $("dd").classList.remove("open");
  $("smart").classList.remove("open");
}

function markActive() {
  document.querySelectorAll(".dd .it").forEach((el, i) => {
    el.classList.toggle("active", i === active);
    if (i === active) el.scrollIntoView({ block: "nearest" });
  });
}

// =====================================================================================
// Search box events
// =====================================================================================

$("q").addEventListener("input", build);
$("q").addEventListener("focus", build);
$("q").addEventListener("keydown", e => {
  const q = $("q").value.trim();
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!$("dd").classList.contains("open")) return build();
    active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    markActive();
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (e.altKey && q) return go("google", q);
    if (e.ctrlKey && q && hasJira()) return jqlOf(q) ? go("jql", jqlOf(q)) : go("jira", q);
    items[active]?.run();
  } else if (e.key === "Escape") {
    closeDropdown();
  }
});
$("dd").addEventListener("mousedown", e => {
  e.preventDefault(); // keep focus in the search box
  const el = e.target.closest(".it");
  if (el) items[+el.dataset.i].run();
});
document.addEventListener("click", e => {
  if (!$("smart").contains(e.target)) closeDropdown();
});

$("lensBtn").onclick = () => { location.href = "https://lens.google.com/"; };

// Voice search: language from the settings (Chrome's UI language by default).
// While listening the mic is red and recognized text appears in the box; a second click stops it
let listening = null;
$("micBtn").onclick = () => {
  if (listening) return listening.stop();
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;
  const rec = new SpeechRecognition();
  rec.lang = settings.voiceLang || navigator.language;
  rec.interimResults = true;
  rec.onresult = e => {
    const result = e.results[e.results.length - 1];
    $("q").value = result[0].transcript;
    if (result.isFinal) go("ai", $("q").value.trim());
  };
  rec.onend = rec.onerror = () => {
    listening = null;
    $("micBtn").classList.remove("listening");
  };
  try {
    rec.start();
    listening = rec;
    $("micBtn").classList.add("listening");
  } catch {}
};
