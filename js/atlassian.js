// Atlassian APIs (Jira, Confluence, Bitbucket Cloud) on the browser session, protected from excessive load.
// Shared by the search box and the board.

// =====================================================================================
// Limits, caches and the request guard
// =====================================================================================

const CACHE_TTL = 2 * 60 * 1000;          // how long a task, PR or search result is reused
const HOURLY_LIMIT = 300;                 // request cap per hour for the whole extension
const DEFAULT_PAUSE = 5 * 60 * 1000;      // pause after 429 when the service sends no Retry-After
const SEARCH_MIN = 3;                     // characters before text search starts
const JIRA_SEARCH_LIMIT = 100;            // the most Jira returns in one request with fields
const OTHER_SEARCH_LIMIT = 10;            // Confluence pages, Bitbucket repositories
const PR_LIMIT = 5;                       // pull requests per repository
const PR_LOOKUP_LIMIT = 20;               // pull requests from history whose title/status is loaded at once

const jiraCache = new Map();              // task key -> { ts, v: { summary, status, cat, assignee } | null }
const prCache = new Map();                // "ws/repo/id" -> { ts, v: { title, state, author } | null }
const searchCache = new Map();            // "<kind>:<query>" -> { ts, result }
let jiraState = "unknown";                // unknown | ok | noperm | auth
let apiGuard = { hour: 0, count: 0, pauseUntil: 0 }; // shared by all tabs via chrome.storage.session
let jiraSearchCtrl = null, otherSearchCtrl = null;

const jiraPerm = () => ({ origins: [jiraApiOrigin() + "/*"] });
const hasBitbucketAccess = () => chrome.permissions.contains({ origins: [BITBUCKET + "/*"] });
const cleanTerms = q => q.replace(/["\\]/g, " ").trim();
const fresh = entry => entry?.ts > Date.now() - CACHE_TTL;
const saveToSession = (key, map) => chrome.storage.session.set({ [key]: Object.fromEntries(map) }).catch(() => {});

// GET with the shared hourly limit and the pause after 429.
// path – a path on the Atlassian site (Jira, Confluence) or a full URL (Bitbucket).
// Returns null when nothing was sent: the service asked to wait or the hourly limit is used up
async function apiFetch(path, signal, init = {}) {
  const now = Date.now(), hour = Math.floor(now / 3600000);
  if (now < apiGuard.pauseUntil) return null;
  if (apiGuard.hour !== hour) apiGuard = { ...apiGuard, hour, count: 0 };
  if (apiGuard.count >= HOURLY_LIMIT) return null;
  apiGuard = { ...apiGuard, count: apiGuard.count + 1 };
  chrome.storage.session.set({ apiGuard }).catch(() => {});

  const target = /^https:\/\//.test(path) ? path : jiraApiOrigin() + path;
  const r = await fetch(target, { ...init, credentials: "include", headers: { Accept: "application/json", ...init.headers }, signal });
  if (r.status === 429) {
    const retry = Number(r.headers.get("Retry-After"));
    apiGuard = { ...apiGuard, pauseUntil: Date.now() + (retry > 0 ? retry * 1000 : DEFAULT_PAUSE) };
    chrome.storage.session.set({ apiGuard }).catch(() => {});
    return null;
  }
  return r;
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.apiGuard?.newValue) apiGuard = changes.apiGuard.newValue;
});

// Caches and the request guard survive new tabs (chrome.storage.session lives until the browser closes);
// restored before the first render, so the page shows statuses and summaries right away without a blink
async function restoreSessionCaches() {
  try {
    const session = await chrome.storage.session.get(["jiraCache", "prCache", "apiGuard"]);
    Object.entries(session.jiraCache || {}).forEach(([k, entry]) => jiraCache.set(k, entry));
    Object.entries(session.prCache || {}).forEach(([k, entry]) => prCache.set(k, entry));
    if (session.apiGuard) apiGuard = session.apiGuard;
  } catch {}
}

// Cached search: load() returns a list, or null when nothing was sent (no access, limit) – such results aren't cached
async function cachedSearch(cacheKey, load) {
  const hit = searchCache.get(cacheKey);
  if (fresh(hit)) return hit.result;
  try {
    const result = await load();
    if (result) searchCache.set(cacheKey, { ts: Date.now(), result });
    return result || [];
  } catch {
    return []; // aborted by new input, or network
  }
}

// ---- Jira ---------------------------------------------------------------------------

// One sign-in check for everybody: Jira and Confluence search in parallel and wait for a single /myself
let readyCheck = null;
async function jiraReady() {
  if (!hasJira()) return false;
  if (!(await chrome.permissions.contains(jiraPerm()))) { jiraState = "noperm"; return false; }
  if (jiraState === "ok") return true;
  readyCheck ??= (async () => {
    const me = await apiFetch("/rest/api/3/myself").catch(() => undefined);
    if (me === null) return false;
    if (!me?.ok) { jiraState = "auth"; return false; }
    jiraState = "ok";
    return true;
  })().finally(() => { readyCheck = null; });
  return readyCheck;
}

// Why jiraReady() said no, for the messages with a button that helps: noperm | auth | limit
const accessError = () => (jiraState === "noperm" || jiraState === "auth" ? jiraState : "limit");

const toIssue = f => ({ summary: f.summary, status: f.status?.name, cat: f.status?.statusCategory?.key, assignee: f.assignee?.displayName });
const issueOf = key => (key ? jiraCache.get(key)?.v : null);

// Statuses of the visible tasks, at most 6 requests at a time (history can show up to 50 tasks)
async function jiraLookup(keys) {
  const now = Date.now();
  const missing = keys.filter(k => !fresh(jiraCache.get(k)));
  if (!missing.length || !(await jiraReady())) return;
  const queue = [...missing];
  const worker = async () => {
    for (let k; (k = queue.shift()) && jiraState === "ok";) {
      try {
        const r = await apiFetch(`/rest/api/3/issue/${encodeURIComponent(k)}?fields=summary,status,assignee`);
        if (r === null) return;
        if (r.status === 401) { jiraState = "auth"; return; }
        // a failed answer keeps what we knew; only "no such task" (404) clears it
        const v = r.ok ? toIssue((await r.json()).fields) : r.status === 404 ? null : jiraCache.get(k)?.v ?? null;
        jiraCache.set(k, { ts: now, v });
      } catch {}
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  saveToSession("jiraCache", jiraCache);
}

// Text (or raw JQL) search: one request returns both the tasks and their statuses.
// Result: { keys, more } – more means Jira found more than fits into one response
const NOTHING_FOUND = { keys: [], more: false };
async function jiraSearch(q, rawJql = false) {
  const cacheKey = (rawJql ? "jql:" : "") + q.toLowerCase();
  const hit = searchCache.get(cacheKey);
  if (fresh(hit)) return hit.result;
  if (!(await jiraReady())) return NOTHING_FOUND;
  const terms = cleanTerms(q);
  if (!terms) return NOTHING_FOUND;

  const jql = rawJql ? q : `text ~ "${terms}*" ORDER BY lastViewed DESC`;
  jiraSearchCtrl?.abort();
  jiraSearchCtrl = new AbortController();
  try {
    const r = await apiFetch(`/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}` +
      `&fields=summary,status,assignee&maxResults=${JIRA_SEARCH_LIMIT}`, jiraSearchCtrl.signal);
    if (r === null) return NOTHING_FOUND;
    if (r.status === 401) { jiraState = "auth"; return NOTHING_FOUND; }
    const result = { keys: [], more: false };
    if (r.ok) {
      const data = await r.json(), now = Date.now();
      for (const issue of data.issues || []) {
        jiraCache.set(issue.key, { ts: now, v: toIssue(issue.fields) });
        result.keys.push(issue.key);
      }
      result.more = Boolean(data.nextPageToken) || data.isLast === false;
      saveToSession("jiraCache", jiraCache);
    }
    // 400 – Jira couldn't parse the text as JQL: the empty result is cached so it isn't retried
    searchCache.set(cacheKey, { ts: Date.now(), result });
    return result;
  } catch {
    return NOTHING_FOUND; // aborted by new input, or network
  }
}

// Tasks assigned to me, newest first; one request, cached like other searches.
// Returns the keys, or null; myTasksError says why: noperm | auth | limit | http <status> | network
let myTasksError = "";

async function myTasks() {
  const hit = searchCache.get("mine");
  if (fresh(hit)) return hit.result;
  myTasksError = "";
  if (!(await jiraReady())) {
    myTasksError = accessError();
    return null;
  }
  const jql = "assignee = currentUser() ORDER BY updated DESC";
  let r;
  try {
    r = await apiFetch(`/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=summary,status,assignee&maxResults=100`);
  } catch (e) {
    console.warn("Jumpstart: my Jira tasks", e);
    myTasksError = "network";
    return null;
  }
  if (r === null) { myTasksError = "limit"; return null; }
  if (r.status === 401) { jiraState = "auth"; myTasksError = "auth"; return null; }
  if (!r.ok) {
    console.warn("Jumpstart: my Jira tasks", r.status, await r.text().catch(() => ""));
    myTasksError = "http " + r.status;
    return null;
  }
  const data = await r.json(), now = Date.now();
  const keys = (data.issues || []).map(issue => {
    jiraCache.set(issue.key, { ts: now, v: toIssue(issue.fields) });
    return issue.key;
  });
  saveToSession("jiraCache", jiraCache);
  searchCache.set("mine", { ts: now, result: keys });
  return keys;
}

// ---- Confluence (same Atlassian site as Jira) ---------------------------------------

// Pages and blog posts via CQL siteSearch – the same search as in Confluence itself
function confluenceQuery(q, spaceKey, signal) {
  const space = spaceKey ? ` and space = "${spaceKey}"` : "";
  return confluenceCql(`siteSearch ~ "${cleanTerms(q)}" and type in (page, blogpost)${space}`, signal, Boolean(spaceKey));
}

// A ready CQL query (also the user's own, typed after "cql:"): the found pages as dropdown items.
// null – nothing was sent (limit); [] – Confluence didn't accept the query
async function confluenceCql(cql, signal, priority = false) {
  const r = await apiFetch(`/wiki/rest/api/search?cql=${encodeURIComponent(cql)}&limit=${OTHER_SEARCH_LIMIT}`, signal);
  if (!r) return null;
  if (!r.ok) return [];
  const base = jiraApiOrigin() + "/wiki";
  return ((await r.json()).results || []).filter(x => x.url).map(x => {
    const url = base + x.url;
    return {
      conf: true,
      pageRef: confPageRefOf(url),
      url,
      text: String(x.title || "").replace(/@@@(end)?hl@@@/g, ""), // Confluence marks matches as @@@hl@@@…@@@endhl@@@
      hint: x.resultGlobalContainer?.title || "Confluence",
      priority,
      run: () => go("newtab", url),
    };
  });
}

// Raw CQL search for the "cql:" mode, cached like other searches
function confluenceCqlSearch(cql, signal) {
  return cachedSearch(`cql:${cql.toLowerCase()}`, async () => ((await jiraReady()) ? confluenceCql(cql, signal) : null));
}

// With a priority space, one more query runs only in that space, so its pages are never pushed out by others
function confluenceSearch(q, signal) {
  const space = settings.confSpace;
  return cachedSearch(`conf:${space}:${q.toLowerCase()}`, async () => {
    if (!(await jiraReady())) return null;
    const [own, all] = await Promise.all([
      space ? confluenceQuery(q, space, signal) : [],
      confluenceQuery(q, "", signal),
    ]);
    if (own === null || all === null) return null;
    const ownUrls = new Set(own.map(x => x.url));
    return [...own, ...all.filter(x => !ownUrls.has(x.url))];
  });
}

// ---- Bitbucket Cloud (internal bitbucket.org/!api on the browser session, like the site itself) ----

// Repositories by name
function repositorySearch(q, signal) {
  if (!hasBitbucket()) return Promise.resolve([]);
  return cachedSearch(`bb:${settings.bbWorkspace}:${q.toLowerCase()}`, async () => {
    if (!(await hasBitbucketAccess())) return null;
    const ws = encodeURIComponent(settings.bbWorkspace);
    const query = encodeURIComponent(`name ~ "${cleanTerms(q)}"`);
    const r = await apiFetch(`${BITBUCKET}/!api/2.0/repositories/${ws}?q=${query}&sort=-updated_on` +
      `&pagelen=${OTHER_SEARCH_LIMIT}&fields=values.name,values.full_name,values.links.html.href`, signal);
    if (!r) return null;
    if (!r.ok) return [];
    return ((await r.json()).values || []).filter(v => v.links?.html?.href).map(v => {
      const url = v.links.html.href;
      return { bb: true, url, text: v.name, hint: "Bitbucket · " + v.full_name, run: () => go("newtab", url) };
    });
  });
}

// Pull requests: the API has no workspace-wide search, so each configured repository is queried.
// Matches the title or the branch name; open and merged; newest first
function pullRequestSearch(term, signal) {
  const repos = prRepos();
  return cachedSearch(`pr:${settings.bbWorkspace}:${repos.join(",")}:${term.toLowerCase()}`, async () => {
    if (!(await hasBitbucketAccess())) return null;
    const ws = encodeURIComponent(settings.bbWorkspace), terms = cleanTerms(term);
    const query = encodeURIComponent(
      `(title ~ "${terms}" OR source.branch.name ~ "${terms}") AND (state = "OPEN" OR state = "MERGED")`);
    const fields = "values.id,values.title,values.state,values.author.display_name,values.links.html.href";
    const lists = await Promise.all(repos.map(async repo => {
      const r = await apiFetch(`${BITBUCKET}/!api/2.0/repositories/${ws}/${encodeURIComponent(repo)}/pullrequests` +
        `?q=${query}&sort=-updated_on&pagelen=${PR_LIMIT}&fields=${fields}`, signal);
      if (!r) return null;
      if (!r.ok) return [];
      return ((await r.json()).values || []).filter(v => v.links?.html?.href).map(v => {
        const url = v.links.html.href;
        const author = v.author?.display_name || repo;
        return {
          bb: true, pr: true, prRef: prRefOf(url), url, text: v.title, prState: v.state,
          hint: `#${v.id} · ${author}${repos.length > 1 ? " · " + repo : ""}`,
          run: () => go("newtab", url),
        };
      });
    }));
    return lists.some(list => list === null) ? null : lists.flat();
  });
}

// Title, status and author of pull requests seen in history
const prOf = ref => (ref ? prCache.get(ref)?.v : null);
async function prLookup(refs) {
  const now = Date.now();
  const missing = refs.filter(ref => !fresh(prCache.get(ref))).slice(0, PR_LOOKUP_LIMIT);
  if (!missing.length || !(await hasBitbucketAccess())) return;
  await Promise.all(missing.map(async ref => {
    const [ws, repo, id] = ref.split("/");
    try {
      const r = await apiFetch(`${BITBUCKET}/!api/2.0/repositories/${ws}/${repo}/pullrequests/${id}?fields=title,state,author.display_name`);
      if (!r) return;
      const d = r.ok ? await r.json() : null;
      prCache.set(ref, { ts: now, v: d && { title: d.title, state: d.state, author: d.author?.display_name } });
    } catch {}
  }));
  saveToSession("prCache", prCache);
}

// ---- Atlassian GraphQL gateway (the notifications of the bell) ----------------------

// The gateway turns away POSTs from another origin (403, a CSRF guard). For the extension's own requests
// to it – and only those – the Origin header is set to the Atlassian site, like the bell's own requests.
// A session rule: it lives until the browser closes and is set again before each request with the current address
const GATEWAY_RULE_ID = 1;

async function allowGatewayOrigin() {
  const origin = jiraApiOrigin();
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [GATEWAY_RULE_ID],
    addRules: [{
      id: GATEWAY_RULE_ID,
      priority: 1,
      action: { type: "modifyHeaders", requestHeaders: [{ header: "origin", operation: "set", value: origin }] },
      condition: { urlFilter: `|${origin}/gateway/api/graphql`, initiatorDomains: [chrome.runtime.id], resourceTypes: ["xmlhttprequest"] },
    }],
  });
}

// A query or a mutation; the response as apiFetch returns it (null – nothing was sent)
async function gatewayFetch(operationName, query, variables) {
  await allowGatewayOrigin().catch(e => console.warn("Jumpstart: gateway origin rule", e));
  return apiFetch("/gateway/api/graphql", undefined, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operationName, query, variables }),
  });
}
