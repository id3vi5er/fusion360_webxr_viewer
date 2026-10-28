# Featureliste FusionToWebXR

Nachschlagewerk für die Weiterentwicklung: was es gibt, wo es steckt, wie die Teile
zusammenspielen und wie man es testet. Stand: 2026-10-28 (Phasen 0–5 und 6.0–6.3).

Kurzfassung der Architektur:

```
Fusion (Hauptthread)                      Server-Thread                 Brille (www/app)
──────────────────────                    ─────────────                 ────────────────
commandTerminated ─► Timer 1,5 s ─► fireCustomEvent(AutoExport)
auto_export() ─► glb_export ─► model.glb + scene.json ─────────────►  GET scene.json / model.glb
broadcast('scene'|'params'|…) ───────► SSE /events ────────────────►  connectEvents()
activeSelectionChanged ─► broadcast('selection') ─► SSE ───────────►  setSelection()
process_commands() ◄─ fireCustomEvent(Command) ◄─ POST /api/<cmd> ◄─  remote.send()
```

Grundregel: **Der Server-Thread fasst die Fusion-API nie an.** Alles, was Fusion betrifft,
läuft über ein Custom Event im Hauptthread.

---

## 1. Add-in (Fusion-Seite)

| Feature | Wo | Hinweise |
|---|---|---|
| Panel „WebXR Streamer“ mit Start, Stopp, Export, Einstellungen | `FusionToWebXR.py` → `COMMANDS`, `run()` | Icons in `addin/resources/<cmd_id>/` |
| HTTPS-Server Port 8000 | `start_server()`, `ExclusiveHTTPServer` | `SO_EXCLUSIVEADDRUSE`, sonst bemerkt Windows einen belegten Port nicht |
| Einstellungen | `load_settings()` / `save_settings()` → `addin/settings.json` (gitignored) | `format`, `quality`, `autoExport`, `commandKey` |
| GLB-Export (eigener Writer) | `glb_export.py` → `export_design()` | Meter, Bauteilbaum als Knoten, `extras.kind/path/token`, Z-up → Y-up am Wurzelknoten |
| Materialien aus Darstellungen | `appearance_to_material()`, Schlüssel `appearance_key()` = (`id`, Name) | Kopierte Darstellungen teilen die `id` |
| OBJ-Export (Rückfall) | `export_obj()` | Fusion-Export, cm, ohne Sichtbarkeit |
| Atomares Schreiben | `.tmp` + `os.replace`, `scene.json` zuletzt | Die Brille sieht nie halbe Dateien |
| Auto-Export | `schedule_auto_export()` → `auto_export()` | Wartet, solange ein Befehl offen ist; `IGNORED_COMMANDS` lösen nichts aus |
| Fingerabdruck | `design_fingerprint()` | Körper (Token, Darstellung, Volumen, Fläche, Flächen, Hüllquader) + Benutzerparameter |
| SSE `/events` | `serve_events()`, `broadcast()` | Puffer von 32 Ereignissen; `selection` und `params` bekommt ein neuer Client sofort (`STICKY_EVENTS`) |
| Rückkanal `POST /api/<cmd>` | `do_POST()` → `_commands` → `process_commands()` | Header `X-FXR-Key`, sonst 403; Antwort 202, Ergebnis per SSE |
| Schlüssel | `command_key()` | Einmal erzeugt, in `settings.json` gespeichert; jeder Befehl braucht ihn als Header |
| PIN-Kopplung | `pair_pin()`, `try_pair()`, `POST /api/pair` | 4-stellige PIN (`settings.json` → `pairPin`) steht in der Startmeldung; die Brille tauscht sie gegen den Schlüssel. Nach 5 Fehlversuchen 60 s gesperrt (429). `?k=<Schlüssel>` in der URL geht weiterhin |
| Auswahl Fusion → Brille | `SelectionChangedHandler` → `broadcast_selection()` | Fläche/Kante/Punkt → Körper, Occurrence → alle Körper darunter |
| Auswahl Brille → Fusion | `cmd_select()` (`replace` / `add` / `remove`) | `origin: 'viewer'`, wenn die Auswahl aus der Brille kam |
| Körperpfad | `body_path()`, `BodyLookup.find()` | `Wurzel/Occ:1/…/Körper`, aufgelöst über `fullPathName` (Teile mit `+`) |
| Benutzerparameter | `user_params()`, `_param_info()` | Wert in der Einheit des Parameters, Bereich ±50 % oder `[min..max]` im Kommentar, Raster je Einheit |
| Parameter setzen | `cmd_param()` → versteckter Befehl `FusionToWebXR_ApplyParam` → `ApplyParamExecuteHandler` | Ein Rückgängig-Schritt („WebXR-Parameter“); neue Warnungen/Fehler in der Zeitleiste → zurücksetzen + `commanderror` |
| Meldungen | `log()` → Palette „Textbefehle“ | Statt Dialogen beim Auto-Export |

### SSE-Ereignisse

| Ereignis | Daten | Auslöser |
|---|---|---|
| `exporting` | `{}` | Export beginnt |
| `scene` | `{version}` | Export fertig → Brille lädt `scene.json` |
| `exporterror` | `{message}` | Export gescheitert (nicht `error` nennen, das ist bei EventSource reserviert) |
| `params` | `[{name, expression, value, unit, comment, editable, min, max, step}]` | nach jedem Export und jeder Parameteränderung |
| `selection` | `{paths, origin}` | Auswahl in Fusion geändert, oder Befehl `select` ausgeführt |
| `commanderror` | `{command, message}` | Befehl der Brille gescheitert |

### API-Befehle

| Befehl | Körper | Wirkung |
|---|---|---|
| `pair` | `{pin}` | Ohne Schlüssel: liefert `{key}` bei richtiger PIN, sonst 403 bzw. 429 bei Sperre |
| `check` | `{}` | 200, wenn der Schlüssel stimmt (synchron, ohne Fusion) |
| `select` | `{paths: [..], mode: 'replace'\|'add'\|'remove'}` | Fusion-Auswahl setzen; leere Liste + `replace` = Auswahl aufheben |
| `param` | `{name, value}` | Benutzerparameter auf `value` (in seiner Einheit) setzen |

Befehle werden abgelehnt (`commanderror`), wenn in Fusion gerade ein Befehl offen ist –
`cmdDef.execute()` würde ihn sonst abbrechen.

---

## 2. Viewer (Brille / Browser)

| Feature | Wo | Hinweise |
|---|---|---|
| Szene, Laden, Live-Sync | `www/app/main.js` → `connectEvents()`, `checkForUpdates()`, `processQueue()`, `setContent()` | Neu zentriert nur beim ersten Laden und bei Dokument- oder Formatwechsel |
| Zeiger je Controller/Hand | `setupPointer()`, `updatePointer()` | Menü > Handgelenk > Schnittebene (wenn vor dem Modell) > Modell |
| Eingaben | `onSelectStart/End()` (Trigger), `onSqueezeStart/End()` (Greiftaste), `handleButtons()` | Trigger = auswählen/Menü/Werkzeug, Greiftaste = bewegen, A/X = Menü, B = isolieren, Y = ausblenden |
| Handtracking | `updatePinch()` | Kurz kneifen (< 250 ms, < 1,5 cm) = auswählen, länger oder bewegt = greifen |
| Greifen, zwei Hände | `startGrab()`, `releaseGrab()`, `updateGrabState()`, `updateGrab()`, `twoHandRotation()` | Nur die Taste, die begonnen hat, beendet das Greifen (`p.grabBy`); zwei Hände: Maßstab + Drehung um die Hochachse |
| Isolieren / Ausblenden | `isolateBodies()`, `hideBodies()`, `targetKeys()` | Ziel: Auswahl, sonst Körper unter dem Strahl; B ohne Ziel zeigt alles |
| Menü (4 Seiten) | `ui.js` → `Menu` | Canvas 1024×760, Schaltflächen als Rechtecke mit `id`; `buttonAt(uv)` |
| Toast | `ui.js` → `Toast` | 2,5 s, Fehler bleiben (`sticky`) |
| Handgelenk-Knopf | `createWristButton()`, `updateWristButton()` | Nur mit Handtracking (linke Hand) |
| Darstellung Normal/Gitter/Röntgen | `applyDisplayMode()` | Originalwerte in `material.userData.orig` |
| Explosion | `tools.js` → `Exploder` | Verschiebt Körperknoten vom Modellmittelpunkt weg |
| Maße | `Dimensions` | Hüllquader mit Kantenlängen in mm |
| Messen | `MeasureTool` | Fang auf Ecken/Kantenmitten (8 mm), Punkte hängen am Körper, Neuzuordnung über den Pfad |
| Schnittebene | `SectionTool` | `clippingPlanes` + `clipShadows`, Gizmo greifbar |
| Platzieren | `xr.js` → `Placement`, `main.js` → `placeOnSurface()` | Boden/Wand/Decke über die Normale des Hit-Tests |
| Raumanker | `AnchorManager` | Persistente Anker je Dokument im `localStorage` (`fxr-anchor:`) |
| Schatten | `Shadows` | `ShadowMaterial` auf Boden oder Platzierungsfläche |
| Raumlicht | `setupLightEstimation()` | Nur, wenn der Browser es anbietet |
| Bauteilliste | `bodyNodes`, `hiddenKeys`, `soloKey`, `applyBodyVisibility()` | Zeile antippen = in Fusion auswählen (Rückkanal) |
| Rückkanal | `remote.js` → `Remote` | Schlüssel aus `pair(pin)` oder `?k=` → `localStorage` (`fxr-key`); `state`: `ok`, `nokey`, `badkey`, `offline` |
| Kopplung | Menüseite `pair` (Ziffernblock), `onPinKey()`, `submitPin()`; PIN-Feld `#pair` in `index.html` | Nach der 4. Ziffer wird sofort geprüft; das Seitenfeld ist nur außerhalb von AR und ohne Kopplung sichtbar |
| Auswahl anzeigen | `remote.js` → `SelectionView` | Kanten (cyan) als Kind der Meshes, `raycast` abgeschaltet; Pfeil 10 s, wenn außer Sicht |
| Auswählen (Standardwerkzeug) | `selectBody()` → `selectInFusion()` | Gilt immer in der Brille; an Fusion nur mit Rückkanal und GLB. Zweiter Trigger gehalten = hinzufügen/entfernen; ins Leere = aufheben |
| Parameter-Seite | `setParams()`, `dragParam()`, `commitParam()`, `refreshParams()` | Ziehen nur lokal, Senden beim Loslassen; „Fusion rechnet...“, bis der Wert zurückkommt |

### Menü-IDs (für `onMenuButton(id, value)`)

- Reiter: `page:view`, `page:tools`, `page:bodies`, `page:params`
- Ansicht: `scale:1|2|5|10`, `mode:normal|wire|xray`, `upright`, `shadows`, `dims`, `reset`, `close`
- Werkzeuge: `tool:select|place|measure`, `section`, `explode` (Regler), `axis:x|y|z`, `flip`, `clearMeasure`
- Bauteile: `bodies:prev|next|all`, `body:hover|toggle|solo:<index>`
- Parameter: `params:prev|next`, `param:<index>` (Regler, Wert 0..1), `pair:open`
- Kopplung: `pin:0`…`pin:9`, `pin:del`, `pin:ok`, `pin:cancel`

### Debug-Zugang `window.__viewer`

`scene`, `camera`, `modelGroup`, `content`, `renderer`, `menu`, `pointers`, `measure`, `section`,
`exploder`, `remote`, `selectionView`, `selectedKeys`, sowie die Funktionen `pressButton`,
`toggleMenu`, `onSelectStart`, `onSelectEnd`, `onSqueezeStart`, `onSqueezeEnd`, `isolateBodies`, `hideBodies`, `placeOnSurface`, `setSelection`, `setParams`,
`commitParam`, `render`.

---

## 3. Rezepte

**Neuen API-Befehl hinzufügen**
1. In `FusionToWebXR.py` eine Funktion `cmd_<name>(body)` schreiben; Fehler für die Brille als
   `CommandError` werfen. Vorher `active_design()` und bei Änderungen `ensure_idle()`.
2. In `COMMAND_HANDLERS` eintragen.
3. Ändert der Befehl das Modell: über einen versteckten Befehl ausführen (siehe
   `CMD_APPLY_PARAM_ID` / `HIDDEN_COMMANDS`), damit er ein Rückgängig-Schritt ist.
4. Ergebnis per `broadcast()` melden; im Viewer `es.addEventListener(...)` in `connectEvents()`.
5. Im Viewer `remote.send('<name>', {...})` – `r.ok` heißt nur „angenommen“.

**Neues SSE-Ereignis** – `broadcast('<name>', data)`. Soll ein neu verbundener Client den letzten
Stand sofort bekommen, den Namen in `STICKY_EVENTS` aufnehmen.

**Neue Menü-Schaltfläche** – in `Menu.buildStatic()` per `row(page, y, [[id, label]], x0, w)`
anlegen, in `onMenuButton()` behandeln; aktiv/gesperrt über `isActive()` / `isDisabled()`,
Zustand über `menu.setState()` in `updateMenu()`.

**Neue Menüseite** – Reiter in `buildStatic()` ergänzen (vier Reiter füllen die Breite schon;
bei einem fünften die Breite auf ~180 px verkleinern), Zeilen in `layout()`, Zeichnen in `draw()`.

**Etwas an Körpern anzeigen** – Linien oder Hilfsobjekte als Kind des Meshes anhängen und
`raycast = () => {}` setzen, sonst treffen Strahl und Messwerkzeug sie. `applyDisplayMode` und
`SectionTool.apply` behandeln nur `isMesh`; Schnittebenen für Linien selbst setzen
(siehe `SelectionView.update`).

---

## 4. Testen

**Fusion-Seite über das Fusion-MCP** (`execute_python`), ohne das geladene Add-in zu stören:

```python
import sys, types, importlib.util, os, shutil, functools, threading, adsk.core
ADDIN = r'U:\Software\fusion360_webxr_viewer\addin'
TMP = r'<scratchpad>\www_test'
pkg = types.ModuleType('fxrpkg'); pkg.__path__ = [ADDIN]; sys.modules['fxrpkg'] = pkg
spec = importlib.util.spec_from_file_location('fxrpkg.FusionToWebXR', os.path.join(ADDIN, 'FusionToWebXR.py'))
fx = importlib.util.module_from_spec(spec); sys.modules['fxrpkg.FusionToWebXR'] = fx
spec.loader.exec_module(fx)
shutil.copytree(os.path.join(ADDIN, 'www'), TMP, ignore=shutil.ignore_patterns('*.glb', 'scene.json'))
fx.WWW_DIR = TMP
fx.COMMAND_EVENT_ID = 'FXRTest_Command'          # eigene IDs, damit nichts mit dem Add-in kollidiert
fx.CMD_APPLY_PARAM_ID = 'FXRTest_ApplyParam'
app = adsk.core.Application.get(); ui = app.userInterface
ev = app.registerCustomEvent('FXRTest_Command'); h1 = fx.RemoteCommandEventHandler(); ev.add(h1)
h2 = fx.SelectionChangedHandler(); ui.activeSelectionChanged.add(h2)
cd = ui.commandDefinitions.addButtonDefinition('FXRTest_ApplyParam', 'WebXR-Parameter (Test)', '')
h3 = fx.CommandCreatedEventHandler(fx.ApplyParamExecuteHandler); cd.commandCreated.add(h3)
httpd = fx.ExclusiveHTTPServer(('127.0.0.1', 8444), functools.partial(fx.CORSSSLRequestHandler, directory=TMP))
httpd.daemon_threads = True; fx.SERVER_HTTPD = httpd
threading.Thread(target=httpd.serve_forever, daemon=True).start()
```

- Ohne TLS auf 8444, weil der Browser der App selbstsignierte Zertifikate ablehnt.
- Modulobjekte überleben nicht zwischen MCP-Aufrufen: `fx = sys.modules['fxrpkg.FusionToWebXR']`.
- Mit einem neuen, ungespeicherten Testdokument arbeiten und es danach mit `doc.close(False)` schließen.
- Befehle von außen: `curl -X POST -H "X-FXR-Key: <key>" --data '{...}' http://127.0.0.1:8444/api/<cmd>`.
- SSE-Verlauf prüfen: `fx._sse_state['log']`.
- Aufräumen: `fx.stop_server()`, Handler entfernen, Event abmelden, Befehlsdefinition löschen.

**Viewer im Browser** – `http://127.0.0.1:8444/?k=<key>` öffnen; ohne Headset über
`window.__viewer` bedienen. Läuft der Browser-Bereich im Hintergrund, gibt es keine Frames:
`__viewer.render()` aufrufen. XR-Controller haben `matrixAutoUpdate = false`. Simulierter
Controller: `pointers[0].source = { handedness: 'right' }` (mit `hand: {}` als Hand), dann
`onSelectStart/End(p)` bzw. `onSqueezeStart/End(p)`; beim Kneifen `p.pinch.time` zurückdrehen. Das Menü lässt
sich als Bild prüfen: `menu.draw()`, dann `menu.canvas.toDataURL()`.

**Nur in der Quest prüfbar:** Hit-Test, Anker, Raumlicht, Handtracking, Handgelenk-Knopf,
Richtungspfeil im Sichtfeld.

---

## 5. Bekannte Grenzen

- Körperpfade ändern sich beim Umbenennen – Messpunkte, Ausblendungen und Auswahl gehen dann verloren.
- Gleichnamige Körper in einem Bauteil sind nicht unterscheidbar (Fusion vergibt eindeutige Namen, solange man nicht nachträglich umbenennt).
- Ein Befehl (auch eine Parameteränderung) leert in Fusion die Auswahl.
- Formel-Parameter werden nur angezeigt. Textparameter fehlen in der Liste.
- Designs ohne Zeitleiste (Direktmodellierung) haben keine Parameter; `design.userParameters`
  wirft dort einen Fehler – immer über `_user_parameters()` zugreifen.
- Rückgängig in Fusion löst einen Auto-Export aus (Fingerabdruck enthält die Parameter), die
  Brille folgt also auch dabei.
- OBJ-Export: keine Körperpfade, deshalb keine Auswahl.

## 6. Kandidaten für später

- **6.4 Vorversion als Geist** (geplant, siehe Roadmap).
- Sichtbarkeit spiegeln: Ein/Aus in der Bauteilliste auch in Fusion setzen (Befehl `visibility`).
- Kamera übernehmen: Blickrichtung der Brille als benannte Ansicht in Fusion speichern.
- Export anstoßen aus der Brille (`export`), z. B. nach Wechsel der Qualität.
- Mehrere Brillen gleichzeitig: Auswahl je Gerät farbig.
- Abschnitt „Auswahl“ im Menü: Name, Material, Volumen des ausgewählten Körpers aus `scene.json`.
