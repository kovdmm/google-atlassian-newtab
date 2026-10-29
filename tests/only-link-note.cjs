// node tests/only-link-note.cjs – a note that is nothing but a link: "+ Note" and editing the note text
const { chromium, EXT, OUT } = require("./pw.cjs");
const path = require("path");
const [arg, mode] = process.argv.slice(2);
const dir = arg && arg !== "-" ? arg : EXT;
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const p = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  await p.addInitScript(noperm => {
    const J = "https://example.atlassian.net";
    const mem = { onboarded: true, links: [], settings: { jiraUrl: J, projectKey: "SF", lang: "en", board: true, bbWorkspace: "acme", bbRepos: ["repo"] },
      board: { expanded: false, columns: [{ id: "a", name: "To do", type: "todo", cards: [{ key: "SF-1", summary: "One", links: [] }] }] } };
    const area = m => ({ get: async k => Array.isArray(k) ? Object.fromEntries(k.map(x => [x, m[x]])) : ({ [k]: m[k] }), set: async o => Object.assign(m, o) });
    window.__mem = mem;
    const hist = [
      { url: J + "/browse/SF-1", title: "[SF-1] One - Jira", lastVisitTime: 9 },
      { url: J + "/wiki/spaces/S/pages/11/Release+notes", title: "Release notes - Space - Confluence", lastVisitTime: 8 },
      { url: "https://bitbucket.org/acme/repo/pull-requests/7", title: "Pull Request — repo — Bitbucket", lastVisitTime: 7 },
      { url: "https://news.example.com/a", title: "Some news", lastVisitTime: 6 },
    ];
    window.chrome = { runtime: { id: "x" }, i18n: { getUILanguage: () => "en" }, storage: { local: area(mem), session: area({}), onChanged: { addListener() {} } },
      history: { search: async ({ text }) => hist.filter(h => !text || (h.title + h.url).toLowerCase().includes(text.toLowerCase())) },
      topSites: { get: async () => [] }, permissions: { contains: async () => !noperm, request: async () => true },
      declarativeNetRequest: { updateSessionRules: async () => {} }, tabs: { create() {} } };
    window.fetch = async url => {
      const u = new URL(url);
      if (u.pathname.endsWith("/graphql")) return new Response(JSON.stringify({ data: { notifications: { notificationFeed: { nodes: [] } } } }));
      if (u.hostname === "bitbucket.org") return new Response(JSON.stringify({ title: "PR seven", state: "OPEN" }));
      if (u.pathname.includes("/search/jql")) return new Response(JSON.stringify({ issues: ["SF-1", "SF-2", "SF-3"].map(key => ({ key, fields: { summary: "Mine " + key, status: { name: "To Do", statusCategory: { key: "new" } } } })), isLast: true }));
      if (u.pathname.includes("/wiki/rest/api/search")) return new Response(JSON.stringify({ results: [] }));
      const k = u.pathname.split("/").pop();
      return new Response(JSON.stringify({ key: k, fields: { summary: "Summary " + k, status: { name: "To Do", statusCategory: { key: "new" } } } }));
    };
  }, mode === "noperm");
  const errors = []; p.on("pageerror", e => errors.push(e.message));
  await p.goto(require("url").pathToFileURL(path.join(dir, "newtab.html")).href); await p.waitForTimeout(700);
  const state = () => p.evaluate(() => window.__mem.board.columns[0].cards.map(c => JSON.stringify(c)));
  const r = {};
  await p.click(".col-add-own");
  for (const text of ["https://news.example.com/a", "see https://news.example.com/a", "https://bitbucket.org/acme/repo/pull-requests/7"]) {
    await p.fill(".composer-input", text); await p.keyboard.press("Enter"); await p.waitForTimeout(250);
  }
  await p.keyboard.press("Escape");
  r.composer = await state();
  const notes = await p.evaluate(() => window.__mem.board.columns[0].cards.filter(c => c.id?.startsWith("own-")).map(c => c.id));
  const edit = async (id, text) => {
    await p.click(`.card[data-card="${id}"] .card-menu`); await p.click('.board-menu .menu-item:has-text("Edit note")');
    await p.fill(".card-edit", text); await p.keyboard.press("Enter"); await p.waitForTimeout(250);
  };
  await edit(notes[1], "https://example.atlassian.net/browse/SF-5");   // text with a page link → only the task link: text goes, task linked
  await edit(notes[0], "https://news.example.com/a");                  // the same page again: no duplicate
  r.edited = await state();
  console.log(JSON.stringify({ errors, r }, null, 1));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
