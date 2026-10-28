// Werkzeuge am Modell: Explosionsansicht, Maße, Messen, Schnittebene
import * as THREE from 'three';
import { makeLabel } from './ui.js';

const tmpBox = new THREE.Box3();

// Hüllquader eines Objekts im lokalen Raum von `space`
function boxIn(space, obj) {
    space.updateMatrixWorld(true);
    return tmpBox.setFromObject(obj).clone().applyMatrix4(space.matrixWorld.clone().invert());
}

// Sprites in einer skalierten Gruppe sollen in der Welt gleich groß bleiben
function keepWorldSize(sprite, worldScale) {
    const b = sprite.userData.baseScale;
    sprite.scale.set(b.x / worldScale, b.y / worldScale, 1);
}

// -----------------------------------------------------------------------------
// Explosionsansicht: Körper wandern proportional zu ihrem Abstand vom Modellzentrum nach außen
// -----------------------------------------------------------------------------
export class Exploder {
    constructor(content) {
        this.content = content;
        this.parts = [];
        this.factor = 0;
        this.strength = 1.5;
    }

    prepare(nodes) {
        const content = this.content;
        content.updateMatrixWorld(true);
        const toContent = content.matrixWorld.clone().invert();
        const total = new THREE.Box3();
        const centers = nodes.map(n => {
            const b = boxIn(content, n);
            total.union(b);
            return b.getCenter(new THREE.Vector3());
        });
        const c0 = total.getCenter(new THREE.Vector3());
        this.parts = nodes.map((node, i) => {
            const dirContent = centers[i].clone().sub(c0);
            // Richtung in den Raum des Elternknotens übertragen (dort wird position gesetzt)
            const parentToContent = toContent.clone().multiply(node.parent.matrixWorld);
            const contentToParent = parentToContent.clone().invert();
            const a = c0.clone().applyMatrix4(contentToParent);
            const b = c0.clone().add(dirContent).applyMatrix4(contentToParent);
            return { node, basePos: node.position.clone(), dirParent: b.sub(a), dirContent };
        });
        this.set(this.factor);
    }

    set(factor) {
        this.factor = factor;
        const k = factor * this.strength;
        for (const p of this.parts) p.node.position.copy(p.basePos).addScaledVector(p.dirParent, k);
    }

    // Verschiebung eines Körpers (oder seines Vorfahren) im Raum von content
    offsetOf(obj) {
        for (let o = obj; o && o !== this.content; o = o.parent) {
            const p = this.parts.find(p => p.node === o);
            if (p) return p.dirContent.clone().multiplyScalar(this.factor * this.strength);
        }
        return new THREE.Vector3();
    }
}

// -----------------------------------------------------------------------------
// Maße: Hüllquader mit Kantenlängen in mm
// -----------------------------------------------------------------------------
export class Dimensions {
    constructor(modelGroup) {
        // Liegt neben content in modelGroup, weil content beim Neuladen geleert wird
        this.group = new THREE.Group();
        this.group.visible = false;
        modelGroup.add(this.group);
    }

    rebuild(box, unitToMm) {
        this.group.clear();
        if (box.isEmpty()) return;
        const helper = new THREE.Box3Helper(box, 0x00d26a);
        helper.material.depthTest = false;
        helper.material.transparent = true;
        helper.material.opacity = 0.8;
        helper.renderOrder = 997;
        this.group.add(helper);
        const size = box.getSize(new THREE.Vector3());
        const c = box.getCenter(new THREE.Vector3());
        const { min, max } = box;
        const edges = [
            [size.x, new THREE.Vector3(c.x, min.y, max.z)],
            [size.y, new THREE.Vector3(max.x, c.y, max.z)],
            [size.z, new THREE.Vector3(max.x, min.y, c.z)],
        ];
        for (const [len, pos] of edges) {
            const label = makeLabel(`${Math.round(len * unitToMm)} mm`, { color: '#7dffb5' });
            label.position.copy(pos);
            this.group.add(label);
        }
    }

    update(contentPosition, worldScale) {
        if (!this.group.visible) return;
        this.group.position.copy(contentPosition);
        for (const c of this.group.children) if (c.isSprite) keepWorldSize(c, worldScale);
    }
}

// -----------------------------------------------------------------------------
// Messen: zwei Punkte am Modell, rastet an Ecken und Kantenmitten ein.
// Punkte hängen am getroffenen Körper und wandern mit (auch in der Explosionsansicht);
// gemessen wird immer am nicht explodierten Modell.
// -----------------------------------------------------------------------------
const SNAP_DISTANCE = 0.008;   // Meter in der Welt

export class MeasureTool {
    constructor(scene, content, exploder) {
        this.content = content;
        this.exploder = exploder;
        this.group = new THREE.Group();
        scene.add(this.group);
        this.items = [];
        this.pending = null;
        this.markerGeo = new THREE.SphereGeometry(0.004, 12, 8);
        this.markerMat = new THREE.MeshBasicMaterial({ color: 0xffd400, depthTest: false });
    }

    snap(hit) {
        const p = hit.point.clone();
        const obj = hit.object;
        if (!hit.face || !obj.geometry) return p;
        const pos = obj.geometry.attributes.position;
        const v = [hit.face.a, hit.face.b, hit.face.c].map(i => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld));
        const candidates = [...v, v[0].clone().lerp(v[1], 0.5), v[1].clone().lerp(v[2], 0.5), v[2].clone().lerp(v[0], 0.5)];
        let best = null;
        for (const c of candidates) {
            const d = c.distanceTo(p);
            if (d < SNAP_DISTANCE && (!best || d < best.d)) best = { c, d };
        }
        return best ? best.c : p;
    }

    marker() {
        const m = new THREE.Mesh(this.markerGeo, this.markerMat);
        m.renderOrder = 998;
        this.group.add(m);
        return m;
    }

    // ref: { obj, key, local } – key erlaubt das Wiederfinden nach einem Neuladen
    addPoint(hit, keyOf) {
        const world = this.snap(hit);
        const ref = { obj: hit.object, key: keyOf(hit.object), local: hit.object.worldToLocal(world.clone()) };
        if (!this.pending) {
            this.pending = { ref, marker: this.marker() };
            return null;
        }
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
            new THREE.LineBasicMaterial({ color: 0xffd400, depthTest: false }));
        line.renderOrder = 998;
        line.frustumCulled = false;
        this.group.add(line);
        const item = { a: this.pending.ref, b: ref, markers: [this.pending.marker, this.marker()], line, label: null };
        this.pending = null;
        this.items.push(item);
        return item;
    }

    // Punkt im Raum von content, ohne Explosionsverschiebung
    modelPoint(ref) {
        const w = ref.obj.localToWorld(ref.local.clone());
        return this.content.worldToLocal(w).sub(this.exploder.offsetOf(ref.obj));
    }

    distanceMm(item, unitToMm) {
        return this.modelPoint(item.a).distanceTo(this.modelPoint(item.b)) * unitToMm;
    }

    // Nach einem Neuladen die Körper über ihren Schlüssel neu zuordnen
    remap(findByKey) {
        const fix = ref => { const o = findByKey(ref.key); if (o) ref.obj = o; return !!o; };
        if (this.pending && !fix(this.pending.ref)) this.cancelPending();
        this.items = this.items.filter(it => {
            if (fix(it.a) && fix(it.b)) return true;
            this.disposeItem(it);
            return false;
        });
    }

    update(unitToMm) {
        if (this.pending) this.pending.marker.position.copy(this.pending.ref.obj.localToWorld(this.pending.ref.local.clone()));
        for (const it of this.items) {
            const a = it.a.obj.localToWorld(it.a.local.clone());
            const b = it.b.obj.localToWorld(it.b.local.clone());
            it.markers[0].position.copy(a);
            it.markers[1].position.copy(b);
            it.line.geometry.attributes.position.setXYZ(0, a.x, a.y, a.z);
            it.line.geometry.attributes.position.setXYZ(1, b.x, b.y, b.z);
            it.line.geometry.attributes.position.needsUpdate = true;
            const text = `${this.distanceMm(it, unitToMm).toFixed(1).replace('.', ',')} mm`;
            if (!it.label || it.label.userData.text !== text) {
                if (it.label) { this.group.remove(it.label); it.label.material.map.dispose(); }
                it.label = makeLabel(text, { color: '#ffd400' });
                it.label.userData.text = text;
                this.group.add(it.label);
            }
            it.label.position.copy(a).lerp(b, 0.5);
            it.label.position.y += 0.015;
        }
    }

    cancelPending() {
        if (this.pending) this.group.remove(this.pending.marker);
        this.pending = null;
    }

    disposeItem(it) {
        this.group.remove(it.line, ...it.markers);
        it.line.geometry.dispose();
        if (it.label) { this.group.remove(it.label); it.label.material.map.dispose(); }
    }

    clear() {
        this.cancelPending();
        this.items.forEach(it => this.disposeItem(it));
        this.items = [];
    }
}

// -----------------------------------------------------------------------------
// Schnittebene: greifbares Rechteck in modelGroup, schneidet alle Modellmaterialien
// -----------------------------------------------------------------------------
export class SectionTool {
    constructor(modelGroup) {
        this.modelGroup = modelGroup;
        this.plane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
        this.enabled = false;
        this.axis = 'x';
        this.flipped = false;
        this.box = new THREE.Box3();

        this.gizmo = new THREE.Group();
        const fill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
            new THREE.MeshBasicMaterial({ color: 0x00d26a, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
        fill.userData.uiKind = 'section';
        const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
            new THREE.LineBasicMaterial({ color: 0x00d26a }));
        this.gizmo.add(fill, frame);
        this.handle = fill;
        this.gizmo.visible = false;
        modelGroup.add(this.gizmo);
    }

    // box: Hüllquader im Raum von modelGroup
    setBox(box) {
        this.box.copy(box);
        if (this.enabled) this.setAxis(this.axis);
    }

    setAxis(axis) {
        this.axis = axis;
        const size = this.box.getSize(new THREE.Vector3());
        const c = this.box.getCenter(new THREE.Vector3());
        const g = this.gizmo;
        g.position.copy(c);
        g.rotation.set(0, 0, 0);
        // Normale der Ebene ist +Z des Gizmos
        if (axis === 'x') { g.rotation.y = Math.PI / 2; g.scale.set(size.z * 1.2, size.y * 1.2, 1); }
        if (axis === 'y') { g.rotation.x = -Math.PI / 2; g.scale.set(size.x * 1.2, size.z * 1.2, 1); }
        if (axis === 'z') { g.scale.set(size.x * 1.2, size.y * 1.2, 1); }
        g.scale.x = Math.max(g.scale.x, 1e-3);
        g.scale.y = Math.max(g.scale.y, 1e-3);
    }

    setEnabled(on, content) {
        this.enabled = on;
        this.gizmo.visible = on;
        if (on) this.setAxis(this.axis);
        this.apply(content);
    }

    flip() {
        this.flipped = !this.flipped;
    }

    update() {
        if (!this.enabled) return;
        this.gizmo.updateMatrixWorld(true);
        const q = new THREE.Quaternion();
        const p = new THREE.Vector3();
        this.gizmo.matrixWorld.decompose(p, q, new THREE.Vector3());
        // Sichtbar bleibt die Seite, in die die Normale zeigt
        const normal = new THREE.Vector3(0, 0, this.flipped ? 1 : -1).applyQuaternion(q);
        this.plane.setFromNormalAndCoplanarPoint(normal, p);
    }

    apply(content) {
        content.traverse(c => {
            if (!c.isMesh) return;
            for (const m of [].concat(c.material)) {
                if (m.userData.origSide === undefined) m.userData.origSide = m.side;
                m.clippingPlanes = this.enabled ? [this.plane] : null;
                m.clipShadows = this.enabled;
                // Rückseiten zeigen, damit der Schnitt nicht hohl wirkt
                m.side = this.enabled ? THREE.DoubleSide : m.userData.origSide;
                m.needsUpdate = true;
            }
        });
    }
}
