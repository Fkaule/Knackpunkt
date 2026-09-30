// Baut game.html (Seitenfragment für claude.ai-Artifact und Server) aus src/shell.html, src/fem.js und src/game.js
import fs from "node:fs";

const src = f => fs.readFileSync(new URL("./src/" + f, import.meta.url), "utf8");
const page = src("shell.html")
  .replace("<!--FEM-->", () => src("fem.js"))
  .replace("<!--GAME-->", () => src("game.js"));
fs.writeFileSync(new URL("./game.html", import.meta.url), page);
console.log(`game.html gebaut, ${page.length} Zeichen`);
