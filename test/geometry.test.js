// Run with: node test/geometry.test.js
const assert = require('assert');
const G = require('../public/geometry.js');
const defs = Object.fromEntries(G.BUILTIN.map((d) => [d.id, d]));
const tol = { gap: 4, lateral: 4, angle: 3, flex: 'sqrt', overlaps: true };

function chain(seq) {
  const pieces = [];
  let end = { x: 0, y: 0, h: 0 }; // outward heading of the (imaginary) neighbour: track runs towards +x
  seq.forEach(([type, mirror], i) => {
    const comp = G.compile(defs[type]);
    const v = mirror ? comp.mirrored : comp.normal;
    const inst = { uid: 'p' + i, type, mirror, ...G.placeAgainst(v, 0, end) };
    pieces.push(inst);
    end = G.toWorld(inst, v.conns[v.next[0]]);
  });
  return { pieces, end };
}
const C = ['duplo-curve', false], CL = ['duplo-curve', true], S = ['duplo-straight', false];

let r = chain(Array(12).fill(C));
let a = G.analyse(r.pieces, defs, tol);
assert.strictEqual(a.joints.filter((j) => j.kind === 'ok').length, 12, '12 curves close a circle');
assert.strictEqual(a.open.length, 0);

r = chain([C, CL, CL, C]);
assert.ok(Math.abs(r.end.x - 512) < 1e-6 && Math.abs(r.end.y) < 1e-6, 'S of 4 curves equals 4 straights');

r = chain([...Array(6).fill(C), S, S, ...Array(6).fill(C), S, S]);
a = G.analyse(r.pieces, defs, tol);
assert.strictEqual(a.open.length, 0, 'oval closes');
assert.strictEqual(a.overlaps.length, 0, 'oval has no overlaps');

r = chain(Array(12).fill(['duplo-curve-old', false]));
a = G.analyse(r.pieces, defs, { ...tol, flex: 'none' });
assert.ok(a.joints.some((j) => j.kind === 'miss'), 'older curves overlap when forced into a circle');

r = chain(Array(6).fill(C));
a = G.analyse(r.pieces, defs, tol);
const start = a.byUid.get('p0').conns[0];
const res = G.solveGap(r.end, start, { moves: G.solverMoves(defs, ['duplo-straight', 'duplo-curve']), maxDepth: 8, tol, budget: {}, loopJoints: 6, limit: 5 });
assert.ok(res.results.length > 0 && res.results[0].steps.length === 6, 'solver closes a semicircle with 6 curves');
console.log('geometry tests passed');

const Sets = require('../public/sets.js');
assert.ok(Sets.find('10872') && Sets.find(' 10872 '), 'set lookup trims input');
assert.strictEqual(Sets.find('99999'), undefined, 'unknown set is not found');
for (const s of Sets.SETS) for (const t of Object.keys(s.pieces)) assert.ok(defs[t], `set ${s.id} uses known piece ${t}`);
console.log('set tests passed');

// Bridges may cross over other track, but not run along it or cross another bridge.
{
  const bd = { ...defs, 'duplo-bridge': G.BUILTIN.find((d) => d.id === 'duplo-bridge') };
  const base = { uid: 'a', type: 'duplo-straight', x: 0, y: 0, rot: 0, mirror: false };
  const at = (type, rot) => ({ uid: 'b', type, x: 64, y: 64, rot, mirror: false });
  const run = (extra) => G.analyse([base, extra], bd, tol);
  let res = run(at('duplo-bridge', -90));
  assert.strictEqual(res.overlaps.length, 0, 'bridge crossing at 90° is not an overlap');
  assert.strictEqual(res.crossovers.length, 1, 'bridge crossing is recorded as a crossover');
  assert.strictEqual(run(at('duplo-straight', -90)).overlaps.length, 1, 'ordinary straight crossing still overlaps');
  assert.strictEqual(run({ ...at('duplo-bridge', 0), y: 10 }).overlaps.length, 1, 'bridge lying along track overlaps');
  const twoBridges = G.analyse([{ ...base, type: 'duplo-bridge' }, at('duplo-bridge', -90)], bd, tol);
  assert.strictEqual(twoBridges.overlaps.length, 1, 'bridge over bridge overlaps');
}
console.log('bridge tests passed');

{
  const arch = G.BUILTIN.find((d) => d.id === 'duplo-bridge-arch'), end = G.BUILTIN.find((d) => d.id === 'duplo-bridge-end');
  const d2 = { ...defs, [arch.id]: arch, [end.id]: end };
  const cross = { uid: 'x', type: 'duplo-straight', x: 96, y: 0, rot: 0, mirror: false };
  const over = (type) => G.analyse([cross, { uid: 'y', type, x: 192, y: -96, rot: 90, mirror: false }], d2, tol);
  assert.strictEqual(over('duplo-bridge-arch').crossovers.length, 1, 'bridge arch crosses over track');
  assert.strictEqual(over('duplo-bridge-end').overlaps.length, 1, 'bridge end is on the ground');
}
console.log('bridge section tests passed');

for (const id of ['duplo-plate-side', 'duplo-plate-both', 'duplo-ramp', 'duplo-crossing-90']) {
  const d = G.BUILTIN.find((x) => x.id === id);
  assert.ok(d && G.compile(d).normal.conns.length >= 2, id + ' compiles with connectors');
}
const x90 = G.compile(G.BUILTIN.find((d) => d.id === 'duplo-crossing-90')).normal;
assert.strictEqual(x90.conns.length, 4, '90° crossing has four ends');
console.log('plate/ramp tests passed');
