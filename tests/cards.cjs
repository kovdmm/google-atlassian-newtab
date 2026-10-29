// node tests/cards.cjs – the card model without conversions: migration, descriptions, note text
const { chromium, EXT, OUT } = require("./pw.cjs");
const path = require("path"), fs = require("fs");
const dir = process.argv[2] || EXT;
const legacyFile = path.join(OUT, "legacy-board.json");
fs.writeFileSync(legacyFile, JSON.stringify({ board: { columns: [{ name: "Old", type: "todo", cards: [
  { id: "own-x", title: "old desc", links: ["SF-40"], docs: [] },
  { id: "own-y", title: "two", links: ["SF-41", "SF-42"], docs: [{ title: "P", url: "https://example.com/p" }] },
  { key: "SF-43", docs: [{ title: "Q", url: "https://example.com/q" }] },
] }] } }));
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const p = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  await p.addInitScript(() => {
    const J = "https://example.atlassian.net";
    const cards = [
      // saved by the previous version: note text in "title", a description = a note linked to one task
      { id: "own-1", title: "desc of SF-1", links: [{ key: "SF-1" }], due: "2026-11-05" },
      { id: "own-2", title: "two tasks", links: [{ key: "SF-2" }, { key: "SF-3" }] },
      { id: "own-3", title: "", links: [{ title: "Page", url: "https://example.com/p" }] },
      { id: "own-4", title: "plain", links: [] },
      // even older: links + docs
      { id: "own-5", title: "older", links: ["SF-5"], docs: [{ title: "Page", url: "https://example.com/p" }] },
      { key: "SF-9", summary: "Nine", links: [] },
      { id: "pr:acme/repo/7", pr: "acme/repo/7", url: "https://bitbucket.org/acme/repo/pull-requests/7", title: "PR seven", state: "OPEN", links: [] },
    ];
    const mem = { onboarded: true, links: [], settings: { jiraUrl: J, projectKey: "SF", lang: "en", board: true },
      board: { expanded: false, columns: [{ id: "a", name: "To do", type: "todo", cards }] } };
    const area = m => ({ get: async k => Array.isArray(k) ? Object.fromEntries(k.map(x => [x, m[x]])) : ({ [k]: m[k] }), set: async o => Object.assign(m, o) });
    window.__mem = mem;
    window.chrome = { runtime: { id: "x" }, i18n: { getUILanguage: () => "en" }, storage: { local: area(mem), session: area({}), onChanged: { addListener() {} } },
      history: { search: async () => [] }, topSites: { get: async () => [] }, permissions: { contains: async () => true, request: async () => true },
      declarativeNetRequest: { updateSessionRules: async () => {} }, tabs: { create() {} } };
    window.fetch = async url => {
      const u = new URL(url);
      if (u.pathname.endsWith("/graphql")) return new Response(JSON.stringify({ data: { notifications: { notificationFeed: { nodes: [] } } } }));
      if (u.hostname === "bitbucket.org") return new Response(JSON.stringify({ title: "PR seven", state: "OPEN" }));
      if (u.pathname.includes("/search/jql")) return new Response(JSON.stringify({ issues: [], isLast: true }));
      const k = u.pathname.split("/").pop();
      return new Response(JSON.stringify({ key: k, fields: { summary: "Summary " + k, status: { name: "To Do", statusCategory: { key: "new" } } } }));
    };
  });
  const errors = []; p.on("pageerror", e => errors.push(e.message));
  p.on("dialog", d => d.accept());
  await p.goto(require("url").pathToFileURL(path.join(dir, "newtab.html")).href); await p.waitForTimeout(700);
  const state = () => p.evaluate(() => window.__mem.board.columns[0].cards.map(c => JSON.stringify(c)));
  const card = id => `.card[data-card="${id}"]`;
  const typeIn = async (text) => { await p.fill(".card-edit", text); await p.keyboard.press("Enter"); await p.waitForTimeout(150); };
  const menu = async (id, label) => { await p.click(`${card(id)} .card-menu`); await p.click(`.board-menu .menu-item:has-text("${label}")`); };
  const r = {};
  r.migrated = await state();

  // a Jira card: description via the row icon, then via the menu, then erased – it stays the Jira card
  await p.hover(card("SF-9")); await p.click(`${card("SF-9")} .card-desc`);
  r.placeholder = await p.$eval(".card-edit", e => e.placeholder);
  await typeIn("my words");
  r.jiraWithText = await p.$eval(card("SF-9"), e => e.innerText.replace(/\s+/g, " "));
  r.descButtonGone = await p.$$eval(`${card("SF-9")} .card-desc`, e => e.length);
  await menu("SF-9", "Edit description"); r.editValue = await p.$eval(".card-edit", e => e.value);
  await typeIn("");
  // a PR card: the same
  await p.hover(card("pr:acme/repo/7")); await p.click(`${card("pr:acme/repo/7")} .card-desc`); await typeIn("pr words");
  // Esc keeps the text as it was
  await menu("pr:acme/repo/7", "Edit description"); await p.fill(".card-edit", "changed"); await p.keyboard.press("Escape"); await p.waitForTimeout(100);
  // notes: text erased with links – stays a note; without links – goes; text that is a task link – stays text
  await p.dblclick(`${card("own-2")} .card-text`); await typeIn("");
  await p.dblclick(`${card("own-4")} .card-text`); await typeIn("");
  r.afterEdits = await state();
  const noteId = await p.evaluate(() => window.__mem.board.columns[0].cards.find(c => c.id?.startsWith("own-") && c.links.length === 0 && c.text)?.id);
  r.noteId = noteId;
  // × on the last link of a note without text
  await p.hover(`${card("own-3")} .att`); await p.click(`${card("own-3")} .link-del`); await p.waitForTimeout(100);
  // the composer: a task key still makes a Jira card
  await p.click(".col-add-own"); await p.fill(".composer-input", "SF-77"); await p.keyboard.press("Enter"); await p.waitForTimeout(150);
  await p.fill(".composer-input", "just text"); await p.keyboard.press("Enter"); await p.waitForTimeout(150);
  await p.keyboard.press("Escape");
  r.final = await state();
  await p.screenshot({ path: path.join(OUT, "unified.png"), clip: { x: 390, y: 300, width: 330, height: 700 } });
  // import of a legacy file
  await p.click("#setBtn"); await p.click('#setDlg .tab[data-tab="board"]');
  await p.setInputFiles("#sBoardFile", legacyFile); await p.waitForTimeout(200);
  if (await p.$("#confirmDlg[open]")) { await p.click("#cOk"); await p.waitForTimeout(200); }
  r.imported = await p.evaluate(() => window.__mem.board.columns[0].cards.map(c => JSON.stringify(c)));
  console.log(JSON.stringify({ errors, r }, null, 1));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
