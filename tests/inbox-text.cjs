// node tests/inbox-text.cjs – an Inbox notification dropped on a column keeps who did what and when in the card's text;
// a card already on the board (a note on the same page too) gets the line added instead of a new card
const { chromium, EXT, OUT } = require("./pw.cjs");
const path = require("path");
const dir = process.argv[2] || EXT;

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const p = await (await browser.newContext({ viewport: { width: 1400, height: 1100 } })).newPage();
  await p.addInitScript(() => {
    const J = "https://example.atlassian.net", PAGE = J + "/wiki/spaces/S/pages/11/Release+notes";
    const mem = { onboarded: true, links: [], settings: { jiraUrl: J, projectKey: "SF", lang: "en", board: true, inbox: { on: true, views: true } },
      board: { expanded: false, columns: [{ id: "a", name: "To do", type: "todo", cards: [{ key: "SF-1", summary: "One", links: [] }] }] } };
    const area = m => ({ get: async k => Array.isArray(k) ? Object.fromEntries(k.map(x => [x, m[x]])) : ({ [k]: m[k] }), set: async o => Object.assign(m, o) });
    window.__mem = mem;
    window.chrome = { runtime: { id: "x" }, i18n: { getUILanguage: () => "en" }, storage: { local: area(mem), session: area({}), onChanged: { addListener() {} } },
      history: { search: async () => [] }, topSites: { get: async () => [] }, permissions: { contains: async () => true, request: async () => true },
      declarativeNetRequest: { updateSessionRules: async () => {} }, tabs: { create() {} } };
    const note = (id, time, product, message, title, url) => ({ headNotification: { notificationId: id, timestamp: time, readState: "unread", category: "direct",
      content: { type: "commented", message, url, entity: { title, url } }, analyticsAttributes: [{ key: "registrationProduct", value: product }] } });
    const nodes = [
      note("n1", "2026-10-30T09:05:00Z", "jira", "Jane Doe assigned SF-9 to you", "Nine", J + "/browse/SF-9"),
      note("n2", "2026-10-30T10:15:00Z", "jira", "Jane Doe commented on SF-1", "One", J + "/browse/SF-1"),
      note("n3", "2026-10-30T11:00:00Z", "confluence", "John Roe edited Release notes", "Release notes", PAGE),
      note("n4", "2026-10-30T12:30:00Z", "confluence", "John Roe mentioned you on Release notes", "Release notes", PAGE),
    ];
    window.fetch = async url => {
      const u = new URL(url);
      if (u.pathname.endsWith("/graphql")) return new Response(JSON.stringify({ data: { notifications: { notificationFeed: { nodes } } } }));
      if (u.pathname.includes("/search/jql")) return new Response(JSON.stringify({ issues: [], isLast: true }));
      const k = u.pathname.split("/").pop();
      return new Response(JSON.stringify({ key: k, fields: { summary: "Summary " + k, status: { name: "To Do", statusCategory: { key: "new" } } } }));
    };
  });
  const errors = []; p.on("pageerror", e => errors.push(e.message));
  await p.goto(require("url").pathToFileURL(path.join(dir, "newtab.html")).href);
  await p.waitForSelector(".inbox-item"); await p.waitForTimeout(300);
  const r = {};
  for (const id of ["n1", "n2", "n3", "n4"]) {
    await p.evaluate(id => inboxToCard(id, columnOf("a"), 99), id);
    await p.waitForTimeout(100);
  }
  r.cards = await p.evaluate(() => window.__mem.board.columns[0].cards.map(c => ({ card: c.key || c.id.slice(0, 4), text: c.text, links: c.links.map(l => l.key || l.title) })));
  r.inboxLeft = await p.$$eval(".inbox-item", els => els.length);
  await p.screenshot({ path: path.join(OUT, "inbox-text.png"), clip: { x: 0, y: 300, width: 1000, height: 600 } });
  r.errors = errors;
  console.log(JSON.stringify(r, null, 1));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
