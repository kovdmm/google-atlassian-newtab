# Jumpstart

A Chrome extension that replaces the new tab page: a Google-style page with search "enhanced with Atlassian" (Jira, Confluence, Bitbucket), shortcuts and a kanban board for Jira tasks, pull requests and your own notes.

## Install from a folder (unpacked)

Jumpstart has no build step: Chrome loads the folder as it is. Works the same on Windows, macOS and Linux.

1. Get the code into a folder on your computer:
   - on GitHub press **Code → Download ZIP** and unpack it, or
   - `git clone https://github.com/kovdmm/google-atlassian-newtab.git`
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (the switch in the top right corner).
4. Press **Load unpacked** and pick the folder that contains `manifest.json` (after unpacking a ZIP it can be one level deeper than the folder you chose).
5. Open a new tab. On the first install a welcome dialog asks for your name and e-mail (for the avatar); Jira, Confluence and Bitbucket are connected on the **Atlassian** tab of the settings (⋮ in the top right corner). Chrome asks for access to each site once.

Keep the folder where it is: Chrome reads the extension from it every time the browser starts. If you move or delete the folder, the extension is gone.

### Update

Replace the files in the folder (or `git pull`), then press the reload button on the extension's card in `chrome://extensions`. Your settings, shortcuts and board stay: they are stored in the browser, not in the folder.

### Move to another computer

Settings → **Data** exports all settings, shortcuts and the board into one JSON file; import it in the other copy. Access to Atlassian sites is not in the file, Chrome asks for it again.

### Troubleshooting

- "Manifest file is missing or unreadable" – you picked the wrong folder: it has to be the one with `manifest.json` directly inside.
- Do not install `node_modules` into the extension folder: it breaks loading the unpacked extension.
- The page doesn't change after an update – reload the extension in `chrome://extensions` and open a new tab.

## Search

- Enter runs a plain Google search. Settings → General → **Prefer Google AI Mode** makes AI Mode the main action instead; the other one is on Alt+Enter (Option+Return on a Mac).
- A task number ("123", "sf123", "SF-123") opens the task; for a bare number set the **Project key** on the Atlassian tab.
- `jql: …` runs a JQL query in Jira, `cql: …` a CQL query in Confluence (for example `cql: title ~ "release" and space = SLAM`): Enter opens the query on the site, the found tasks or pages are listed below.
- Ctrl+Enter (Cmd+Return on a Mac) searches Jira.

## For developers

How the code is organized and how to run the tests: [DEVELOPMENT.md](DEVELOPMENT.md). What was built and why: [docs/work-log.md](docs/work-log.md).
