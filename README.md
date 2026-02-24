# 🚀 Fusion 360 to WebXR (AR/VR)

[![Status](https://img.shields.io/badge/Status-Active-success.svg)]()
[![Platform](https://img.shields.io/badge/Platform-Meta_Quest_3-blue.svg)]()
[![Fusion 360](https://img.shields.io/badge/Fusion_360-Add--In-orange.svg)]()
[![WebXR](https://img.shields.io/badge/WebXR-AR_Passthrough-purple.svg)]()

**Stream your Autodesk Fusion 360 designs directly into Augmented Reality on the Meta Quest 3 in near real-time.**

This project provides a seamless pipeline to export 3D models from Fusion 360 and visualize them instantly in your physical environment using WebXR Passthrough. No complex Unity/Unreal setup required – just a local Python server and a browser.

---

## ✨ Features

*   **⚡ Near Real-Time Export:** One-click export from Fusion 360 directly to the VR/AR viewer.
*   **👓 AR Passthrough:** View your CAD models floating in your real room (Mixed Reality).
*   **🎨 Color Support:** Exports geometry (`.obj`) and materials (`.mtl`) for accurate color representation.
*   **🤝 Intuitive Interaction:**
    *   **One Hand:** Grab, move, and rotate the object naturally.
    *   **Two Hands:** Pinch-to-zoom (scale) and rotate with both hands.
*   **📍 Auto-Spawn:** Models appear automatically 50cm in front of you at eye level.
*   **🎮 Controller Support:** 
    *   **Triggers:** Grab & Manipulate.
    *   **Y-Button:** Reset Scale to 1:1 (100%).
*   **🛠️ Debug Tools:** Built-in 3D floating debug panel for status and input monitoring.

---

## 📦 Architecture

The system consists of two modular components:

1.  **Fusion 360 Add-in (Python):** 
    *   Exports the active design as `model.obj` and `model.mtl`.
    *   Saves files directly to the web server's static directory.
2.  **WebXR Server (Python/FastAPI):**
    *   Hosts the 3D files and the WebXR frontend.
    *   Frontend (Three.js) automatically detects file changes and reloads the model in AR without refreshing the page.

---

## 🚀 Installation

### 1. Prerequisites
*   **Autodesk Fusion 360** (Windows/Mac)
*   **Python 3.10+**
*   **Meta Quest 3** (or Quest 2/Pro) connected to the same Wi-Fi.

### 2. Setup Server
Clone the repository and install dependencies:

```bash
git clone https://github.com/yourusername/fusion360-vr.git
cd fusion360-vr/server
pip install fastapi uvicorn
```

### 3. Install Fusion 360 Add-in
1.  Open Fusion 360.
2.  Go to **UTILITIES** > **Scripts and Add-ins** (or press `Shift+S`).
3.  Select the **Add-ins** tab.
4.  Click the green **+** icon next to "My Add-ins".
5.  Select the folder `fusion360-vr/addin`.
6.  Click **Run**.

---

## 🎮 Usage Guide

### Step 1: Start the Server
In your terminal (`server/` directory), run:

```bash
# Option A: Local Network (Requires HTTPS setup or 'Unsafe' flag in Quest)
python main.py

# Option B: Tunnel (Recommended for easiest WebXR access)
npx localtunnel --port 8000
```
*Copy the `https://...` URL provided by localtunnel (or your local IP).*

### Step 2: Export Model
1.  Open your design in Fusion 360.
2.  Go to the **Scripts and Add-ins** menu.
3.  Select **FusionToWebXR** and click **Run**.
4.  Wait for the "Export Successful" popup.

### Step 3: Enter AR
1.  Put on your **Meta Quest 3**.
2.  Open the **Meta Quest Browser**.
3.  Navigate to the URL from Step 1.
4.  Click **"START AR"**.
5.  Grant permission for "Spatial Data" (Passthrough).

### Step 4: Interact
*   **Spawn:** The model appears floating in front of you.
*   **Grab:** Press and hold the **Trigger** to grab the model. Move your hand to position it.
*   **Scale:** Grab with **both hands** (Triggers) and pull apart to zoom in, push together to zoom out.
*   **Reset:** Press the **Y button** (Left Controller) to reset scale.

---

## 🔧 Troubleshooting

| Issue | Solution |
| :--- | :--- |
| **"Enter VR" button is disabled** | WebXR requires **HTTPS**. Use `localtunnel` or `ngrok`, or enable generic HTTP for WebXR in Quest flags (chrome://flags). |
| **Model is grey (no color)** | Ensure both `.obj` and `.mtl` files are in `server/static`. Run the Add-in again. |
| **Model is huge/tiny** | Use the **Y button** to reset scale, or use two-handed pinch to resize. Default scale is 1% (0.01). |
| **Debug Panel shows "Error"** | Check the server console logs. Ensure the Quest is on the same Wi-Fi as the PC. |

---

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

*Built with ❤️ for the XR Community.*
