// Startup: loads the settings and the shortcuts, restores the caches and draws the page.
// Loaded last, so every other script is there when the page is drawn for the first time.

(async () => {
  settings = { ...DEFAULT_SETTINGS, ...(await store.get("settings", {})) };
  await loadLinks();
  await restoreSessionCaches();
  await applySettings();

  // First install: open the settings with a welcome text (only once, and not for users who already saved settings)
  const firstRun = !(await store.get("onboarded", false)) && !(await store.get("settings", null));
  if (firstRun) openSettings(true);
})();
