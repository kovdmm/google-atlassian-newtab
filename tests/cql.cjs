// node tests/cql.cjs – "cql: …" in the search box: the first row opens the query in Confluence, the pages Confluence
// found are listed below, and the typed query goes to the Confluence API as it is
const { chromium, EXT } = require("./pw.cjs");
const path = require("path");
const dir = process.argv[2] || EXT;

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const p = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  await p.addInitScript(() => {
    const J = "https://example.atlassian.net";
    const mem = { onboarded: true, links: [], settings: { jiraUrl: J, projectKey: "SF", lang: "en" } };
    const area = m => ({ get: async k => Array.isArray(k) ? Object.fromEntries(k.map(x => [x, m[x]])) : ({ [k]: m[k] }), set: async o => Object.assign(m, o) });
    window.chrome = { runtime: { id: "x" }, i18n: { getUILanguage: () => "en" }, storage: { local: area(mem), session: area({}), onChanged: { addListener() {} } },
      history: { search: async () => [] }, topSites: { get: async () => [] }, permissions: { contains: async () => true, request: async () => true },
      declarativeNetRequest: { updateSessionRules: async () => {} }, tabs: { create() {} } };
    window.__requests = [];
    window.fetch = async url => {
      const u = new URL(url);
      window.__requests.push(u.pathname + "?cql=" + (u.searchParams.get("cql") || ""));
      if (u.pathname.includes("/wiki/rest/api/search")) return new Response(JSON.stringify({ results: [
        { title: "Release notes", url: "/spaces/SLAM/pages/11/Release+notes", resultGlobalContainer: { title: "SLAM" } },
        { title: "Release plan", url: "/spaces/SLAM/pages/12/Release+plan", resultGlobalContainer: { title: "SLAM" } }] }));
      return new Response(JSON.stringify({ accountId: "me" }));
    };
    // searches go to this tab (location.href): record where Enter would go instead of leaving the page
    window.__went = [];
    addEventListener("DOMContentLoaded", () => { window.go = (kind, value) => window.__went.push(kind + ": " + value); });
  });
  const errors = []; p.on("pageerror", e => errors.push(e.message));
  await p.goto(require("url").pathToFileURL(path.join(dir, "newtab.html")).href);
  const query = 'title ~ "release" and space = SLAM';
  await p.fill("#q", "cql: " + query);
  await p.waitForFunction(() => document.querySelectorAll("#dd .it").length >= 3, null, { timeout: 5000 }).catch(() => {});
  const rows = await p.$$eval("#dd .it", els => els.map(e => e.innerText.replace(/\s+/g, " ").trim()));
  const requests = await p.evaluate(() => window.__requests);
  await p.keyboard.press("Enter");
  const went = await p.evaluate(() => window.__went);
  console.log(JSON.stringify({
    rows, requests, went,
    firstRowOpensCql: /open CQL in Confluence/.test(rows[0] || ""),
    pagesListed: rows.filter(r => /Release (notes|plan)/.test(r)).length === 2,
    rawQuerySent: requests.some(r => r.includes("cql=" + query)),
    errors,
  }, null, 1));
  await browser.close();
})();
