# Fusion 360 to WebXR (AR/VR) Streaming

This project implements a pipeline to export 3D models from Autodesk Fusion 360 and visualize them in Augmented Reality (Passthrough) on the Meta Quest 3 using WebXR.

## 📂 Project Structure

*   **`addin/`**: Contains the Fusion 360 Python script and manifest.
    *   `FusionToWebXR.py`: The main script that exports the active design. It generates `model.obj` and `model.mtl` in the server's static directory.
    *   `FusionToWebXR.manifest`: Metadata for the Fusion 360 Add-in registry.
*   **`server/`**: The backend infrastructure.
    *   `main.py`: A FastAPI server that hosts the static files. It includes logic to generate self-signed SSL certificates using `trustme` to satisfy WebXR's HTTPS requirement (though tunneling is recommended).
    *   `static/`: The web root.
        *   `index.html`: The WebXR frontend application built with Three.js. Handles AR session, controller input, model loading, and interaction logic.
        *   `model.obj` & `model.mtl`: The exported model files (overwritten on each export).

## 🛠️ Architecture & Data Flow

1.  **Export (Fusion 360):**
    *   User runs the "FusionToWebXR" add-in.
    *   Script exports the root component as `.obj` and `.mtl` directly to `server/static/`.
    *   *Note:* OBJ/MTL was chosen over glTF because the specific Fusion 360 API version available did not support native glTF export.
2.  **Hosting (Python):**
    *   `uvicorn` serves the `server/static` directory.
    *   The server must be accessible via HTTPS for WebXR to work on the Quest.
3.  **Visualization (WebXR/Three.js):**
    *   `index.html` polls the server (via `HEAD` requests) for changes to `model.obj`.
    *   On change, it reloads the geometry and materials using `OBJLoader` and `MTLLoader`.
    *   **AR Mode:** Uses `immersive-ar` session with `local-floor` reference space.
    *   **Interaction:**
        *   **Single Hand:** Grab (Trigger) to move and rotate the model. Logic uses local offsets to prevent drift.
        *   **Two Hands:** Grab (Triggers) and pull apart to scale (Zoom).
        *   **Reset:** Button 5 (Y-Button on Left Controller) resets scale to default (1%).
    *   **Debug:** A floating 3D panel attached to the camera displays status and input debug info.

## 🚀 Building and Running

### Prerequisites
*   Python 3.10+
*   Fusion 360
*   Meta Quest 3 (connected to same Wi-Fi)

### 1. Server Setup
Install dependencies:
```bash
pip install fastapi uvicorn trustme
```

Run the server (from `server/` dir):
```bash
# Local HTTPS (requires accepting self-signed cert on Quest)
python main.py

# OR via Tunnel (Recommended)
npx localtunnel --port 8000
```

### 2. Fusion 360 Setup
1.  Open **Scripts and Add-ins** in Fusion 360.
2.  Add the `addin/` folder to "My Add-ins".
3.  Run the **FusionToWebXR** script.

### 3. Quest 3 Setup
1.  Open the Quest Browser.
2.  Navigate to the server URL (HTTPS).
3.  Click **"START AR"**.

## 💻 Development Conventions

*   **Frontend:** Vanilla JavaScript with ES Modules (Three.js imported via Import Map from `unpkg.com`). No build step (Webpack/Vite) is used to keep it lightweight and editable.
*   **Backend:** Minimal FastAPI implementation. Focus is on serving static assets efficiently.
*   **Input Handling:** Controller inputs are polled directly from `session.inputSources` in the animation loop for maximum reliability.
*   **Coordinate System:** Fusion 360 uses Y-up (usually). The loader scales the model by `0.01` by default to convert units (cm/mm) to meters for WebXR.

## 📝 Troubleshooting Notes
*   **Black Screen/Void:** Ensure `scene.background` is set to `null` and `renderer` has `alpha: true` for Passthrough to work.
*   **No Color:** Ensure both `.obj` and `.mtl` are present. The `MTLLoader` must be used before `OBJLoader`.
*   **HTTPS Error:** WebXR *requires* a secure context. `http://localhost` works on PC, but remote devices (Quest) need `https://` or a tunnel.
