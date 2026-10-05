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
  const PLATE = 1000;           // Steifigkeit der Lagerplatte (Kachel an Fest- und Loslager) relativ zu Stahl

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

  // Kachelzustände: 0 leer, 1 voll, 2 bis 5 halbe Kachel mit abgeschnittener Ecke unten links, unten rechts, oben rechts, oben links.
  // Bitmasken je Zustand: Seiten mit Material (1 links, 2 rechts, 4 unten, 8 oben) und Ecken, die zum Material gehören
  // (1 unten links, 2 unten rechts, 4 oben rechts, 8 oben links); Fläche als Anteil einer Kachel.
  const SIDES = [0, 15, 10, 9, 5, 6];
  const CORNERS = [0, 15, 14, 13, 11, 7];
  const AREA = [0, 1, 0.5, 0.5, 0.5, 0.5];
  const SIDEBIT = { left: 1, right: 2, bottom: 4, top: 8 };
  // Rasterquadrat (a, b) einer Kachel, je 0 bis M-1: 0 leer, 1 voll, sonst Dreieck (Typ wie der Zustand)
  function squareKind(s, a, b) {
    if (s < 2) return s;
    const d = s === 3 ? b - a : s === 5 ? a - b : s === 2 ? a + b - (M - 1) : (M - 1) - a - b;
    return d > 0 ? 1 : d === 0 ? s : 0;
  }
  // gehört der Rasterknoten (a, b), je 0 bis M, zum Material der Kachel?
  const inShape = (s, a, b) => s === 1 || (s === 3 && b >= a) || (s === 5 && b <= a) || (s === 2 && a + b >= M) || (s === 4 && a + b <= M);

  // Auf der Schnittkante halber Kacheln: lineare Dreieckselemente (konstante Dehnung), je Typ die Knoten im Rasterquadrat
  // gegen den Uhrzeigersinn. Elementsteifigkeit TK (6x6) und Spannungsmatrix TS (3x6).
  const TRI = { 2: [[1, 0], [1, 1], [0, 1]], 3: [[0, 0], [1, 1], [0, 1]], 4: [[0, 0], [1, 0], [0, 1]], 5: [[0, 0], [1, 0], [1, 1]] };
  const TK = {}, TS = {};
  (() => {
    const c = E / (1 - NU * NU), D = [c, c * NU, 0, c * NU, c, 0, 0, 0, c * (1 - NU) / 2];
    for (const t in TRI) {
      const [[x1, y1], [x2, y2], [x3, y3]] = TRI[t].map(([a, b]) => [a * H, b * H]);
      const A2 = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1);   // doppelte Fläche
      const bb = [y2 - y3, y3 - y1, y1 - y2], cc = [x3 - x2, x1 - x3, x2 - x1];
      const B = new Float64Array(18);
      for (let n = 0; n < 3; n++) {
        B[2 * n] = bb[n] / A2; B[6 + 2 * n + 1] = cc[n] / A2; B[12 + 2 * n] = cc[n] / A2; B[12 + 2 * n + 1] = bb[n] / A2;
      }
      const s = new Float64Array(18), K = new Float64Array(36), w = THICK * A2 / 2;
      for (let i = 0; i < 3; i++) for (let a = 0; a < 6; a++) for (let j = 0; j < 3; j++) s[i * 6 + a] += D[i * 3 + j] * B[j * 6 + a];
      for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) {
        let v = 0;
        for (let i = 0; i < 3; i++) v += B[i * 6 + a] * s[i * 6 + b];
        K[a * 6 + b] = w * v;
      }
      TK[t] = K; TS[t] = s;
    }
  })();

  // Rasterknoten einer Kachelseite, M+1 Stück der Reihe nach
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

  // Level aufbereiten: Lagerkacheln, Lasten als Knotenwerte je Lastkachel, gesperrte Kacheln
  function level(def) {
    const TX = def.tx, TY = def.ty, nx = TX * M, ny = TY * M, nT = TX * TY;
    const domain = new Uint8Array(nT).fill(1);
    for (const [tx, ty] of def.cut || []) domain[tx + ty * TX] = 0;
    const frozen = new Uint8Array(nT), supportTiles = [], supportSides = new Uint8Array(nT), loadTiles = [];
    // Knotennummerierung entlang der kurzen Seite hält die Bandbreite klein
    const base = nx >= ny ? (i, j) => i * (ny + 1) + j : (i, j) => j * (nx + 1) + i;
    const nBase = (nx + 1) * (ny + 1);
    for (const s of def.supports) for (const [tx, ty] of s.tiles) {
      supportTiles.push(tx + ty * TX);
      supportSides[tx + ty * TX] |= SIDEBIT[s.side];
      if (s.lock) frozen[tx + ty * TX] = 1;
    }
    // Knotenlasten [i, j, tx, ty, fx, fy]: je Lastkachel, damit sie an deren Knotenkopie angreifen (siehe nodeKey)
    const loadList = [];
    for (const l of def.loads) {
      const n = l.tiles.length * M;   // Elementkanten, Last gleichmäßig verteilt
      for (const [tx, ty] of l.tiles) {
        frozen[tx + ty * TX] = 1;
        loadTiles.push(tx + ty * TX);
        const nodes = edge(tx, ty, l.side);
        for (let k = 0; k < M; k++) for (const [i, j] of [nodes[k], nodes[k + 1]]) loadList.push([i, j, tx, ty, l.fx / n / 2, l.fy / n / 2]);
      }
    }
    return { def, TX, TY, nx, ny, nT, domain, frozen, supportTiles, supportSides, loadTiles, base, nBase, loadList };
  }

  // Kacheln, die über Kanten mit den Startkacheln verbunden sind. Verbunden heißt: beide Kacheln haben auf der
  // gemeinsamen Kante Material. Eckkontakt zählt nicht.
  function connect(L, solid, seeds) {
    const seen = new Uint8Array(L.nT), stack = [];
    for (const k of seeds) if (solid[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
    while (stack.length) {
      const k = stack.pop(), tx = k % L.TX, ty = (k - tx) / L.TX, sk = SIDES[solid[k]];
      for (const [x, y, mine, theirs] of [[tx + 1, ty, 2, 1], [tx - 1, ty, 1, 2], [tx, ty + 1, 8, 4], [tx, ty - 1, 4, 8]]) {
        if (x < 0 || y < 0 || x >= L.TX || y >= L.TY || !(sk & mine)) continue;
        const q = x + y * L.TX;
        if (solid[q] && !seen[q] && (SIDES[solid[q]] & theirs)) { seen[q] = 1; stack.push(q); }
      }
    }
    return seen;
  }
  // Was am Lager hängt; eine Lagerkachel zählt nur mit Material auf der gelagerten Seite
  const attached = (L, solid) => connect(L, solid, L.supportTiles.filter(k => SIDES[solid[k]] & L.supportSides[k]));
  // Fläche in Kacheln: halbe Kacheln zählen halb
  const area = (solid, set) => solid.reduce((a, s, k) => a + (set[k] ? AREA[s] : 0), 0);

  let band = new Float64Array(0);

  function analyze(L, solid) {
    const t0 = performance.now();
    const { TX, TY, nx, ny, nT } = L;
    // conn: hängt an einem Lager (fällt nicht ab); fe: trägt die Last, nur das wird gerechnet
    const conn = attached(L, solid);
    const res = { ok: false, reason: '', conn, solid: Uint8Array.from(solid), area: area(solid, conn), tileUtil: new Float64Array(nT), maxUtil: 0, maxTile: -1,
      disp: null, dofs: 0, elements: 0, ms: 0 };
    if (!L.loadTiles.every(k => conn[k])) { res.reason = 'lastpfad'; return res; }
    const fe = connect(L, solid, L.loadTiles);
    res.fe = fe;
    const sf = k => fe[k] ? solid[k] : 0;

    // An jeder Kachelecke bekommt jede Gruppe von Kacheln, die dort über Kanten zusammenhängt, einen eigenen Knoten:
    // Was sich nur in einem Punkt berührt, gilt als getrennt. Lage der Kachel zur Ecke: 0 links unten, 1 rechts unten,
    // 2 links oben, 3 rechts oben.
    const copy = new Uint8Array((TX + 1) * (TY + 1) * 4);
    for (let cy = 0; cy <= TY; cy++) for (let cx = 0; cx <= TX; cx++) {
      const s = [[cx - 1, cy - 1, 4], [cx, cy - 1, 8], [cx - 1, cy, 2], [cx, cy, 1]].map(([x, y, bit]) =>
        x >= 0 && y >= 0 && x < TX && y < TY && (CORNERS[sf(x + y * TX)] & bit) ? sf(x + y * TX) : 0);
      if (s.filter(Boolean).length < 2) continue;
      const par = [0, 1, 2, 3], find = i => par[i] === i ? i : (par[i] = find(par[i]));
      const link = (a, b, sa, sb) => { if (s[a] && s[b] && (SIDES[s[a]] & sa) && (SIDES[s[b]] & sb)) par[find(a)] = find(b); };
      link(0, 1, 2, 1); link(2, 3, 2, 1); link(0, 2, 8, 4); link(1, 3, 8, 4);
      const ids = {};
      let next = 0;
      for (let p = 0; p < 4; p++) if (s[p]) {
        const root = find(p);
        if (!(root in ids)) ids[root] = next++;
        copy[(cx + cy * (TX + 1)) * 4 + p] = ids[root];
      }
    }
    // Schlüssel eines Rasterknotens (i, j) aus Sicht der Kachel (tx, ty): an Kachelecken die Kopie ihrer Gruppe
    const nodeKey = (tx, ty, i, j) => {
      const a = i - tx * M, b = j - ty * M;
      if ((a === 0 || a === M) && (b === 0 || b === M))
        return L.base(i, j) * 4 + copy[(tx + a / M + (ty + b / M) * (TX + 1)) * 4 + (a ? 0 : 1) + (b ? 0 : 2)];
      return L.base(i, j) * 4;
    };

    // Elemente: volle Rasterquadrate als Vierecke, die auf der Schnittkante als Dreiecke
    const CI = [0, 1, 1, 0], CJ = [0, 0, 1, 1];
    const quads = [], tris = [], active = new Uint8Array(L.nBase * 4);
    for (let ey = 0; ey < ny; ey++) for (let ex = 0; ex < nx; ex++) {
      const tx = (ex / M) | 0, ty = (ey / M) | 0, kind = squareKind(sf(tx + ty * TX), ex - tx * M, ey - ty * M);
      if (!kind) continue;
      const pts = kind === 1 ? CI.map((ci, c) => [ex + ci, ey + CJ[c]]) : TRI[kind].map(([a, b]) => [ex + a, ey + b]);
      const keys = pts.map(([i, j]) => nodeKey(tx, ty, i, j));
      keys.forEach(k => { active[k] = 1; });
      (kind === 1 ? quads : tris).push({ k: tx + ty * TX, kind, pts, keys });
    }

    // Lager je Knotenkopie und nur an Lagerkacheln mit Material auf der gelagerten Seite: Was die Lagerkante nur in einem
    // Punkt berührt, ist nicht gelagert. Die Einspannung hält die ganze Kante. Fest- und Loslager sind ein Gelenk in der
    // Mitte der Kante (Festlager in beide Richtungen, Loslager senkrecht zur Kante); ihre Kachel ist die Lagerplatte:
    // steif, damit die Lagerkraft nicht in einem Punkt ins Bauteil geht, dreht sich um das Gelenk, ohne eigenen Nachweis.
    const fix = new Uint8Array(L.nBase * 4), plate = new Uint8Array(nT);
    for (const s of L.def.supports) for (const [tx, ty] of s.tiles) {
      if (!(SIDES[sf(tx + ty * TX)] & SIDEBIT[s.side])) continue;
      const nodes = edge(tx, ty, s.side), hinge = s.kind === 'fest' || s.kind === 'los';
      if (hinge) plate[tx + ty * TX] = 1;
      for (const [i, j] of hinge ? [nodes[M / 2]] : nodes) fix[nodeKey(tx, ty, i, j)] |= s.fix;
    }
    const eq = new Int32Array(L.nBase * 8).fill(-1);
    let n = 0;
    for (let k = 0; k < L.nBase * 4; k++) if (active[k]) {
      const f = fix[k];
      if (!(f & 1)) eq[2 * k] = n++;
      if (!(f & 2)) eq[2 * k + 1] = n++;
    }

    let bw = 0;
    for (const el of [...quads, ...tris]) {
      let lo = Infinity, hi = -1;
      el.dof = el.keys.flatMap(k => [eq[2 * k], eq[2 * k + 1]]);
      for (const q of el.dof) if (q >= 0) { lo = Math.min(lo, q); hi = Math.max(hi, q); }
      if (hi >= 0) bw = Math.max(bw, hi - lo);
    }

    // Aufbau der oberen Bandmatrix, Zeile p hält K[p][p..p+bw]
    const w = bw + 1;
    if (band.length < n * w) band = new Float64Array(n * w);
    const A = band;
    A.fill(0, 0, n * w);
    for (const el of [...quads, ...tris]) {
      const K = el.kind === 1 ? KE : TK[el.kind], m = el.dof.length, f = plate[el.k] ? PLATE : 1;
      for (let a = 0; a < m; a++) {
        const p = el.dof[a];
        if (p < 0) continue;
        for (let b = 0; b < m; b++) {
          const q = el.dof[b];
          if (q >= p) A[p * w + q - p] += f * K[a * m + b];
        }
      }
    }
    const x = new Float64Array(n);
    for (const [i, j, tx, ty, lx, ly] of L.loadList) {
      const key = nodeKey(tx, ty, i, j), p = eq[2 * key], q = eq[2 * key + 1];
      if (p >= 0) x[p] += lx;
      if (q >= 0) x[q] += ly;
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

    // Vergleichsspannung (von Mises) je Element, flächengewichteter Mittelwert je Kachel (Dreieck zählt halb).
    // disp: Verschiebung je Kachel und Rasterknoten (M+1 mal M+1) fürs Zeichnen.
    const R = M + 1, disp = new Float32Array(nT * R * R * 2), sum = new Float64Array(nT), wsum = new Float64Array(nT);
    for (const el of [...quads, ...tris]) {
      const u = el.dof.map(p => p >= 0 ? x[p] : 0), Sm = el.kind === 1 ? S : TS[el.kind], m = u.length;
      let sx = 0, sy = 0, t = 0;
      for (let a = 0; a < m; a++) { sx += Sm[a] * u[a]; sy += Sm[m + a] * u[a]; t += Sm[2 * m + a] * u[a]; }
      const wt = el.kind === 1 ? 1 : 0.5;
      sum[el.k] += wt * Math.sqrt(sx * sx - sx * sy + sy * sy + 3 * t * t);
      wsum[el.k] += wt;
      const tx = el.k % TX, ty = (el.k - tx) / TX;
      el.pts.forEach(([i, j], c) => {
        const o = (el.k * R * R + (j - ty * M) * R + (i - tx * M)) * 2;
        disp[o] = u[2 * c]; disp[o + 1] = u[2 * c + 1];
      });
    }
    for (let k = 0; k < nT; k++) if (fe[k] && wsum[k] && !plate[k]) {
      const util = sum[k] / wsum[k] / RE;
      res.tileUtil[k] = util;
      if (util > res.maxUtil) { res.maxUtil = util; res.maxTile = k; }
    }
    res.ok = res.maxUtil <= 1;
    res.reason = res.ok ? '' : 'spannung';
    res.disp = disp;
    res.dofs = n;
    res.elements = quads.length + tris.length;
    res.ms = performance.now() - t0;
    return res;
  }

  // Freie Ecken einer vollen Kachel: beide angrenzenden Seiten ohne Material gegenüber (Rand oder Nachbar ohne Material dort)
  function freeCorners(L, solid, conn, k) {
    const tx = k % L.TX, ty = (k - tx) / L.TX;
    const open = (x, y, side) => x < 0 || y < 0 || x >= L.TX || y >= L.TY || !conn[x + y * L.TX] || !(SIDES[solid[x + y * L.TX]] & side);
    const l = open(tx - 1, ty, 2), r = open(tx + 1, ty, 1), b = open(tx, ty - 1, 8), t = open(tx, ty + 1, 4);
    // abzuschneidende Ecke als neuer Zustand: unten links 2, unten rechts 3, oben rechts 4, oben links 5
    return [l && b && 2, r && b && 3, r && t && 4, l && t && 5].filter(Boolean);
  }

  // ESO: immer die am geringsten ausgelastete Kachel entfernen, die sich entfernen lässt, bis keine mehr geht.
  // Danach glätten: freie Ecken abschneiden und halbe Kacheln ganz entfernen, solange es hält.
  // Generator, damit die Oberfläche zwischen den Rechnungen atmen kann.
  function* eso(L) {
    let solid = L.domain.slice(), r = analyze(L, solid);
    const order = [], cuts = [];
    const masked = () => Uint8Array.from(solid, (s, k) => r.conn[k] ? s : 0);   // nur, was noch am Lager hängt
    for (let phase = 0; phase < 2; phase++) for (;;) {
      const cand = [];
      for (let k = 0; k < L.nT; k++) if (r.conn[k] && !L.frozen[k]) {
        if (!phase) cand.push([k, 0]);
        else if (solid[k] === 1) for (const s of freeCorners(L, solid, r.conn, k)) cand.push([k, s]);
        else cand.push([k, 0]);
      }
      cand.sort((a, b) => r.tileUtil[a[0]] - r.tileUtil[b[0]]);
      let next = null;
      for (const [k, s] of cand) {
        const trial = masked();
        trial[k] = s;
        const t = analyze(L, trial);
        yield order.length + cuts.length;
        if (t.ok) { next = t; solid = trial; (phase ? cuts : order).push(k); break; }
      }
      if (!next) break;
      r = next;
    }
    return { res: r, order, cuts, solid: masked() };
  }

  return { M, TILE, THICK, RE, TILE_G, S, TRI, TK, TS, SIDES, CORNERS, AREA, squareKind, inShape, level, connect, attached, area, analyze, eso };
})();
if (typeof module !== 'undefined') module.exports = FEM;
