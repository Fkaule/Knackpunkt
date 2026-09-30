// Baut aus src/shell.html, src/fem.js und src/game.js:
// game.html (Seitenfragment für claude.ai-Artifact und Server) und docs/index.html (vollständige Seite für GitHub Pages)
import fs from "node:fs";

const src = f => fs.readFileSync(new URL("./src/" + f, import.meta.url), "utf8");
const page = src("shell.html")
  .replace("<!--FEM-->", () => src("fem.js"))
  .replace("<!--GAME-->", () => src("game.js"));
fs.writeFileSync(new URL("./game.html", import.meta.url), page);
fs.mkdirSync(new URL("./docs/", import.meta.url), { recursive: true });
fs.writeFileSync(new URL("./docs/index.html", import.meta.url), '<!doctype html>\n<html lang="de">\n<meta charset="utf-8">\n'
  + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<style>body{margin:0}</style>\n' + page);
fs.writeFileSync(new URL("./docs/.nojekyll", import.meta.url), "");
console.log(`game.html und docs/index.html gebaut, ${page.length} Zeichen`);
