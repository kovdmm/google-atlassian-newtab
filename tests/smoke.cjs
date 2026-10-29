// node tests/smoke.cjs – search dropdown, settings import and save, shortcuts import, settings reset
const { chromium, EXT, OUT } = require("./pw.cjs");
const path = require("path"), fs = require("fs");
const dir = process.argv[2] || EXT;
const scratch = OUT;
fs.writeFileSync(path.join(scratch, "smoke-links.json"), JSON.stringify({ links: [{ name: "A", url: "a.example.com" }, { name: "B", url: "https://b.example.com/x" }] }));
fs.writeFileSync(path.join(scratch, "smoke-atl.json"), JSON.stringify({ atlassian: { jiraUrl: "https://other.atlassian.net", projectKey: "AB", bbWorkspace: "team", bbRepos: ["r1", "r2"], sources: { prs: false } } }));
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const p = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  await p.addInitScript(() => {
    const J = "https://example.atlassian.net";
    const mem = { onboarded: true, links: [{ name: "Mail", url: "https://mail.example.com" }],
      settings: { name: "", email: "", jiraUrl: J, projectKey: "SF", lang: "en", bg: "#3c3c3c", board: true, bbWorkspace: "acme", bbRepos: ["repo"] },
      board: { expanded: false, columns: [{ id: "a", name: "To do", type: "todo", cards: [{ id: "own-1", title: "note", docs: [] }] }] } };
    const area = m => ({ get: async k => Array.isArray(k) ? Object.fromEntries(k.map(x => [x, m[x]])) : ({ [k]: m[k] }), set: async o => Object.assign(m, o) });
    window.__mem = mem; window.__req = [];
    const hist = [
      { url: J + "/browse/SF-1", title: "[SF-1] First task - Jira", lastVisitTime: 5 },
      { url: J + "/wiki/spaces/S/pages/11/Release+notes", title: "Release notes - Space - Confluence", lastVisitTime: 4 },
      { url: "https://bitbucket.org/acme/repo/pull-requests/7/diff", title: "Pull Request — repo — Bitbucket", lastVisitTime: 3 },
      { url: "https://www.google.com/search?q=release+plan", title: "release plan - Google", lastVisitTime: 2 },
      { url: "https://news.example.com/a?utm_source=x", title: "Release news", lastVisitTime: 1 },
    ];
    window.chrome = { runtime: { id: "x" }, i18n: { getUILanguage: () => "en" }, storage: { local: area(mem), session: area({}), onChanged: { addListener() {} } },
      history: { search: async ({ text }) => hist.filter(h => !text || (h.title + h.url).toLowerCase().includes(text.toLowerCase())) },
      topSites: { get: async () => [] }, permissions: { contains: async () => true, request: async () => true },
      declarativeNetRequest: { updateSessionRules: async () => {} }, tabs: { create: o => window.__req.push("tab " + o.url) } };
    window.fetch = async (url, init) => {
      const u = new URL(url); window.__req.push(u.pathname + (u.search.includes("jql=") ? " jql" : ""));
      if (u.pathname.endsWith("/myself")) return new Response("{}");
      if (u.pathname.endsWith("/graphql")) return new Response(JSON.stringify({ data: { notifications: { notificationFeed: { nodes: [] } } } }));
      if (u.pathname.includes("/search/jql")) return new Response(JSON.stringify({ issues: [{ key: "SF-2", fields: { summary: "Release checklist", status: { name: "In Progress", statusCategory: { key: "indeterminate" } }, assignee: { displayName: "Me" } } }], isLast: true }));
      if (u.pathname.includes("/wiki/rest/api/search")) return new Response(JSON.stringify({ results: [{ title: "@@@hl@@@Release@@@endhl@@@ process", url: "/spaces/S/pages/12/Release+process", resultGlobalContainer: { title: "Space" } }] }));
      if (u.hostname === "bitbucket.org" && u.pathname.endsWith("/pullrequests")) return new Response(JSON.stringify({ values: [{ id: 8, title: "Release PR", state: "OPEN", author: { display_name: "Me" }, links: { html: { href: "https://bitbucket.org/acme/repo/pull-requests/8" } } }] }));
      if (u.hostname === "bitbucket.org" && /pullrequests\/\d+$/.test(u.pathname)) return new Response(JSON.stringify({ title: "PR seven", state: "MERGED", author: { display_name: "A" } }));
      if (u.hostname === "bitbucket.org") return new Response(JSON.stringify({ values: [{ name: "release-tools", full_name: "acme/release-tools", links: { html: { href: "https://bitbucket.org/acme/release-tools" } } }] }));
      const k = u.pathname.split("/").pop();
      return new Response(JSON.stringify({ key: k, fields: { summary: "Summary " + k, status: { name: "To Do", statusCategory: { key: "new" } }, assignee: null } }));
    };
  });
  const errors = []; p.on("pageerror", e => errors.push(e.message));
  await p.goto("file:///" + path.join(dir, "newtab.html").replace(/\\/g, "/")); await p.waitForTimeout(600);
  const r = {};
  const dd = () => p.$$eval(".dd .it", e => e.map(x => x.innerText.replace(/\s+/g, " ").trim()));
  await p.click("#q"); await p.waitForTimeout(500);
  r.empty = await dd();
  await p.fill("#q", "release"); await p.waitForTimeout(900);
  r.typed = await dd();
  r.badges = await p.$$eval(".dd .st", e => e.map(x => x.className + "|" + x.textContent));
  await p.fill("#q", "12"); await p.waitForTimeout(500);
  r.key = await dd();
  await p.fill("#q", "jql: project = SF"); await p.waitForTimeout(900);
  r.jql = await dd();
  await p.keyboard.press("Escape");
  // shortcuts import + settings
  await p.click("#setBtn"); await p.waitForTimeout(100);
  await p.setInputFiles("#sImportFile", path.join(scratch, "smoke-links.json")); await p.waitForTimeout(200);
  r.linksMsg = await p.$eval("#sLinksMsg", e => e.className + "|" + e.textContent);
  r.links = await p.evaluate(() => window.__mem.links);
  await p.click('#setDlg .tab[data-tab="atlassian"]');
  await p.setInputFiles("#sAtlFile", path.join(scratch, "smoke-atl.json")); await p.waitForTimeout(200);
  r.atlMsg = await p.$eval("#sAtlMsg", e => e.className + "|" + e.textContent);
  r.atlForm = await p.evaluate(() => ["sJira", "sKey", "sBb", "sBbRepos"].map(id => document.getElementById(id).value).concat([...document.querySelectorAll("#typeSrc input")].map(c => c.dataset.name + (c.checked ? "+" : "-") + (c.disabled ? "d" : ""))));
  await p.click('#setDlg .tab[data-tab="general"]'); await p.click("#sCompact");
  r.shortcutsSectionHidden = await p.$eval("#sShortcuts", e => e.closest("section").hidden);
  await p.click("#sSave"); await p.waitForTimeout(400);
  r.saved = await p.evaluate(() => { const s = window.__mem.settings; return [s.jiraUrl, s.projectKey, s.bbWorkspace, s.bbRepos, s.compact, s.shortcuts, s.board, s.boardLock, JSON.stringify(s.inbox), JSON.stringify(s.sources)]; });
  r.html = await p.evaluate(() => document.documentElement.className);
  // reset dialog
  await p.click("#setBtn"); await p.click("#sReset"); await p.waitForTimeout(100); await p.click("#cOk"); await p.waitForTimeout(100);
  r.afterReset = await p.evaluate(() => [document.getElementById("sJira").value, document.getElementById("sShortcuts").checked, document.getElementById("sCompact").checked, document.getElementById("sBoard").checked]);
  await p.click("#sCancel");
  console.log(JSON.stringify({ errors, r }, null, 1));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
