// node tests/drag.cjs – dragging a card to another column: an opaque copy follows the pointer, the card lands there
const { chromium, EXT, OUT } = require("./pw.cjs");
const path = require("path");
const [arg, mode] = process.argv.slice(2);
const dir = arg && arg !== "-" ? arg : EXT;
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const p = await (await browser.newContext({ viewport: { width: 1400, height: 1400 }, deviceScaleFactor: 2 })).newPage();
  await p.addInitScript(noperm => {
    const J = "https://example.atlassian.net";
    const mem = { onboarded: true, links: [], settings: { jiraUrl: J, projectKey: "SF", lang: "en", board: true, inbox: { on: true }, bbWorkspace: "acme", bbRepos: ["repo"] },
      board: { expanded: false, columns: [{ id: "a", name: "To do", type: "todo", cards: [{ key: "SF-1", summary: "One", text: "Ask about the release date", links: [] },
      { key: "SF-2", summary: "Two", links: [] },
      { key: "SF-3", summary: "Three", text: "Check with QA and update the ticket", links: [{ title: "Release notes", url: "https://example.atlassian.net/wiki/spaces/S/pages/11/Release+notes" }], due: "2026-11-02" },
      { id: "own-n", text: "Plain note", links: [{ key: "SF-2" }] },
      { id: "pr:acme/repo/8", pr: "acme/repo/8", url: "https://bitbucket.org/acme/repo/pull-requests/8", title: "PR eight", state: "OPEN", text: "Review after lunch", links: [] }, { id: "pr:acme/repo/7", pr: "acme/repo/7", url: "https://bitbucket.org/acme/repo/pull-requests/7", title: "PR seven", state: "OPEN", links: [] }] }, { id: "b", name: "Doing", type: "progress", cards: [] }] } };
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
      if (u.pathname.endsWith("/graphql")) return new Response(JSON.stringify({ data: { notifications: { notificationFeed: { nodes: [{ headNotification: {
        notificationId: "n1", timestamp: "2026-10-30T09:00:00Z", readState: "unread", category: "direct",
        content: { type: "assigned", message: "assigned you", url: J + "/browse/SF-9", entity: { title: "Nine", url: J + "/browse/SF-9" } },
        analyticsAttributes: [{ key: "registrationProduct", value: "jira" }] } }] } } } }));
      if (u.hostname === "bitbucket.org") return new Response(JSON.stringify({ title: "PR seven", state: "OPEN" }));
      if (u.pathname.includes("/search/jql")) return new Response(JSON.stringify({ issues: ["SF-1", "SF-2", "SF-3"].map(key => ({ key, fields: { summary: "Mine " + key, status: { name: "To Do", statusCategory: { key: "new" } } } })), isLast: true }));
      if (u.pathname.includes("/wiki/rest/api/search")) return new Response(JSON.stringify({ results: [] }));
      const k = u.pathname.split("/").pop();
      return new Response(JSON.stringify({ key: k, fields: { summary: "Summary " + k, status: { name: "To Do", statusCategory: { key: "new" } } } }));
    };
  }, mode === "noperm");
  const errors = []; p.on("pageerror", e => errors.push(e.message));
  await p.goto(require("url").pathToFileURL(path.join(dir, "newtab.html")).href); await p.waitForTimeout(700);
  const r = {};
  const src = await p.$('.card[data-card="SF-3"]'), sb = await src.boundingBox();
  const dst = await (await p.$('.col[data-col="b"] .col-cards')).boundingBox();
  await p.mouse.move(sb.x + 60, sb.y + 20); await p.mouse.down();
  await p.mouse.move(sb.x + 80, sb.y + 30, { steps: 3 });
  await p.mouse.move(dst.x + dst.width / 2, dst.y + 40, { steps: 12 }); await p.waitForTimeout(200);
  r.ghost = await p.evaluate(() => { const g = document.querySelector(".drag-ghost"); if (!g) return null; const cs = getComputedStyle(g), b = g.getBoundingClientRect(); return { opacity: cs.opacity, position: cs.position, x: Math.round(b.x), y: Math.round(b.y), text: g.innerText.slice(0, 30) }; });
  r.pointer = { x: Math.round(dst.x + dst.width / 2), y: Math.round(dst.y + 40) };
  await p.screenshot({ path: require("path").join(OUT, "drag.png"), clip: { x: 0, y: 200, width: 1100, height: 700 } });
  await p.mouse.up(); await p.waitForTimeout(300);
  r.ghostAfter = await p.$$eval(".drag-ghost", e => e.length);

  // from the Inbox: the item leaves the page on the drop, the copy under the pointer must go with it
  const item = await p.waitForSelector(".inbox-item", { timeout: 3000 }).catch(() => null);
  r.inboxItem = Boolean(item);
  if (item) {
    const ib = await item.boundingBox();
    await p.mouse.move(ib.x + 40, ib.y + 15); await p.mouse.down();
    await p.mouse.move(ib.x + 60, ib.y + 25, { steps: 3 });
    await p.mouse.move(dst.x + dst.width / 2, dst.y + 20, { steps: 12 }); await p.waitForTimeout(200);
    r.inboxGhostWhileDragging = await p.$$eval(".drag-ghost", e => e.length);
    await p.mouse.up(); await p.waitForTimeout(300);
    r.inboxGhostAfter = await p.$$eval(".drag-ghost", e => e.length);
    r.placeholderAfter = await p.$$eval(".card-ph", e => e.length);
  }
  r.columns = await p.evaluate(() => window.__mem.board.columns.map(c => c.name + ": " + c.cards.map(x => x.key || x.id).join(",")));
  console.log(JSON.stringify({ errors, r }, null, 1));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
