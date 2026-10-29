// Shared by the tests: playwright-core, the extension folder and the folder for test output.
// playwright-core is not installed in the project (node_modules in an unpacked extension breaks loading it):
// it is taken from PLAYWRIGHT_CORE, a global install, or the npx cache of `npx playwright`
const path = require("path"), fs = require("fs"), os = require("os");

function findPlaywright() {
  const tries = [process.env.PLAYWRIGHT_CORE, "playwright-core"].filter(Boolean);
  for (const name of tries) {
    try { return require(name); } catch {}
  }
  const cache = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), ".npm"), "npm-cache", "_npx");
  for (const dir of fs.existsSync(cache) ? fs.readdirSync(cache) : []) {
    const candidate = path.join(cache, dir, "node_modules", "playwright-core");
    if (fs.existsSync(candidate)) return require(candidate);
  }
  throw new Error("playwright-core not found: run `npx playwright --version` once, or set PLAYWRIGHT_CORE to its folder");
}

const EXT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });

module.exports = { chromium: findPlaywright().chromium, EXT, OUT };
