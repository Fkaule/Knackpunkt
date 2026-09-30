/* FE-Kern: ebener Spannungszustand, quadratische Viereckelemente mit
   inkompatiblen Moden (kein Shear Locking), Band-Cholesky. Kein DOM. */
const FEM = (() => {
  const M = 4;                  // Elemente je Kachelkante
  const TILE = 10;              // Kachelkante in mm
  const H = TILE / M;           // Elementkante in mm
  const THICK = 10;             // Dicke in mm
  const E = 210000, NU = 0.3;   // Stahl, MPa
  const RE = 235;               // Streckgrenze S235 in MPa
  const TILE_G = TILE * TILE * THICK * 7.85e-3;   // Masse je Kachel in g

  // Elementsteifigkeit KE (8x8) und Spannungsmatrix S (3x8) im Elementmittelpunkt.
  // Knoten gegen den Uhrzeigersinn ab unten links, je Knoten (u, v).
  const { KE, S } = (() => {
    const c = E / (1 - NU * NU);
    const D = [c, c * NU, 0, c * NU, c, 0, 0, 0, c * (1 - NU) / 2];
    const XI = [-1, 1, 1, -1], ETA = [-1, -1, 1, 1];
    const B = (x, y) => {
      const b = new Float64Array(24);
      for (let n = 0; n < 4; n++) {
        const dx = XI[n] * (1 + ETA[n] * y) / (2 * H);
        const dy = ETA[n] * (1 + XI[n] * x) / (2 * H);
        b[2 * n] = dx; b[9 + 2 * n] = dy; b[16 + 2 * n] = dy; b[17 + 2 * n] = dx;
      }
      return b;
    };
    // K[a][b] += w * sum P[i][a] D[i][j] Q[j][b]
    const addPtDQ = (K, P, nP, Q, nQ, w) => {
      for (let a = 0; a < nP; a++) for (let b = 0; b < nQ; b++) {
        let s = 0;
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) s += P[i * nP + a] * D[i * 3 + j] * Q[j * nQ + b];
        K[a * nQ + b] += w * s;
      }
    };
    const Kuu = new Float64Array(64), Kua = new Float64Array(32), Kaa = new Float64Array(16);
    const g = 1 / Math.sqrt(3), w = THICK * H * H / 4;
    for (const x of [-g, g]) for (const y of [-g, g]) {
      const b = B(x, y);
      const G = new Float64Array(12);   // Moden (1-xi^2), (1-eta^2) für u und v
      G[0] = -4 * x / H; G[7] = -4 * y / H; G[9] = -4 * y / H; G[10] = -4 * x / H;
      addPtDQ(Kuu, b, 8, b, 8, w);
      addPtDQ(Kua, b, 8, G, 4, w);
      addPtDQ(Kaa, G, 4, G, 4, w);
    }
    // Kaa invertieren (Gauss-Jordan, 4x4)
    const A = Array.from(Kaa), I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    for (let p = 0; p < 4; p++) {
      const d = A[p * 5];
      for (let k = 0; k < 4; k++) { A[p * 4 + k] /= d; I[p * 4 + k] /= d; }
      for (let r = 0; r < 4; r++) if (r !== p) {
        const f = A[r * 4 + p];
        for (let k = 0; k < 4; k++) { A[r * 4 + k] -= f * A[p * 4 + k]; I[r * 4 + k] -= f * I[p * 4 + k]; }
      }
    }
    // statische Kondensation: K = Kuu - Kua Kaa^-1 Kau
    const K = Float64Array.from(Kuu);
    for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) {
      let s = 0;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) s += Kua[a * 4 + i] * I[i * 4 + j] * Kua[b * 4 + j];
      K[a * 8 + b] -= s;
    }
    // Im Mittelpunkt verschwinden die Ableitungen der inkompatiblen Moden: sigma = D B(0,0) u
    const b0 = B(0, 0), s = new Float64Array(24);
    for (let i = 0; i < 3; i++) for (let a = 0; a < 8; a++)
      for (let j = 0; j < 3; j++) s[i * 8 + a] += D[i * 3 + j] * b0[j * 8 + a];
    return { KE: K, S: s };
  })();

  // Level aufbereiten: Lager und Lasten als Knotenwerte, gesperrte Kacheln
  function level(def) {
    const TX = def.tx, TY = def.ty, nx = TX * M, ny = TY * M, nT = TX * TY;
    const domain = new Uint8Array(nT).fill(1);
    for (const [tx, ty] of def.cut || []) domain[tx + ty * TX] = 0;
    const frozen = new Uint8Array(nT), supportTiles = [], loadTiles = [];
    // Knotennummerierung entlang der kurzen Seite hält die Bandbreite klein
    const base = nx >= ny ? (i, j) => i * (ny + 1) + j : (i, j) => j * (nx + 1) + i;
    const nBase = (nx + 1) * (ny + 1);
    const fix = new Uint8Array(nBase), fx = new Float64Array(nBase), fy = new Float64Array(nBase);
    const edge = (tx, ty, side) => {
      const out = [];
      for (let k = 0; k <= M; k++) {
        if (side === 'left') out.push([tx * M, ty * M + k]);
        if (side === 'right') out.push([tx * M + M, ty * M + k]);
        if (side === 'bottom') out.push([tx * M + k, ty * M]);
        if (side === 'top') out.push([tx * M + k, ty * M + M]);
      }
      return out;
    };
    for (const s of def.supports) for (const [tx, ty] of s.tiles) {
      supportTiles.push(tx + ty * TX);
      if (s.lock) frozen[tx + ty * TX] = 1;
      for (const [i, j] of edge(tx, ty, s.side)) fix[base(i, j)] |= s.fix;
    }
    for (const l of def.loads) {
      const n = l.tiles.length * M;   // Elementkanten, Last gleichmäßig verteilt
      for (const [tx, ty] of l.tiles) {
        frozen[tx + ty * TX] = 1;
        loadTiles.push(tx + ty * TX);
        const nodes = edge(tx, ty, l.side);
        for (let k = 0; k < M; k++) for (const [i, j] of [nodes[k], nodes[k + 1]]) {
          fx[base(i, j)] += l.fx / n / 2;
          fy[base(i, j)] += l.fy / n / 2;
        }
      }
    }
    return { def, TX, TY, nx, ny, nT, domain, frozen, supportTiles, loadTiles, base, nBase, fix, fx, fy };
  }

  // Kacheln, die über Kanten mit den Startkacheln verbunden sind (Eckkontakt zählt nicht)
  function connect(L, solid, seeds) {
    const seen = new Uint8Array(L.nT), stack = [];
    for (const k of seeds) if (solid[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
    while (stack.length) {
      const k = stack.pop(), tx = k % L.TX, ty = (k - tx) / L.TX;
      for (const [x, y] of [[tx + 1, ty], [tx - 1, ty], [tx, ty + 1], [tx, ty - 1]]) {
        if (x < 0 || y < 0 || x >= L.TX || y >= L.TY) continue;
        const q = x + y * L.TX;
        if (solid[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    return seen;
  }

  let band = new Float64Array(0);

  function analyze(L, solid) {
    const t0 = performance.now();
    const { TX, TY, nx, ny, nT } = L;
    // conn: hängt an einem Lager (fällt nicht ab); fe: trägt die Last, nur das wird gerechnet
    const conn = connect(L, solid, L.supportTiles);
    const res = { ok: false, reason: '', conn, tileUtil: new Float32Array(nT), maxUtil: 0, maxTile: -1,
      disp: null, dofs: 0, elements: 0, ms: 0 };
    if (!L.loadTiles.every(k => conn[k])) { res.reason = 'lastpfad'; return res; }
    const fe = connect(L, solid, L.loadTiles);
    res.fe = fe;

    // Ecken, an denen sich nur zwei diagonale Kacheln berühren, bekommen getrennte Knoten
    const split = new Uint8Array((TX + 1) * (TY + 1));
    for (let cy = 1; cy < TY; cy++) for (let cx = 1; cx < TX; cx++) {
      const sw = fe[cx - 1 + (cy - 1) * TX], se = fe[cx + (cy - 1) * TX];
      const nw = fe[cx - 1 + cy * TX], ne = fe[cx + cy * TX];
      if (sw && ne && !se && !nw) split[cx + cy * (TX + 1)] = 1;        // NE eigener Knoten
      else if (se && nw && !sw && !ne) split[cx + cy * (TX + 1)] = 2;   // NW eigener Knoten
    }

    const nEl = nx * ny, key = new Int32Array(nEl * 4), active = new Uint8Array(L.nBase * 2);
    const els = [];
    const CI = [0, 1, 1, 0], CJ = [0, 0, 1, 1];
    for (let ey = 0; ey < ny; ey++) for (let ex = 0; ex < nx; ex++) {
      if (!fe[((ex / M) | 0) + ((ey / M) | 0) * TX]) continue;
      const e = ex + ey * nx;
      els.push(e);
      for (let c = 0; c < 4; c++) {
        const i = ex + CI[c], j = ey + CJ[c];
        let dup = 0;
        if (i % M === 0 && j % M === 0) {
          const s = split[i / M + (j / M) * (TX + 1)];
          if ((s === 1 && c === 0) || (s === 2 && c === 1)) dup = 1;
        }
        const k = L.base(i, j) * 2 + dup;
        key[e * 4 + c] = k;
        active[k] = 1;
      }
    }

    const eq = new Int32Array(L.nBase * 4).fill(-1);
    let n = 0;
    for (let k = 0; k < L.nBase * 2; k++) if (active[k]) {
      const f = L.fix[k >> 1];
      if (!(f & 1)) eq[2 * k] = n++;
      if (!(f & 2)) eq[2 * k + 1] = n++;
    }

    const edof = new Int32Array(nEl * 8);
    let bw = 0;
    for (const e of els) {
      let lo = Infinity, hi = -1;
      for (let c = 0; c < 4; c++) for (let d = 0; d < 2; d++) {
        const q = eq[2 * key[e * 4 + c] + d];
        edof[e * 8 + 2 * c + d] = q;
        if (q >= 0) { lo = Math.min(lo, q); hi = Math.max(hi, q); }
      }
      if (hi >= 0) bw = Math.max(bw, hi - lo);
    }

    // Aufbau der oberen Bandmatrix, Zeile p hält K[p][p..p+bw]
    const w = bw + 1;
    if (band.length < n * w) band = new Float64Array(n * w);
    const A = band;
    A.fill(0, 0, n * w);
    for (const e of els) for (let a = 0; a < 8; a++) {
      const p = edof[e * 8 + a];
      if (p < 0) continue;
      for (let b = 0; b < 8; b++) {
        const q = edof[e * 8 + b];
        if (q >= p) A[p * w + q - p] += KE[a * 8 + b];
      }
    }
    const x = new Float64Array(n);
    for (let k = 0; k < L.nBase; k++) if (L.fx[k] || L.fy[k]) {
      const p = eq[4 * k], q = eq[4 * k + 1];
      if (p >= 0) x[p] += L.fx[k];
      if (q >= 0) x[q] += L.fy[k];
    }

    // Cholesky A = U^T U (in place), dann Vorwärts- und Rückwärtseinsetzen.
    // Ein Pivot nahe null heißt: Starrkörperbewegung möglich, die Lagerung reicht nicht.
    for (let i = 0; i < n; i++) {
      const r = i * w, m = Math.min(bw, n - 1 - i);
      if (!(A[r] > 1e-7 * KE[0])) { res.reason = 'mechanismus'; return res; }
      const d = Math.sqrt(A[r]);
      A[r] = d;
      for (let k = 1; k <= m; k++) A[r + k] /= d;
      for (let k = 1; k <= m; k++) {
        const f = A[r + k];
        if (f === 0) continue;
        const row = (i + k) * w - k;
        for (let l = k; l <= m; l++) A[row + l] -= f * A[r + l];
      }
    }
    for (let i = 0; i < n; i++) {
      const r = i * w, m = Math.min(bw, n - 1 - i);
      const yi = (x[i] /= A[r]);
      for (let k = 1; k <= m; k++) x[i + k] -= A[r + k] * yi;
    }
    for (let i = n - 1; i >= 0; i--) {
      const r = i * w, m = Math.min(bw, n - 1 - i);
      let s = x[i];
      for (let k = 1; k <= m; k++) s -= A[r + k] * x[i + k];
      x[i] = s / A[r];
    }

    // Vergleichsspannung (von Mises) je Element, Mittelwert je Kachel
    const disp = new Float32Array(nEl * 8), sum = new Float64Array(nT), u = new Float64Array(8);
    for (const e of els) {
      for (let a = 0; a < 8; a++) {
        const p = edof[e * 8 + a];
        u[a] = p >= 0 ? x[p] : 0;
        disp[e * 8 + a] = u[a];
      }
      let sx = 0, sy = 0, t = 0;
      for (let a = 0; a < 8; a++) { sx += S[a] * u[a]; sy += S[8 + a] * u[a]; t += S[16 + a] * u[a]; }
      const ex = e % nx, ey = (e - ex) / nx;
      sum[((ex / M) | 0) + ((ey / M) | 0) * TX] += Math.sqrt(sx * sx - sx * sy + sy * sy + 3 * t * t);
    }
    for (let k = 0; k < nT; k++) if (fe[k]) {
      const util = sum[k] / (M * M) / RE;
      res.tileUtil[k] = util;
      if (util > res.maxUtil) { res.maxUtil = util; res.maxTile = k; }
    }
    res.ok = res.maxUtil <= 1;
    res.reason = res.ok ? '' : 'spannung';
    res.disp = disp;
    res.dofs = n;
    res.elements = els.length;
    res.ms = performance.now() - t0;
    return res;
  }

  // ESO: immer die am geringsten ausgelastete Kachel entfernen, die sich entfernen lässt,
  // bis keine mehr geht. Generator, damit die Oberfläche zwischen den Rechnungen atmen kann.
  function* eso(L) {
    let r = analyze(L, L.domain);
    const order = [];
    for (;;) {
      const cand = [];
      for (let k = 0; k < L.nT; k++) if (r.conn[k] && !L.frozen[k]) cand.push(k);
      cand.sort((a, b) => r.tileUtil[a] - r.tileUtil[b]);
      let next = null;
      for (const k of cand) {
        const trial = r.conn.slice();
        trial[k] = 0;
        const t = analyze(L, trial);
        yield order.length;
        if (t.ok) { next = t; order.push(k); break; }
      }
      if (!next) break;
      r = next;
    }
    return { res: r, order };
  }

  return { M, TILE, THICK, RE, TILE_G, S, level, connect, analyze, eso };
})();
if (typeof module !== 'undefined') module.exports = FEM;
