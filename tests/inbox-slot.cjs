// node tests/inbox-slot.cjs – an Inbox item being dragged leaves an empty slot of the same height in the Inbox
// (not a second copy of the card) until it is dropped
const { chromium, EXT } = require("./pw.cjs");
const path = require("path");
const dir = process.argv[2] || EXT;

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const p = await (await browser.newContext({ viewport: { width: 1400, height: 1100 } })).newPage();
  await p.addInitScript(() => {
    const J = "https://example.atlassian.net";
    const mem = { onboarded: true, links: [], settings: { jiraUrl: J, projectKey: "SF", lang: "en", board: true, inbox: { on: true } },
      board: { expanded: false, columns: [{ id: "a", name: "To do", type: "todo", cards: [{ id: "own-1", text: "A note", links: [] }] }] } };
    const area = m => ({ get: async k => Array.isArray(k) ? Object.fromEntries(k.map(x => [x, m[x]])) : ({ [k]: m[k] }), set: async o => Object.assign(m, o) });
    window.chrome = { runtime: { id: "x" }, i18n: { getUILanguage: () => "en" }, storage: { local: area(mem), session: area({}), onChanged: { addListener() {} } },
      history: { search: async () => [] }, topSites: { get: async () => [] }, permissions: { contains: async () => true, request: async () => true },
      declarativeNetRequest: { updateSessionRules: async () => {} }, tabs: { create() {} } };
    const note = (id, message, url) => ({ headNotification: { notificationId: id, timestamp: "2026-10-30T09:05:00Z", readState: "unread", category: "direct",
      content: { type: "commented", message, url, entity: { title: "One", url } }, analyticsAttributes: [{ key: "registrationProduct", value: "jira" }] } });
    window.fetch = async url => {
      const u = new URL(url);
      if (u.pathname.endsWith("/graphql")) return new Response(JSON.stringify({ data: { notifications: { notificationFeed: { nodes: [note("n1", "Jane Doe commented on SF-1", J + "/browse/SF-1")] } } } }));
      return new Response(JSON.stringify({ issues: [], isLast: true }));
    };
  });
  const errors = []; p.on("pageerror", e => errors.push(e.message));
  await p.goto(require("url").pathToFileURL(path.join(dir, "newtab.html")).href);
  await p.waitForSelector(".inbox-item");
  const before = await p.$eval(".inbox-item", el => el.offsetHeight);
  await p.$eval(".inbox-item", el => el.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: new DataTransfer() })));
  await p.waitForFunction(() => document.querySelector(".inbox-item.dragging"));
  const during = await p.$eval(".inbox-item", el => ({
    height: el.offsetHeight,
    display: getComputedStyle(el).display,
    contentHidden: [...el.children].every(c => getComputedStyle(c).visibility === "hidden"),
  }));
  // over a column the slot is gone: the placeholder shows where the card would land
  const col = await (await p.$('.col[data-col="a"] .col-cards')).boundingBox();
  await p.$eval('.col[data-col="a"] .col-cards', (el, pos) => el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, clientX: pos.x, clientY: pos.y, dataTransfer: new DataTransfer() })),
    { x: col.x + 20, y: col.y + 10 });
  const overColumn = await p.evaluate(() => ({ placeholder: document.querySelectorAll(".card-ph").length, slot: getComputedStyle(document.querySelector(".inbox-item")).display }));
  // dropped nowhere: the item is back as itself, the placeholder is gone
  await p.$eval(".inbox-item", el => el.dispatchEvent(new DragEvent("dragend", { bubbles: true })));
  const back = await p.evaluate(() => {
    const el = document.querySelector(".inbox-item");
    return { dragging: el.classList.contains("dragging"), display: getComputedStyle(el).display, visible: getComputedStyle(el.firstElementChild).visibility, placeholder: document.querySelectorAll(".card-ph").length };
  });
  // a card of a column behaves the same: a slot of its size until it is over a column, then the slot is gone
  const noteHeight = await p.$eval('.card[data-card="own-1"]', el => el.offsetHeight);
  await p.$eval('.card[data-card="own-1"]', el => el.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: new DataTransfer() })));
  await p.waitForFunction(() => document.querySelector('.card[data-card="own-1"].dragging'));
  const noteSlot = await p.$eval('.card[data-card="own-1"]', el => ({ height: el.offsetHeight, display: getComputedStyle(el).display }));
  await p.$eval('.col[data-col="a"] .col-cards', (el, pos) => el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, clientX: pos.x, clientY: pos.y, dataTransfer: new DataTransfer() })),
    { x: col.x + 20, y: col.y + 10 });
  const noteOver = await p.$eval('.card[data-card="own-1"]', el => getComputedStyle(el).display);
  await p.$eval('.col[data-col="a"] .col-cards', el => el.dispatchEvent(new DragEvent("dragend", { bubbles: true })));
  const noteBack = await p.$eval('.card[data-card="own-1"]', el => ({ dragging: el.classList.contains("dragging"), display: getComputedStyle(el).display }));
  // nothing can be dropped into the Inbox: it never accepts a dragover
  const inboxAccepts = await p.$eval(".col-inbox .col-cards", el => {
    const e = new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() });
    el.dispatchEvent(e);
    return e.defaultPrevented;
  });
  console.log(JSON.stringify({
    before, during, overColumn, back, inboxAccepts,
    slotKept: during.height === before && during.display === "block" && during.contentHidden,
    slotGoneOverColumn: overColumn.placeholder === 1 && overColumn.slot === "none",
    returnedWhenNotDropped: !back.dragging && back.display === "block" && back.visible === "visible" && back.placeholder === 0,
    noteSameBehavior: noteSlot.height === noteHeight && noteSlot.display !== "none" && noteOver === "none" && !noteBack.dragging && noteBack.display !== "none",
    errors,
  }, null, 1));
  await browser.close();
})();
