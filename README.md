# Duplo Track Planner

A phone-friendly planner for LEGO® Duplo train track. Enter how many of each piece you own, tap pieces together, and see straight away whether a layout closes, where the gaps are, and whether you have enough pieces. Add your own 3D-printed pieces by shape.

## What it does

- **Built-in Duplo pieces**: straight, 30° curve, Y switch, 60° crossing, track end, and the older over-bent dark-grey curve.
- **Your pieces and counts**: the tray shows how many of each you have left; the status bar warns when a layout needs more than you own.
- **Tap to build**: tap an open end, tap pieces. Curves come in left and right. Select a placed piece to rotate, flip, turn it round, delete it, or swap it for another piece (the track beyond it follows).
- **Fit tolerance**: set the allowed gap/squeeze along the track, sideways offset and angle per joint, with Strict / Typical / Loose presets.
- **Loop flex**: when a loop closes, the error at the closing joint can be shared across every joint in the loop (Off, Gentle = √joints, Generous = ×joints). Joints that only fit this way show amber.
- **Checks**: green joints fit, amber fit with flex, red near-misses are labelled with distance and angle, and track that crosses itself is flagged.
- **Close a gap**: pick an open end and the app searches for runs of pieces (respecting what you have left) that join it to another end.
- **3D-printed pieces**: templates for straight, curve, Y switch, turnout, crossing, S-curve and dead end, or any shape as JSON paths. Each has its own colour and optional extra joint play.
- **Save and share**: layouts are stored on the server (shared between all your devices); export as a JSON file or a PNG picture.

## Geometry

All sizes are in millimetres. One Duplo stud is 16 mm.

| Piece | Geometry | Source |
|---|---|---|
| Straight 6377 | 128 mm (8 studs) | BlueBrick Duplo library, Cailliau |
| Curve 6378 (current light grey) | 30° arc, 256 mm centreline radius; 12 make a circle, 4 in an S equal 4 straights | BlueBrick, Cailliau |
| Curve 6378 (pre-2011 dark grey) | ≈30.3°, R ≈256.6 mm | Cailliau's measurements |
| Switch 6379 / 51943 | two 30° arcs, R 256 mm, from a shared toe | BlueBrick |
| Crossing 6376 | two 128 mm straights crossing at 60° | BlueBrick |
| Track end 31442 | dead end, length approximate | BlueBrick |

The BlueBrick Duplo package (Alban Nanty, Roland Bal) at github.com/Lswbanban/BlueBrickParts gives connection points in LEGO studs (8 mm); those were converted to the piece definitions in `public/geometry.js`. Robert Cailliau's measurements are at cailliau.org (Lego › Duplo › Train › Rails › Dimensions). Lester Gilbert notes (onemetre.net) that switches and the X crossing are not exactly on the curve geometry; the real track's play absorbs that, which is what the tolerance settings model.

Ramps and bridge pieces are not built in because their geometry isn't published; add them as custom straights if you need them in the plan.

## Run it on Proxmox

The server is a single Node.js file with no dependencies. Data is plain JSON in one folder.

### Option A: plain LXC container (simplest)

1. In Proxmox, create a Debian 12 or 13 container (1 core, 256 MB RAM and a 2 GB disk is plenty) and start it.
2. Copy this folder into it, for example from the Proxmox host:
   `pct push <vmid> duplo-track-planner.tar.gz /root/duplo-track-planner.tar.gz`
   then inside the container `tar xzf duplo-track-planner.tar.gz`.
3. Inside the container: `cd duplo-track-planner && bash deploy/install-lxc.sh`
4. Open `http://<container-ip>:8080` on your phone and use "Add to Home Screen".

Data lives in `/var/lib/duplo-track-planner`, so normal Proxmox container backups cover it. To update, copy the new folder in and run the installer again.

### Option B: Docker (in a VM, or an LXC with Docker installed)

```sh
docker compose up -d --build
```

Data is kept in `./data`. The image is based on node:22-alpine and has no npm dependencies.

### Option C: Proxmox VE 9.1 OCI containers

Proxmox 9.1 can create an LXC directly from an OCI image, but only by pulling it from a registry. If you push this image to a registry you use (for example `docker build -t ghcr.io/<you>/duplo-track-planner . && docker push …`), pull it from your storage's "Pull from OCI Registry", then add a mount point at `/data`. The feature is a technology preview, and updating means re-creating the container, so Option A is easier for now.

### Settings

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 8080 | Listen port |
| `HOST` | 0.0.0.0 | Listen address |
| `DATA_DIR` | `./data` | Where the workspace and layouts are stored |
| `BASIC_AUTH` | empty | Set to `user:password` to require a login |

It is meant for your home network. Put it behind your usual reverse proxy (it works under a sub-path) if you want HTTPS or remote access.

## Without a server

`node tools/build-standalone.js` writes `dist/duplo-track-planner.html`, a single file that runs offline in any browser. Without the server, layouts are kept in that browser only.

## Files

```
server.js                  web server + JSON storage API
public/geometry.js         piece geometry, joint analysis, gap solver (also runs in Node)
public/app.js              the user interface
public/style.css, index.html, icon.svg, manifest.webmanifest
deploy/install-lxc.sh      installer for a Debian/Ubuntu LXC
deploy/duplo-track-planner.service   systemd unit
Dockerfile, docker-compose.yml
test/geometry.test.js      `npm test`
tools/build-standalone.js  single-file build
docs/NOTES.md              research, sources, design decisions, testing and open items
```

### API

| Method | Path | |
|---|---|---|
| GET | `/api/health` | `{ ok: true }` |
| GET / PUT | `/api/workspace` | current layout, inventory, custom pieces and settings |
| GET | `/api/layouts` | saved layouts |
| GET / PUT / DELETE | `/api/layouts/<name>` | one saved layout |

### Custom piece JSON

A piece is a list of paths. Each path has a start pose and segments; path ends become connectors, and ends at the same spot merge (that is how a switch's toe works). Units are mm and degrees, x right, y down, positive angles turn right.

```json
[
  { "start": { "x": 0, "y": 0, "h": 0 }, "segs": [ { "type": "line", "len": 64 }, { "type": "arc", "r": 256, "angle": 30 } ] },
  { "start": { "x": 0, "y": 0, "h": 0 }, "segs": [ { "type": "line", "len": 192 } ], "endOpen": false }
]
```

LEGO® and Duplo® are trademarks of the LEGO Group, which does not sponsor or endorse this project.
