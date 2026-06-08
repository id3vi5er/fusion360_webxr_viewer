## 2024-06-08 - WebXR Status Screen Reader Support
**Learning:** 3D text meshes in WebXR are inherently inaccessible to screen readers. Using a DOM overlay with `aria-live="polite"` inside an `.sr-only` class synchronizes status changes from 3D to 2D HTML without breaking AR immersion.
**Action:** When creating WebXR applications with status updates, implement a synchronized 2D DOM overlay to make them accessible, ensuring the overlay root uses `pointer-events: none` and `.sr-only` content rather than `display: none`.
