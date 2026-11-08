import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createSync, clientId, syncMode } from './sync.js';

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */
const PANEL_W = 1.0; // metres, along the ridge
const PANEL_H = 1.7; // metres, up the slope
const GAP = 0.04;
const PANEL_KW = 0.54; // 540 Wp panel
const UNITS_PER_KW_YEAR = 1500; // rough India average (kWh per kWp per year)

const WALL_W = 10; // x
const WALL_H = 4; // y
const WALL_D = 8; // z  (south face = +z)
const HALF_D = WALL_D / 2;
const OVERHANG = 0.5;

const state = { cols: 6, rows: 2, tilt: 25, hour: 12 };

/* ------------------------------------------------------------------ */
/* Renderer / scene / camera                                           */
/* ------------------------------------------------------------------ */
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
camera.position.set(13, 8, 17);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 3.2, 1.5);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 8;
controls.maxDistance = 45;
controls.maxPolarAngle = Math.PI / 2 - 0.04;
controls.update();

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
resize();

// Block iOS/Android pinch-zoom of the page itself
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener(
  'touchmove',
  (e) => {
    if (e.touches.length > 1) e.preventDefault();
  },
  { passive: false }
);

/* ------------------------------------------------------------------ */
/* Lights                                                              */
/* ------------------------------------------------------------------ */
const hemi = new THREE.HemisphereLight(0xffffff, 0x556655, 0.6);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff2d6, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -14;
sun.shadow.camera.right = 14;
sun.shadow.camera.top = 14;
sun.shadow.camera.bottom = -14;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 120;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.03;
scene.add(sun);

const skyDay = new THREE.Color(0x87ceeb);
const skyDusk = new THREE.Color(0xf6a35c);

function fmtHour(h) {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function updateSun() {
  const phi = (Math.PI * (state.hour - 6)) / 12; // 0 = sunrise (east), PI = sunset (west)
  const elev = Math.max(Math.sin(phi), 0);
  // ridge runs along X, south face is +Z
  sun.position.set(Math.cos(phi) * 40, elev * 38 + 2, Math.sin(phi) * 18 + 4);
  sun.intensity = 0.2 + 2.3 * Math.pow(elev, 0.6);
  hemi.intensity = 0.35 + 0.45 * elev;
  scene.background.copy(skyDusk).lerp(skyDay, Math.min(1, elev * 2));
}

/* ------------------------------------------------------------------ */
/* Static world: ground, house, tree                                   */
/* ------------------------------------------------------------------ */
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(60, 48),
  new THREE.MeshStandardMaterial({ color: 0x6b8f5e, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const house = new THREE.Group();
scene.add(house);

const walls = new THREE.Mesh(
  new THREE.BoxGeometry(WALL_W, WALL_H, WALL_D),
  new THREE.MeshStandardMaterial({ color: 0xf3e9d2, roughness: 0.9 })
);
walls.position.y = WALL_H / 2;
walls.castShadow = true;
walls.receiveShadow = true;
house.add(walls);

const door = new THREE.Mesh(
  new THREE.BoxGeometry(1.1, 2.2, 0.1),
  new THREE.MeshStandardMaterial({ color: 0x6b4423 })
);
door.position.set(-2.2, 1.1, HALF_D + 0.03);
house.add(door);

const glassMat = new THREE.MeshStandardMaterial({ color: 0x9ccbe8, roughness: 0.2, metalness: 0.3 });
[1.2, 3.4].forEach((x) => {
  const win = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 0.1), glassMat);
  win.position.set(x, 2, HALF_D + 0.03);
  house.add(win);
});

// tree (shades the roof at low sun angles)
const tree = new THREE.Group();
const trunk = new THREE.Mesh(
  new THREE.CylinderGeometry(0.25, 0.3, 2, 8),
  new THREE.MeshStandardMaterial({ color: 0x7a5230 })
);
trunk.position.y = 1;
const crown = new THREE.Mesh(
  new THREE.ConeGeometry(1.6, 4, 10),
  new THREE.MeshStandardMaterial({ color: 0x2f6b3a, roughness: 1 })
);
crown.position.y = 4;
[trunk, crown].forEach((m) => {
  m.castShadow = true;
  m.receiveShadow = true;
  tree.add(m);
});
tree.position.set(8.5, 0, 5.5);
scene.add(tree);

/* ------------------------------------------------------------------ */
/* Roof + panel array (rebuilt when sliders change)                    */
/* ------------------------------------------------------------------ */
const roofMat = new THREE.MeshStandardMaterial({ color: 0xa5543b, roughness: 0.85 });
let roof = null;
const arrayGroup = new THREE.Group();
scene.add(arrayGroup);

function makeCellTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 216;
  const g = c.getContext('2d');
  g.fillStyle = '#e5e7eb'; // frame
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#1e3a8a'; // cells
  g.fillRect(4, 4, c.width - 8, c.height - 8);
  g.strokeStyle = 'rgba(203,213,225,0.55)';
  g.lineWidth = 1;
  for (let i = 1; i < 6; i++) {
    g.beginPath();
    g.moveTo(4 + ((c.width - 8) / 6) * i, 4);
    g.lineTo(4 + ((c.width - 8) / 6) * i, c.height - 4);
    g.stroke();
  }
  for (let j = 1; j < 10; j++) {
    g.beginPath();
    g.moveTo(4, 4 + ((c.height - 8) / 10) * j);
    g.lineTo(c.width - 4, 4 + ((c.height - 8) / 10) * j);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const cellTex = makeCellTexture();
const panelFront = new THREE.MeshStandardMaterial({ map: cellTex, metalness: 0.55, roughness: 0.25 });
const panelFrame = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.6, roughness: 0.4 });
const panelGeo = new THREE.BoxGeometry(PANEL_W, PANEL_H, 0.05);
// BoxGeometry face order: +x, -x, +y, -y, +z, -z  -> +z is the sun-facing side
const panelMats = [panelFrame, panelFrame, panelFrame, panelFrame, panelFront, panelFrame];

function buildRoof() {
  if (roof) {
    house.remove(roof);
    roof.geometry.dispose();
  }
  const t = THREE.MathUtils.degToRad(state.tilt);
  const h = HALF_D * Math.tan(t);
  const o = OVERHANG;
  const shape = new THREE.Shape();
  shape.moveTo(-(HALF_D + o), -o * Math.tan(t));
  shape.lineTo(HALF_D + o, -o * Math.tan(t));
  shape.lineTo(0, h);
  shape.closePath();
  const L = WALL_W + 2 * o;
  const geo = new THREE.ExtrudeGeometry(shape, { depth: L, bevelEnabled: false });
  geo.translate(0, 0, -L / 2);
  geo.rotateY(Math.PI / 2); // shape-x -> world z, extrusion -> world x
  roof = new THREE.Mesh(geo, roofMat);
  roof.position.y = WALL_H;
  roof.castShadow = true;
  roof.receiveShadow = true;
  house.add(roof);
}

function buildArray() {
  while (arrayGroup.children.length) arrayGroup.remove(arrayGroup.children[0]);

  const t = THREE.MathUtils.degToRad(state.tilt);
  const { cols, rows } = state;
  const h = HALF_D * Math.tan(t);

  // centre of the south slope, lifted slightly off the surface
  const midZ = HALF_D / 2;
  const midY = WALL_H + h / 2;
  const lift = 0.07;
  arrayGroup.position.set(0, midY + Math.cos(t) * lift, midZ + Math.sin(t) * lift);
  // rotate so local +z (panel face) points along the roof normal
  arrayGroup.rotation.set(t - Math.PI / 2, 0, 0);

  const totalW = cols * PANEL_W + (cols - 1) * GAP;
  const totalH = rows * PANEL_H + (rows - 1) * GAP;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = new THREE.Mesh(panelGeo, panelMats);
      p.position.set(
        -totalW / 2 + PANEL_W / 2 + c * (PANEL_W + GAP),
        -totalH / 2 + PANEL_H / 2 + r * (PANEL_H + GAP),
        0
      );
      p.castShadow = true;
      p.receiveShadow = true;
      arrayGroup.add(p);
    }
  }
  updateStats();
}

function updateStats() {
  const count = state.cols * state.rows;
  const kw = count * PANEL_KW;
  $('count').textContent = count;
  $('kw').textContent = kw.toFixed(2);
  $('units').textContent = Math.round(kw * UNITS_PER_KW_YEAR).toLocaleString('en-IN');
}

/* ------------------------------------------------------------------ */
/* UI <-> state                                                        */
/* ------------------------------------------------------------------ */
function syncLabels() {
  $('colsV').textContent = state.cols;
  $('rowsV').textContent = state.rows;
  $('tiltV').textContent = state.tilt;
  $('hourV').textContent = fmtHour(state.hour);
}

function applyState(next, { rebuild = true } = {}) {
  const prev = { ...state };
  Object.assign(state, next);
  ['cols', 'rows', 'tilt', 'hour'].forEach((k) => {
    $(k).value = state[k];
  });
  syncLabels();
  if (rebuild) {
    if (prev.tilt !== state.tilt) buildRoof();
    if (prev.tilt !== state.tilt || prev.cols !== state.cols || prev.rows !== state.rows) buildArray();
    if (prev.hour !== state.hour) updateSun();
  }
}

['cols', 'rows', 'tilt', 'hour'].forEach((k) => {
  $(k).addEventListener('input', () => {
    applyState({ [k]: parseFloat($(k).value) });
    sendNow();
  });
});

/* ------------------------------------------------------------------ */
/* Real-time sync                                                      */
/* ------------------------------------------------------------------ */
let sync = null;
let currentRoom = '';
let status = 'offline';
let peers = 1;
let remoteCam = null; // { p: Vector3, t: Vector3 } while easing to a remote view
let lastSent = 0;
const lastCam = { p: new THREE.Vector3(), t: new THREE.Vector3() };

function renderStatus() {
  const el = $('status');
  const label = {
    connecting: '… connecting',
    online: `● ${currentRoom} · ${peers} online`,
    local: `◐ ${currentRoom} · this device only`,
    error: '⚠ sync error',
    offline: 'Offline',
  }[status];
  el.textContent = label || 'Offline';
}

function payload() {
  return {
    id: clientId,
    cfg: { ...state },
    cam: {
      p: camera.position.toArray(),
      t: controls.target.toArray(),
    },
  };
}

function sendNow() {
  if (!sync) return;
  sync.send(payload());
  lastSent = performance.now();
  lastCam.p.copy(camera.position);
  lastCam.t.copy(controls.target);
}

function onRemoteState(msg) {
  if (!$('follow').checked) return;
  if (msg.cfg) applyState(msg.cfg);
  if (msg.cam) {
    remoteCam = {
      p: new THREE.Vector3().fromArray(msg.cam.p),
      t: new THREE.Vector3().fromArray(msg.cam.t),
    };
  }
}

function connect(room) {
  if (sync) sync.close();
  currentRoom = room;
  sync = createSync(room, {
    onState: onRemoteState,
    onStatus: (s) => {
      status = s;
      renderStatus();
      if (s === 'online' || s === 'local') sendNow(); // announce myself
    },
    onPeers: (n) => {
      const grew = n > peers;
      peers = n;
      renderStatus();
      if (grew) sendNow(); // bring a newcomer up to date
    },
  });
}

controls.addEventListener('start', () => {
  remoteCam = null; // user took over the camera
});

function randomRoom() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => a[Math.floor(Math.random() * a.length)]).join('');
}

$('join').addEventListener('click', () => {
  const code = $('room').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!code) return;
  $('room').value = code;
  history.replaceState(null, '', `#${code}`);
  connect(code);
});

$('share').addEventListener('click', async () => {
  const code = currentRoom || $('room').value.trim().toUpperCase();
  if (!code) return;
  const text = `Join my Solar 3D room with code: ${code}`;
  try {
    if (navigator.share) await navigator.share({ title: 'Solar 3D', text });
    else {
      await navigator.clipboard.writeText(text);
      $('status').textContent = 'Copied room code';
      setTimeout(renderStatus, 1500);
    }
  } catch (_) {
    /* user cancelled */
  }
});

/* ------------------------------------------------------------------ */
/* Main loop                                                           */
/* ------------------------------------------------------------------ */
let running = true;
document.addEventListener('visibilitychange', () => {
  running = !document.hidden;
  if (running) loop();
});

function loop() {
  if (!running) return;
  requestAnimationFrame(loop);

  if (remoteCam) {
    camera.position.lerp(remoteCam.p, 0.2);
    controls.target.lerp(remoteCam.t, 0.2);
    if (camera.position.distanceTo(remoteCam.p) < 0.02 && controls.target.distanceTo(remoteCam.t) < 0.02) {
      remoteCam = null;
    }
  }
  controls.update();

  // broadcast my camera (max ~12/s, only when it moved and I'm not easing to a remote view)
  if (sync && !remoteCam) {
    const now = performance.now();
    if (
      now - lastSent > 80 &&
      (camera.position.distanceToSquared(lastCam.p) > 1e-4 || controls.target.distanceToSquared(lastCam.t) > 1e-4)
    ) {
      sendNow();
    }
  }

  renderer.render(scene, camera);
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */
buildRoof();
buildArray();
updateSun();
syncLabels();
renderStatus();

const initial = (location.hash || '').replace('#', '').toUpperCase() || randomRoom();
$('room').value = initial;
connect(initial);
if (syncMode === 'local') console.info('No Supabase keys set: sync works between tabs on this device only.');

loop();
