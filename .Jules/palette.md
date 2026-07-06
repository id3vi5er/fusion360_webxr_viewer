## 2024-07-06 - WebXR Screen Reader Accessibility
**Learning:** 3D text meshes in WebXR are inherently inaccessible to screen readers, but can be made accessible by synchronizing updates to a visually hidden 2D HTML element with ARIA attributes inside a `dom-overlay`.
**Action:** Use `optionalFeatures: ['dom-overlay']` in WebXR setup and mirror 3D state changes to `.sr-only` aria-live regions inside the overlay container.
