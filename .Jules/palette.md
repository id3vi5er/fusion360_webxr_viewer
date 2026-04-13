## 2024-05-18 - WebXR Accessibility
**Learning:** 3D text meshes in WebXR are inherently inaccessible to screen readers.
**Action:** Use WebXR DOM overlays with a visually hidden (`.sr-only`) `aria-live="polite"` element synchronized to the 3D text to provide accessible status updates.
