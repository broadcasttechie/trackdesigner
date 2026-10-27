/*
 * Duplo Track Planner — geometry engine and built-in piece library.
 *
 * Units: millimetres. Screen coordinates: x right, y down.
 * Headings are degrees; heading h points along (cos h, sin h), so a positive
 * turn is clockwise on screen ("right").
 *
 * A piece definition is a set of paths. Each path starts at a pose and is a
 * list of segments (straight lines or circular arcs). Path ends become
 * connectors; coincident ends (e.g. the toe of a Y switch) merge into one.
 *
 * Built-in geometry comes from:
 *  - BlueBrick parts library (Duplo package by Alban Nanty and Roland Bal):
 *    straight = 16 LEGO studs (128 mm), curve = 30° on a 32-LEGO-stud
 *    (256 mm) centreline radius, Y switch = two 30° arcs from a common toe,
 *    crossing = two 128 mm straights crossing at 60°.
 *  - Robert Cailliau's measurements (cailliau.org): Duplo stud 16 mm, straight
 *    8×4 studs, post-2011 curves R = 256 mm, older dark-grey curves ≈30.3°.
 */
(function (root) {
  'use strict';

  const DEG = Math.PI / 180;
  const STUD = 16;          // Duplo stud pitch in mm
  const GAUGE_WIDTH = 64;   // track sleeper width in mm (4 Duplo studs)
  const BRIDGE_MIN_ANGLE = 30; // a bridge only clears track it crosses at least this steeply (degrees)

  const wrap = (a) => ((((a + 180) % 360) + 360) % 360) - 180; // to [-180, 180)
  const rad = (d) => d * DEG;

  function segLength(seg) {
    return seg.type === 'line' ? Math.abs(seg.len) : Math.abs(rad(seg.angle)) * seg.r;
  }

  function advance(pose, seg) {
    const { x, y, h } = pose;
    if (seg.type === 'line') {
      return { x: x + seg.len * Math.cos(rad(h)), y: y + seg.len * Math.sin(rad(h)), h };
    }
    const a = seg.angle, R = seg.r, s = a >= 0 ? 1 : -1;
    const cx = x + s * R * -Math.sin(rad(h));
    const cy = y + s * R * Math.cos(rad(h));
    const h2 = h + a;
    return { x: cx + s * R * Math.sin(rad(h2)), y: cy - s * R * Math.cos(rad(h2)), h: h2 };
  }

  function partialSeg(seg, f) {
    return seg.type === 'line' ? { type: 'line', len: seg.len * f } : { type: 'arc', r: seg.r, angle: seg.angle * f };
  }

  function samplePath(path, step) {
    step = step || 8;
    let pose = { x: path.start.x, y: path.start.y, h: path.start.h };
    const pts = [{ ...pose }];
    for (const seg of path.segs) {
      const n = Math.max(1, Math.ceil(segLength(seg) / step));
      for (let i = 1; i <= n; i++) pts.push(advance(pose, partialSeg(seg, i / n)));
      pose = advance(pose, seg);
    }
    return pts;
  }

  function endPose(path) {
    let pose = { x: path.start.x, y: path.start.y, h: path.start.h };
    for (const seg of path.segs) pose = advance(pose, seg);
    return pose;
  }

  function mirrorDef(def) {
    return {
      ...def,
      paths: def.paths.map((p) => ({
        ...p,
        start: { x: p.start.x, y: -p.start.y, h: -p.start.h },
        segs: p.segs.map((s) => (s.type === 'arc' ? { ...s, angle: -s.angle } : { ...s })),
      })),
    };
  }

  /* Turn a definition into connectors + samples. Connector headings point
     outward, i.e. the direction a neighbouring piece would continue in. */
  function compileVariant(def) {
    const conns = [];
    const ends = []; // per path: [startConnIdx|-1, endConnIdx|-1]
    const addConn = (x, y, h, open) => {
      if (!open) return -1;
      for (let i = 0; i < conns.length; i++) {
        const c = conns[i];
        if (Math.hypot(c.x - x, c.y - y) < 0.5 && Math.abs(wrap(c.h - h)) < 0.5) return i;
      }
      conns.push({ x, y, h: wrap(h) });
      return conns.length - 1;
    };
    const samples = [];
    let length = 0;
    def.paths.forEach((p) => {
      const e = endPose(p);
      const a = addConn(p.start.x, p.start.y, p.start.h + 180, p.startOpen !== false);
      const b = addConn(e.x, e.y, e.h, p.endOpen !== false);
      ends.push([a, b]);
      samples.push(samplePath(p, 8));
      length += p.segs.reduce((t, s) => t + segLength(s), 0);
    });
    // Preferred "next" connector when the piece is entered through connector k:
    // the far end of the first path that touches k.
    const next = conns.map((_, k) => {
      for (const [a, b] of ends) {
        if (a === k && b >= 0) return b;
        if (b === k && a >= 0) return a;
      }
      return conns.length > 1 ? (k + 1) % conns.length : -1;
    });
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    samples.flat().forEach((p) => {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    return { conns, ends, next, samples, length, bbox: { minX, minY, maxX, maxY }, centre: { x: cx, y: cy } };
  }

  function sameConnSet(a, b) {
    if (a.length !== b.length) return false;
    return a.every((c) => b.some((d) => Math.hypot(c.x - d.x, c.y - d.y) < 0.5 && Math.abs(wrap(c.h - d.h)) < 0.5));
  }

  const cache = new Map();
  function compile(def) {
    const key = JSON.stringify(def.paths);
    if (cache.has(key)) return cache.get(key);
    const normal = compileVariant(def);
    const mirrored = compileVariant(mirrorDef(def));
    const symmetric = def.symmetric === true || sameConnSet(normal.conns, mirrored.conns);
    const turn = Math.max(0, ...def.paths.map((p) => Math.abs(wrap(endPose(p).h - p.start.h))));
    const out = { normal, mirrored, symmetric, turn };
    cache.set(key, out);
    return out;
  }

  /* ---------- transforms ---------- */
  function toWorld(inst, p) {
    const c = Math.cos(rad(inst.rot)), s = Math.sin(rad(inst.rot));
    return { x: inst.x + p.x * c - p.y * s, y: inst.y + p.x * s + p.y * c, h: p.h === undefined ? undefined : wrap(p.h + inst.rot) };
  }

  /* Place a piece so its connector k mates with an outward world pose. */
  function placeAgainst(variant, k, target) {
    const c = variant.conns[k];
    const rot = wrap(target.h + 180 - c.h);
    const cs = Math.cos(rad(rot)), sn = Math.sin(rad(rot));
    return { x: target.x - (c.x * cs - c.y * sn), y: target.y - (c.x * sn + c.y * cs), rot };
  }

  /* How well does connector b meet connector a? Measured in a's frame:
     along > 0 is a gap, along < 0 is an overlap. */
  function jointError(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const ca = Math.cos(rad(a.h)), sa = Math.sin(rad(a.h));
    return {
      along: dx * ca + dy * sa,
      lateral: -dx * sa + dy * ca,
      angle: wrap(b.h - a.h - 180),
      dist: Math.hypot(dx, dy),
    };
  }

  /* ---------- piece templates (used by built-ins and the custom editor) ---------- */
  const O = { x: 0, y: 0, h: 0 };
  const T = {
    straight: (len) => ({ paths: [{ start: O, segs: [{ type: 'line', len }] }] }),
    curve: (r, angle) => ({ paths: [{ start: O, segs: [{ type: 'arc', r, angle }] }] }),
    switchY: (r, angle) => ({
      symmetric: true,
      paths: [
        { start: O, segs: [{ type: 'arc', r, angle }] },
        { start: O, segs: [{ type: 'arc', r, angle: -angle }] },
      ],
    }),
    turnout: (len, r, angle) => ({
      paths: [
        { start: O, segs: [{ type: 'line', len }] },
        { start: O, segs: [{ type: 'arc', r, angle }] },
      ],
    }),
    crossing: (len, angle) => {
      const half = len / 2;
      return {
        symmetric: true,
        paths: [
          { start: O, segs: [{ type: 'line', len }] },
          {
            start: { x: half - half * Math.cos(rad(angle)), y: -half * Math.sin(rad(angle)), h: angle },
            segs: [{ type: 'line', len }],
          },
        ],
      };
    },
    buffer: (len) => ({ paths: [{ start: O, segs: [{ type: 'line', len }], endOpen: false }] }),
    sCurve: (r, angle) => ({
      paths: [{ start: O, segs: [{ type: 'arc', r, angle }, { type: 'arc', r, angle: -angle }] }],
    }),
  };

  const TEMPLATES = [
    { id: 'straight', name: 'Straight', params: [['len', 'Length (mm)', 128]], make: (p) => T.straight(p.len) },
    { id: 'curve', name: 'Curve', params: [['r', 'Centreline radius (mm)', 256], ['angle', 'Angle (°)', 30]], make: (p) => T.curve(p.r, p.angle) },
    { id: 'switchY', name: 'Y switch', params: [['r', 'Branch radius (mm)', 256], ['angle', 'Branch angle (°)', 30]], make: (p) => T.switchY(p.r, p.angle) },
    { id: 'turnout', name: 'Turnout (straight + branch)', params: [['len', 'Straight length (mm)', 128], ['r', 'Branch radius (mm)', 256], ['angle', 'Branch angle (°)', 30]], make: (p) => T.turnout(p.len, p.r, p.angle) },
    { id: 'crossing', name: 'Crossing', params: [['len', 'Arm length (mm)', 128], ['angle', 'Crossing angle (°)', 60]], make: (p) => T.crossing(p.len, p.angle) },
    { id: 'sCurve', name: 'S-curve', params: [['r', 'Radius (mm)', 256], ['angle', 'Angle each way (°)', 15]], make: (p) => T.sCurve(p.r, p.angle) },
    { id: 'buffer', name: 'Buffer / dead end', params: [['len', 'Length (mm)', 128]], make: (p) => T.buffer(p.len) },
  ];

  const BUILTIN = [
    {
      id: 'duplo-straight', name: 'Straight', part: '6377', builtin: true,
      notes: '8×4 studs, 128 mm. Same footprint as most straight specials (stop, level crossing 6391, plate 35965).',
      template: 'straight', params: { len: 128 }, ...T.straight(128),
    },
    {
      id: 'duplo-curve', name: 'Curve 30°', part: '6378', builtin: true,
      notes: '12 make a circle. 256 mm centreline radius (post-2011 light grey).',
      template: 'curve', params: { r: 256, angle: 30 }, ...T.curve(256, 30),
    },
    {
      id: 'duplo-switch', name: 'Switch', part: '6379 / 51943', builtin: true,
      notes: 'Y points: two 30° branches from a shared toe.',
      template: 'switchY', params: { r: 256, angle: 30 }, ...T.switchY(256, 30),
    },
    {
      id: 'duplo-crossing', name: 'Crossing 60°', part: '6376', builtin: true,
      notes: 'X crossing, two 128 mm straights at 60°. Out of production since about 2016.',
      template: 'crossing', params: { len: 128, angle: 60 }, ...T.crossing(128, 60),
    },
    {
      id: 'duplo-buffer', name: 'Track end', part: '31442', builtin: true,
      notes: 'Dead end with 2×4 plate. Length approximate.',
      template: 'buffer', params: { len: 148 }, ...T.buffer(148),
    },
    {
      id: 'duplo-bridge', name: 'Bridge', part: 'bridge', builtin: true, bridge: true,
      notes: 'Raised straight, drawn as a 128 mm span. Length is assumed (no published size); it may cross over other track.',
      template: 'straight', params: { len: 128 }, ...T.straight(128),
    },
    {
      id: 'duplo-curve-old', name: 'Curve 30° (older)', part: '6378 dark grey', builtin: true,
      notes: 'Pre-2011 dark grey curves are slightly over-bent (≈30.3°, R≈256.6 mm), so a 12-piece circle overlaps a little.',
      template: 'curve', params: { r: 256.6, angle: 30.3 }, ...T.curve(256.6, 30.3),
    },
  ];

  /* ---------- layout analysis ---------- */
  function flexFactor(mode, k) {
    if (!k || k < 1) return 1;
    if (mode === 'linear') return Math.min(k, 12);
    if (mode === 'sqrt') return Math.min(Math.sqrt(k), 6);
    return 1;
  }

  /* pieces: [{uid,type,x,y,rot,mirror}] ; defs: {id: def} ; tol: settings */
  function analyse(pieces, defs, tol) {
    const byUid = new Map();
    const conns = [];
    pieces.forEach((inst) => {
      const def = defs[inst.type];
      if (!def) return;
      const comp = compile(def);
      const v = inst.mirror ? comp.mirrored : comp.normal;
      const world = v.conns.map((c, i) => ({ ...toWorld(inst, c), uid: inst.uid, idx: i, state: 'open', mate: null }));
      const samples = v.samples.map((path) => path.map((p) => toWorld(inst, p)));
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      samples.flat().forEach((p) => {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      });
      byUid.set(inst.uid, { inst, def, variant: v, conns: world, samples, bbox: { minX, minY, maxX, maxY }, slack: +def.slack || 0 });
      world.forEach((c) => conns.push(c));
    });

    const NEAR = Math.max(60, (tol.gap + tol.lateral) * 6);
    const cands = [];
    for (let i = 0; i < conns.length; i++) {
      for (let j = i + 1; j < conns.length; j++) {
        const a = conns[i], b = conns[j];
        if (a.uid === b.uid) continue;
        if (Math.abs(a.x - b.x) > NEAR || Math.abs(a.y - b.y) > NEAR) continue;
        const e = jointError(a, b);
        if (e.dist > NEAR || Math.abs(e.angle) > 35) continue;
        const slack = Math.max(byUid.get(a.uid).slack, byUid.get(b.uid).slack);
        const score = Math.max(
          Math.abs(e.along) / (tol.gap + slack || 0.01),
          Math.abs(e.lateral) / (tol.lateral + slack || 0.01),
          Math.abs(e.angle) / (tol.angle || 0.01),
        );
        cands.push({ a, b, e, score, slack });
      }
    }
    cands.sort((p, q) => p.score - q.score);

    const adj = new Map();
    const link = (u, v) => {
      if (!adj.has(u)) adj.set(u, new Set());
      if (!adj.has(v)) adj.set(v, new Set());
      adj.get(u).add(v); adj.get(v).add(u);
    };
    const hops = (from, to) => {
      if (from === to) return 0;
      const seen = new Set([from]);
      let frontier = [from], d = 0;
      while (frontier.length && d < 400) {
        d++;
        const nextF = [];
        for (const u of frontier) for (const v of adj.get(u) || []) {
          if (v === to) return d;
          if (!seen.has(v)) { seen.add(v); nextF.push(v); }
        }
        frontier = nextF;
      }
      return Infinity;
    };

    const joints = [];
    // Pass 1: joints inside the per-joint tolerance.
    for (const c of cands) {
      if (c.score > 1 || c.a.mate || c.b.mate) continue;
      c.a.mate = c.b; c.b.mate = c.a; c.a.state = c.b.state = 'ok';
      link(c.a.uid, c.b.uid);
      joints.push({ ...c, kind: 'ok' });
    }
    // Pass 2: loop closures that fit once the flex of every joint in the loop is counted.
    for (const c of cands) {
      if (c.a.mate || c.b.mate) continue;
      const k = hops(c.a.uid, c.b.uid);
      const loopJoints = Number.isFinite(k) ? k + 1 : 1;
      const f = flexFactor(tol.flex, loopJoints);
      if (c.score <= f) {
        c.a.mate = c.b; c.b.mate = c.a; c.a.state = c.b.state = 'flex';
        link(c.a.uid, c.b.uid);
        joints.push({ ...c, kind: 'flex', loopJoints, factor: f });
      }
    }
    // Pass 3: near misses.
    for (const c of cands) {
      if (c.a.mate || c.b.mate) continue;
      if (c.e.dist > NEAR) continue;
      c.a.mate = c.b; c.b.mate = c.a; c.a.state = c.b.state = 'miss';
      joints.push({ ...c, kind: 'miss' });
    }

    // Overlaps: centrelines of unjoined pieces closer than one track width.
    const overlaps = [];
    const crossovers = [];
    if (tol.overlaps !== false) {
      const list = [...byUid.values()];
      const clear = GAUGE_WIDTH - 6;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const A = list[i], B = list[j];
          if (A.bbox.maxX + clear < B.bbox.minX || B.bbox.maxX + clear < A.bbox.minX) continue;
          if (A.bbox.maxY + clear < B.bbox.minY || B.bbox.maxY + clear < A.bbox.minY) continue;
          if ((adj.get(A.inst.uid) || new Set()).has(B.inst.uid)) continue;
          const nearJoint = A.conns.some((c) => c.mate && c.mate.uid === B.inst.uid);
          if (nearJoint) continue;
          let hit = null, angle = 0;
          outer: for (const pa of A.samples.flat()) {
            for (const pb of B.samples.flat()) {
              if (Math.abs(pa.x - pb.x) < clear && Math.abs(pa.y - pb.y) < clear && Math.hypot(pa.x - pb.x, pa.y - pb.y) < clear) {
                hit = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
                angle = Math.abs(wrap(pa.h - pb.h));
                angle = Math.min(angle, 180 - angle);
                break outer;
              }
            }
          }
          if (!hit) continue;
          // A bridge may pass over other track, but not run along it or over another bridge.
          const bridges = (A.def.bridge ? 1 : 0) + (B.def.bridge ? 1 : 0);
          if (bridges === 1 && angle >= BRIDGE_MIN_ANGLE) {
            const over = A.def.bridge ? A : B, under = A.def.bridge ? B : A;
            crossovers.push({ over: over.inst.uid, under: under.inst.uid, at: hit });
          } else overlaps.push({ a: A.inst.uid, b: B.inst.uid, at: hit });
        }
      }
    }

    const open = conns.filter((c) => c.state === 'open' || c.state === 'miss');
    return { byUid, conns, joints, overlaps, crossovers, open, adj };
  }

  /* Pieces connected to uid through accepted joints. */
  function component(an, uid) {
    const seen = new Set([uid]);
    const stack = [uid];
    while (stack.length) {
      const u = stack.pop();
      for (const v of an.adj.get(u) || []) if (!seen.has(v)) { seen.add(v); stack.push(v); }
    }
    return seen;
  }

  /* ---------- gap-closing solver ----------
     Finds sequences of two-ended pieces that run from `from` (outward pose)
     to meet `to` (outward pose) within tolerance. */
  function solveGap(from, to, opts) {
    const { moves, maxDepth, tol, budget, loopJoints, limit } = opts;
    const target = { x: to.x, y: to.y, h: to.h };
    const maxStep = Math.max(...moves.map((m) => m.chord));
    const maxTurn = Math.max(...moves.map((m) => Math.abs(m.turn)));
    const results = [];
    const seenSets = new Map();
    const seenSeq = new Set();
    let nodes = 0;
    const NODE_CAP = 600000;
    const path = [];
    const left = { ...budget };

    function fits(pose, depth) {
      const e = jointError(pose, target);
      const f = flexFactor(tol.flex, loopJoints + depth);
      const score = Math.max(Math.abs(e.along) / tol.gap, Math.abs(e.lateral) / tol.lateral, Math.abs(e.angle) / tol.angle);
      return score <= f ? { e, score } : null;
    }

    function dfs(pose, depth, cap) {
      if (nodes++ > NODE_CAP || results.length >= limit * 4) return;
      if (depth > 0) {
        const ok = fits(pose, depth);
        if (ok) {
          const seq = path.map((m) => m.key).join(',');
          if (seenSeq.has(seq)) return;
          seenSeq.add(seq);
          const key = path.map((m) => m.key).sort().join(',');
          const n = (seenSets.get(key) || 0) + 1;
          seenSets.set(key, n);
          if (n <= 2) results.push({ steps: path.map((m) => ({ type: m.type, mirror: m.mirror })), err: ok.e, score: ok.score });
          return;
        }
      }
      if (depth >= cap) return;
      const remain = cap - depth;
      const d = Math.hypot(target.x - pose.x, target.y - pose.y);
      if (d - tol.gap * 3 > maxStep * remain) return;
      const needTurn = Math.abs(wrap(target.h + 180 - pose.h));
      if (needTurn - tol.angle * 3 > maxTurn * remain) return;
      for (const m of moves) {
        if (left[m.type] !== undefined && left[m.type] <= 0) continue;
        if (left[m.type] !== undefined) left[m.type]--;
        path.push(m);
        const c = Math.cos(rad(pose.h)), s = Math.sin(rad(pose.h));
        dfs({ x: pose.x + m.dx * c - m.dy * s, y: pose.y + m.dx * s + m.dy * c, h: wrap(pose.h + m.turn) }, depth + 1, cap);
        path.pop();
        if (left[m.type] !== undefined) left[m.type]++;
      }
    }

    for (let cap = 1; cap <= maxDepth; cap++) {
      const before = results.length;
      dfs({ ...from }, 0, cap);
      if (results.length > before && cap >= 1) {
        // one more depth for variety, then stop
        if (results.length >= limit) break;
      }
      if (nodes > NODE_CAP) break;
    }
    results.sort((a, b) => a.steps.length - b.steps.length || a.score - b.score);
    return { results: results.slice(0, limit), nodes, capped: nodes > NODE_CAP };
  }

  /* Moves for the solver: every two-ended, single-path piece, both hands. */
  function solverMoves(defs, typeIds) {
    const moves = [];
    for (const id of typeIds) {
      const def = defs[id];
      if (!def || def.paths.length !== 1) continue;
      const comp = compile(def);
      if (comp.normal.conns.length !== 2) continue;
      const variants = comp.symmetric ? [false] : [false, true];
      for (const mirror of variants) {
        const v = mirror ? comp.mirrored : comp.normal;
        // entering through connector 0 means local start pose (0,0,0) sits on the open end
        const end = v.conns[1];
        const start = v.conns[0];
        // transform end into the frame where start is the origin heading 0 (start outward is h+180)
        const baseRot = wrap(start.h + 180);
        const c = Math.cos(rad(-baseRot)), s = Math.sin(rad(-baseRot));
        const ex = end.x - start.x, ey = end.y - start.y;
        moves.push({
          type: id, mirror, key: id + (mirror ? 'L' : 'R'),
          dx: ex * c - ey * s, dy: ex * s + ey * c, turn: wrap(end.h - baseRot),
          chord: Math.hypot(ex, ey),
        });
      }
    }
    return moves;
  }

  const api = {
    STUD, GAUGE_WIDTH, wrap, advance, samplePath, mirrorDef, compile, toWorld, placeAgainst,
    jointError, analyse, component, solveGap, solverMoves, flexFactor, TEMPLATES, BUILTIN, T,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DuploGeo = api;
})(typeof window !== 'undefined' ? window : globalThis);
