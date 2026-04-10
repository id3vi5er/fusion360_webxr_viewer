## 2024-04-10 - Screen reader accessibility for WebXR status updates
**Learning:** In Three.js WebXR applications, 3D text (like the debug plane) is completely invisible to screen readers. To make AR status updates accessible, you must use a standard HTML element with `aria-live` inside a `dom-overlay` configured via `ARButton`, and visually hide it using `.sr-only` CSS to avoid disrupting the immersive view.
**Action:** Always implement a hidden `aria-live` region in the `dom-overlay` when building WebXR applications that rely on visual status updates or tooltips to ensure equitable access.
