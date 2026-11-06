// node tests/fireworks.cjs – a card dragged into a "done" column plays the fireworks (a canvas that draws sparks and then
// goes away); a move between other columns, or within the done column, plays nothing
const { chromium, EXT } = require("./pw.cjs");
const path = require("path");
const dir = process.argv[2] || EXT;

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const p = await (await browser.newContext({ viewport: { width: 1400, height: 1400 } })).newPage();
  await p.addInitScript(() => {
    const mem = { onboarded: true, links: [], settings: { lang: "en", board: true },
      board: { expanded: false, columns: [
        { id: "a", name: "To do", type: "todo", cards: [{ id: "own-1", text: "One", links: [] }, { id: "own-2", text: "Two", links: [] }] },
        { id: "b", name: "Doing", type: "progress", cards: [] },
        { id: "c", name: "Done", type: "done", cards: [{ id: "own-3", text: "Three", links: [] }] }] } };
    const area = m => ({ get: async k => Array.isArray(k) ? Object.fromEntries(k.map(x => [x, m[x]])) : ({ [k]: m[k] }), set: async o => Object.assign(m, o) });
    window.__mem = mem;
    window.chrome = { runtime: { id: "x" }, i18n: { getUILanguage: () => "en" }, storage: { local: area(mem), session: area({}), onChanged: { addListener() {} } },
      history: { search: async () => [] }, topSites: { get: async () => [] }, permissions: { contains: async () => true, request: async () => true },
      declarativeNetRequest: { updateSessionRules: async () => {} }, tabs: { create() {} } };
    window.__launches = 0;
    addEventListener("DOMContentLoaded", () => { const real = window.launchFireworks; window.launchFireworks = () => { window.__launches++; real(); }; });
  });
  const errors = []; p.on("pageerror", e => errors.push(e.message));
  await p.goto(require("url").pathToFileURL(path.join(dir, "newtab.html")).href);
  await p.waitForSelector(".card");

  const r = {};
  const drag = async (cardId, toCol) => {
    const b = await (await p.$(`.card[data-card="${cardId}"]`)).boundingBox();
    const d = await (await p.$(`.col[data-col="${toCol}"] .col-cards`)).boundingBox();
    await p.mouse.move(b.x + 40, b.y + 15); await p.mouse.down();
    await p.mouse.move(b.x + 60, b.y + 25, { steps: 3 });
    await p.mouse.move(d.x + d.width / 2, d.y + 20, { steps: 10 });
    // a little jitter at the end, as a hand has: the drop goes to the last dragover that was accepted
    await p.mouse.move(d.x + d.width / 2 + 3, d.y + 22, { steps: 3 }); await p.waitForTimeout(100);
    await p.mouse.up(); await p.waitForTimeout(600);
  };
  await drag("own-1", "b");
  r.launchesAfterMoveToDoing = await p.evaluate(() => window.__launches);
  await drag("own-2", "c");
  r.columns = await p.evaluate(() => window.__mem.board.columns.map(c => c.name + ": " + c.cards.map(x => x.id).join(",")));
  r.launchesAfterMoveToDone = await p.evaluate(() => window.__launches);
  await p.waitForTimeout(300);
  r.canvasWhilePlaying = await p.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return null;
    const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let painted = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]) painted++;
    return { painted: painted > 0, clicksPassThrough: getComputedStyle(c).pointerEvents === "none" };
  });
  await drag("own-3", "c");
  r.launchesAfterMoveWithinDone = await p.evaluate(() => window.__launches);
  await p.waitForTimeout(2200);
  r.canvasAfter = await p.$$eval("canvas", e => e.length);
  console.log(JSON.stringify({ r, errors }, null, 1));
  await browser.close();
})();
