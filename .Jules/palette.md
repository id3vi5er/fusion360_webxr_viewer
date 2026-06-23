## 2025-02-14 - Exposing 3D WebXR Text to Screen Readers
**Learning:** 3D text meshes (like canvas textures) used for state announcements are entirely inaccessible to screen readers in WebXR.
**Action:** Always use `dom-overlay` features in `ARButton` and synchronize visual 3D text state to a hidden `.sr-only` element with `aria-live` inside the overlay root.
