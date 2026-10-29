// node tests/description.cjs – a Jira or PR card description: on top, a click there does not open the card, double click edits
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
      board: { expanded: false, columns: [{ id: "a", name: "To do", type: "todo", cards: [{ key: "SF-1", summary: "One", text: "Ask about the release date", links: [] }, { id: "pr:acme/repo/7", pr: "acme/repo/7", url: "https://bitbucket.org/acme/repo/pull-requests/7", title: "PR seven", state: "OPEN", links: [] }] }] } };
    const area = m => ({ get: async k => Array.isArray(k) ? Object.fromEntries(k.map(x => [x, m[x]])) : ({ [k]: m[k] }), set: async o => Object.assign(m, o) });
    window.__mem = mem; window.__opened = []; window.open = u => window.__opened.push(u);
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
  const jira = '.card[data-card="SF-1"]', pr = '.card[data-card="pr:acme/repo/7"]';
  r.order = await p.$eval(jira, e => [...e.children].map(x => x.className));
  await p.click(`${jira} .card-text`); await p.waitForTimeout(400);
  r.openedByTextClick = await p.evaluate(() => window.__opened.length);
  await p.click(`${jira} .card-top + .card-title`); await p.waitForTimeout(100);
  r.openedBySummaryClick = await p.evaluate(() => window.__opened.slice());
  await p.screenshot({ path: require("path").join(OUT, "desc.png"), clip: { x: 390, y: 380, width: 330, height: 260 } });
  await p.dblclick(`${jira} .card-text`); await p.waitForTimeout(100);
  r.editorOrder = await p.$eval(jira, e => [...e.children].map(x => x.className));
  await p.fill(".card-edit", "New words"); await p.keyboard.press("Enter"); await p.waitForTimeout(150);
  // PR card without a description: the icon puts the box above the title
  await p.hover(pr); await p.click(`${pr} .card-desc`);
  r.prEditorOrder = await p.$eval(pr, e => [...e.children].map(x => x.className));
  await p.fill(".card-edit", "pr words"); await p.keyboard.press("Enter"); await p.waitForTimeout(150);
  await p.dblclick(`${pr} .card-text`); await p.fill(".card-edit", ""); await p.keyboard.press("Enter"); await p.waitForTimeout(150);
  r.opened = await p.evaluate(() => window.__opened.length);
  r.board = await state();
  console.log(JSON.stringify({ errors, r }, null, 1));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
