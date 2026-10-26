/*
 * Duplo set catalogue: which track pieces each set contains, as counts of
 * built-in piece ids. Counts come from Brickset set inventories (element
 * numbers 6207494 straight, 6207493 curve, 6207508 points, 6207496 crossing,
 * 6219464 rail stop). Parts the planner has no geometry for are listed in
 * `extra` so the owner knows they were not added to the inventory.
 */
(function (root) {
  'use strict';

  const SETS = [
    {
      id: '10872', name: 'Train Bridge and Tracks',
      pieces: { 'duplo-straight': 8 },
      extra: 'Bridge parts (2 lower, 2 upper) are built over a straight and are not modelled.',
    },
    {
      id: '10882', name: 'Train Tracks',
      pieces: { 'duplo-curve': 10, 'duplo-straight': 1, 'duplo-crossing': 1, 'duplo-switch': 2, 'duplo-buffer': 2 },
      extra: '',
    },
    {
      id: '10875', name: 'Cargo Train',
      pieces: { 'duplo-curve': 14, 'duplo-straight': 2, 'duplo-crossing': 1, 'duplo-switch': 2, 'duplo-buffer': 2 },
      extra: 'Not added: 1 rail with 8-module plate (6219503) and 2 inverted 16-module bow rails (6219647), which have no geometry yet.',
    },
    {
      id: '10426', name: 'Railway Bridge and Tracks',
      pieces: { 'duplo-straight': 8 },
      extra: 'Not added: 1 crossing with 2×8 plates (6481090) and the bridge parts, which have no geometry yet.',
    },
  ];

  const api = { SETS, find: (id) => SETS.find((s) => s.id === String(id).trim()) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DuploSets = api;
})(typeof window !== 'undefined' ? window : globalThis);
