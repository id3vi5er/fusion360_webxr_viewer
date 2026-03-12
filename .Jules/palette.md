## 2024-05-17 - Accessible Status Updates in WebXR
**Learning:** In Three.js WebXR applications, 3D text meshes (like the debug panel) are not accessible to screen readers. For accessible status updates (like loading states or interaction feedback), standard HTML elements with appropriate ARIA attributes (e.g., `role="status"`, `aria-live="polite"`) must be used.
**Action:** Use the WebXR `dom-overlay` feature to display an accessible 2D HTML layer on top of the AR view, keeping standard HTML elements available to assistive technologies during the AR session.
