"""
Pont AP V2 <-> LOGO! réel.

Remplace le simulateur logiciel : ce script poll le snapshot AP V2 comme un
vrai Raspberry, et pour DOOR_OPEN/DOOR_CLOSE appelle ton LogoDriver Modbus
existant (celui qui pulse M2/M3 sur 192.168.0.3:503, deja valide manuellement).

Usage :
    python3 raspberry_bridge.py --key=<cle du device> [--base-url=http://localhost:3010/api/v1]

Fiabilite (RASPBERRY_PROTOCOL.md) : une commande DELIVERED peut reapparaitre
plusieurs fois dans le snapshot avant l'ACK (retry reseau, redemarrage) --
executed_commands.json memorise les ids deja executes physiquement pour
ne jamais pulser deux fois la meme commande, meme apres un reboot de ce
script.
"""

import argparse
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

from pymodbus.client import ModbusTcpClient


class LogoDriver:
    HOST = "192.168.0.3"
    PORT = 503

    # Adresses PyModbus zero-based
    M2_OPEN = 8257
    M3_CLOSE = 8258
    M4_LIGHT_ON = 8259
    M1_LIGHT_OFF = 8256

    def __init__(self, host=None, port=None, pulse_seconds=0.5):
        self.host = host or self.HOST
        self.port = port or self.PORT
        self.pulse_seconds = pulse_seconds

    def _pulse_coil(self, address):
        client = ModbusTcpClient(self.host, port=self.port)

        try:
            if not client.connect():
                raise ConnectionError(
                    f"Impossible de se connecter au LOGO! {self.host}:{self.port}"
                )

            result_on = client.write_coil(address, True)

            if result_on.isError():
                raise RuntimeError(f"Erreur Modbus ON: {result_on}")

            time.sleep(self.pulse_seconds)

            result_off = client.write_coil(address, False)

            if result_off.isError():
                raise RuntimeError(f"Erreur Modbus OFF: {result_off}")

            return True

        finally:
            client.close()

    def open_door(self):
        print("LOGO: ouverture porte")
        return self._pulse_coil(self.M2_OPEN)

    def close_door(self):
        print("LOGO: fermeture porte")
        return self._pulse_coil(self.M3_CLOSE)

    def light_on(self):
        print("LOGO: allumage lumière")
        return self._pulse_coil(self.M4_LIGHT_ON)

    def light_off(self):
        print("LOGO: extinction lumière")
        return self._pulse_coil(self.M1_LIGHT_OFF)


EXECUTED_COMMAND_IDS_FILE = Path(__file__).with_name("executed_commands.json")


def load_executed_ids() -> set:
    if EXECUTED_COMMAND_IDS_FILE.exists():
        return set(json.loads(EXECUTED_COMMAND_IDS_FILE.read_text()))
    return set()


def save_executed_ids(ids: set) -> None:
    EXECUTED_COMMAND_IDS_FILE.write_text(json.dumps(list(ids)[-500:]))


def api_call(base_url, key, path, method="GET", body=None, extra_headers=None):
    url = f"{base_url}{path}"
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
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


def execute_command(logo: LogoDriver, command: dict):
    """Retourne (status, error) : status = "SUCCESS" ou "FAILED"."""
    cmd_type = command["type"]
    try:
        if cmd_type == "DOOR_OPEN":
            logo.open_door()
            return "SUCCESS", None
        if cmd_type == "DOOR_CLOSE":
            logo.close_door()
            return "SUCCESS", None
        if cmd_type == "LIGHT_ON":
            logo.light_on()
            return "SUCCESS", None
        if cmd_type == "LIGHT_OFF":
            logo.light_off()
            return "SUCCESS", None
        return "FAILED", f"UNKNOWN_COMMAND_TYPE:{cmd_type}"
    except Exception as exc:  # noqa: BLE001
        return "FAILED", f"LOGO_CONNECTION_FAILED:{exc}"[:200]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--key", required=True, help="Cle du device (Bearer)")
    parser.add_argument("--base-url", default="http://localhost:3010/api/v1")
    parser.add_argument("--interval-seconds", type=float, default=3.0)
    args = parser.parse_args()

    logo = LogoDriver()
    executed_ids = load_executed_ids()
    last_etag = None

    print(f"Pont AP V2 <-> LOGO! demarre - {args.base_url} - LOGO! {logo.host}:{logo.port}")

    while True:
        headers = {"If-None-Match": last_etag} if last_etag else {}
        status, body = api_call(args.base_url, args.key, "/devices/automation/snapshot", extra_headers=headers)

        if status == 304:
            pass
        elif status == 200:
            data = body["data"]
            last_etag = data["revision"]
            commands = data["commands"]
            if commands:
                print(f"{len(commands)} commande(s) recue(s)")
            for command in commands:
                if command["id"] in executed_ids:
                    print(f"  commande {command['id']} deja executee, re-ACK seulement")
                    api_call(args.base_url, args.key, f"/devices/automation/commands/{command['id']}/ack", method="POST", body={"status": "SUCCESS"})
                    continue

                cmd_status, error = execute_command(logo, command)
                executed_ids.add(command["id"])
                save_executed_ids(executed_ids)

                ack_body = {"status": cmd_status}
                if error:
                    ack_body["error"] = error
                ack_status, _ = api_call(args.base_url, args.key, f"/devices/automation/commands/{command['id']}/ack", method="POST", body=ack_body)
                print(f"  {command['type']} -> {cmd_status}{' (' + error + ')' if error else ''} - ACK {ack_status}")
        else:
            print(f"snapshot en echec : {status} {body}")

        api_call(
            args.base_url,
            args.key,
            "/devices/automation/heartbeat",
            method="POST",
            body={"revision": last_etag, "softwareVersion": "raspberry-bridge-1.0"},
        )

        time.sleep(args.interval_seconds)


if __name__ == "__main__":
    main()
