## 2024-06-30 - WebXR Canvas Text Accessibility
**Learning:** Text rendered on a Three.js WebXR canvas is completely inaccessible to screen readers.
**Action:** Synchronize 3D/canvas text changes to a visually hidden (`.sr-only`) `aria-live` element inside a WebXR `dom-overlay`.
