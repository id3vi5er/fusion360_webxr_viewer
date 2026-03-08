## 2025-02-19 - Accessible AR Status Toasts
**Learning:** In WebXR applications built with Three.js, adding accessible 2D UI elements (like status messages) requires using the `dom-overlay` feature. 3D text meshes are not accessible to screen readers.
**Action:** Always enable `optionalFeatures: ['dom-overlay']` when creating the `ARButton` and map a DOM container with `pointer-events: none` as the root. Add interactive/readable children inside with `pointer-events: auto`, `role="status"`, and `aria-live="polite"` to provide accessible, visible feedback.
