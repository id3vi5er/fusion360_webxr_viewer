## 2024-05-25 - Accessible Notifications in WebXR
**Learning:** WebXR applications often render text inside the 3D scene (e.g., via CanvasTexture on a Plane), which makes status updates completely invisible to screen readers.
**Action:** Use the WebXR `dom-overlay` feature to map a 2D HTML container over the AR view. Inside it, place accessible elements like a toast notification with `role="status"` and `aria-live="polite"` to announce state changes (e.g., "Model loaded", "Scale: 2 Hands") both visually and audibly.
