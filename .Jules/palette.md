
## 2024-06-16 - Make WebXR 3D Text Accessible
**Learning:** 3D text in WebXR is completely opaque to screen readers. We must use WebXR's `dom-overlay` to synchronize text updates to an invisible HTML ARIA live region.
**Action:** Always configure `ARButton` with a `dom-overlay` container (with `pointer-events: none`) containing `.sr-only` ARIA live elements for real-time 3D state updates.
