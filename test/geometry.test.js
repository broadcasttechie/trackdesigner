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
