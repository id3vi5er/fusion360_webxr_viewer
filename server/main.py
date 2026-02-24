from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import socket
import os
import trustme

app = FastAPI(title="Fusion 360 WebXR Streamer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Statische Dateien bereitstellen
static_dir = os.path.join(os.path.dirname(__file__), "static")
app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

if __name__ == "__main__":
    ip = get_local_ip()
    
    # SSL Zertifikate mit trustme generieren (rein in Python)
    print("\nErzeuge SSL-Zertifikate via trustme...")
    ca = trustme.CA()
    # Zertifikat für localhost und die lokale Netzwerk-IP ausstellen
    server_cert = ca.issue_cert("localhost", "127.0.0.1", ip)
    
    cert_path = "cert.pem"
    key_path = "key.pem"
    
    # Zertifikate als PEM-Dateien speichern
    server_cert.cert_chain_pems[0].write_to_path(cert_path)
    server_cert.private_key_pem.write_to_path(key_path)

    print("\n" + "="*60)
    print(f"HTTPS SERVER LÄUFT UNTER: https://{ip}:8000")
    print(f"HINWEIS: Nutze zwingend https:// am Anfang der URL!")
    print(f"In der Quest: 'Erweitert' -> 'Weiter zu {ip} (unsicher)'")
    print("="*60 + "\n")
    
    uvicorn.run(
        app, 
        host="0.0.0.0", 
        port=8000, 
        ssl_keyfile=key_path, 
        ssl_certfile=cert_path
    )
