/*
 * Duplo set catalogue: which track pieces each set contains, as counts of
 * built-in piece ids. Counts come from Brickset set inventories (element
 * numbers 6207494 straight, 6207493 curve, 6207508 points, 6207496 crossing,
 * 6219464 rail stop). Bridges are modelled as a raised straight. Parts the planner has no geometry for are listed in
 * `extra` so the owner knows they were not added to the inventory.
 */
(function (root) {
  'use strict';

  const SETS = [
    {
      id: '10872', name: 'Train Bridge and Tracks',
      pieces: { 'duplo-straight': 8, 'duplo-bridge-end': 2, 'duplo-bridge-arch': 2 },
      extra: 'The 2 lower bridge parts (35136) are bridge ends and the 2 upper parts (35138) are bridge arches. Their lengths are estimates.',
    },
    {
      id: '10882', name: 'Train Tracks',
      pieces: { 'duplo-curve': 10, 'duplo-straight': 1, 'duplo-level-crossing': 1, 'duplo-switch': 2, 'duplo-buffer': 2 },
      extra: 'The "crossing" (6207496) is design 6391, the level crossing with car ramps, not the X crossover.',
    },
    {
      id: '10875', name: 'Cargo Train',
      pieces: { 'duplo-curve': 14, 'duplo-straight': 2, 'duplo-level-crossing': 1, 'duplo-switch': 2, 'duplo-buffer': 2, 'duplo-plate-side': 1, 'duplo-ramp': 2 },
      extra: 'The "crossing" (6207496) is design 6391, the level crossing with car ramps. The 2 inverted 16-module bow rails (6219647) are design 35966, the ramp. The 5 coloured rail accessories are not track.',
    },
    {
      id: '10426', name: 'Railway Bridge and Tracks',
      pieces: { 'duplo-straight': 8, 'duplo-bridge-end': 2, 'duplo-bridge-arch': 2, 'duplo-plate-both': 1 },
      extra: 'The 2 lower bridge parts (5086) are bridge ends and the 2 upper parts (5087) are bridge arches, plus 1 straight with two side plates (6481090). Bridge lengths are estimates.',
    },
    {
      id: '10425', name: 'Train Tunnel and Tracks',
      pieces: { 'duplo-curve': 10, 'duplo-switch': 1, 'duplo-buffer': 1, 'duplo-plate-both': 1, 'duplo-ramp-short': 1 },
      extra: 'The rail ramp, 6 module (6465960, design 4785) is modelled as a 96 mm straight; its length is an estimate. The tunnel is not track.',
    },
  ];

  const api = { SETS, find: (id) => SETS.find((s) => s.id === String(id).trim()) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DuploSets = api;
})(typeof window !== 'undefined' ? window : globalThis);
