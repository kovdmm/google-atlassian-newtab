// node tests/all-data.cjs – settings → Data: export everything from one copy of the extension, import it into an empty one
const { chromium, EXT, OUT } = require("./pw.cjs");
const path = require("path"), fs = require("fs");
const dir = process.argv[2] || EXT;

// chrome.* and fetch stubs; the storage lives in window.name, so it survives the reload after an import
function stubs(initial) {
  const mem = window.name ? JSON.parse(window.name) : initial;
  const keep = () => { window.name = JSON.stringify(mem); };
  keep();
  window.__mem = mem;
  const local = {
    get: async k => k === null ? JSON.parse(JSON.stringify(mem)) : Array.isArray(k) ? Object.fromEntries(k.map(x => [x, mem[x]])) : ({ [k]: mem[k] }),
    set: async o => { Object.assign(mem, o); keep(); },
    clear: async () => { Object.keys(mem).forEach(k => delete mem[k]); keep(); },
  };
  const session = { get: async () => ({}), set: async () => {} };
  window.chrome = { runtime: { id: "x" }, i18n: { getUILanguage: () => "en" }, storage: { local, session, onChanged: { addListener() {} } },
    history: { search: async () => [] }, topSites: { get: async () => [] }, permissions: { contains: async () => true, request: async () => true },
    declarativeNetRequest: { updateSessionRules: async () => {} }, tabs: { create() {} } };
  window.fetch = async url => {
    const u = new URL(url);
    if (u.pathname.endsWith("/graphql")) return new Response(JSON.stringify({ data: { notifications: { notificationFeed: { nodes: [] } } } }));
    if (u.pathname.includes("/search/jql")) return new Response(JSON.stringify({ issues: [], isLast: true }));
    return new Response(JSON.stringify({ key: "SF-1", fields: { summary: "One", status: { name: "To Do", statusCategory: { key: "new" } } } }));
  };
}

const FULL = {
  onboarded: true,
  links: [{ name: "Mail", url: "https://mail.example.com/" }, { name: "Docs", url: "https://docs.example.com/" }],
  settings: { name: "", email: "", jiraUrl: "https://example.atlassian.net", projectKey: "SF", lang: "en", bg: "#3c3c3c",
    shortcuts: false, compact: true, board: true, boardLock: true,
    inbox: { on: true, mentions: false, jira: true, confluence: true, views: false, bitbucket: false, unread: true },
    focusSources: { jira: true, confluence: false, bitbucket: true, google: false, sites: true },
    sources: { jira: true, confluence: true, bitbucket: false, prs: false, history: true } },
  board: { expanded: false, columns: [{ id: "a", name: "To do", type: "todo", cards: [
    { key: "SF-1", summary: "One", text: "Ask about it", links: [{ title: "Page", url: "https://example.com/p" }], due: "2026-11-05" },
    { id: "own-1", text: "A note", links: [{ key: "SF-2" }] },
  ] }] },
  inboxHidden: ["n1", "n2"],
};

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const url = require("url").pathToFileURL(path.join(dir, "newtab.html")).href;
  const open = async initial => {
    const p = await (await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 1000 } })).newPage();
    p.errors = []; p.on("pageerror", e => p.errors.push(e.message));
    await p.addInitScript(stubs, initial);
    await p.goto(url); await p.waitForTimeout(600);
    return p;
  };
  const r = {};

  // the full copy: export
  const a = await open(FULL);
  await a.click("#setBtn"); await a.click('#setDlg .tab[data-tab="data"]');
  r.tabText = await a.$eval('#setDlg .tab[data-tab="data"]', e => e.textContent);
  const [download] = await Promise.all([a.waitForEvent("download"), a.click("#sDataExport")]);
  const file = path.join(OUT, "all-data.json");
  await download.saveAs(file);
  const exported = JSON.parse(fs.readFileSync(file, "utf8"));
  r.exportedKeys = Object.keys(exported.data).sort();

  // an empty copy: first run opens the settings by itself
  const b = await open({});
  if (!(await b.$("#setDlg[open]"))) await b.click("#setBtn");
  await b.click('#setDlg .tab[data-tab="data"]');
  fs.writeFileSync(path.join(OUT, "not-data.json"), JSON.stringify({ links: [] }));
  await b.setInputFiles("#sDataFile", path.join(OUT, "not-data.json")); await b.waitForTimeout(200);
  r.badMsg = await b.$eval("#sDataMsg", e => e.className + " | " + e.textContent);
  await b.setInputFiles("#sDataFile", file); await b.waitForTimeout(200);
  r.confirm = await b.$eval("#confirmDlg", e => e.open && e.querySelector("#cTitle").textContent);
  await Promise.all([b.waitForNavigation(), b.click("#cOk")]); await b.waitForTimeout(800);

  const after = await b.evaluate(() => window.__mem);
  r.sameSettings = JSON.stringify(after.settings) === JSON.stringify(exported.data.settings);
  r.sameLinks = JSON.stringify(after.links) === JSON.stringify(exported.data.links);
  r.sameBoard = JSON.stringify(after.board.columns) === JSON.stringify(exported.data.board.columns);
  r.page = await b.evaluate(() => ({
    html: document.documentElement.className,
    settingsOpen: document.getElementById("setDlg").open,
    shortcutsHidden: getComputedStyle(document.getElementById("shortcuts")).display === "none" || document.getElementById("shortcuts").closest("[hidden]") !== null,
    cards: [...document.querySelectorAll("#bCols .card:not(.inbox-item)")].map(c => c.dataset.card),
    addColumn: Boolean(document.getElementById("bAddCol")),
  }));
  r.diff = Object.keys({ ...after, ...exported.data }).filter(k => JSON.stringify(after[k]) !== JSON.stringify(exported.data[k])).map(k => k + ": " + JSON.stringify(after[k])?.slice(0, 150) + " vs " + JSON.stringify(exported.data[k])?.slice(0, 150));
  r.sameAll = r.diff.length === 0;
  r.errors = [...a.errors, ...b.errors];
  console.log(JSON.stringify(r, null, 1));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
