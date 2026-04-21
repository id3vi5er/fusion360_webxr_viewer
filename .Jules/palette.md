## 2024-04-21 - Make WebXR 3D text status accessible via ARIA live DOM overlay
**Learning:** 3D text in WebXR is inaccessible to screen readers because it is rendered on a WebGL canvas. It requires an HTML DOM overlay synchronized with the 3D text updates.
**Action:** Used an `aria-live` region inside a DOM overlay mapped to the ARButton configuration to announce status updates, while visually hiding it using a `.sr-only` utility class to prevent disrupting the 3D scene.
