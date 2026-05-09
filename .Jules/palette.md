## 2024-05-10 - Accessible Status Updates in WebXR
**Learning:** 3D text meshes in WebXR are inherently inaccessible to screen readers. WebXR sessions also hide standard DOM elements.
**Action:** Used the `dom-overlay` feature in WebXR to inject an invisible (`.sr-only`), ARIA live region (`aria-live="polite"`) that synchronizes with the 3D text updates to provide accessible status announcements.
