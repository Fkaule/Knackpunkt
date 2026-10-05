// Zufallsbauteile: gleiche Nummer gleiches Bauteil, jedes Bauteil gültig und wie die festen Bauteile ausgelastet
const test = require("node:test");
const assert = require("node:assert");
const FEM = require("../src/fem.js");
const PARTS = require("../src/parts.js");

test("Zufallsbauteile: gleiche Nummer, gleiches Bauteil", () => {
  for (const nr of [1, 4711, 99999]) assert.deepStrictEqual(PARTS.generate(nr), PARTS.generate(nr));
  assert.notDeepStrictEqual(PARTS.generate(1), PARTS.generate(2));
});

test("Zufallsbauteile: Vollteil hält, zu 45 bis 65 % ausgelastet, Lager und Last an freien Kanten", () => {
  const out = { left: [-1, 0], right: [1, 0], top: [0, 1], bottom: [0, -1] };
  for (let nr = 1; nr <= 300; nr++) {
    const d = PARTS.generate(nr);
    assert.ok(d, `Nr. ${nr} ohne Bauteil`);
    const L = FEM.level(d), r = FEM.analyze(L, L.domain);
    assert.ok(r.ok, `Nr. ${nr} hält als Vollteil nicht (${r.reason})`);
    assert.ok(r.maxUtil > 0.45 && r.maxUtil < 0.65, `Nr. ${nr}: Auslastung ${r.maxUtil}`);
    assert.ok(r.conn.every((c, k) => c === L.domain[k]), `Nr. ${nr}: Vollteil nicht zusammenhängend`);
    for (const g of [...d.supports, ...d.loads]) for (const [x, y] of g.tiles) {
      const [dx, dy] = out[g.side], has = (a, b) => a >= 0 && b >= 0 && a < L.TX && b < L.TY && L.domain[a + b * L.TX];
      assert.ok(has(x, y) && !has(x + dx, y + dy), `Nr. ${nr}: Kachel ${x},${y} liegt nicht an einer freien Kante`);
    }
    for (const l of d.loads) l.tiles.slice(1).forEach(([x, y], i) => {
      const [px, py] = l.tiles[i];
      assert.strictEqual(Math.abs(x - px) + Math.abs(y - py), 1, `Nr. ${nr}: Lastkacheln liegen nicht nebeneinander`);
    });
  }
});

test("Zufallsbauteile: Rahmen mit Riegellast hat nebeneinander liegende Lastkacheln; Träger auf einer Dreiecksspitze ist beweglich", () => {
  const d = PARTS.generate(1597);   // bis 0.12.1 lagen die beiden Lastkacheln hier sechs Kacheln auseinander
  assert.strictEqual(d.name, "Rahmen");
  assert.deepStrictEqual(d.loads[0].tiles.map(([x]) => x - d.loads[0].tiles[0][0]), [0, 1]);
  const t = PARTS.generate(37), L = FEM.level(t), s = L.domain.slice(), k = (x, y) => x + y * L.TX;
  s[k(16, 0)] = 5; s[k(15, 1)] = 0; s[k(14, 0)] = 0;   // nur noch die Spitze einer halben Kachel am Festlager
  assert.strictEqual(FEM.analyze(L, s).reason, "mechanismus");
});

test("Baukasten: Code hin und zurück, mehrere Lasten mit Richtung und Betrag, alte Links weiter gültig", () => {
  const kN = l => Math.round(Math.hypot(l.fx, l.fy)) / 1000, deg = l => Math.round(Math.atan2(l.fy, l.fx) * 180 / Math.PI);
  const raw = { tx: 16, ty: 8, cells: new Uint8Array(128).fill(1),
    supports: [{ kind: "wand", side: "left", tiles: Array.from({ length: 8 }, (_, y) => [0, y]) }],
    loads: [{ side: "right", tiles: [[15, 3], [15, 4]], deg: -90, kn: 10 }, { side: "top", tiles: [[8, 7]], deg: -45, kn: 2.5 }] };
  const d = PARTS.fromCode(PARTS.encode(raw));
  assert.ok(d);
  assert.deepStrictEqual(d.loads.map(l => [kN(l), deg(l)]), [[10, -90], [2.5, -45]]);
  assert.deepStrictEqual(d.loads[1].tiles, [[8, 7]]);
  assert.deepStrictEqual(d.supports[0].tiles, raw.supports[0].tiles);
  // automatisch: alle Lasten gleich groß, eine Last am Kragarm wie beim festen Bauteil
  assert.deepStrictEqual(PARTS.build({ ...raw, auto: true }).def.loads.map(kN), [6, 6]);
  assert.strictEqual(kN(PARTS.build({ ...raw, loads: raw.loads.slice(0, 1), auto: true }).def.loads[0]), 10);
  // Link aus Version 1 (eine Last ohne Betrag) wird wie bisher bemessen
  assert.strictEqual(kN(PARTS.fromCode("1g8._____________________w.wL008.Rf326").loads[0]), 10);
  for (const bad of ["", "1g8.x.wL008.Rf326", "1g8._____________________w.wL008.Rf329", "1g8._____________________w.fL008.Rf326",
    "2g8._____________________w.wL008.Rf326", "2g8._____________________w.wL008.Rf3260", "2g8._____________________w.wL008.Rf326zz"])
    assert.strictEqual(PARTS.fromCode(bad), null, bad);
});

test("Baukasten: verständliche Gründe, wenn etwas fehlt", () => {
  const base = { tx: 4, ty: 2, cells: new Uint8Array(8).fill(1),
    supports: [{ kind: "wand", side: "left", tiles: [[0, 0], [0, 1]] }], loads: [{ side: "right", tiles: [[3, 1]], deg: -90, kn: 1 }], auto: true };
  assert.ok(PARTS.build(base).def);
  assert.strictEqual(PARTS.build({ ...base, cells: new Uint8Array(8) }).error, "leer");
  assert.strictEqual(PARTS.build({ ...base, cells: Uint8Array.from([1, 0, 1, 1, 1, 0, 1, 1]) }).error, "zerfallen");
  assert.strictEqual(PARTS.build({ ...base, supports: [] }).error, "lager");
  assert.strictEqual(PARTS.build({ ...base, loads: [] }).error, "last");
  assert.strictEqual(PARTS.build({ ...base, supports: [{ kind: "los", side: "bottom", tiles: [[0, 0]] }] }).error, "beweglich");
  assert.strictEqual(PARTS.build({ ...base, supports: [{ kind: "fest", side: "bottom", tiles: [[0, 0]] }] }).error, "beweglich");   // dreht sich ums Gelenk
  assert.ok(PARTS.build({ ...base, supports: [{ kind: "fest", side: "bottom", tiles: [[0, 0]] }, { kind: "los", side: "bottom", tiles: [[3, 0]] }] }).def);
  assert.strictEqual(PARTS.build({ ...base, loads: [{ side: "left", tiles: [[1, 1]], deg: -90, kn: 1 }] }).error, "kante");
  assert.strictEqual(PARTS.build({ ...base, loads: [{ side: "right", tiles: [[3, 1]], deg: -90, kn: 100 }], auto: false }).error, "voll");
});
