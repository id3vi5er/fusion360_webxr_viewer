// XR-Funktionen der Quest 3: auf Flächen platzieren, Raumanker, Schatten, Raumlicht
import * as THREE from 'three';
import { XREstimatedLight } from 'three/addons/webxr/XREstimatedLight.js';

const UP = new THREE.Vector3(0, 1, 0);

// -----------------------------------------------------------------------------
// Platzieren: Hit-Test entlang des Zielstrahls; ohne Hit-Test auf den Boden (y = 0)
// -----------------------------------------------------------------------------
export class Placement {
    constructor(scene) {
        this.reticle = new THREE.Mesh(
            new THREE.RingGeometry(0.035, 0.05, 40).rotateX(-Math.PI / 2),
            new THREE.MeshBasicMaterial({ color: 0x00d26a, depthTest: false, transparent: true, opacity: 0.9 }));
        this.reticle.renderOrder = 997;
        this.reticle.matrixAutoUpdate = false;
        this.reticle.visible = false;
        scene.add(this.reticle);
        this.sources = new Map();     // XRInputSource -> XRHitTestSource | 'pending' | 'failed'
        this.active = false;
        this.hit = null;              // { position, normal, surface: 'floor' | 'wall' | 'ceiling' }
    }

    start() {
        this.active = true;
    }

    stop() {
        this.active = false;
        this.reticle.visible = false;
        this.hit = null;
        for (const s of this.sources.values()) if (s && s.cancel) s.cancel();
        this.sources.clear();
    }

    requestSource(session, inputSource) {
        if (this.sources.has(inputSource) || !session.requestHitTestSource) return;
        this.sources.set(inputSource, 'pending');
        session.requestHitTestSource({ space: inputSource.targetRaySpace })
            .then(s => this.active ? this.sources.set(inputSource, s) : s.cancel())
            .catch(() => this.sources.set(inputSource, 'failed'));
    }

    // pointer: { source, ctrl } – der Zeiger, mit dem gezielt wird
    update(frame, refSpace, session, pointer) {
        this.hit = null;
        if (!this.active || !pointer || !pointer.source) {
            this.reticle.visible = false;
            return;
        }
        this.requestSource(session, pointer.source);
        const hts = this.sources.get(pointer.source);
        if (frame && hts && hts.cancel) {
            const results = frame.getHitTestResults(hts);
            if (results.length) {
                const pose = results[0].getPose(refSpace);
                const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
                const position = new THREE.Vector3().setFromMatrixPosition(m);
                const normal = UP.clone().applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(m));
                this.hit = { position, normal, surface: surfaceType(normal) };
            }
        } else if (hts === 'failed' || !session.requestHitTestSource) {
            // Rückfall ohne Hit-Test: Schnittpunkt des Strahls mit dem Boden
            const origin = new THREE.Vector3().setFromMatrixPosition(pointer.ctrl.matrixWorld);
            const dir = new THREE.Vector3(0, 0, -1).transformDirection(pointer.ctrl.matrixWorld);
            if (dir.y < -0.05) {
                const t = -origin.y / dir.y;
                this.hit = { position: origin.addScaledVector(dir, t), normal: UP.clone(), surface: 'floor' };
            }
        }
        this.reticle.visible = !!this.hit;
        if (this.hit) {
            const q = new THREE.Quaternion().setFromUnitVectors(UP, this.hit.normal);
            this.reticle.matrix.compose(this.hit.position, q, new THREE.Vector3(1, 1, 1));
            this.reticle.material.color.set(SURFACE_COLORS[this.hit.surface]);
        }
    }
}

// Boden grün, Wand blau, Decke violett – so sieht man vor dem Drücken, wie das Modell landet
const SURFACE_COLORS = { floor: 0x00d26a, wall: 0x3d9bff, ceiling: 0xb46bff };

export function surfaceType(normal) {
    if (normal.y > 0.8) return 'floor';
    if (normal.y < -0.8) return 'ceiling';
    return 'wall';
}

// -----------------------------------------------------------------------------
// Raumanker: hält das Modell ortsfest und merkt sich den Platz je Dokument über Sitzungen hinweg
// -----------------------------------------------------------------------------
const STORAGE_PREFIX = 'fxr-anchor:';

function storageGet(key) {
    try { return JSON.parse(localStorage.getItem(STORAGE_PREFIX + key)); } catch (e) { return null; }
}

function storageSet(key, value) {
    try {
        if (value) localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
        else localStorage.removeItem(STORAGE_PREFIX + key);
    } catch (e) { /* privater Modus o. Ä. */ }
}

export class AnchorManager {
    constructor() {
        this.anchor = null;
        this.pending = null;          // { position, quaternion } – wird im nächsten Frame angelegt
        this.supported = null;        // null = unbekannt
        this.docKey = null;
        this.session = null;
        this.extra = {};              // wird mitgespeichert (z. B. Maßstab)
    }

    reset() {
        this.anchor = null;
        this.pending = null;
        this.session = null;
    }

    request(position, quaternion, extra = {}) {
        this.pending = { position: position.clone(), quaternion: quaternion.clone() };
        this.extra = extra;
    }

    // Liefert die aktuelle Ankerpose als Matrix oder null
    update(frame, refSpace, session) {
        this.session = session;
        if (!frame) return null;
        if (this.pending) {
            const { position: p, quaternion: q } = this.pending;
            this.pending = null;
            if (!frame.createAnchor) {
                this.supported = false;
            } else {
                const t = new XRRigidTransform({ x: p.x, y: p.y, z: p.z }, { x: q.x, y: q.y, z: q.z, w: q.w });
                frame.createAnchor(t, refSpace).then(anchor => {
                    const old = this.anchor;
                    this.anchor = anchor;
                    this.supported = true;
                    if (old && old.delete) old.delete();
                    this.persist(anchor);
                }).catch(() => { this.supported = false; });
            }
        }
        if (this.anchor && frame.trackedAnchors && frame.trackedAnchors.has(this.anchor)) {
            const pose = frame.getPose(this.anchor.anchorSpace, refSpace);
            if (pose) return new THREE.Matrix4().fromArray(pose.transform.matrix);
        }
        return null;
    }

    persist(anchor) {
        if (!this.docKey || !anchor.requestPersistentHandle) return;
        const key = this.docKey;
        anchor.requestPersistentHandle().then(uuid => {
            const prev = storageGet(key);
            if (prev && prev.uuid !== uuid && this.session && this.session.deletePersistentAnchor) {
                this.session.deletePersistentAnchor(prev.uuid).catch(() => {});
            }
            storageSet(key, { uuid, ...this.extra });
        }).catch(() => {});
    }

    hasStored(docKey) {
        return !!storageGet(docKey);
    }

    // Stellt den gespeicherten Anker wieder her; liefert die gespeicherten Zusatzwerte oder null
    async restore(session, docKey) {
        const stored = storageGet(docKey);
        if (!stored || !session.restorePersistentAnchor) return null;
        try {
            this.anchor = await session.restorePersistentAnchor(stored.uuid);
            this.supported = true;
            return stored;
        } catch (e) {
            storageSet(docKey, null);
            return null;
        }
    }
}

// -----------------------------------------------------------------------------
// Schatten auf die echte Fläche (Boden oder Platzierungsfläche)
// -----------------------------------------------------------------------------
export class Shadows {
    constructor(renderer, scene, light) {
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.light = light;
        light.shadow.mapSize.set(1024, 1024);
        light.shadow.bias = -0.0005;
        light.shadow.normalBias = 0.002;
        scene.add(light.target);
        this.catcher = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.35 }));
        this.catcher.receiveShadow = true;
        scene.add(this.catcher);
        this.enabled = true;
        this.surfaceY = null;         // Höhe der Platzierungsfläche, sonst Boden
        this.lightOffset = new THREE.Vector3(0.35, 1, 0.25).normalize();
    }

    setMeshes(obj) {
        obj.traverse(c => { if (c.isMesh) c.castShadow = true; });
    }

    update(box, presenting) {
        const on = this.enabled && !box.isEmpty();
        this.catcher.visible = on;
        this.light.castShadow = on;
        if (!on) return;
        const center = box.getCenter(new THREE.Vector3());
        const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.01);
        let y = this.surfaceY !== null ? this.surfaceY : presenting ? 0 : box.min.y;
        y = Math.min(y, box.min.y);
        this.catcher.position.set(center.x, y + 0.001, center.z);
        this.catcher.scale.setScalar(radius * 5);

        const dist = radius * 4 + 0.5;
        this.light.position.copy(center).addScaledVector(this.lightOffset, dist);
        this.light.target.position.copy(center);
        const cam = this.light.shadow.camera;
        cam.left = cam.bottom = -radius * 1.8;
        cam.right = cam.top = radius * 1.8;
        cam.near = 0.01;
        cam.far = dist + radius * 3;
        cam.updateProjectionMatrix();
    }
}

// -----------------------------------------------------------------------------
// Raumlicht (WebXR Light Estimation), falls der Browser es anbietet
// -----------------------------------------------------------------------------
export function setupLightEstimation(renderer, scene, mainLight, onChange) {
    const xrLight = new XREstimatedLight(renderer);
    let savedEnv = null;
    xrLight.addEventListener('estimationstart', () => {
        scene.add(xrLight);
        // Hauptlicht bleibt schwach für Schatten und Kontrast
        mainLight.intensity = 0.3;
        if (xrLight.environment) {
            savedEnv = scene.environment;
            scene.environment = xrLight.environment;
        }
        onChange(true);
    });
    xrLight.addEventListener('estimationend', () => {
        scene.remove(xrLight);
        mainLight.intensity = 1.0;
        if (savedEnv) scene.environment = savedEnv;
        onChange(false);
    });
    return xrLight;
}
