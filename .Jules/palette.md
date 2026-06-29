## 2024-11-20 - WebXR Screen Reader Accessibility
**Learning:** To make 3D text meshes in WebXR accessible to screen readers, synchronize the 3D text changes to a visually hidden (`.sr-only`) 2D HTML element with ARIA attributes (e.g., `aria-live="polite"`) placed inside the WebXR `dom-overlay`.
**Action:** When implementing WebXR UI, always use `optionalFeatures: ['dom-overlay']` and bind an ARIA live region to announce 3D textual state changes.
