## 2024-05-24 - WebXR Text Accessibility
**Learning:** 3D text meshes rendered in Three.js/WebXR are completely inaccessible to screen readers, making status updates invisible to visually impaired users.
**Action:** Always implement a 2D HTML element with appropriate ARIA attributes (like `role="status"` and `aria-live="polite"`) inside a WebXR `dom-overlay` to mirror critical 3D status text to an accessible 2D layer.
