// node tests/platform-hints.cjs – key hints name only the keys of the system in use: Alt/Ctrl+Enter on Windows,
// Option/Cmd+Return on a Mac – in the search dropdown and in the AI Mode hint of the settings
const { chromium, EXT } = require("./pw.cjs");
const path = require("path");
const dir = process.argv[2] || EXT;

async function run(browser, platform) {
  const p = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
  await p.addInitScript(platform => {
    // what core.js reads to tell the systems apart
    Object.defineProperty(navigator, "userAgentData", { get: () => undefined });
    Object.defineProperty(navigator, "platform", { get: () => platform });
    const J = "https://example.atlassian.net";
    const mem = { onboarded: true, links: [], settings: { jiraUrl: J, projectKey: "SF", lang: "en" } };
    const area = m => ({ get: async k => Array.isArray(k) ? Object.fromEntries(k.map(x => [x, m[x]])) : ({ [k]: m[k] }), set: async o => Object.assign(m, o) });
    window.chrome = { runtime: { id: "x" }, i18n: { getUILanguage: () => "en" }, storage: { local: area(mem), session: area({}), onChanged: { addListener() {} } },
      history: { search: async () => [] }, topSites: { get: async () => [] }, permissions: { contains: async () => true, request: async () => true },
      declarativeNetRequest: { updateSessionRules: async () => {} }, tabs: { create() {} } };
    window.fetch = async () => new Response(JSON.stringify({ issues: [], results: [] }));
  }, platform);
  const errors = []; p.on("pageerror", e => errors.push(e.message));
  await p.goto(require("url").pathToFileURL(path.join(dir, "newtab.html")).href);
  await p.fill("#q", "hello");
  await p.waitForSelector("#dd .it");
  const rows = await p.$$eval("#dd .it", els => els.map(e => e.innerText.replace(/\s+/g, " ").trim()));
  await p.evaluate(() => openSettings());
  const hint = await p.$eval("#aiSearchHint", e => e.textContent);
  await p.evaluate(() => { $("setDlg").close(); settings.aiSearch = true; });
  await p.fill("#q", "hello2");
  await p.waitForTimeout(600);
  const rowsAi = await p.$$eval("#dd .it", els => els.map(e => e.innerText.replace(/\s+/g, " ").trim()));
  await p.context().close();
  return { rows, rowsAi, hint, errors };
}

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const win = await run(browser, "Win32"), mac = await run(browser, "MacIntel");
  const text = r => [...r.rows, ...r.rowsAi, r.hint].join(" | ");
  console.log(JSON.stringify({
    windows: { rows: win.rows, hint: win.hint },
    mac: { rows: mac.rows, hint: mac.hint },
    windowsOnlyWindowsKeys: /Alt\+Enter/.test(text(win)) && /Ctrl\+Enter/.test(text(win)) && !/Option|Cmd|Return|⌘|⌥/.test(text(win)),
    macOnlyMacKeys: /Option\+Return/.test(text(mac)) && /Cmd\+Return/.test(text(mac)) && !/Alt|Ctrl|Enter/.test(text(mac)),
    errors: [...win.errors, ...mac.errors],
  }, null, 1));
  await browser.close();
})();
