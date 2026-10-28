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
    disabled: '#1f2227',
};

export function canvasMesh(width, height, metersWide) {
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

// Text-Sprite, z. B. für Messwerte; behält seine Größe in der Welt
export function makeLabel(text, { color = '#ffffff', height = 0.022 } = {}) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 48px sans-serif';
    canvas.width = Math.ceil(ctx.measureText(text).width) + 40;
    canvas.height = 72;
    ctx.fillStyle = 'rgba(18,20,24,0.85)';
    roundRect(ctx, 0, 0, canvas.width, canvas.height, 18);
    ctx.font = 'bold 48px sans-serif';
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 20, canvas.height / 2 + 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    sprite.renderOrder = 998;
    sprite.userData.baseScale = new THREE.Vector2(height * canvas.width / canvas.height, height);
    sprite.scale.set(sprite.userData.baseScale.x, sprite.userData.baseScale.y, 1);
    return sprite;
}

const BODY_ROWS = 6;

// -----------------------------------------------------------------------------
// Menü: Info oben, Reiter, darunter Schaltflächen der aktiven Seite.
// Bedienung per Strahl (uv -> Schaltfläche bzw. Reglerwert)
// -----------------------------------------------------------------------------
export class Menu {
    constructor() {
        const { canvas, ctx, tex, mesh } = canvasMesh(1024, 760, 0.44);
        Object.assign(this, { canvas, ctx, tex, mesh });
        mesh.userData.uiKind = 'menu';
        mesh.visible = false;
        this.info = [];
        this.state = {};
        this.hovered = null;
        this.page = 'view';
        this.bodies = [];
        this.bodyPage = 0;
        this.buildStatic();
        this.layout();
    }

    get visible() { return this.mesh.visible; }

    buildStatic() {
        const H = 92;
        const btn = (page, id, label, x, y, w) => ({ page, id, label, x, y, w, h: H });
        const tabs = [['view', 'Ansicht'], ['tools', 'Werkzeuge'], ['bodies', 'Bauteile']]
            .map(([p, label], i) => ({ id: `page:${p}`, label, x: 30 + i * 328, y: 176, w: 312, h: 76 }));
        const row = (page, y, items, x0, w, gap = 14) =>
            items.map(([id, label], i) => btn(page, id, label, x0 + i * (w + gap), y, w));

        this.rowLabels = {
            view: [['Maßstab', 280], ['Ansicht', 390]],
            tools: [['Explosion', 390], ['Schnitt', 500]],
            bodies: [],
        };
        this.staticButtons = [
            ...tabs,
            ...row('view', 280, [['scale:1', '1:1'], ['scale:2', '1:2'], ['scale:5', '1:5'], ['scale:10', '1:10']], 230, 180),
            ...row('view', 390, [['mode:normal', 'Normal'], ['mode:wire', 'Gitter'], ['mode:xray', 'Röntgen']], 230, 246),
            ...row('view', 500, [['upright', 'Aufrecht'], ['shadows', 'Schatten'], ['dims', 'Maße']], 30, 309),
            ...row('view', 610, [['reset', 'Zurücksetzen'], ['close', 'Schließen']], 30, 474),

            ...row('tools', 280, [['tool:grab', 'Greifen'], ['tool:place', 'Platzieren'], ['tool:measure', 'Messen'], ['section', 'Schnitt']], 30, 230),
            { page: 'tools', id: 'explode', kind: 'slider', x: 230, y: 400, w: 764, h: 72 },
            ...row('tools', 500, [['axis:x', 'X'], ['axis:y', 'Y'], ['axis:z', 'Z'], ['flip', 'Umdrehen']], 230, 176),
            ...row('tools', 610, [['clearMeasure', 'Messungen löschen'], ['close', 'Schließen']], 30, 474),

            ...row('bodies', 652, [['bodies:prev', '◀'], ['bodies:next', '▶'], ['bodies:all', 'Alle zeigen']], 30, 200),
        ];
    }

    // Bauteilzeilen hängen von Liste und Seite ab
    layout() {
        const rows = [];
        const start = this.bodyPage * BODY_ROWS;
        this.bodies.slice(start, start + BODY_ROWS).forEach((b, i) => {
            const y = 270 + i * 62;
            const idx = start + i;
            rows.push({ page: 'bodies', id: `body:hover:${idx}`, kind: 'row', label: b.name, sub: b.sub, x: 30, y, w: 640, h: 54, body: idx });
            rows.push({ page: 'bodies', id: `body:toggle:${idx}`, label: b.visible ? 'An' : 'Aus', x: 684, y, w: 140, h: 54, body: idx, on: b.visible });
            rows.push({ page: 'bodies', id: `body:solo:${idx}`, label: 'Nur', x: 838, y, w: 156, h: 54, body: idx, on: b.solo });
        });
        this.buttons = [...this.staticButtons, ...rows];
    }

    setInfo(lines) {
        this.info = lines;
        if (this.visible) this.draw();
    }

    setState(state) {
        this.state = state;
        if (this.visible) this.draw();
    }

    setBodies(bodies) {
        this.bodies = bodies;
        this.bodyPage = Math.min(this.bodyPage, Math.max(0, Math.ceil(bodies.length / BODY_ROWS) - 1));
        this.layout();
        if (this.visible) this.draw();
    }

    setPage(page) {
        this.page = page;
        this.draw();
    }

    flipBodyPage(delta) {
        const pages = Math.max(1, Math.ceil(this.bodies.length / BODY_ROWS));
        this.bodyPage = (this.bodyPage + delta + pages) % pages;
        this.layout();
        this.draw();
    }

    // Liefert { id, value } – value nur bei Reglern (0..1)
    buttonAt(uv) {
        const x = uv.x * this.canvas.width;
        const y = (1 - uv.y) * this.canvas.height;
        const b = this.buttons.find(b => (!b.page || b.page === this.page) &&
            x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
        if (!b) return null;
        return b.kind === 'slider' ? { id: b.id, value: THREE.MathUtils.clamp((x - b.x) / b.w, 0, 1) } : { id: b.id, body: b.body };
    }

    setHover(id) {
        if (id === this.hovered) return;
        this.hovered = id;
        this.draw();
    }

    isActive(b) {
        const s = this.state;
        const id = b.id;
        if (id.startsWith('page:')) return this.page === id.slice(5);
        if (id.startsWith('scale:')) return s.scaleLabel === `1:${id.slice(6)}`;
        if (id.startsWith('mode:')) return s.mode === id.slice(5);
        if (id.startsWith('tool:')) return s.tool === id.slice(5);
        if (id.startsWith('axis:')) return s.section && s.sectionAxis === id.slice(5);
        if (id.startsWith('body:')) return !!b.on;
        if (['upright', 'shadows', 'dims', 'section'].includes(id)) return !!s[id];
        return false;
    }

    isDisabled(b) {
        const s = this.state;
        if (b.id.startsWith('axis:') || b.id === 'flip') return !s.section;
        if (b.id === 'shadows') return s.shadowsAvailable === false;
        if (b.id === 'tool:place') return !s.xr;
        return false;
    }

    labelFor(b) {
        const s = this.state;
        if (['upright', 'shadows', 'dims', 'section'].includes(b.id)) return `${b.label} ${s[b.id] ? 'an' : 'aus'}`;
        return b.label;
    }

    draw() {
        const { ctx, canvas } = this;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = COLORS.panel;
        roundRect(ctx, 0, 0, canvas.width, canvas.height, 28);

        const [title = '', ...rest] = this.info;
        ctx.fillStyle = COLORS.text;
        ctx.font = 'bold 42px sans-serif';
        ctx.fillText(title, 30, 58, canvas.width - 60);
        ctx.font = '30px sans-serif';
        ctx.fillStyle = COLORS.dim;
        rest.slice(0, 3).forEach((l, i) => ctx.fillText(l, 30, 94 + i * 31, canvas.width - 60));

        ctx.fillStyle = COLORS.dim;
        ctx.font = '32px sans-serif';
        for (const [label, y] of this.rowLabels[this.page]) ctx.fillText(label, 30, y + 56);

        if (this.page === 'bodies') {
            const pages = Math.max(1, Math.ceil(this.bodies.length / BODY_ROWS));
            ctx.fillText(`Seite ${this.bodyPage + 1} / ${pages} · ${this.bodies.length} Körper`, 690, 708);
            if (!this.bodies.length) ctx.fillText('Keine Körper geladen', 30, 320);
        }

        for (const b of this.buttons) {
            if (b.page && b.page !== this.page) continue;
            if (b.kind === 'slider') { this.drawSlider(b); continue; }
            const disabled = this.isDisabled(b);
            ctx.fillStyle = disabled ? COLORS.disabled
                : this.isActive(b) ? COLORS.active
                : b.id === this.hovered ? COLORS.hover : COLORS.button;
            roundRect(ctx, b.x, b.y, b.w, b.h, 16);
            ctx.fillStyle = disabled ? '#555a61' : COLORS.text;
            if (b.kind === 'row') {
                ctx.font = '30px sans-serif';
                ctx.fillText(b.label, b.x + 18, b.y + 37, b.w - 36);
                continue;
            }
            ctx.textAlign = 'center';
            ctx.font = `bold ${b.h < 80 ? 30 : 34}px sans-serif`;
            ctx.fillText(this.labelFor(b), b.x + b.w / 2, b.y + b.h / 2 + 12, b.w - 16);
            ctx.textAlign = 'left';
        }
        this.tex.needsUpdate = true;
    }

    drawSlider(b) {
        const { ctx } = this;
        const v = this.state[b.id] || 0;
        ctx.fillStyle = b.id === this.hovered ? COLORS.hover : COLORS.button;
        roundRect(ctx, b.x, b.y + b.h / 2 - 10, b.w, 20, 10);
        ctx.fillStyle = COLORS.active;
        roundRect(ctx, b.x, b.y + b.h / 2 - 10, Math.max(20, b.w * v), 20, 10);
        ctx.beginPath();
        ctx.arc(b.x + b.w * v, b.y + b.h / 2, 26, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.text;
        ctx.fill();
        ctx.fillStyle = COLORS.dim;
        ctx.font = '28px sans-serif';
        ctx.fillText(`${Math.round(v * 100)} %`, 30, b.y + b.h / 2 + 46);
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
    const { ctx, tex, mesh } = canvasMesh(128, 128, 0.04);
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
