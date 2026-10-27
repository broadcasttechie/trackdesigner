/* Duplo Track Planner — UI. Depends on geometry.js (window.DuploGeo). */
(function () {
  'use strict';
  const G = window.DuploGeo;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, d = 1) => (Math.abs(n) < 0.05 && d === 1 ? '0.0' : n.toFixed(d));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const uid = () => Math.random().toString(36).slice(2, 9);
  const NONE = { kind: 'none' };

  /* ======================= storage ======================= */
  const LS = 'duplo-track-planner:v1';
  const mem = {};
  const local = {
    get(k) { try { const v = localStorage.getItem(k); return v === null ? (mem[k] ?? null) : v; } catch { return mem[k] ?? null; } },
    set(k, v) { mem[k] = v; try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
    del(k) { delete mem[k]; try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
  };
  const Store = {
    server: false,
    async init() {
      try {
        const r = await fetch('api/health', { cache: 'no-store' });
        if (r.ok) { const j = await r.json(); this.server = !!(j && j.ok === true && j.app === 'duplo-track-planner'); }
      } catch { this.server = false; }
    },
    async loadWorkspace() {
      if (this.server) {
        try { const r = await fetch('api/workspace', { cache: 'no-store' }); if (r.ok) { const t = await r.text(); if (t && t !== 'null') return JSON.parse(t); } } catch { /* fall through */ }
      }
      try { const v = local.get(LS); return v ? JSON.parse(v) : null; } catch { return null; }
    },
    saveWorkspace(w) {
      const s = JSON.stringify(w);
      local.set(LS, s);
      if (this.server) fetch('api/workspace', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: s }).catch(() => toast('Could not reach the server. Changes are kept in this browser.'));
    },
    async listLayouts() {
      if (this.server) { const r = await fetch('api/layouts', { cache: 'no-store' }); if (!r.ok) throw new Error('list failed'); return r.json(); }
      try { return JSON.parse(local.get(LS + ':index') || '[]'); } catch { return []; }
    },
    async getLayout(name) {
      if (this.server) { const r = await fetch('api/layouts/' + encodeURIComponent(name), { cache: 'no-store' }); if (!r.ok) throw new Error('not found'); return r.json(); }
      const v = local.get(LS + ':layout:' + name); if (!v) throw new Error('not found'); return JSON.parse(v);
    },
    async putLayout(name, obj) {
      if (this.server) {
        const r = await fetch('api/layouts/' + encodeURIComponent(name), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });
        if (!r.ok) throw new Error('save failed');
        return;
      }
      local.set(LS + ':layout:' + name, JSON.stringify(obj));
      const idx = (await this.listLayouts()).filter((l) => l.name !== name);
      idx.unshift({ name, updated: new Date().toISOString(), pieces: obj.layout.pieces.length });
      local.set(LS + ':index', JSON.stringify(idx));
    },
    async delLayout(name) {
      if (this.server) { const r = await fetch('api/layouts/' + encodeURIComponent(name), { method: 'DELETE' }); if (!r.ok) throw new Error('delete failed'); return; }
      local.del(LS + ':layout:' + name);
      const idx = (await this.listLayouts()).filter((l) => l.name !== name);
      local.set(LS + ':index', JSON.stringify(idx));
    },
  };

  /* ======================= state ======================= */
  const DEFAULT_SETTINGS = { gap: 4, lateral: 4, angle: 3, flex: 'sqrt', rotStep: 15, grid: true, overlaps: true, onlyOwned: true };
  const DEFAULT_INV = { 'duplo-straight': 8, 'duplo-curve': 16, 'duplo-switch': 2, 'duplo-crossing': 0, 'duplo-buffer': 0, 'duplo-bridge': 0, 'duplo-level-crossing': 0, 'duplo-bridge-end': 0, 'duplo-bridge-arch': 0, 'duplo-plate-side': 0, 'duplo-plate-both': 0, 'duplo-ramp': 0, 'duplo-crossing-90': 0, 'duplo-curve-old': 0 };
  const DEFAULT_HIDDEN = { 'duplo-curve-old': true, 'duplo-buffer': true, 'duplo-crossing': true, 'duplo-bridge': true, 'duplo-level-crossing': true, 'duplo-bridge-end': true, 'duplo-bridge-arch': true, 'duplo-plate-side': true, 'duplo-plate-both': true, 'duplo-ramp': true, 'duplo-crossing-90': true };

  let ws = null;            // workspace: { settings, lib, layout }
  let sel = NONE;
  let AN = null;            // cached analysis
  let undoStack = [], redoStack = [];
  const view = { cx: 0, cy: 0, s: 0.5 };
  let cssW = 300, cssH = 300, DPR = 1;

  function exampleLayout() {
    const seq = [...Array(6).fill('duplo-curve'), 'duplo-straight', 'duplo-straight', ...Array(6).fill('duplo-curve'), 'duplo-straight', 'duplo-straight'];
    const defs = defsMap();
    const pieces = [];
    let end = { x: -128, y: -256, h: 180 };
    for (const type of seq) {
      const v = G.compile(defs[type]).normal;
      const inst = { uid: uid(), type, mirror: false, entry: 0, ...G.placeAgainst(v, 0, end) };
      pieces.push(inst);
      end = G.toWorld(inst, v.conns[v.next[0]]);
    }
    return { name: 'Example oval', pieces };
  }

  function freshWorkspace() {
    return {
      settings: { ...DEFAULT_SETTINGS },
      lib: { custom: [], inventory: { ...DEFAULT_INV }, hidden: { ...DEFAULT_HIDDEN }, unlimited: false, sets: [] },
      layout: { name: 'Example oval', pieces: [] },
    };
  }

  function defsMap() {
    const m = {};
    for (const d of G.BUILTIN) m[d.id] = d;
    for (const d of (ws && ws.lib.custom) || []) m[d.id] = d;
    return m;
  }
  let DEFS = {};
  const D = () => DEFS;
  const allTypes = () => [...G.BUILTIN.map((d) => d.id), ...ws.lib.custom.map((d) => d.id)];

  const tol = () => ({ gap: +ws.settings.gap, lateral: +ws.settings.lateral, angle: +ws.settings.angle, flex: ws.settings.flex, overlaps: ws.settings.overlaps });
  function an() { if (!AN) AN = G.analyse(ws.layout.pieces, D(), tol()); return AN; }

  function usage() {
    const u = {};
    for (const p of ws.layout.pieces) u[p.type] = (u[p.type] || 0) + 1;
    return u;
  }
  const owned = (type) => +(ws.lib.inventory[type] || 0);

  let saveTimer = null;
  function changed(opts) {
    AN = null;
    if (!opts || !opts.keepSel) validateSel();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => Store.saveWorkspace(ws), 600);
  }

  function validateSel() {
    const A = an();
    if (sel.kind === 'piece' && !A.byUid.has(sel.uid)) sel = NONE;
    if (sel.kind === 'end') {
      const node = A.byUid.get(sel.uid);
      const c = node && node.conns[sel.idx];
      if (!c || c.state === 'ok' || c.state === 'flex') sel = NONE;
    }
  }

  function snapshot() { return JSON.stringify(ws.layout.pieces); }
  function pushUndo() { undoStack.push(snapshot()); if (undoStack.length > 200) undoStack.shift(); redoStack = []; }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    ws.layout.pieces = JSON.parse(undoStack.pop());
    changed(); update();
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    ws.layout.pieces = JSON.parse(redoStack.pop());
    changed(); update();
  }

  function variantOf(inst) {
    const comp = G.compile(D()[inst.type]);
    return inst.mirror && !comp.symmetric ? comp.mirrored : comp.normal;
  }
  const findInst = (u) => ws.layout.pieces.find((p) => p.uid === u);
  const isJoined = (c) => c && (c.state === 'ok' || c.state === 'flex');

  /* ======================= editing ======================= */
  function handName(def, mirror) {
    const comp = G.compile(def);
    if (comp.symmetric || comp.turn < 0.01 && !def.paths.some((p) => p.segs.some((s) => s.type === 'arc'))) return def.name;
    return def.name + (mirror ? ' left' : ' right');
  }

  function addPiece(type, mirror) {
    const def = D()[type];
    if (!def) return;
    const comp = G.compile(def);
    mirror = !!mirror && !comp.symmetric;
    const v = mirror ? comp.mirrored : comp.normal;
    pushUndo();
    const inst = { uid: uid(), type, mirror, entry: 0, x: 0, y: 0, rot: 0 };
    if (sel.kind === 'end') {
      const node = an().byUid.get(sel.uid);
      Object.assign(inst, G.placeAgainst(v, 0, node.conns[sel.idx]));
    } else {
      Object.assign(inst, G.placeAgainst(v, 0, { x: view.cx - 64, y: view.cy, h: 0 }));
    }
    ws.layout.pieces.push(inst);
    changed({ keepSel: true });
    const node = an().byUid.get(inst.uid);
    const joinedNew = node.conns.filter((c) => c.idx !== 0 && isJoined(c));
    const n = v.next[0];
    if (n >= 0 && node.conns[n] && !isJoined(node.conns[n])) sel = { kind: 'end', uid: inst.uid, idx: n };
    else {
      const o = node.conns.find((c) => c.state === 'open');
      sel = o ? { kind: 'end', uid: inst.uid, idx: o.idx } : NONE;
    }
    validateSel();
    if (joinedNew.length) {
      const j = an().joints.find((jt) => (jt.a.uid === inst.uid || jt.b.uid === inst.uid) && jt.kind === 'flex');
      toast(j ? `Joins up using flex across ${j.loopJoints} joints (${fmt(Math.abs(j.e.along))} mm, ${fmt(Math.abs(j.e.angle))}°)` : 'Joins up cleanly');
    } else warnBudget(type);
    update();
  }

  function warnBudget(type) {
    if (ws.lib.unlimited) return;
    const used = usage()[type] || 0, have = owned(type);
    if (used > have) toast(`You own ${have} ${D()[type].name.toLowerCase()} piece${have === 1 ? '' : 's'}; this layout uses ${used}`);
  }

  function mutatePiece(u, change) {
    const A = an();
    const node = A.byUid.get(u);
    if (!node) return;
    const inst = node.inst;
    const mated = node.conns.filter((c) => c.mate && isJoined(c));
    const anchor = mated.find((c) => c.idx === (inst.entry || 0)) || mated[0] || null;
    const newType = change.type ?? inst.type;
    const comp = G.compile(D()[newType]);
    let mirror = change.mirror ?? inst.mirror;
    if (comp.symmetric) mirror = false;
    const v = mirror ? comp.mirrored : comp.normal;
    const n = v.conns.length;
    const anchorIdx = anchor ? anchor.idx : (inst.entry || 0);
    let entry = change.entry ?? Math.min(anchorIdx, n - 1);
    entry = ((entry % n) + n) % n;
    let target;
    if (anchor) target = { x: anchor.mate.x, y: anchor.mate.y, h: anchor.mate.h };
    else {
      const c = node.conns[anchorIdx] || node.conns[0];
      target = c ? { x: c.x, y: c.y, h: c.h + 180 } : { x: inst.x, y: inst.y, h: 180 };
    }
    const children = mated.filter((c) => c !== anchor).map((c) => ({ fromIdx: c.idx, uid: c.mate.uid, idx: c.mate.idx }));
    pushUndo();
    Object.assign(inst, { type: newType, mirror, entry }, G.placeAgainst(v, entry, target));
    const visited = new Set([u]);
    if (anchor) visited.add(anchor.mate.uid);
    const queue = children.filter((ch) => ch.fromIdx < n && ch.fromIdx !== entry)
      .map((ch) => ({ parent: u, pidx: ch.fromIdx, uid: ch.uid, idx: ch.idx }));
    while (queue.length) {
      const q = queue.shift();
      if (visited.has(q.uid)) continue;
      visited.add(q.uid);
      const pinst = findInst(q.parent);
      const pc = G.toWorld(pinst, variantOf(pinst).conns[q.pidx]);
      const cnode = A.byUid.get(q.uid);
      if (!cnode) continue;
      Object.assign(cnode.inst, G.placeAgainst(variantOf(cnode.inst), q.idx, pc));
      for (const c of cnode.conns) {
        if (c.idx !== q.idx && c.mate && isJoined(c) && !visited.has(c.mate.uid)) queue.push({ parent: q.uid, pidx: c.idx, uid: c.mate.uid, idx: c.mate.idx });
      }
    }
    changed();
    if (change.type) warnBudget(change.type);
    update();
  }

  function deletePiece(u) {
    const node = an().byUid.get(u);
    if (!node) return;
    const mated = node.conns.filter((c) => c.mate && isJoined(c));
    const anchor = mated.find((c) => c.idx === (node.inst.entry || 0)) || mated[0];
    pushUndo();
    ws.layout.pieces = ws.layout.pieces.filter((p) => p.uid !== u);
    sel = anchor ? { kind: 'end', uid: anchor.mate.uid, idx: anchor.mate.idx } : NONE;
    changed(); update();
  }

  function rotateAbout(group, pivot, deg) {
    const c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180);
    for (const p of ws.layout.pieces) {
      if (!group.has(p.uid)) continue;
      const dx = p.x - pivot.x, dy = p.y - pivot.y;
      p.x = pivot.x + dx * c - dy * s;
      p.y = pivot.y + dx * s + dy * c;
      p.rot = G.wrap(p.rot + deg);
    }
  }

  function rotateGroup(u, deg) {
    const A = an();
    const node = A.byUid.get(u);
    if (!node) return;
    const grp = G.component(A, u);
    pushUndo();
    rotateAbout(grp, G.toWorld(node.inst, node.variant.centre), deg);
    changed(); update();
  }

  function snapGroup(grp) {
    const A = an();
    let best = null;
    for (const c of A.conns) {
      if (!grp.has(c.uid) || isJoined(c)) continue;
      for (const d of A.conns) {
        if (grp.has(d.uid) || isJoined(d)) continue;
        const e = G.jointError(d, c);
        if (e.dist < 45 && Math.abs(e.angle) < 25) {
          const score = e.dist + Math.abs(e.angle) * 2;
          if (!best || score < best.score) best = { c, d, score };
        }
      }
    }
    if (!best) return false;
    rotateAbout(grp, best.c, G.wrap(best.d.h + 180 - best.c.h));
    const dx = best.d.x - best.c.x, dy = best.d.y - best.c.y;
    for (const p of ws.layout.pieces) if (grp.has(p.uid)) { p.x += dx; p.y += dy; }
    return true;
  }

  /* ======================= canvas ======================= */
  const cv = $('#cv');
  const ctx = cv.getContext('2d');
  let C = {};
  function readColours() {
    const cs = getComputedStyle(document.documentElement);
    const g = (n) => cs.getPropertyValue(n).trim();
    C = {
      floor: g('--floor'), grid: g('--grid'), gridMajor: g('--grid-major'), panel: g('--panel'), ink: g('--ink'), muted: g('--muted'),
      track: g('--track'), edge: g('--track-edge'), rail: g('--rail'), custom: g('--custom'), bridge: g('--bridge'), plate: g('--plate'), accent: g('--accent'),
      accentSoft: g('--accent-soft'), ok: g('--ok'), warn: g('--warn'), bad: g('--bad'), badSoft: g('--bad-soft'),
    };
  }
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColours(); render(); renderPalette(); }); } catch { /* old browsers */ }
  new MutationObserver(() => { readColours(); render(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  function resize() {
    const r = cv.getBoundingClientRect();
    cssW = Math.max(1, r.width); cssH = Math.max(1, r.height);
    DPR = Math.min(window.devicePixelRatio || 1, 3);
    cv.width = Math.round(cssW * DPR); cv.height = Math.round(cssH * DPR);
    render();
  }
  new ResizeObserver(resize).observe($('#stage'));

  const toScreen = (p) => ({ x: (p.x - view.cx) * view.s + cssW / 2, y: (p.y - view.cy) * view.s + cssH / 2 });
  const toWorldPt = (x, y) => ({ x: (x - cssW / 2) / view.s + view.cx, y: (y - cssH / 2) / view.s + view.cy });

  function drawPolyline(c, pts) {
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
  }
  function offsetPts(pts, d) {
    return pts.map((p) => ({ x: p.x - Math.sin(p.h * Math.PI / 180) * d, y: p.y + Math.cos(p.h * Math.PI / 180) * d }));
  }

  function drawLayout(c, s, A, opts) {
    const px = 1 / s; // one screen pixel in world units
    const u = usage();
    const overTypes = new Set(ws.lib.unlimited ? [] : Object.keys(u).filter((t) => u[t] > owned(t)));
    const overlapUids = new Set(A.overlaps.flatMap((o) => [o.a, o.b]));
    const selGroup = !opts.export && sel.kind === 'piece' ? G.component(A, sel.uid) : null;

    // selection halo
    if (selGroup) {
      for (const node of A.byUid.values()) {
        if (!selGroup.has(node.inst.uid)) continue;
        const main = node.inst.uid === sel.uid;
        c.strokeStyle = C.accent; c.globalAlpha = main ? 0.9 : 0.14;
        c.lineWidth = G.GAUGE_WIDTH + (main ? 14 : 8) * px; c.lineCap = 'round'; c.lineJoin = 'round';
        node.samples.forEach((pts) => { drawPolyline(c, pts); c.stroke(); });
      }
      c.globalAlpha = 1;
    }
    // bridges are drawn last, lifted by a shadow, so they read as passing over other track
    const nodes = [...A.byUid.values()].sort((p, q) => (p.def.bridge ? 1 : 0) - (q.def.bridge ? 1 : 0));
    for (const node of nodes) {
      const colour = node.def.bridge ? C.bridge : node.def.builtin ? C.track : (node.def.color || C.custom);
      c.lineCap = 'butt'; c.lineJoin = 'round';
      for (const [x0, y0, x1, y1] of node.def.decor || []) {
        const q = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => G.toWorld(node.inst, { x, y }));
        c.fillStyle = C.plate; c.strokeStyle = C.edge; c.lineWidth = Math.max(2, 2 * px);
        c.beginPath(); q.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath(); c.fill(); c.stroke();
      }
      if (node.def.bridge) { c.shadowColor = 'rgba(0,0,0,0.35)'; c.shadowBlur = 14 * Math.max(1, s); c.shadowOffsetY = 4 * Math.max(1, s); }
      c.strokeStyle = overTypes.has(node.inst.type) ? C.bad : C.edge;
      c.lineWidth = G.GAUGE_WIDTH + Math.max(2, 2.5 * px);
      node.samples.forEach((pts) => { drawPolyline(c, pts); c.stroke(); });
      c.strokeStyle = colour; c.lineWidth = G.GAUGE_WIDTH - 2;
      node.samples.forEach((pts) => { drawPolyline(c, pts); c.stroke(); });
      c.strokeStyle = C.rail; c.lineWidth = Math.max(3, 1.2 * px);
      node.samples.forEach((pts) => {
        drawPolyline(c, offsetPts(pts, 20)); c.stroke();
        drawPolyline(c, offsetPts(pts, -20)); c.stroke();
      });
      c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetY = 0;
      if (overlapUids.has(node.inst.uid)) {
        c.strokeStyle = C.badSoft; c.lineWidth = G.GAUGE_WIDTH;
        node.samples.forEach((pts) => { drawPolyline(c, pts); c.stroke(); });
      }
    }
    // joints
    for (const j of A.joints) {
      const a = j.a, b = j.b;
      if (j.kind === 'ok' || j.kind === 'flex') {
        const nx = -Math.sin(a.h * Math.PI / 180), ny = Math.cos(a.h * Math.PI / 180);
        c.strokeStyle = C.edge; c.lineWidth = Math.max(1.5, 1.2 * px);
        c.beginPath(); c.moveTo(a.x + nx * 32, a.y + ny * 32); c.lineTo(a.x - nx * 32, a.y - ny * 32); c.stroke();
        if (j.kind === 'flex') {
          c.fillStyle = C.warn; c.beginPath(); c.arc((a.x + b.x) / 2, (a.y + b.y) / 2, Math.max(6, 5 * px), 0, Math.PI * 2); c.fill();
        }
      } else {
        c.strokeStyle = C.bad; c.lineWidth = Math.max(3, 2.5 * px);
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
        c.fillStyle = C.bad;
        [a, b].forEach((p) => { c.beginPath(); c.arc(p.x, p.y, Math.max(5, 4 * px), 0, Math.PI * 2); c.fill(); });
      }
    }
    // open ends
    if (!opts.export) {
      for (const k of A.conns) {
        if (k.state !== 'open') continue;
        const r = Math.max(8, 9 * px);
        const hx = Math.cos(k.h * Math.PI / 180), hy = Math.sin(k.h * Math.PI / 180);
        c.fillStyle = C.panel; c.strokeStyle = C.ink; c.lineWidth = Math.max(2, 2 * px);
        c.beginPath(); c.arc(k.x, k.y, r, 0, Math.PI * 2); c.fill(); c.stroke();
        c.fillStyle = C.ink; c.beginPath();
        c.moveTo(k.x + hx * r * 2.1, k.y + hy * r * 2.1);
        c.lineTo(k.x + hx * r * 1.2 - hy * r * 0.7, k.y + hy * r * 1.2 + hx * r * 0.7);
        c.lineTo(k.x + hx * r * 1.2 + hy * r * 0.7, k.y + hy * r * 1.2 - hx * r * 0.7);
        c.closePath(); c.fill();
      }
      if (sel.kind === 'end') {
        const node = A.byUid.get(sel.uid);
        const k = node && node.conns[sel.idx];
        if (k) {
          const r = Math.max(14, 15 * px);
          const hx = Math.cos(k.h * Math.PI / 180), hy = Math.sin(k.h * Math.PI / 180);
          c.strokeStyle = C.accent; c.lineWidth = Math.max(3, 3.5 * px);
          c.fillStyle = C.accentSoft;
          c.beginPath(); c.arc(k.x, k.y, r, 0, Math.PI * 2); c.fill(); c.stroke();
          c.fillStyle = C.accent; c.beginPath();
          c.moveTo(k.x + hx * r * 2.2, k.y + hy * r * 2.2);
          c.lineTo(k.x + hx * r * 1.15 - hy * r * 0.75, k.y + hy * r * 1.15 + hx * r * 0.75);
          c.lineTo(k.x + hx * r * 1.15 + hy * r * 0.75, k.y + hy * r * 1.15 - hx * r * 0.75);
          c.closePath(); c.fill();
        }
      }
    }
    // overlap markers
    for (const o of A.overlaps) {
      const r = Math.max(10, 10 * px);
      c.strokeStyle = C.bad; c.lineWidth = Math.max(3, 3 * px);
      c.beginPath(); c.moveTo(o.at.x - r, o.at.y - r); c.lineTo(o.at.x + r, o.at.y + r);
      c.moveTo(o.at.x + r, o.at.y - r); c.lineTo(o.at.x - r, o.at.y + r); c.stroke();
    }
  }

  function render() {
    if (!ws) return;
    const A = an();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.floor; ctx.fillRect(0, 0, cv.width, cv.height);
    const s = view.s;
    ctx.setTransform(DPR * s, 0, 0, DPR * s, DPR * (cssW / 2 - view.cx * s), DPR * (cssH / 2 - view.cy * s));
    // stud grid
    if (ws.settings.grid) {
      const x0 = view.cx - cssW / 2 / s, x1 = view.cx + cssW / 2 / s, y0 = view.cy - cssH / 2 / s, y1 = view.cy + cssH / 2 / s;
      const drawGrid = (step, colour) => {
        ctx.strokeStyle = colour; ctx.lineWidth = 1 / s; ctx.beginPath();
        for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
        for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
        ctx.stroke();
      };
      if (s * G.STUD >= 7) drawGrid(G.STUD, C.grid);
      if (s * G.STUD * 8 >= 10) drawGrid(G.STUD * 8, C.gridMajor);
    }
    drawLayout(ctx, s, A, {});
    // screen-space labels
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.font = '600 12px "JetBrains Mono", ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    const label = (p, text, fg, bg) => {
      const sp = toScreen(p);
      const w = ctx.measureText(text).width + 12;
      ctx.fillStyle = bg; roundRect(ctx, sp.x - w / 2, sp.y - 24 - 10, w, 20, 10); ctx.fill();
      ctx.fillStyle = fg; ctx.fillText(text, sp.x - w / 2 + 6, sp.y - 24);
    };
    for (const j of A.joints) {
      const mid = { x: (j.a.x + j.b.x) / 2, y: (j.a.y + j.b.y) / 2 };
      if (j.kind === 'miss') label(mid, `${fmt(j.e.dist)} mm · ${fmt(Math.abs(j.e.angle))}°`, C.panel, C.bad);
    }
    for (const o of A.overlaps) label(o.at, 'overlap', C.panel, C.bad);
    updateScalebar();
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  function updateScalebar() {
    const target = 90 / view.s; // mm in ~90px
    const steps = [16, 32, 64, 128, 256, 512, 1000, 2000, 5000];
    const mm = steps.find((v) => v >= target) || 5000;
    $('.scalebar-bar').style.width = (mm * view.s).toFixed(0) + 'px';
    $('.scalebar-label').textContent = mm >= 1000 ? `${mm / 1000} m` : `${mm} mm · ${mm / 16} studs`;
  }

  function layoutBounds(pieces) {
    const A = pieces === ws.layout.pieces ? an() : G.analyse(pieces, D(), tol());
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of A.byUid.values()) {
      minX = Math.min(minX, n.bbox.minX); minY = Math.min(minY, n.bbox.minY);
      maxX = Math.max(maxX, n.bbox.maxX); maxY = Math.max(maxY, n.bbox.maxY);
    }
    if (!Number.isFinite(minX)) return null;
    return { minX: minX - 40, minY: minY - 40, maxX: maxX + 40, maxY: maxY + 40 };
  }
  function fit() {
    const b = layoutBounds(ws.layout.pieces);
    if (!b) { view.cx = 0; view.cy = 0; view.s = 0.5; render(); return; }
    view.cx = (b.minX + b.maxX) / 2; view.cy = (b.minY + b.maxY) / 2;
    view.s = clamp(Math.min(cssW / (b.maxX - b.minX), cssH / (b.maxY - b.minY)) * 0.9, 0.03, 4);
    render();
  }

  /* ======================= hit testing ======================= */
  function hitConn(w) {
    const A = an();
    let best = null, bd = Math.max(26 / view.s, 18);
    for (const c of A.conns) {
      if (isJoined(c)) continue;
      const d = Math.hypot(c.x - w.x, c.y - w.y);
      if (d < bd) { bd = d; best = c; }
    }
    if (sel.kind === 'end') {
      const node = A.byUid.get(sel.uid);
      const c = node && node.conns[sel.idx];
      if (c && Math.hypot(c.x - w.x, c.y - w.y) < Math.max(30 / view.s, 20) && (!best || best === c)) return c;
    }
    return best;
  }
  function distToSeg(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }
  function hitPiece(w) {
    const A = an();
    let best = null, bd = G.GAUGE_WIDTH / 2 + 6 / view.s;
    for (const node of A.byUid.values()) {
      const bb = node.bbox;
      if (w.x < bb.minX - 40 || w.x > bb.maxX + 40 || w.y < bb.minY - 40 || w.y > bb.maxY + 40) continue;
      for (const pts of node.samples) {
        for (let i = 1; i < pts.length; i++) {
          const d = distToSeg(w, pts[i - 1], pts[i]);
          if (d < bd) { bd = d; best = node.inst.uid; }
        }
      }
    }
    return best;
  }

  /* ======================= gestures ======================= */
  const ptrs = new Map();
  let gest = null;
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (ptrs.size === 1) {
      const w = toWorldPt(e.offsetX, e.offsetY);
      gest = { mode: 'pan', sx: e.offsetX, sy: e.offsetY, v0: { ...view }, moved: false, t: performance.now() };
      if (sel.kind === 'piece') {
        const A = an();
        const grp = G.component(A, sel.uid);
        const hit = hitPiece(w);
        if (hit && grp.has(hit)) {
          gest.mode = 'drag'; gest.grp = grp; gest.w0 = w;
          gest.orig = ws.layout.pieces.filter((p) => grp.has(p.uid)).map((p) => ({ p, x: p.x, y: p.y }));
          gest.before = snapshot();
        }
      }
    } else if (ptrs.size === 2) {
      if (gest && gest.mode === 'drag') restoreDrag();
      const [a, b] = [...ptrs.values()];
      gest = { mode: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, v0: { ...view }, moved: true };
    }
  });
  function restoreDrag() { gest.orig.forEach((o) => { o.p.x = o.x; o.p.y = o.y; }); AN = null; }
  cv.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId) || !gest) return;
    ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (gest.mode === 'pinch' && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const s = clamp(gest.v0.s * d / (gest.d0 || 1), 0.03, 6);
      const wm = { x: (gest.m0.x - cssW / 2) / gest.v0.s + gest.v0.cx, y: (gest.m0.y - cssH / 2) / gest.v0.s + gest.v0.cy };
      view.s = s; view.cx = wm.x - (m.x - cssW / 2) / s; view.cy = wm.y - (m.y - cssH / 2) / s;
      render(); return;
    }
    const dx = e.offsetX - gest.sx, dy = e.offsetY - gest.sy;
    if (!gest.moved && Math.hypot(dx, dy) < 7) return;
    gest.moved = true;
    if (gest.mode === 'pan') { view.cx = gest.v0.cx - dx / view.s; view.cy = gest.v0.cy - dy / view.s; render(); }
    else if (gest.mode === 'drag') {
      gest.orig.forEach((o) => { o.p.x = o.x + dx / view.s; o.p.y = o.y + dy / view.s; });
      AN = null; render();
    }
  });
  function endPointer(e) {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (!gest) return;
    if (gest.mode === 'pinch') { if (ptrs.size === 0) gest = null; return; }
    if (ptrs.size > 0) return;
    if (!gest.moved) { gest = null; tap(toWorldPt(e.offsetX, e.offsetY)); return; }
    if (gest.mode === 'drag') {
      undoStack.push(gest.before); redoStack = [];
      AN = null;
      const snapped = snapGroup(gest.grp);
      changed({ keepSel: true });
      if (snapped) toast('Snapped into place');
      update();
    }
    gest = null;
  }
  cv.addEventListener('pointerup', endPointer);
  cv.addEventListener('pointercancel', (e) => { if (gest && gest.mode === 'drag') { restoreDrag(); render(); } ptrs.delete(e.pointerId); gest = null; });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const w = toWorldPt(e.offsetX, e.offsetY);
    const s = clamp(view.s * Math.exp(-e.deltaY * 0.0015), 0.03, 6);
    view.s = s; view.cx = w.x - (e.offsetX - cssW / 2) / s; view.cy = w.y - (e.offsetY - cssH / 2) / s;
    render();
  }, { passive: false });

  function tap(w) {
    const c = hitConn(w);
    if (c) { sel = { kind: 'end', uid: c.uid, idx: c.idx }; update(); return; }
    const p = hitPiece(w);
    if (p) { sel = sel.kind === 'piece' && sel.uid === p ? NONE : { kind: 'piece', uid: p }; update(); return; }
    sel = NONE; update();
  }

  /* ======================= piece thumbnails ======================= */
  function pieceSVG(def, mirror, opts) {
    opts = opts || {};
    const comp = G.compile(def);
    const v = mirror && !comp.symmetric ? comp.mirrored : comp.normal;
    const pad = 40, b = { ...v.bbox };
    for (const [x0, y0, x1, y1] of def.decor || []) { b.minX = Math.min(b.minX, x0); b.maxX = Math.max(b.maxX, x1); b.minY = Math.min(b.minY, y0); b.maxY = Math.max(b.maxY, y1); }
    const decor = (def.decor || []).map(([x0, y0, x1, y1]) => `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" style="fill:var(--plate);stroke:var(--track-edge);stroke-width:4"/>`).join('');
    const vb = [b.minX - pad, b.minY - pad, b.maxX - b.minX + pad * 2, b.maxY - b.minY + pad * 2].map((n) => n.toFixed(1)).join(' ');
    const colour = def.bridge ? 'var(--bridge)' : def.builtin ? 'var(--track)' : esc(def.color || 'var(--custom)');
    const lines = v.samples.map((pts) => `<polyline points="${pts.map((p) => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ')}"/>`).join('');
    const conns = v.conns.map((c, i) => `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${opts.labels ? 16 : 11}" style="fill:var(--panel);stroke:var(--ink);stroke-width:5"/>` +
      (opts.labels ? `<text x="${c.x.toFixed(1)}" y="${(c.y + 7).toFixed(1)}" text-anchor="middle" style="fill:var(--ink);font:700 20px var(--font-data)">${i + 1}</text>` : '')).join('');
    return `<svg viewBox="${vb}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${decor}<g fill="none" stroke-linejoin="round"><g style="stroke:var(--track-edge);stroke-width:68">${lines}</g><g style="stroke:${colour};stroke-width:62">${lines}</g></g>${conns}</svg>`;
  }

  /* ======================= dock ======================= */
  const isHanded = (def) => !G.compile(def).symmetric;

  function renderPalette() {
    const u = usage();
    const types = allTypes().filter((t) => !ws.lib.hidden[t]);
    const cards = types.map((t) => {
      const def = D()[t];
      const handed = isHanded(def);
      const used = u[t] || 0, have = owned(t);
      const left = have - used;
      let countHtml;
      if (ws.lib.unlimited) countHtml = `<span class="pcount">${used}</span>`;
      else countHtml = `<span class="pcount ${left < 0 ? 'over' : left === 0 ? 'none' : ''}" title="${used} used of ${have}">${left < 0 ? left : left + ' left'}</span>`;
      const hands = handed
        ? `<button class="hand" type="button" data-add="${esc(t)}" data-mirror="1" aria-label="Add ${esc(def.name)} turning left"><span class="hand-tag">L</span>${pieceSVG(def, true)}</button>` +
          `<button class="hand" type="button" data-add="${esc(t)}" data-mirror="0" aria-label="Add ${esc(def.name)} turning right"><span class="hand-tag">R</span>${pieceSVG(def, false)}</button>`
        : `<button class="hand" type="button" data-add="${esc(t)}" data-mirror="0" aria-label="Add ${esc(def.name)}">${pieceSVG(def, false)}</button>`;
      return `<div class="piece-card ${handed ? 'wide' : ''}"><div class="hands">${hands}</div><div class="meta"><span class="pname">${esc(def.name)}</span>${countHtml}</div></div>`;
    });
    cards.push('<button class="palette-add" type="button" id="paletteMore">Pieces &amp; counts</button>');
    $('#palette').innerHTML = cards.join('');
  }
  $('#palette').addEventListener('click', (e) => {
    const b = e.target.closest('[data-add]');
    if (b) {
      const type = b.dataset.add, mirror = b.dataset.mirror === '1';
      if (sel.kind === 'piece') mutatePiece(sel.uid, { type, mirror });
      else addPiece(type, mirror);
      return;
    }
    if (e.target.closest('#paletteMore')) openSheet('inventory');
  });

  const ICON = {
    rotL: '<svg viewBox="0 0 24 24"><path d="M4 4v6h6"/><path d="M5.5 15a7 7 0 1 0 1.7-7.3L4 10"/></svg>',
    rotR: '<svg viewBox="0 0 24 24"><path d="M20 4v6h-6"/><path d="M18.5 15a7 7 0 1 1-1.7-7.3L20 10"/></svg>',
    flip: '<svg viewBox="0 0 24 24"><path d="M12 3v18"/><path d="M8 7L3 12l5 5V7zM16 7l5 5-5 5V7z"/></svg>',
    turn: '<svg viewBox="0 0 24 24"><path d="M7 7h10a4 4 0 0 1 0 8H8"/><path d="M11 11l-4 4 4 4"/></svg>',
    del: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    gap: '<svg viewBox="0 0 24 24"><path d="M4 18c0-7 5-12 12-12"/><path d="M14 3l3 3-3 3"/><circle cx="4" cy="19" r="1.5"/><circle cx="20" cy="6" r="1.5"/></svg>',
  };

  function renderSelbar() {
    const el = $('#selbar');
    const A = an();
    if (sel.kind === 'piece') {
      const node = A.byUid.get(sel.uid);
      const def = node.def;
      const comp = G.compile(def);
      const step = ws.settings.rotStep;
      el.innerHTML = `<span class="label"><strong>${esc(handName(def, node.inst.mirror))}</strong> · tap a piece below to swap</span>
        <button class="btn" type="button" data-act="rotL" aria-label="Rotate ${step}° anticlockwise">${ICON.rotL}${step}°</button>
        <button class="btn" type="button" data-act="rotR" aria-label="Rotate ${step}° clockwise">${ICON.rotR}${step}°</button>
        ${comp.symmetric ? '' : `<button class="btn" type="button" data-act="flip">${ICON.flip}Flip</button>`}
        ${node.variant.conns.length > 1 ? `<button class="btn" type="button" data-act="turn">${ICON.turn}Turn round</button>` : ''}
        <button class="btn danger" type="button" data-act="del">${ICON.del}Delete</button>`;
    } else if (sel.kind === 'end') {
      el.innerHTML = `<span class="label"><strong>Building from this end.</strong> Tap a piece below.</span>
        <button class="btn" type="button" data-act="solve">${ICON.gap}Close a gap</button>
        <button class="btn" type="button" data-act="clear">Done</button>`;
    } else {
      el.innerHTML = ws.layout.pieces.length
        ? '<span class="label">Tap an open end <strong>○</strong> to build from it, or tap a piece to move, flip or swap it.</span>'
        : '<span class="label">Tap a piece below to place your first track.</span>';
    }
  }
  $('#selbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'clear') { sel = NONE; update(); }
    else if (act === 'solve') openSheet('solver');
    else if (sel.kind === 'piece') {
      const inst = findInst(sel.uid);
      if (act === 'rotL') rotateGroup(sel.uid, -ws.settings.rotStep);
      if (act === 'rotR') rotateGroup(sel.uid, ws.settings.rotStep);
      if (act === 'flip') mutatePiece(sel.uid, { mirror: !inst.mirror });
      if (act === 'turn') mutatePiece(sel.uid, { entry: (inst.entry || 0) + 1 });
      if (act === 'del') deletePiece(sel.uid);
    }
  });

  function renderStatus() {
    const A = an();
    const ok = A.joints.filter((j) => j.kind === 'ok').length;
    const flex = A.joints.filter((j) => j.kind === 'flex');
    const miss = A.joints.filter((j) => j.kind === 'miss');
    const open = A.conns.filter((c) => c.state === 'open').length;
    const u = usage();
    const over = ws.lib.unlimited ? [] : Object.keys(u).filter((t) => u[t] > owned(t));
    const chips = [];
    chips.push(`<span class="chip"><b>${ws.layout.pieces.length}</b> pieces</span>`);
    chips.push(`<span class="chip ok"><span class="dot"></span><b>${ok}</b> joints fit</span>`);
    if (flex.length) {
      const worst = flex.reduce((m, j) => Math.max(m, Math.abs(j.e.along), Math.abs(j.e.lateral)), 0);
      chips.push(`<button class="chip warn" type="button" data-focus="flex"><span class="dot"></span><b>${flex.length}</b> fit with flex · ${fmt(worst)} mm</button>`);
    }
    if (miss.length) {
      const worst = miss.reduce((m, j) => Math.max(m, j.e.dist), 0);
      chips.push(`<button class="chip bad" type="button" data-focus="miss"><span class="dot"></span><b>${miss.length}</b> gap${miss.length > 1 ? 's' : ''} · ${fmt(worst)} mm</button>`);
    }
    if (A.overlaps.length) chips.push(`<button class="chip bad" type="button" data-focus="overlap"><span class="dot"></span><b>${A.overlaps.length}</b> overlap${A.overlaps.length > 1 ? 's' : ''}</button>`);
    chips.push(`<span class="chip open"><span class="dot"></span><b>${open}</b> open end${open === 1 ? '' : 's'}</span>`);
    if (over.length) chips.push(`<button class="chip bad" type="button" data-focus="inv"><span class="dot"></span>Short of ${over.map((t) => `${u[t] - owned(t)} ${esc(D()[t].name.toLowerCase())}`).join(', ')}</button>`);
    if (!miss.length && !A.overlaps.length && !open && ws.layout.pieces.length) chips.splice(1, 0, '<span class="chip ok"><span class="dot"></span>Closed layout</span>');
    $('#status').innerHTML = chips.join('');
  }
  $('#status').addEventListener('click', (e) => {
    const b = e.target.closest('[data-focus]');
    if (!b) return;
    const A = an();
    const k = b.dataset.focus;
    if (k === 'inv') { openSheet('inventory'); return; }
    let p = null;
    if (k === 'overlap' && A.overlaps[0]) p = A.overlaps[0].at;
    else {
      const j = A.joints.find((jt) => jt.kind === k);
      if (j) { p = { x: (j.a.x + j.b.x) / 2, y: (j.a.y + j.b.y) / 2 }; if (k === 'miss') sel = { kind: 'end', uid: j.a.uid, idx: j.a.idx }; }
    }
    if (p) { view.cx = p.x; view.cy = p.y; view.s = Math.max(view.s, 1); update(); }
  });

  function update() {
    validateSel();
    render();
    renderPalette();
    renderSelbar();
    renderStatus();
    $('#undoBtn').disabled = !undoStack.length;
    $('#redoBtn').disabled = !redoStack.length;
    $('#layoutNameBtn').textContent = ws.layout.name || 'Untitled layout';
  }

  let toastTimer = null;
  function toast(msg, action) {
    const el = $('#toast');
    el.innerHTML = esc(msg) + (action ? ` <button type="button">${esc(action.label)}</button>` : '');
    el.hidden = false;
    if (action) el.querySelector('button').onclick = () => { el.hidden = true; action.fn(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, action ? 6000 : 2800);
  }

  /* ======================= sheets ======================= */
  const sheet = $('#sheet');
  function openSheet(name, arg) {
    const r = SHEETS[name](arg);
    $('#sheetTitle').textContent = r.title;
    // fresh element each time so listeners from the previous sheet are dropped
    const oldBody = $('#sheetBody');
    const fresh = oldBody.cloneNode(false);
    oldBody.replaceWith(fresh);
    fresh.innerHTML = r.html;
    fresh.scrollTop = 0;
    sheet.hidden = false;
    sheet.dataset.name = name;
    if (r.mount) r.mount($('#sheetBody'));
  }
  function closeSheet() { sheet.hidden = true; update(); }
  $('#sheetClose').addEventListener('click', closeSheet);
  sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });

  const SHEETS = {};

  SHEETS.menu = () => ({
    title: 'Menu',
    html: `<div class="menu-grid">
      <button class="menu-item" type="button" data-go="inventory"><strong>My pieces</strong><span>How many of each piece you own</span></button>
      <button class="menu-item" type="button" data-go="library"><strong>Piece library</strong><span>Built-in pieces and your 3D prints</span></button>
      <button class="menu-item" type="button" data-go="settings"><strong>Fit tolerance</strong><span>How much play a joint can take</span></button>
      <button class="menu-item" type="button" data-go="layouts"><strong>Layouts</strong><span>Save, open, export and share</span></button>
      <button class="menu-item" type="button" data-go="help"><strong>How it works</strong><span>Gestures and checks explained</span></button>
    </div>
    <p class="storage-note">${Store.server ? 'Layouts and pieces are <b>saved on your server</b>, so every device sees them.' : 'Layouts and pieces are <b>saved in this browser only</b>. Run the container to share them between devices.'}</p>`,
    mount(body) { body.addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) openSheet(b.dataset.go); }); },
  });

  /* ---------- inventory ---------- */
  SHEETS.inventory = () => {
    const u = usage();
    const rows = allTypes().map((t) => {
      const def = D()[t];
      const used = u[t] || 0, have = owned(t);
      return `<div class="list-row">
        <div class="thumb">${pieceSVG(def, false)}</div>
        <div class="info"><strong>${esc(def.name)}</strong><span>${def.part ? 'Part ' + esc(def.part) + ' · ' : def.builtin ? '' : '3D print · '}<span class="tag ${!ws.lib.unlimited && used > have ? 'over' : ''}">${used} in layout</span></span>
          <label class="check" style="font-size:12px;margin-top:4px"><input type="checkbox" data-show="${esc(t)}" ${ws.lib.hidden[t] ? '' : 'checked'}> Show in piece tray</label></div>
        <div class="stepper"><button type="button" data-step="${esc(t)}" data-d="-1" aria-label="One fewer">−</button><input type="number" inputmode="numeric" min="0" id="inv-${esc(t)}" data-inv="${esc(t)}" value="${have}" aria-label="${esc(def.name)} owned"><button type="button" data-step="${esc(t)}" data-d="1" aria-label="One more">+</button></div>
      </div>`;
    }).join('');
    return {
      title: 'My pieces',
      html: `<p class="hint">Enter how many of each piece you own. The tray shows how many are left, and the status bar warns when a layout needs more than you have.</p>
        <label class="check"><input type="checkbox" id="unlimited" ${ws.lib.unlimited ? 'checked' : ''}> Ignore counts (plan with unlimited pieces)</label>
        <div class="group"><h3>Add a set</h3>${setsHtml()}</div>
        <div class="list">${rows}</div>
        <div class="row"><button class="btn" type="button" id="toLibrary">Add a 3D-printed piece</button></div>`,
      mount(body) {
        body.addEventListener('input', (e) => {
          const t = e.target.dataset.inv;
          if (t) { ws.lib.inventory[t] = Math.max(0, parseInt(e.target.value, 10) || 0); changed({ keepSel: true }); renderPalette(); renderStatus(); }
        });
        body.addEventListener('change', (e) => {
          if (e.target.id === 'unlimited') { ws.lib.unlimited = e.target.checked; changed({ keepSel: true }); }
          const t = e.target.dataset.show;
          if (t) { if (e.target.checked) delete ws.lib.hidden[t]; else ws.lib.hidden[t] = true; changed({ keepSel: true }); }
          renderPalette(); renderStatus();
        });
        body.addEventListener('click', (e) => {
          const b = e.target.closest('[data-step]');
          if (b) {
            const t = b.dataset.step;
            ws.lib.inventory[t] = Math.max(0, owned(t) + +b.dataset.d);
            body.querySelector(`[data-inv="${CSS.escape(t)}"]`).value = ws.lib.inventory[t];
            changed({ keepSel: true }); renderPalette(); renderStatus();
          }
          if (e.target.id === 'toLibrary') openSheet('library');
          if (e.target.id === 'addSet') {
            const id = $('#set-id', body).value.trim(), qty = Math.max(1, parseInt($('#set-qty', body).value, 10) || 1);
            const set = S.find(id);
            if (!set) { $('#set-msg', body).textContent = `Set ${id || '?'} isn't in the catalogue yet. Enter its pieces by hand below.`; return; }
            addSet(set, qty); openSheet('inventory');
          }
          const rm = e.target.closest('[data-rmset]');
          if (rm) { removeSet(rm.dataset.rmset); openSheet('inventory'); }
        });
      },
    };
  };

  /* ---------- sets ---------- */
  const S = window.DuploSets;
  function setsHtml() {
    const have = ws.lib.sets.map((x) => {
      const set = S.find(x.id);
      return `<div class="list-row"><div></div><div class="info"><strong>${x.qty} × ${esc(x.id)} ${set ? esc(set.name) : ''}</strong>${set && set.extra ? `<span>${esc(set.extra)}</span>` : ''}</div>
        <button class="btn small" type="button" data-rmset="${esc(x.id)}">Remove</button></div>`;
    }).join('');
    return `<p class="hint">Type a set number to add its track pieces to your counts. Known sets: ${S.SETS.map((s) => esc(s.id)).join(', ')}.</p>
      <div class="row"><div class="field"><label for="set-id">Set number</label><input type="text" id="set-id" inputmode="numeric" list="set-list" placeholder="10872"></div>
      <div class="field"><label for="set-qty">How many</label><input type="number" id="set-qty" min="1" value="1"></div>
      <button class="btn primary" type="button" id="addSet">Add set</button></div>
      <datalist id="set-list">${S.SETS.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</datalist>
      <p class="hint" id="set-msg"></p>
      ${have ? `<div class="list">${have}</div>` : ''}`;
  }
  function addSet(set, qty) {
    for (const [t, n] of Object.entries(set.pieces)) {
      ws.lib.inventory[t] = owned(t) + n * qty;
      delete ws.lib.hidden[t];
    }
    const cur = ws.lib.sets.find((x) => x.id === set.id);
    if (cur) cur.qty += qty; else ws.lib.sets.push({ id: set.id, qty });
    changed({ keepSel: true }); renderPalette(); renderStatus();
    toast(`Added ${qty} × ${set.id} ${set.name}`);
  }
  function removeSet(id) {
    const set = S.find(id), cur = ws.lib.sets.find((x) => x.id === id);
    if (!cur) return;
    if (set) for (const [t, n] of Object.entries(set.pieces)) ws.lib.inventory[t] = Math.max(0, owned(t) - n * cur.qty);
    ws.lib.sets = ws.lib.sets.filter((x) => x.id !== id);
    changed({ keepSel: true }); renderPalette(); renderStatus();
  }

  /* ---------- library ---------- */
  function geomSummary(def) {
    const parts = def.paths.map((p) => p.segs.map((s) => (s.type === 'line' ? `${+s.len.toFixed(1)} mm straight` : `${+Math.abs(s.angle).toFixed(2)}° arc, R ${+s.r.toFixed(1)} mm`)).join(' + '));
    return parts.join(' | ');
  }
  SHEETS.library = () => {
    const builtins = G.BUILTIN.map((d) => `<div class="list-row"><div class="thumb">${pieceSVG(d, false)}</div>
      <div class="info"><strong>${esc(d.name)}</strong><span>${esc(geomSummary(d))}</span><span>${esc(d.notes || '')}</span></div><span class="tag">${esc(d.part)}</span></div>`).join('');
    const customs = ws.lib.custom.length ? ws.lib.custom.map((d) => `<div class="list-row"><div class="thumb">${pieceSVG(d, false)}</div>
      <div class="info"><strong>${esc(d.name)}</strong><span>${esc(geomSummary(d))}</span>${d.slack ? `<span>Extra play ${+d.slack} mm</span>` : ''}</div>
      <button class="btn small" type="button" data-edit="${esc(d.id)}">Edit</button></div>`).join('')
      : '<div class="list-row"><div></div><div class="info"><span>No 3D-printed pieces yet.</span></div><span></span></div>';
    return {
      title: 'Piece library',
      html: `<div class="group"><h3>Your 3D-printed pieces</h3><div class="list">${customs}</div>
        <div class="row"><button class="btn primary" type="button" id="newCustom">New piece</button></div></div>
        <div class="group"><h3>Built-in Duplo pieces</h3><div class="list">${builtins}</div>
        <p class="hint">Geometry comes from the BlueBrick Duplo parts library (Alban Nanty, Roland Bal) and Robert Cailliau's published measurements: 1 Duplo stud = 16 mm, straight = 128 mm, curve = 30° on a 256 mm centreline radius, so 4 curves in an S match 4 straights exactly.</p></div>`,
      mount(body) {
        body.addEventListener('click', (e) => {
          if (e.target.id === 'newCustom') openSheet('editor', null);
          const b = e.target.closest('[data-edit]');
          if (b) openSheet('editor', b.dataset.edit);
        });
      },
    };
  };

  /* ---------- custom piece editor ---------- */
  SHEETS.editor = (id) => {
    const existing = id ? ws.lib.custom.find((d) => d.id === id) : null;
    const st = existing
      ? { name: existing.name, color: existing.color || '#E3873A', template: existing.template || 'json', params: { ...(existing.params || {}) }, slack: existing.slack || 0, count: owned(existing.id), json: JSON.stringify(existing.paths, null, 1), notes: existing.notes || '' }
      : { name: '', color: '#E3873A', template: 'curve', params: { r: 256, angle: 45 }, slack: 0, count: 1, json: '', notes: '' };
    const tmplOpts = G.TEMPLATES.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('') + '<option value="json">Advanced: paths as JSON</option>';
    return {
      title: existing ? 'Edit piece' : 'New 3D-printed piece',
      html: `<div class="field"><label for="ed-name">Name</label><input type="text" id="ed-name" placeholder="e.g. 45° curve" value="${esc(st.name)}"></div>
        <div class="row">
          <div class="field grow"><label for="ed-tmpl">Shape</label><select id="ed-tmpl">${tmplOpts}</select></div>
          <div class="field"><label for="ed-color">Colour</label><input type="color" id="ed-color" value="${esc(st.color)}"></div>
        </div>
        <div id="ed-params" class="row"></div>
        <div class="field" id="ed-json-wrap" hidden><label for="ed-json">Paths (mm, degrees; y points down, positive angles turn right)</label><textarea id="ed-json" spellcheck="false"></textarea>
          <span class="hint">Each path: {"start":{"x":0,"y":0,"h":0},"segs":[{"type":"line","len":128},{"type":"arc","r":256,"angle":30}]}. Add "endOpen":false for a dead end.</span></div>
        <div class="preview" id="ed-preview"></div>
        <p class="hint" id="ed-geom"></p>
        <div class="row">
          <div class="field grow"><label for="ed-slack">Extra play at its joints (mm)</label><input type="number" id="ed-slack" step="0.5" min="0" value="${st.slack}"></div>
          <div class="field grow"><label for="ed-count">How many you own</label><input type="number" id="ed-count" min="0" value="${st.count}"></div>
        </div>
        <div class="field"><label for="ed-notes">Notes</label><input type="text" id="ed-notes" placeholder="Printer, file, fit notes" value="${esc(st.notes)}"></div>
        <div class="row"><button class="btn primary" type="button" id="ed-save">Save piece</button>
          ${existing ? '<button class="btn danger" type="button" id="ed-del">Delete</button>' : ''}
          <button class="btn" type="button" id="ed-cancel">Cancel</button></div>
        <div id="ed-confirm"></div>`,
      mount(body) {
        $('#ed-tmpl', body).value = st.template;
        const buildDef = () => {
          const t = $('#ed-tmpl', body).value;
          let paths, symmetric;
          if (t === 'json') {
            const parsed = JSON.parse($('#ed-json', body).value);
            paths = Array.isArray(parsed) ? parsed : parsed.paths;
            if (!Array.isArray(paths) || !paths.length) throw new Error('Paths must be a list with at least one path.');
            paths.forEach((p, i) => {
              if (!p.start || !Array.isArray(p.segs) || !p.segs.length) throw new Error(`Path ${i + 1} needs a start and at least one segment.`);
              p.segs.forEach((s) => {
                if (s.type === 'line' && !(Math.abs(+s.len) > 0)) throw new Error('Each line needs a length.');
                if (s.type === 'arc' && !(+s.r > 0 && Math.abs(+s.angle) > 0)) throw new Error('Each arc needs a radius and an angle.');
                if (s.type !== 'line' && s.type !== 'arc') throw new Error('Segment type must be "line" or "arc".');
              });
            });
          } else {
            const tm = G.TEMPLATES.find((x) => x.id === t);
            const params = {};
            for (const [k] of tm.params) {
              const v = parseFloat($(`#ed-p-${k}`, body).value);
              if (!Number.isFinite(v) || v === 0) throw new Error('Fill in every measurement with a non-zero number.');
              params[k] = v;
            }
            st.params = params;
            const made = tm.make(params);
            paths = made.paths; symmetric = made.symmetric;
          }
          return { paths, symmetric };
        };
        const renderParams = () => {
          const t = $('#ed-tmpl', body).value;
          const wrap = $('#ed-json-wrap', body);
          if (t === 'json') {
            $('#ed-params', body).innerHTML = '';
            wrap.hidden = false;
            if (!$('#ed-json', body).value) {
              let base = st.json;
              if (!base) { try { base = JSON.stringify(buildDefFrom(st), null, 1); } catch { base = '[]'; } }
              $('#ed-json', body).value = base;
            }
          } else {
            wrap.hidden = true;
            const tm = G.TEMPLATES.find((x) => x.id === t);
            $('#ed-params', body).innerHTML = tm.params.map(([k, label, dflt]) =>
              `<div class="field grow"><label for="ed-p-${k}">${esc(label)}</label><input type="number" step="any" id="ed-p-${k}" value="${st.params[k] ?? dflt}"></div>`).join('');
          }
          refresh();
        };
        const buildDefFrom = (s) => {
          const tm = G.TEMPLATES.find((x) => x.id === s.template) || G.TEMPLATES[0];
          const p = {}; tm.params.forEach(([k, , d]) => { p[k] = s.params[k] ?? d; });
          return tm.make(p).paths;
        };
        const refresh = () => {
          try {
            const { paths, symmetric } = buildDef();
            const def = { name: 'preview', color: $('#ed-color', body).value, paths, symmetric };
            $('#ed-preview', body).innerHTML = pieceSVG(def, false, { labels: true });
            const comp = G.compile(def);
            const v = comp.normal;
            const conns = v.conns.length;
            $('#ed-geom', body).textContent = `${conns} connector${conns === 1 ? '' : 's'} · ${fmt(v.length)} mm of track · ${geomSummary(def)}${comp.symmetric ? '' : ' · has left and right versions'}`;
          } catch (err) {
            $('#ed-preview', body).innerHTML = '';
            $('#ed-geom', body).textContent = err.message.startsWith('Unexpected') || err.message.includes('JSON') ? 'The JSON is not valid yet.' : err.message;
          }
        };
        body.addEventListener('input', (e) => {
          if (e.target.id === 'ed-tmpl') return;
          refresh();
        });
        $('#ed-tmpl', body).addEventListener('change', () => {
          if ($('#ed-tmpl', body).value === 'json' && st.template !== 'json') {
            try { $('#ed-json', body).value = JSON.stringify(buildDefFrom({ template: st.template, params: st.params }), null, 1); } catch { /* keep */ }
          } else if ($('#ed-tmpl', body).value !== 'json') st.template = $('#ed-tmpl', body).value;
          renderParams();
        });
        $('#ed-cancel', body).onclick = () => openSheet('library');
        $('#ed-save', body).onclick = () => {
          let built;
          try { built = buildDef(); } catch (err) { toast(err.message.includes('JSON') ? 'Fix the JSON before saving' : err.message); return; }
          const name = $('#ed-name', body).value.trim() || 'Custom piece';
          const t = $('#ed-tmpl', body).value;
          const def = {
            id: existing ? existing.id : 'c-' + uid(), name, builtin: false,
            color: $('#ed-color', body).value, slack: Math.max(0, parseFloat($('#ed-slack', body).value) || 0),
            notes: $('#ed-notes', body).value.trim(), template: t, params: t === 'json' ? undefined : { ...st.params },
            paths: built.paths, symmetric: built.symmetric,
          };
          if (existing) {
            const used = ws.layout.pieces.filter((p) => p.type === def.id);
            const oldN = G.compile(existing).normal.conns.length, newN = G.compile(def).normal.conns.length;
            Object.assign(existing, def);
            if (oldN !== newN) used.forEach((p) => { p.entry = 0; });
          } else ws.lib.custom.push(def);
          ws.lib.inventory[def.id] = Math.max(0, parseInt($('#ed-count', body).value, 10) || 0);
          DEFS = defsMap();
          changed();
          toast(`Saved ${name}`);
          openSheet('library');
        };
        if (existing) {
          $('#ed-del', body).onclick = () => {
            const used = ws.layout.pieces.filter((p) => p.type === existing.id).length;
            $('#ed-confirm', body).innerHTML = `<div class="confirm"><span>${used ? `Delete it and remove the ${used} placed in this layout?` : 'Delete this piece?'}</span>
              <button class="btn danger small" type="button" id="ed-del-yes">Delete</button><button class="btn small" type="button" id="ed-del-no">Keep</button></div>`;
            $('#ed-del-no', body).onclick = () => { $('#ed-confirm', body).innerHTML = ''; };
            $('#ed-del-yes', body).onclick = () => {
              if (used) { pushUndo(); ws.layout.pieces = ws.layout.pieces.filter((p) => p.type !== existing.id); }
              ws.lib.custom = ws.lib.custom.filter((d) => d.id !== existing.id);
              delete ws.lib.inventory[existing.id]; delete ws.lib.hidden[existing.id];
              DEFS = defsMap(); changed();
              openSheet('library');
            };
          };
        }
        if (st.template === 'json') $('#ed-json', body).value = st.json;
        renderParams();
      },
    };
  };

  /* ---------- tolerance & settings ---------- */
  const PRESETS = {
    strict: { gap: 1, lateral: 1, angle: 0.5, label: 'Strict', note: 'Like CAD: only near-perfect joints count' },
    typical: { gap: 4, lateral: 4, angle: 3, label: 'Typical', note: 'New light-grey track on a hard floor' },
    loose: { gap: 8, lateral: 8, angle: 5, label: 'Loose', note: 'Older track, carpet, or a bit of pushing' },
  };
  SHEETS.settings = () => {
    const s = ws.settings;
    const slider = (id, label, min, max, step, val, unit) => `<div class="field"><label for="${id}">${label}</label>
      <div class="slider-row"><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}" aria-label="${label}">
      <input type="number" id="${id}-n" min="${min}" max="${max * 3}" step="${step}" value="${val}" aria-label="${label} (${unit})"></div></div>`;
    return {
      title: 'Fit tolerance',
      html: `<p class="hint">Duplo joints have play. Two ends count as joined when they are within all three limits below.</p>
        <div class="seg" role="group" aria-label="Presets">${Object.entries(PRESETS).map(([k, p]) => `<button type="button" data-preset="${k}" title="${esc(p.note)}">${p.label}</button>`).join('')}</div>
        ${slider('t-gap', 'Gap or squeeze along the track (mm)', 0, 15, 0.5, s.gap, 'mm')}
        ${slider('t-lat', 'Sideways offset (mm)', 0, 15, 0.5, s.lateral, 'mm')}
        ${slider('t-ang', 'Angle (°)', 0, 10, 0.5, s.angle, 'degrees')}
        <div class="group"><h3>Loop flex</h3>
          <p class="hint">When a loop closes, every joint around it can give a little. This decides how much of that combined give the closing joint may use.</p>
          <div class="seg" role="group" aria-label="Loop flex">
            <button type="button" data-flex="none" aria-pressed="${s.flex === 'none'}">Off</button>
            <button type="button" data-flex="sqrt" aria-pressed="${s.flex === 'sqrt'}">Gentle (√ joints)</button>
            <button type="button" data-flex="linear" aria-pressed="${s.flex === 'linear'}">Generous (× joints)</button>
          </div>
          <p class="hint">Example: a loop of 16 joints with Gentle flex allows 4× the single-joint limits at the closing joint.</p></div>
        <div class="group"><h3>Editing</h3>
          <div class="field"><span class="flabel">Rotate step</span><div class="seg" role="group" aria-label="Rotate step">${[5, 15, 30, 90].map((d) => `<button type="button" data-rot="${d}" aria-pressed="${s.rotStep === d}">${d}°</button>`).join('')}</div></div>
          <label class="check"><input type="checkbox" id="s-grid" ${s.grid ? 'checked' : ''}> Show stud grid (16 mm)</label>
          <label class="check"><input type="checkbox" id="s-ovl" ${s.overlaps ? 'checked' : ''}> Warn when track crosses over itself</label></div>`,
      mount(body) {
        const pairs = [['t-gap', 'gap'], ['t-lat', 'lateral'], ['t-ang', 'angle']];
        const sync = () => {
          pairs.forEach(([id, k]) => { $('#' + id, body).value = ws.settings[k]; $('#' + id + '-n', body).value = ws.settings[k]; });
          $$('[data-preset]', body).forEach((b) => {
            const p = PRESETS[b.dataset.preset];
            b.setAttribute('aria-pressed', String(p.gap === +ws.settings.gap && p.lateral === +ws.settings.lateral && p.angle === +ws.settings.angle));
          });
        };
        body.addEventListener('input', (e) => {
          const pr = pairs.find(([id]) => e.target.id === id || e.target.id === id + '-n');
          if (pr) {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v) && v >= 0) { ws.settings[pr[1]] = v; changed({ keepSel: true }); render(); renderStatus(); }
            if (e.target.type === 'range') $('#' + pr[0] + '-n', body).value = e.target.value;
            else $('#' + pr[0], body).value = e.target.value;
            $$('[data-preset]', body).forEach((b) => b.setAttribute('aria-pressed', 'false'));
          }
        });
        body.addEventListener('change', (e) => {
          if (e.target.id === 's-grid') ws.settings.grid = e.target.checked;
          if (e.target.id === 's-ovl') ws.settings.overlaps = e.target.checked;
          changed({ keepSel: true }); render(); renderStatus();
        });
        body.addEventListener('click', (e) => {
          const p = e.target.closest('[data-preset]');
          if (p) { Object.assign(ws.settings, { gap: PRESETS[p.dataset.preset].gap, lateral: PRESETS[p.dataset.preset].lateral, angle: PRESETS[p.dataset.preset].angle }); }
          const f = e.target.closest('[data-flex]');
          if (f) { ws.settings.flex = f.dataset.flex; $$('[data-flex]', body).forEach((b) => b.setAttribute('aria-pressed', String(b === f))); }
          const r = e.target.closest('[data-rot]');
          if (r) { ws.settings.rotStep = +r.dataset.rot; $$('[data-rot]', body).forEach((b) => b.setAttribute('aria-pressed', String(b === r))); }
          if (p || f || r) { sync(); changed({ keepSel: true }); render(); renderStatus(); }
        });
        sync();
      },
    };
  };

  /* ---------- gap solver ---------- */
  function hops(A, from, to) {
    if (from === to) return 0;
    const seen = new Set([from]);
    let frontier = [from], d = 0;
    while (frontier.length) {
      d++;
      const next = [];
      for (const u of frontier) for (const v of A.adj.get(u) || []) {
        if (v === to) return d;
        if (!seen.has(v)) { seen.add(v); next.push(v); }
      }
      frontier = next;
    }
    return Infinity;
  }
  const solverState = { maxDepth: 10, types: null };
  SHEETS.solver = () => {
    const A = an();
    const node = A.byUid.get(sel.uid);
    const from = node.conns[sel.idx];
    const targets = A.conns.filter((c) => !isJoined(c) && !(c.uid === from.uid && c.idx === from.idx))
      .map((c) => ({ c, d: Math.hypot(c.x - from.x, c.y - from.y) })).sort((a, b) => a.d - b.d).slice(0, 8);
    const solvable = allTypes().filter((t) => {
      const def = D()[t];
      return def.paths.length === 1 && G.compile(def).normal.conns.length === 2;
    });
    if (!solverState.types) solverState.types = new Set(solvable.filter((t) => !ws.lib.hidden[t]));
    if (!targets.length) {
      return { title: 'Close a gap', html: '<p>There are no other open ends to join to. Add more track first, or start a second run of track to meet this one.</p>' };
    }
    return {
      title: 'Close a gap',
      html: `<p class="hint">Finds runs of pieces from the selected end to another open end that fit within your tolerance.</p>
        <div class="group"><h3>Join to</h3>
          ${targets.map((t, i) => `<label class="check"><input type="radio" name="sv-target" value="${i}" ${i === 0 ? 'checked' : ''}> ${fmt(t.d / 10, 1)} cm away${t.c.uid === from.uid ? ' (same piece)' : ''}${t.c.state === 'miss' ? ' · currently a near miss' : ''}</label>`).join('')}
        </div>
        <div class="group"><h3>Use</h3>
          ${solvable.map((t) => `<label class="check"><input type="checkbox" data-sv-type="${esc(t)}" ${solverState.types.has(t) ? 'checked' : ''}> ${esc(D()[t].name)}</label>`).join('')}
          <label class="check"><input type="checkbox" id="sv-owned" ${ws.lib.unlimited ? '' : 'checked'}> Only pieces I still have</label>
        </div>
        <div class="field"><label for="sv-depth">Most pieces to add: <span id="sv-depth-v">${solverState.maxDepth}</span></label>
          <input type="range" id="sv-depth" min="2" max="14" value="${solverState.maxDepth}" style="accent-color:var(--accent)"></div>
        <div class="row"><button class="btn primary" type="button" id="sv-go">Find ways to join</button></div>
        <div class="solutions" id="sv-results"></div>`,
      mount(body) {
        body.addEventListener('input', (e) => { if (e.target.id === 'sv-depth') { solverState.maxDepth = +e.target.value; $('#sv-depth-v', body).textContent = e.target.value; } });
        body.addEventListener('change', (e) => {
          const t = e.target.dataset.svType;
          if (t) { if (e.target.checked) solverState.types.add(t); else solverState.types.delete(t); }
        });
        let found = [];
        $('#sv-go', body).onclick = () => {
          const target = targets[+(body.querySelector('[name="sv-target"]:checked') || { value: 0 }).value].c;
          const moves = G.solverMoves(D(), [...solverState.types]);
          if (!moves.length) { $('#sv-results', body).innerHTML = '<p>Pick at least one piece type to use.</p>'; return; }
          const onlyOwned = $('#sv-owned', body).checked;
          const u = usage();
          const budget = {};
          if (onlyOwned) for (const t of solverState.types) budget[t] = Math.max(0, owned(t) - (u[t] || 0));
          const k = hops(A, from.uid, target.uid);
          const t = tol();
          if (!Number.isFinite(k)) t.flex = 'none';
          $('#sv-results', body).innerHTML = '<p class="hint">Searching…</p>';
          setTimeout(() => {
            const res = G.solveGap(from, target, { moves, maxDepth: solverState.maxDepth, tol: t, budget, loopJoints: Number.isFinite(k) ? k : 0, limit: 8 });
            found = res.results;
            if (!found.length) {
              $('#sv-results', body).innerHTML = `<p>No run of up to ${solverState.maxDepth} pieces fits${onlyOwned ? ' with the pieces you have left' : ''}. Try more pieces, more piece types, a looser tolerance, or a 3D-printed adapter piece.</p>`;
              return;
            }
            $('#sv-results', body).innerHTML = found.map((r, i) => {
              const runs = [];
              r.steps.forEach((s) => {
                const name = handName(D()[s.type], s.mirror);
                const last = runs[runs.length - 1];
                if (last && last.name === name) last.n++; else runs.push({ name, n: 1 });
              });
              return `<div class="solution"><div><div class="seq">${runs.map((x) => `<span class="tok">${esc(x.name)}${x.n > 1 ? ' ×' + x.n : ''}</span>`).join('')}</div>
                <div class="err">${r.steps.length} piece${r.steps.length > 1 ? 's' : ''} · closes to ${fmt(Math.abs(r.err.along))} mm along, ${fmt(Math.abs(r.err.lateral))} mm sideways, ${fmt(Math.abs(r.err.angle))}°</div></div>
                <button class="btn small primary" type="button" data-use="${i}">Use</button></div>`;
            }).join('') + (res.capped ? '<p class="hint">Search stopped early. Fewer piece types or a lower maximum gives a complete search.</p>' : '');
          }, 30);
        };
        body.addEventListener('click', (e) => {
          const b = e.target.closest('[data-use]');
          if (!b) return;
          const r = found[+b.dataset.use];
          pushUndo();
          let end = { x: from.x, y: from.y, h: from.h };
          for (const s of r.steps) {
            const comp = G.compile(D()[s.type]);
            const v = s.mirror && !comp.symmetric ? comp.mirrored : comp.normal;
            const inst = { uid: uid(), type: s.type, mirror: s.mirror && !comp.symmetric, entry: 0, ...G.placeAgainst(v, 0, end) };
            ws.layout.pieces.push(inst);
            end = G.toWorld(inst, v.conns[v.next[0]]);
          }
          sel = NONE;
          changed();
          sheet.hidden = true;
          update();
          toast(`Added ${r.steps.length} pieces`, { label: 'Undo', fn: undo });
        });
      },
    };
  };

  /* ---------- layouts ---------- */
  function exportObject() {
    const used = new Set(ws.layout.pieces.map((p) => p.type));
    return {
      format: 'duplo-track-planner', version: 1, exported: new Date().toISOString(),
      layout: { name: ws.layout.name, pieces: ws.layout.pieces },
      custom: ws.lib.custom.filter((d) => used.has(d.id)),
    };
  }
  function importObject(obj) {
    if (!obj || obj.format !== 'duplo-track-planner' || !obj.layout || !Array.isArray(obj.layout.pieces)) throw new Error('This is not a Duplo Track Planner file.');
    for (const d of obj.custom || []) if (!ws.lib.custom.some((x) => x.id === d.id)) { ws.lib.custom.push(d); ws.lib.inventory[d.id] = ws.lib.inventory[d.id] ?? 0; }
    DEFS = defsMap();
    const missing = obj.layout.pieces.filter((p) => !DEFS[p.type]);
    pushUndo();
    ws.layout = { name: obj.layout.name || 'Imported layout', pieces: obj.layout.pieces.filter((p) => DEFS[p.type]) };
    sel = NONE; changed(); fit(); update();
    return missing.length;
  }
  // Light palette for print, whatever theme the screen is in.
  const PRINT_COLOURS = {
    floor: '#FFFFFF', grid: 'transparent', gridMajor: 'transparent', panel: '#FBFCFA', ink: '#1C2620', muted: '#5A665E',
    track: '#A9B0B5', edge: '#6E777D', rail: '#848C92', custom: '#E3873A', bridge: '#C9A24B', plate: '#D8CFAE', accent: '#1E5BB8',
    accentSoft: 'rgba(30,91,184,0.12)', ok: '#2F8F57', warn: '#C98400', bad: '#CC2236', badSoft: 'rgba(204,34,54,0.14)',
  };
  function renderCanvas(light) {
    const b = layoutBounds(ws.layout.pieces);
    if (!b) return null;
    const w = b.maxX - b.minX, h = b.maxY - b.minY;
    const s = Math.min(2400 / w, 2400 / h, 2);
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * s); c.height = Math.ceil(h * s);
    const x = c.getContext('2d');
    const saved = C;
    if (light) C = PRINT_COLOURS;
    try {
      x.fillStyle = C.floor; x.fillRect(0, 0, c.width, c.height);
      x.setTransform(s, 0, 0, s, -b.minX * s, -b.minY * s);
      drawLayout(x, s, an(), { export: true });
    } finally { C = saved; }
    return { canvas: c, widthMm: w, heightMm: h };
  }
  function renderPNG() {
    const r = renderCanvas(false);
    return r && r.canvas.toDataURL('image/png');
  }

  /* Minimal PDF writer: one page with a JPEG of the layout, a title and a piece list.
     Hand-rolled so the app stays dependency-free. */
  function renderPDF() {
    const r = renderCanvas(true);
    if (!r) return null;
    const jpeg = Uint8Array.from(atob(r.canvas.toDataURL('image/jpeg', 0.92).split(',')[1]), (ch) => ch.charCodeAt(0));
    const landscape = r.widthMm >= r.heightMm;
    const PW = landscape ? 841.89 : 595.28, PH = landscape ? 595.28 : 841.89, M = 36;
    const used = usage();
    const listText = Object.keys(used).map((t) => `${used[t]} x ${D()[t] ? D()[t].name : t}`).join(', ');
    const total = ws.layout.pieces.length;
    const pdfText = (s) => String(s).replace(/[()\\]/g, (m) => '\\' + m).replace(/[^\x20-\x7E]/g, '?');
    const FS = 9, perLine = Math.floor((PW - 2 * M) / (FS * 0.5));
    const lines = [];
    for (let rest = `Pieces (${total}): ${listText}`; rest.length;) {
      let cut = rest.length <= perLine ? rest.length : rest.lastIndexOf(' ', perLine);
      if (cut <= 0) cut = Math.min(perLine, rest.length);
      lines.push(rest.slice(0, cut).trim()); rest = rest.slice(cut).trim();
    }
    const footH = 24 + lines.length * (FS + 3);
    const boxW = PW - 2 * M, boxH = PH - 2 * M - 30 - footH;
    const k = Math.min(boxW / r.widthMm, boxH / r.heightMm);
    const dw = r.widthMm * k, dh = r.heightMm * k;
    const ix = (PW - dw) / 2, iy = M + footH + (boxH - dh) / 2;
    const scale = Math.max(1, Math.round(r.widthMm / (dw * 25.4 / 72)));
    const name = pdfText(ws.layout.name || 'Duplo layout');
    let content = `BT /F1 16 Tf ${M} ${PH - M - 14} Td (${name}) Tj ET\n` +
      `BT /F1 9 Tf ${M} ${PH - M - 28} Td (Scale about 1:${scale}  |  ${Math.round(r.widthMm)} x ${Math.round(r.heightMm)} mm  |  Duplo Track Planner) Tj ET\n` +
      `q ${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${ix.toFixed(2)} ${iy.toFixed(2)} cm /Im0 Do Q\n`;
    lines.forEach((ln, i) => { content += `BT /F1 ${FS} Tf ${M} ${(M + footH - 14 - i * (FS + 3)).toFixed(1)} Td (${pdfText(ln)}) Tj ET\n`; });
    const enc = new TextEncoder();
    const chunks = [];
    let len = 0;
    const offsets = [];
    const put = (d) => { const u = typeof d === 'string' ? enc.encode(d) : d; chunks.push(u); len += u.length; };
    const obj = (n, body, stream) => {
      offsets[n] = len;
      put(`${n} 0 obj\n${body}\n`);
      if (stream) { put('stream\n'); put(stream); put('\nendstream\n'); }
      put('endobj\n');
    };
    put('%PDF-1.4\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 4 0 R >> /XObject << /Im0 5 0 R >> >> /Contents 6 0 R >>`);
    obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    obj(5, `<< /Type /XObject /Subtype /Image /Width ${r.canvas.width} /Height ${r.canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
    const cbytes = enc.encode(content);
    obj(6, `<< /Length ${cbytes.length} >>`, cbytes);
    const xref = len;
    put(`xref\n0 7\n0000000000 65535 f \n${[1, 2, 3, 4, 5, 6].map((n) => String(offsets[n]).padStart(10, '0') + ' 00000 n \n').join('')}`);
    put(`trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(chunks, { type: 'application/pdf' });
  }
  function download(name, href) {
    const a = document.createElement('a');
    a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }
  // Inside an embedded preview, browsers block file downloads; offer copy/picture instead.
  const framed = (() => { try { return window.self !== window.top; } catch { return true; } })();
  const slug = (s) => (s || 'layout').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'layout';

  SHEETS.layouts = () => ({
    title: 'Layouts',
    html: `<div class="field"><label for="ly-name">This layout's name</label><input type="text" id="ly-name" value="${esc(ws.layout.name)}"></div>
      <div class="row"><button class="btn primary" type="button" id="ly-save">Save</button><button class="btn" type="button" id="ly-new">New blank layout</button></div>
      <p class="storage-note">${Store.server ? 'Saved layouts live on <b>your server</b>.' : 'Saved layouts live in <b>this browser only</b>.'}</p>
      <div class="group"><h3>Saved layouts</h3><div class="list" id="ly-list"><div class="list-row"><div></div><div class="info"><span>Loading…</span></div><span></span></div></div></div>
      <div class="group"><h3>Share and back up</h3>
        <div class="row">${framed ? '' : '<button class="btn" type="button" id="ly-json">Download file</button>'}<button class="btn" type="button" id="ly-copy">Copy as text</button><button class="btn" type="button" id="ly-png">Picture (PNG)</button><button class="btn" type="button" id="ly-pdf">PDF</button></div>
        <div id="ly-out"></div>
        <div class="field"><label for="ly-file">Open a layout file</label><input type="file" id="ly-file" accept="application/json,.json"></div>
        <div class="field"><label for="ly-paste">Or paste layout text</label><textarea id="ly-paste" placeholder='{"format":"duplo-track-planner", …}'></textarea></div>
        <div class="row"><button class="btn" type="button" id="ly-import">Open pasted layout</button></div></div>`,
    mount(body) {
      const list = $('#ly-list', body);
      const loadList = async () => {
        try {
          const items = await Store.listLayouts();
          list.innerHTML = items.length ? items.map((l) => `<div class="list-row" style="grid-template-columns:1fr auto">
            <div class="info"><strong>${esc(l.name)}</strong><span>${l.pieces ?? '?'} pieces · ${l.updated ? new Date(l.updated).toLocaleString() : ''}</span></div>
            <div class="row" style="gap:6px"><button class="btn small" type="button" data-open="${esc(l.name)}">Open</button><button class="btn small danger" type="button" data-del="${esc(l.name)}">Delete</button></div></div>`).join('')
            : '<div class="list-row" style="grid-template-columns:1fr"><div class="info"><span>Nothing saved yet.</span></div></div>';
        } catch { list.innerHTML = '<div class="list-row" style="grid-template-columns:1fr"><div class="info"><span>Could not load saved layouts from the server.</span></div></div>'; }
      };
      loadList();
      $('#ly-name', body).addEventListener('input', (e) => { ws.layout.name = e.target.value; changed({ keepSel: true }); $('#layoutNameBtn').textContent = ws.layout.name || 'Untitled layout'; });
      $('#ly-save', body).onclick = async () => {
        const name = (ws.layout.name || '').trim() || 'Untitled layout';
        ws.layout.name = name;
        try { await Store.putLayout(name, exportObject()); toast(`Saved “${name}”`); loadList(); } catch { toast('Could not save. Check the server is running.'); }
      };
      $('#ly-new', body).onclick = () => {
        pushUndo();
        ws.layout = { name: 'Untitled layout', pieces: [] };
        sel = NONE; changed(); view.cx = 0; view.cy = 0; view.s = 0.5;
        closeSheet(); toast('Started a blank layout', { label: 'Undo', fn: undo });
      };
      body.addEventListener('click', async (e) => {
        const o = e.target.closest('[data-open]');
        if (o) {
          try { importObject(await Store.getLayout(o.dataset.open)); closeSheet(); toast(`Opened “${o.dataset.open}”`); } catch (err) { toast(err.message || 'Could not open that layout'); }
        }
        const d = e.target.closest('[data-del]');
        if (d) {
          const row = d.closest('.list-row');
          if (row.querySelector('.confirm')) return;
          const cf = document.createElement('div');
          cf.className = 'confirm'; cf.style.gridColumn = '1 / -1';
          cf.innerHTML = `<span>Delete “${esc(d.dataset.del)}”?</span><button class="btn danger small" type="button" data-del-yes>Delete</button><button class="btn small" type="button" data-del-no>Keep</button>`;
          row.appendChild(cf);
          cf.querySelector('[data-del-no]').onclick = () => cf.remove();
          cf.querySelector('[data-del-yes]').onclick = async () => { try { await Store.delLayout(d.dataset.del); loadList(); } catch { toast('Could not delete'); } };
        }
      });
      if ($('#ly-json', body)) $('#ly-json', body).onclick = () => {
        const blob = new Blob([JSON.stringify(exportObject(), null, 1)], { type: 'application/json' });
        download(slug(ws.layout.name) + '.json', URL.createObjectURL(blob));
      };
      $('#ly-copy', body).onclick = async () => {
        const text = JSON.stringify(exportObject());
        try { await navigator.clipboard.writeText(text); toast('Layout copied'); }
        catch { $('#ly-out', body).innerHTML = `<div class="field"><label for="ly-copytext">Select and copy this text</label><textarea id="ly-copytext" readonly>${esc(text)}</textarea></div>`; $('#ly-copytext', body).select(); }
      };
      $('#ly-png', body).onclick = () => {
        const url = renderPNG();
        if (!url) { toast('Nothing to draw yet'); return; }
        $('#ly-out', body).innerHTML = `<p class="hint">Long-press or right-click the picture to save it.</p><img src="${url}" alt="Picture of ${esc(ws.layout.name)}" style="border-radius:12px;border:1px solid var(--line)">`;
        if (!framed) download(slug(ws.layout.name) + '.png', url);
      };
      $('#ly-pdf', body).onclick = () => {
        const blob = renderPDF();
        if (!blob) { toast('Nothing to draw yet'); return; }
        const url = URL.createObjectURL(blob), file = slug(ws.layout.name) + '.pdf';
        if (framed) $('#ly-out', body).innerHTML = `<p class="hint"><a href="${url}" target="_blank" rel="noopener">Open the PDF</a></p>`;
        else { download(file, url); toast('PDF saved'); }
      };
      $('#ly-file', body).onchange = async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try { const n = importObject(JSON.parse(await f.text())); closeSheet(); toast(n ? `Opened, but ${n} pieces use unknown types and were skipped` : 'Layout opened'); }
        catch (err) { toast(err.message.includes('JSON') ? 'That file is not valid layout JSON' : err.message); }
      };
      $('#ly-import', body).onclick = () => {
        try { const n = importObject(JSON.parse($('#ly-paste', body).value)); closeSheet(); toast(n ? `Opened, but ${n} pieces were skipped` : 'Layout opened'); }
        catch (err) { toast(err.message.includes('JSON') ? 'That text is not valid layout JSON' : err.message); }
      };
    },
  });

  SHEETS.help = () => ({
    title: 'How it works',
    html: `<div class="group"><h3>Building</h3>
      <p>Tap an open end <span class="kbd">○</span> to select it, then tap pieces in the tray to lay track from there. Each new piece selects its far end, so you can keep tapping.</p>
      <p>Curves and other handed pieces show <span class="kbd">L</span> and <span class="kbd">R</span> versions. Tap a placed piece to rotate, flip, turn it round or delete it. With a piece selected, tapping the tray swaps it, and the track beyond it follows.</p>
      <p>Drag a selected piece to move its whole connected section. Let go near an open end and it snaps on. Pinch or scroll to zoom; drag empty floor to pan.</p></div>
      <div class="group"><h3>Checks</h3>
      <p><strong style="color:var(--ok)">Joints fit</strong> are within your tolerance. <strong style="color:var(--warn)">Fit with flex</strong> closes a loop by sharing the error across the joints in that loop. <strong style="color:var(--bad)">Gaps</strong> are near misses, labelled with the distance and angle. Overlaps mark track that crosses itself without a crossing piece.</p>
      <p><strong>Close a gap</strong> searches for runs of straights and curves (and your own pieces) that join two open ends.</p></div>
      <div class="group"><h3>Your own pieces</h3>
      <p>Add 3D-printed pieces in the piece library by shape: straight, curve, Y switch, turnout, crossing, S-curve or dead end, or describe any shape as JSON paths. Give each its own colour and extra joint play if your prints fit looser than LEGO's.</p></div>
      <div class="group"><h3>Keyboard</h3>
      <p><span class="kbd">Ctrl Z</span> undo, <span class="kbd">Ctrl Y</span> redo, <span class="kbd">R</span>/<span class="kbd">Shift R</span> rotate, <span class="kbd">F</span> flip, <span class="kbd">T</span> turn round, <span class="kbd">Delete</span> remove, <span class="kbd">0</span> fit to screen, <span class="kbd">Esc</span> deselect.</p></div>`,
  });

  /* ======================= top bar & keys ======================= */
  $('#undoBtn').onclick = undo;
  $('#redoBtn').onclick = redo;
  $('#fitBtn').onclick = fit;
  $('#menuBtn').onclick = () => openSheet('menu');
  $('#layoutNameBtn').onclick = () => openSheet('layouts');
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select')) return;
    if (!sheet.hidden) { if (e.key === 'Escape') closeSheet(); return; }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (e.key === 'Escape') { sel = NONE; update(); }
    if (e.key === '0') fit();
    if (sel.kind === 'piece') {
      const inst = findInst(sel.uid);
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deletePiece(sel.uid); }
      if (e.key.toLowerCase() === 'r') rotateGroup(sel.uid, (e.shiftKey ? -1 : 1) * ws.settings.rotStep);
      if (e.key.toLowerCase() === 'f') mutatePiece(sel.uid, { mirror: !inst.mirror });
      if (e.key.toLowerCase() === 't') mutatePiece(sel.uid, { entry: (inst.entry || 0) + 1 });
    }
  });

  /* ======================= boot ======================= */
  function normalise(w) {
    const base = freshWorkspace();
    if (!w || typeof w !== 'object') return null;
    return {
      settings: { ...base.settings, ...(w.settings || {}) },
      lib: {
        custom: Array.isArray(w.lib && w.lib.custom) ? w.lib.custom : [],
        inventory: { ...base.lib.inventory, ...((w.lib && w.lib.inventory) || {}) },
        hidden: (w.lib && w.lib.hidden) || base.lib.hidden,
        unlimited: !!(w.lib && w.lib.unlimited),
        sets: Array.isArray(w.lib && w.lib.sets) ? w.lib.sets : [],
      },
      layout: w.layout && Array.isArray(w.layout.pieces) ? w.layout : base.layout,
    };
  }

  async function boot() {
    readColours();
    await Store.init();
    const saved = normalise(await Store.loadWorkspace());
    ws = saved || freshWorkspace();
    DEFS = defsMap();
    ws.layout.pieces = ws.layout.pieces.filter((p) => DEFS[p.type]);
    if (!saved) ws.layout = exampleLayout();
    resize();
    fit();
    update();
    if (!saved) toast('Example oval. Enter the pieces you own to start planning.', { label: 'My pieces', fn: () => openSheet('inventory') });
  }
  window.__duploPlanner = { get ws() { return ws; }, an: () => an(), view, toScreen, get sel() { return sel; } };
  boot();
})();
