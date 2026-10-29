// =====================================================================================
// Settings → Data: everything the extension keeps – settings with every checkbox, shortcuts, the board – in one
// JSON file, to move to another computer or another copy of the extension at once. Import replaces it all after
// a confirmation and reloads the page. Access to Atlassian sites is Chrome's, not ours: it is asked for again
// =====================================================================================

const dataMsg = (text, cls = "") => showMsg("sDataMsg", text, cls);

// What an import takes from the file, each checked like its own import does; anything else is left out
const DATA_KEYS = {
  settings: v => (v && typeof v === "object" && !Array.isArray(v) ? v : undefined),
  links: v => (Array.isArray(v) ? parseLinks(v) : undefined),
  board: v => normalizeBoard(v) || undefined,
  onboarded: v => (typeof v === "boolean" ? v : undefined),
  inboxHidden: v => (Array.isArray(v) ? v.filter(id => typeof id === "string") : undefined),
  boardIssues: v => (v && typeof v === "object" && !Array.isArray(v) ? v : undefined),
};

$("sDataExport").onclick = async () => downloadJson({
  app: "jumpstart",
  kind: "all",
  version: 1,
  data: await chrome.storage.local.get(null),
}, "jumpstart-all-data.json");

$("sDataImport").onclick = () => $("sDataFile").click();
$("sDataFile").onchange = async e => {
  const file = await pickedJson(e);
  if (file === undefined) return;
  const src = file?.app === "jumpstart" && file.kind === "all" && file.data;
  const data = {};
  if (src && typeof src === "object") {
    Object.entries(DATA_KEYS).forEach(([key, check]) => {
      const value = key in src ? check(src[key]) : undefined;
      if (value !== undefined) data[key] = value;
    });
  }
  if (!Object.keys(data).length) return dataMsg(t("dataImportBad"), "bad");
  if (!(await confirmDialog(t("dataImportTitle"), t("dataImportText"), t("dataImportOk")))) return;
  await chrome.storage.local.clear();
  await chrome.storage.local.set(data);
  // the copies theme.js paints the first frame from belong to the old settings
  try { localStorage.clear(); } catch {}
  location.reload();
};
