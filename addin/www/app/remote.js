// Rückkanal zu Fusion: Befehle per POST (mit Schlüssel) und Anzeige der Fusion-Auswahl
import * as THREE from 'three';

const KEY_STORAGE = 'fxr-key';

// Schlüssel aus ?k= übernehmen und merken – danach reicht die Adresse ohne Schlüssel
function readKey() {
    const fromUrl = new URLSearchParams(location.search).get('k');
    try {
        if (fromUrl) localStorage.setItem(KEY_STORAGE, fromUrl);
        return fromUrl || localStorage.getItem(KEY_STORAGE);
    } catch (e) {
        return fromUrl;
    }
}

const STATE_MESSAGES = {
    nokey: 'Rückkanal aus: Parameter → „Mit PIN koppeln“',
    badkey: 'Kopplung ungültig: Parameter → „Mit PIN koppeln“',
    offline: 'Fusion nicht erreichbar',
};

export class Remote {
    constructor() {
        this.key = readKey();
        this.state = this.key ? 'unknown' : 'nokey';   // unknown | ok | nokey | badkey | offline
    }

    get available() { return this.state === 'ok'; }
    get message() { return STATE_MESSAGES[this.state] || ''; }

    // PIN aus der Fusion-Startmeldung gegen den Schlüssel tauschen; liefert { ok, message }
    async pair(pin) {
        try {
            const res = await fetch('./api/pair', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.key) return { ok: false, message: data.error || 'Fusion nicht erreichbar' };
            this.key = data.key;
            try { localStorage.setItem(KEY_STORAGE, data.key); } catch (e) { /* privater Modus */ }
            this.state = 'ok';
            return { ok: true };
        } catch (e) {
            return { ok: false, message: 'Fusion nicht erreichbar' };
        }
    }

    async check() {
        if (this.key) await this.send('check', {});
        return this.available;
    }

    // Antwort 202 heißt nur „angenommen“; das Ergebnis kommt per SSE (selection, params, commanderror)
    async send(name, body) {
        if (!this.key) return { ok: false, message: this.message };
        try {
            const res = await fetch(`./api/${name}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-FXR-Key': this.key },
                body: JSON.stringify(body),
            });
            // 400/404/413 kommen vom Add-in selbst; alles andere (z. B. 501 eines reinen Dateiservers) heißt: kein Rückkanal
            this.state = res.status === 403 ? 'badkey' : res.ok || [400, 404, 413].includes(res.status) ? 'ok' : 'offline';
            if (res.ok) return { ok: true };
            const data = await res.json().catch(() => ({}));
            return { ok: false, message: res.status === 403 ? this.message : data.error || `Fehler ${res.status}` };
        } catch (e) {
            this.state = 'offline';
            return { ok: false, message: this.message };
        }
    }
}

// -----------------------------------------------------------------------------
// Auswahl aus Fusion: Kanten der Körper in Akzentfarbe, Pfeil, wenn sie außer Sicht ist
// -----------------------------------------------------------------------------
const ARROW_SECONDS = 10;

export class SelectionView {
    constructor(scene) {
        this.material = new THREE.LineBasicMaterial({ color: 0x00e5ff, depthTest: false, transparent: true, opacity: 0.95 });
        this.overlays = [];
        this.nodes = [];
        this.changedAt = 0;
        this.arrow = new THREE.Mesh(
            new THREE.ConeGeometry(0.012, 0.035, 16).rotateX(Math.PI / 2),   // Spitze nach +Z, passend zu lookAt
            new THREE.MeshBasicMaterial({ color: 0x00e5ff, depthTest: false }));
        this.arrow.renderOrder = 999;
        this.arrow.visible = false;
        scene.add(this.arrow);
        this.frustum = new THREE.Frustum();
    }

    clear() {
        for (const line of this.overlays) {
            line.removeFromParent();
            line.geometry.dispose();
        }
        this.overlays = [];
        this.nodes = [];
    }

    // fresh: neue Auswahl – der Pfeil erscheint nur dann, nicht nach jedem Neuladen des Modells
    set(nodes, fresh = true) {
        this.clear();
        this.nodes = nodes;
        if (fresh) this.changedAt = performance.now();
        for (const node of nodes) {
            node.traverse(mesh => {
                if (!mesh.isMesh) return;
                const line = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 30), this.material);
                line.renderOrder = 996;
                line.raycast = () => {};   // sonst treffen Strahl und Messwerkzeug die Linien
                mesh.add(line);
                this.overlays.push(line);
            });
        }
    }

    update(camera, clippingPlanes) {
        if (this.material.clippingPlanes !== clippingPlanes) {
            this.material.clippingPlanes = clippingPlanes;
            this.material.needsUpdate = true;
        }
        this.arrow.visible = false;
        const visible = this.nodes.filter(n => isVisibleInScene(n));
        if (!visible.length || performance.now() - this.changedAt > ARROW_SECONDS * 1000) return;
        const box = new THREE.Box3();
        visible.forEach(n => box.expandByObject(n));
        camera.updateMatrixWorld();
        this.frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
        if (this.frustum.intersectsBox(box)) return;
        // Kopffest unten in der Mitte, zeigt in Richtung der Auswahl
        this.arrow.position.set(0, -0.08, -0.45).applyMatrix4(camera.matrixWorld);
        this.arrow.lookAt(box.getCenter(new THREE.Vector3()));
        this.arrow.visible = true;
    }
}

function isVisibleInScene(obj) {
    for (let o = obj; o; o = o.parent) if (!o.visible) return false;
    return true;
}
