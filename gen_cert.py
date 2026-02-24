import trustme
import socket
import os
import sys

def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # doesn't even have to be reachable
        s.connect(('10.255.255.255', 1))
        IP = s.getsockname()[0]
    except Exception:
        IP = '127.0.0.1'
    finally:
        s.close()
    return IP

def generate_certs():
    print("Generating SSL certificates using 'trustme'...")
    
    # Target directory: addin/
    target_dir = os.path.join(os.path.dirname(__file__), "addin")
    if not os.path.exists(target_dir):
        os.makedirs(target_dir)
        
    cert_path = os.path.join(target_dir, "cert.pem")
    key_path = os.path.join(target_dir, "key.pem")

    ip = get_local_ip()
    print(f"Detected Local IP: {ip}")

    ca = trustme.CA()
    # Issue certificate for localhost and the local IP
    server_cert = ca.issue_cert("localhost", "127.0.0.1", ip)

    print(f"Writing certificates to:
  - {cert_path}
  - {key_path}")
    
    server_cert.cert_chain_pems[0].write_to_path(cert_path)
    server_cert.private_key_pem.write_to_path(key_path)

    print("
Done! Certificates updated.")
    print("Restart Fusion 360 Add-in to apply changes.")

if __name__ == "__main__":
    try:
        generate_certs()
    except ImportError:
        print("Error: 'trustme' library not found.")
        print("Please install it: pip install trustme")
    except Exception as e:
        print(f"An error occurred: {e}")
