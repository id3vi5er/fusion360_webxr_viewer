## 2024-05-24 - WebXR 3D Text Accessibility
**Learning:** 3D text meshes rendered in WebXR via canvas textures are inherently inaccessible to screen readers because they exist outside the DOM.
**Action:** Implement a WebXR `dom-overlay` containing an `aria-live` region (styled with `.sr-only` to hide it visually without removing it from the accessibility tree) to synchronize status text from the 3D scene to screen readers.
