# Roadmap FusionToWebXR

Stand: 2026-10-28 · Fusion 2706.1.14 · Quest 3 (Meta Quest Browser)

Aufwand: **S** = wenige Stunden, **M** = ein Abend bis Tag, **L** = mehrere Tage.

## Status

- **Phase 0:** erledigt (2026-10-28), außer Endabnahme in der Quest.
- **Phase 1:** erledigt (2026-10-28), getestet an einer kleinen Baugruppe
  (verschachtelte Bauteile, Mehrfach-Instanz, ausgeblendete Körper, Glas und Metall).
  Offen: großes Modell (>500k Dreiecke) und Flächen mit eigener Darstellung.
- **Phase 2:** erledigt (2026-10-28), getestet in Fusion mit einer Testinstanz und im Desktop-Browser.
  Offen: Endabnahme in der Quest. `documentSaved` wird bewusst nicht genutzt: Speichern ändert
  das Modell nicht, der Fingerabdruck würde den Export ohnehin verwerfen.

- **Phase 3:** erledigt (2026-10-28), getestet im Desktop-Browser mit simulierten Controllern
  (Zielen, Greifen, zwei Hände, Menü per Strahl). Offen: Endabnahme in der Quest, vor allem
  Handtracking und der Menüknopf am Handgelenk.
  Bewusst weggelassen: Hand- und Controllermodelle. Im Passthrough sieht man die echten Hände
  und Controller ohnehin, und die Modelle von Three.js müssten aus dem Internet geladen werden.
- **Nachtrag Farben (2026-10-28):** Kopierte Darstellungen tragen die `id` ihrer Vorlage;
  Materialien werden deshalb nach `id` und Name unterschieden.
- **Phase 4:** erledigt (2026-10-28). Im Desktop-Browser getestet: Bauteilliste (Ein/Aus, Nur,
  Alle, Seiten), Explosionsansicht, Maße, Schnittebene, Messen (61,2 mm am B85, unverändert bei
  Explosion). Nur in der Quest prüfbar: Platzieren per Hit-Test, Greifen der Schnittebene.
- **Phase 5:** erledigt (2026-10-28) ohne 5.2 (Verdeckung durch Hände, auf Wunsch weggelassen).
  Schatten im Desktop-Browser geprüft. Raumanker und Raumlicht nur in der Quest prüfbar;
  beides fällt still zurück, wenn der Browser es nicht anbietet (Menü zeigt „Raumlicht“ nur,
  wenn es aktiv ist).

Erkenntnisse aus der Umsetzung:
- Proxy-Körper liefern ihr Netz bereits in Weltkoordinaten (cm). Der Exporter schreibt deshalb
  die Knoten ohne eigene Transformationen; die Hierarchie dient nur zur Gliederung.
- Eine Darstellung am Körper hat Vorrang vor der Überschreibung am Bauteil (wie in der Fusion-Anzeige).
- Der OBJ-Export von Fusion ignoriert die Sichtbarkeit und kommt Z-up an; GLB respektiert
  beides und dreht Z-up-Modelle nach Y-up.
- Unter Windows muss der Server `SO_EXCLUSIVEADDRUSE` setzen, sonst wird ein belegter Port nicht erkannt.
- Auto-Export: `commandTerminated` → Timer (1,5 s) → `fireCustomEvent` → Export im Hauptthread.
  Läuft dabei gerade ein Befehl (`activeCommand` ≠ `SelectCommand`), wird neu geplant.
  Der Fingerabdruck (sichtbare Körper mit Darstellung, Volumen, Fläche, Flächenzahl, Hüllquader)
  erkennt auch reine Parameteränderungen.
- SSE-Ereignisse dürfen nicht `error` heißen – den Namen nutzt EventSource für Verbindungsfehler.
- Zwei-Hand-Drehung nur um die Hochachse, abgeleitet aus der Linie zwischen den Händen –
  intuitiver als die Drehung eines einzelnen Controllers; die Neigung des Modells bleibt erhalten.
- Die XR-Controller von Three.js haben `matrixAutoUpdate = false`; für Tests ohne Headset muss
  das eingeschaltet werden, sonst wirkt eine gesetzte Position nicht auf den Strahl.
- Beim Neuladen bleibt der Fusion-Ursprung fix; neu zentriert wird nur beim ersten Laden,
  bei Dokument- oder Formatwechsel und mit B/Y.
- Messpunkte hängen am getroffenen Körper (lokale Koordinaten) und werden nach einem Neuladen
  über den Körperpfad neu zugeordnet; gemessen wird ohne Explosionsverschiebung.
- `Raycaster.intersectObject` prüft keine Sichtbarkeit – ausgeblendete Körper müssen aus den
  Treffern gefiltert werden.
- Schnittebene: `clippingPlanes` plus `clipShadows`, sonst wirft das geschnittene Modell den
  vollen Schatten. Rückseiten werden beim Schnitt eingeblendet statt einer echten Schnittkappe.
- Platzieren unterscheidet die Fläche über die Normale des Hit-Tests: Boden/Tisch (y > 0,8),
  Decke (y < −0,8), sonst Wand. Das Modell wird ausgerichtet und dann entlang der Normalen
  verschoben, bis die nächste Ecke des modellfesten Hüllquaders die Fläche berührt – das
  funktioniert auch an schrägen Wänden. An Wänden zeigt +Z (die Seite, die beim Start zum
  Betrachter zeigt) in den Raum.
- Raumanker werden nur innerhalb eines XR-Frames angelegt (`frame.createAnchor`); Anfragen aus
  Ereignissen werden deshalb vorgemerkt und im nächsten Frame ausgeführt. Persistente Anker
  (`requestPersistentHandle` / `restorePersistentAnchor`) werden je Dokumentname im
  `localStorage` der Brille gemerkt, zusammen mit Maßstab und Flächenhöhe.

## Leitentscheidungen

1. **Eigener GLB-Export statt OBJ.** Das Add-in tesselliert jeden Körper selbst
   (`BRepBody.meshManager.createMeshCalculator()`) und schreibt eine GLB-Datei mit
   reinem Python (ohne Abhängigkeiten). So bekommen wir:
   - den Bauteilbaum als Knoten, inklusive Transformationen
   - Namen und Fusion-`entityToken` je Körper
   - Farben und Transparenz aus den Fusion-Darstellungen (`Appearance` → PBR-Material)
   - die Einheit in Metern, also einen garantierten Maßstab 1:1

   Das Frontend lädt dann mit `GLTFLoader`. OBJ bleibt als Rückfall-Lösung erhalten.
   Der eingebaute USD-Export wäre zwar möglich, aber der USDZ-Loader von Three.js
   ist eingeschränkt, deshalb fiel die Wahl auf GLB.
2. **Alles, was Fusion anfasst, läuft im Hauptthread.** Der Server-Thread ruft keine
   Fusion-API direkt auf, sondern löst ein Custom Event aus
   (`app.registerCustomEvent` / `fireCustomEvent`). Das betrifft Dialoge, Export,
   Auswahl und Parameter.
3. **Push statt Polling.** Der Server wird zum `ThreadingHTTPServer` mit
   Server-Sent Events (`/events`). Mit dem bisherigen Single-Thread-`HTTPServer`
   würde eine offene SSE-Verbindung alles andere blockieren.
4. **Kein Build-Schritt.** Das Frontend bleibt Vanilla JS mit ES-Modulen.
   Three.js liegt lokal unter `www/vendor/`, damit alles offline läuft.

## Phase 0 – Stabilisieren (S–M)

| # | Aufgabe | Aufwand |
|---|---|---|
| 0.1 | Pivot-Fehler beim Skalieren mit zwei Händen beheben: Zentrierung in eine eigene Gruppe, skaliert wird `modelGroup` selbst | S |
| 0.2 | Stopp-Knopf registrieren (Handler existiert schon) | S |
| 0.3 | Keine `messageBox` aus dem Server-Thread; Startmeldung erst nach erfolgreichem Bind, Fehler (Port belegt, Zertifikat fehlt) sauber melden | S |
| 0.4 | Atomarer Export: erst in eine temporäre Datei schreiben, dann `os.replace` | S |
| 0.5 | Startplatzierung erst nach `sessionstart` und stabiler Kopfposition | S |
| 0.6 | Three.js lokal mitliefern; ungenutzten `hit-test` vorerst optional machen | S |
| 0.7 | Debug-Panel ausblendbar; Y setzt Maßstab **und** Position zurück | S |
| 0.8 | README: falsche Badges und Lizenzangabe korrigieren | S |

## Phase 1 – Neue Datenpipeline (L)

*Voraussetzung für Phase 4–6.*

| # | Aufgabe | Aufwand |
|---|---|---|
| 1.1 | Tessellierung je Körper über Occurrences rekursiv, sichtbare Körper, Qualitätsstufe wählbar (grob/normal/fein) | M |
| 1.2 | Minimaler GLB-Writer: Knoten, Meshes (Position/Normal/Index), Materialien | M |
| 1.3 | Darstellung → Material: Farbe, Deckkraft, Metall/Rauheit, soweit auslesbar | S–M |
| 1.4 | `scene.json` mit Metadaten: Bauteilpfad, Name, Token, Hüllquader, Exportversion | S |
| 1.5 | Frontend auf `GLTFLoader`, Maßstab 1:1 aus Metern | S |
| 1.6 | Testmodelle: Einzelteil, Baugruppe mit Unterbaugruppen, transparente Teile, großes Modell (>500k Dreiecke) | M |

## Phase 2 – Live-Sync (M)

| # | Aufgabe | Aufwand |
|---|---|---|
| 2.1 | `ThreadingHTTPServer` und `/events` (SSE); Brille lädt bei Versionswechsel neu | S |
| 2.2 | Auto-Export bei `ui.commandTerminated` und `app.documentSaved`, entprellt (z. B. 1,5 s), abschaltbar | M |
| 2.3 | Ladeanzeige und Fehleranzeige in VR; Position und Maßstab bleiben beim Neuladen erhalten | S |

## Phase 3 – Bedienung in VR (M–L)

| # | Aufgabe | Aufwand |
|---|---|---|
| 3.1 | Menü am Handgelenk oder am Controller (Canvas-Textur, Raycast-Klicks) | M |
| 3.2 | Greifen nur, wenn der Strahl das Modell trifft; Strahl sichtbar mit Trefferpunkt | S |
| 3.3 | Maßstab-Voreinstellungen 1:1 / 1:2 / 1:10 / frei, Anzeige des aktuellen Maßstabs | S |
| 3.4 | „Aufrecht halten“: Drehen nur um die Hochachse | S |
| 3.5 | Handtracking: Pinch greifen, beide Hände skalieren, Handmodelle | M |
| 3.6 | Darstellungsmodi: normal, Drahtgitter, Röntgen | S |

## Phase 4 – Werkzeuge (L)

| # | Aufgabe | Aufwand | braucht |
|---|---|---|---|
| 4.1 | Auf echte Flächen stellen: hit-test, Modell landet auf Tisch oder Boden | M | 3.1 |
| 4.2 | Hüllquader und Gesamtmaße einblenden (mm) | S | 1.5 |
| 4.3 | Messen Punkt zu Punkt, mit Einrasten an Ecken | M | 1.5, 3.2 |
| 4.4 | Schnittebene mit der Hand verschiebbar (`clippingPlanes`, mit Schnittkappe als Kür) | M | 1.5 |
| 4.5 | Bauteilliste: ein-/ausblenden, isolieren | M | 1.4, 3.1 |
| 4.6 | Explosionsansicht (radial vom Baugruppen-Zentrum, Regler) | M | 1.4 |

## Phase 5 – Quest-3-Extras (M)

| # | Aufgabe | Aufwand | Hinweis |
|---|---|---|---|
| 5.1 | Raumanker: Modell bleibt nach Neuladen am selben Ort | M | WebXR Anchors, persistente Anker im Quest Browser |
| 5.2 | Verdeckung durch echte Hände und Objekte | M | WebXR `depth-sensing`, Shader-Anpassung |
| 5.3 | Schatten auf den echten Boden (Shadow-Catcher-Ebene) | S | |
| 5.4 | Raumlicht übernehmen | S | `light-estimation`, Unterstützung im Quest Browser **ungeprüft** |

## Phase 6 – Rückkanal zu Fusion (L)

| # | Aufgabe | Aufwand | braucht |
|---|---|---|---|
| 6.0 | Grundlage: Befehlskanal Brille → Fusion mit Sitzungsschlüssel | S | 2.1 |
| 6.1 | Auswahl spiegeln Fusion → Brille | M | 6.0, 1.4 |
| 6.2 | Auswahl Brille → Fusion | M | 6.0, 6.1 |
| 6.3 | Benutzerparameter als Regler in VR → Fusion rechnet neu → Auto-Export | M | 6.0, 2.2, 3.1 |
| 6.4 | Versionsvergleich: vorigen Export als halbtransparenten Geist einblenden | S | 1.5 |

### Detailplanung Phase 6 (Stand 2026-10-28)

**6.0 Befehlskanal.** Bisher spricht nur Fusion zur Brille (SSE). Für den Rückweg:
- `POST /api/<befehl>` mit JSON-Körper, z. B. `/api/select`, `/api/param`.
- Der Server-Thread legt den Befehl in eine `queue.Queue` und ruft
  `fireCustomEvent('FusionToWebXR_Command')`. Der Handler im Hauptthread leert die Queue und
  führt aus – derselbe Weg wie beim Auto-Export, der Server fasst die Fusion-API nie an.
- Antwort sofort `202 Accepted`; das Ergebnis kommt per SSE (`selection`, `params`, `commanderror`).
- **Sicherheit:** Bisher kann jedes Gerät im WLAN nur lesen. Mit Phase 6 kann es das Modell
  ändern. Deshalb erzeugt das Add-in beim Serverstart einen zufälligen Schlüssel
  (`secrets.token_urlsafe(8)`), der in der Start-URL steht (`https://ip:8000/?k=…`) und bei jedem
  POST als Header `X-FXR-Key` mitkommen muss. Ohne Schlüssel: `403`. Die Brille merkt ihn sich
  im `localStorage`. CORS für POST nur für den eigenen Ursprung.
- Befehle mit Änderung am Modell landen als eigener Schritt in der Fusion-Rückgängig-Liste
  (über einen versteckten Befehl, der in `execute` die Änderung macht) – so ist alles mit
  Strg+Z umkehrbar.

**Schlüssel für Körper.** `entityToken` ist laut Fusion-Doku nicht garantiert stabil und kann sich
für dasselbe Objekt unterscheiden. Primärschlüssel ist deshalb der **Körperpfad**
(`Wurzel/Säule:1/Kappe:1/Glaskappe`, steht schon in `scene.json` und in den glTF-`extras`).
Auflösung in Fusion: Pfad → Occurrence über `allOccurrences` (`fullPathName`) → Körper per Name;
der Token dient nur als schneller erster Versuch (`design.findEntityByToken`).

**6.1 Auswahl Fusion → Brille.**
- `ui.activeSelectionChanged` → ausgewählte Entitäten auf Körper abbilden: BRepBody direkt,
  Fläche/Kante → `body`, Occurrence → alle Körper darunter.
- Pfade per SSE `selection` senden (entprellt, ~100 ms).
- Brille: Körper mit Umriss hervorheben (BoxHelper oder Kanten-Overlay in Akzentfarbe),
  Name als Toast; bei Auswahl außerhalb des Blickfelds ein kleiner Richtungspfeil.

**6.2 Auswahl Brille → Fusion.**
- Neues Werkzeug „Auswählen“: Strahl auf Körper + Trigger → `POST /api/select {paths, mode}`
  (`replace` oder mit zweitem Trigger `add`).
- Fusion: `ui.activeSelections.clear()` + `add(body)`; der Browser-Baum klappt automatisch auf.
- Echo vermeiden: Die eigene Auswahl löst `activeSelectionChanged` aus – mit einem Flag für
  „kommt von der Brille“ wird das SSE-Echo unterdrückt bzw. nur bestätigt.
- Nützlich zusammen mit der Bauteilliste: Zeile antippen = in Fusion auswählen.

**6.3 Parameter in VR.**
- Beim Export zusätzlich `params.json` schreiben: Benutzerparameter mit Name, Ausdruck,
  Wert, Einheit, Kommentar; nur Parameter mit numerischem Wert (keine Formeln mit Bezügen
  als Regler – die nur anzeigen).
- Neue Menüseite „Parameter“: je Parameter ein Regler mit Bereich ±50 % um den Startwert
  (oder aus dem Kommentar: `[min..max]`), Schrittweite nach Einheit (mm: 0,5).
- Beim Loslassen des Reglers → `POST /api/param {name, value}`; Fusion setzt
  `userParameters.itemByName(name).value` im Hauptthread → Neuberechnung → Auto-Export →
  Brille lädt nach. Während des Ziehens nur lokal anzeigen, nicht senden (Neuberechnung kann
  Sekunden dauern).
- Fehler (z. B. Geometrie schlägt fehl) → Rückgängig und `commanderror` an die Brille.

**6.4 Versionsvergleich.**
- Exporter behält den vorigen Stand als `model_prev.glb` (Umbenennen vor dem Ersetzen).
- Menü-Schalter „Vorversion“: lädt `model_prev.glb` zusätzlich in denselben `content`-Raum,
  alle Materialien als halbtransparenter Geist (Blau, Deckkraft 0,2, `depthWrite: false`).
- Optional später: Körper farbig nach Änderung (neu / entfernt / verändert) über Vergleich der
  Körperliste und Hüllquader in `scene.json`.

**Reihenfolge innerhalb von Phase 6:** 6.0 → 6.4 (klein, unabhängig) → 6.1 → 6.2 → 6.3.
Testbar wie bisher über eine Testinstanz im Fusion-MCP und den Desktop-Browser; der
Sitzungsschlüssel wird dort per URL mitgegeben.

## Reihenfolge

```
Phase 0 ──► Phase 1 ──► Phase 2 ──► Phase 3 ──┬─► Phase 4
                                              ├─► Phase 5
                                              └─► Phase 6
```

Die Phasen 4–6 sind untereinander unabhängig und können nach Interesse gewählt werden.

## Testen

- **Logik** im Desktop-Browser mit dem *Immersive Web Emulator* (WebXR-Emulation).
- **Fusion-Seite** über das Fusion-MCP: Export auslösen, Dateien und `scene.json` prüfen.
- **Endabnahme** jeder Phase in der Quest 3.
- Vor jedem Test prüfen, aus welchem Pfad Fusion das Add-in lädt (`sys.modules`).
