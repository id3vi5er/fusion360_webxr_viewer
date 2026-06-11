## 2024-05-24 - WebXR Screen Reader Accessibility
**Learning:** 3D text in WebXR is inaccessible to screen readers. To make status updates accessible, they must be synchronized to an `aria-live` region within a DOM overlay (with pointer-events disabled).
**Action:** Always enable `dom-overlay` in WebXR setups and sync text updates to a visually hidden (`.sr-only`) 2D HTML element.
