// node tests/plus-link.cjs [- noperm] – "+ Link" under a column
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
  const rows = () => p.$$eval("#docList .pick-row, #docList .pick-access, #docList .pick-msg", e => e.map(x => (x.disabled ? "[off] " : "") + x.innerText.replace(/\s+/g, " ").trim()));
  const r = {};
  r.button = await p.$eval(".col-add-link", e => e.textContent);
  await p.click(".col-add-link"); await p.waitForTimeout(600);
  r.title = await p.$eval("#docTitle", e => e.textContent);
  r.empty = await rows();
  await p.screenshot({ path: path.join(OUT, "pluslink.png"), clip: { x: 350, y: 150, width: 700, height: 600 } });
  if (mode !== "noperm") {
    await p.click('#docList .pick-row[data-key="SF-2"]'); await p.waitForTimeout(300);
    r.afterTask = await rows();
    await p.fill("#docInput", "pull"); await p.waitForTimeout(500); await p.keyboard.press("Enter"); await p.waitForTimeout(300);
    await p.fill("#docInput", "news"); await p.waitForTimeout(500); await p.keyboard.press("Enter"); await p.waitForTimeout(300);
    await p.fill("#docInput", "https://bitbucket.org/acme/repo/pull-requests/7"); await p.waitForTimeout(400);
    r.prAgain = await rows();
    await p.click("#docClose");
    // ⋮ → Add link on a card still links
    await p.click('.card[data-card="SF-1"] .card-menu'); await p.click('.board-menu .menu-item:has-text("Add link")'); await p.waitForTimeout(300);
    r.cardDialog = [await p.$eval("#docTitle", e => e.textContent), ...(await rows())];
    await p.fill("#docInput", "release"); await p.waitForTimeout(500); await p.keyboard.press("Enter"); await p.waitForTimeout(200);
    await p.click("#docClose");
    r.board = await p.evaluate(() => window.__mem.board.columns[0].cards.map(c => JSON.stringify(c)));
  }
  console.log(JSON.stringify({ errors, r }, null, 1));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
