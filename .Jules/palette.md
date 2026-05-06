## 2024-05-06 - Accessible WebXR Status Updates
**Learning:** 3D text meshes in WebXR are completely inaccessible to screen readers.
**Action:** Always map important 3D status text to a hidden ARIA live region (e.g., using a `.sr-only` class) inside a WebXR `dom-overlay`. The `dom-overlay` root element must not use `display: none` but rather `pointer-events: none` to remain in the accessibility tree without blocking pointer events.
