// Halbe Kacheln (Ecke abgeschnitten): Dreieckselemente, Zusammenhang über Kanten, Fläche, Glättung durch den Algorithmus
const test = require("node:test");
const assert = require("node:assert");
const FEM = require("../src/fem.js");

test("Dreieckselemente: Starrkörperbewegung ohne Kräfte, konstante Dehnung exakt", () => {
  const H = FEM.TILE / FEM.M, c = 210000 / (1 - 0.09);
  for (const t in FEM.TRI) {
    const pts = FEM.TRI[t].map(([a, b]) => [a * H, b * H]), K = FEM.TK[t], S = FEM.TS[t];
    for (const mode of [p => [1, 0], p => [0, 1], p => [-p[1], p[0]]]) {   // zwei Verschiebungen, eine Drehung
      const u = pts.flatMap(mode);
      for (let a = 0; a < 6; a++) assert.ok(Math.abs(K.slice(a * 6, a * 6 + 6).reduce((s, k, b) => s + k * u[b], 0)) < 1e-6);
    }
    const u = pts.flatMap(([x]) => [1e-3 * x, 0]);   // Dehnung 0,001 in x
    const sx = S.slice(0, 6).reduce((s, k, b) => s + k * u[b], 0), sy = S.slice(6, 12).reduce((s, k, b) => s + k * u[b], 0);
    assert.ok(Math.abs(sx - c * 1e-3) < 1e-9 && Math.abs(sy - 0.3 * c * 1e-3) < 1e-9, `Typ ${t}`);
  }
});

test("Halbe Kacheln: schräger Steg trägt, nur Eckkontakt trennt", () => {
  const L = FEM.level({ tx: 3, ty: 3, supports: [{ tiles: [[0, 0]], side: "left", fix: 3 }],
    loads: [{ tiles: [[2, 2]], side: "right", fx: 0, fy: -100 }] });
  const at = (cells) => Uint8Array.from({ length: 9 }, (_, k) => cells[k] || 0);
  const diagonal = { 0: 1, 4: 1, 8: 1 };                                   // nur Eckkontakt
  assert.strictEqual(FEM.analyze(L, at(diagonal)).reason, "lastpfad");
  const steg = { ...diagonal, 1: 3, 3: 5, 5: 3, 7: 5 };                     // Dreiecke an beiden Seiten der Diagonale
  const r = FEM.analyze(L, at(steg));
  assert.ok(r.ok && r.conn.every((c, k) => c === (steg[k] ? 1 : 0)), "Steg mit Dreiecken trägt");
  assert.strictEqual(r.area, 5);
  // Windrad: vier Dreiecke berühren eine Ecke, aber keine Kante gemeinsam, also vier getrennte Knoten
  const L2 = FEM.level({ tx: 2, ty: 2, supports: [{ tiles: [[0, 0]], side: "left", fix: 3 }],
    loads: [{ tiles: [[1, 1]], side: "right", fx: 0, fy: -100 }] });
  assert.strictEqual(FEM.analyze(L2, Uint8Array.from([5, 2, 4, 3])).reason, "lastpfad");
});

test("Algorithmus glättet mit abgeschnittenen Ecken und hält", () => {
  const col = (tx, n) => Array.from({ length: n }, (_, ty) => [tx, ty]);
  const L = FEM.level({ tx: 16, ty: 8, supports: [{ tiles: col(0, 8), side: "left", fix: 3 }],
    loads: [{ tiles: [[15, 3], [15, 4]], side: "right", fx: 0, fy: -10000 }] });
  const it = FEM.eso(L);
  let s;
  while (!(s = it.next()).done);
  const { res, order, cuts, solid } = s.value;
  assert.ok(res.ok && cuts.length > 0, "Glättung schneidet Ecken ab");
  assert.ok(FEM.area(solid, res.conn) < 128 - order.length, "nach dem Glätten weniger Material als nach ganzen Kacheln");
});
