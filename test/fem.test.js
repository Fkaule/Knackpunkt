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
    // Verschiebung eines Rasterknotens (i, j), Richtung d: abgelegt je Kachel und Knoten der Kachel
    const R = FEM.M + 1, du = (i, j, d) => {
      const tx = Math.min(L.TX - 1, Math.floor(i / FEM.M)), ty = Math.min(L.TY - 1, Math.floor(j / FEM.M));
      return r.disp[((tx + ty * L.TX) * R * R + (j - ty * FEM.M) * R + (i - tx * FEM.M)) * 2 + d];
    };
    let s = 0, c = 0;
    for (let ey = 0; ey < L.ny; ey++) { s += du(L.nx, ey, 1) + du(L.nx, ey + 1, 1); c += 2; }
    const Lb = TX * 10, Hb = TY * 10, t = 10, E = 210000, G = E / 2.6, I = t * Hb ** 3 / 12, A = t * Hb;
    const timo = F * Lb ** 3 / (3 * E * I) + F * Lb / (5 / 6 * G * A);
    assert.ok(Math.abs(-s / c / timo - 1) < 0.005, `Durchbiegung weicht ab (H = ${Hb} mm)`);
    const exm = L.nx / 2, e = exm + (L.ny - 1) * L.nx;
    let sx = 0;
    const ex = e % L.nx, ey = (e - ex) / L.nx;
    [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([a, b], n) => {
      sx += FEM.S[2 * n] * du(ex + a, ey + b, 0) + FEM.S[2 * n + 1] * du(ex + a, ey + b, 1);
    });
    const sxb = F * (Lb - (exm + 0.5) * 2.5) * (Hb / 2 - 1.25) / I;
    assert.ok(Math.abs(sx / sxb - 1) < 0.005, `Biegespannung weicht ab (H = ${Hb} mm)`);
  }
});

const bruecke = { tx: 20, ty: 6,
  supports: [{ kind: "fest", tiles: [[0, 0]], side: "bottom", fix: 3, lock: true }, { kind: "los", tiles: [[19, 0]], side: "bottom", fix: 2, lock: true }],
  loads: [{ tiles: [[9, 5], [10, 5]], side: "top", fx: 0, fy: -20000 }] };

test("Fest- und Loslager sind Gelenke: Brücke nur auf dem Loslager oder nur auf dem Festlager ist ein Mechanismus", () => {
  const L = FEM.level(bruecke);
  const only = f => Uint8Array.from({ length: L.nT }, (_, k) => f(k % L.TX, Math.floor(k / L.TX)) ? 1 : 0);
  assert.strictEqual(FEM.analyze(L, only((x, y) => x >= 9 || (x === 0 && y === 0))).reason, "mechanismus");
  assert.strictEqual(FEM.analyze(L, only((x, y) => x <= 10 || (x === 19 && y === 0))).reason, "mechanismus");
  const r = FEM.analyze(L, L.domain);
  assert.ok(r.ok && Math.abs(r.maxUtil - 0.530) < 0.002, `Vollteil ${r.maxUtil}`);
  assert.strictEqual(r.tileUtil[0], 0);   // Lagerplatte ohne Nachweis
  // Kragträger: auf einem Festlager dreht er sich, auf zweien nebeneinander trägt er
  const krag = tiles => FEM.level({ tx: 8, ty: 2, supports: tiles.map(t => ({ kind: "fest", tiles: [t], side: "bottom", fix: 3, lock: true })),
    loads: [{ tiles: [[7, 1]], side: "top", fx: 0, fy: -500 }] });
  const k1 = krag([[0, 0]]), k2 = krag([[0, 0], [1, 0]]);
  assert.strictEqual(FEM.analyze(k1, k1.domain).reason, "mechanismus");
  assert.ok(FEM.analyze(k2, k2.domain).ok);
});

test("Lager halten nur, was die Lagerkante mit einer ganzen Seite berührt, nicht mit einer Ecke", () => {
  const lw = { tx: 12, ty: 12, cut: [], supports: [{ kind: "wand", tiles: [0, 1, 2, 3, 4].map(x => [x, 11]), side: "top", fix: 3 }],
    loads: [{ tiles: [[11, 2]], side: "right", fx: 0, fy: -6000 }] };
  for (let x = 5; x < 12; x++) for (let y = 5; y < 12; y++) lw.cut.push([x, y]);
  const L = FEM.level(lw), s = L.domain.slice();
  s[0 + 11 * 12] = 4; s[4 + 11 * 12] = 2;   // zwei halbe Kacheln an der Decke, jeweils mit der Spitze an der Wand
  const r = FEM.analyze(L, s);
  assert.ok(r.reason === "spannung" && r.maxUtil > 1.05, `L-Winkel ${r.reason} ${r.maxUtil}`);
  // umgekehrt: Kragarm hält, obwohl die Ecke unten links an der Wand fehlt (die Spitze trug vorher Zug)
  const K = FEM.level({ tx: 16, ty: 8, supports: [{ kind: "wand", tiles: col(0, 8), side: "left", fix: 3 }],
    loads: [{ tiles: [[15, 3], [15, 4]], side: "right", fx: 0, fy: -10000 }] });
  const k = K.domain.slice();
  k[0 + 7 * 16] = 2; k[0 + 6 * 16] = 0;
  assert.ok(FEM.analyze(K, k).ok);
});

test("Zwei Lasten, die sich an einer Ecke treffen, überlagern sich exakt", () => {
  const def = { tx: 4, ty: 4, cut: [[3, 3]], supports: [{ tiles: col(0, 4), side: "left", fix: 3 }],
    loads: [{ tiles: [[2, 3]], side: "right", fx: 0, fy: -2000 }, { tiles: [[3, 2]], side: "top", fx: 0, fy: -2000 }] };
  const disp = loads => { const L = FEM.level({ ...def, loads }), s = L.domain.slice(); s[2 + 2 * 4] = 0; return FEM.analyze(L, s).disp; };
  const ab = disp(def.loads), a = disp([def.loads[0]]), b = disp([def.loads[1]]);
  let err = 0, max = 0;
  for (let i = 0; i < ab.length; i++) { err = Math.max(err, Math.abs(ab[i] - a[i] - b[i])); max = Math.max(max, Math.abs(ab[i])); }
  assert.ok(err < 1e-5 * max, `Überlagerung weicht um ${err / max} ab`);
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
