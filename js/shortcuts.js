// Shortcuts: 8 tiles under the search box, like the native new tab page, and their part of the settings dialog.

// =====================================================================================
// Shortcuts: 8 tiles, draggable, stored in chrome.storage.local
// =====================================================================================

let links = []; // [{ name, url }]

// Shortcut icons come from Google's favicon service, like the native new tab page: Chrome's cache keeps the icon
// of a specific page (e.g. Gmail with an unread counter). Only the origin is sent; offline – Chrome's cache is used
function shortcutIconUrl(url) {
  try {
    return `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(new URL(url).origin)}`;
  } catch {
    return faviconUrl(url);
  }
}

// First run: shortcuts are taken from Chrome's most visited sites
async function linksFromTopSites() {
  try {
    return (await chrome.topSites.get())
      .filter(site => /^https?:/i.test(site.url))
      .slice(0, MAX_LINKS)
      .map(site => {
        const host = new URL(site.url).hostname.replace(/^www\./, "");
        // drop unread counters like "(12) Inbox"
        return { name: (site.title || "").replace(/^\(\d+\)\s*/, "").trim() || host, url: site.url };
      });
  } catch {
    return [];
  }
}

async function loadLinks() {
  let saved = await store.get("links", null);
  if (!saved) {
    saved = await linksFromTopSites();
    await store.set("links", saved);
  }
  links = saved.slice(0, MAX_LINKS);
}

// On a narrow window the search box and the shortcut grid share one width: as many 112px tiles as fit, up to 5
const TILE_W = 112, MAX_NARROW_COLS = 5;
function fitGrid() {
  const main = document.querySelector("main"), cs = getComputedStyle(main);
  const avail = main.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const cols = Math.max(1, Math.min(MAX_NARROW_COLS, Math.floor(avail / TILE_W)));
  document.documentElement.style.setProperty("--grid-w", cols * TILE_W + "px");
}
new ResizeObserver(fitGrid).observe(document.querySelector("main"));

// Like the native new tab page: hover highlight and a single ⋮ button; removing is done in the edit dialog
const MORE_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>';
const PLUS_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>';

let dragFrom = null, editIndex = null;

function saveLinks() {
  store.set("links", links);
  renderLinks();
}

function renderLinks() {
  const tiles = links.map((link, i) => `
    <a class="sc" draggable="true" data-i="${i}" href="${esc(link.url)}">
      <div class="ic"><img src="${shortcutIconUrl(link.url)}" data-fallback="${faviconUrl(link.url)}" alt=""></div>
      <div class="lbl">${esc(link.name)}</div>
      <button class="more" data-i="${i}" title="${esc(t("editShortcut"))}" aria-label="${esc(t("editShortcut"))}">${MORE_ICON}</button>
    </a>`).join("");
  const addTile = links.length < MAX_LINKS
    ? `<button class="sc add" id="addBtn"><div class="ic">${PLUS_ICON}</div><div class="lbl">${t("addShortcut")}</div></button>`
    : "";
  $("shortcuts").innerHTML = tiles + addTile;

  // drag & drop reordering
  document.querySelectorAll(".sc[data-i]").forEach(el => {
    const i = +el.dataset.i;
    el.addEventListener("dragstart", e => {
      dragFrom = i;
      el.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(i));
    });
    el.addEventListener("dragend", () => { dragFrom = null; renderLinks(); });
    el.addEventListener("dragover", e => {
      if (dragFrom === null) return;
      e.preventDefault();
      el.classList.add("over");
    });
    el.addEventListener("dragleave", () => el.classList.remove("over"));
    el.addEventListener("drop", e => {
      e.preventDefault();
      if (dragFrom === null || dragFrom === i) return;
      const [moved] = links.splice(dragFrom, 1);
      links.splice(i, 0, moved);
      dragFrom = null;
      saveLinks();
    });
  });

  document.querySelectorAll(".sc .more").forEach(btn => {
    btn.onclick = e => {
      e.preventDefault();
      e.stopPropagation();
      openShortcutDialog(+btn.dataset.i);
    };
  });
  $("addBtn")?.addEventListener("click", () => openShortcutDialog(null));

  // Inline onerror is blocked by the extension CSP – the fallback icon source is attached here
  document.querySelectorAll(".sc .ic img[data-fallback]").forEach(img =>
    img.addEventListener("error", () => {
      img.src = img.dataset.fallback;
      img.removeAttribute("data-fallback");
    }, { once: true }));
}

// Add / edit dialog (index null – new shortcut)
function openShortcutDialog(i) {
  editIndex = i;
  $("addTitle").textContent = t(i === null ? "addShortcut" : "editShortcut");
  setInvalid("addUrl", false);
  $("addName").value = i === null ? "" : links[i].name;
  $("addUrl").value = i === null ? "" : links[i].url;
  $("addRemove").hidden = i === null;
  $("addDlg").showModal();
}

$("addCancel").onclick = () => $("addDlg").close();
$("addRemove").onclick = () => {
  links.splice(editIndex, 1);
  saveLinks();
  $("addDlg").close();
};
$("addUrl").addEventListener("input", () => setInvalid("addUrl", false));
$("addForm").onsubmit = e => {
  e.preventDefault();
  const name = $("addName").value.trim();
  let url = $("addUrl").value.trim();
  if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
  let host;
  try { host = new URL(url).hostname; } catch { host = ""; }
  if (!host.includes(".") && host !== "localhost") {
    setInvalid("addUrl", true);
    $("addUrl").focus();
    return;
  }
  const link = { name: name || host, url };
  if (editIndex === null) {
    if (links.length >= MAX_LINKS) return;
    links.push(link);
  } else {
    links[editIndex] = link;
  }
  saveLinks();
  $("addDlg").close();
};

// =====================================================================================
// Settings → General → Shortcuts: from most visited, import / export
// =====================================================================================

const linksMsg = (key, cls = "", ...args) => showMsg("sLinksMsg", t(key, ...args), cls);

// Understands our own export, a plain array and Chrome's Preferences file (native new tab shortcuts – custom_links)
function parseLinks(data) {
  const list = Array.isArray(data) ? data : data?.links || data?.custom_links?.list || [];
  return list.map(item => {
    try {
      const u = new URL(withScheme(String(item?.url || "").trim()));
      return { name: String(item.name || item.title || u.hostname).trim(), url: u.href };
    } catch {
      return null;
    }
  }).filter(Boolean).slice(0, MAX_LINKS);
}

$("sTopSites").onclick = async () => {
  const top = await linksFromTopSites();
  if (!top.length) return;
  links = top;
  saveLinks();
  $("sTopSites").disabled = true;
  $("sTopSites").textContent = t("shortcutsFilled");
};
$("sImport").onclick = () => $("sImportFile").click();
$("sImportFile").onchange = async e => {
  const data = await pickedJson(e);
  if (data === undefined) return;
  const imported = parseLinks(data);
  if (!imported.length) return linksMsg("shortcutsImportBad", "bad");
  links = imported;
  saveLinks();
  linksMsg("shortcutsImported", "ok", imported.length);
};
$("sExport").onclick = () => downloadJson({ links }, "jumpstart-shortcuts.json");
