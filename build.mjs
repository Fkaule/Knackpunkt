// Baut aus src/shell.html, src/fem.js, src/parts.js, src/ticket.js und src/game.js:
// game.html (Seitenfragment für claude.ai-Artifact und Server) und index.html (vollständige Seite für GitHub Pages)
import fs from "node:fs";

const src = f => fs.readFileSync(new URL("./src/" + f, import.meta.url), "utf8");
const page = src("shell.html")
  .replace("<!--FEM-->", () => src("fem.js"))
  .replace("<!--PARTS-->", () => src("parts.js"))
  .replace("<!--TICKET-->", () => src("ticket.js"))
  .replace("<!--GAME-->", () => src("game.js"));
fs.writeFileSync(new URL("./game.html", import.meta.url), page);
fs.writeFileSync(new URL("./index.html", import.meta.url), '<!doctype html>\n<html lang="de">\n<meta charset="utf-8">\n'
  + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<style>body{margin:0}</style>\n' + page);
console.log(`game.html und index.html gebaut, ${page.length} Zeichen`);
