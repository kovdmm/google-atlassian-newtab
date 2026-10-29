// node tools/render_mermaid.cjs docs/board-states.md docs/board-states.svg [preview.png] – renders the first ```mermaid block locally in headless Chrome
const { chromium } = require("../tests/pw.cjs");
const fs = require("fs");
const [md, svgOut, pngOut] = process.argv.slice(2);
const src = fs.readFileSync(md, "utf8").match(/```mermaid\n([\s\S]*?)```/)[1];
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const p = await browser.newPage({ viewport: { width: 1800, height: 1200 }, deviceScaleFactor: 1.5 });
  await p.setContent('<body style="margin:0;background:#fff"><div id="out"></div></body>');
  await p.addScriptTag({ url: "https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js" });
  const svg = await p.evaluate(async src => {
    mermaid.initialize({ startOnLoad: false, theme: "default", securityLevel: "strict", state: { useMaxWidth: false } });
    const { svg } = await mermaid.render("d", src);
    document.getElementById("out").innerHTML = svg;
    return svg;
  }, src);
  fs.writeFileSync(svgOut, svg);
  if (pngOut) await (await p.$("#out svg")).screenshot({ path: pngOut });
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
