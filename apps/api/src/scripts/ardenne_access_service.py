"""
Service Raspberry réel (Phase B) — remplace `raspberry_bridge.py` (banc de
test sans cache) comme point central : synchronise le snapshot AP V2 dans
une base SQLite locale, applique l'éclairage automatiquement selon les
horaires calculés côté serveur, exécute les commandes manuelles, valide les
codes localement (hors-ligne), et pilote le LOGO! en Modbus TCP.

Conforme au dossier technique POC (§28-42) :
- synchronisation "snapshot complet" appliquée transactionnellement en
  local (jamais de diff incrémental) ;
- fonctionnement hors-ligne : la lumière et la validation de code
  continuent de fonctionner sur le dernier cache connu même si AP V2 est
  injoignable ;
- le mapping zone -> sortie LOGO! (M1-M4) reste entièrement local, jamais
  connu du serveur (CDC §37).

Usage :
    python3 ardenne_access_service.py --key=<cle du device>
    python3 ardenne_access_service.py --key=<cle> --test-code 1234#   # test hors-ligne, sans boucle

Base SQLite locale : ardenne_access.db (a cote de ce script, comme le POC).
"""

import argparse
import json
import os
import queue
import signal
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from pymodbus.client import ModbusTcpClient

try:
    import serial  # pyserial — optionnel : le service reste utile (LOGO!, synchro) sans clavier branché.
except ImportError:  # pragma: no cover
    serial = None


@contextmanager
def hard_timeout(seconds):
    """Borne absolue en temps reel (SIGALRM), independante de tout parametre
    `timeout=` d'une bibliotheque tierce. Necessaire car pymodbus ne borne pas
    toujours fiablement son `connect()` bas niveau : un LOGO! injoignable a
    deja bloque le service entier pendant ~14 minutes malgre
    `timeout=connect_timeout` passe au client (observe en prod le 2026-09-13)."""

    def _on_alarm(signum, frame):
        raise TimeoutError(f"operation LOGO! au-dela de {seconds}s (bloquee malgre le timeout pymodbus)")

    previous = signal.signal(signal.SIGALRM, _on_alarm)
    signal.alarm(seconds)
    try:
        yield
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous)

# ---------------------------------------------------------------------------
# LOGO! — pilotage matériel (adresses validées sur le POC réel, 2026-09-10/12)
# ---------------------------------------------------------------------------


class LogoDriver:
    HOST = "192.168.0.3"
    PORT = 503

    # Adresses PyModbus zero-based, validees sur le vrai LOGO!.
    M2_DOOR_OPEN = 8257
    M3_DOOR_CLOSE = 8258
    M4_LIGHT_ON = 8259
    M1_LIGHT_OFF = 8256

    def __init__(self, host=None, port=None, pulse_seconds=0.5, connect_timeout=2.0):
        self.host = host or self.HOST
        self.port = port or self.PORT
        self.pulse_seconds = pulse_seconds
        self.connect_timeout = connect_timeout
        self.last_call_ok = True

    def _pulse_coil(self, address):
        client = ModbusTcpClient(self.host, port=self.port, timeout=self.connect_timeout)
        try:
            with hard_timeout(int(self.connect_timeout) + 3):
                if not client.connect():
                    raise ConnectionError(f"Impossible de se connecter au LOGO! {self.host}:{self.port}")
                result_on = client.write_coil(address, True)
                if result_on.isError():
                    raise RuntimeError(f"Erreur Modbus ON: {result_on}")
                time.sleep(self.pulse_seconds)
                result_off = client.write_coil(address, False)
                if result_off.isError():
                    raise RuntimeError(f"Erreur Modbus OFF: {result_off}")
            self.last_call_ok = True
            return True
        except Exception:
            self.last_call_ok = False
            raise
        finally:
            client.close()

    def door_open(self):
        print("LOGO: ouverture porte")
        return self._pulse_coil(self.M2_DOOR_OPEN)

    def door_close(self):
        print("LOGO: fermeture porte")
        return self._pulse_coil(self.M3_DOOR_CLOSE)

    def light_on(self):
        print("LOGO: allumage lumiere")
        return self._pulse_coil(self.M4_LIGHT_ON)

    def light_off(self):
        print("LOGO: extinction lumiere")
        return self._pulse_coil(self.M1_LIGHT_OFF)

    def health_check(self):
        """Ping non intrusif : lit un registre sans jamais piloter une sortie.
        Timeout court et borne (jamais l'attente par defaut de pymodbus) pour
        ne jamais geler la boucle d'eclairage si le reseau est degrade."""
        client = ModbusTcpClient(self.host, port=self.port, timeout=self.connect_timeout)
        try:
            with hard_timeout(int(self.connect_timeout) + 3):
                ok = client.connect()
            self.last_call_ok = ok
            return ok
        except Exception:
            self.last_call_ok = False
            return False
        finally:
            client.close()


# ---------------------------------------------------------------------------
# Clavier Dahua — lu via le pont Arduino Nano (wiegand_keypad_bridge.ino,
# apps/api/src/scripts, envoie "KEY:<car>" par touche décodée, protocole
# confirmé en conditions réelles le 2026-09-15). Tourne dans un thread
# séparé : la lecture série (readline) est bloquante, jamais acceptable
# dans la boucle principale qui doit aussi gérer la synchro et le LOGO!.
# ---------------------------------------------------------------------------


class KeypadReader:
    """Lit le port série du Nano et empile les codes complets (terminés par
    '#') dans une queue thread-safe. '*' efface la saisie en cours (touche
    d'annulation classique sur un clavier de contrôle d'accès). Ne lève
    jamais côté appelant : port absent/débranché -> file d'attente
    simplement toujours vide, jamais une exception qui arrêterait le
    service (même principe que le reste de ce fichier)."""

    def __init__(self, port: str, baudrate: int = 9600, reconnect_delay: float = 5.0):
        self.port = port
        self.baudrate = baudrate
        self.reconnect_delay = reconnect_delay
        self.codes: "queue.Queue[str]" = queue.Queue()
        self._buffer = ""
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.connected = False

    def start(self):
        if serial is None:
            print("[clavier] pyserial n'est pas installé — clavier Dahua désactivé (pip install pyserial).")
            return
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()

    def _run(self):
        while not self._stop.is_set():
            try:
                with serial.Serial(self.port, self.baudrate, timeout=1) as ser:
                    self.connected = True
                    print(f"[clavier] connecté sur {self.port}")
                    while not self._stop.is_set():
                        line = ser.readline().decode("ascii", errors="ignore").strip()
                        if line:
                            self._handle_line(line)
            except Exception as exc:  # noqa: BLE001
                self.connected = False
                print(f"[clavier] port {self.port} indisponible ({exc}) — nouvelle tentative dans {self.reconnect_delay}s")
                time.sleep(self.reconnect_delay)

    def _handle_line(self, line: str):
        if not line.startswith("KEY:"):
            return  # ex. "READY", "ERR:...": diagnostic seulement, jamais transmis au reste du service.
        key = line[len("KEY:") :]
        if key == "*":
            self._buffer = ""
            return
        self._buffer += key
        if key == "#":
            self.codes.put(self._buffer)
            self._buffer = ""

    def drain(self) -> list:
        codes = []
        while True:
            try:
                codes.append(self.codes.get_nowait())
            except queue.Empty:
                break
        return codes


# ---------------------------------------------------------------------------
# Cache local SQLite — snapshot complet, remplacé transactionnellement à
# chaque synchro reussie (dossier technique §39 : jamais de diff incremental).
# ---------------------------------------------------------------------------


class LocalCache:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.conn = sqlite3.connect(str(db_path))
        self.conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self):
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS sync_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                revision TEXT,
                last_synced_at TEXT
            );
            CREATE TABLE IF NOT EXISTS zones (
                key TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                label TEXT NOT NULL,
                court_id TEXT
            );
            CREATE TABLE IF NOT EXISTS grants (
                scope TEXT NOT NULL,
                code TEXT NOT NULL,
                origin TEXT,
                valid_from TEXT NOT NULL,
                valid_until TEXT NOT NULL,
                PRIMARY KEY (scope, code)
            );
            CREATE TABLE IF NOT EXISTS light_intervals (
                zone_key TEXT NOT NULL,
                starts_at TEXT NOT NULL,
                ends_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS light_zone_state (
                zone_key TEXT PRIMARY KEY,
                is_on INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT
            );
            CREATE TABLE IF NOT EXISTS executed_commands (
                command_id TEXT PRIMARY KEY,
                executed_at TEXT
            );
            CREATE TABLE IF NOT EXISTS device_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT NOT NULL,
                type TEXT NOT NULL,
                payload TEXT,
                occurred_at TEXT NOT NULL,
                sent INTEGER NOT NULL DEFAULT 0
            );
            """
        )
        self.conn.commit()

    def apply_snapshot(self, revision: str, zones: list, grants: list, light_intervals: list):
        """Remplace tout le cache "métier" en une transaction (jamais de diff)."""
        with self.conn:
            self.conn.execute("DELETE FROM zones")
            self.conn.execute("DELETE FROM grants")
            self.conn.execute("DELETE FROM light_intervals")
            self.conn.executemany(
                "INSERT INTO zones (key, type, label, court_id) VALUES (?, ?, ?, ?)",
                [(z["key"], z["type"], z["label"], z.get("courtId")) for z in zones],
            )
            self.conn.executemany(
                "INSERT OR REPLACE INTO grants (scope, code, origin, valid_from, valid_until) VALUES (?, ?, ?, ?, ?)",
                [(g["scope"], g["code"], g.get("origin"), g["validFrom"], g["validUntil"]) for g in grants],
            )
            self.conn.executemany(
                "INSERT INTO light_intervals (zone_key, starts_at, ends_at) VALUES (?, ?, ?)",
                [(li["zoneKey"], li["startsAt"], li["endsAt"]) for li in light_intervals],
            )
            self.conn.execute(
                "INSERT INTO sync_state (id, revision, last_synced_at) VALUES (1, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, last_synced_at = excluded.last_synced_at",
                (revision, datetime.now(timezone.utc).isoformat()),
            )

    def get_revision(self):
        row = self.conn.execute("SELECT revision FROM sync_state WHERE id = 1").fetchone()
        return row["revision"] if row else None

    def get_last_synced_at(self):
        row = self.conn.execute("SELECT last_synced_at FROM sync_state WHERE id = 1").fetchone()
        return row["last_synced_at"] if row else None

    def light_intervals_for_zone(self, zone_key: str):
        return self.conn.execute(
            "SELECT starts_at, ends_at FROM light_intervals WHERE zone_key = ?", (zone_key,)
        ).fetchall()

    def all_light_zone_keys(self):
        return [r["key"] for r in self.conn.execute("SELECT key FROM zones WHERE type = 'LIGHT'")]

    def get_light_state(self, zone_key: str) -> bool:
        row = self.conn.execute("SELECT is_on FROM light_zone_state WHERE zone_key = ?", (zone_key,)).fetchone()
        return bool(row["is_on"]) if row else False

    def set_light_state(self, zone_key: str, is_on: bool):
        with self.conn:
            self.conn.execute(
                "INSERT INTO light_zone_state (zone_key, is_on, updated_at) VALUES (?, ?, ?) "
                "ON CONFLICT(zone_key) DO UPDATE SET is_on = excluded.is_on, updated_at = excluded.updated_at",
                (zone_key, 1 if is_on else 0, datetime.now(timezone.utc).isoformat()),
            )

    def has_executed(self, command_id: str) -> bool:
        return self.conn.execute("SELECT 1 FROM executed_commands WHERE command_id = ?", (command_id,)).fetchone() is not None

    def mark_executed(self, command_id: str):
        with self.conn:
            self.conn.execute(
                "INSERT OR IGNORE INTO executed_commands (command_id, executed_at) VALUES (?, ?)",
                (command_id, datetime.now(timezone.utc).isoformat()),
            )
            # Purge best-effort : ne garde que les 500 dernieres, la fenetre du
            # snapshot serveur est de toute facon bornee a quelques jours.
            self.conn.execute(
                "DELETE FROM executed_commands WHERE command_id NOT IN "
                "(SELECT command_id FROM executed_commands ORDER BY executed_at DESC LIMIT 500)"
            )

    def queue_event(self, event_id: str, event_type: str, payload: dict, occurred_at: str):
        with self.conn:
            self.conn.execute(
                "INSERT INTO device_events (event_id, type, payload, occurred_at, sent) VALUES (?, ?, ?, ?, 0)",
                (event_id, event_type, json.dumps(payload), occurred_at),
            )

    def pending_events(self, limit=50):
        return self.conn.execute(
            "SELECT id, event_id, type, payload, occurred_at FROM device_events WHERE sent = 0 ORDER BY id ASC LIMIT ?",
            (limit,),
        ).fetchall()

    def mark_events_sent(self, ids: list):
        if not ids:
            return
        with self.conn:
            self.conn.executemany("UPDATE device_events SET sent = 1 WHERE id = ?", [(i,) for i in ids])

    def pending_events_count(self) -> int:
        return self.conn.execute("SELECT count(*) c FROM device_events WHERE sent = 0").fetchone()["c"]

    def validate_code(self, code: str):
        """Validation locale hors-ligne (dossier technique §40) — jamais d'appel
        reseau ici. Retourne la zone (scope) si le code est valide maintenant,
        sinon None."""
        now = datetime.now(timezone.utc).isoformat()
        row = self.conn.execute(
            "SELECT scope, origin FROM grants WHERE code = ? AND valid_from <= ? AND valid_until >= ? LIMIT 1",
            (code, now, now),
        ).fetchone()
        return (row["scope"], row["origin"]) if row else None

    def db_ok(self) -> bool:
        try:
            self.conn.execute("SELECT 1")
            return True
        except sqlite3.Error:
            return False


# ---------------------------------------------------------------------------
# Client HTTP AP V2
# ---------------------------------------------------------------------------


class ApiClient:
    def __init__(self, base_url: str, key: str):
        self.base_url = base_url
        self.key = key

    def call(self, path: str, method: str = "GET", body=None, extra_headers=None):
        url = f"{self.base_url}{path}"
        headers = {"Authorization": f"Bearer {self.key}", "Content-Type": "application/json"}
        if extra_headers:
            headers.update(extra_headers)
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=10) as res:
                raw = res.read()
                return res.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as err:
            raw = err.read()
            return err.code, (json.loads(raw) if raw else None)


# ---------------------------------------------------------------------------
# Service — synchro + éclairage automatique + exécution de commandes
# ---------------------------------------------------------------------------


class AccessService:
    def __init__(self, api: ApiClient, cache: LocalCache, logo: LogoDriver, keypad: "KeypadReader | None" = None):
        self.api = api
        self.cache = cache
        self.logo = logo
        self.keypad = keypad

    def sync_snapshot(self):
        """Synchro AP V2 -> cache local. Ne leve jamais : en cas d'echec reseau,
        le cache existant reste utilisable (fonctionnement hors-ligne)."""
        try:
            headers = {"If-None-Match": self.cache.get_revision()} if self.cache.get_revision() else {}
            status, body = self.api.call("/devices/automation/snapshot", extra_headers=headers)
            if status == 304:
                return True
            if status != 200:
                print(f"[sync] snapshot en echec : {status} {body}")
                return False
            data = body["data"]
            self.cache.apply_snapshot(data["revision"], data["zones"], data["grants"], data["lightIntervals"])
            print(f"[sync] snapshot applique — revision {data['revision'][:12]}..., {len(data['zones'])} zone(s), "
                  f"{len(data['grants'])} grant(s), {len(data['lightIntervals'])} intervalle(s) lumiere")
            self._execute_commands(data["commands"])
            return True
        except Exception as exc:  # noqa: BLE001
            print(f"[sync] erreur transitoire (cache local conserve) : {exc}")
            return False

    def _execute_commands(self, commands: list):
        for command in commands:
            command_id = command["id"]
            if self.cache.has_executed(command_id):
                # Deja execute physiquement (redelivrance avant ACK confirme) :
                # on ne pulse jamais deux fois, on re-ACK juste au cas ou le
                # precedent se serait perdu.
                self.api.call(f"/devices/automation/commands/{command_id}/ack", method="POST", body={"status": "SUCCESS"})
                continue

            status, error = self._run_command(command["type"])
            self.cache.mark_executed(command_id)
            ack_body = {"status": status}
            if error:
                ack_body["error"] = error
            ack_status, _ = self.api.call(f"/devices/automation/commands/{command_id}/ack", method="POST", body=ack_body)
            print(f"  commande {command['type']} -> {status}{' (' + error + ')' if error else ''} - ACK {ack_status}")

    def _run_command(self, command_type: str):
        try:
            if command_type == "DOOR_OPEN":
                self.logo.door_open()
            elif command_type == "DOOR_CLOSE":
                self.logo.door_close()
            elif command_type == "LIGHT_ON":
                self.logo.light_on()
            elif command_type == "LIGHT_OFF":
                self.logo.light_off()
            else:
                return "FAILED", f"UNKNOWN_COMMAND_TYPE:{command_type}"
            return "SUCCESS", None
        except Exception as exc:  # noqa: BLE001
            return "FAILED", f"LOGO_CONNECTION_FAILED:{exc}"[:200]

    def evaluate_lighting(self):
        """Piece manquante identifiee le 2026-09-13 : applique automatiquement
        l'eclairage selon `lightIntervals` (calcules cote serveur), a partir du
        SEUL cache local — fonctionne meme si AP V2 est injoignable.

        Mapping zone -> sortie physique : le POC actuel n'a qu'un seul relais
        lumiere (Q5, pilote par M4/M1) — toute zone LIGHT du cache y est donc
        mappee pour l'instant. Une installation reelle avec un relais par
        terrain remplacerait cette correspondance par une vraie table locale,
        jamais connue du serveur (CDC §37).
        """
        now_iso = datetime.now(timezone.utc).isoformat()
        for zone_key in self.cache.all_light_zone_keys():
            intervals = self.cache.light_intervals_for_zone(zone_key)
            should_be_on = any(row["starts_at"] <= now_iso <= row["ends_at"] for row in intervals)
            currently_on = self.cache.get_light_state(zone_key)
            if should_be_on == currently_on:
                continue
            try:
                if should_be_on:
                    self.logo.light_on()
                else:
                    self.logo.light_off()
                self.cache.set_light_state(zone_key, should_be_on)
                print(f"[eclairage] zone {zone_key} -> {'ON' if should_be_on else 'OFF'} (automatique, planning)")
            except Exception as exc:  # noqa: BLE001
                print(f"[eclairage] echec pilotage LOGO! pour {zone_key} : {exc}")

    def process_keypad_codes(self):
        """Valide chaque code tapé au clavier Dahua contre le cache local —
        aucun appel réseau ici (dossier technique §40 : validation locale,
        jamais d'appel serveur au moment de la saisie du code). Un succès
        pulse directement la porte (un seul relais physique actuellement,
        cf. commentaire de `evaluate_lighting` sur le mapping zone -> sortie).
        Chaque tentative (accordée ou refusée) est journalisée via la même
        file d'événements que le reste du service, remontée au serveur au
        prochain `flush_events` — utile pour l'audit, jamais bloquant ici.
        """
        if not self.keypad:
            return
        for code in self.keypad.drain():
            result = self.cache.validate_code(code)
            occurred_at = datetime.now(timezone.utc).isoformat()
            if result:
                scope, origin = result
                print(f"[clavier] ACCES ACCORDE — code {code} ({scope}, {origin})")
                self.cache.queue_event(str(uuid.uuid4()), "ACCESS_GRANTED", {"scope": scope, "origin": origin}, occurred_at)
                try:
                    self.logo.door_open()
                except Exception as exc:  # noqa: BLE001
                    print(f"[clavier] échec ouverture porte malgré code valide : {exc}")
            else:
                print(f"[clavier] ACCES REFUSE — code {code}")
                self.cache.queue_event(str(uuid.uuid4()), "ACCESS_DENIED", {}, occurred_at)

    def flush_events(self):
        pending = self.cache.pending_events()
        if not pending:
            return
        events = [
            {"eventId": row["event_id"], "type": row["type"], "occurredAt": row["occurred_at"], "payload": json.loads(row["payload"] or "null")}
            for row in pending
        ]
        status, body = self.api.call("/devices/automation/events", method="POST", body={"events": events})
        if status == 202:
            self.cache.mark_events_sent([row["id"] for row in pending])
            print(f"[events] {len(pending)} evenement(s) envoye(s)")
        else:
            print(f"[events] envoi differe (cache local conserve) : {status} {body}")

    def send_heartbeat(self):
        logo_ok = self.logo.health_check()
        status, _ = self.api.call(
            "/devices/automation/heartbeat",
            method="POST",
            body={
                "revision": self.cache.get_revision(),
                "logoReachable": logo_ok,
                "dbOk": self.cache.db_ok(),
                "pendingEvents": self.cache.pending_events_count(),
                "softwareVersion": "ardenne-access-service-1.0",
            },
        )
        if status != 204:
            print(f"[heartbeat] echec (pas bloquant) : {status}")


def run_loop(service: AccessService, sync_interval: float, light_check_interval: float):
    print("Service ardenne-access demarre — Ctrl+C pour arreter")
    last_sync = 0.0
    while True:
        try:
            now = time.time()
            if now - last_sync >= sync_interval:
                service.sync_snapshot()
                service.flush_events()
                service.send_heartbeat()
                last_sync = now
            # L'eclairage et le clavier sont evalues a chaque tick (plus frequent
            # que la synchro complete) — precision de l'horaire pour l'un,
            # latence d'ouverture minimale pour l'autre — et fonctionnent meme
            # hors-ligne sur le seul cache local.
            service.evaluate_lighting()
            service.process_keypad_codes()
        except Exception as exc:  # noqa: BLE001
            print(f"[loop] erreur transitoire, on continue : {exc}")
        time.sleep(light_check_interval)


def run_test_code(cache: LocalCache, code: str):
    result = cache.validate_code(code)
    if result:
        scope, origin = result
        print(f"ACCESS GRANTED — code {code} valide pour {scope} (origine {origin})")
    else:
        print(f"ACCESS DENIED — code {code} inconnu ou hors fenetre de validite")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--key",
        default=os.environ.get("ARDENNE_ACCESS_KEY"),
        required=os.environ.get("ARDENNE_ACCESS_KEY") is None,
        help="Cle du device (Bearer). Peut aussi venir de la variable d'environnement ARDENNE_ACCESS_KEY (recommande : evite qu'elle apparaisse dans `ps aux`).",
    )
    parser.add_argument("--base-url", default=os.environ.get("ARDENNE_API_BASE_URL", "http://localhost:3010/api/v1"))
    parser.add_argument("--db", default=str(Path(__file__).with_name("ardenne_access.db")))
    # Les commandes manuelles (LIGHT_ON, etc.) ne sont livrées qu'au travers du
    # snapshot complet — pas de route dédiée plus légère. Avec un intervalle
    # trop long (15s/5s par défaut historique), la latence perçue entre un
    # clic admin et l'action réelle sur le LOGO! atteignait ~10-15s (observé
    # le 2026-09-13). Un intervalle court reste peu coûteux grâce à l'ETag
    # (`If-None-Match`) : sans changement, le serveur répond 304 quasi
    # instantanément.
    parser.add_argument("--sync-interval-seconds", type=float, default=3.0)
    parser.add_argument("--light-check-interval-seconds", type=float, default=3.0)
    parser.add_argument("--test-code", help="Valide un code contre le cache local et quitte, sans boucle ni reseau")
    parser.add_argument(
        "--keypad-serial-port",
        default=os.environ.get("ARDENNE_KEYPAD_SERIAL_PORT", "/dev/ttyUSB0"),
        help="Port serie du pont Nano (wiegand_keypad_bridge.ino). Absent/debranche -> clavier desactive, le reste du service continue normalement.",
    )
    parser.add_argument("--no-keypad", action="store_true", help="Desactive explicitement la lecture du clavier (ex. banc de test sans Nano branche).")
    args = parser.parse_args()

    cache = LocalCache(Path(args.db))

    if args.test_code:
        run_test_code(cache, args.test_code)
        return

    api = ApiClient(args.base_url, args.key)
    logo = LogoDriver()
    keypad = None
    if not args.no_keypad:
        keypad = KeypadReader(args.keypad_serial_port)
        keypad.start()
    service = AccessService(api, cache, logo, keypad)

    # Premiere synchro immediate pour ne pas demarrer a vide.
    service.sync_snapshot()
    run_loop(service, args.sync_interval_seconds, args.light_check_interval_seconds)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
