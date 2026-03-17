## 2024-03-17 - WebXR 3D Text Accessibility
**Learning:** 3D text meshes rendered in WebXR via Three.js are completely invisible to screen readers, making status updates entirely inaccessible.
**Action:** When displaying text status updates in WebXR, always pair them with a 2D HTML element inside a `dom-overlay` that uses appropriate ARIA attributes (`role="status"`, `aria-live="polite"`) to ensure the updates are announced to assistive technologies.
