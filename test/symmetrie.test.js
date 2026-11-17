// Symmetrie-Lager (seit 0.15.0): Das Halbmodell rechnet wie das ganze Bauteil.
// Beispiel aus dem FEM-Kurs, Praktikum 4: Balken 300 x 60 mm mit Fest- und Loslager und 25 kN auf der ganzen Oberseite,
// als Halbmodell 150 x 60 mm mit Loslager links, Symmetrie rechts und 12,5 kN.
const test = require("node:test");
const assert = require("node:assert");
const FEM = require("../src/fem.js");
const PARTS = require("../src/parts.js");

const GANZ = "2u6.______________________________.fB001lBt01.T05u66y";
const HALB = "2f6._______________.lB001sRe06.T05f63h";
const MIRROR = [0, 1, 3, 2, 5, 4];   // Kachelzustand gespiegelt an einer senkrechten Achse (halbe Kacheln tauschen die Seite)

function eso(def) {
  const L = FEM.level(def), gen = FEM.eso(L);
  let it;
  do it = gen.next(); while (!it.done);
  return it.value.solid;
}
// Entwurf des Halbmodells (15 x 6) an der rechten Kante gespiegelt auf den ganzen Balken (30 x 6)
function spiegeln(halb) {
  const ganz = new Uint8Array(30 * 6);
  for (let y = 0; y < 6; y++) for (let x = 0; x < 15; x++) {
    const s = halb[x + y * 15];
    ganz[x + y * 30] = s; ganz[29 - x + y * 30] = MIRROR[s];
  }
  return ganz;
}

test("Symmetrie: Code hin und zurück, Lager hält nur senkrecht zur Kante", () => {
  const raw = { tx: 15, ty: 6, cells: new Uint8Array(90).fill(1),
    supports: [{ kind: "los", side: "bottom", tiles: [[0, 0]] }, { kind: "sym", side: "right", tiles: Array.from({ length: 6 }, (_, y) => [14, y]) }],
    loads: [{ side: "top", tiles: Array.from({ length: 15 }, (_, x) => [x, 5]), deg: -90, kn: 12.5 }] };
  assert.strictEqual(PARTS.encode(raw), HALB);
  const d = PARTS.fromCode(HALB);
  assert.ok(d);
  assert.deepStrictEqual(d.supports.map(s => [s.kind, s.side, s.tiles.length, s.fix]), [["los", "bottom", 1, 2], ["sym", "right", 6, 1]]);
  assert.strictEqual(PARTS.build({ ...raw, supports: [raw.supports[0], { ...raw.supports[1], side: "left", tiles: [[3, 2]] }] }).error, "kante");   // innen, keine Außenkante
  // nur Symmetrie, kein Lager: beweglich; Symmetrie oben oder unten hält senkrecht (y)
  assert.strictEqual(PARTS.build({ ...raw, supports: raw.supports.slice(1), auto: false }).error, "beweglich");
  const unten = PARTS.fromCode("2f6._______________.sB00flL001.T05f63h");   // ganze Unterkante Symmetrie, links ein Loslager
  assert.ok(unten && unten.supports[0].fix === 2 && unten.supports[0].tiles.length === 15);
});

test("Symmetrie: Halbmodell wie der ganze Balken (Vollteil und gespiegelter Entwurf)", () => {
  const G = PARTS.fromCode(GANZ), H = PARTS.fromCode(HALB);
  const LG = FEM.level(G), LH = FEM.level(H);
  const rG = FEM.analyze(LG, LG.domain), rH = FEM.analyze(LH, LH.domain);
  assert.ok(rG.ok && rH.ok);
  assert.ok(Math.abs(rG.maxUtil - rH.maxUtil) < 1e-9, `ganz ${rG.maxUtil}, halb ${rH.maxUtil}`);
  assert.ok(rH.maxUtil > 0.5 && rH.maxUtil < 0.55, `Auslastung ${rH.maxUtil}`);
  // Entwurf des Algorithmus im Halbmodell, gespiegelt im ganzen Balken: gleiche Auslastung, gleiche Fläche
  const h = eso(H), rh = FEM.analyze(LH, h), rg = FEM.analyze(LG, spiegeln(h));
  assert.ok(rh.ok && rg.ok);
  assert.ok(Math.abs(rh.maxUtil - rg.maxUtil) < 1e-9, `halb ${rh.maxUtil}, gespiegelt ${rg.maxUtil}`);
  assert.ok(Math.abs(FEM.area(h, rh.conn) * 2 - FEM.area(spiegeln(h), rg.conn)) < 1e-9);
});

test("Symmetrie: Was nur an der Symmetriekante hängt, fällt ab wie im ganzen Balken", () => {
  const H = PARTS.fromCode(HALB), G = PARTS.fromCode(GANZ), LH = FEM.level(H), LG = FEM.level(G);
  const k = (x, y) => x + y * 15, h = LH.domain.slice();
  for (const [x, y] of [[13, 2], [14, 1], [14, 3]]) h[k(x, y)] = 0;   // Insel (14, 2) hängt nur noch an der Symmetriekante
  const rh = FEM.analyze(LH, h), rg = FEM.analyze(LG, spiegeln(h));
  assert.ok(rh.ok, `Halbmodell: ${rh.reason}`);
  assert.ok(rg.ok, `ganzer Balken: ${rg.reason}`);
  assert.strictEqual(rh.conn[k(14, 2)], 0);
  assert.strictEqual(rg.conn[14 + 2 * 30], 0);
  assert.ok(Math.abs(rh.maxUtil - rg.maxUtil) < 1e-9, `halb ${rh.maxUtil}, ganz ${rg.maxUtil}`);
});
