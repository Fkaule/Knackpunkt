// FE-Kern gegen Balkentheorie, Mechanismus-Erkennung und Richtwert des Algorithmus
const test = require("node:test");
const assert = require("node:assert");
const FEM = require("../src/fem.js");

const col = (tx, n) => Array.from({ length: n }, (_, ty) => [tx, ty]);

test("Kragbalken: Durchbiegung und Biegespannung wie Timoshenko-Balken", () => {
  for (const TY of [1, 2]) {
    const TX = 32, F = 1000;
    const L = FEM.level({ tx: TX, ty: TY, supports: [{ tiles: col(0, TY), side: "left", fix: 3 }],
      loads: [{ tiles: col(TX - 1, TY), side: "right", fx: 0, fy: -F }] });
    const r = FEM.analyze(L, L.domain);
    let s = 0, c = 0;
    for (let ey = 0; ey < L.ny; ey++) { const e = L.nx - 1 + ey * L.nx; s += r.disp[e * 8 + 3] + r.disp[e * 8 + 5]; c += 2; }
    const Lb = TX * 10, Hb = TY * 10, t = 10, E = 210000, G = E / 2.6, I = t * Hb ** 3 / 12, A = t * Hb;
    const timo = F * Lb ** 3 / (3 * E * I) + F * Lb / (5 / 6 * G * A);
    assert.ok(Math.abs(-s / c / timo - 1) < 0.005, `Durchbiegung weicht ab (H = ${Hb} mm)`);
    const exm = L.nx / 2, e = exm + (L.ny - 1) * L.nx;
    let sx = 0;
    for (let a = 0; a < 8; a++) sx += FEM.S[a] * r.disp[e * 8 + a];
    const sxb = F * (Lb - (exm + 0.5) * 2.5) * (Hb / 2 - 1.25) / I;
    assert.ok(Math.abs(sx / sxb - 1) < 0.005, `Biegespannung weicht ab (H = ${Hb} mm)`);
  }
});

const bruecke = { tx: 20, ty: 6,
  supports: [{ tiles: [[0, 0]], side: "bottom", fix: 3, lock: true }, { tiles: [[19, 0]], side: "bottom", fix: 2, lock: true }],
  loads: [{ tiles: [[9, 5], [10, 5]], side: "top", fx: 0, fy: -20000 }] };

test("Brücke nur auf dem Loslager ist ein Mechanismus, nur auf dem Festlager nicht", () => {
  const L = FEM.level(bruecke);
  const only = f => Uint8Array.from({ length: L.nT }, (_, k) => f(k % L.TX, Math.floor(k / L.TX)) ? 1 : 0);
  assert.strictEqual(FEM.analyze(L, only((x, y) => x >= 9 || (x === 0 && y === 0))).reason, "mechanismus");
  assert.strictEqual(FEM.analyze(L, only((x, y) => x <= 10 || (x === 19 && y === 0))).reason, "spannung");
});

test("Algorithmus entfernt beim Kragarm knapp 60 % und hält", () => {
  const L = FEM.level({ tx: 16, ty: 8, supports: [{ tiles: col(0, 8), side: "left", fix: 3 }],
    loads: [{ tiles: [[15, 3], [15, 4]], side: "right", fx: 0, fy: -10000 }] });
  const it = FEM.eso(L);
  let s;
  while (!(s = it.next()).done);
  const kept = s.value.res.conn.reduce((a, b) => a + b, 0);
  assert.ok(s.value.res.ok);
  assert.strictEqual(128 - kept, 75);
});
