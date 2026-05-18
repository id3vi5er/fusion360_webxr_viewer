## 2024-05-17 - WebXR 3D Text Accessibility
**Learning:** 3D text meshes in WebXR are inherently inaccessible to screen readers.
**Action:** Use a DOM overlay with `pointer-events: none;` containing a visually hidden `.sr-only` `aria-live="polite"` region, and synchronize the 3D text updates to this 2D HTML element.
