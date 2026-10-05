/* Zufallsbauteile: Aus einer Nummer entsteht auf jedem Gerät dasselbe Bauteil (Form, Lager, Last).
   Die Last wird wie bei den festen Bauteilen so gewählt, dass das Vollteil zu gut 50 % ausgelastet ist. Kein DOM. */
const PARTS = (FEM => {
  const NICE = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80, 100];   // Lasten in kN
  const TARGET = 0.55;   // Auslastung des Vollteils
  const S2 = Math.SQRT1_2;
  // Lastrichtungen in 45°-Schritten ohne Winkelfunktionen, damit alle Geräte bitgenau dasselbe rechnen
  const DIR = { 0: [1, 0], 45: [S2, S2], 90: [0, 1], 135: [-S2, S2], 180: [-1, 0], '-45': [S2, -S2], '-90': [0, -1], '-135': [-S2, -S2] };
  const OUT = { left: [-1, 0], right: [1, 0], top: [0, 1], bottom: [0, -1] };

  // Zufallszahlen aus der Nummer (mulberry32)
  function rng(seed) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
      int: (lo, hi) => hi <= lo ? lo : lo + Math.floor(next() * (hi - lo + 1)),
      pick: a => a[Math.floor(next() * a.length)],
      chance: p => next() < p,
    };
  }

  // Form als Kachelraster, y nach oben
  function grid(tx, ty, v = 1) {
    const c = new Uint8Array(tx * ty).fill(v);
    const has = (x, y) => x >= 0 && y >= 0 && x < tx && y < ty && c[x + y * tx] === 1;
    const fill = (x0, y0, w, h, val) => {
      for (let y = Math.max(0, y0); y < Math.min(ty, y0 + h); y++) for (let x = Math.max(0, x0); x < Math.min(tx, x0 + w); x++) c[x + y * tx] = val;
    };
    return { tx, ty, c, has, fill };
  }
  const line = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  const wall = (tiles, side) => ({ kind: 'wand', tiles, side, fix: 3 });
  // Das Loslager hält nur senkrecht zur Auflagefläche
  const pin = (kind, tile, side) => ({ kind, tiles: [tile], side, lock: true, fix: kind === 'fest' ? 3 : side === 'left' || side === 'right' ? 1 : 2 });
  const load = (tiles, side, deg, kn = 1) => ({ tiles, side, fx: DIR[deg][0] * 1000 * kn, fy: DIR[deg][1] * 1000 * kn });   // kn in kN
  // bis zu n Kacheln ab (x, y) entlang einer Seite, solange die Seite frei liegt
  function run(g, x, y, side, n, step) {
    const [dx, dy] = OUT[side], vert = side === 'left' || side === 'right', out = [];
    for (let i = 0; i < n; i++) {
      const X = vert ? x : x + i * step, Y = vert ? y + i * step : y;
      if (!g.has(X, Y) || g.has(X + dx, Y + dy)) break;
      out.push([X, Y]);
    }
    return out;
  }

  // ---------- Bauformen ----------
  function kragarm(R) {
    const tx = R.int(10, 20), ty = R.int(4, Math.min(9, Math.floor(tx * 0.6))), left = R.chance(0.7);
    const g = grid(tx, ty), ex = left ? tx - 1 : 0, far = left ? 'right' : 'left';
    if (R.chance(0.4)) {   // zum freien Ende hin verjüngt
      const w = R.int(2, Math.floor(tx / 3)), h = R.int(1, Math.floor(ty / 2) - 1);
      g.fill(left ? tx - w : 0, R.chance(0.5) ? ty - h : 0, w, h, 0);
    }
    const col = [];
    for (let y = 0; y < ty; y++) if (g.has(ex, y)) col.push(y);
    const mode = R.pick(['seite', 'seite', 'seite', 'oben', 'unten']);
    let ld;
    if (mode === 'seite') {
      const n = Math.min(R.int(1, 2), col.length), i = R.int(0, col.length - n);
      ld = load(col.slice(i, i + n).map(y => [ex, y]), far, R.pick([-90, -90, -90, 90, -45, -135]));
    } else {
      const side = mode === 'oben' ? 'top' : 'bottom';
      ld = load(run(g, ex, side === 'top' ? col[col.length - 1] : col[0], side, R.int(1, 2), left ? -1 : 1), side, -90);
    }
    return { name: 'Kragarm', note: `${left ? 'Links' : 'Rechts'} eingespannt, die Last greift am freien Ende an.`, g,
      supports: [wall(line(ty, y => [left ? 0 : tx - 1, y]), left ? 'left' : 'right')], loads: [ld] };
  }

  function traeger(R) {
    const tx = R.int(14, 24), ty = R.int(4, 7), g = grid(tx, ty);
    const oL = R.pick([0, 0, 0, 1, 2, 3]), oR = R.pick([0, 0, 0, 1, 2, 3]), xa = oL, xb = tx - 1 - oR, festLeft = R.chance(0.6);
    const supports = [pin(festLeft ? 'fest' : 'los', [xa, 0], 'bottom'), pin(festLeft ? 'los' : 'fest', [xb, 0], 'bottom')];
    const mode = R.pick(['oben', 'oben', 'oben', 'unten', 'kragende']);
    let ld, how;
    if (mode === 'kragende' && Math.max(oL, oR) >= 2) {
      ld = load([[oL >= oR ? 0 : tx - 1, ty - 1]], 'top', -90);
      how = 'am Kragende drückt die Last';
    } else {
      const n = R.int(1, 2), x = R.int(xa + 2, xb - 1 - n), hang = mode === 'unten';
      ld = load(line(n, i => [x + i, hang ? 0 : ty - 1]), hang ? 'bottom' : 'top', hang ? -90 : R.pick([-90, -90, -90, -45, -135]));
      how = hang ? 'unten hängt die Last' : 'die Last drückt von oben';
      if (!hang && R.chance(0.25)) {   // Bogen: unten zwischen den Lagern ausgespart
        const w = R.int(3, xb - xa - 5), h = R.int(1, ty - 3);
        g.fill(R.int(xa + 2, xb - 1 - w), 0, w, h, 0);
      }
    }
    return { name: 'Träger', note: `Festlager ${festLeft ? 'links' : 'rechts'}, Loslager ${festLeft ? 'rechts' : 'links'}, ${how}.`, g,
      supports, loads: [ld] };
  }

  // an der Wand, Arm oben oder unten
  function konsole(R) {
    const tx = R.int(9, 15), ty = R.int(7, 12), wl = R.int(3, 5), wa = R.int(3, 5), left = R.chance(0.6), armTop = R.chance(0.6);
    const g = grid(tx, ty, 0), ya = armTop ? ty - wa : 0, ex = left ? tx - 1 : 0, far = left ? 'right' : 'left';
    g.fill(left ? 0 : tx - wl, 0, wl, ty, 1); g.fill(0, ya, tx, wa, 1);
    let ld;
    if (R.chance(0.67)) {
      const n = R.int(1, 2), y = R.int(ya, ya + wa - n);
      ld = load(line(n, i => [ex, y + i]), far, R.pick([-90, -90, -90, left ? -45 : -135]));
    } else {
      const side = armTop ? 'top' : 'bottom';
      ld = load(run(g, ex, armTop ? ty - 1 : 0, side, R.int(1, 2), left ? -1 : 1), side, -90);
    }
    return { name: 'Konsole', note: `${left ? 'Links' : 'Rechts'} an der Wand befestigt, am Ende des Arms greift die Last an.`, g,
      supports: [wall(line(ty, y => [left ? 0 : tx - 1, y]), left ? 'left' : 'right')], loads: [ld] };
  }

  // oben an der Decke, Schenkel unten zur Seite
  function winkel(R) {
    const tx = R.int(9, 14), ty = R.int(9, 14), wl = R.int(3, 5), wa = R.int(3, 5), left = R.chance(0.5);
    const g = grid(tx, ty, 0), lx = left ? 0 : tx - wl, ex = left ? tx - 1 : 0, far = left ? 'right' : 'left';
    g.fill(lx, 0, wl, ty, 1); g.fill(0, 0, tx, wa, 1);
    const mode = R.pick(['seite', 'seite', 'unten', 'oben']);
    let ld;
    if (mode === 'seite') {
      const n = R.int(1, 2), y = R.int(0, wa - n);
      ld = load(line(n, i => [ex, y + i]), far, R.pick([-90, -90, -90, left ? -45 : -135]));
    } else {
      const side = mode === 'oben' ? 'top' : 'bottom';
      ld = load(run(g, ex, side === 'top' ? wa - 1 : 0, side, R.int(1, 2), left ? -1 : 1), side, -90);
    }
    return { name: 'Winkel', note: 'Oben an der Decke eingespannt, die Last greift am Ende des Schenkels an.', g,
      supports: [wall(line(wl, i => [lx + i, ty - 1]), 'top')], loads: [ld] };
  }

  // zwei Stützen und ein Riegel
  function rahmen(R) {
    const tx = R.int(12, 20), ty = R.int(7, 11), wl = R.int(2, 4), wb = R.int(2, 4), g = grid(tx, ty);
    g.fill(wl, 0, tx - 2 * wl, ty - wb, 0);
    const clamped = R.chance(0.5), fromLeft = R.chance(0.5), mode = R.pick(['wind', 'wind', 'riegel', 'riegel', 'ecke']);
    const supports = clamped
      ? [wall(line(wl, i => [i, 0]), 'bottom'), wall(line(wl, i => [tx - wl + i, 0]), 'bottom')]
      : [pin('fest', [wl >> 1, 0], 'bottom'), pin(R.chance(0.5) ? 'fest' : 'los', [tx - 1 - (wl >> 1), 0], 'bottom')];
    let ld;
    if (mode === 'wind') ld = load(line(2, i => [fromLeft ? 0 : tx - 1, ty - 1 - i]), fromLeft ? 'left' : 'right', fromLeft ? 0 : 180);
    else if (mode === 'riegel') {   // nebeneinander liegende Lastkacheln; je Kachel ein Zufallszug, damit die übrigen Nummern bleiben
      const n = R.int(1, 2), xs = line(n, () => R.int(wl, tx - wl - n));
      ld = load(line(n, i => [xs[0] + i, ty - 1]), 'top', -90);
    }
    else ld = load([[fromLeft ? 0 : tx - 1, ty - 1]], 'top', fromLeft ? -45 : -135);
    return { name: 'Rahmen', g, supports, loads: [ld],
      note: `Zwei Stützen, ${clamped ? 'unten eingespannt' : 'auf Lagern'}, ${mode === 'wind' ? 'Wind von der Seite'
        : mode === 'riegel' ? 'Last auf dem Riegel' : 'schräge Last an der Ecke'}.` };
  }

  // unten eingespannt, frei stehend oder mit Arm (Galgen)
  function mast(R) {
    const w = R.int(4, 7), h = R.int(10, 15);
    if (R.chance(0.5)) {
      const la = R.int(4, 8), ha = R.int(2, 3), right = R.chance(0.5), tx = w + la, g = grid(tx, h, 0);
      const mx = right ? 0 : la, ex = right ? tx - 1 : 0;
      g.fill(mx, 0, w, h, 1); g.fill(right ? w : 0, h - ha, la, ha, 1);
      const ld = R.chance(0.5) ? load([[ex, h - ha]], 'bottom', -90) : load([[ex, h - 1 - R.int(0, ha - 1)]], right ? 'right' : 'left', -90);
      return { name: 'Galgen', note: 'Unten eingespannt, am Ende des Arms hängt die Last.', g,
        supports: [wall(line(w, i => [mx + i, 0]), 'bottom')], loads: [ld] };
    }
    const g = grid(w, h), fromLeft = R.chance(0.5), wind = R.chance(0.67);
    const ld = wind ? load(line(2, i => [fromLeft ? 0 : w - 1, h - 1 - i]), fromLeft ? 'left' : 'right', fromLeft ? 0 : 180)
      : load([[fromLeft ? 0 : w - 1, h - 1]], 'top', fromLeft ? -45 : -135);
    return { name: 'Mast', note: `Unten eingespannt, oben ${wind ? 'drückt der Wind von der Seite' : 'drückt eine schräge Last'}.`, g,
      supports: [wall(line(w, i => [i, 0]), 'bottom')], loads: [ld] };
  }

  // oben an der Decke befestigt, die Last hängt unten
  function haenger(R) {
    const tx = R.int(8, 16), ty = R.int(5, 10), g = grid(tx, ty);
    const ww = R.int(3, Math.floor(tx / 2)), wx = R.int(0, tx - ww), n = R.int(1, 2);
    const away = [];   // Lastposition neben der Befestigung, damit etwas zu biegen bleibt
    for (let x = 0; x <= tx - n; x++) if (x + n <= wx - 1 || x >= wx + ww + 1) away.push(x);
    let ld;
    if (away.length && R.chance(0.7)) { const x = R.pick(away); ld = load(line(n, i => [x + i, 0]), 'bottom', -90); }
    else {
      const right = tx - (wx + ww) > wx;   // die Seite, die weiter von der Befestigung weg ist
      ld = load(line(n, i => [right ? tx - 1 : 0, i]), right ? 'right' : 'left', -90);
    }
    return { name: 'Hänger', note: 'Oben an der Decke befestigt, unten greift die Last an.', g,
      supports: [wall(line(ww, i => [wx + i, ty - 1]), 'top')], loads: [ld] };
  }

  const FORMS = [kragarm, kragarm, traeger, traeger, konsole, konsole, winkel, rahmen, rahmen, mast, mast, haenger];

  // Loch im Inneren, rundum Material, nicht an Lager oder Last
  function hole(R, g, fixed) {
    for (let tries = 0; tries < 20; tries++) {
      const w = R.int(2, 3), h = R.int(2, 3), x0 = R.int(1, g.tx - w - 1), y0 = R.int(1, g.ty - h - 1);
      let ok = x0 + w < g.tx && y0 + h < g.ty;
      for (let y = y0 - 1; ok && y <= y0 + h; y++) for (let x = x0 - 1; x <= x0 + w; x++)
        if (!g.has(x, y) || fixed.has(x + y * g.tx)) { ok = false; break; }
      if (ok) { g.fill(x0, y0, w, h, 0); return true; }
    }
    return false;
  }

  // Lager und Last: jede Kachel im Bauteil und ihre Seite frei; beim Würfeln zusätzlich keine Kachel doppelt
  function itemsError(g, items, strict) {
    const seen = new Set();
    for (const s of items) for (const [x, y] of s.tiles) {
      const [dx, dy] = OUT[s.side], k = x + y * g.tx;
      if (!g.has(x, y) || g.has(x + dx, y + dy)) return 'kante';
      if (strict && seen.has(k)) return 'doppelt';
      seen.add(k);
    }
    return '';
  }
  // zusammenhängend über Kanten
  function connected(g) {
    const start = g.c.indexOf(1), reach = new Uint8Array(g.c.length), stack = [start];
    reach[start] = 1;
    let n = 1;
    while (stack.length) {
      const k = stack.pop(), x = k % g.tx, y = (k - x) / g.tx;
      for (const [X, Y] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        const q = X + Y * g.tx;
        if (g.has(X, Y) && !reach[q]) { reach[q] = 1; n++; stack.push(q); }
      }
    }
    return n === g.c.reduce((a, b) => a + b, 0);
  }

  // Last so skalieren, dass das Vollteil zu gut 50 % ausgelastet ist (linear: Auslastung wächst mit der Last).
  // Gibt den Grund zurück, wenn es nicht geht: beweglich (Starrkörperbewegung) oder bereich (Last nicht zwischen 1 und 100 kN)
  function scale(def) {
    const L = FEM.level(def), r = FEM.analyze(L, L.domain);
    if (r.reason === 'mechanismus' || r.reason === 'lastpfad' || !(r.maxUtil > 0)) return 'beweglich';
    const want = TARGET / r.maxUtil;   // kN
    if (want < NICE[0] / 1.3 || want > NICE[NICE.length - 1] * 1.3) return 'bereich';
    let F = NICE[0];
    for (const v of NICE) if (Math.abs(Math.log(v / want)) < Math.abs(Math.log(F / want))) F = v;
    for (const ld of def.loads) { ld.fx *= F; ld.fy *= F; }
    def.util = r.maxUtil * F;
    return '';
  }
  // Beträge stehen fest: nur prüfen, ob das Vollteil gelagert ist und hält
  function check(def) {
    const L = FEM.level(def), r = FEM.analyze(L, L.domain);
    if (r.reason === 'mechanismus' || r.reason === 'lastpfad' || !(r.maxUtil > 0)) return 'beweglich';
    if (r.maxUtil > 1) return 'voll';
    def.util = r.maxUtil;
    return '';
  }
  const cutOf = g => { const cut = []; for (let k = 0; k < g.c.length; k++) if (!g.c[k]) cut.push([k % g.tx, Math.floor(k / g.tx)]); return cut; };

  function generate(nr) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const R = rng(nr * 7919 + attempt * 104729), p = R.pick(FORMS)(R), g = p.g;
      const items = [...p.supports, ...p.loads];
      if (items.some(s => !s.tiles.length)) continue;
      let note = p.note;
      if (R.chance(0.3) && hole(R, g, new Set(items.flatMap(s => s.tiles.map(([x, y]) => x + y * g.tx))))) note += ' Mit vorgegebenem Loch.';
      if (itemsError(g, items, true) || !connected(g)) continue;
      const def = { name: p.name, nr, note, tx: g.tx, ty: g.ty, cut: cutOf(g), supports: p.supports, loads: p.loads };
      if (!scale(def)) return def;
    }
    return null;
  }

  // ---------- eigene Bauteile (Baukasten) ----------
  // Rohform: { tx, ty, cells (1 = Material), supports: [{ kind, side, tiles }], loads: [{ side, tiles, deg, kn }], auto }
  // auto: alle Lasten gleich groß und so bemessen wie bei den festen Bauteilen, sonst gilt kn (Betrag in kN)
  // shape: daraus ein Bauteil wie die festen, ohne Prüfung, etwa zum Zeichnen beim Bauen (bei auto jede Last 1 kN)
  function shape(raw) {
    const g = grid(raw.tx, raw.ty, 0);
    g.c.set(raw.cells);
    return { tx: g.tx, ty: g.ty, cut: cutOf(g),
      supports: raw.supports.map(s => s.kind === 'wand' ? wall(s.tiles, s.side) : pin(s.kind, s.tiles[0], s.side)),
      loads: raw.loads.map(l => load(l.tiles, l.side, l.deg, raw.auto ? 1 : l.kn)) };
  }
  // build: prüfen und bei auto die Lasten bemessen. Ergebnis { def } oder { error }:
  // leer, zerfallen, lager, last, kante, beweglich, bereich (auto), voll (Vollteil hält die festen Beträge nicht)
  function build(raw) {
    const g = grid(raw.tx, raw.ty, 0);
    g.c.set(raw.cells);
    if (!g.c.some(Boolean)) return { error: 'leer' };
    if (!connected(g)) return { error: 'zerfallen' };
    if (!raw.supports.length) return { error: 'lager' };
    if (!raw.loads.length || raw.loads.some(l => !l.tiles.length)) return { error: 'last' };
    const def = { name: 'Eigenes Bauteil', note: 'Selbst gebaut.', ...shape(raw) };
    const error = itemsError(g, [...def.supports, ...def.loads]) || (raw.auto ? scale(def) : check(def));
    return error ? { error } : { def };
  }
  // Code für Link und Wettkampf: Version, Breite und Höhe (Basis 36), Material (6 Bit je Zeichen),
  // je Lager Art, Seite, x, y, Anzahl; je Last Seite, x, y, Anzahl, Richtung in 45°-Schritten und Betrag in 0,1 kN
  // (zwei Zeichen, Basis 36). Version 1 kannte nur eine Last ohne Betrag, sie wird automatisch bemessen.
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const SIDES = { L: 'left', R: 'right', T: 'top', B: 'bottom' }, KINDS = { w: 'wand', f: 'fest', l: 'los' };
  const DEGS = [0, 45, 90, 135, 180, -135, -90, -45];
  const letter = (map, v) => Object.keys(map).find(k => map[k] === v);
  function encode(raw) {
    let bits = '';
    for (let i = 0; i < raw.cells.length; i += 6) {
      let v = 0;
      for (let b = 0; b < 6; b++) v = v * 2 + (raw.cells[i + b] ? 1 : 0);
      bits += B64[v];
    }
    const run = r => letter(SIDES, r.side) + [Math.min(...r.tiles.map(t => t[0])), Math.min(...r.tiles.map(t => t[1])), r.tiles.length]
      .map(n => n.toString(36)).join('');
    return '2' + raw.tx.toString(36) + raw.ty.toString(36) + '.' + bits + '.' + raw.supports.map(s => letter(KINDS, s.kind) + run(s)).join('') +
      '.' + raw.loads.map(l => run(l) + DEGS.indexOf(l.deg) + Math.round(l.kn * 10).toString(36).padStart(2, '0')).join('');
  }
  function decode(code) {
    const m = /^([12])([0-9a-z])([0-9a-z])\.([A-Za-z0-9_-]+)\.((?:[wfl][LRTB][0-9a-z]{3})*)\.([LRTB0-9a-z]+)$/.exec(String(code));
    if (!m) return null;
    const v2 = m[1] === '2', tx = parseInt(m[2], 36), ty = parseInt(m[3], 36);
    const lds = v2 ? /^(?:[LRTB][0-9a-z]{3}[0-7][0-9a-z]{2})+$/.test(m[6]) && m[6].match(/.{7}/g) : /^[LRTB][0-9a-z]{3}[0-7]$/.test(m[6]) && [m[6]];
    if (!lds || !tx || !ty || m[4].length !== Math.ceil(tx * ty / 6)) return null;
    const cells = new Uint8Array(tx * ty);
    for (let i = 0; i < m[4].length; i++) {
      const v = B64.indexOf(m[4][i]);
      for (let b = 0; b < 6; b++) if (i * 6 + b < cells.length) cells[i * 6 + b] = (v >> (5 - b)) & 1;
    }
    const run = t => {
      const side = SIDES[t[0]], [x, y, n] = [t[1], t[2], t[3]].map(c => parseInt(c, 36)), vert = side === 'left' || side === 'right';
      return { side, tiles: line(n, i => vert ? [x, y + i] : [x + i, y]) };
    };
    const supports = (m[5].match(/.{5}/g) || []).map(t => ({ kind: KINDS[t[0]], ...run(t.slice(1)) }));
    if (supports.some(s => s.kind !== 'wand' && s.tiles.length !== 1)) return null;
    const loads = lds.map(t => ({ ...run(t), deg: DEGS[+t[4]], kn: v2 ? parseInt(t.slice(5), 36) / 10 : 1 }));
    if (loads.some(l => !(l.kn >= 0.1 && l.kn <= 100))) return null;
    return { tx, ty, cells, supports, loads, auto: !v2 };
  }
  // fertiges Bauteil aus einem Code, oder null
  function fromCode(code) {
    const raw = decode(code), b = raw && build(raw);
    if (!b || !b.def) return null;
    b.def.code = code;
    return b.def;
  }

  return { generate, shape, build, encode, fromCode };
})(typeof module !== 'undefined' ? require('./fem.js') : FEM);
if (typeof module !== 'undefined') module.exports = PARTS;
