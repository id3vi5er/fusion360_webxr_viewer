## 2024-05-27 - Accessible WebXR Status Updates
**Learning:** 3D text meshes in WebXR are inherently inaccessible to screen readers. DOM overlays must be used to provide an accessible `aria-live` region synced with 3D status updates.
**Action:** Configure `ARButton` with `dom-overlay` and include a visually hidden `.sr-only` ARIA live region inside a pointer-events-disabled root overlay container.
