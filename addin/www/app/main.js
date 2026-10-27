// WebXR-Viewer für Fusion-Exporte: Laden, Live-Sync, Greifen/Skalieren, Menü
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Menu, Toast, createWristButton } from './ui.js';

// Gamepad-Belegung (xr-standard): 4 = A/X, 5 = B/Y
const BTN_MENU = 4;
const BTN_RESET = 5;
const POLL_MS = 2000;           // nur als Rückfall, solange keine SSE-Verbindung steht
const SPAWN_DISTANCE = 0.6;
const SPAWN_WAIT_FRAMES = 30;   // Kopfposition stabilisiert sich erst nach einigen Frames
const RAY_IDLE_LENGTH = 0.25;   // Strahl ohne Treffer
const NEAR_GRAB = 0.05;         // Greifen ohne Strahltreffer, wenn Hand/Controller so nah am Modell ist

let scene, camera, renderer;
// modelGroup trägt Position, Drehung und Maßstab; content zentriert das Modell darin,
// dadurch bleibt der Griffpunkt beim Skalieren stehen
let modelGroup, content;
let menu, toast, wristButton;
const pointers = [];            // je Controller bzw. Hand: Strahl, Treffer, Eingabequelle
let leftHand = null;

let sceneMeta = null;
let latestMeta = null;          // neuester bekannter Stand vom Server
let loadedVersion = null;
let loading = false;
let sseConnected = false;
let modelRadius = 0.1;          // in Metern bei Maßstab 1

let baseScale = 1;              // GLB: Meter -> 1, OBJ: cm -> 0.01
let userScale = 1;
let spawnFrames = -1;           // >= 0: Platzierung ausstehend
let upright = false;            // nur um die Hochachse drehen
let displayMode = 'normal';     // normal | wire | xray

// Greifen
const grabbing = new Set();
const grabOffset = { pos: new THREE.Vector3(), rot: new THREE.Quaternion() };
let initialDistance = 0;
let initialUserScale = 1;
const prevButtons = new Map();

const raycaster = new THREE.Raycaster();
const tmpMatrix = new THREE.Matrix4();
const modelBox = new THREE.Box3();
let statusLine = 'Starte...';

init();

function init() {
    scene = new THREE.Scene();
    scene.background = null;

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 50);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.xr.enabled = true;
    document.body.appendChild(renderer.domElement);

    // Umgebungslicht für Metall und Glas, dazu ein Richtungslicht für Kontrast
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(2, 5, 2);
    scene.add(dirLight);

    modelGroup = new THREE.Group();
    modelGroup.position.set(0, 0, -1);
    scene.add(modelGroup);
    content = new THREE.Group();
    modelGroup.add(content);

    menu = new Menu();
    scene.add(menu.mesh);
    toast = new Toast();
    scene.add(toast.mesh);
    wristButton = createWristButton();
    scene.add(wristButton);

    const arBtn = ARButton.createButton(renderer, { optionalFeatures: ['local-floor', 'hit-test', 'hand-tracking'] });
    document.body.appendChild(arBtn);

    for (let i = 0; i < 2; i++) setupPointer(i);

    renderer.xr.addEventListener('sessionstart', () => { spawnFrames = 0; });
    renderer.xr.addEventListener('sessionend', () => { frameDesktopCamera(); });

    // Zugriff für Debugging in der Browser-Konsole
    window.__viewer = { scene, camera, modelGroup, content, renderer, menu, pointers, pressButton: onMenuButton, toggleMenu, onSelectStart, onSelectEnd };

    updateMenu();
    checkForUpdates();
    connectEvents();
    setInterval(() => { if (!sseConnected) checkForUpdates(); }, POLL_MS);
    window.addEventListener('resize', onWindowResize);
    renderer.setAnimationLoop(render);
}

// -----------------------------------------------------------------------------
// Controller und Hände
// -----------------------------------------------------------------------------
function setupPointer(idx) {
    // Bei Handtracking liefert getController den Zielstrahl der Hand; Pinch löst select aus
    const ctrl = renderer.xr.getController(idx);
    const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
    line.scale.z = RAY_IDLE_LENGTH;
    ctrl.add(line);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.006, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    dot.visible = false;
    scene.add(dot);
    scene.add(ctrl);

    const p = { ctrl, line, dot, source: null, hit: null };
    pointers.push(p);
    ctrl.addEventListener('connected', e => { p.source = e.data; line.visible = true; });
    ctrl.addEventListener('disconnected', () => { p.source = null; line.visible = false; dot.visible = false; grabbing.delete(p); });
    ctrl.addEventListener('selectstart', () => onSelectStart(p));
    ctrl.addEventListener('selectend', () => onSelectEnd(p));

    const hand = renderer.xr.getHand(idx);
    scene.add(hand);
    hand.addEventListener('connected', e => { if (e.data.handedness === 'left') leftHand = hand; });
    hand.addEventListener('disconnected', () => { if (leftHand === hand) leftHand = null; });
}

function updatePointer(p) {
    if (!p.source) return;
    tmpMatrix.identity().extractRotation(p.ctrl.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(p.ctrl.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tmpMatrix);

    p.hit = null;
    const ui = [menu.mesh, wristButton].filter(m => m.visible);
    const uiHit = raycaster.intersectObjects(ui, false)[0];
    if (uiHit) {
        p.hit = { kind: uiHit.object.userData.uiKind, point: uiHit.point, distance: uiHit.distance, uv: uiHit.uv };
    } else if (raycaster.ray.intersectsBox(modelBox)) {
        const modelHit = raycaster.intersectObject(content, true)[0];
        if (modelHit) p.hit = { kind: 'model', point: modelHit.point, distance: modelHit.distance };
    }

    p.line.scale.z = p.hit ? p.hit.distance : RAY_IDLE_LENGTH;
    p.line.material.color.set(grabbing.has(p) ? 0x00ff66 : p.hit ? 0x66ccff : 0xffffff);
    p.dot.visible = !!p.hit;
    if (p.hit) p.dot.position.copy(p.hit.point);
}

function isNearModel(p) {
    const pos = new THREE.Vector3().setFromMatrixPosition(p.ctrl.matrixWorld);
    return !modelBox.isEmpty() && modelBox.distanceToPoint(pos) < NEAR_GRAB;
}

function onSelectStart(p) {
    updatePointer(p);
    if (p.hit && p.hit.kind === 'menu') {
        const b = menu.buttonAt(p.hit.uv);
        if (b) onMenuButton(b.id);
        return;
    }
    if (p.hit && p.hit.kind === 'wrist') {
        toggleMenu();
        return;
    }
    if ((p.hit && p.hit.kind === 'model') || isNearModel(p)) {
        grabbing.add(p);
        updateGrabState();
    }
}

function onSelectEnd(p) {
    if (grabbing.delete(p)) updateGrabState();
}

// -----------------------------------------------------------------------------
// Greifen: eine Hand bewegt und dreht, zwei Hände skalieren und drehen um die Hochachse
// -----------------------------------------------------------------------------
function yawOnly(q) {
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(0, e.y, 0, 'YXZ'));
}

function handRotation(ctrl) {
    return upright ? yawOnly(ctrl.quaternion) : ctrl.quaternion.clone();
}

// Drehung aus der Linie zwischen beiden Händen (nur Hochachse – Rollen wäre mehrdeutig)
function twoHandRotation(c1, c2) {
    const dir = new THREE.Vector3().subVectors(c2.position, c1.position);
    return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(dir.x, dir.z));
}

function updateGrabState() {
    const ctrls = Array.from(grabbing, p => p.ctrl);
    if (ctrls.length === 1) {
        const inv = handRotation(ctrls[0]).invert();
        grabOffset.pos.copy(modelGroup.position).sub(ctrls[0].position).applyQuaternion(inv);
        grabOffset.rot.copy(inv).multiply(modelGroup.quaternion);
    } else if (ctrls.length === 2) {
        initialDistance = Math.max(ctrls[0].position.distanceTo(ctrls[1].position), 1e-3);
        initialUserScale = userScale;
        const mid = new THREE.Vector3().addVectors(ctrls[0].position, ctrls[1].position).multiplyScalar(0.5);
        const inv = twoHandRotation(ctrls[0], ctrls[1]).invert();
        grabOffset.pos.copy(modelGroup.position).sub(mid).applyQuaternion(inv);
        grabOffset.rot.copy(inv).multiply(modelGroup.quaternion);
    }
}

function updateGrab() {
    const ctrls = Array.from(grabbing, p => p.ctrl);
    if (ctrls.length === 1) {
        const rot = handRotation(ctrls[0]);
        modelGroup.position.copy(ctrls[0].position).add(grabOffset.pos.clone().applyQuaternion(rot));
        modelGroup.quaternion.copy(rot).multiply(grabOffset.rot);
    } else if (ctrls.length === 2) {
        const [c1, c2] = ctrls;
        const newUserScale = THREE.MathUtils.clamp(initialUserScale * c1.position.distanceTo(c2.position) / initialDistance, 0.01, 100);
        if (Math.abs(newUserScale - userScale) > 1e-4) {
            userScale = newUserScale;
            applyScale();
        }
        const mid = new THREE.Vector3().addVectors(c1.position, c2.position).multiplyScalar(0.5);
        const rot = twoHandRotation(c1, c2);
        // Offset mitskalieren, damit der Griffpunkt zwischen den Händen bleibt
        modelGroup.position.copy(mid).add(grabOffset.pos.clone().multiplyScalar(userScale / initialUserScale).applyQuaternion(rot));
        modelGroup.quaternion.copy(rot).multiply(grabOffset.rot);
    }
}

// -----------------------------------------------------------------------------
// Menü und Einstellungen
// -----------------------------------------------------------------------------
function toggleMenu() {
    if (menu.visible) menu.close();
    else menu.openInFront(camera);
}

function onMenuButton(id) {
    if (id.startsWith('scale:')) {
        setUserScale(1 / Number(id.slice(6)));
    } else if (id.startsWith('mode:')) {
        displayMode = id.slice(5);
        applyDisplayMode();
    } else if (id === 'upright') {
        upright = !upright;
        if (upright) modelGroup.quaternion.copy(yawOnly(modelGroup.quaternion));
    } else if (id === 'reset') {
        resetView();
    } else if (id === 'close') {
        menu.close();
    }
    updateMenu();
}

function setUserScale(s) {
    userScale = s;
    applyScale();
    if (grabbing.size) updateGrabState();
}

function applyScale() {
    const s = baseScale * userScale;
    modelGroup.scale.set(s, s, s);
    updateMenu();
}

function scaleLabel() {
    // OBJ: Fusion exportiert in cm, baseScale 0.01 entspricht 1:1
    const s = userScale;
    if (Math.abs(s - 1) < 0.005) return '1:1';
    if (s < 1) {
        const n = 1 / s;
        return Math.abs(n - Math.round(n)) < 0.02 ? `1:${Math.round(n)}` : `1:${n.toFixed(1)}`;
    }
    return `${s.toFixed(s < 10 ? 1 : 0)}:1`;
}

function updateMenu() {
    if (!menu) return;
    const lines = [sceneMeta ? (sceneMeta.document || 'Fusion') : 'Fusion → WebXR'];
    if (sceneMeta) {
        lines.push(sceneMeta.format === 'glb'
            ? `${sceneMeta.bodies.length} Körper · ${sceneMeta.triangles.toLocaleString('de-DE')} Dreiecke`
            : 'OBJ-Export (Maßstab angenommen: cm)');
        lines.push(`Maßstab ${scaleLabel()}` + (sizeLabel() ? ` · ${sizeLabel()}` : ''));
    }
    lines.push(statusLine);
    menu.setInfo(lines);
    menu.setState({ scaleLabel: scaleLabel(), mode: displayMode, upright });
    document.getElementById('status').textContent = lines.join('\n');
}

function sizeLabel() {
    if (!sceneMeta || !sceneMeta.bbox) return '';
    const [min, max] = sceneMeta.bbox;
    // Fusion-Maße in mm (bbox in Metern, Reihenfolge wie in Fusion X × Y × Z)
    return max.map((v, i) => Math.round((v - min[i]) * 1000)).join(' × ') + ' mm';
}

function setStatus(text, opts) {
    statusLine = text;
    updateMenu();
    toast.show(text, opts);
}

// Materialeigenschaften einmal merken, damit die Modi umkehrbar sind
function applyDisplayMode() {
    const seen = new Set();
    content.traverse(c => {
        if (!c.isMesh) return;
        for (const m of [].concat(c.material)) {
            if (seen.has(m)) continue;
            seen.add(m);
            const o = m.userData.orig || (m.userData.orig = {
                wireframe: m.wireframe, transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite,
            });
            m.wireframe = displayMode === 'wire';
            m.transparent = displayMode === 'xray' || o.transparent;
            m.opacity = displayMode === 'xray' ? Math.min(o.opacity, 0.25) : o.opacity;
            m.depthWrite = displayMode === 'xray' ? false : o.depthWrite;
            m.needsUpdate = true;
        }
    });
}

// -----------------------------------------------------------------------------
// Laden
// -----------------------------------------------------------------------------
// Fusion meldet Exporte per Server-Sent Events; Polling nur, solange das nicht klappt
function connectEvents() {
    if (!window.EventSource) return;
    const es = new EventSource('./events');
    es.onopen = () => { sseConnected = true; checkForUpdates(); };
    es.onerror = () => { sseConnected = false; };
    es.addEventListener('exporting', () => setStatus('Fusion exportiert...'));
    es.addEventListener('scene', () => checkForUpdates());
    // Eigener Name, weil 'error' bei EventSource für Verbindungsfehler reserviert ist
    es.addEventListener('exporterror', e => setStatus(JSON.parse(e.data).message, { sticky: true, error: true }));
}

async function checkForUpdates() {
    let meta;
    try {
        const res = await fetch('./scene.json', { cache: 'no-store' });
        if (!res.ok) {
            if (!sceneMeta) setStatus("Noch kein Export - in Fusion 'WebXR Export'", { sticky: true });
            return;
        }
        meta = await res.json();
    } catch (e) {
        setStatus('Server nicht erreichbar', { sticky: true, error: true });
        return;
    }
    latestMeta = meta;
    if (!loading) processQueue();
}

// Lädt so lange nach, bis der neueste Stand angezeigt wird – Exporte während
// eines laufenden Ladevorgangs gehen so nicht verloren
async function processQueue() {
    loading = true;
    while (latestMeta && latestMeta.version !== loadedVersion) {
        const meta = latestMeta;
        setStatus(`Lade ${meta.format.toUpperCase()}...`);
        try {
            const obj = meta.format === 'glb' ? await loadGlb(meta) : await loadObj(meta);
            setContent(obj, meta);
            setStatus('Modell geladen');
        } catch (e) {
            console.error(e);
            setStatus(`Fehler beim Laden (${meta.format})`, { sticky: true, error: true });
        }
        loadedVersion = meta.version;
    }
    loading = false;
}

function loadGlb(meta) {
    return new Promise((resolve, reject) => {
        new GLTFLoader().load(`./${meta.file}?v=${meta.version}`, gltf => {
            gltf.scene.traverse(c => {
                // Polierte Metalle spiegeln sonst nur die künstliche Umgebung und wirken fast schwarz
                if (c.isMesh && c.material.metalness > 0.5) {
                    c.material.roughness = Math.max(c.material.roughness, 0.35);
                    c.material.envMapIntensity = 1.5;
                }
            });
            resolve(gltf.scene);
        }, undefined, reject);
    });
}

function loadObj(meta) {
    const objUrl = `./model.obj?v=${meta.version}`;
    return new Promise((resolve, reject) => {
        const loadGeometry = (materials) => {
            const loader = new OBJLoader();
            if (materials) loader.setMaterials(materials);
            loader.load(objUrl, obj => {
                if (!materials) obj.traverse(c => { if (c.isMesh) c.material = new THREE.MeshStandardMaterial({ color: 0xcccccc }); });
                resolve(obj);
            }, undefined, reject);
        };
        if (!meta.hasMtl) return loadGeometry(null);
        new MTLLoader().load(`./model.mtl?v=${meta.version}`, materials => {
            materials.preload();
            loadGeometry(materials);
        }, undefined, () => loadGeometry(null));
    });
}

function disposeObject(obj) {
    obj.traverse(c => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) [].concat(c.material).forEach(m => m.dispose());
    });
}

function setContent(obj, meta) {
    const firstLoad = !sceneMeta;
    // Nur beim ersten Laden, nach Dokumentwechsel oder Formatwechsel neu zentrieren.
    // Sonst bleibt der Fusion-Ursprung stehen und vorhandene Geometrie springt nicht,
    // wenn etwas dazukommt.
    const recenter = firstLoad || meta.document !== sceneMeta.document || meta.format !== sceneMeta.format;
    while (content.children.length) {
        const old = content.children[0];
        content.remove(old);
        disposeObject(old);
    }
    // Hüllquader im lokalen (unskalierten) Raum von modelGroup berechnen,
    // solange obj noch keinen Elternknoten hat
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    if (recenter) content.position.copy(box.getCenter(new THREE.Vector3())).negate();
    content.add(obj);

    baseScale = meta.format === 'obj' ? 0.01 : 1;
    sceneMeta = meta;
    applyScale();
    applyDisplayMode();

    modelRadius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.001) * baseScale;

    if (firstLoad && !renderer.xr.isPresenting) frameDesktopCamera();
}

// -----------------------------------------------------------------------------
// Platzierung und Reset
// -----------------------------------------------------------------------------
function spawnInFront() {
    const camPos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    const distance = Math.max(SPAWN_DISTANCE, modelRadius * userScale * 2.5);
    modelGroup.position.copy(camPos).add(dir.multiplyScalar(distance));
    modelGroup.quaternion.identity();
    modelGroup.lookAt(camPos.x, modelGroup.position.y, camPos.z);
}

function recenterContent() {
    const obj = content.children[0];
    if (!obj) return;
    content.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    // setFromObject rechnet in Weltkoordinaten – zurück in den lokalen Raum von content
    box.applyMatrix4(content.matrixWorld.clone().invert());
    content.position.copy(box.getCenter(new THREE.Vector3())).negate();
}

function resetView() {
    recenterContent();
    setUserScale(1);
    spawnInFront();
    setStatus('Zurückgesetzt');
}

function frameDesktopCamera() {
    // Nur für die Desktop-Vorschau ohne Headset
    camera.position.set(0, modelRadius * 0.8, modelGroup.position.z + modelRadius * 3);
    camera.lookAt(modelGroup.position);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function handleButtons() {
    const session = renderer.xr.getSession();
    if (!session) return;
    for (const source of session.inputSources) {
        if (!source.gamepad) continue;
        const buttons = source.gamepad.buttons;
        const prev = prevButtons.get(source) || [];
        // Nur auf das Drücken reagieren, nicht solange die Taste gehalten wird
        const pressed = idx => buttons[idx] && buttons[idx].pressed && !prev[idx];
        if (pressed(BTN_RESET)) resetView();
        if (pressed(BTN_MENU)) toggleMenu();
        prevButtons.set(source, buttons.map(b => b.pressed));
    }
}

function updateWristButton() {
    const wrist = leftHand && leftHand.joints && leftHand.joints['wrist'];
    wristButton.visible = !!(wrist && wrist.visible);
    if (!wristButton.visible) return;
    wristButton.position.setFromMatrixPosition(wrist.matrixWorld);
    wristButton.position.y += 0.06;
    wristButton.lookAt(new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld));
}

function render() {
    if (renderer.xr.isPresenting && spawnFrames >= 0 && ++spawnFrames > SPAWN_WAIT_FRAMES) {
        spawnInFront();
        spawnFrames = -1;
    }

    handleButtons();
    updateGrab();

    modelBox.setFromObject(content);
    updateWristButton();
    let hover = null;
    for (const p of pointers) {
        updatePointer(p);
        if (p.hit && p.hit.kind === 'menu') hover = (menu.buttonAt(p.hit.uv) || {}).id || null;
    }
    if (menu.visible) menu.setHover(hover);
    toast.update(camera);

    renderer.render(scene, camera);
}
