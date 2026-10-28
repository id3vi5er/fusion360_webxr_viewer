// WebXR-Viewer für Fusion-Exporte: Laden, Live-Sync, Greifen/Skalieren, Menü, Werkzeuge
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Menu, Toast, createWristButton } from './ui.js';
import { Exploder, Dimensions, MeasureTool, SectionTool } from './tools.js';
import { Placement, AnchorManager, Shadows, setupLightEstimation } from './xr.js';
import { Remote, SelectionView } from './remote.js';

// Gamepad-Belegung (xr-standard): 0 = Trigger, 1 = Greiftaste, 4 = A/X, 5 = B/Y
// Trigger wählt aus, Greiftaste bewegt; B (rechts) isoliert, Y (links) blendet aus
const BTN_MENU = 4;
const BTN_BODY = 5;
const HAND_TAP_MS = 250;        // Handtracking: kürzer gekniffen = auswählen, länger = greifen
const HAND_TAP_MOVE = 0.015;    // ... oder die Hand hat sich so weit (m) bewegt
const POLL_MS = 2000;           // nur als Rückfall, solange keine SSE-Verbindung steht
const SPAWN_DISTANCE = 0.6;
const SPAWN_WAIT_FRAMES = 30;   // Kopfposition stabilisiert sich erst nach einigen Frames
const RAY_IDLE_LENGTH = 0.25;   // Strahl ohne Treffer
const NEAR_GRAB = 0.05;         // Greifen ohne Strahltreffer, wenn Hand/Controller so nah am Modell ist

let scene, camera, renderer, mainLight;
// modelGroup trägt Position, Drehung und Maßstab; content zentriert das Modell darin,
// dadurch bleibt der Griffpunkt beim Skalieren stehen
let modelGroup, content;
let menu, toast, wristButton, highlight;
let exploder, dimensions, measure, section;
let placement, anchors, shadows;
let remote, selectionView, sectionPlanes;
const pointers = [];            // je Controller bzw. Hand: Strahl, Treffer, Eingabequelle
let leftHand = null;

let sceneMeta = null;
let latestMeta = null;          // neuester bekannter Stand vom Server
let loadedVersion = null;
let loading = false;
let sseConnected = false;
let modelRadius = 0.1;          // in Metern bei Maßstab 1
let modelLocalBox = new THREE.Box3();   // Hüllquader im Raum von content, nicht explodiert

let baseScale = 1;              // GLB: Meter -> 1, OBJ: cm -> 0.01
let userScale = 1;
let spawnFrames = -1;           // >= 0: Platzierung ausstehend
let upright = false;            // nur um die Hochachse drehen
let displayMode = 'normal';     // normal | wire | xray
let tool = 'select';            // select | place | measure (Greifen geht immer über die Greiftaste)
let explode = 0;
let roomLight = false;

// Bauteile: Knoten je Körper, Sichtbarkeit über einen stabilen Schlüssel (Pfad)
let bodyNodes = [];
const hiddenKeys = new Set();
let soloKey = null;

// Rückkanal: Auswahl (Körperpfade, gespiegelt mit Fusion) und Benutzerparameter
const selectedKeys = new Set();
let params = [];                // Stand aus Fusion
const paramLocal = new Map();   // name -> { value, pending }: gezogen bzw. gesendet, noch nicht bestätigt
let pinDigits = '';             // Eingabe auf der Kopplungsseite

// Greifen
const grabbing = new Set();
const grabOffset = { pos: new THREE.Vector3(), rot: new THREE.Quaternion() };
let initialDistance = 0;
let initialUserScale = 1;
let gizmoGrab = null;           // Zeiger, der gerade die Schnittebene hält
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
    renderer.localClippingEnabled = true;
    renderer.xr.enabled = true;
    document.body.appendChild(renderer.domElement);

    // Umgebungslicht für Metall und Glas, dazu ein Richtungslicht für Kontrast und Schatten
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    mainLight = new THREE.DirectionalLight(0xffffff, 1.0);
    mainLight.position.set(2, 5, 2);
    scene.add(mainLight);

    modelGroup = new THREE.Group();
    modelGroup.position.set(0, 0, -1);
    scene.add(modelGroup);
    content = new THREE.Group();
    modelGroup.add(content);

    exploder = new Exploder(content);
    dimensions = new Dimensions(modelGroup);
    measure = new MeasureTool(scene, content, exploder);
    section = new SectionTool(modelGroup);
    placement = new Placement(scene);
    anchors = new AnchorManager();
    shadows = new Shadows(renderer, scene, mainLight);
    sectionPlanes = [section.plane];
    remote = new Remote();
    selectionView = new SelectionView(scene);
    setupLightEstimation(renderer, scene, mainLight, on => { roomLight = on; updateMenu(); });

    menu = new Menu();
    scene.add(menu.mesh);
    toast = new Toast();
    scene.add(toast.mesh);
    wristButton = createWristButton();
    scene.add(wristButton);
    highlight = new THREE.BoxHelper(undefined, 0xffd400);
    highlight.material.depthTest = false;
    highlight.renderOrder = 997;
    highlight.visible = false;
    scene.add(highlight);

    const arBtn = ARButton.createButton(renderer, {
        optionalFeatures: ['local-floor', 'hit-test', 'hand-tracking', 'anchors', 'light-estimation'],
    });
    document.body.appendChild(arBtn);

    for (let i = 0; i < 2; i++) setupPointer(i);

    renderer.xr.addEventListener('sessionstart', onSessionStart);
    renderer.xr.addEventListener('sessionend', () => {
        anchors.reset();
        placement.stop();
        if (tool === 'place') tool = 'select';
        frameDesktopCamera();
        updateMenu();
    });

    // Zugriff für Debugging in der Browser-Konsole
    window.__viewer = {
        scene, camera, modelGroup, content, renderer, menu, pointers, measure, section, exploder,
        pressButton: onMenuButton, toggleMenu, onSelectStart, onSelectEnd, onSqueezeStart, onSqueezeEnd,
        isolateBodies, hideBodies, placeOnSurface,
        remote, selectionView, selectedKeys, setSelection, setParams, commitParam,
        render,   // einzelnes Frame, falls die Seite im Hintergrund läuft
    };

    updateMenu();
    checkForUpdates();
    connectEvents();
    remote.check().then(() => { refreshParams(); updateMenu(); });
    document.getElementById('pair').addEventListener('submit', async e => {
        e.preventDefault();
        const input = document.getElementById('pin');
        const ok = await submitPin(input.value.trim());
        input.value = '';
        if (!ok) setStatus(menu.pin.message, { error: true });
    });
    setInterval(() => { if (!sseConnected) checkForUpdates(); }, POLL_MS);
    window.addEventListener('resize', onWindowResize);
    renderer.setAnimationLoop(render);
}

function docKey() {
    return sceneMeta ? (sceneMeta.document || 'model') : null;
}

async function onSessionStart() {
    spawnFrames = 0;
    shadows.surfaceY = null;
    updateMenu();
    // Gespeicherten Platz für dieses Dokument wiederherstellen statt neu zu platzieren
    const key = docKey();
    if (!key || !anchors.hasStored(key)) return;
    spawnFrames = -1;
    anchors.docKey = key;
    const stored = await anchors.restore(renderer.xr.getSession(), key);
    if (stored) {
        if (stored.userScale) setUserScale(stored.userScale);
        if (stored.surfaceY !== undefined) shadows.surfaceY = stored.surfaceY;
        setStatus('Platz wiederhergestellt');
    } else {
        spawnFrames = 0;
    }
}

function anchorModel() {
    if (!renderer.xr.isPresenting) return;
    anchors.docKey = docKey();
    anchors.request(modelGroup.position, modelGroup.quaternion, { userScale, surfaceY: shadows.surfaceY ?? undefined });
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
    ctrl.addEventListener('disconnected', () => {
        p.source = null;
        line.visible = false;
        dot.visible = false;
        p.pinch = null;
        onSelectEnd(p);
        onSqueezeEnd(p);
    });
    ctrl.addEventListener('selectstart', () => onSelectStart(p));
    ctrl.addEventListener('selectend', () => onSelectEnd(p));
    ctrl.addEventListener('squeezestart', () => onSqueezeStart(p));
    ctrl.addEventListener('squeezeend', () => onSqueezeEnd(p));

    const hand = renderer.xr.getHand(idx);
    scene.add(hand);
    hand.addEventListener('connected', e => { if (e.data.handedness === 'left') leftHand = hand; });
    hand.addEventListener('disconnected', () => { if (leftHand === hand) leftHand = null; });
}

// Ausgeblendete Körper sollen weder getroffen noch gemessen werden
function isShown(obj) {
    for (let o = obj; o && o !== content; o = o.parent) if (!o.visible) return false;
    return true;
}

function updatePointer(p) {
    if (!p.source) return;
    tmpMatrix.identity().extractRotation(p.ctrl.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(p.ctrl.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tmpMatrix);

    p.hit = null;
    const ui = [menu.mesh, wristButton, section.handle].filter(m => m.visible && isVisibleInScene(m));
    const uiHit = raycaster.intersectObjects(ui, false)[0];
    const modelHit = raycaster.ray.intersectsBox(modelBox)
        ? raycaster.intersectObject(content, true).find(h => isShown(h.object)) : null;
    // Menü und Handgelenk haben Vorrang; die Schnittebene nur, wenn sie vor dem Modell liegt
    if (uiHit && (uiHit.object.userData.uiKind !== 'section' || !modelHit || uiHit.distance < modelHit.distance)) {
        p.hit = { kind: uiHit.object.userData.uiKind, point: uiHit.point, distance: uiHit.distance, uv: uiHit.uv };
    } else if (modelHit) {
        p.hit = { kind: 'model', point: modelHit.point, distance: modelHit.distance, object: modelHit.object, face: modelHit.face };
    }

    const placing = tool === 'place' && placement.hit && placement.pointer === p;
    p.line.scale.z = p.hit ? p.hit.distance : placing ? p.ctrl.position.distanceTo(placement.hit.position) : RAY_IDLE_LENGTH;
    p.line.material.color.set(grabbing.has(p) || gizmoGrab === p ? 0x00ff66 : p.hit ? 0x66ccff : 0xffffff);
    p.dot.visible = !!p.hit;
    if (p.hit) p.dot.position.copy(p.hit.point);
}

function isVisibleInScene(obj) {
    for (let o = obj; o; o = o.parent) if (!o.visible) return false;
    return true;
}

function isNearModel(p) {
    const pos = new THREE.Vector3().setFromMatrixPosition(p.ctrl.matrixWorld);
    return !modelBox.isEmpty() && modelBox.distanceToPoint(pos) < NEAR_GRAB;
}

function isHand(p) {
    return !!(p.source && p.source.hand);
}

// Trigger bzw. Kneifen: Menü, Werkzeuge und Auswahl. Bewegt wird mit der Greiftaste.
function onSelectStart(p) {
    p.pressed = true;
    updatePointer(p);
    const hit = p.hit;
    if (hit && hit.kind === 'menu') {
        const b = menu.buttonAt(hit.uv);
        if (b) onMenuButton(b.id, b.value);
        // Regler: weiter ziehen, solange gedrückt
        if (b && b.value !== undefined) p.dragSlider = b.id;
        return;
    }
    if (hit && hit.kind === 'wrist') return toggleMenu();
    if (hit && hit.kind === 'section') return startGizmoGrab(p, 'select');
    if (tool === 'place') {
        if (placement.hit) placeOnSurface(placement.hit);
        return;
    }
    if (tool === 'measure') {
        if (hit && hit.kind === 'model') {
            const item = measure.addPoint(hit, bodyKey);
            if (item) setStatus(`Abstand ${measure.distanceMm(item, unitToMm()).toFixed(1).replace('.', ',')} mm`);
        }
        return;
    }
    // Hände haben keine Greiftaste: kurz kneifen wählt aus, gehalten oder bewegt wird gegriffen
    if (isHand(p)) {
        p.pinch = { time: performance.now(), pos: new THREE.Vector3().setFromMatrixPosition(p.ctrl.matrixWorld), hit };
        return;
    }
    selectBody(p, hit);
}

function onSelectEnd(p) {
    p.pressed = false;
    // Parameter erst beim Loslassen senden – Fusion braucht für die Neuberechnung Zeit
    if (p.dragSlider && p.dragSlider.startsWith('param:')) commitParam(Number(p.dragSlider.slice(6)));
    p.dragSlider = null;
    if (p.pinch) {
        const hit = p.pinch.hit;
        p.pinch = null;
        selectBody(p, hit);
    }
    releaseGrab(p, 'select');
}

function onSqueezeStart(p) {
    updatePointer(p);
    const hit = p.hit;
    if (hit && hit.kind === 'section') return startGizmoGrab(p, 'squeeze');
    if (hit && (hit.kind === 'menu' || hit.kind === 'wrist')) return;
    // Mit der Greiftaste braucht man nicht genau zu zielen
    if (!modelBox.isEmpty()) startGrab(p, 'squeeze');
}

function onSqueezeEnd(p) {
    releaseGrab(p, 'squeeze');
}

// Handtracking: Kneifen wird zum Greifen, sobald es lange genug dauert oder die Hand wandert
function updatePinch(p) {
    if (!p.pinch) return;
    const moved = new THREE.Vector3().setFromMatrixPosition(p.ctrl.matrixWorld).distanceTo(p.pinch.pos);
    if (performance.now() - p.pinch.time < HAND_TAP_MS && moved < HAND_TAP_MOVE) return;
    const onModel = (p.pinch.hit && p.pinch.hit.kind === 'model') || isNearModel(p);
    p.pinch = null;
    if (onModel) startGrab(p, 'select');
}

function startGrab(p, by) {
    p.grabBy = by;
    grabbing.add(p);
    updateGrabState();
}

function startGizmoGrab(p, by) {
    p.grabBy = by;
    gizmoGrab = p;
    p.ctrl.attach(section.gizmo);
}

// Nur die Taste, die das Greifen begonnen hat, beendet es
function releaseGrab(p, by) {
    if (p.grabBy !== by) return;
    p.grabBy = null;
    if (gizmoGrab === p) {
        modelGroup.attach(section.gizmo);
        gizmoGrab = null;
    }
    if (grabbing.delete(p)) {
        updateGrabState();
        if (!grabbing.size) {
            shadows.surfaceY = null;   // frei bewegt: Schatten wieder auf den Boden
            anchorModel();
        }
    }
}

// Zweiter Trigger gehalten: hinzufügen bzw. entfernen statt ersetzen; ins Leere: Auswahl aufheben
function selectBody(p, hit) {
    const additive = pointers.some(q => q !== p && q.pressed);
    const key = hit && hit.kind === 'model' ? bodyKey(hit.object) : null;
    if (key || !additive) selectInFusion(key, additive);
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

const SURFACE_LABELS = { floor: 'Auf Fläche platziert', wall: 'An Wand platziert', ceiling: 'An Decke platziert' };

// Modell bleibt aufrecht. Boden/Decke: Blickrichtung bleibt; Wand: Vorderseite (+Z) zeigt in den Raum.
// Danach entlang der Normalen verschieben, bis die zur Fläche zeigende Seite sie berührt.
function placeOnSurface(hit) {
    const n = hit.normal.clone().normalize();
    if (hit.surface === 'wall') {
        modelGroup.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(n.x, n.z));
    } else {
        modelGroup.quaternion.copy(yawOnly(modelGroup.quaternion));
    }
    modelGroup.position.copy(hit.position);
    modelGroup.updateMatrixWorld(true);
    // Ecken des modellfesten Hüllquaders – enger als ein achsparalleler Quader in Weltkoordinaten
    const { min, max } = modelLocalBox;
    let nearest = Infinity;
    for (let i = 0; i < 8; i++) {
        const c = new THREE.Vector3(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z)
            .applyMatrix4(content.matrixWorld);
        nearest = Math.min(nearest, c.sub(hit.position).dot(n));
    }
    modelGroup.position.addScaledVector(n, -nearest);
    // Schatten auf die Fläche nur, wenn das Modell darauf steht – sonst auf den Boden
    shadows.surfaceY = hit.surface === 'floor' ? hit.position.y : null;
    setTool('select');
    anchorModel();
    setStatus(SURFACE_LABELS[hit.surface]);
}

// -----------------------------------------------------------------------------
// Menü und Einstellungen
// -----------------------------------------------------------------------------
function toggleMenu() {
    if (menu.visible) menu.close();
    else menu.openInFront(camera);
}

function setTool(t) {
    if (t === 'place' && !renderer.xr.isPresenting) return;
    if (tool === 'measure' && t !== 'measure') measure.cancelPending();
    tool = t;
    if (t === 'place') placement.start();
    else placement.stop();
    updateMenu();
}

function onMenuButton(id, value) {
    const [kind, arg, idx] = id.split(':');
    switch (kind) {
        case 'page':
            menu.setPage(arg);
            if (arg === 'params' && !remote.available) setStatus(remote.message || 'Verbinde mit Fusion...');
            break;
        case 'scale': setUserScale(1 / Number(arg)); anchorModel(); break;
        case 'mode': displayMode = arg; applyDisplayMode(); break;
        case 'tool':
            setTool(arg);
            if (arg !== 'select') menu.close();
            if (arg === 'measure') setStatus('Zwei Punkte am Modell antippen');
            if (arg === 'place') setStatus('Auf Boden, Tisch, Wand oder Decke zielen und drücken');
            if (arg === 'select') setStatus('Trigger: auswählen · Greiftaste: bewegen');
            break;
        case 'upright':
            upright = !upright;
            if (upright) modelGroup.quaternion.copy(yawOnly(modelGroup.quaternion));
            break;
        case 'shadows': shadows.enabled = !shadows.enabled; break;
        case 'dims': dimensions.group.visible = !dimensions.group.visible; break;
        case 'section':
            section.setBox(sectionBox());
            section.setEnabled(!section.enabled, content);
            break;
        case 'axis': section.setBox(sectionBox()); section.setAxis(arg); break;
        case 'flip': section.flip(); break;
        case 'explode': explode = value; exploder.set(explode); break;
        case 'clearMeasure': measure.clear(); break;
        case 'bodies':
            if (arg === 'prev') menu.flipBodyPage(-1);
            if (arg === 'next') menu.flipBodyPage(1);
            if (arg === 'all') showAllBodies();
            break;
        case 'body': onBodyButton(arg, Number(idx)); break;
        case 'params': menu.flipParamPage(arg === 'next' ? 1 : -1); break;
        case 'pair': pinDigits = ''; menu.setPin(''); menu.setPage('pair'); break;
        case 'pin': onPinKey(arg); break;
        case 'param': dragParam(Number(arg), value); break;
        case 'reset': resetView(); break;
        case 'close': menu.close(); break;
    }
    updateMenu();
}

function onBodyButton(action, idx) {
    const node = bodyNodes[idx];
    if (!node) return;
    const key = bodyKey(node);
    if (action === 'hover') {
        // Zeile antippen = auswählen (und in Fusion, wenn der Rückkanal steht)
        selectInFusion(key, false);
        return;
    }
    if (action === 'toggle') {
        if (soloKey) { soloKey = null; hiddenKeys.clear(); bodyNodes.forEach(n => { if (n !== node) hiddenKeys.add(bodyKey(n)); }); }
        if (hiddenKeys.has(key)) hiddenKeys.delete(key);
        else hiddenKeys.add(key);
    } else if (action === 'solo') {
        soloKey = soloKey === key ? null : key;
    }
    applyBodyVisibility();
}

// Ziel für B/Y: die Auswahl, sonst der Körper unter dem Strahl dieses Controllers
function targetKeys(p) {
    if (selectedKeys.size) return [...selectedKeys].filter(k => bodyNodes.some(n => bodyKey(n) === k));
    if (p) updatePointer(p);
    return p && p.hit && p.hit.kind === 'model' ? [bodyKey(p.hit.object)] : [];
}

function keysLabel(keys) {
    if (keys.length !== 1) return `${keys.length} Körper`;
    const node = bodyNodes.find(n => bodyKey(n) === keys[0]);
    return node ? node.name : keys[0].split('/').pop();
}

function showAllBodies() {
    hiddenKeys.clear();
    soloKey = null;
    applyBodyVisibility();
}

// B: nur die Zielkörper zeigen; nochmal B (oder B ohne Ziel) zeigt wieder alles
function isolateBodies(p) {
    const keys = targetKeys(p);
    const anyHidden = soloKey || hiddenKeys.size;
    const isolated = keys.length && bodyNodes.every(n => keys.includes(bodyKey(n)) === n.visible);
    if (!keys.length || isolated) {
        if (anyHidden) {
            showAllBodies();
            setStatus('Alle Bauteile eingeblendet');
        } else {
            setStatus('Erst ein Bauteil auswählen oder darauf zielen');
        }
        return;
    }
    soloKey = null;
    hiddenKeys.clear();
    bodyNodes.forEach(n => { if (!keys.includes(bodyKey(n))) hiddenKeys.add(bodyKey(n)); });
    applyBodyVisibility();
    setStatus(`Isoliert: ${keysLabel(keys)} · B zeigt wieder alles`);
}

// Y: Zielkörper ausblenden; die Auswahl darauf entfällt
function hideBodies(p) {
    const keys = targetKeys(p);
    if (!keys.length) {
        setStatus('Erst ein Bauteil auswählen oder darauf zielen');
        return;
    }
    if (soloKey) {
        hiddenKeys.clear();
        bodyNodes.forEach(n => { if (bodyKey(n) !== soloKey) hiddenKeys.add(bodyKey(n)); });
        soloKey = null;
    }
    keys.forEach(k => hiddenKeys.add(k));
    setSelection([...selectedKeys].filter(k => !keys.includes(k)), 'viewer');
    applyBodyVisibility();
    setStatus(`Ausgeblendet: ${keysLabel(keys)} · „Alle zeigen“ im Menü`);
}

function bodyKey(obj) {
    for (let o = obj; o && o !== content; o = o.parent) {
        if (o.userData.kind === 'body' || bodyNodes.includes(o)) return o.userData.path || o.name || o.uuid;
    }
    return obj.userData.path || obj.name || obj.uuid;
}

function applyBodyVisibility() {
    for (const n of bodyNodes) {
        const key = bodyKey(n);
        n.visible = soloKey ? key === soloKey : !hiddenKeys.has(key);
    }
    menu.setBodies(bodyNodes.map(n => ({
        name: n.name || '(ohne Namen)', visible: n.visible, solo: soloKey === bodyKey(n), selected: selectedKeys.has(bodyKey(n)),
    })));
}

// -----------------------------------------------------------------------------
// Rückkanal: Auswahl und Parameter
// -----------------------------------------------------------------------------
// Die Auswahl gilt immer in der Brille (für B/Y); an Fusion geht sie nur mit Rückkanal und GLB-Pfaden
function selectInFusion(key, additive) {
    const mode = additive ? (selectedKeys.has(key) ? 'remove' : 'add') : 'replace';
    // Sofort anzeigen; Fusion bestätigt per SSE (selection)
    const next = mode === 'replace' ? new Set(key ? [key] : []) : new Set(selectedKeys);
    if (mode === 'add') next.add(key);
    if (mode === 'remove') next.delete(key);
    setSelection([...next], 'viewer');
    if (!remote.available || !sceneMeta || sceneMeta.format !== 'glb') return;
    remote.send('select', { paths: key ? [key] : [], mode }).then(r => {
        if (!r.ok) setStatus(r.message, { error: true });
        updateMenu();
    });
}

function setSelection(paths, origin) {
    const changed = paths.length !== selectedKeys.size || paths.some(k => !selectedKeys.has(k));
    selectedKeys.clear();
    paths.forEach(k => selectedKeys.add(k));
    if (!changed) return;
    applySelection(true);
    if (origin === 'fusion' && paths.length) {
        const node = paths.length === 1 && bodyNodes.find(n => bodyKey(n) === paths[0]);
        setStatus(paths.length === 1 ? `Fusion: ${node ? node.name : paths[0].split('/').pop()}` : `Fusion: ${paths.length} Körper ausgewählt`);
    }
}

// fresh: neue Auswahl (Richtungspfeil zeigen), sonst nur neu geladenes Modell
function applySelection(fresh) {
    selectionView.set(bodyNodes.filter(n => selectedKeys.has(bodyKey(n))), fresh);
    applyBodyVisibility();
}

// Ziffernblock: nach der vierten Ziffer wird sofort geprüft
function onPinKey(key) {
    if (key === 'cancel') return menu.setPage('params');
    if (key === 'del') pinDigits = pinDigits.slice(0, -1);
    else if (/^\d$/.test(key) && pinDigits.length < 4) pinDigits += key;
    menu.setPin(pinDigits);
    if (pinDigits.length === 4 && key !== 'del') submitPin(pinDigits);
}

async function submitPin(pin) {
    menu.setPin(pin, 'Prüfe...');
    const r = await remote.pair(pin);
    pinDigits = '';
    if (!r.ok) {
        menu.setPin('', r.message);
        return false;
    }
    menu.setPin('', '✓ Gekoppelt');
    refreshParams();
    updateMenu();
    setStatus('Rückkanal aktiv');
    setTimeout(() => { if (menu.page === 'pair') menu.setPage('params'); }, 900);
    return true;
}

function setParams(list) {
    params = list;
    // Gesendete Werte gelten als bestätigt, sobald Fusion sie meldet; gezogene (nicht gesendete) bleiben
    for (const p of list) {
        const local = paramLocal.get(p.name);
        if (local && local.pending && Math.abs(local.value - p.value) < p.step / 2) paramLocal.delete(p.name);
    }
    refreshParams();
}

function snapParam(p, t) {
    const raw = p.min + THREE.MathUtils.clamp(t, 0, 1) * (p.max - p.min);
    const v = THREE.MathUtils.clamp(Math.round(raw / p.step) * p.step, p.min, p.max);
    return Number(v.toFixed(6));
}

function formatParam(p, v) {
    const decimals = p.step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(p.step) - 1e-9));
    return v.toFixed(decimals).replace('.', ',') + (p.unit ? ` ${p.unit}` : '');
}

function dragParam(idx, t) {
    const p = params[idx];
    if (!p || !p.editable) return;
    paramLocal.set(p.name, { value: snapParam(p, t), pending: false });
    refreshParams();
}

function commitParam(idx) {
    const p = params[idx];
    const local = p && paramLocal.get(p.name);
    if (!local || local.pending) return;
    if (Math.abs(local.value - p.value) < p.step / 2) {
        paramLocal.delete(p.name);
        refreshParams();
        return;
    }
    local.pending = true;
    refreshParams();
    remote.send('param', { name: p.name, value: local.value }).then(r => {
        if (r.ok) return;
        paramLocal.delete(p.name);
        refreshParams();
        setStatus(r.message, { error: true });
    });
}

function refreshParams() {
    if (!menu) return;
    // Ohne Rückkanal nur anzeigen – ein Regler, der nichts bewirkt, wäre irreführend
    const editable = remote.available;
    menu.setParams(params.map(p => {
        const local = paramLocal.get(p.name);
        const v = local ? local.value : p.value;
        return {
            name: p.name,
            editable: p.editable && editable,
            valueText: p.editable ? formatParam(p, v) : `= ${p.expression}`,
            t: p.max > p.min ? THREE.MathUtils.clamp((v - p.min) / (p.max - p.min), 0, 1) : 0.5,
            note: local && local.pending ? 'Fusion rechnet...' : '',
        };
    }), remote.available ? '' : remote.message);
}

function sectionBox() {
    // Hüllquader im Raum von modelGroup (content ist darin verschoben)
    return modelLocalBox.clone().translate(content.position);
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

// Längeneinheit des Modells (Raum von content) in mm
function unitToMm() {
    return sceneMeta && sceneMeta.format === 'obj' ? 10 : 1000;
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

function sizeLabel() {
    if (!sceneMeta || !sceneMeta.bbox) return '';
    const [min, max] = sceneMeta.bbox;
    // Fusion-Maße in mm (bbox in Metern, Reihenfolge wie in Fusion X × Y × Z)
    return max.map((v, i) => Math.round((v - min[i]) * 1000)).join(' × ') + ' mm';
}

function updateMenu() {
    if (!menu) return;
    const lines = [sceneMeta ? (sceneMeta.document || 'Fusion') : 'Fusion → WebXR'];
    if (sceneMeta) {
        lines.push((sceneMeta.format === 'glb'
            ? `${sceneMeta.bodies.length} Körper · ${sceneMeta.triangles.toLocaleString('de-DE')} Dreiecke`
            : 'OBJ-Export (Maßstab angenommen: cm)') + (roomLight ? ' · Raumlicht' : ''));
        lines.push(`Maßstab ${scaleLabel()}` + (sizeLabel() ? ` · ${sizeLabel()}` : ''));
    }
    lines.push(statusLine);
    menu.setInfo(lines);
    menu.setState({
        scaleLabel: scaleLabel(), mode: displayMode, upright, tool, explode,
        shadows: shadows.enabled, dims: dimensions.group.visible,
        section: section.enabled, sectionAxis: section.axis, xr: renderer.xr.isPresenting,
        remote: remote.available,
    });
    document.getElementById('status').textContent = lines.join('\n');
    // PIN-Feld auf der Seite nur, solange der Rückkanal fehlt (im Headset gibt es den Ziffernblock)
    document.getElementById('pair').hidden = remote.available || remote.state === 'unknown' || renderer.xr.isPresenting;
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
    es.onopen = () => {
        sseConnected = true;
        checkForUpdates();
        remote.check().then(() => { refreshParams(); updateMenu(); });
    };
    es.onerror = () => { sseConnected = false; };
    es.addEventListener('exporting', () => setStatus('Fusion exportiert...'));
    es.addEventListener('scene', () => checkForUpdates());
    // Eigener Name, weil 'error' bei EventSource für Verbindungsfehler reserviert ist
    es.addEventListener('exporterror', e => setStatus(JSON.parse(e.data).message, { sticky: true, error: true }));
    es.addEventListener('selection', e => {
        const d = JSON.parse(e.data);
        setSelection(d.paths, d.origin);
    });
    es.addEventListener('params', e => setParams(JSON.parse(e.data)));
    es.addEventListener('commanderror', e => {
        const d = JSON.parse(e.data);
        if (d.command === 'param') {
            for (const [name, local] of paramLocal) if (local.pending) paramLocal.delete(name);
            refreshParams();
        }
        setStatus(d.message, { error: true });
    });
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

function collectBodyNodes(obj) {
    const nodes = [];
    obj.traverse(o => { if (o.userData.kind === 'body') nodes.push(o); });
    // OBJ hat keine Metadaten: jedes Mesh ist ein Körper
    if (!nodes.length) obj.traverse(o => { if (o.isMesh) nodes.push(o); });
    return nodes;
}

function setContent(obj, meta) {
    const firstLoad = !sceneMeta;
    // Nur beim ersten Laden, nach Dokumentwechsel oder Formatwechsel neu zentrieren.
    // Sonst bleibt der Fusion-Ursprung stehen und vorhandene Geometrie springt nicht,
    // wenn etwas dazukommt.
    const recenter = firstLoad || meta.document !== sceneMeta.document || meta.format !== sceneMeta.format;
    if (!firstLoad && meta.document !== sceneMeta.document) {
        hiddenKeys.clear();
        soloKey = null;
        measure.clear();
    }
    highlight.visible = false;
    selectionView.clear();
    while (content.children.length) {
        const old = content.children[0];
        content.remove(old);
        disposeObject(old);
    }
    // Hüllquader im lokalen (unskalierten) Raum von modelGroup berechnen,
    // solange obj noch keinen Elternknoten hat
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    modelLocalBox = box.clone();
    if (recenter) content.position.copy(box.getCenter(new THREE.Vector3())).negate();
    content.add(obj);

    baseScale = meta.format === 'obj' ? 0.01 : 1;
    sceneMeta = meta;
    applyScale();

    bodyNodes = collectBodyNodes(obj);
    exploder.prepare(bodyNodes);
    applySelection(false);
    measure.remap(key => bodyNodes.find(n => bodyKey(n) === key));
    applyDisplayMode();
    section.setBox(sectionBox());
    section.apply(content);
    shadows.setMeshes(obj);
    dimensions.rebuild(box, unitToMm());

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
    shadows.surfaceY = null;
    anchorModel();
}

function recenterContent() {
    const obj = content.children[0];
    if (!obj) return;
    content.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    // setFromObject rechnet in Weltkoordinaten – zurück in den lokalen Raum von content
    box.applyMatrix4(content.matrixWorld.clone().invert());
    content.position.copy(box.getCenter(new THREE.Vector3())).negate();
    section.setBox(sectionBox());
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
        if (pressed(BTN_MENU)) toggleMenu();
        if (pressed(BTN_BODY)) {
            const p = pointers.find(q => q.source === source);
            if (source.handedness === 'left') hideBodies(p);
            else isolateBodies(p);
        }
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

// Zeiger fürs Platzieren: bevorzugt rechts
function placementPointer() {
    return pointers.find(p => p.source && p.source.handedness === 'right') || pointers.find(p => p.source) || null;
}

function updateXR() {
    const frame = renderer.xr.getFrame();
    const session = renderer.xr.getSession();
    if (!frame || !session) return;
    const refSpace = renderer.xr.getReferenceSpace();

    placement.pointer = placementPointer();
    placement.update(frame, refSpace, session, placement.pointer);

    const pose = anchors.update(frame, refSpace, session);
    // Solange gegriffen wird, bestimmt die Hand die Lage, sonst der Anker
    if (pose && !grabbing.size) {
        const s = new THREE.Vector3();
        pose.decompose(modelGroup.position, modelGroup.quaternion, s);
    }
}

function updateHighlight() {
    const m = menu.visible && menu.page === 'bodies' && /^body:hover:(\d+)$/.exec(menu.hovered || '');
    const node = m ? bodyNodes[Number(m[1])] : null;
    highlight.visible = !!(node && node.visible);
    if (highlight.visible) highlight.setFromObject(node);
}

function render() {
    if (renderer.xr.isPresenting && spawnFrames >= 0 && ++spawnFrames > SPAWN_WAIT_FRAMES) {
        spawnInFront();
        spawnFrames = -1;
    }

    handleButtons();
    updateXR();
    updateGrab();

    modelGroup.updateMatrixWorld(true);
    modelBox.setFromObject(content);
    updateWristButton();
    let hover = null;
    for (const p of pointers) {
        updatePinch(p);
        updatePointer(p);
        if (p.hit && p.hit.kind === 'menu') {
            const b = menu.buttonAt(p.hit.uv);
            hover = b ? b.id : null;
            // Regler ziehen
            if (p.dragSlider && b && b.id === p.dragSlider) onMenuButton(b.id, b.value);
        }
    }
    if (menu.visible) menu.setHover(hover);
    updateHighlight();

    section.update();
    selectionView.update(camera, section.enabled ? sectionPlanes : null);
    measure.update(unitToMm());
    dimensions.update(content.position, modelGroup.scale.x);
    shadows.update(modelBox, renderer.xr.isPresenting);
    toast.update(camera);

    renderer.render(scene, camera);
}
