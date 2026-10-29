// Board: what the user does with cards – adding notes, editing card text, clicks, drag and drop.

// =====================================================================================
// Own tasks: a composer right in the column (Enter – add and keep writing, Esc – close)
// =====================================================================================

function openComposer(col) {
  composerColumn = col.id;
  renderBoard();
}

function closeComposer() {
  composerColumn = null;
  renderBoard();
}

// A note that is nothing but a Jira task – its link (…/browse/SF-1, a board with ?selectedIssue=SF-1) or its key –
// becomes the Jira card itself
function ticketOfText(text) {
  if (!hasJira() || /\s/.test(text)) return null;
  if (/^[A-Z][A-Z0-9]+-\d+$/i.test(text)) return text.toUpperCase();
  if (!text.startsWith(jiraOrigin() + "/")) return null;
  try {
    const key = new URL(text).searchParams.get("selectedIssue");
    if (key && /^[A-Z][A-Z0-9]+-\d+$/.test(key)) return key;
  } catch {}
  return taskOfUrl(text);
}

// …and a note that is nothing but a pull request link becomes the PR card
const prOfText = text => !/\s/.test(text) && prRefOf(text);

// …and a note that is nothing but some other link is a note without text, with that link
const urlOfText = text => (/^https?:\/\/\S+$/i.test(text) ? text : null);

// the task is already a card somewhere: show it instead of adding it twice
function flashCard(key) {
  const el = $("bCols").querySelector(`.card[data-card="${CSS.escape(key)}"]`);
  if (!el) return;
  el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
}

async function addOwnTask(col, text) {
  text = text.trim();
  if (!text) return;
  const ref = prOfText(text), key = !ref && ticketOfText(text);
  if (ref && prCardsOnBoard().has(ref)) return flashCard(prCardId(ref));
  if (key && cardsOnBoard().has(key)) return flashCard(key);
  const url = !ref && !key && urlOfText(text);
  const card = ref ? prCard(ref, text) : key ? jiraCard(key)
    : url ? noteCard("", { links: [await pageLinkOf(url)] }) : noteCard(text);
  col.cards.push(card);
  update(); // the composer stays open and focused for the next task
  refreshFor(card);
}

// The card's own text, edited in place: a note's text or the description of a Jira or PR card – it is only text,
// the card stays what it is. Enter – save, Shift+Enter – new line, Esc – cancel.
// A note text that is nothing but a link moves to the note's links. A card left with nothing (see isEmptyCard) goes
function editCardText(cardEl) {
  const col = columnOf(cardEl.dataset.col), card = findCard(col, cardEl.dataset.card);
  const placeholder = card.key || card.pr ? t("boardDescPlaceholder", cardName(card)) : "";
  const input = Object.assign(document.createElement("textarea"),
    { className: "card-edit", value: card.text || "", rows: 3, maxLength: 500, placeholder });
  // a note always has its text block; a Jira or PR card gets the box above its summary
  const textEl = cardEl.querySelector(".card-text");
  if (textEl) textEl.replaceWith(input);
  else cardEl.querySelector(".card-top").after(input);
  cardEl.draggable = false;
  input.focus();
  input.select();
  let done = false;
  const finish = async save => {
    if (done) return;
    done = true;
    if (save) {
      const text = input.value.trim(), isNote = !card.key && !card.pr;
      const key = isNote && ticketOfText(text), url = isNote && !key && urlOfText(text);
      if (key || url) {
        delete card.text;
        linkToCard(card, key ? { key } : await pageLinkOf(url));
      } else if (text) card.text = text;
      else delete card.text;
      if (isEmptyCard(card)) col.cards = col.cards.filter(c => c !== card);
    }
    update();
  };
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); finish(true); }
    if (e.key === "Escape") { e.stopPropagation(); finish(false); }
  });
  input.addEventListener("blur", () => finish(true));
}

// =====================================================================================
// Clicks
// =====================================================================================

// A Jira or PR card behaves like a link: a click opens it in a new tab, a middle click or Ctrl/Cmd+click –
// in a background tab. A note has no page of its own
const cardUrl = card => (card?.pr ? card.url : card?.key && hasJira() ? urls.task(card.key) : null);
const openTask = (key, background) => openUrl(urls.task(key), background);

$("bCols").addEventListener("click", e => {
  if (e.target.closest("#bAddCol")) {
    board.columns.push({ id: newId(), name: t("boardNewColumn"), type: "todo", cards: [] });
    renderBoard();
    const cols = $("bCols").querySelectorAll(".col");
    cols[cols.length - 1].scrollIntoView({ inline: "end", block: "nearest" });
    renameColumn(cols[cols.length - 1], true);
    return;
  }
  const colEl = e.target.closest(".col");
  if (!colEl) return;
  if (colEl.classList.contains("col-inbox")) return inboxClick(e);
  const col = columnOf(colEl.dataset.col);

  if (e.target.closest(".col-menu")) return columnMenu(e.target.closest(".col-menu"), col);
  if (e.target.closest(".col-add-own")) return openComposer(col);
  if (e.target.closest(".col-add-link")) return openDocDialog({ col });
  if (e.target.closest(".composer-add")) return addOwnTask(col, colEl.querySelector(".composer-input").value);
  if (e.target.closest(".composer-cancel")) return closeComposer();

  const cardEl = e.target.closest(".card");
  if (!cardEl || cardEl.querySelector(".card-edit")) return;
  const card = findCard(col, cardEl.dataset.card);
  if (e.target.closest(".card-menu")) return cardMenu(e.target.closest(".card-menu"), col, card);
  if (e.target.closest(".card-desc")) return editCardText(cardEl);
  if (e.target.closest(".due")) return openDueDialog(card);
  const linkDel = e.target.closest(".link-del");
  if (linkDel) {
    card.links.splice(+linkDel.dataset.link, 1);
    // the last link of a note without text: nothing is left of the note
    if (isEmptyCard(card)) col.cards = col.cards.filter(c => c !== card);
    return update();
  }
  // linked pages and tasks open on their own and never open the card around them;
  // the card's own text is for a double click (edit), it doesn't open the card either
  if (e.target.closest(".card-links, .card-text")) return;
  const url = cardUrl(card);
  if (url) openUrl(url, e.ctrlKey || e.metaKey);
});

$("bCols").addEventListener("keydown", e => {
  if (!e.target.classList.contains("composer-input")) return;
  const col = columnOf(e.target.closest(".col").dataset.col);
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addOwnTask(col, e.target.value); }
  if (e.key === "Escape") { e.stopPropagation(); closeComposer(); }
});

// double click – a shortcut for what the ⋮ menus do
$("bCols").addEventListener("dblclick", e => {
  if (e.target.closest("button, a, textarea, input")) return;
  if (e.target.closest(".col-name") && !columnsLocked()) return renameColumn(e.target.closest(".col"));
  // a note – anywhere on it; a Jira or PR card – on its description
  const cardEl = e.target.closest(".card.own") || e.target.closest(".card-text")?.closest(".card");
  if (cardEl) editCardText(cardEl);
});

$("bCols").addEventListener("auxclick", e => {
  if (e.button !== 1) return;
  const cardEl = e.target.closest(".card:not(.inbox-item)");
  // a linked page keeps the browser's own middle click (opens just the page)
  if (!cardEl || e.target.closest(".card-links, .card-text, button")) return;
  const url = cardUrl(findCard(columnOf(cardEl.dataset.col), cardEl.dataset.card));
  if (!url) return;
  e.preventDefault();
  openUrl(url, true);
});

// no auto-scroll on a middle press over a card (links keep their default behavior)
$("bCols").addEventListener("mousedown", e => {
  if (e.button === 1 && e.target.closest(".card") && !e.target.closest("a")) e.preventDefault();
});

// =====================================================================================
// Drag and drop: cards between and within columns, columns by their header
// =====================================================================================

let dragCard = null;   // { id, from } while a card is dragged, { inbox } for a notification
let dragColumn = null; // column id while a column is dragged by its header
const placeholder = Object.assign(document.createElement("div"), { className: "card-ph" });

// The element the dragged item should be inserted before, by the pointer position
function insertBefore(container, selector, pos, axis) {
  return [...container.querySelectorAll(selector)].find(el => {
    const r = el.getBoundingClientRect();
    return axis === "y" ? pos < r.top + r.height / 2 : pos < r.left + r.width / 2;
  }) || null;
}

$("bCols").addEventListener("dragstart", e => {
  const cardEl = e.target.closest?.(".card");
  const headEl = e.target.closest?.(".col-head");
  closeMenu();
  if (cardEl?.classList.contains("inbox-item")) {
    dragCard = { inbox: cardEl.dataset.inbox };
    placeholder.style.height = cardEl.offsetHeight + "px";
  } else if (headEl && (headEl.closest(".col-inbox") || columnsLocked())) {
    return e.preventDefault();
  } else if (cardEl) {
    dragCard = { id: cardEl.dataset.card, from: cardEl.dataset.col };
    placeholder.style.height = cardEl.offsetHeight + "px";
    requestAnimationFrame(() => cardEl.classList.add("dragging"));
  } else if (headEl) {
    dragColumn = headEl.closest(".col").dataset.col;
    requestAnimationFrame(() => headEl.closest(".col").classList.add("dragging"));
  } else {
    return;
  }
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", dragCard?.id || dragColumn);
});

$("bCols").addEventListener("dragover", e => {
  if (dragCard) {
    const list = e.target.closest(".col:not(.col-inbox)")?.querySelector(".col-cards");
    if (!list) return;
    e.preventDefault();
    const before = insertBefore(list, ".card:not(.dragging)", e.clientY, "y");
    if (placeholder.parentNode !== list || placeholder.nextSibling !== before) list.insertBefore(placeholder, before);
  } else if (dragColumn) {
    e.preventDefault();
    const before = insertBefore($("bCols"), ".col:not(.dragging):not(.col-inbox)", e.clientX, "x") || $("bAddCol");
    $("bCols").insertBefore($("bCols").querySelector(`.col[data-col="${dragColumn}"]`), before);
  }
});

$("bCols").addEventListener("drop", e => {
  e.preventDefault();
  if (dragCard?.inbox && placeholder.parentNode) {
    const to = columnOf(placeholder.parentNode.dataset.col);
    const index = [...placeholder.parentNode.children].filter(el => !el.classList.contains("col-empty")).indexOf(placeholder);
    inboxToCard(dragCard.inbox, to, index);
    return;
  }
  if (dragCard && placeholder.parentNode) {
    const to = columnOf(placeholder.parentNode.dataset.col);
    const from = columnOf(dragCard.from);
    const card = findCard(from, dragCard.id);
    // the index among the cards that stay, so moving within a column works too
    const index = [...placeholder.parentNode.children]
      .filter(el => !el.classList.contains("dragging") && !el.classList.contains("col-empty")).indexOf(placeholder);
    from.cards = from.cards.filter(c => c !== card);
    to.cards.splice(index, 0, card);
  } else if (dragColumn) {
    const order = [...$("bCols").querySelectorAll(".col")].map(el => el.dataset.col);
    board.columns.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }
  saveBoard();
});

$("bCols").addEventListener("dragend", () => {
  dragCard = dragColumn = null;
  placeholder.remove();
  renderBoard();
});
