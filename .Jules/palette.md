## 2024-05-24 - WebXR 3D Text Accessibility via DOM Overlays
**Learning:** 3D text meshes in WebXR are inherently inaccessible to screen readers.
**Action:** To make them accessible, synchronize the 3D text changes to a visually hidden (`.sr-only`) 2D HTML element with ARIA attributes (e.g., `aria-live="polite"`) placed inside the WebXR `dom-overlay`. Make sure the overlay has `pointer-events: none;` to avoid blocking interactions.
