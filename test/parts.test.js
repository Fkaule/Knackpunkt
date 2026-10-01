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
  }
});

test("Baukasten: Code hin und zurück, Kragarm wie das feste Bauteil bemessen", () => {
  const raw = { tx: 16, ty: 8, cells: new Uint8Array(128).fill(1),
    supports: [{ kind: "wand", side: "left", tiles: Array.from({ length: 8 }, (_, y) => [0, y]) }],
    load: { side: "right", tiles: [[15, 3], [15, 4]], deg: -90 } };
  const d = PARTS.fromCode(PARTS.encode(raw));
  assert.ok(d);
  assert.strictEqual(Math.round(Math.hypot(d.loads[0].fx, d.loads[0].fy)), 10000);
  assert.deepStrictEqual(d.supports[0].tiles, raw.supports[0].tiles);
  for (const bad of ["", "1g8.x.wL008.Rf326", "1g8._____________________w.wL008.Rf329", "1g8._____________________w.fL008.Rf326"])
    assert.strictEqual(PARTS.fromCode(bad), null, bad);
});

test("Baukasten: verständliche Gründe, wenn etwas fehlt", () => {
  const base = { tx: 4, ty: 2, cells: new Uint8Array(8).fill(1),
    supports: [{ kind: "wand", side: "left", tiles: [[0, 0], [0, 1]] }], load: { side: "right", tiles: [[3, 1]], deg: -90 } };
  assert.ok(PARTS.build(base).def);
  assert.strictEqual(PARTS.build({ ...base, cells: new Uint8Array(8) }).error, "leer");
  assert.strictEqual(PARTS.build({ ...base, cells: Uint8Array.from([1, 0, 1, 1, 1, 0, 1, 1]) }).error, "zerfallen");
  assert.strictEqual(PARTS.build({ ...base, supports: [] }).error, "lager");
  assert.strictEqual(PARTS.build({ ...base, load: null }).error, "last");
  assert.strictEqual(PARTS.build({ ...base, supports: [{ kind: "los", side: "bottom", tiles: [[0, 0]] }] }).error, "beweglich");
  assert.strictEqual(PARTS.build({ ...base, load: { side: "left", tiles: [[1, 1]], deg: -90 } }).error, "kante");
});
