## 2026-03-07 - Accessible 2D Toast Overlay in WebXR
**Learning:** Adding accessible 2D UI elements like toasts over a WebXR canvas requires placing them within a container bound to the `dom-overlay` feature.
The container needs `pointer-events: none` to pass clicks to the WebXR canvas, while interactive elements like the toast need `pointer-events: auto`.
Adding `role="status"` and `aria-live="polite"` to the toast makes it accessible to screen readers while using AR/VR. Placing the toast higher from the bottom (e.g., `bottom: 80px`) prevents visual overlap with the WebXR "Enter AR" button.
**Action:** Use the `dom-overlay` approach with appropriate `pointer-events` configuration and ARIA live regions whenever providing non-obtrusive, accessible status updates in WebXR applications.
