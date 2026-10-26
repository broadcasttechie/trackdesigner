# Project notes

Working notes from the design and build of Duplo Track Planner (26 October 2026). Read this before changing the geometry or the joint checks.

## Brief

- A mobile-friendly web app for planning Duplo train track layouts from the owner's own piece counts.
- Container-hosted on a home Proxmox cluster.
- Built-in piece library from an open source, so piece shapes don't have to be entered by hand.
- Customisable fit tolerance between pieces.
- Support for non-standard 3D-printed track pieces alongside the standard LEGO ones.

## What already existed (October 2026)

- No free, mobile-friendly web planner for Duplo track was found, and none that plans from your own inventory.
- **BlueBrick** (Alban Nanty) is a free, open-source Windows desktop layout planner. Its part library has a Duplo package, but it has no auto-design and doesn't run on phones. A Eurobricks member recommended it to someone asking the same question.
- **Turing Trains** (Guy Walker) has Duplo-buildable layouts that run in a browser, but they are fixed logic puzzles, not a free-form planner.
- JC58 on Printables/MakerWorld publishes 3D-printable Duplo-compatible track: a 45° extended curve on the standard radius, extra-long straight, short straight, flexible track and a ramp. There is also a widely used customisable Duplo track generator (remixed on MakerWorld) whose curves are "type 3", so 4 curves match 4 straights.

## Geometry research

| Fact | Value | Source |
|---|---|---|
| Duplo stud pitch | 16 mm | Cailliau |
| Straight 6377 | 8×4 studs, 128 mm | Cailliau; BlueBrick 6377 (±8 LEGO studs from centre) |
| Track width (sleeper) | 4 studs, 64 mm | Cailliau |
| Curve 6378 | 30°, 12 to a circle | Cailliau, BlueBrick, Eurobricks |
| Curve centreline radius | 256 mm (32 LEGO studs in BlueBrick) | BlueBrick 6378 comments; Cailliau type 3 |
| 4 curves as an S | Same length as 4 straights (type 3 curves only) | Cailliau |
| Older dark-grey curves (type 2, pre-2011) | ≈30.3°, R ≈256.6 mm; a 12-curve ring overlaps and lifts about 2 mm on the inside | Cailliau; Lester Gilbert |
| Switch 6379 / 51943 | Y points: two 30° branches on R 256 from a common toe | BlueBrick 6379CX1 |
| Switch caveat | Real switches are slightly off the curve geometry; a ring of switches misses by about a stud | Gilbert |
| Crossing 6376 | Two straights crossing at 60°, 128 mm arms; out of production since about 2016 | BlueBrick 6376; Gilbert |
| Track end 31442 | One connector; length in the app (148 mm) is approximate | BlueBrick 31442 |
| Black "type 1" track | 8 curves to a circle, different geometry; not modelled | Cailliau, Gilbert |

BlueBrick part files give connection points in LEGO studs (8 mm); they were converted into the path definitions in `public/geometry.js` rather than copied. The BlueBrickParts repository has no licence file, so its XML and GIFs are not bundled. Ramp (35966) and bridge geometry isn't published anywhere found; add them as custom straights if needed.

Sources:
- https://github.com/Lswbanban/BlueBrickParts (parts/Duplo)
- https://github.com/Lswbanban/BlueBrick
- https://www.cailliau.org/en/Alphabetical/L/Lego/Duplo/Train/Rails/Dimensions/
- https://onemetre.net/OtherTopics/Duplo/Track%20dims/DuploTrack.htm
- https://eurobricks.com/forum/forums/topic/178965-software-to-design-duplo-train-track-layouts
- https://www.eurobricks.com/forum/forums/topic/78402-duplo-trains-discussion
- https://www.printables.com/model/1053359-duplo-train-track-extended-curve
- https://www.makerworld.com/en/models/84799

## Design decisions

- **Piece model.** A piece is a list of paths, each a start pose plus straight and arc segments. Path ends become connectors and coincident ends merge (that is how a switch toe works). This one model covers every built-in piece and arbitrary 3D prints. Mirrored ("left") versions are generated automatically; a piece is treated as symmetric when its mirrored connectors match, or when it is flagged.
- **Coordinates.** Millimetres, x right, y down, positive angles turn right (clockwise on screen). Connector headings point outward.
- **Joint check.** For each pair of nearby connectors on different pieces, the error is measured in one connector's frame as along-track gap or squeeze, sideways offset, and angle. A joint fits when all three are inside the tolerance, plus any extra play set on a custom piece.
- **Loop flex.** Real Duplo loops close because every joint gives a little. When a candidate joint closes a loop of k joints, the tolerance is multiplied by 1 (Off), √k (Gentle, the default, capped at 6×) or k (Generous, capped at 12×). These joints are shown amber.
- **Defaults.** Typical preset: 4 mm gap, 4 mm sideways, 3°. With these and Gentle flex, a ring of 12 older dark-grey curves still shows as a 16 mm near miss, which matches the real "needs a push" behaviour; the Loose preset or Generous flex accepts it.
- **Overlap check.** The centrelines of pieces that are not joined to each other must stay more than 58 mm apart (track width minus a margin).
- **Gap solver.** Iterative-deepening depth-first search over two-ended single-path pieces (both hands), pruned by remaining reach and remaining turn, respecting pieces left in the inventory. Capped at 600,000 nodes.
- **Editing.** Tap an end, then tap pieces to chain them. Selecting a piece and tapping the tray swaps it, and the track beyond it is re-laid. Dragging moves the whole connected section and snaps to a nearby open end.
- **Storage.** The server keeps one workspace file (current layout, inventory, custom pieces, settings) plus one file per saved layout. If the API isn't reachable, the page falls back to browser storage, so the same page also runs as a single file or a preview.
- **Hosting.** Zero-dependency Node server, so the simplest Proxmox route is a plain Debian LXC with systemd (`deploy/install-lxc.sh`). Docker and compose files are included. Proxmox VE 9.1 can make an LXC from an OCI image, but only by pulling from a registry; it is a technology preview and updating means re-creating the container.

## Testing done

- `npm test` (test/geometry.test.js): 12 curves close a circle; an S of 4 curves equals 4 straights; the oval closes with no overlaps; 12 older curves leave a near miss; the solver closes a semicircle with 6 curves.
- Server: health, workspace and layout save/list/delete; path traversal blocked; invalid layout names rejected; optional login returns 401 without credentials.
- Headless Chromium at phone width (390×844), light and dark: example oval, select and swap a piece with the downstream track following, delete a piece, close the gap with the solver, add a custom 45° curve, build from a switch branch, overlap warning, save a layout to the server.

## Known limitations and untested parts

- The Docker image build was not tested (no Docker engine in the build environment). The LXC installer was syntax-checked only.
- No elevation: ramps and bridges are drawn flat.
- Switch and crossing geometry use the ideal curve geometry, not the slightly offset real geometry.
- The overlap check is approximate (sampled centrelines every 8 mm).
- The solver only uses two-ended pieces; it never places switches or crossings.

## Ideas for later

- Elevation and ramp lengths once measured.
- Measured switch geometry as an option.
- Set presets that add the track from a known set (for example 10882, 10875) to the inventory.
- A "what am I short of" shopping list across saved layouts.
- Running-length and minimum-curve readouts for long trains.

## Preview

`node tools/build-standalone.js` builds a single-file offline version into `dist/` (layouts then save to the browser only).
