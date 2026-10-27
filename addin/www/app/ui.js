// VR-Oberfläche: Menü-Panel und Statusanzeige als Canvas-Texturen
import * as THREE from 'three';

const COLORS = {
    panel: 'rgba(18,20,24,0.92)',
    text: '#e8e8e8',
    dim: '#9aa0a6',
    accent: '#00d26a',
    button: '#2b2f36',
    hover: '#3d434c',
    active: '#00a352',
};

function canvasMesh(width, height, metersWide) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(metersWide, metersWide * height / width), mat);
    mesh.renderOrder = 999;
    return { canvas, ctx: canvas.getContext('2d'), tex, mesh };
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
}

// -----------------------------------------------------------------------------
// Menü: Info oben, darunter Schaltflächen. Bedienung per Strahl (uv -> Schaltfläche)
// -----------------------------------------------------------------------------
export class Menu {
    constructor() {
        const { canvas, ctx, tex, mesh } = canvasMesh(1024, 640, 0.42);
        Object.assign(this, { canvas, ctx, tex, mesh });
        mesh.userData.uiKind = 'menu';
        mesh.visible = false;
        this.info = [];
        this.state = {};
        this.hovered = null;
        this.buttons = [];

        const row = (y, label, items, x0 = 230, w = 180, gap = 14) => {
            this.buttons.push(...items.map((it, i) => ({ ...it, row: label, x: x0 + i * (w + gap), y, w, h: 92 })));
            return { label, y };
        };
        this.rows = [
            row(250, 'Maßstab', [
                { id: 'scale:1', label: '1:1' }, { id: 'scale:2', label: '1:2' },
                { id: 'scale:5', label: '1:5' }, { id: 'scale:10', label: '1:10' },
            ]),
            row(360, 'Ansicht', [
                { id: 'mode:normal', label: 'Normal' }, { id: 'mode:wire', label: 'Gitter' },
                { id: 'mode:xray', label: 'Röntgen' },
            ], 230, 246),
        ];
        this.buttons.push(
            { id: 'upright', label: 'Aufrecht', x: 30, y: 490, w: 300, h: 92 },
            { id: 'reset', label: 'Zurücksetzen', x: 350, y: 490, w: 330, h: 92 },
            { id: 'close', label: 'Schließen', x: 700, y: 490, w: 294, h: 92 },
        );
        this.draw();
    }

    get visible() { return this.mesh.visible; }

    setInfo(lines) {
        this.info = lines;
        if (this.visible) this.draw();
    }

    setState(state) {
        this.state = state;
        if (this.visible) this.draw();
    }

    buttonAt(uv) {
        const x = uv.x * this.canvas.width;
        const y = (1 - uv.y) * this.canvas.height;
        return this.buttons.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) || null;
    }

    setHover(id) {
        if (id === this.hovered) return;
        this.hovered = id;
        this.draw();
    }

    isActive(b) {
        const s = this.state;
        if (b.id.startsWith('scale:')) return s.scaleLabel === `1:${b.id.slice(6)}`;
        if (b.id.startsWith('mode:')) return s.mode === b.id.slice(5);
        if (b.id === 'upright') return !!s.upright;
        return false;
    }

    draw() {
        const { ctx, canvas } = this;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = COLORS.panel;
        roundRect(ctx, 0, 0, canvas.width, canvas.height, 28);

        const [title = '', ...rest] = this.info;
        ctx.fillStyle = COLORS.text;
        ctx.font = 'bold 44px sans-serif';
        ctx.fillText(title, 30, 64, canvas.width - 60);
        ctx.font = '32px sans-serif';
        ctx.fillStyle = COLORS.dim;
        rest.slice(0, 4).forEach((l, i) => ctx.fillText(l, 30, 112 + i * 40, canvas.width - 60));

        ctx.fillStyle = COLORS.dim;
        ctx.font = '34px sans-serif';
        for (const r of this.rows) ctx.fillText(r.label, 30, r.y + 58);

        ctx.textAlign = 'center';
        ctx.font = 'bold 36px sans-serif';
        for (const b of this.buttons) {
            const active = this.isActive(b);
            ctx.fillStyle = active ? COLORS.active : b.id === this.hovered ? COLORS.hover : COLORS.button;
            roundRect(ctx, b.x, b.y, b.w, b.h, 18);
            ctx.fillStyle = COLORS.text;
            const label = b.id === 'upright' ? `${b.label} ${this.state.upright ? 'an' : 'aus'}` : b.label;
            ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 13);
        }
        ctx.textAlign = 'left';
        this.tex.needsUpdate = true;
    }

    // Vor dem Kopf im Raum platzieren (weltfest, damit man mit dem Strahl zielen kann)
    openInFront(camera) {
        const camPos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        dir.y = 0;
        if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
        dir.normalize();
        this.mesh.position.copy(camPos).addScaledVector(dir, 0.55);
        this.mesh.position.y -= 0.12;
        this.mesh.lookAt(camPos);
        this.mesh.visible = true;
        this.draw();
    }

    close() {
        this.mesh.visible = false;
        this.hovered = null;
    }
}

// -----------------------------------------------------------------------------
// Statusanzeige: kopffest, blendet sich nach kurzer Zeit aus (Fehler bleiben stehen)
// -----------------------------------------------------------------------------
export class Toast {
    constructor() {
        const { canvas, ctx, tex, mesh } = canvasMesh(768, 96, 0.26);
        Object.assign(this, { canvas, ctx, tex, mesh });
        mesh.visible = false;
        this.hideAt = 0;
    }

    show(text, { sticky = false, error = false } = {}) {
        const { ctx, canvas } = this;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = COLORS.panel;
        roundRect(ctx, 0, 0, canvas.width, canvas.height, 24);
        ctx.fillStyle = error ? '#ff6b6b' : COLORS.accent;
        ctx.font = '40px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(text, canvas.width / 2, 62, canvas.width - 40);
        ctx.textAlign = 'left';
        this.tex.needsUpdate = true;
        this.mesh.visible = true;
        this.hideAt = sticky ? Infinity : performance.now() + 2500;
    }

    update(camera) {
        if (!this.mesh.visible) return;
        if (performance.now() > this.hideAt) {
            this.mesh.visible = false;
            return;
        }
        const offset = new THREE.Vector3(0, -0.14, -0.6).applyQuaternion(camera.quaternion);
        this.mesh.position.copy(camera.position).add(offset);
        this.mesh.quaternion.copy(camera.quaternion);
    }
}

// -----------------------------------------------------------------------------
// Menüknopf über dem linken Handgelenk (für Handtracking ohne Tasten)
// -----------------------------------------------------------------------------
export function createWristButton() {
    const { ctx, canvas, tex, mesh } = canvasMesh(128, 128, 0.04);
    ctx.fillStyle = COLORS.panel;
    ctx.beginPath();
    ctx.arc(64, 64, 62, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.accent;
    for (const y of [40, 60, 80]) ctx.fillRect(34, y, 60, 9);
    tex.needsUpdate = true;
    mesh.userData.uiKind = 'wrist';
    mesh.visible = false;
    return mesh;
}
