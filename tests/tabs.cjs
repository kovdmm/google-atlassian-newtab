// node tests/tabs.cjs – two open tabs on one storage: changes show up in the other tab, saves merge instead of overwriting
const { chromium, EXT } = require("./pw.cjs");
const path = require("path");
const dir = process.argv[2] || EXT;

const J = "https://example.atlassian.net";
const mem = {
  onboarded: true, links: [{ name: "Mail", url: "https://mail.example.com/" }],
  settings: { jiraUrl: J, projectKey: "SF", lang: "en", board: true },
  board: { expanded: false, columns: [
    { id: "a", name: "To do", type: "todo", cards: [{ key: "SF-1", summary: "One", links: [] }, { key: "SF-2", summary: "Two", links: [] }, { id: "own-n", text: "Old note", links: [] }] },
    { id: "b", name: "Doing", type: "progress", cards: [] },
  ] },
};

// chrome.* and fetch stubs; storage.local calls the test, which keeps one storage for all tabs and fires onChanged in each
function stubs() {
  const listeners = [];
  window.__fireChanged = changes => listeners.forEach(f => f(changes, "local"));
  const local = { get: k => window.__storeGet(k), set: o => window.__storeSet(o), clear: async () => {} };
  const session = { get: async () => ({}), set: async () => {} };
  window.chrome = { runtime: { id: "x" }, i18n: { getUILanguage: () => "en" },
    storage: { local, session, onChanged: { addListener: f => listeners.push(f) } },
    history: { search: async () => [] }, topSites: { get: async () => [] }, permissions: { contains: async () => true, request: async () => true },
    declarativeNetRequest: { updateSessionRules: async () => {} }, tabs: { create() {} } };
  window.fetch = async url => {
    const u = new URL(url);
    if (u.pathname.endsWith("/graphql")) return new Response(JSON.stringify({ data: { notifications: { notificationFeed: { nodes: [] } } } }));
    if (u.pathname.includes("/search/jql")) return new Response(JSON.stringify({ issues: [], isLast: true }));
    const k = u.pathname.split("/").pop();
    return new Response(JSON.stringify({ key: k, fields: { summary: "Summary " + k, status: { name: "To Do", statusCategory: { key: "new" } } } }));
  };
}

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const pages = [];
  await ctx.exposeFunction("__storeGet", k => {
    const pick = x => (mem[x] === undefined ? {} : { [x]: JSON.parse(JSON.stringify(mem[x])) });
    if (k === null) return JSON.parse(JSON.stringify(mem));
    return Object.assign({}, ...(Array.isArray(k) ? k : [k]).map(pick));
  });
  await ctx.exposeFunction("__storeSet", async o => {
    const changes = Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { oldValue: mem[k], newValue: v }]));
    Object.assign(mem, JSON.parse(JSON.stringify(o)));
    // like Chrome: the event comes after the write, in every tab, the writing one too
    setTimeout(() => pages.forEach(p => p.evaluate(c => window.__fireChanged(c), changes).catch(() => {})), 20);
  });
  await ctx.addInitScript(stubs);
  const url = require("url").pathToFileURL(path.join(dir, "newtab.html")).href;
  const errors = [];
  const open = async () => {
    const p = await ctx.newPage();
    p.on("pageerror", e => errors.push(e.message));
    pages.push(p);
    await p.goto(url); await p.waitForTimeout(600);
    return p;
  };
  const cardsOf = p => p.evaluate(() => [...document.querySelectorAll("#bCols .col:not(.col-inbox)")]
    .map(c => c.querySelector(".col-name").textContent + ": " + [...c.querySelectorAll(".card")].map(x => x.dataset.card + (x.querySelector(".card-text")?.textContent ? "=" + x.querySelector(".card-text").textContent : "")).join(",")));
  const stored = () => mem.board.columns.map(c => c.name + ": " + c.cards.map(x => (x.key || x.id) + (x.text ? "=" + x.text : "")).join(","));
  const r = {};

  const A = await open(), B = await open();

  // 1. sync: a note added in A shows up in B
  await A.click('.col[data-col="a"] .col-add-own');
  await A.fill(".composer-input", "From A");
  await A.press(".composer-input", "Enter");
  await A.waitForTimeout(800);
  r.syncAddInB = await cardsOf(B);

  // 2. merge: B is editing (so it doesn't take A's changes yet), A moves SF-2 to Doing and renames a column;
  //    B saves its edit – nothing of A's is lost, and A gets B's edit
  await B.dblclick('.card[data-card="own-n"] .card-text');
  await B.fill(".card-edit", "Edited in B");
  await A.evaluate(() => {
    const a = columnOf("a"), card = findCard(a, "SF-2");
    a.cards = a.cards.filter(c => c !== card);
    columnOf("b").cards.push(card);
    columnOf("b").name = "In progress";
    update();
  });
  await A.waitForTimeout(800);
  r.bWhileEditing = await cardsOf(B);
  await B.press(".card-edit", "Enter");
  await B.waitForTimeout(800);
  r.mergedStored = stored();
  r.mergedA = await cardsOf(A);
  r.mergedB = await cardsOf(B);

  // 3. both tabs change the board at the same moment – before either has seen the other's change
  await Promise.all([
    A.evaluate(() => { columnOf("a").cards.push(noteCard("Same time A")); update(); }),
    B.evaluate(() => { findCard(columnOf("b"), "SF-2").text = "Same time B"; update(); }),
  ]);
  await A.waitForTimeout(800);
  r.raceStored = stored();
  r.raceSame = JSON.stringify(await cardsOf(A)) === JSON.stringify(await cardsOf(B));

  // 4. a card removed in one tab while the other changes another card
  await Promise.all([
    A.evaluate(() => { columnOf("a").cards = columnOf("a").cards.filter(c => c.key !== "SF-1"); update(); }),
    B.evaluate(() => { columnOf("a").cards.find(c => c.text === "From A").due = "2026-11-03"; update(); }),
  ]);
  await A.waitForTimeout(800);
  r.removeStored = stored();
  r.removeDue = mem.board.columns[0].cards.find(c => c.text === "From A")?.due;

  // 5. settings and shortcuts: changed in A, seen in B
  await A.evaluate(() => { settings.boardLock = true; saveSettings().then(applySettings); });
  await A.evaluate(() => { links.push({ name: "Docs", url: "https://docs.example.com/" }); saveLinks(); });
  await A.waitForTimeout(800);
  r.bLocked = await B.evaluate(() => settings.boardLock === true && !document.getElementById("bAddCol"));
  r.bShortcuts = await B.$$eval("#shortcuts .tile, #shortcuts a", els => els.map(e => e.textContent.trim()).filter(Boolean));

  r.errors = errors;
  console.log(JSON.stringify(r, null, 1));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
