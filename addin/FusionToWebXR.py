# Fusion 360 Addin: FusionToWebXR (Standalone)
# Combines Export + Local HTTPS Server

import adsk.core, adsk.fusion, traceback
import functools
import http.server
import importlib
import json
import math
import os
import queue
import re
import secrets
import shutil
import socket
import ssl
import threading
import time

from . import glb_export
importlib.reload(glb_export)  # Änderungen am Modul beim Neustart des Add-ins übernehmen

# Globale Variablen für Server und Threads
SERVER_THREAD = None
SERVER_HTTPD = None
SERVER_PORT = 8000

# Pfade relativ zum Script
SCRIPT_DIR = os.path.dirname(os.path.realpath(__file__))
WWW_DIR = os.path.join(SCRIPT_DIR, "www")
CERT_FILE = os.path.join(SCRIPT_DIR, "cert.pem")
KEY_FILE = os.path.join(SCRIPT_DIR, "key.pem")
SETTINGS_FILE = os.path.join(SCRIPT_DIR, "settings.json")

# Fusion 360 UI IDs
CMD_START_ID = 'cmdStartServer_Standalone'
CMD_STOP_ID = 'cmdStopServer_Standalone'
CMD_EXPORT_ID = 'cmdExportModel_Standalone'
CMD_SETTINGS_ID = 'cmdSettings_Standalone'
PANEL_ID = 'pnlWebXR_Standalone'
TAB_ID = 'ToolsTab'
AUTO_EXPORT_EVENT_ID = 'FusionToWebXR_AutoExport'
COMMAND_EVENT_ID = 'FusionToWebXR_Command'
CMD_APPLY_PARAM_ID = 'FusionToWebXR_ApplyParam'   # versteckter Befehl: Parameter als ein Rückgängig-Schritt

# Auto-Export: so lange nach dem letzten abgeschlossenen Befehl warten
AUTO_EXPORT_DELAY = 1.5
SSE_HEARTBEAT = 15
SSE_BACKLOG = 32                # so viele Ereignisse holt ein kurz abgehängter Client nach
MAX_POST_BYTES = 64 * 1024

DEFAULT_SETTINGS = {'format': 'glb', 'quality': 'normal', 'autoExport': True}
QUALITY_LABELS = [('low', 'Grob'), ('normal', 'Normal'), ('high', 'Fein'), ('veryhigh', 'Sehr fein')]
FORMAT_LABELS = [('glb', 'GLB (Bauteilbaum, Materialien, 1:1)'), ('obj', 'OBJ (Fusion-Export, Rückfall)')]


# -----------------------------------------------------------------------------
# Einstellungen
# -----------------------------------------------------------------------------
_settings = None

def load_settings():
    global _settings
    if _settings is None:
        _settings = dict(DEFAULT_SETTINGS)
        try:
            with open(SETTINGS_FILE, encoding='utf-8') as f:
                _settings.update(json.load(f))
        except Exception:
            pass
    return _settings


def save_settings(settings):
    global _settings
    _settings = dict(DEFAULT_SETTINGS, **settings)
    with open(SETTINGS_FILE, 'w', encoding='utf-8') as f:
        json.dump(_settings, f, indent=1)


def command_key():
    """Schlüssel für den Rückkanal. Bleibt über Neustarts gleich, damit ein Lesezeichen in der Brille gilt."""
    settings = load_settings()
    if not settings.get('commandKey'):
        save_settings(dict(settings, commandKey=secrets.token_urlsafe(8)))
    return _settings['commandKey']


def pair_pin():
    """Vierstellige PIN, mit der die Brille den Schlüssel abholt (statt den Link abzutippen)."""
    settings = load_settings()
    if not settings.get('pairPin'):
        save_settings(dict(settings, pairPin=f'{secrets.randbelow(10000):04d}'))
    return _settings['pairPin']


# Gegen Durchprobieren: nach PAIR_MAX_FAILS Fehlversuchen PAIR_LOCK_SECONDS gesperrt.
# 10 000 PINs bei 5 Versuchen pro Minute dauern im Mittel über 16 Stunden.
PAIR_MAX_FAILS = 5
PAIR_LOCK_SECONDS = 60
_pair_lock = threading.Lock()
_pair_state = {'fails': 0, 'until': 0.0}


def try_pair(pin):
    """Gibt (status, antwort) zurück; bei Erfolg enthält die Antwort den Schlüssel."""
    with _pair_lock:
        wait = _pair_state['until'] - time.time()
        if wait > 0:
            return 429, {'error': f'Zu viele Versuche – in {int(wait) + 1} s erneut', 'retryAfter': int(wait) + 1}
        if isinstance(pin, str) and secrets.compare_digest(pin, pair_pin()):
            _pair_state['fails'] = 0
            return 200, {'key': command_key()}
        _pair_state['fails'] += 1
        if _pair_state['fails'] >= PAIR_MAX_FAILS:
            _pair_state['fails'] = 0
            _pair_state['until'] = time.time() + PAIR_LOCK_SECONDS
        return 403, {'error': 'PIN falsch'}


def log(text):
    # Ins Textbefehle-Fenster von Fusion statt Dialoge beim Auto-Export
    try:
        palette = adsk.core.Application.get().userInterface.palettes.itemById('TextCommands')
        if palette:
            palette.writeText('[WebXR] ' + text)
    except Exception:
        pass


# -----------------------------------------------------------------------------
# Server-Sent Events: Fusion meldet neue Exporte direkt an die Brille
# -----------------------------------------------------------------------------
_sse_cond = threading.Condition()
_sse_state = {'seq': 0, 'log': [], 'stopping': False}
# Zustandsereignisse: ein neu verbundener Client bekommt den letzten Stand sofort
STICKY_EVENTS = ('selection', 'params')
_sse_sticky = {}


def broadcast(event, data):
    """Thread-sicher; Clients holen alle Ereignisse seit ihrem letzten Stand nach (bis SSE_BACKLOG)."""
    payload = json.dumps(data, ensure_ascii=False)
    with _sse_cond:
        _sse_state['seq'] += 1
        _sse_state['log'].append((_sse_state['seq'], event, payload))
        del _sse_state['log'][:-SSE_BACKLOG]
        if event in STICKY_EVENTS:
            _sse_sticky[event] = payload
        _sse_cond.notify_all()


# -----------------------------------------------------------------------------
# HTTP Server Logic
# -----------------------------------------------------------------------------
class CORSSSLRequestHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.json': 'application/json',
        '.glb': 'model/gltf-binary',
        '.obj': 'text/plain',
        '.mtl': 'text/plain',
    }

    def end_headers(self):
        # Enable CORS for Quest access
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS, HEAD')
        self.send_header("Access-Control-Allow-Headers", "X-Requested-With, Content-Type")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if self.path.split('?')[0] == '/events':
            self.serve_events()
        else:
            super().do_GET()

    def do_POST(self):
        # Rückkanal: nur mit Schlüssel. Der eigene Header erzwingt bei fremden Seiten einen
        # CORS-Preflight, den wir nicht erlauben – POST geht also nur von der eigenen Seite.
        path = self.path.split('?')[0]
        if not path.startswith('/api/'):
            return self.send_json(404, {'error': 'unbekannt'})
        if path == '/api/pair':
            # Einziger Befehl ohne Schlüssel: tauscht die PIN gegen den Schlüssel
            try:
                length = min(int(self.headers.get('Content-Length', 0)), 1024)
                pin = json.loads(self.rfile.read(length) or b'{}').get('pin')
            except (ValueError, OSError, AttributeError):
                return self.send_json(400, {'error': 'ungültiges JSON'})
            return self.send_json(*try_pair(pin))
        if not secrets.compare_digest(self.headers.get('X-FXR-Key', ''), command_key()):
            return self.send_json(403, {'error': 'Schlüssel fehlt oder falsch'})
        name = path[len('/api/'):]
        if name == 'check':
            return self.send_json(200, {'ok': True})
        if name not in COMMAND_HANDLERS:
            return self.send_json(404, {'error': f'Befehl {name} unbekannt'})
        try:
            length = int(self.headers.get('Content-Length', 0))
            if length > MAX_POST_BYTES:
                return self.send_json(413, {'error': 'zu groß'})
            body = json.loads(self.rfile.read(length) or b'{}')
        except (ValueError, OSError):
            return self.send_json(400, {'error': 'ungültiges JSON'})
        # Ausführung im Hauptthread – der Server-Thread fasst die Fusion-API nie an
        _commands.put((name, body))
        adsk.core.Application.get().fireCustomEvent(COMMAND_EVENT_ID, '')
        self.send_json(202, {'ok': True})

    def send_json(self, status, data):
        raw = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def serve_events(self):
        self.close_connection = True
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.end_headers()
        with _sse_cond:
            seq = _sse_state['seq']
            initial = [(e, _sse_sticky[e]) for e in STICKY_EVENTS if e in _sse_sticky]
        try:
            msg = 'retry: 2000\n\n' + ''.join(f'event: {e}\ndata: {d}\n\n' for e, d in initial)
            self.wfile.write(msg.encode('utf-8'))
            self.wfile.flush()
            while True:
                with _sse_cond:
                    _sse_cond.wait_for(lambda: _sse_state['seq'] != seq or _sse_state['stopping'], timeout=SSE_HEARTBEAT)
                    if _sse_state['stopping']:
                        return
                    pending = [(e, d) for s, e, d in _sse_state['log'] if s > seq]
                    seq = _sse_state['seq']
                # Ohne Änderung ein Kommentar als Heartbeat, damit tote Verbindungen auffallen
                msg = ''.join(f'event: {e}\ndata: {d}\n\n' for e, d in pending) or ': ping\n\n'
                self.wfile.write(msg.encode('utf-8'))
                self.wfile.flush()
        except (OSError, ssl.SSLError):
            pass  # Brille hat die Verbindung geschlossen

    def log_message(self, format, *args):
        # Die Brille fragt regelmäßig nach – kein Log-Rauschen in Fusion
        pass


class ExclusiveHTTPServer(http.server.ThreadingHTTPServer):
    # Unter Windows erlaubt SO_REUSEADDR einen zweiten Bind auf denselben Port –
    # dann würde ein belegter Port nicht erkannt
    allow_reuse_address = False

    def server_bind(self):
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def get_all_ips():
    ip_list = []
    try:
        # Get all network interfaces
        hostname = socket.gethostname()
        # Get all addresses for the hostname
        infos = socket.getaddrinfo(hostname, None, socket.AF_INET)

        for info in infos:
            ip = info[4][0]
            if ip != '127.0.0.1' and not ip.startswith('169.254'):
                if ip not in ip_list:
                    ip_list.append(ip)

        # Fallback if no real IP found
        if not ip_list:
            # Try the connection method as backup
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            try:
                s.connect(('10.255.255.255', 1))
                ip = s.getsockname()[0]
                if ip != '127.0.0.1':
                    ip_list.append(ip)
            except:
                pass
            finally:
                s.close()

        if not ip_list:
            ip_list.append('127.0.0.1')

    except Exception:
        ip_list = ['127.0.0.1']

    return ip_list


def start_server():
    """Bindet den Server im Hauptthread, damit Fehler direkt gemeldet werden können.

    Gibt None bei Erfolg zurück, sonst eine Fehlermeldung.
    """
    global SERVER_THREAD, SERVER_HTTPD
    if SERVER_HTTPD:
        return None

    if not (os.path.exists(CERT_FILE) and os.path.exists(KEY_FILE)):
        return ("SSL-Zertifikat fehlt (cert.pem / key.pem im Add-in-Ordner).\n"
                "WebXR braucht HTTPS – bitte gen_cert.py ausführen.")

    handler = functools.partial(CORSSSLRequestHandler, directory=WWW_DIR)
    try:
        httpd = ExclusiveHTTPServer(('0.0.0.0', SERVER_PORT), handler)
    except OSError as e:
        return f"Port {SERVER_PORT} ist nicht verfügbar ({e.strerror or e})."

    try:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(certfile=CERT_FILE, keyfile=KEY_FILE)
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    except Exception as e:
        httpd.server_close()
        return f"Zertifikat konnte nicht geladen werden: {e}"

    httpd.daemon_threads = True
    with _sse_cond:
        _sse_state['stopping'] = False
    SERVER_HTTPD = httpd
    # Der Thread fasst die Fusion-API nicht an – Fehler dort würden sonst Fusion destabilisieren
    SERVER_THREAD = threading.Thread(target=httpd.serve_forever, daemon=True)
    SERVER_THREAD.start()
    return None


def stop_server():
    global SERVER_HTTPD, SERVER_THREAD
    cancel_auto_export()
    if SERVER_HTTPD:
        # Offene SSE-Verbindungen beenden, sonst hängen deren Threads bis zum nächsten Heartbeat
        with _sse_cond:
            _sse_state['stopping'] = True
            _sse_cond.notify_all()
        SERVER_HTTPD.shutdown()
        SERVER_HTTPD.server_close()
        SERVER_HTTPD = None
    SERVER_THREAD = None


def url_list():
    return "".join(f"- https://{ip}:{SERVER_PORT}\n" for ip in get_all_ips())


def pair_hint():
    # Erst mit der PIN darf die Brille Auswahl und Parameter an Fusion schicken
    return (f"\nPIN für den Rückkanal: {pair_pin()}\n"
            "(in der Brille: Menü → Parameter → „Mit PIN koppeln“)\n")


# -----------------------------------------------------------------------------
# Export
# -----------------------------------------------------------------------------
def export_obj(design):
    # In einen Unterordner exportieren und dann verschieben, damit die Brille
    # nie halb geschriebene Dateien sieht (mtllib-Verweis bleibt "model.mtl")
    tmp_dir = os.path.join(WWW_DIR, '_export_tmp')
    shutil.rmtree(tmp_dir, ignore_errors=True)
    os.makedirs(tmp_dir)
    try:
        export_mgr = design.exportManager
        options = export_mgr.createOBJExportOptions(design.rootComponent, os.path.join(tmp_dir, 'model.obj'))
        if not export_mgr.execute(options):
            return None
        mtl_tmp = os.path.join(tmp_dir, 'model.mtl')
        mtl_path = os.path.join(WWW_DIR, 'model.mtl')
        if os.path.exists(mtl_tmp):
            os.replace(mtl_tmp, mtl_path)
        elif os.path.exists(mtl_path):
            os.remove(mtl_path)
        os.replace(os.path.join(tmp_dir, 'model.obj'), os.path.join(WWW_DIR, 'model.obj'))
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    app = adsk.core.Application.get()
    meta = {
        'version': int(os.path.getmtime(os.path.join(WWW_DIR, 'model.obj')) * 1000),
        'format': 'obj',
        'file': 'model.obj',
        'document': app.activeDocument.name if app.activeDocument else None,
        'units': 'cm',
        'hasMtl': os.path.exists(os.path.join(WWW_DIR, 'model.mtl')),
    }
    glb_export.write_scene_json(WWW_DIR, meta)
    return meta


def run_export(design, settings):
    """Exportiert und meldet das Ergebnis per SSE. Fehler werden weitergereicht."""
    broadcast('exporting', {})
    try:
        if settings.get('format') == 'obj':
            meta = export_obj(design)
        else:
            meta = glb_export.export_design(design, WWW_DIR, settings.get('quality', 'normal'))
    except Exception as e:
        broadcast('exporterror', {'message': f'Export fehlgeschlagen: {e}'})
        raise
    if meta:
        _auto['fingerprint'] = design_fingerprint(design)
        broadcast('scene', {'version': meta['version']})
        broadcast('params', user_params(design))
    else:
        broadcast('exporterror', {'message': 'Export fehlgeschlagen'})
    return meta


# -----------------------------------------------------------------------------
# Auto-Export
# -----------------------------------------------------------------------------
# Ablauf: Befehl abgeschlossen -> Timer (Entprellung) -> Custom Event -> Export im
# Hauptthread, aber nur, wenn sich der Fingerabdruck des Designs geändert hat
_auto = {'timer': None, 'fingerprint': None, 'event': None}


def design_fingerprint(design):
    """Billiger Vergleichswert: sichtbare Körper mit Darstellung, Volumen, Fläche und Hüllquader.

    Fängt auch Parameteränderungen ab, die weder Timeline noch Hüllquader verändern.
    """
    parts = [design.parentDocument.name if design.parentDocument else '',
             tuple((p.name, p.expression) for p in _user_parameters(design))]
    for occ_bodies in _visible_body_lists(design.rootComponent):
        for body in occ_bodies:
            if not body.isVisible:
                continue
            bb = body.boundingBox
            parts.append((body.entityToken, glb_export.appearance_key(body.appearance),
                          round(body.volume, 7), round(body.area, 6), body.faces.count,
                          tuple(round(v, 5) for v in (bb.minPoint.x, bb.minPoint.y, bb.minPoint.z,
                                                      bb.maxPoint.x, bb.maxPoint.y, bb.maxPoint.z))))
    return hash(tuple(parts))


def _visible_body_lists(root):
    yield root.bRepBodies
    for occ in root.allOccurrences:
        if occ.isVisible:
            yield occ.bRepBodies


def schedule_auto_export():
    if not (SERVER_HTTPD and load_settings().get('autoExport')):
        return
    cancel_auto_export()
    # fireCustomEvent ist thread-sicher; der Export selbst läuft dann im Hauptthread
    timer = threading.Timer(AUTO_EXPORT_DELAY, lambda: adsk.core.Application.get().fireCustomEvent(AUTO_EXPORT_EVENT_ID, ''))
    timer.daemon = True
    _auto['timer'] = timer
    timer.start()


def cancel_auto_export():
    if _auto['timer']:
        _auto['timer'].cancel()
        _auto['timer'] = None


def auto_export():
    _auto['timer'] = None
    if not (SERVER_HTTPD and load_settings().get('autoExport')):
        return
    app = adsk.core.Application.get()
    # Läuft gerade ein Befehl (z. B. Extrusion mit Vorschau), später erneut versuchen
    if app.userInterface.activeCommand != 'SelectCommand':
        schedule_auto_export()
        return
    design = adsk.fusion.Design.cast(app.activeProduct)
    if not design:
        return
    if design_fingerprint(design) == _auto['fingerprint']:
        return
    t0 = time.time()
    meta = run_export(design, load_settings())
    if meta:
        log(f"Auto-Export ({meta['format']}) in {time.time() - t0:.2f} s")


# -----------------------------------------------------------------------------
# Rückkanal: Befehle der Brille (Auswahl, Parameter)
# -----------------------------------------------------------------------------
# Server-Thread: POST /api/<name> -> Queue -> Custom Event -> process_commands() im Hauptthread
_commands = queue.Queue()
_selection = {'paths': None, 'expected': None}
_param_pending = []


class CommandError(Exception):
    """Fehler, der als Meldung an die Brille geht (kein Traceback)."""


def active_design():
    design = adsk.fusion.Design.cast(adsk.core.Application.get().activeProduct)
    if not design:
        raise CommandError('Kein aktives Design in Fusion')
    return design


def ensure_idle():
    # Ein laufender Fusion-Befehl (z. B. offener Extrusionsdialog) würde sonst abgebrochen
    if adsk.core.Application.get().userInterface.activeCommand != 'SelectCommand':
        raise CommandError('Fusion ist beschäftigt – erst den offenen Befehl beenden')


def process_commands():
    while True:
        try:
            name, body = _commands.get_nowait()
        except queue.Empty:
            return
        try:
            COMMAND_HANDLERS[name](body)
        except CommandError as e:
            broadcast('commanderror', {'command': name, 'message': str(e)})
        except Exception:
            log(f'Befehl {name} fehlgeschlagen:\n' + traceback.format_exc())
            broadcast('commanderror', {'command': name, 'message': f'Befehl {name} fehlgeschlagen'})


# --- Körper <-> Pfad (wie im GLB: Wurzel/Occurrence:1/.../Körper) -----------------
# entityToken ist laut Doku nicht stabil, der Pfad schon (solange nichts umbenannt wird)
def body_path(design, body):
    occ = body.assemblyContext
    names = occ.fullPathName.split('+') if occ else []
    return '/'.join([design.rootComponent.name] + names + [body.name])


class BodyLookup:
    def __init__(self, design):
        self.root = design.rootComponent
        self.occs = None

    def find(self, path):
        parts = path.split('/')
        if len(parts) < 2:
            return None
        names, body_name = parts[1:-1], parts[-1]
        if names:
            if self.occs is None:
                self.occs = {o.fullPathName: o for o in self.root.allOccurrences}
            occ = self.occs.get('+'.join(names))
            if not occ:
                return None
            return occ.bRepBodies.itemByName(body_name)
        return self.root.bRepBodies.itemByName(body_name)


def _occurrence_bodies(occ):
    yield from occ.bRepBodies
    for child in occ.childOccurrences:
        yield from _occurrence_bodies(child)


def selection_paths(design):
    """Aktuelle Fusion-Auswahl als Körperpfade: Fläche/Kante/Punkt -> Körper, Occurrence -> alle Körper darunter."""
    paths = []
    selections = adsk.core.Application.get().userInterface.activeSelections
    for i in range(selections.count):
        entity = selections.item(i).entity
        bodies = []
        if adsk.fusion.BRepBody.cast(entity):
            bodies = [entity]
        elif adsk.fusion.Occurrence.cast(entity):
            bodies = _occurrence_bodies(entity)
        else:
            for cls in (adsk.fusion.BRepFace, adsk.fusion.BRepEdge, adsk.fusion.BRepVertex):
                sub = cls.cast(entity)
                if sub:
                    bodies = [sub.body]
                    break
        for body in bodies:
            path = body_path(design, body)
            if path not in paths:
                paths.append(path)
    return paths


def broadcast_selection(design):
    paths = selection_paths(design)
    if paths == _selection['paths']:
        return
    _selection['paths'] = paths
    # Kam die Auswahl aus der Brille, braucht sie dort keinen Hinweis
    origin = 'viewer' if _selection['expected'] is not None and set(paths) == _selection['expected'] else 'fusion'
    _selection['expected'] = None
    broadcast('selection', {'paths': paths, 'origin': origin})


def cmd_select(body):
    design = active_design()
    ensure_idle()
    paths = [p for p in body.get('paths', []) if isinstance(p, str)]
    mode = body.get('mode', 'replace')
    if mode not in ('replace', 'add', 'remove'):
        raise CommandError(f'Unbekannter Auswahlmodus {mode}')
    selections = adsk.core.Application.get().userInterface.activeSelections
    lookup = BodyLookup(design)
    found = [(p, lookup.find(p)) for p in paths]
    missing = [p for p, b in found if not b]
    current = set(selection_paths(design)) if mode != 'replace' else set()
    if mode == 'remove':
        _selection['expected'] = current - set(paths)
    else:
        _selection['expected'] = current | {p for p, b in found if b}
    if mode == 'replace':
        selections.clear()
    for _, b in found:
        if not b:
            continue
        if mode == 'remove':
            selections.removeByEntity(b)
        else:
            selections.add(b)
    broadcast_selection(design)
    if missing:
        raise CommandError(f'{len(missing)} Körper nicht gefunden (umbenannt?)')


# --- Benutzerparameter ----------------------------------------------------------
PARAM_RANGE_RE = re.compile(r'\[\s*(-?\d+(?:[.,]\d+)?)\s*\.\.\s*(-?\d+(?:[.,]\d+)?)\s*\]')
PARAM_STEPS = {'mm': 0.5, 'cm': 0.05, 'm': 0.0005, 'in': 0.01, 'ft': 0.001, 'deg': 1.0, 'rad': 0.01}
NUMBER_EXPR_RE = re.compile(r'^\s*-?\d+(?:[.,]\d+)?(?:\s*[a-zA-Z"\']+)?\s*$')


def _param_info(design, p):
    um = design.unitsManager
    unit = p.unit
    factor = um.evaluateExpression('1 ' + unit, unit) if unit else 1.0
    value = p.value / factor if factor else p.value
    # Nur reine Zahlenwerte als Regler – Formeln mit Bezügen bleiben Anzeige
    editable = bool(NUMBER_EXPR_RE.match(p.expression))
    m = PARAM_RANGE_RE.search(p.comment or '')
    if m:
        lo, hi = sorted(float(v.replace(',', '.')) for v in m.groups())
    else:
        span = abs(value) * 0.5 or 10.0
        lo, hi = value - span, value + span
    step = PARAM_STEPS.get(unit)
    if step is None:
        step = 1.0 if not unit and float(value).is_integer() else (hi - lo) / 100 or 0.01
    # Grenzen auf das Raster runden, damit beide Enden erreichbar sind
    lo, hi = math.floor(lo / step + 1e-9) * step, math.ceil(hi / step - 1e-9) * step
    return {'name': p.name, 'expression': p.expression, 'value': round(value, 6), 'unit': unit,
            'comment': p.comment, 'editable': editable,
            'min': round(lo, 6), 'max': round(hi, 6), 'step': step}


def _user_parameters(design):
    # Direktmodellierung hat keine Parameter – der Zugriff wirft dort einen Fehler
    if design.designType != adsk.fusion.DesignTypes.ParametricDesignType:
        return []
    return design.userParameters


def user_params(design):
    result = []
    for p in _user_parameters(design):
        try:
            result.append(_param_info(design, p))
        except Exception:
            pass  # z. B. Textparameter
    return result


def _timeline_problems(design):
    # Auch Warnungen zählen: eine Skizze, die sich nicht lösen lässt, ist nur eine Warnung
    if design.designType != adsk.fusion.DesignTypes.ParametricDesignType:
        return 0
    healthy = adsk.fusion.FeatureHealthStates.HealthyFeatureHealthState
    return sum(1 for item in design.timeline if item.healthState != healthy)


def cmd_param(body):
    design = active_design()
    ensure_idle()
    name, value = body.get('name'), body.get('value')
    if design.designType != adsk.fusion.DesignTypes.ParametricDesignType:
        raise CommandError('Design ohne Zeitleiste (Direktmodellierung) – keine Parameter')
    param = design.userParameters.itemByName(name) if isinstance(name, str) else None
    if not param:
        raise CommandError(f'Parameter {name} nicht gefunden')
    if not isinstance(value, (int, float)) or value != value or abs(value) > 1e9:
        raise CommandError('Ungültiger Wert')
    if not NUMBER_EXPR_RE.match(param.expression):
        raise CommandError(f'{name} ist eine Formel und kann nur in Fusion geändert werden')
    _param_pending.append((name, float(value)))
    # Über einen versteckten Befehl, damit die Änderung ein Schritt in der Rückgängig-Liste ist
    adsk.core.Application.get().userInterface.commandDefinitions.itemById(CMD_APPLY_PARAM_ID).execute()


def format_expression(value, unit):
    text = f'{value:.6f}'.rstrip('0').rstrip('.')
    return f'{text} {unit}' if unit else text


COMMAND_HANDLERS = {'select': cmd_select, 'param': cmd_param}


# -----------------------------------------------------------------------------
# Fusion 360 Command Handlers
# -----------------------------------------------------------------------------
class StartServerCommandExecuteHandler(adsk.core.CommandEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        app = adsk.core.Application.get()
        ui = app.userInterface
        try:
            if SERVER_HTTPD:
                ui.messageBox("Server läuft bereits.\n\nMögliche URLs:\n" + url_list() + pair_hint())
                return
            error = start_server()
            if error:
                ui.messageBox("Server konnte nicht starten:\n\n" + error)
            else:
                # Mit Auto-Export liegt gleich das aktuelle Modell bereit
                _auto['fingerprint'] = None
                schedule_auto_export()
                auto_hint = "\nAuto-Export ist aktiv.\n" if load_settings().get('autoExport') else ""
                ui.messageBox("Server gestartet!\n\nMögliche URLs:\n" + url_list() + pair_hint() + auto_hint +
                              "\n(Zertifikat im Browser akzeptieren!)")
        except:
            ui.messageBox('Failed:\n{}'.format(traceback.format_exc()))

class StopServerCommandExecuteHandler(adsk.core.CommandEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        app = adsk.core.Application.get()
        ui = app.userInterface
        try:
            if SERVER_HTTPD:
                stop_server()
                ui.messageBox("Server gestoppt.")
            else:
                ui.messageBox("Server läuft nicht.")
        except:
            ui.messageBox('Failed:\n{}'.format(traceback.format_exc()))

class ExportCommandExecuteHandler(adsk.core.CommandEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        app = adsk.core.Application.get()
        ui = app.userInterface
        try:
            design = adsk.fusion.Design.cast(app.activeProduct)
            if not design:
                ui.messageBox('Kein aktives Design.')
                return

            meta = run_export(design, load_settings())
            if not meta:
                ui.messageBox("Export fehlgeschlagen.")
            elif meta['format'] == 'glb':
                tris = f"{meta['triangles']:,}".replace(',', '.')
                kb = f"{meta['bytes'] / 1024:,.0f}".replace(',', '.')
                ui.messageBox(f"Export erfolgreich (GLB)\n\n"
                              f"{len(meta['bodies'])} Körper, {tris} Dreiecke\n"
                              f"{kb} KB in {meta['exportSeconds']} s\n\n"
                              f"Die Brille lädt das Modell automatisch neu.")
            else:
                ui.messageBox("Export erfolgreich (OBJ)\nDie Brille lädt das Modell automatisch neu.")
        except:
            ui.messageBox('Failed:\n{}'.format(traceback.format_exc()))

class SettingsCommandExecuteHandler(adsk.core.CommandEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        try:
            inputs = args.command.commandInputs
            fmt = inputs.itemById('format').selectedItem.index
            quality = inputs.itemById('quality').selectedItem.index
            save_settings({'format': FORMAT_LABELS[fmt][0], 'quality': QUALITY_LABELS[quality][0],
                           'autoExport': inputs.itemById('autoExport').value})
            # Neue Einstellungen sofort wirksam machen
            _auto['fingerprint'] = None
            schedule_auto_export()
        except:
            adsk.core.Application.get().userInterface.messageBox('Failed:\n{}'.format(traceback.format_exc()))

# Befehle, die das Modell nicht verändern – lösen keinen Auto-Export aus
IGNORED_COMMANDS = {
    'SelectCommand', 'PanCommand', 'OrbitCommand', 'FreeOrbitCommand', 'ConstrainedOrbitCommand',
    'ZoomCommand', 'ZoomWindowCommand', 'FitCommand', 'LookAtCommand',
    CMD_START_ID, CMD_STOP_ID, CMD_EXPORT_ID, CMD_SETTINGS_ID,
}

class CommandTerminatedHandler(adsk.core.ApplicationCommandEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        try:
            if (args.terminationReason == adsk.core.CommandTerminationReason.CompletedTerminationReason
                    and args.commandId not in IGNORED_COMMANDS):
                schedule_auto_export()
        except:
            log(traceback.format_exc())

class DocumentActivatedHandler(adsk.core.DocumentEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        schedule_auto_export()

class AutoExportEventHandler(adsk.core.CustomEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        try:
            auto_export()
        except:
            log('Auto-Export fehlgeschlagen:\n' + traceback.format_exc())

class RemoteCommandEventHandler(adsk.core.CustomEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        try:
            process_commands()
        except:
            log('Befehl aus der Brille fehlgeschlagen:\n' + traceback.format_exc())

class SelectionChangedHandler(adsk.core.ActiveSelectionEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        if not SERVER_HTTPD:
            return
        try:
            design = adsk.fusion.Design.cast(adsk.core.Application.get().activeProduct)
            if design:
                broadcast_selection(design)
        except:
            log(traceback.format_exc())

class ApplyParamExecuteHandler(adsk.core.CommandEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        design = adsk.fusion.Design.cast(adsk.core.Application.get().activeProduct)
        items = list(_param_pending)
        _param_pending.clear()
        if not design or not items:
            return
        old = {}
        try:
            problems_before = _timeline_problems(design)
            for name, value in items:
                param = design.userParameters.itemByName(name)
                if param:
                    old.setdefault(name, param.expression)
                    param.expression = format_expression(value, param.unit)
            failed = _timeline_problems(design) > problems_before
        except Exception as e:
            failed = str(e)
        if failed:
            # Selbst zurücksetzen, damit die gemeldeten Werte stimmen; executeFailed bricht
            # zusätzlich die Transaktion ab, es bleibt kein Rückgängig-Schritt übrig
            for name, expression in old.items():
                try:
                    design.userParameters.itemByName(name).expression = expression
                except Exception:
                    pass
            args.executeFailed = True
            reason = failed if isinstance(failed, str) else 'Geometrie lässt sich so nicht berechnen'
            broadcast('commanderror', {'command': 'param', 'message': f'Parameter nicht übernommen: {reason}'})
        broadcast('params', user_params(design))
        # Ein Befehl leert die Fusion-Auswahl – die Brille soll das auch zeigen
        broadcast_selection(design)

class CommandCreatedEventHandler(adsk.core.CommandCreatedEventHandler):
    def __init__(self, handler_cls):
        super().__init__()
        self.handler_cls = handler_cls
    def notify(self, args):
        try:
            cmd = args.command
            if self.handler_cls is SettingsCommandExecuteHandler:
                build_settings_dialog(cmd)
            onExecute = self.handler_cls()
            cmd.execute.add(onExecute)
            # Keep the handler referenced to prevent GC
            _handlers.append(onExecute)
        except:
            app = adsk.core.Application.get()
            app.userInterface.messageBox('Failed:\n{}'.format(traceback.format_exc()))

def build_settings_dialog(cmd):
    settings = load_settings()
    inputs = cmd.commandInputs
    fmt = inputs.addDropDownCommandInput('format', 'Format', adsk.core.DropDownStyles.TextListDropDownStyle)
    for key, label in FORMAT_LABELS:
        fmt.listItems.add(label, key == settings['format'])
    quality = inputs.addDropDownCommandInput('quality', 'Tessellierung', adsk.core.DropDownStyles.TextListDropDownStyle)
    for key, label in QUALITY_LABELS:
        quality.listItems.add(label, key == settings['quality'])
    auto = inputs.addBoolValueInput('autoExport', 'Auto-Export', True, '', settings['autoExport'])
    auto.tooltip = 'Exportiert nach jeder Änderung automatisch, solange der Server läuft'

# Keep handlers in memory
_handlers = []
_event_handlers = []

COMMANDS = [
    (CMD_START_ID, 'WebXR Server Starten', 'Startet lokalen HTTPS Server für Quest 3', StartServerCommandExecuteHandler),
    (CMD_STOP_ID, 'WebXR Server Stoppen', 'Stoppt den lokalen HTTPS Server', StopServerCommandExecuteHandler),
    (CMD_EXPORT_ID, 'WebXR Export', 'Exportiert aktuelles Modell für WebXR', ExportCommandExecuteHandler),
    (CMD_SETTINGS_ID, 'WebXR Einstellungen', 'Exportformat und Tessellierung', SettingsCommandExecuteHandler),
]
# Nicht im Panel; der Name erscheint in der Rückgängig-Liste
HIDDEN_COMMANDS = [
    (CMD_APPLY_PARAM_ID, 'WebXR-Parameter', 'Parameteränderung aus der Brille', ApplyParamExecuteHandler),
]

def run(context):
    ui = None
    try:
        app = adsk.core.Application.get()
        ui = app.userInterface

        cmdDefs = ui.commandDefinitions
        RESOURCES = os.path.join(SCRIPT_DIR, 'resources')

        # Add to UI: "Utilities" tab (Tools) under a new panel "WebXR"
        xr_panel = None
        design_ws = ui.workspaces.itemById('FusionSolidEnvironment')
        if design_ws:
            tools_tab = design_ws.toolbarTabs.itemById(TAB_ID)
            if tools_tab:
                panels = tools_tab.toolbarPanels
                xr_panel = panels.itemById(PANEL_ID)
                if not xr_panel:
                    xr_panel = panels.add(PANEL_ID, 'WebXR Streamer', 'SelectPanel', False)

        for cmd_id, name, tooltip, handler_cls in COMMANDS + HIDDEN_COMMANDS:
            cmd_def = cmdDefs.itemById(cmd_id)
            if not cmd_def:
                icon_dir = os.path.join(RESOURCES, cmd_id)
                if os.path.isdir(icon_dir):
                    cmd_def = cmdDefs.addButtonDefinition(cmd_id, name, tooltip, icon_dir)
                else:
                    cmd_def = cmdDefs.addButtonDefinition(cmd_id, name, tooltip)

            onCreated = CommandCreatedEventHandler(handler_cls)
            cmd_def.commandCreated.add(onCreated)
            _handlers.append(onCreated)

            if xr_panel and cmd_id != CMD_APPLY_PARAM_ID and not xr_panel.controls.itemById(cmd_id):
                xr_panel.controls.addCommand(cmd_def)

        # Auto-Export: Änderungen erkennen und gebündelt im Hauptthread exportieren
        for event_id in (AUTO_EXPORT_EVENT_ID, COMMAND_EVENT_ID):
            try:
                app.unregisterCustomEvent(event_id)  # Rest eines abgestürzten Laufs
            except Exception:
                pass
        _auto['event'] = app.registerCustomEvent(AUTO_EXPORT_EVENT_ID)
        command_event = app.registerCustomEvent(COMMAND_EVENT_ID)
        for event, handler in ((_auto['event'], AutoExportEventHandler()),
                               (command_event, RemoteCommandEventHandler()),
                               (ui.activeSelectionChanged, SelectionChangedHandler()),
                               (ui.commandTerminated, CommandTerminatedHandler()),
                               (app.documentActivated, DocumentActivatedHandler())):
            event.add(handler)
            _handlers.append(handler)
            _event_handlers.append((event, handler))

    except:
        if ui:
            ui.messageBox('Failed:\n{}'.format(traceback.format_exc()))

def stop(context):
    ui = None
    try:
        app = adsk.core.Application.get()
        ui = app.userInterface

        stop_server()

        for event, handler in _event_handlers:
            event.remove(handler)
        _event_handlers.clear()
        for event_id in (AUTO_EXPORT_EVENT_ID, COMMAND_EVENT_ID):
            try:
                app.unregisterCustomEvent(event_id)
            except Exception:
                pass

        # Remove Panel
        design_ws = ui.workspaces.itemById('FusionSolidEnvironment')
        if design_ws:
            tools_tab = design_ws.toolbarTabs.itemById(TAB_ID)
            if tools_tab:
                panel = tools_tab.toolbarPanels.itemById(PANEL_ID)
                if panel:
                    panel.deleteMe()

        # Remove Commands
        for cmd_id, _, _, _ in COMMANDS + HIDDEN_COMMANDS:
            cmd_def = ui.commandDefinitions.itemById(cmd_id)
            if cmd_def:
                cmd_def.deleteMe()

    except:
        if ui:
            ui.messageBox('Failed:\n{}'.format(traceback.format_exc()))
