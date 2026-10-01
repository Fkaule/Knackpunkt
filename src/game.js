/* Spiel: Entwurf, Aufdecken, Gegner und Wettkampf. Zeichnet auf ein Canvas im Stil einer technischen Zeichnung. */
(() => {
  const { M, TILE, THICK, RE, TILE_G } = FEM;
  const $ = id => document.getElementById(id);
  const cv = $('cv'), ctx = cv.getContext('2d'), wrap = $('wrap');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MONO = '"IBM Plex Mono", Menlo, monospace';
  const fmt = (x, d = 0) => x.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
  const clamp01 = x => Math.max(0, Math.min(1, x));
  const count = a => a.reduce((n, x) => n + (x ? 1 : 0), 0);
  const col = (tx, n) => Array.from({ length: n }, (_, ty) => [tx, ty]);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  // Nur Bequemlichkeit je Gerät (Name, laufendes Spiel der Spielleitung); ohne Speicher geht alles weiter
  const store = {
    get: k => { try { return JSON.parse(localStorage.getItem('knackpunkt-' + k)); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem('knackpunkt-' + k, JSON.stringify(v)); } catch {} },
  };

  // margin: Platz in Kacheln [oben, rechts, unten, links] für Lager, Last und Bemaßung
  const LEVELS = [
    { name: 'Kragarm', note: 'Links in der Wand eingespannt, rechts hängt die Last. Der Klassiker.',
      tx: 16, ty: 8, margin: [1, 3.4, 2.2, 2.8],
      supports: [{ kind: 'wand', tiles: col(0, 8), side: 'left', fix: 3 }],
      loads: [{ tiles: [[15, 3], [15, 4]], side: 'right', fx: 0, fy: -10000 }] },
    { name: 'Brücke', note: 'Festlager links, Loslager rechts, Last in der Mitte. Das Loslager hält nur senkrecht.',
      tx: 20, ty: 6, margin: [3.2, 1.2, 3, 2.8],
      supports: [{ kind: 'fest', tiles: [[0, 0]], side: 'bottom', fix: 3, lock: true },
                 { kind: 'los', tiles: [[19, 0]], side: 'bottom', fix: 2, lock: true }],
      loads: [{ tiles: [[9, 5], [10, 5]], side: 'top', fx: 0, fy: -20000 }] },
    { name: 'L-Winkel', note: 'Oben eingespannt, Last am Ende des Schenkels. Vorsicht an der Innenecke.',
      tx: 12, ty: 12, margin: [1.4, 3.4, 2.2, 2.8], cut: [],
      supports: [{ kind: 'wand', tiles: [0, 1, 2, 3, 4].map(x => [x, 11]), side: 'top', fix: 3 }],
      loads: [{ tiles: [[11, 2]], side: 'right', fx: 0, fy: -6000 }] },
  ];
  for (let x = 5; x < 12; x++) for (let y = 5; y < 12; y++) LEVELS[2].cut.push([x, y]);
  // Hinter den festen Bauteilen: Zufallsbauteile, jedes mit einer Nummer (src/parts.js)
  const RANDOM = LEVELS.length, CUSTOM = RANDOM + 1;   // CUSTOM: eigenes Bauteil aus dem Baukasten
  const newNr = () => 1 + Math.floor(Math.random() * 99999);
  const partName = d => d.nr ? `${d.name} Nr. ${d.nr}` : d.name;

  // Farbskala ohne Gelb: blau, türkis, grün, orange, rot; über der Streckgrenze magenta
  const STOPS = [[0, [38, 60, 150]], [0.2, [44, 110, 214]], [0.4, [24, 164, 196]], [0.6, [52, 178, 116]],
    [0.8, [239, 136, 44]], [1, [222, 50, 42]]];
  const ramp = u => {
    for (let i = 1; i < STOPS.length; i++) if (u <= STOPS[i][0]) {
      const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i], f = (u - a) / (b - a);
      return `rgb(${ca.map((c, k) => Math.round(c + f * (cb[k] - c))).join(',')})`;
    }
    return 'rgb(222,50,42)';
  };
  const BANDS = Array.from({ length: 10 }, (_, b) => ramp((b + 0.5) / 10));
  const OVER = '#ff2e88';
  const bandOf = u => u > 1 ? OVER : BANDS[Math.min(9, Math.floor(Math.max(0, u) * 10))];

  // open: Spielart „Offene Karten“ (Spannungen sichtbar, jede Wegnahme endgültig, Versagen beendet das Spiel)
  let soloOpen = false;
  // Herausforderung per Link: { key (Bauteil), open, pct10 (entfernte Prozent mal 10), name, part (Argumente für loadLevel) }
  let duel = null;
  const st = { li: 0, key: 0, practice: false, def: null, L: null, solid: null, conn: null, undo: [], phase: 'design', probes: 1, open: false,
    res: null, view: { mode: 'blind' }, resultView: null, hover: -1, paint: null, last: null, tool: 'rect', drag: null,
    eso: {}, esoRun: null, animId: 0, busy: false };
  let G = null;
  const C = {};
  const removedPct = (L, conn) => 100 * (1 - count(conn) / count(L.domain));

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    for (const t of ['sheet', 'ink', 'ink2', 'rule', 'grid', 'steel', 'steel2', 'hatch', 'accent', 'loose'])
      C[t] = cs.getPropertyValue('--' + t).trim();
  }

  // ---------- Geometrie ----------
  const kN = ld => Math.round(Math.hypot(ld.fx, ld.fy) / 100) / 10;
  const loadLabel = ld => ld.unknown ? 'F = ?' : `F = ${fmt(kN(ld), kN(ld) % 1 ? 1 : 0)} kN`;
  const OUT = { left: [-1, 0], right: [1, 0], top: [0, 1], bottom: [0, -1] };
  // Kante einer Lager- oder Lastgruppe in Kacheln, y nach oben: Enden a und b, Mitte p, Normale n nach außen
  function sideOf(grp) {
    const xs = grp.tiles.map(t => t[0]), ys = grp.tiles.map(t => t[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs) + 1, y0 = Math.min(...ys), y1 = Math.max(...ys) + 1;
    const [a, b] = { left: [[x0, y0], [x0, y1]], right: [[x1, y0], [x1, y1]], top: [[x0, y1], [x1, y1]], bottom: [[x0, y0], [x1, y0]] }[grp.side];
    return { a, b, p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], n: OUT[grp.side] };
  }
  // Lastpfeil in Kacheln: Zieht die Last nach außen, beginnt er am Rand, drückt sie, endet er dort,
  // längs der Kante steht er daneben. Die Beschriftung sitzt am äußeren Ende, vom Bauteil abgewandt.
  function arrow(ld) {
    const { p, n } = sideOf(ld), F = Math.hypot(ld.fx, ld.fy), f = [ld.fx / F, ld.fy / F], d = f[0] * n[0] + f[1] * n[1];
    let tip, tail;
    if (d > 0.3) { tail = [p[0] + n[0] * 0.12, p[1] + n[1] * 0.12]; tip = [tail[0] + f[0] * 2.2, tail[1] + f[1] * 2.2]; }
    else {
      const off = d < -0.3 ? 0.08 : 0.45;
      tip = [p[0] + n[0] * off, p[1] + n[1] * off]; tail = [tip[0] - f[0] * 2.2, tip[1] - f[1] * 2.2];
    }
    const o = d > 0.3 ? tip : tail;
    let lab;
    if (Math.abs(f[0]) < 0.3) { const sx = n[0] < 0 ? -1 : 1; lab = [o[0] + 0.3 * sx, o[1] + (o[1] > p[1] ? -0.25 : 0.25), sx > 0 ? 'left' : 'right']; }
    else { const sx = o[0] > p[0] ? 1 : -1; lab = [o[0] + 0.25 * sx, o[1], sx > 0 ? 'left' : 'right']; }
    return { p, f, tip, tail, lab };
  }
  // Wie weit Lager und Lastpfeile samt Beschriftung über das Bauteil hinausragen, in Kacheln: [oben, rechts, unten, links]
  function around(d, s) {
    const e = [0, 0, 0, 0];
    const grow = (x, y) => { e[0] = Math.max(e[0], y - d.ty); e[1] = Math.max(e[1], x - d.tx); e[2] = Math.max(e[2], -y); e[3] = Math.max(e[3], -x); };
    for (const sp of d.supports) {
      const { a, b, p, n } = sideOf(sp), t = [Math.abs(n[1]), Math.abs(n[0])];
      if (sp.kind === 'wand') for (const [q, k] of [[a, -1], [b, 1]]) grow(q[0] + t[0] * 0.3 * k + n[0] * 0.35, q[1] + t[1] * 0.3 * k + n[1] * 0.35);
      else for (const k of [-1, 1]) grow(p[0] + t[0] * 0.7 * k + n[0] * 1.15, p[1] + t[1] * 0.7 * k + n[1] * 1.15);
    }
    const px = Math.max(12, s * 0.45);
    ctx.font = `600 ${px}px ${MONO}`;
    for (const ld of d.loads) {
      const g = arrow(ld), w = (ctx.measureText(loadLabel(ld)).width + 6) / s, h = px / s, [lx, ly, al] = g.lab, x0 = al === 'left' ? lx : lx - w;
      grow(...g.tip); grow(...g.tail); grow(x0, ly - h / 2); grow(x0 + w, ly + h / 2);
    }
    return e;
  }
  // Ränder um das Bauteil [oben, rechts, unten, links] und Lage der Bemaßung (Seite, Abstand), in Kacheln
  function frame(d, s) {
    const e = around(d, s);
    // feste Bauteile: Ränder von Hand gesetzt, Bemaßung unten und links; nur für breite Beschriftung nachlegen
    if (d.margin) return { m: d.margin.map((m, i) => Math.max(m, e[i])), dh: ['bottom', d.margin[2] * 0.7], dv: ['left', d.margin[3] * 0.7] };
    // sonst: Bemaßung auf die freiere Seite, Maßzahl über der Maßlinie
    const txt = (Math.max(11, s * 0.42) + 4) / s, a = Math.max(5, s * 0.22) / s, m = e.map(x => x + 0.4);
    const dh = e[2] <= e[0] + 0.5 ? ['bottom', e[2] + 0.2 + txt] : ['top', e[0] + 0.5];
    const dv = e[3] <= e[1] + 0.5 ? ['left', e[3] + 0.5] : ['right', e[1] + 0.2 + txt];
    if (dh[0] === 'bottom') m[2] = dh[1] + a + 0.3; else m[0] = dh[1] + txt + 0.3;
    if (dv[0] === 'left') m[3] = dv[1] + txt + 0.3; else m[1] = dv[1] + a + 0.3;
    return { m, dh, dv };
  }
  function layout() {
    const pad = mp.on ? 58 : 0;   // im Wettkampf steht oben links die Uhr: Zeichnung darunter beginnen
    const d = st.def, W = wrap.clientWidth, maxH = Math.max(240, Math.min(innerHeight * 0.62, 620)) - pad;
    if (!W) return;   // Zeichnung gerade ausgeblendet (Warteraum, Auflösung am Beamer)
    // Beschriftungen haben eine Mindestgröße: auf schmalen Bildschirmen brauchen sie mehr Rand, also zweimal nachrechnen
    const fit = m => Math.min(W / (d.tx + m[3] + m[1]), maxH / (d.ty + m[0] + m[2]));
    let s = fit(d.margin || [2, 2, 2, 2]), F;
    for (let pass = 0; pass < 3; pass++) { F = frame(d, s); s = fit(F.m); }
    const [mt, mr, mb, ml] = F.m, H = Math.round(s * (d.ty + mt + mb)) + pad, dpr = devicePixelRatio || 1;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    G = { s, W, H, ox: (W - s * (d.tx + ml + mr)) / 2 + s * ml, oy: s * (mt + d.ty) + pad, F };
  }
  const X = i => G.ox + i / M * G.s;          // Knotenindex in Pixel
  const Y = j => G.oy - j / M * G.s;
  const tileRect = k => { const tx = k % st.L.TX, ty = (k - tx) / st.L.TX; return [G.ox + tx * G.s, G.oy - (ty + 1) * G.s]; };
  function tileAt(e) {
    const b = cv.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
    const tx = Math.floor((x - G.ox) / G.s), ty = Math.floor((G.oy - y) / G.s);
    return tx < 0 || ty < 0 || tx >= st.L.TX || ty >= st.L.TY ? -1 : tx + ty * st.L.TX;
  }

  // Randkanten einer Kachelmenge (in Kacheleinheiten), gleichgerichtete Stücke zusammengefasst
  function edges(set) {
    const L = st.L, out = [];
    const has = (x, y) => x >= 0 && y >= 0 && x < L.TX && y < L.TY && set[x + y * L.TX];
    for (let k = 0; k < L.nT; k++) if (set[k]) {
      const x = k % L.TX, y = (k - x) / L.TX;
      if (!has(x, y - 1)) out.push([x, y, x + 1, y]);
      if (!has(x, y + 1)) out.push([x, y + 1, x + 1, y + 1]);
      if (!has(x - 1, y)) out.push([x, y, x, y + 1]);
      if (!has(x + 1, y)) out.push([x + 1, y, x + 1, y + 1]);
    }
    const h = out.filter(q => q[1] === q[3]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const v = out.filter(q => q[0] === q[2]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged = [];
    for (const q of h) { const p = merged.at(-1); if (p && p[1] === p[3] && p[1] === q[1] && p[2] === q[0]) p[2] = q[2]; else merged.push(q); }
    for (const q of v) { const p = merged.at(-1); if (p && p[0] === p[2] && p[0] === q[0] && p[3] === q[1]) p[3] = q[3]; else merged.push(q); }
    return merged;
  }
  function strokeSegs(segs) {
    ctx.beginPath();
    for (const [a, b, c, d] of segs) { ctx.moveTo(G.ox + a * G.s, G.oy - b * G.s); ctx.lineTo(G.ox + c * G.s, G.oy - d * G.s); }
    ctx.stroke();
  }
  function tilesPath(set) {
    ctx.beginPath();
    for (let k = 0; k < st.L.nT; k++) if (set[k]) { const [x, y] = tileRect(k); ctx.rect(x, y, G.s, G.s); }
  }
  function hatch(set, gap, both) {
    if (!set.some(Boolean)) return;
    const L = st.L, x0 = G.ox, x1 = G.ox + L.TX * G.s, y0 = G.oy - L.TY * G.s, y1 = G.oy, h = y1 - y0;
    ctx.save(); tilesPath(set); ctx.clip();
    ctx.strokeStyle = C.hatch; ctx.globalAlpha = 0.55; ctx.lineWidth = 1; ctx.beginPath();
    for (let c = x0 - h; c < x1 + h; c += gap) {
      ctx.moveTo(c, y1); ctx.lineTo(c + h, y0);
      if (both) { ctx.moveTo(c, y0); ctx.lineTo(c + h, y1); }
    }
    ctx.stroke(); ctx.restore();
  }
  // Verformter Umriss einer Kachel aus ihren 4 M Randknoten, Verschiebung in mm mal Überhöhung
  function tilePoly(r, k, scale) {
    const L = st.L, tx = k % L.TX, ty = (k - tx) / L.TX, i0 = tx * M, j0 = ty * M, pts = [];
    const ring = [];
    for (let a = 0; a < M; a++) ring.push([i0 + a, j0]);
    for (let a = 0; a < M; a++) ring.push([i0 + M, j0 + a]);
    for (let a = 0; a < M; a++) ring.push([i0 + M - a, j0 + M]);
    for (let a = 0; a < M; a++) ring.push([i0, j0 + M - a]);
    for (const [i, j] of ring) {
      const ex = Math.min(i, i0 + M - 1), ey = Math.min(j, j0 + M - 1), ci = i - ex, cj = j - ey;
      const c = cj ? (ci ? 2 : 3) : (ci ? 1 : 0), e = ex + ey * L.nx;
      pts.push([X(i) + scale * r.disp[e * 8 + 2 * c] / TILE * G.s, Y(j) - scale * r.disp[e * 8 + 2 * c + 1] / TILE * G.s]);
    }
    return pts;
  }
  function nodeU(r, i, j) {
    const L = st.L;
    for (const [ex, ey, c] of [[i - 1, j - 1, 2], [i, j - 1, 3], [i - 1, j, 1], [i, j, 0]]) {
      if (ex < 0 || ey < 0 || ex >= L.nx || ey >= L.ny || !r.fe[((ex / M) | 0) + ((ey / M) | 0) * L.TX]) continue;
      const e = ex + ey * L.nx;
      return [r.disp[e * 8 + 2 * c], r.disp[e * 8 + 2 * c + 1]];
    }
    return [0, 0];
  }
  const polyPath = p => { ctx.beginPath(); p.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); };
  const center = p => [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length];
  function niceScale(r) {
    let m = 0;
    for (let i = 0; i < r.disp.length; i++) m = Math.max(m, Math.abs(r.disp[i]));
    if (!m) return 0;
    const raw = 0.5 * TILE / m, p = 10 ** Math.floor(Math.log10(raw));
    if (raw < 1) return raw;   // versagende Entwürfe verformen sich stark: dann verkleinert zeigen
    return [5, 3, 2, 1.5, 1].map(f => f * p).find(x => x <= raw);
  }

  // ---------- Zeichnen ----------
  function render() {
    if (!G) return;
    ctx.clearRect(0, 0, G.W, G.H);
    if (st.phase === 'edit') { drawEditor(); drawSupports(); drawLoads({}); return; }
    drawPaper();
    if (st.view.mode === 'blind') {
      drawBlind(st.solid, st.conn, true);
      if (st.hover >= 0 && st.paint == null && st.L.domain[st.hover] && !st.L.frozen[st.hover] && editable()) {
        const [x, y] = tileRect(st.hover);
        ctx.strokeStyle = C.accent; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, G.s - 2, G.s - 2);
      }
    } else drawResult(st.view);
    if (st.drag) drawDrag();
    drawSupports();
    drawLoads(st.view);
    drawDims();
  }

  // Vorschau beim Aufziehen: so sieht es nach dem Loslassen aus
  function drawDrag() {
    const d = st.drag, s = G.s, set = new Uint8Array(st.L.nT);
    for (const k of rectTiles(d)) set[k] = 1;
    const x0 = Math.min(d.a[0], d.b[0]), x1 = Math.max(d.a[0], d.b[0]), y0 = Math.min(d.a[1], d.b[1]), y1 = Math.max(d.a[1], d.b[1]);
    ctx.save();
    ctx.globalAlpha = 0.75; ctx.fillStyle = st.paint ? C.steel : C.sheet; tilesPath(set); ctx.fill();
    ctx.globalAlpha = 1; ctx.setLineDash([6, 4]); ctx.strokeStyle = C.accent; ctx.lineWidth = 2;
    ctx.strokeRect(G.ox + x0 * s, G.oy - (y1 + 1) * s, (x1 - x0 + 1) * s, (y1 - y0 + 1) * s);
    ctx.restore();
  }

  function drawPaper() {
    const L = st.L;
    ctx.lineWidth = 1; ctx.strokeStyle = C.grid; ctx.beginPath();
    for (let k = 0; k < L.nT; k++) if (L.domain[k]) { const [x, y] = tileRect(k); ctx.rect(x + 0.5, y + 0.5, G.s - 1, G.s - 1); }
    ctx.stroke();
    // Ursprüngliche Form als schmale Strich-Zweipunktlinie
    ctx.save(); ctx.strokeStyle = C.ink2; ctx.lineWidth = 1;
    ctx.setLineDash([G.s * 0.9, G.s * 0.12, 1.5, G.s * 0.12, 1.5, G.s * 0.12]);
    strokeSegs(edges(L.domain)); ctx.restore();
  }

  // Entwurfsansicht: geschnittene Fläche schraffiert, gesperrte Kacheln kreuzschraffiert
  function drawBlind(solid, conn, showLoose, only) {
    const L = st.L, s = G.s;
    const set = new Uint8Array(L.nT), fro = new Uint8Array(L.nT), loose = new Uint8Array(L.nT);
    for (let k = 0; k < L.nT; k++) if (solid[k] && (!only || only(k))) {
      if (conn[k]) { set[k] = 1; fro[k] = L.frozen[k]; } else loose[k] = 1;
    }
    ctx.fillStyle = C.steel; tilesPath(set); ctx.fill();
    hatch(set, s / 3.2, false);
    ctx.fillStyle = C.steel2; tilesPath(fro); ctx.fill();
    hatch(fro, s / 4, true);
    ctx.strokeStyle = C.steel2; ctx.lineWidth = 1; ctx.beginPath();
    for (let k = 0; k < L.nT; k++) if (set[k]) { const [x, y] = tileRect(k); ctx.rect(x + 0.5, y + 0.5, s - 1, s - 1); }
    ctx.stroke();
    ctx.strokeStyle = C.ink; ctx.lineWidth = Math.max(1.5, s * 0.08); ctx.lineCap = 'square';
    strokeSegs(edges(set));
    ctx.lineCap = 'butt';
    if (showLoose) drawLoose(loose);
  }
  // Kacheln ohne Verbindung zum Lager: fallen beim Abgeben ab
  function drawLoose(loose) {
    if (!loose.some(Boolean)) return;
    ctx.save(); ctx.globalAlpha = 0.3; ctx.fillStyle = C.loose; tilesPath(loose); ctx.fill(); ctx.restore();
    ctx.save(); ctx.setLineDash([4, 3]); ctx.strokeStyle = C.loose; ctx.lineWidth = 1.5; strokeSegs(edges(loose)); ctx.restore();
  }

  // Ergebnisansicht: verformte Kacheln in Farbe der Auslastung, Aufdeck-Wisch, Bruch
  function drawResult(v) {
    const L = st.L, s = G.s, r = v.res;
    const falling = k => v.fall && v.fall.p > 0 && v.fall.set[k];
    const sweepCol = v.sweep == null ? L.TX : v.sweep * L.TX;
    if (!r.disp) {
      drawBlind(v.solid, r.conn, false, k => !falling(k));
    } else {
      if (sweepCol < L.TX) drawBlind(v.solid, r.conn, false, k => k % L.TX >= sweepCol);
      const scale = v.scale * (v.defo == null ? 1 : v.defo);
      if (scale) { ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = C.ink2; ctx.lineWidth = 1; strokeSegs(edges(r.fe)); ctx.restore(); }
      for (let k = 0; k < L.nT; k++) {
        if (!r.conn[k] || falling(k) || k % L.TX >= sweepCol) continue;
        if (!r.fe[k]) {   // hängt am Lager, trägt aber nichts
          const [x, y] = tileRect(k);
          ctx.fillStyle = C.steel; ctx.fillRect(x, y, s, s); ctx.strokeStyle = C.rule; ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
          continue;
        }
        const p = tilePoly(r, k, scale);
        polyPath(p); ctx.fillStyle = bandOf(r.tileUtil[k]); ctx.fill();
        ctx.strokeStyle = 'rgba(8,16,28,0.35)'; ctx.lineWidth = 0.8; ctx.stroke();
        if (r.tileUtil[k] > 1) {
          ctx.fillStyle = `rgba(255,255,255,${0.2 + 0.18 * Math.sin((v.t || 0) / 70)})`; ctx.fill();
          const [cx, cy] = center(p);
          ctx.beginPath(); ctx.moveTo(cx - s * 0.5, cy - s * 0.08); ctx.lineTo(cx - s * 0.2, cy + s * 0.13);
          ctx.lineTo(cx, cy - s * 0.14); ctx.lineTo(cx + s * 0.22, cy + s * 0.1); ctx.lineTo(cx + s * 0.5, cy - s * 0.05);
          ctx.strokeStyle = C.sheet; ctx.lineWidth = Math.max(1.5, s * 0.08); ctx.stroke();
        }
      }
      if (sweepCol >= L.TX && !(v.fall && v.fall.p > 0)) drawMax(r, scale);
    }
    if (v.loose) drawFalling(v.loose.set, v.loose.p, () => C.steel);
    else drawLoose(v.solid.map((x, k) => x && !r.conn[k] ? 1 : 0));
    if (v.fall) drawFalling(v.fall.set, v.fall.p, k => r.disp && r.fe[k] ? bandOf(r.tileUtil[k]) : C.steel);
  }

  function drawFalling(set, p, color) {
    if (p <= 0 || !set.some(Boolean)) return;
    const s = G.s;
    ctx.save(); ctx.globalAlpha = 1 - clamp01((p - 0.65) / 0.35);
    for (let k = 0; k < st.L.nT; k++) if (set[k]) {
      const [x, y] = tileRect(k), h = ((k * 2654435761) >>> 0) / 4294967296;
      ctx.save();
      ctx.translate(x + s / 2 + (h - 0.5) * s * 1.5 * p, y + s / 2 + p * p * (G.H * 0.9 + s * 2 * h));
      ctx.rotate((h - 0.5) * 2.4 * p);
      ctx.fillStyle = color(k); ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.strokeStyle = C.ink; ctx.lineWidth = 1; ctx.strokeRect(-s / 2, -s / 2, s, s);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawMax(r, scale) {
    if (r.maxTile < 0) return;
    const [cx, cy] = center(tilePoly(r, r.maxTile, scale)), txt = `Max ${fmt(100 * r.maxUtil)} %`;
    ctx.save(); ctx.font = `600 ${Math.max(11, G.s * 0.4)}px ${MONO}`;
    const w = ctx.measureText(txt).width + 12, h = Math.max(18, G.s * 0.62);
    const lx = Math.min(Math.max(4, cx + G.s * 0.7), G.W - w - 4), ly = Math.min(Math.max(4, cy - G.s * 0.9 - h), G.H - h - 4);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(lx, ly + h); ctx.stroke();
    ctx.fillStyle = C.sheet; ctx.fillRect(lx, ly, w, h); ctx.strokeRect(lx, ly, w, h);
    ctx.fillStyle = C.ink; ctx.textBaseline = 'middle'; ctx.fillText(txt, lx + 6, ly + h / 2);
    ctx.beginPath(); ctx.arc(cx, cy, 3, 0, 7); ctx.fill();
    ctx.restore();
  }

  // Lagersymbole wie in der Technischen Mechanik, an jeder Seite
  function drawSupports() {
    const s = G.s, P = ([x, y]) => [G.ox + x * s, G.oy - y * s];
    ctx.save(); ctx.strokeStyle = C.ink; ctx.fillStyle = C.sheet;
    for (const sp of st.def.supports) {
      const { a, b, p, n } = sideOf(sp), hs = s * 0.32;
      if (sp.kind === 'wand') {
        // Wandlinie 0,3 Kacheln über die eingespannten Kacheln hinaus, Schraffur nach außen
        const t = [Math.sign(b[0] - a[0]), Math.sign(b[1] - a[1])];
        let A = P([a[0] - t[0] * 0.3, a[1] - t[1] * 0.3]), B = P([b[0] + t[0] * 0.3, b[1] + t[1] * 0.3]);
        if (A[1] > B[1]) [A, B] = [B, A];   // Schraffur beginnt oben bzw. links
        ctx.lineWidth = Math.max(2, s * 0.1); ctx.beginPath(); ctx.moveTo(...A); ctx.lineTo(...B); ctx.stroke();
        const len = Math.hypot(B[0] - A[0], B[1] - A[1]), hx = (n[0] + Math.abs(n[1])) * hs, hy = (Math.abs(n[0]) - n[1]) * hs;
        ctx.lineWidth = 1; ctx.beginPath();
        for (let q = 0; q < len; q += s * 0.25) {
          const x = A[0] + (B[0] - A[0]) * q / len, y = A[1] + (B[1] - A[1]) * q / len;
          ctx.moveTo(x, y); ctx.lineTo(x + hx, y + hy);
        }
        ctx.stroke();
      } else {
        // Symbol für ein Lager unter dem Bauteil, gedreht auf die jeweilige Seite
        const [cx, cy] = P(p), h = s * 0.7, w = s * 0.85;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate({ bottom: 0, top: Math.PI, right: -Math.PI / 2, left: Math.PI / 2 }[sp.side]);
        ctx.lineWidth = Math.max(1.5, s * 0.06);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-w / 2, h); ctx.lineTo(w / 2, h); ctx.closePath();
        ctx.fill(); ctx.stroke();
        const gy = h + (sp.kind === 'los' ? s * 0.2 : 0);
        ctx.beginPath(); ctx.moveTo(-w * 0.8, gy); ctx.lineTo(w * 0.8, gy); ctx.stroke();
        ctx.lineWidth = 1; ctx.beginPath();
        for (let x = -w * 0.8; x < w * 0.8; x += s * 0.2) { ctx.moveTo(x + s * 0.2, gy); ctx.lineTo(x, gy + s * 0.2); }
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.restore();
  }

  function drawLoads(v) {
    const s = G.s, r = v.res && v.res.disp ? v.res : null;
    const scale = r ? (v.scale || 0) * (v.defo == null ? 1 : v.defo) : 0;
    for (const ld of st.def.loads) {
      const g = arrow(ld), u = scale ? nodeU(r, g.p[0] * M, g.p[1] * M) : [0, 0];
      const P = ([x, y]) => [G.ox + x * s + u[0] * scale / TILE * s, G.oy - y * s - u[1] * scale / TILE * s];
      const [tx, ty] = P(g.tip), [bx, by] = P(g.tail), [lx, ly] = P(g.lab), ux = g.f[0], uy = -g.f[1];
      const hl = s * 0.45, hw = s * 0.22;
      ctx.save(); ctx.strokeStyle = C.accent; ctx.fillStyle = C.accent; ctx.lineWidth = Math.max(2, s * 0.1);
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx - ux * hl, ty - uy * hl); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(tx, ty);
      ctx.lineTo(tx - ux * hl - uy * hw, ty - uy * hl + ux * hw); ctx.lineTo(tx - ux * hl + uy * hw, ty - uy * hl - ux * hw);
      ctx.closePath(); ctx.fill();
      ctx.font = `600 ${Math.max(12, s * 0.45)}px ${MONO}`; ctx.textBaseline = 'middle'; ctx.textAlign = g.lab[2];
      ctx.fillText(loadLabel(ld), lx, ly);
      ctx.restore();
    }
  }

  // Gesamtmaße: Breite unten oder oben, Höhe links oder rechts, je nachdem, wo Platz ist
  function drawDims() {
    const d = st.def, s = G.s, a = Math.max(5, s * 0.22), [hSide, hD] = G.F.dh, [vSide, vD] = G.F.dv;
    const x0 = G.ox, x1 = G.ox + d.tx * s, y0 = G.oy, yt = G.oy - d.ty * s;
    const sy = hSide === 'bottom' ? 1 : -1, ye = sy > 0 ? y0 : yt, yd = ye + sy * s * hD;
    const sx = vSide === 'left' ? -1 : 1, xe = sx < 0 ? x0 : x1, xd = xe + sx * s * vD;
    const head = (x, y, ux, uy) => {
      ctx.beginPath(); ctx.moveTo(x, y);
      ctx.lineTo(x - ux * a - uy * a * 0.3, y - uy * a + ux * a * 0.3); ctx.lineTo(x - ux * a + uy * a * 0.3, y - uy * a - ux * a * 0.3);
      ctx.closePath(); ctx.fill();
    };
    ctx.save(); ctx.strokeStyle = C.ink2; ctx.fillStyle = C.ink2; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, ye + sy * s * 0.15); ctx.lineTo(x0, yd + sy * a); ctx.moveTo(x1, ye + sy * s * 0.15); ctx.lineTo(x1, yd + sy * a);
    ctx.moveTo(xe + sx * s * 0.15, y0); ctx.lineTo(xd + sx * a, y0); ctx.moveTo(xe + sx * s * 0.15, yt); ctx.lineTo(xd + sx * a, yt);
    ctx.moveTo(x0, yd); ctx.lineTo(x1, yd); ctx.moveTo(xd, y0); ctx.lineTo(xd, yt);
    ctx.stroke();
    head(x0, yd, -1, 0); head(x1, yd, 1, 0); head(xd, y0, 0, 1); head(xd, yt, 0, -1);
    ctx.font = `500 ${Math.max(11, s * 0.42)}px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(String(d.tx * TILE), (x0 + x1) / 2, yd - 3);
    ctx.translate(xd - 3, (y0 + yt) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(String(d.ty * TILE), 0, 0);
    ctx.restore();
  }

  // ---------- Oberfläche ----------
  const editable = () => (st.phase === 'design' || st.phase === 'probe') && !st.busy;

  function statusText(r) {
    if (r.ok) return `max. Auslastung ${fmt(100 * r.maxUtil)} %, hält.`;
    if (r.reason === 'spannung') return `max. Auslastung ${fmt(100 * r.maxUtil)} %, versagt.`;
    if (r.reason === 'lastpfad') return 'Die Last hat keine Verbindung zum Lager.';
    return 'Das Bauteil ist nicht ausreichend gelagert (Starrkörperbewegung).';
  }
  function showFem(r, scale) {
    let t = '';
    if (r.reason === 'mechanismus') t = 'Steifigkeitsmatrix singulär: Das Restbauteil kann sich als starrer Körper bewegen.';
    else if (r.disp) t = `FE-Modell: ${fmt(r.elements)} Elemente, ${fmt(r.dofs)} Freiheitsgrade, gelöst in ${fmt(r.ms)} ms` +
      (!scale ? '.' : scale >= 1 ? `. Verformung ${fmt(scale, scale % 1 ? 1 : 0)}-fach überhöht.` : '. Verformung verkleinert dargestellt.');
    $('femline').textContent = t;
    $('legend').hidden = !r.disp;
  }

  function panel() {
    if (st.phase === 'edit') return edPanel();
    const L = st.L, d = st.def, total = count(L.domain);
    const kept = count(st.phase === 'eso' ? st.eso[st.key].res.conn : st.conn);
    $('tb-name').textContent = partName(d);
    $('tb-load').textContent = loadLabel(d.loads[0]);
    $('tb-size').textContent = `${d.tx * TILE} × ${d.ty * TILE} × ${THICK} mm`;
    $('tb-mass').textContent = `${fmt(kept * TILE_G)} von ${fmt(total * TILE_G)} g`;
    $('tb-removed').textContent = `${fmt(100 * (1 - kept / total), 1)} %`;
    $('tb-probe').textContent = st.open || (mp.role === 'host' && mp.g.mo === 'o') ? 'entfällt, offene Karten'
      : mp.role === 'host' ? `${mp.g.pr} je Person`
      : st.probes ? `${st.probes} übrig` : mp.on ? 'keine übrig' : 'verbraucht';
    const rid = mp.role === 'host' ? mp.g.rid : mp.rid;
    $('tb-sheet').textContent = mp.on ? (rid ? `Runde ${rid}` : 'Warteraum')
      : st.li === RANDOM ? 'Zufallsbauteil' : st.li === CUSTOM ? 'Baukasten' : `${st.li + 1} von ${LEVELS.length}`;
  }

  function controls() {
    const design = st.phase === 'design' || st.phase === 'probe', edit = st.phase === 'edit';
    $('act-design').hidden = !design;
    $('act-result').hidden = design || edit;
    $('act-edit').hidden = !edit;
    $('etools').hidden = !edit;
    if (!mp.on) $('tools').hidden = edit;
    for (const b of document.querySelectorAll('.actions .btn')) b.disabled = st.busy;
    if (!st.busy) {
      $('b-probe').disabled = !st.probes || $('live').checked;
      $('b-undo').disabled = !st.undo.length;
      $('b-eso').disabled = !st.eso[st.key];
      $('b-play').disabled = !(edit && ed.res && ed.res.def);
    }
    $('b-probe').textContent = `Probe-Rechnung (${st.probes})`;
    $('b-probe').hidden = $('b-undo').hidden = $('b-reset').hidden = st.open;
    $('live-row').hidden = st.open || edit || !!duel;   // in einer Herausforderung keine Live-Spannungen
    // herausfordern nur mit einem gehaltenen Ergebnis, das ohne Live-Spannungen entstanden ist
    $('b-duel').hidden = mp.on || st.phase !== 'result' || !st.res || !st.res.ok || st.practice;
    if (st.phase !== 'result') $('share').hidden = true;
    const openRules = st.open || (mp.role === 'host' && mp.g.mo === 'o');   // der Beamer erklärt die Regeln der laufenden Runde
    $('howto').hidden = openRules || edit;
    $('howto-open').hidden = !openRules || edit;
    $('howto-edit').hidden = !edit;
    $('b-submit').textContent = st.open ? 'Aufhören und werten' : 'Abgeben und rechnen';
    $('b-eso').textContent = st.phase === 'eso' ? 'Mein Ergebnis' : 'Lösung des Algorithmus';
    $('live').disabled = !design || st.busy;
    $('t-rect').disabled = $('t-brush').disabled = !design || st.busy;
    cv.classList.toggle('locked', !design);
  }

  // Nach jeder Änderung im Entwurf
  function refresh() {
    st.conn = FEM.connect(st.L, st.solid, st.L.supportTiles);
    const loose = st.solid.some((x, k) => x && !st.conn[k]);
    const hint = loose ? '<p>Rot gestrichelte Kacheln haben keine Verbindung zum Lager und fallen beim Abgeben ab.</p>' : '';
    if (st.open && st.phase === 'design') {
      const r = FEM.analyze(st.L, st.solid);
      if (!r.ok) return openFail();
      st.view = { mode: 'result', res: r, solid: st.solid, scale: 0 };
      showFem(r, 0);
      st.liveText = `Offene Karten: ${statusText(r)} Jede Wegnahme ist endgültig.`;
      $('verdict').innerHTML = `<p>${st.liveText}</p>${hint}`;
      if (mp.role === 'player') pres({ rm: Math.round(removedPct(st.L, st.conn) * 10) });   // Fortschritt für den Beamer
    } else if (!mp.on && $('live').checked) {
      const r = FEM.analyze(st.L, st.solid);
      st.view = { mode: 'result', res: r, solid: st.solid, scale: 0 };
      showFem(r, 0);
      $('verdict').innerHTML = `<p>Live: ${statusText(r)}</p>${hint}`;
    } else if (st.phase === 'design') {
      st.view = { mode: 'blind' };
      $('legend').hidden = true;
      $('femline').textContent = '';
      $('verdict').innerHTML = `<p>${st.def.note}</p>${hint}`;
    }
    panel(); controls(); render(); mpRender(); duelRender();
  }

  // i: festes Bauteil, RANDOM mit Nummer oder CUSTOM mit Code als arg
  function loadLevel(i, arg) {
    st.animId++;
    const def = i === RANDOM ? PARTS.generate(arg) : i === CUSTOM ? PARTS.fromCode(arg) || LEVELS[0] : LEVELS[i];
    st.li = i; st.def = def; st.key = def.nr ? 'z' + def.nr : def.code ? 'b' + def.code : i; st.L = FEM.level(def);
    if (duel && duel.key !== partKey()) duel = null;   // anderes Bauteil beendet die Herausforderung
    st.solid = st.L.domain.slice(); st.undo = []; st.probes = 1; st.phase = 'design'; st.busy = false; st.practice = $('live').checked;
    st.drag = null; st.paint = null; st.hover = -1;
    $('stamp').hidden = true;
    document.querySelectorAll('#levels button').forEach((b, k) => b.setAttribute('aria-pressed', String(k === i)));
    // Zufalls- und eigene Bauteile im Link festhalten, damit man sie wiederholen oder weitergeben kann (Einladungslinks bleiben)
    if (!mp.on && !duel && (i >= RANDOM || /^#(nr|bau|duell)[-~]/.test(location.hash))) {
      const h = def.nr ? '#nr-' + def.nr : def.code ? '#bau-' + def.code : location.pathname + location.search;
      try { history.replaceState(null, '', h); } catch {}
    }
    layout(); refresh(); startEso();
  }

  function setTile(k) {
    const L = st.L;
    if (k < 0 || !L.domain[k] || L.frozen[k] || st.solid[k] === st.paint) return false;
    st.solid[k] = st.paint;
    st.phase = 'design';
    return true;
  }

  function undo() {
    if (st.open || !st.undo.length || !editable()) return;
    st.solid = st.undo.pop(); st.phase = 'design'; refresh();
  }

  // Offene Karten: die letzte Wegnahme hat das Bauteil zum Versagen gebracht, das Spiel ist vorbei
  function openFail() {
    st.paint = null; st.drag = null;
    if (mp.role === 'player') return playerBreak();
    $('verdict').innerHTML = '<p>Rechnet …</p>';
    runReveal(verdict);
  }

  function probe() {
    if (!st.probes || !editable()) return;
    st.probes--;
    const r = FEM.analyze(st.L, st.solid);
    st.phase = 'probe';
    st.view = { mode: 'result', res: r, solid: st.solid, scale: 0 };
    showFem(r, 0);
    st.probeText = `Probe-Rechnung: ${statusText(r)} Die Farben verschwinden, sobald Sie weiterarbeiten.`;
    if (mp.role === 'player') pres({ pu: mp.pr - st.probes });   // verbrauchte Proben für den Beamer
    $('verdict').innerHTML = `<p>${st.probeText}</p>`;
    panel(); controls(); render(); mpRender();
  }

  function play(dur, frame, done) {
    const id = ++st.animId, t0 = performance.now();
    const step = now => {
      if (id !== st.animId) return;
      const t = Math.max(0, now - t0);
      try { frame(Math.min(t, dur)); } catch (e) { console.error(e); }
      if (t < dur) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  }

  function stamp(ok) {
    const el = $('stamp');
    if (!el.hidden) return;
    el.textContent = ok ? 'HÄLT' : 'BRUCH';
    el.className = 'stamp ' + (ok ? 'ok' : 'bad') + (reduce ? '' : ' hit');
    el.hidden = false;
  }

  function submit() {
    if (!editable()) return;
    $('verdict').innerHTML = '<p>Rechnet …</p>';
    runReveal(verdict);
  }

  // Rechnet den aktuellen Entwurf und deckt ihn auf; done(r) läuft nach der Animation
  function runReveal(done) {
    const L = st.L, r = FEM.analyze(L, st.solid), fe = !!r.disp;
    st.res = r; st.phase = 'result'; st.busy = true;
    const loose = new Uint8Array(L.nT);
    for (let k = 0; k < L.nT; k++) loose[k] = st.solid[k] && !r.conn[k] ? 1 : 0;
    // Was nach dem Versagen abfällt: überlastete Kacheln und alles, was dann nicht mehr am Lager hängt
    let fall = null;
    if (r.reason === 'spannung') {
      const rest = r.conn.slice();
      for (let k = 0; k < L.nT; k++) if (r.tileUtil[k] > 1) rest[k] = 0;
      const keep = FEM.connect(L, rest, L.supportTiles);
      fall = new Uint8Array(L.nT);
      for (let k = 0; k < L.nT; k++) fall[k] = r.conn[k] && !keep[k] ? 1 : 0;
    } else if (r.reason === 'mechanismus') fall = r.fe.slice();
    const v = st.view = { mode: 'result', res: r, solid: st.solid, scale: fe ? niceScale(r) : 0, sweep: fe ? 0 : 1,
      defo: 0, t: 0, loose: { set: loose, p: 0 }, fall: fall && { set: fall, p: 0 } };
    showFem(r, v.scale);
    $('stamp').hidden = true;
    panel(); controls();
    const T1 = fe ? 700 : 350, T2 = T1 + (fe ? 1000 : 0), TB = T2 + 300, TE = fall ? TB + 1400 : T2 + 300;
    const finish = () => {
      v.sweep = 1; v.defo = 1; v.loose.p = 1; if (v.fall) v.fall.p = 1;
      st.busy = false; stamp(r.ok); done(r); controls(); render();
    };
    if (reduce) return finish();
    play(TE, t => {
      v.t = t;
      v.loose.p = clamp01(t / 900);
      if (fe) {
        v.sweep = clamp01(t / T1);
        const d = (t - T1) / (T2 - T1);
        v.defo = d <= 0 ? 0 : d >= 1 ? 1 : 1 - Math.exp(-4 * d) * Math.cos(9 * d);   // gedämpftes Einschwingen
      }
      if (t >= T2 - 150) stamp(r.ok);
      if (v.fall) v.fall.p = clamp01((t - TB) / 1300);
      render();
    }, finish);
  }

  function verdict() {
    const r = st.res, L = st.L, total = count(L.domain), rem = removedPct(L, r.conn), e = st.eso[st.key];
    let h;
    if (r.ok) h = `<p><span class="t-ok">Hält.</span> Max. Auslastung ${fmt(100 * r.maxUtil)} %. Sie haben ${fmt(rem, 1)} % Material entfernt.</p>`;
    else {
      let why = 'Das Bauteil ist nicht mehr ausreichend gelagert und rutscht weg (Starrkörperbewegung).';
      if (r.reason === 'lastpfad') why = 'Die Last hat keine Verbindung mehr zum Lager.';
      if (r.reason === 'spannung') {
        const n = count(Array.from(r.tileUtil, u => u > 1));
        why = `${n === 1 ? 'Eine Kachel liegt' : `${n} Kacheln liegen`} über der Streckgrenze, max. Auslastung ${fmt(100 * r.maxUtil)} %.`;
      }
      h = `<p><span class="t-bad">Versagt.</span> ${why} Gewertet: 0 %.</p>`;
    }
    if (!e) h += '<p>Der Algorithmus rechnet noch …</p>';
    else {
      const er = 100 * (1 - count(e.res.conn) / total);
      let cmp = '';
      if (r.ok) cmp = rem > er + 1e-9 ? 'Algorithmus geschlagen!' : rem > er - 1e-9 ? 'Gleichstand mit dem Algorithmus.'
        : er - rem <= 5 ? 'Knapp dran.' : 'Da geht noch was.';
      h += `<p>Algorithmus (ESO): ${fmt(er, 1)} % entfernt, max. Auslastung ${fmt(100 * e.res.maxUtil)} %. ${cmp}</p>`;
    }
    $('verdict').innerHTML = h;
    duelRender();
  }

  // ---------- Herausforderung ----------
  // Link mit Bauteil, Spielart, Ergebnis und Namen; wer ihn öffnet, spielt dasselbe Bauteil und versucht, das Ergebnis zu schlagen.
  // Nichts wird gespeichert. Die Links gehen an die öffentliche Seite, die ohne VPN erreichbar ist (lokal zum Testen an die eigene).
  const PUBLIC_URL = 'https://fkaule.github.io/Knackpunkt/';
  const partKey = () => st.def.nr ? 'z' + st.def.nr : st.def.code ? 'b' + st.def.code : 'f' + st.li;
  function parseDuel(hash) {
    const m = /^#duell~(f[0-2]|z[1-9]\d{0,4}|b[^~]+)~([bo])~(\d{1,4})~([^~]*)$/.exec(hash);
    if (!m || +m[3] > 1000) return null;
    let name = '';
    try { name = clean(decodeURIComponent(m[4]), 16); } catch {}
    const k = m[1], part = k[0] === 'f' ? [+k[1]] : k[0] === 'z' ? [RANDOM, +k.slice(1)] : [CUSTOM, k.slice(1)];
    if (part[0] === CUSTOM && !PARTS.fromCode(part[1])) return null;
    return { key: k, open: m[2] === 'o', pct10: +m[3], name: name || 'Jemand', part };
  }
  function shareLink() {
    const base = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? location.origin + location.pathname : PUBLIC_URL;
    const pct10 = Math.round(removedPct(st.L, st.res.conn) * 10), name = clean($('share-name').value, 16) || 'Jemand';
    return `${base}#duell~${partKey()}~${st.open ? 'o' : 'b'}~${pct10}~${encodeURIComponent(name)}`;
  }
  // oben im Bedienfeld: vor dem Werten das Ziel, danach der Ausgang
  function duelRender() {
    const el = $('duel');
    el.hidden = !duel || mp.on || st.phase === 'edit';
    if (el.hidden) return;
    const who = esc(duel.name), goal = fmt(duel.pct10 / 10, 1) + ' %';
    let h = `<p><b>Herausforderung von ${who}</b> (${duel.open ? 'offene Karten' : 'blind'}): ${who} hat ${goal} entfernt, ` +
      'und das Bauteil hält. Schaffen Sie mehr?</p>';
    if (st.phase === 'result' && st.res && !st.busy) {
      const mine = st.res.ok ? Math.round(removedPct(st.L, st.res.conn) * 10) : -1;
      h = mine > duel.pct10 ? `<p><span class="t-ok">Gewonnen!</span> ${fmt(mine / 10, 1)} % gegen ${goal} von ${who}.</p>`
        : mine === duel.pct10 ? `<p><b>Gleichstand</b> mit ${who}: beide ${goal}.</p>`
        : `<p><span class="t-bad">${who} liegt vorn:</span> ${goal} gegen ${mine < 0 ? 'Bruch' : fmt(mine / 10, 1) + ' %'}.</p>`;
      h += `<p>„Neuer Versuch“ startet dasselbe Bauteil noch einmal${mine >= 0 ? ', „Kommilitonen herausfordern“ schickt Ihr Ergebnis zurück' : ''}.</p>`;
    }
    el.innerHTML = h;
  }

  function toggleEso() {
    const e = st.eso[st.key];
    if (!e || st.busy) return;
    if (st.phase === 'eso') {
      st.phase = 'result'; st.view = st.resultView;
      showFem(st.res, st.view.scale); stamp(st.res.ok); verdict();
    } else {
      st.resultView = st.view; st.phase = 'eso';
      st.view = { mode: 'result', res: e.res, solid: e.res.conn, scale: niceScale(e.res) };
      $('stamp').hidden = true; showFem(e.res, st.view.scale);
      const er = 100 * (1 - count(e.res.conn) / count(st.L.domain));
      $('verdict').innerHTML = `<p>Lösung der Evolutionären Strukturoptimierung: ${fmt(er, 1)} % entfernt in ${e.order.length} Schritten, ` +
        `max. Auslastung ${fmt(100 * e.res.maxUtil)} %.</p>`;
    }
    panel(); controls(); render();
  }

  // ESO läuft im Hintergrund in kleinen Zeitscheiben, damit das Zeichnen flüssig bleibt
  function startEso() {
    const key = st.key;
    if (st.eso[key] || (st.esoRun && st.esoRun.key === key)) return;
    const gen = FEM.eso(st.L), run = st.esoRun = { key };
    const pump = () => {
      if (st.esoRun !== run) return;
      const t0 = performance.now();
      let s;
      do s = gen.next(); while (!s.done && performance.now() - t0 < 12);
      if (!s.done) return void setTimeout(pump, 0);
      for (const k in st.eso) if (k[0] === 'z' || k[0] === 'b') delete st.eso[k];   // von Zufalls- und eigenen Bauteilen nur das aktuelle
      st.eso[key] = s.value; st.esoRun = null;
      if (st.key === key && st.phase === 'result' && !st.busy) { verdict(); controls(); }
    };
    setTimeout(pump, 300);
  }

  // ---------- Baukasten ----------
  // Raster mit Material; Einspannungen, Lager und Last hängen an Außenkanten, Schlüssel "x,y,Seite"
  const ED_TX = 24, ED_TY = 16;
  const ed = { cells: null, walls: new Set(), pins: new Map(), load: [], deg: -90, tool: 'form', drag: null, hover: null, raw: null, res: null };
  const vert = side => side === 'left' || side === 'right';
  const edHas = (x, y) => x >= 0 && y >= 0 && x < ED_TX && y < ED_TY && ed.cells[x + y * ED_TX] === 1;
  const edFree = key => { const [x, y, side] = key.split(','), [dx, dy] = OUT[side]; return edHas(+x, +y) && !edHas(+x + dx, +y + dy); };
  const ED_MSG = {
    leer: 'Noch kein Material: Mit „Material“ ein Rechteck aufziehen.',
    zerfallen: 'Das Bauteil zerfällt in mehrere Teile. Alles muss über Kanten zusammenhängen.',
    lager: 'Es fehlt ein Lager: Einspannung, Festlager oder Loslager auf eine Außenkante setzen.',
    last: 'Es fehlt die Last: Mit „Last“ auf eine Außenkante klicken.',
    kante: 'Lager und Last müssen an einer Außenkante sitzen.',
    beweglich: 'So kann sich das Bauteil noch bewegen (Starrkörperbewegung). Lager ergänzen: Ein Loslager hält nur in einer Richtung.',
    bereich: 'Die Last läge nicht zwischen 1 und 100 kN. Last und Lager weiter auseinander setzen oder mehr Material stehen lassen.',
  };

  // Erster Aufruf oder von einem anderen Bauteil aus: dieses Bauteil zum Abwandeln übernehmen
  function openEditor() {
    st.animId++;
    if (!ed.cells || st.li !== CUSTOM) edFrom(st.def);
    Object.assign(st, { li: CUSTOM, phase: 'edit', busy: false, drag: null, paint: null, hover: -1 });
    $('stamp').hidden = true; $('legend').hidden = true; $('femline').textContent = '';
    document.querySelectorAll('#levels button').forEach((b, k) => b.setAttribute('aria-pressed', String(k === CUSTOM)));
    edUpdate();
  }
  function edFrom(d) {
    const ox = Math.max(0, (ED_TX - d.tx) >> 1), oy = Math.max(0, (ED_TY - d.ty) >> 1), L = FEM.level(d);
    ed.cells = new Uint8Array(ED_TX * ED_TY);
    for (let k = 0; k < L.nT; k++) if (L.domain[k]) {
      const x = k % d.tx + ox, y = Math.floor(k / d.tx) + oy;
      if (x < ED_TX && y < ED_TY) ed.cells[x + y * ED_TX] = 1;
    }
    ed.walls = new Set(); ed.pins = new Map();
    for (const sp of d.supports) for (const [x, y] of sp.tiles) {
      const key = `${x + ox},${y + oy},${sp.side}`;
      if (sp.kind === 'wand') ed.walls.add(key); else ed.pins.set(key, sp.kind);
    }
    const ld = d.loads[0];
    ed.load = ld.tiles.map(([x, y]) => `${x + ox},${y + oy},${ld.side}`);
    ed.deg = Math.round(Math.atan2(ld.fy, ld.fx) / (Math.PI / 4)) * 45;
    if (ed.deg === -180) ed.deg = 180;
  }
  // Rohform für PARTS, auf Wunsch auf das umschließende Rechteck zugeschnitten
  function edRaw(trim) {
    let x0 = 0, y0 = 0, tx = ED_TX, ty = ED_TY;
    if (trim) {
      let x1 = -1, y1 = -1;
      x0 = ED_TX; y0 = ED_TY;
      for (let k = 0; k < ed.cells.length; k++) if (ed.cells[k]) {
        const x = k % ED_TX, y = (k - x) / ED_TX;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      if (x1 < 0) return { tx: 1, ty: 1, cells: new Uint8Array(1), supports: [], load: null };
      tx = x1 - x0 + 1; ty = y1 - y0 + 1;
    }
    const cells = new Uint8Array(tx * ty);
    for (let y = 0; y < ty; y++) for (let x = 0; x < tx; x++) cells[x + y * tx] = ed.cells[x + x0 + (y + y0) * ED_TX];
    const parse = key => { const [x, y, side] = key.split(','); return [+x - x0, +y - y0, side]; };
    // Einspannungen: aneinanderstoßende Kanten derselben Seite zu einer Einspannung zusammenfassen
    const walls = [...ed.walls].map(parse)
      .sort((a, b) => a[2].localeCompare(b[2]) || (vert(a[2]) ? a[0] - b[0] || a[1] - b[1] : a[1] - b[1] || a[0] - b[0]));
    const runs = [];
    for (const [x, y, side] of walls) {
      const r = runs.at(-1), q = r && r.tiles.at(-1);
      if (r && r.side === side && (vert(side) ? q[0] === x && q[1] + 1 === y : q[1] === y && q[0] + 1 === x)) r.tiles.push([x, y]);
      else runs.push({ kind: 'wand', side, tiles: [[x, y]] });
    }
    const pins = [...ed.pins].map(([key, kind]) => { const [x, y, side] = parse(key); return { kind, side, tiles: [[x, y]] }; });
    const ld = ed.load.map(parse);
    return { tx, ty, cells, supports: [...runs, ...pins],
      load: ld.length ? { side: ld[0][2], tiles: ld.map(([x, y]) => [x, y]), deg: ed.deg } : null };
  }
  // Nach jeder Änderung: ungültige Kanten entfernen, prüfen, Last bemessen, zeichnen
  function edUpdate() {
    for (const k of ed.walls) if (!edFree(k)) ed.walls.delete(k);
    for (const k of [...ed.pins.keys()]) if (!edFree(k)) ed.pins.delete(k);
    if (!ed.load.every(edFree)) ed.load = [];
    ed.raw = edRaw(true);
    ed.res = PARTS.build(ed.raw);
    const view = PARTS.shape(edRaw(false)), d = ed.res.def;
    view.margin = [3, 4, 3, 4];   // feste Ränder, damit beim Bauen nichts springt
    if (view.loads[0]) {
      if (d) Object.assign(view.loads[0], { fx: d.loads[0].fx, fy: d.loads[0].fy });
      else view.loads[0].unknown = true;
    }
    st.def = view; st.L = FEM.level(view); st.solid = ed.cells;
    $('verdict').innerHTML = `<p>${d ? `<span class="t-ok">Bereit.</span> Die Last wird auf ${loadLabel(d.loads[0])} gesetzt, ` +
      `damit das Vollteil zu ${fmt(100 * d.util)} % ausgelastet ist. „Spielen“ startet den Entwurf.` : ED_MSG[ed.res.error]}</p>`;
    layout(); panel(); controls(); render();
  }
  function edPanel() {
    const n = count(ed.cells), d = ed.res && ed.res.def;
    $('tb-name').textContent = 'Eigenes Bauteil';
    $('tb-load').textContent = d ? loadLabel(d.loads[0]) : 'noch offen';
    $('tb-size').textContent = n ? `${ed.raw.tx * TILE} × ${ed.raw.ty * TILE} × ${THICK} mm` : 'noch offen';
    $('tb-mass').textContent = `${fmt(n * TILE_G)} g`;
    $('tb-removed').textContent = `${fmt(0, 1)} %`;
    $('tb-probe').textContent = st.open ? 'entfällt, offene Karten' : '1 übrig';
    $('tb-sheet').textContent = 'Baukasten';
  }

  function drawEditor() {
    const L = st.L, s = G.s;
    ctx.lineWidth = 1; ctx.strokeStyle = C.grid; ctx.beginPath();   // alle Kacheln, damit man sieht, wo Material hin kann
    for (let k = 0; k < L.nT; k++) { const [x, y] = tileRect(k); ctx.rect(x + 0.5, y + 0.5, s - 1, s - 1); }
    ctx.stroke();
    drawBlind(ed.cells, ed.cells, false);
    const d = ed.drag;
    if (d && ed.tool === 'form') {
      const x0 = Math.min(d.a[0], d.b[0]), x1 = Math.max(d.a[0], d.b[0]), y0 = Math.min(d.a[1], d.b[1]), y1 = Math.max(d.a[1], d.b[1]);
      ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = d.v ? C.steel : C.sheet;
      ctx.fillRect(G.ox + x0 * s, G.oy - (y1 + 1) * s, (x1 - x0 + 1) * s, (y1 - y0 + 1) * s);
      ctx.globalAlpha = 1; ctx.setLineDash([6, 4]); ctx.strokeStyle = C.accent; ctx.lineWidth = 2;
      ctx.strokeRect(G.ox + x0 * s, G.oy - (y1 + 1) * s, (x1 - x0 + 1) * s, (y1 - y0 + 1) * s);
      ctx.restore();
    } else if (!d && ed.tool === 'form' && ed.hover) {
      const [x, y] = ed.hover;
      ctx.strokeStyle = C.accent; ctx.lineWidth = 2; ctx.strokeRect(G.ox + x * s + 1, G.oy - (y + 1) * s + 1, s - 2, s - 2);
    }
    // Kanten, auf die das Werkzeug wirken würde
    const keys = ed.tool === 'form' ? [] : d ? edRun(d.a, d.b, ed.tool === 'wand') : ed.hover ? [ed.hover] : [];
    ctx.save(); ctx.strokeStyle = C.accent; ctx.lineWidth = Math.max(3, s * 0.16); ctx.lineCap = 'round'; ctx.beginPath();
    for (const key of keys) {
      const g = sideOf({ tiles: [key.split(',').slice(0, 2).map(Number)], side: key.split(',')[2] });
      ctx.moveTo(G.ox + g.a[0] * s, G.oy - g.a[1] * s); ctx.lineTo(G.ox + g.b[0] * s, G.oy - g.b[1] * s);
    }
    ctx.stroke(); ctx.restore();
  }

  const edPos = e => { const b = cv.getBoundingClientRect(); return [(e.clientX - b.left - G.ox) / G.s, (G.oy - e.clientY + b.top) / G.s]; };
  const edCell = ([px, py]) => [Math.max(0, Math.min(ED_TX - 1, Math.floor(px))), Math.max(0, Math.min(ED_TY - 1, Math.floor(py)))];
  // nächste Außenkante am Zeiger, mit der Maus höchstens eine halbe Kachel entfernt, mit dem Finger eine ganze
  function edEdge([px, py], touch) {
    let best = null, bd = touch ? 1 : 0.5;
    for (let y = Math.floor(py) - 1; y <= Math.floor(py) + 1; y++) for (let x = Math.floor(px) - 1; x <= Math.floor(px) + 1; x++) {
      if (!edHas(x, y)) continue;
      for (const side of ['left', 'right', 'top', 'bottom']) {
        const [dx, dy] = OUT[side];
        if (edHas(x + dx, y + dy)) continue;
        const mx = x + 0.5 + dx / 2, my = y + 0.5 + dy / 2;
        const dist = vert(side) ? Math.hypot(px - mx, Math.max(0, Math.abs(py - my) - 0.5)) : Math.hypot(Math.max(0, Math.abs(px - mx) - 0.5), py - my);
        if (dist < bd) { bd = dist; best = `${x},${y},${side}`; }
      }
    }
    return best;
  }
  // gerade Außenkante von a bis b; ein Klick (a gleich b) mit whole nimmt die ganze gerade Kante
  function edRun(a, b, whole) {
    const [ax, ay, side] = a.split(','), [bx, by, side2] = b.split(','), v = vert(side);
    const key = i => v ? `${ax},${+ay + i},${side}` : `${+ax + i},${ay},${side}`;
    const out = [a];
    if (a === b && whole) {
      for (const dir of [-1, 1]) for (let i = dir; edFree(key(i)); i += dir) out.push(key(i));
      return out;
    }
    if (side2 !== side || (v ? bx !== ax : by !== ay)) return out;
    const n = v ? by - ay : bx - ax, dir = Math.sign(n);
    for (let i = dir; dir && Math.abs(i) <= Math.abs(n) && edFree(key(i)); i += dir) out.push(key(i));
    return out;
  }
  function edApply(keys, click) {
    const clear = k => { ed.walls.delete(k); ed.pins.delete(k); if (ed.load.includes(k)) ed.load = []; };
    const t = ed.tool;
    if (t === 'wand') {
      const on = keys.every(k => ed.walls.has(k));
      for (const k of keys) if (on) ed.walls.delete(k); else { clear(k); ed.walls.add(k); }
    } else if (t === 'fest' || t === 'los') {
      const k = keys[0];
      if (ed.pins.get(k) === t) ed.pins.delete(k); else { clear(k); ed.pins.set(k, t); }
    } else if (click && ed.load.includes(keys[0])) {
      const TURN = [-90, -135, 180, 135, 90, 45, 0, -45];   // Klick auf die Last dreht sie im Uhrzeigersinn
      ed.deg = TURN[(TURN.indexOf(ed.deg) + 1) % 8];
    } else {
      for (const k of keys) clear(k);
      ed.load = keys; ed.deg = -90;
    }
  }
  cv.addEventListener('pointerdown', e => {
    if (st.phase !== 'edit') return;
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    const p = edPos(e);
    if (ed.tool === 'form') { const c = edCell(p); ed.drag = { a: c, b: c, v: edHas(...c) ? 0 : 1 }; }
    else { const k = edEdge(p, e.pointerType === 'touch'); ed.drag = k ? { a: k, b: k } : null; }
    render();
  });
  cv.addEventListener('pointermove', e => {
    if (st.phase !== 'edit') return;
    const p = edPos(e), d = ed.drag;
    if (d) {
      const b = ed.tool === 'form' ? edCell(p) : edEdge(p, e.pointerType === 'touch') || d.b;
      if (String(b) !== String(d.b)) { d.b = b; render(); }
      return;
    }
    const h = ed.tool === 'form' ? edCell(p) : edEdge(p);
    if (String(h) !== String(ed.hover)) { ed.hover = h; render(); }
  });
  cv.addEventListener('pointerup', () => {
    const d = ed.drag;
    if (st.phase !== 'edit' || !d) return;
    ed.drag = null;
    if (ed.tool === 'form') {
      for (let y = Math.min(d.a[1], d.b[1]); y <= Math.max(d.a[1], d.b[1]); y++)
        for (let x = Math.min(d.a[0], d.b[0]); x <= Math.max(d.a[0], d.b[0]); x++) ed.cells[x + y * ED_TX] = d.v;
    } else edApply(edRun(d.a, d.b, ed.tool === 'wand'), d.a === d.b);
    edUpdate();
  });
  cv.addEventListener('pointerleave', () => { if (st.phase === 'edit' && ed.hover) { ed.hover = null; render(); } });
  $('etools').onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    ed.tool = b.dataset.t;
    for (const x of $('etools').children) x.setAttribute('aria-pressed', String(x === b));
    ed.hover = null; render();
  };
  $('b-play').onclick = () => {
    if (!ed.res || !ed.res.def) return;
    const code = PARTS.encode(ed.raw);
    store.set('bau', code);   // für den Wettkampf und das nächste Mal
    loadLevel(CUSTOM, code);
  };
  $('b-clear').onclick = () => { ed.cells.fill(0); ed.walls.clear(); ed.pins.clear(); ed.load = []; edUpdate(); };

  // ---------- Wettkampf: Verbindung ----------
  // Im claude.ai-Artifact über den eingebauten Raum, sonst über den eigenen Spielserver (WebSocket /ws).
  // Beide mit derselben Schnittstelle; genutzt wird nur Presence: jedes Gerät zeigt seinen Stand.
  // Mitspielende: k Raumcode, n Name, j Beitrittszeit, r Runde, s abgegeben (0/1), d Entwurf
  // Spielleitung: k, h = 1, n, j, g {rid, ph, lv, dur, left}, res [[peer, Name, Prozent mal 10, hält]], sc [[Name, Punkte mal 10]]
  function serverRoom() {
    if (!/^https?:$/.test(location.protocol) || !window.WebSocket) return null;
    // relativ zur Seite, damit das Spiel auch unter einem Unterpfad läuft (etwa /knackpunkt/ hinter nginx)
    const u = new URL('ws', location.href);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = u.href;
    const mine = {}, others = new Map(), peerH = [], connH = [];
    let ws = null, me = null, up = false, delay = 1000, sendTimer = null, pending = false;
    const snap = () => {
      const a = me ? [{ peer: me, isMe: true, sameTab: true, presence: { ...mine } }] : [];
      for (const [peer, presence] of others) a.push({ peer, isMe: false, sameTab: false, presence });
      return a;
    };
    const notify = () => {
      if (pending) return;
      pending = true;
      setTimeout(() => { pending = false; const peers = snap(); peerH.forEach(h => h({ peers })); }, 16);
    };
    const setUp = v => { if (up !== v) { up = v; connH.forEach(h => h(v)); } };
    const flush = () => { sendTimer = null; if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'p', presence: mine })); };
    const open = () => {
      ws = new WebSocket(url);
      ws.onopen = () => { delay = 1000; flush(); };
      ws.onmessage = e => {
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === 'welcome') {
          me = m.you; others.clear();
          for (const p of m.peers || []) others.set(p.peer, p.presence || {});
          setUp(true); notify();
        } else if (m.t === 'p' && m.peer !== me) { others.set(m.peer, m.presence || {}); notify(); }
        else if (m.t === 'bye') { others.delete(m.peer); notify(); }
      };
      ws.onclose = () => { setUp(false); others.clear(); notify(); setTimeout(open, delay); delay = Math.min(delay * 2, 15000); };
    };
    open();
    return {
      presence(patch) {
        for (const k in patch) { if (patch[k] === null) delete mine[k]; else mine[k] = patch[k]; }
        if (!sendTimer) sendTimer = setTimeout(flush, 33);
        notify();
        return Promise.resolve();
      },
      onPeers(h) { peerH.push(h); setTimeout(() => h({ peers: snap() }), 0); return () => {}; },
      onConnection(h) { connH.push(h); setTimeout(() => h(up), 0); return () => {}; },
    };
  }

  const net = { R: null, mode: '', up: false, err: '', peers: [], started: false };
  const myPres = {};
  function pres(patch) {
    for (const k in patch) { if (patch[k] === null) delete myPres[k]; else myPres[k] = patch[k]; }
    if (net.R) net.R.presence(patch).catch(e => { net.err = (e && e.code) || 'Fehler'; mpRender(); });
  }
  async function netStart() {
    if (net.started) return;
    net.started = true;
    let R = null;
    try { R = window.claude && window.claude.use ? await window.claude.use('room') : null; } catch { R = null; }
    if (R) net.mode = 'claude';
    else if (!window.claude) {
      // Nur der Knackpunkt-Server kennt api/status; auf statischem Hosting (GitHub Pages) gibt es keinen Wettkampf
      const ok = await fetch('api/status', { cache: 'no-store' })
        .then(r => r.ok && /json/.test(r.headers.get('content-type') || '')).catch(() => false);
      if (ok) { R = serverRoom(); if (R) net.mode = 'server'; }
    }
    if (!R) { net.mode = 'none'; mpRender(); return; }
    if (net.mode === 'claude') {
      try {
        const perm = await window.claude.use('permissions');
        if (perm && await perm.state('room') === 'prompt') await perm.request(['room']);
      } catch {}
    }
    net.R = R;
    const fail = e => { net.err = (e && e.code) || 'Fehler'; net.up = false; mpRender(); };
    R.onPeers(ch => { net.peers = ch.peers; mpSync(); }, fail);
    R.onConnection(c => { net.up = c; mpRender(); }, fail);
    if (Object.keys(myPres).length) R.presence({ ...myPres }).catch(fail);
    mpRender();
  }

  // Entwurf als 6 Bit je Zeichen; fremde Entwürfe werden geprüft: gesperrte Kacheln bleiben, außerhalb des Bauteils nichts
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  function encode(solid) {
    let s = '';
    for (let i = 0; i < solid.length; i += 6) {
      let v = 0;
      for (let b = 0; b < 6; b++) v = v * 2 + (solid[i + b] ? 1 : 0);
      s += B64[v];
    }
    return s;
  }
  function decode(str, L) {
    if (typeof str !== 'string' || str.length !== Math.ceil(L.nT / 6)) return null;
    const out = new Uint8Array(L.nT);
    for (let i = 0; i < str.length; i++) {
      const v = B64.indexOf(str[i]);
      if (v < 0) return null;
      for (let b = 0; b < 6; b++) if (i * 6 + b < L.nT) out[i * 6 + b] = (v >> (5 - b)) & 1;
    }
    for (let k = 0; k < L.nT; k++) out[k] = L.domain[k] ? (L.frozen[k] ? 1 : out[k]) : 0;
    return out;
  }

  const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const newCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  const normCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  const mp = { on: false, role: null, code: '', name: '', j: 0, rid: 0, sub: false, revealed: 0, own: null,
    g: { rid: 0, ph: 'lobby', lv: 0, nr: 0, bc: '', dur: 90, left: 0, pr: 2, mo: 'b' }, pr: 0, broken: false, tick: null, deadline: 0, revealTimer: null,
    snap: null, order: null, shown: 0, boardTimer: null, scores: {}, conflict: false };
  let mpScr = '';

  const inRoom = () => net.peers.filter(p => !p.sameTab && p.presence && p.presence.k === mp.code);
  const myPeer = () => (net.peers.find(p => p.sameTab) || {}).peer || '';
  const players = () => inRoom().filter(p => p.presence.h !== 1 && typeof p.presence.n === 'string');
  // Spielleitung ist, wer im Raum als Leitung am längsten dabei ist
  function hostPeer() {
    let best = null;
    for (const p of inRoom()) {
      const j = p.presence.j;
      if (p.presence.h !== 1 || typeof j !== 'number') continue;
      if (!best || j < best.presence.j || (j === best.presence.j && p.peer < best.peer)) best = p;
    }
    return best;
  }
  function validG(g) {
    if (!g || typeof g !== 'object' || !Number.isInteger(g.rid) || g.rid < 0) return null;
    if (!['lobby', 'design', 'reveal'].includes(g.ph) || !Number.isInteger(g.lv)) return null;
    if (!LEVELS[g.lv] && !(g.lv === RANDOM && Number.isInteger(g.nr) && g.nr > 0 && g.nr < 1e5)
      && !(g.lv === CUSTOM && typeof g.bc === 'string' && g.bc.length <= 400)) return null;
    return { rid: g.rid, ph: g.ph, lv: g.lv, nr: g.lv === RANDOM ? g.nr : 0, bc: g.lv === CUSTOM ? g.bc : '', dur: Number(g.dur) || 90,
      left: Math.max(0, Math.min(999, Math.round(Number(g.left) || 0))), pr: Math.max(0, Math.min(9, Math.round(Number(g.pr) || 0))), mo: g.mo === 'o' ? 'o' : 'b' };
  }
  const hostG = () => { const h = hostPeer(); return h ? validG(h.presence.g) : null; };
  const validRes = res => (Array.isArray(res) ? res : [])
    .filter(e => Array.isArray(e) && typeof e[0] === 'string' && Number.isFinite(e[2])).slice(0, 80)
    .map(e => ({ peer: e[0], name: clean(e[1], 16) || 'Jemand', rem: Math.max(0, Math.min(1000, e[2])) / 10, ok: e[3] === 1 }));
  const validSc = sc => (Array.isArray(sc) ? sc : []).filter(e => Array.isArray(e) && Number.isFinite(e[1])).slice(0, 20)
    .map(e => ({ name: clean(e[0], 16) || 'Jemand', pts: e[1] / 10 }));
  // gemeldete verbrauchte Proben einer Person, begrenzt auf die Einstellung der Runde
  const probesUsed = q => Math.max(0, Math.min(mp.g.pr, Math.round(Number(q.pu) || 0)));

  // ---------- Wettkampf: Mitspielende ----------
  function joinRoom() {
    const name = clean($('mp-name').value, 16), code = normCode($('mp-code').value);
    if (!name || code.length !== 4) { $('mp-msg').textContent = 'Bitte einen Namen und den vierstelligen Raumcode eingeben.'; return; }
    store.set('name', name);
    Object.assign(mp, { role: 'player', name, code, j: Date.now(), rid: 0, sub: false, revealed: 0, own: null });
    pres({ k: code, n: name, j: mp.j, r: 0, s: 0 });
    mpSync();
  }
  function startPlayerRound(g) {
    st.open = g.mo === 'o';
    Object.assign(mp, { rid: g.rid, sub: false, broken: false, own: null, pr: st.open ? 0 : g.pr });
    pres({ r: g.rid, s: 0, d: null, pu: 0, rm: 0, x: 0 });
    loadLevel(g.lv, g.lv === CUSTOM ? g.bc : g.nr);
    st.probes = mp.pr;
    st.probeText = '';
    panel();
  }
  function playerSubmit() {
    if (mp.role !== 'player' || mp.sub || !editable()) return;
    mp.sub = true;
    Object.assign(st, { phase: 'locked', paint: null, drag: null, hover: -1 });
    // blind: auch direkt nach einer Probe-Rechnung wird der Entwurf wieder ohne Spannungen gezeigt
    if (!st.open) { st.view = { mode: 'blind' }; $('legend').hidden = true; $('femline').textContent = ''; }
    pres({ r: mp.rid, s: 1, d: encode(st.solid), rm: Math.round(removedPct(st.L, st.conn) * 10) });
    controls(); render(); mpRender();
  }
  // Offene Karten im Wettkampf: das Bauteil ist gebrochen, die Person ist in dieser Runde raus
  function playerBreak() {
    Object.assign(mp, { sub: true, broken: true });
    pres({ r: mp.rid, s: 1, x: 1, d: encode(st.solid) });
    runReveal(r => { mp.own = r; mpRender(); });
    mpRender();
  }
  function playerSync() {
    const g = hostG();
    if (!g) return;
    if (g.ph === 'design') {
      if (g.rid !== mp.rid) startPlayerRound(g);
      if (g.left <= 1) playerSubmit();   // kurz vor Schluss automatisch abgeben
    } else if (g.ph === 'reveal' && g.rid === mp.rid && mp.revealed !== g.rid) {
      mp.revealed = g.rid;
      st.paint = null; st.drag = null;
      if (mp.broken) mpRender();   // der Einsturz lief schon während der Runde
      else runReveal(r => { mp.own = r; mpRender(); });
    }
  }

  // ---------- Wettkampf: Spielleitung ----------
  const scoreList = () => Object.values(mp.scores).sort((a, b) => b.pts - a.pts).slice(0, 10).map(s => [s.name, Math.round(s.pts * 10)]);
  const saveHost = () => store.set('host', { code: mp.code, rid: mp.g.rid, lv: mp.g.lv, nr: mp.g.nr, bc: mp.g.bc, dur: mp.g.dur, pr: mp.g.pr, mo: mp.g.mo,
    scores: mp.scores, t: Date.now() });
  function savedHost() {
    const h = store.get('host');
    return h && typeof h.code === 'string' && Date.now() - h.t < 6 * 3600e3 ? h : null;
  }
  function hostGame(resume) {
    const r = resume ? savedHost() : null;
    Object.assign(mp, { role: 'host', code: r ? normCode(r.code) : newCode(), j: Date.now(), snap: null, order: null,
      scores: r && r.scores && typeof r.scores === 'object' ? r.scores : {},
      g: { rid: r ? r.rid | 0 : 0, ph: 'lobby', lv: 0, nr: 0, bc: '', dur: r ? r.dur || 90 : 90, left: 0,
        pr: r && Number.isInteger(r.pr) ? r.pr : 2, mo: r && r.mo === 'o' ? 'o' : 'b' } });
    if (r && (LEVELS[r.lv] || (r.lv === RANDOM && r.nr > 0) || (r.lv === CUSTOM && PARTS.fromCode(r.bc))))
      Object.assign(mp.g, { lv: r.lv, nr: r.lv === RANDOM ? r.nr : 0, bc: r.lv === CUSTOM ? r.bc : '' });
    st.open = false;   // die Spielleitung zeigt das Bauteil ohne Spannungen
    loadLevel(mp.g.lv, mp.g.lv === CUSTOM ? mp.g.bc : mp.g.nr);
    st.phase = 'locked';
    pres({ k: mp.code, h: 1, n: 'Spielleitung', j: mp.j, g: { ...mp.g }, sc: scoreList() });
    saveHost(); mpSync();
  }
  function hostStart() {
    const lv = +$('mp-lv').value, dur = +$('mp-dur').value, pr = +$('mp-pr').value, mo = $('mp-mo').value === 'o' ? 'o' : 'b';
    Object.assign(mp.g, { rid: mp.g.rid + 1, ph: 'design', lv, nr: lv === RANDOM ? newNr() : 0, bc: lv === CUSTOM ? store.get('bau') || '' : '',
      dur, left: dur, pr, mo });
    Object.assign(mp, { deadline: performance.now() + dur * 1000, snap: null, order: null });
    stopBoard();
    st.open = false;
    loadLevel(lv, lv === CUSTOM ? mp.g.bc : mp.g.nr);
    st.phase = 'locked';
    pres({ g: { ...mp.g }, res: null });
    clearInterval(mp.tick);
    mp.tick = setInterval(hostTick, 250);
    saveHost(); controls(); mpRender();
  }
  function hostTick() {
    if (mp.g.ph !== 'design') { clearInterval(mp.tick); return; }
    const left = Math.max(0, Math.ceil((mp.deadline - performance.now()) / 1000));
    if (left !== mp.g.left) { mp.g.left = left; pres({ g: { ...mp.g } }); mpRender(); }
    if (performance.now() > mp.deadline + 2500) hostReveal();   // Nachfrist für automatisch abgegebene Entwürfe
  }
  const hostEndNow = () => { mp.deadline = Math.min(mp.deadline, performance.now()); };
  function hostSync() {
    const other = hostPeer();
    mp.conflict = !!other && (other.presence.j < mp.j || (other.presence.j === mp.j && other.peer < myPeer()));
    if (mp.g.ph === 'design' && !mp.revealTimer) {
      const ps = players();
      if (ps.length && ps.every(p => p.presence.r === mp.g.rid && p.presence.s === 1)) mp.revealTimer = setTimeout(hostReveal, 800);
    }
  }
  // Alle Entwürfe einsammeln, rechnen, werten und die Rangliste für alle veröffentlichen
  function hostReveal() {
    if (mp.g.ph !== 'design') return;
    clearInterval(mp.tick); clearTimeout(mp.revealTimer); mp.revealTimer = null;
    const L = st.L, list = [];
    for (const p of players()) {
      const q = p.presence, solid = q.r === mp.g.rid && q.s === 1 ? decode(q.d, L) : null;
      if (!solid) continue;
      const res = FEM.analyze(L, solid);
      list.push({ peer: p.peer, name: clean(q.n, 16) || 'Jemand', solid, res, ok: res.ok, rem: Math.round(removedPct(L, res.conn) * 10) / 10,
        pu: probesUsed(q) });
    }
    for (const e of list) {
      const key = e.name.toLowerCase(), s = mp.scores[key] || (mp.scores[key] = { name: e.name, pts: 0 });
      s.pts = Math.round((s.pts + (e.ok ? e.rem : 0)) * 10) / 10;
    }
    list.sort((a, b) => (b.ok - a.ok) || (b.rem - a.rem));
    mp.snap = list;
    Object.assign(mp.g, { ph: 'reveal', left: 0 });
    const patch = { g: { ...mp.g }, res: list.map(e => [e.peer, e.name, Math.round(e.rem * 10), e.ok ? 1 : 0]), sc: scoreList() };
    // Presence ist auf 4 KiB begrenzt: bei sehr vielen Mitspielenden die Liste kürzen
    const size = o => new TextEncoder().encode(JSON.stringify(o)).length;
    while (patch.res.length && size({ ...myPres, ...patch }) > 3800) patch.res.pop();
    pres(patch);
    saveHost();
    startBoard();
  }
  function hostNext() {
    stopBoard();
    mp.g.ph = 'lobby';
    pres({ g: { ...mp.g } });
    mpRender();
  }
  function leaveRoom(endGame) {
    clearInterval(mp.tick); clearTimeout(mp.revealTimer); mp.revealTimer = null; stopBoard();
    if (mp.role === 'host' && endGame) store.set('host', null);
    if (mp.role) pres({ k: null, h: null, n: null, j: null, g: null, r: null, s: null, d: null, res: null, sc: null });
    Object.assign(mp, { role: null, code: '', rid: 0, sub: false, revealed: 0, own: null, snap: null, order: null, conflict: false });
    st.phase = 'design';
    mpScr = ''; mpRender();
  }

  // Auflösung am Beamer: Entwürfe nacheinander aufdecken, der gewagteste zuletzt
  function stopBoard() { clearTimeout(mp.boardTimer); mp.boardTimer = null; }
  function startBoard() {
    stopBoard();
    mp.order = mp.snap.slice().sort((a, b) => a.rem - b.rem);
    mp.shown = 0;
    mpScr = '';
    mpRender();
    const step = reduce ? 0 : Math.max(450, Math.min(1300, 14000 / Math.max(1, mp.order.length)));
    const next = () => {
      if (mp.role !== 'host' || !mp.order) return;
      if (mp.shown < mp.order.length) { mp.shown++; showCards(); mp.boardTimer = setTimeout(next, step); }
      else { mp.boardTimer = null; mpRender(); }
    };
    mp.boardTimer = setTimeout(next, reduce ? 0 : 700);
  }
  function showCards(redraw) {
    for (const card of document.querySelectorAll('#mp-cards .card')) {
      const i = +card.dataset.i, e = mp.order[i], open = i < mp.shown;
      if (!redraw && card.dataset.open === String(open)) continue;
      card.dataset.open = String(open);
      drawMini(card.querySelector('canvas'), st.L, e.solid, open ? e.res : null);
      card.querySelector('.vl').textContent = !open ? ''
        : `${fmt(e.rem, 1)} % entfernt` + (mp.g.mo !== 'o' && mp.g.pr ? `, ${e.pu === 1 ? '1 Probe' : `${e.pu} Proben`}` : '');
      if (open && !card.querySelector('.st')) {
        const s = document.createElement('div');
        s.className = 'st ' + (e.ok ? 'ok' : 'bad');
        s.textContent = e.ok ? 'HÄLT' : 'BRUCH';
        card.appendChild(s);
      }
    }
  }
  function drawMini(canvas, L, solid, r) {
    // Karte höchstens so hoch wie breit, hohe schmale Bauteile mittig
    const W = canvas.clientWidth || 150, s = W / (Math.max(L.TX, L.TY) + 1), H = Math.round(s * (L.TY + 1)), dpr = devicePixelRatio || 1;
    const x0 = (W - s * (L.TX + 1)) / 2;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); canvas.style.height = H + 'px';
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.lineWidth = 1;
    for (let k = 0; k < L.nT; k++) {
      if (!L.domain[k]) continue;
      const tx = k % L.TX, ty = (k - tx) / L.TX, x = x0 + s / 2 + tx * s, y = H - s / 2 - (ty + 1) * s;
      if (!solid[k] || (r && !r.conn[k])) { c.strokeStyle = C.grid; c.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1); continue; }
      c.fillStyle = r && r.disp && r.fe[k] ? bandOf(r.tileUtil[k]) : L.frozen[k] ? C.steel2 : C.steel;
      c.fillRect(x, y, s, s);
      c.strokeStyle = 'rgba(8,16,28,0.2)'; c.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
    }
  }

  // ---------- Wettkampf: Anzeige ----------
  const esoNow = () => st.eso[st.key] ? removedPct(st.L, st.eso[st.key].res.conn) : null;
  // Platz je Eintrag der sortierten Liste; gleicher Wert gleicher Platz, alle Brüche teilen sich den letzten
  const places = list => list.map((e, i) => {
    let p = i;
    while (p > 0 && list[p - 1].ok === e.ok && (!e.ok || list[p - 1].rem === e.rem)) p--;
    return p + 1;
  });
  function rankHtml(list, me, esoPct) {
    if (!list.length) return '<p>Keine Entwürfe eingegangen.</p>';
    const ghost = () => `<li class="ghost"><span class="pl"></span><span class="nm">Algorithmus (ESO)</span><span class="vl">${fmt(esoPct, 1)} %</span></li>`;
    const rows = [], pl = places(list);
    let ghostDone = esoPct == null;
    list.forEach((e, i) => {
      if (!ghostDone && (!e.ok || e.rem < esoPct)) { rows.push(ghost()); ghostDone = true; }
      rows.push(`<li class="${e.ok ? '' : 'out'}${me && e.peer === me ? ' me' : ''}"><span class="pl">${pl[i]}.</span>` +
        `<span class="nm">${esc(e.name)}</span><span class="vl">${e.ok ? fmt(e.rem, 1) + ' %' : 'Bruch bei ' + fmt(e.rem, 1) + ' %'}</span></li>`);
    });
    if (!ghostDone) rows.push(ghost());
    return `<ol class="rank">${rows.join('')}</ol>`;
  }
  const scoreHtml = sc => !sc.length ? '<p>Noch keine Punkte.</p>' : `<ol class="rank">${sc.map((s, i) =>
    `<li><span class="pl">${sc.findIndex(t => t.pts === s.pts) + 1}.</span><span class="nm">${esc(s.name)}</span>` +
    `<span class="vl">${fmt(s.pts, 1)}</span></li>`).join('')}</ol>`;
  function netText() {
    if (net.mode === 'none') return window.claude
      ? 'Keine Live-Verbindung in dieser Ansicht. Mitspielen können angemeldete Personen, mit denen das Artifact geteilt ist.'
      : 'Auf dieser Seite läuft kein Spielserver, der Wettkampf geht hier nicht. „Allein üben“ funktioniert.';
    if (net.err) return `Live-Verbindung gestört (${net.err}).`;
    return net.up ? 'Live verbunden' : 'Verbinde …';
  }
  function failWhy(r) {
    if (r.reason === 'lastpfad') return 'Die Last hat keine Verbindung mehr zum Lager.';
    if (r.reason === 'mechanismus') return 'Das Bauteil ist nicht mehr ausreichend gelagert.';
    return `Max. Auslastung ${fmt(100 * r.maxUtil)} %.`;
  }
  function joinText() {
    if (net.mode !== 'server') return 'Mitspielen: dieses Artifact öffnen, „Mehrspieler“ wählen und den Code eingeben.';
    return `Mitspielen: <span class="joinurl">${esc(location.origin + location.pathname + '#' + mp.code)}</span> öffnen, ` +
      'Namen eintragen, fertig.';
  }

  function mpScreen() {
    if (!mp.role) return 'start';
    if (mp.role === 'host') return 'h-' + mp.g.ph;
    if (mp.rid && mp.revealed === mp.rid) return 'p-result';
    const g = hostG();
    if (g && g.ph === 'design' && g.rid === mp.rid) return mp.sub ? 'p-locked' : 'p-design';
    return 'p-wait';
  }
  const DRAWING = { 'p-design': 1, 'p-locked': 1, 'p-result': 1, 'h-design': 1 };
  const SIDE = {
    start: () => `<p class="mp-net" id="mp-net"></p>
      <h3>Mitspielen</h3>
      <label class="field">Name, ein Pseudonym genügt<input id="mp-name" maxlength="16" autocomplete="nickname"></label>
      <label class="field">Raumcode<input id="mp-code" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
      <button class="btn primary" type="button" data-act="join">Beitreten</button>
      <p class="mp-warn" id="mp-msg"></p>
      <h3>Spiel leiten</h3>
      <p>Für Leinwand oder Beamer: Raum eröffnen, Bauteil und Zeit wählen, Runden starten. Die Spielleitung spielt nicht mit.</p>
      <button class="btn" type="button" data-act="host">Neues Spiel eröffnen</button>
      <button class="btn" type="button" data-act="resume" id="mp-resume" hidden></button>`,
    'p-wait': () => `<p class="mp-net" id="mp-net"></p>
      <p>Raum <b>${esc(mp.code)}</b>, Sie spielen als <b>${esc(mp.name)}</b>.</p>
      <p id="mp-msg"></p>
      <button class="btn" type="button" data-act="leave">Raum verlassen</button>`,
    'p-design': () => st.open ? `<p class="mp-net" id="mp-net"></p>
      <p><b>Runde ${mp.rid}: ${esc(partName(st.def))}, offene Karten.</b> Sie sehen die Spannungen. Jede Wegnahme ist endgültig.
        Versagt Ihr Bauteil, sind Sie raus. Hören Sie rechtzeitig auf.</p>
      <div class="actions"><button class="btn primary" type="button" data-act="submit">Aufhören und werten</button></div>
      <p id="mp-probe"></p>
      <p id="mp-msg"></p>` : `<p class="mp-net" id="mp-net"></p>
      <p><b>Runde ${mp.rid}: ${esc(partName(st.def))}.</b> Entfernen Sie Material, bis die Zeit abläuft. Wer zu viel wegnimmt, bricht.
        Wer zu wenig wegnimmt, verliert gegen die anderen.${mp.pr ? ` Mit ${mp.pr === 1 ? 'einer Probe-Rechnung' : `${mp.pr} Probe-Rechnungen`}
        sehen Sie die Spannungen Ihres aktuellen Entwurfs.` : ''}</p>
      <div class="actions">
        <button class="btn primary" type="button" data-act="submit">Abgeben</button>
        <button class="btn" type="button" data-act="probe" id="mp-probe-btn"${mp.pr ? '' : ' hidden'}>Probe-Rechnung</button>
        <button class="btn" type="button" data-act="undo">Rückgängig</button>
        <button class="btn" type="button" data-act="reset">Alles zurück</button>
      </div>
      <p id="mp-probe"></p>
      <p id="mp-msg"></p>`,
    'p-locked': () => `<p class="mp-net" id="mp-net"></p>
      <p>${mp.broken ? '<span class="t-bad">Bruch.</span> Ihr Bauteil hat versagt, Sie sind in dieser Runde raus.' : '<b>Abgegeben.</b>'}
        Die Auflösung startet, sobald alle fertig sind oder die Zeit abläuft.</p>
      <p id="mp-msg"></p>`,
    'p-result': () => `<p class="mp-net" id="mp-net"></p>
      <div id="mp-result"></div>
      <h3>Diese Runde</h3><div id="mp-rank"></div>
      <h3>Gesamtwertung</h3><div id="mp-score"></div>
      <p>Die nächste Runde startet die Spielleitung.</p>`,
    'h-lobby': () => `<p class="mp-net" id="mp-net"></p>
      <p class="mp-warn" id="mp-warn"></p>
      <div class="row2">
        <label class="field">Bauteil<select id="mp-lv">${LEVELS.map((d, i) => `<option value="${i}">${i + 1} ${esc(d.name)}</option>`).join('')}
          <option value="${RANDOM}">Zufallsbauteil</option>${PARTS.fromCode(store.get('bau')) ? `<option value="${CUSTOM}">Eigenes Bauteil</option>` : ''}</select></label>
        <label class="field">Zeit<select id="mp-dur">${[60, 90, 120, 180].map(s => `<option value="${s}">${mmss(s)} min</option>`).join('')}</select></label>
      </div>
      <label class="field">Spielart<select id="mp-mo"><option value="b">Blind, mit Probe-Rechnungen</option><option value="o">Offene Karten</option></select></label>
      <label class="field">Probe-Rechnungen je Person<select id="mp-pr">${[0, 1, 2, 3, 5].map(n => `<option value="${n}">${n ? n : 'keine, nur blind'}</option>`).join('')}</select></label>
      <button class="btn primary" type="button" data-act="start">Runde ${mp.g.rid + 1} starten</button>
      <h3>Gesamtwertung</h3><div id="mp-score"></div>
      <button class="btn" type="button" data-act="end">Spiel beenden</button>`,
    'h-design': () => `<p class="mp-net" id="mp-net"></p>
      <p><b>Runde ${mp.g.rid}: ${esc(partName(st.def))}</b> läuft, ${mp.g.mo === 'o' ? 'offene Karten'
        : mp.g.pr ? `je Person ${mp.g.pr === 1 ? 'eine Probe-Rechnung' : `${mp.g.pr} Probe-Rechnungen`}` : 'ohne Probe-Rechnung'}.</p>
      <p id="mp-msg"></p>
      <ul class="chips" id="mp-chips"></ul>
      ${mp.g.mo === 'o' ? '<p class="mp-note">Zahl hinter dem Namen: bisher entfernt. Grün heißt aufgehört, rot heißt Bruch.</p>'
        : mp.g.pr ? '<p class="mp-note">Punkte hinter den Namen: gefüllt heißt Probe verbraucht. Grün heißt abgegeben.</p>' : ''}
      <button class="btn primary" type="button" data-act="now">Jetzt auflösen</button>`,
    'h-reveal': () => `<p class="mp-net" id="mp-net"></p>
      <p><b>Auflösung Runde ${mp.g.rid}.</b> Die Entwürfe werden nacheinander aufgedeckt, der gewagteste zuletzt.</p>
      <button class="btn primary" type="button" data-act="next">Nächste Runde</button>
      <button class="btn" type="button" data-act="end">Spiel beenden</button>`,
  };
  const BOARD = {
    start: () => `<h2>Wettkampf</h2>
      <ol class="steps">
        <li>Die Spielleitung eröffnet ein Spiel und zeigt den Raumcode.</li>
        <li>Alle treten mit Namen und Code bei und bekommen dasselbe Bauteil.</li>
        <li>Bis die Zeit abläuft, entfernt jede Person Material: blind mit Probe-Rechnungen oder mit offenen Karten, bei denen ein Bruch sofort ausscheidet.</li>
        <li>Dann rechnet die FEM alle Entwürfe. Wer bricht, bekommt nichts, sonst zählt jedes entfernte Prozent.</li>
      </ol>`,
    'p-wait': () => `<h2>Raum ${esc(mp.code)}</h2><p id="mp-wait"></p><ul class="chips" id="mp-chips"></ul>`,
    'h-lobby': () => `<p>Raumcode</p><div class="bigcode">${esc(mp.code)}</div>
      <p id="mp-join"></p>
      <h2 id="mp-count"></h2>
      <ul class="chips" id="mp-chips"></ul>`,
    'h-reveal': () => `<h2>Runde ${mp.g.rid}: ${esc(partName(st.def))}</h2>
      <div class="cards" id="mp-cards">${(mp.order || []).map((e, i) =>
        `<div class="card" data-i="${i}"><canvas></canvas><div class="nm">${esc(e.name)}</div><div class="vl"></div></div>`).join('')}</div>
      <div class="split" id="mp-final"></div>`,
  };

  function mpSync() {
    if (mp.role === 'player') playerSync();
    else if (mp.role === 'host') hostSync();
    mpRender();
  }
  function mpRender() {
    if (!mp.on) return;
    const scr = mpScreen(), show = !!DRAWING[scr];
    if (scr !== mpScr) {
      mpScr = scr;
      $('mp-ui').innerHTML = SIDE[scr]();
      $('mp-board').innerHTML = show ? '' : BOARD[scr]();
      $('drawing').hidden = !show;
      $('mp-board').hidden = show;
      $('tools').hidden = scr !== 'p-design';
      if (scr === 'start') {
        const n = store.get('name'), h = normCode(location.hash.slice(1));
        if (typeof n === 'string') $('mp-name').value = n;
        if (h.length === 4) $('mp-code').value = h;
      }
      if (scr === 'h-lobby') {
        $('mp-lv').value = String(mp.g.rid && mp.g.lv < RANDOM ? mp.g.lv + 1 : mp.g.lv);   // nach den festen Bauteilen Zufall
        $('mp-dur').value = String(mp.g.dur);
        $('mp-pr').value = String(mp.g.pr);
        $('mp-mo').value = mp.g.mo;
        const syncPr = () => { $('mp-pr').disabled = $('mp-mo').value === 'o'; };   // offene Karten brauchen keine Proben
        $('mp-mo').onchange = syncPr;
        syncPr();
      }
      if (scr === 'h-reveal') showCards(true);
      if (show) requestAnimationFrame(() => { if (wrap.clientWidth) { layout(); render(); } });
    }
    fillScreen(scr);
  }
  // Wechselnde Teile eines Bildschirms; nur neu schreiben, wenn sich etwas geändert hat (Eingabefelder bleiben stehen)
  function fillScreen(scr) {
    const set = (id, html) => { const el = $(id); if (el && el._h !== html) { el._h = html; el.innerHTML = html; } };
    const netEl = $('mp-net');
    if (netEl) { netEl.textContent = netText(); netEl.classList.toggle('on', net.up && !net.err); }
    const ps = players(), rid = mp.role === 'host' ? mp.g.rid : mp.rid;
    const done = p => p.presence.r === rid && p.presence.s === 1;
    // auf dem Beamer während der Runde: je Probe-Rechnung ein Punkt, gefüllt wenn verbraucht
    const dots = p => Array.from({ length: mp.g.pr }, (_, i) => `<i class="pd${i < (p.presence.r === rid ? probesUsed(p.presence) : 0) ? ' on' : ''}"></i>`).join('');
    // offene Karten: bisher entfernte Prozent, rot bei Bruch
    const broke = p => p.presence.r === rid && p.presence.x === 1;
    const openInfo = p => p.presence.r !== rid ? '' : broke(p) ? ': Bruch'
      : `: ${fmt(Math.max(0, Math.min(1000, Number(p.presence.rm) || 0)) / 10, 0)} %`;
    const open = mp.g.mo === 'o';
    const chips = mark => ps.map(p => `<li class="${mark && done(p) ? (open && broke(p) ? 'out' : 'done') : ''}">`
      + `${esc(clean(p.presence.n, 16) || 'Jemand')}${!mark ? '' : open ? openInfo(p) : dots(p)}</li>`).join('');
    let left = null;
    if (scr === 'h-design') left = mp.g.left;
    if (scr === 'p-design' || scr === 'p-locked') { const g = hostG(); left = g ? g.left : null; }
    $('timer').hidden = left == null;
    if (left != null) { $('timer').textContent = mmss(left); $('timer').classList.toggle('low', left <= 10); }

    if (scr === 'start') {
      const r = savedHost(), b = $('mp-resume');
      b.hidden = !r;
      if (r) b.textContent = `Spiel ${r.code} fortsetzen (nach Runde ${r.rid})`;
      for (const x of document.querySelectorAll('#mp-ui [data-act]')) x.disabled = net.mode === 'none';
    }
    if (scr === 'p-wait') {
      const g = hostG();
      const t = !hostPeer() ? 'Noch keine Spielleitung in diesem Raum. Stimmt der Code?'
        : g && g.ph === 'design' ? 'Die Runde läuft schon, Sie steigen in der nächsten ein.' : 'Gleich geht es los, die Spielleitung startet die Runde.';
      set('mp-wait', esc(t)); set('mp-msg', esc(t));
      set('mp-chips', `<li class="done">${esc(mp.name)} (Sie)</li>` + chips(false));
    }
    if (scr === 'p-design' || scr === 'p-locked') set('mp-msg', `${ps.filter(done).length + (mp.sub ? 1 : 0)} von ${ps.length + 1} haben abgegeben.`);
    if (scr === 'p-design') {
      const b = $('mp-probe-btn');
      if (b) { b.textContent = `Probe-Rechnung (${st.probes})`; b.disabled = !st.probes || !editable(); }
      set('mp-probe', st.open ? esc(st.liveText || '') : st.phase === 'probe' && st.probeText ? esc(st.probeText) : '');
    }
    if (scr === 'p-result') {
      const h = hostPeer(), g = hostG(), res = h && g && g.rid === mp.rid ? validRes(h.presence.res) : [];
      const me = myPeer(), i = res.findIndex(e => e.peer === me), r = mp.own;
      let t = 'Rechnet …';
      if (r) {
        t = r.ok ? `<span class="t-ok">Hält.</span> Sie haben ${fmt(removedPct(st.L, r.conn), 1)} % entfernt.`
          : `<span class="t-bad">Bruch.</span> ${failWhy(r)} Gewertet: 0 %.`;
        t += i >= 0 ? ` Platz ${places(res)[i]} von ${res.length}.` : res.length ? ' Ihr Entwurf kam nicht rechtzeitig an und wird nicht gewertet.' : '';
      }
      set('mp-result', `<p>${t}</p>`);
      set('mp-rank', res.length ? rankHtml(res, me, esoNow()) : '<p>Die Rangliste kommt gleich.</p>');
      set('mp-score', scoreHtml(h ? validSc(h.presence.sc) : []));
    }
    if (scr === 'h-lobby') {
      set('mp-count', ps.length === 1 ? '1 Person im Raum' : `${ps.length} Personen im Raum`);
      set('mp-chips', chips(false));
      set('mp-join', joinText());
      set('mp-score', scoreHtml(validSc(scoreList())));
      set('mp-warn', mp.conflict ? 'In diesem Raum leitet schon jemand anderes. Bitte ein neues Spiel eröffnen.' : '');
    }
    if (scr === 'h-design') {
      const nb = ps.filter(broke).length;
      set('mp-msg', open ? `${ps.filter(done).length} von ${ps.length} fertig${nb ? `, davon ${nb} mit Bruch` : ''}.`
        : `${ps.filter(done).length} von ${ps.length} haben abgegeben.`);
      set('mp-chips', chips(true));
    }
    if (scr === 'h-reveal' && mp.order && mp.shown >= mp.order.length) {
      set('mp-final', `<div><h2>Rangliste</h2>${rankHtml(mp.snap, '', esoNow())}</div>` +
        `<div><h2>Gesamtwertung</h2>${scoreHtml(validSc(scoreList()))}</div>`);
    }
    panel();
  }

  // dasselbe Bauteil neu beginnen; im Baukasten dort weiterbauen
  const reload = () => st.li === CUSTOM && !st.def.code ? openEditor() : loadLevel(st.li, st.def.nr || st.def.code);
  function setMode(on) {
    if (mp.on === on) return;
    mp.on = on;
    $('m-solo').setAttribute('aria-pressed', String(!on));
    $('m-mp').setAttribute('aria-pressed', String(on));
    $('levels').hidden = on; $('solo-ui').hidden = on; $('mp-ui').hidden = !on;
    $('live').checked = false;   // im Wettkampf keine Spannungen vorab
    if (on) { duel = null; duelRender(); mpScr = ''; netStart(); mpRender(); return; }
    leaveRoom(false);
    $('drawing').hidden = false; $('mp-board').hidden = true; $('timer').hidden = true; $('tools').hidden = false;
    st.open = soloOpen;
    reload();
  }

  const ACTS = { join: joinRoom, host: () => hostGame(false), resume: () => hostGame(true), submit: playerSubmit, probe, undo, reset: resetAll,
    leave: () => leaveRoom(false), end: () => leaveRoom(true), start: hostStart, now: hostEndNow, next: hostNext };
  for (const id of ['mp-ui', 'mp-board']) $(id).addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (b && !b.disabled && ACTS[b.dataset.act]) ACTS[b.dataset.act]();
  });
  $('mp-ui').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.target.id === 'mp-name' || e.target.id === 'mp-code')) joinRoom(); });
  $('m-solo').onclick = () => setMode(false);
  $('m-mp').onclick = () => setMode(true);

  // ---------- Eingabe ----------
  // Rechteck: aufziehen, beim Loslassen wechseln alle Kacheln darin. Pinsel: jede überstrichene Kachel.
  // Wer auf einer leeren Kachel beginnt, holt Material zurück, sonst wird entfernt.
  const cell = e => {
    const b = cv.getBoundingClientRect();
    const tx = Math.floor((e.clientX - b.left - G.ox) / G.s), ty = Math.floor((G.oy - e.clientY + b.top) / G.s);
    return [Math.max(0, Math.min(st.L.TX - 1, tx)), Math.max(0, Math.min(st.L.TY - 1, ty))];
  };
  function rectTiles(d) {
    const L = st.L, out = [];
    for (let y = Math.min(d.a[1], d.b[1]); y <= Math.max(d.a[1], d.b[1]); y++)
      for (let x = Math.min(d.a[0], d.b[0]); x <= Math.max(d.a[0], d.b[0]); x++) {
        const k = x + y * L.TX;
        if (L.domain[k] && !L.frozen[k] && st.solid[k] !== st.paint) out.push(k);
      }
    return out;
  }
  const lockedMsg = () => { $('verdict').innerHTML = '<p>Diese Kachel ist gesperrt: Hier sitzt ein Lager oder greift die Last an.</p>'; };
  const pushUndo = () => { st.undo.push(st.solid.slice()); if (st.undo.length > 200) st.undo.shift(); };

  cv.addEventListener('pointerdown', e => {
    if (!editable()) return;
    const k = tileAt(e), L = st.L;
    if (k < 0) return;
    if (st.tool === 'brush' && (!L.domain[k] || L.frozen[k])) { if (L.frozen[k]) lockedMsg(); return; }
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    st.paint = !st.open && L.domain[k] && !L.frozen[k] && !st.solid[k] ? 1 : 0;   // offene Karten: nur wegnehmen
    if (st.tool === 'rect') { const c = cell(e); st.drag = { a: c, b: c, k }; render(); return; }
    pushUndo();
    st.last = [e.clientX, e.clientY];
    setTile(k); refresh();
  });
  cv.addEventListener('pointermove', e => {
    if (st.drag) {
      const c = cell(e);
      if (c[0] !== st.drag.b[0] || c[1] !== st.drag.b[1]) { st.drag.b = c; render(); }
      return;
    }
    if (st.paint == null) {
      if (e.pointerType === 'mouse' && editable()) { const k = tileAt(e); if (k !== st.hover) { st.hover = k; render(); } }
      return;
    }
    // Zwischenpunkte, damit schnelle Striche keine Kacheln überspringen
    const [x0, y0] = st.last, dx = e.clientX - x0, dy = e.clientY - y0, n = Math.ceil(Math.hypot(dx, dy) / (G.s / 3)) || 1;
    let changed = false;
    for (let i = 1; i <= n; i++) changed = setTile(tileAt({ clientX: x0 + dx * i / n, clientY: y0 + dy * i / n })) || changed;
    st.last = [e.clientX, e.clientY];
    if (changed) refresh();
  });
  cv.addEventListener('pointerup', () => {
    const d = st.drag;
    st.drag = null;
    if (!d) { st.paint = null; return; }
    const tiles = rectTiles(d);
    if (tiles.length) {
      pushUndo();
      for (const k of tiles) st.solid[k] = st.paint;
      st.phase = 'design';
    }
    st.paint = null;
    if (tiles.length) return refresh();
    if (st.L.frozen[d.k] && d.a[0] === d.b[0] && d.a[1] === d.b[1]) lockedMsg();
    render();
  });
  cv.addEventListener('pointercancel', () => { st.drag = null; st.paint = null; render(); });
  cv.addEventListener('pointerleave', () => { if (st.hover >= 0) { st.hover = -1; render(); } });
  addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  });

  const setTool = t => {
    st.tool = t;
    $('t-rect').setAttribute('aria-pressed', String(t === 'rect'));
    $('t-brush').setAttribute('aria-pressed', String(t === 'brush'));
  };
  $('t-rect').onclick = () => setTool('rect');
  $('t-brush').onclick = () => setTool('brush');
  $('b-submit').onclick = submit;
  $('b-probe').onclick = probe;
  $('b-undo').onclick = undo;
  function resetAll() {
    if (st.open || !editable() || st.solid.every((x, k) => x === st.L.domain[k])) return;
    st.undo.push(st.solid.slice()); st.solid = st.L.domain.slice(); st.phase = 'design'; refresh();
  }
  $('b-reset').onclick = resetAll;
  $('b-retry').onclick = () => {
    if (st.busy) return;
    st.animId++; st.solid = st.L.domain.slice(); st.undo = []; st.probes = 1; st.phase = 'design'; st.practice = $('live').checked;
    $('stamp').hidden = true; refresh();
  };
  $('b-eso').onclick = toggleEso;
  $('b-next').onclick = () => { if (!st.busy) loadLevel(Math.min(st.li + 1, RANDOM), newNr()); };
  $('live').onchange = () => { if ($('live').checked) st.practice = true; if (editable()) { st.phase = 'design'; refresh(); } };
  // Spielart allein: Wechsel beginnt das Bauteil neu
  const setOpen = on => {
    if (st.busy) return;
    if (duel && duel.open !== on) duel = null;   // andere Spielart beendet die Herausforderung
    soloOpen = st.open = on;
    $('g-blind').setAttribute('aria-pressed', String(!on));
    $('g-open').setAttribute('aria-pressed', String(on));
    $('live').checked = false;
    reload();
  };
  $('g-blind').onclick = () => setOpen(false);
  $('g-open').onclick = () => setOpen(true);
  const SHARE_INFO = $('share-msg').textContent;
  $('b-duel').onclick = () => {
    const sh = $('share');
    sh.hidden = !sh.hidden;
    if (sh.hidden) return;
    const n = store.get('name');
    if (!$('share-name').value && typeof n === 'string') $('share-name').value = n;
    $('share-link').textContent = shareLink();
    $('share-msg').textContent = SHARE_INFO;
  };
  $('share-name').oninput = () => { $('share-link').textContent = shareLink(); };
  $('b-copy').onclick = () => {
    const link = shareLink(), name = clean($('share-name').value, 16);
    if (name) store.set('name', name);
    $('share-link').textContent = link;
    const done = ok => { $('share-msg').textContent = ok ? 'Link kopiert. Schicken Sie ihn an Ihre Kommilitonen.' : 'Bitte den Link oben markieren und kopieren.'; };
    if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => done(true), () => done(false)); else done(false);
  };

  $('levels').innerHTML = LEVELS.map((d, i) => `<button type="button" data-i="${i}">${i + 1} ${d.name}</button>`).join('') +
    `<button type="button" data-i="${RANDOM}" title="Jedes Mal ein neues Bauteil">Zufall</button>` +
    `<button type="button" data-i="${CUSTOM}" title="Eigenes Bauteil bauen oder das aktuelle abwandeln">Bauen</button>`;
  $('levels').onclick = e => {
    const b = e.target.closest('button');
    if (b) +b.dataset.i === CUSTOM ? openEditor() : loadLevel(+b.dataset.i, newNr());
  };

  $('legend').innerHTML = '<span class="lg-t">Vergleichsspannung je Kachel in MPa</span><ol>' +
    BANDS.map((c, b) => `<li><i style="background:${c}"></i><span>${b % 2 ? '' : fmt(RE * b / 10)}</span></li>`).join('') +
    `<li><i style="background:${OVER}"></i><span>${RE}</span></li></ol><span>über ${RE} MPa versagt die Kachel</span>`;

  const repaint = () => { readColors(); render(); if (mpScr === 'h-reveal') showCards(true); };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', repaint);
  new MutationObserver(repaint).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  new ResizeObserver(() => { if (wrap.clientWidth && (!G || Math.abs(wrap.clientWidth - G.W) > 1)) { layout(); render(); } }).observe(wrap);
  addEventListener('resize', () => { layout(); render(); if (mpScr === 'h-reveal') showCards(true); });
  if (document.fonts) document.fonts.ready.then(render);

  readColors();
  // Links: Zufallsbauteil, eigenes Bauteil, Herausforderung; Einstiege von der Kursseite (#teil-1 bis 3, #zufall, #bauen)
  const hash = location.hash, linkNr = /^#nr-([1-9]\d{0,4})$/.exec(hash), linkBau = /^#bau-(.+)$/.exec(hash), linkTeil = /^#teil-([1-3])$/.exec(hash);
  duel = parseDuel(hash);
  const clearHash = () => { try { history.replaceState(null, '', location.pathname + location.search); } catch {} };
  if (duel) {
    soloOpen = st.open = duel.open;
    $('g-blind').setAttribute('aria-pressed', String(!duel.open)); $('g-open').setAttribute('aria-pressed', String(duel.open));
    loadLevel(...duel.part);
  } else if (linkNr) loadLevel(RANDOM, +linkNr[1]);
  else if (linkBau && PARTS.fromCode(linkBau[1])) loadLevel(CUSTOM, linkBau[1]);
  else if (linkTeil) { loadLevel(+linkTeil[1] - 1); clearHash(); }
  else if (hash === '#zufall') loadLevel(RANDOM, newNr());
  else if (hash === '#bauen') { loadLevel(1); openEditor(); clearHash(); }
  else loadLevel(0);
  if (/^#[A-Za-z0-9]{4}$/.test(location.hash)) setMode(true);   // Einladungslink mit Raumcode
})();
