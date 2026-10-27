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
      pieces: { 'duplo-straight': 7, 'duplo-bridge': 1 },
      extra: 'Counted as 7 straights plus 1 bridge (built from the set\'s lower and upper bridge parts over one of its 8 straights). Adjust by hand if you build it differently.',
    },
    {
      id: '10882', name: 'Train Tracks',
      pieces: { 'duplo-curve': 10, 'duplo-straight': 1, 'duplo-crossing': 1, 'duplo-switch': 2, 'duplo-buffer': 2 },
      extra: '',
    },
    {
      id: '10875', name: 'Cargo Train',
      pieces: { 'duplo-curve': 14, 'duplo-straight': 2, 'duplo-crossing': 1, 'duplo-switch': 2, 'duplo-buffer': 2, 'duplo-plate-side': 1 },
      extra: 'Not added: 2 inverted 16-module bow rails (6219647), which have no geometry yet.',
    },
    {
      id: '10426', name: 'Railway Bridge and Tracks',
      pieces: { 'duplo-straight': 7, 'duplo-bridge': 1, 'duplo-plate-both': 1 },
      extra: 'Counted as 7 straights plus 1 bridge, a guess from the set inventory, plus 1 straight with two side plates (6481090).',
    },
    {
      id: '10425', name: 'Train Tunnel and Tracks',
      pieces: { 'duplo-curve': 10, 'duplo-switch': 1, 'duplo-buffer': 1, 'duplo-plate-both': 1 },
      extra: 'Not added: 1 rail ramp, 6 module (6465960), whose length is unconfirmed, and the tunnel parts.',
    },
  ];

  const api = { SETS, find: (id) => SETS.find((s) => s.id === String(id).trim()) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DuploSets = api;
})(typeof window !== 'undefined' ? window : globalThis);
