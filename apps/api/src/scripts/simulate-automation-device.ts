import "dotenv/config";
import { randomUUID } from "node:crypto";

/**
 * Simulateur de dev du Raspberry (dossier technique POC §51 point 3 :
 * "créer un simulateur serveur" à utiliser pendant que le matériel
 * Dahua/Arduino n'est pas encore câblé). Reproduit exactement ce que fera le
 * vrai device : poll snapshot avec ETag, heartbeat, remontée d'événement —
 * jamais d'appel au serveur pour valider un code (dossier technique §40),
 * ce script se contente d'illustrer le protocole de synchronisation.
 *
 * Usage :
 *   npm run simulate:automation-device --workspace apps/api -- --key=<clé du device>
 *
 * La clé s'obtient via POST /admin/automation-devices (back-office
 * Automatisation) ou directement :
 *   curl -X POST $API_BASE_URL/admin/automation-devices -H 'Cookie: ...' \
 *     -d '{"name":"Simulateur dev"}'
 */

interface Args {
  key: string;
  baseUrl: string;
  intervalSeconds: number;
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([a-zA-Z]+)=(.*)$/.exec(arg);
    if (match) flags.set(match[1]!, match[2]!);
  }
  const key = flags.get("key");
  if (!key) {
    throw new Error("Usage : --key=<clé du device> [--baseUrl=http://localhost:3010/api/v1] [--intervalSeconds=15]");
  }
  return {
    key,
    baseUrl: flags.get("baseUrl") ?? process.env.API_BASE_URL ?? "http://localhost:3010/api/v1",
    intervalSeconds: Number(flags.get("intervalSeconds") ?? 15),
  };
}

async function callApi(baseUrl: string, key: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  });
  return res;
}

let lastEtag: string | undefined;

async function tick(args: Args) {
  const snapshotRes = await callApi(args.baseUrl, args.key, "/devices/automation/snapshot", {
    headers: lastEtag ? { "If-None-Match": lastEtag } : {},
  });

  if (snapshotRes.status === 304) {
    console.log(`[${new Date().toISOString()}] snapshot inchangé (304, ETag ${lastEtag})`);
  } else if (snapshotRes.ok) {
    const body = (await snapshotRes.json()) as {
      data: { revision: string; zones: unknown[]; grants: unknown[]; lightIntervals: unknown[]; commands: Array<{ id: string; zoneKey: string; type: string }> };
    };
    lastEtag = body.data.revision;
    console.log(
      `[${new Date().toISOString()}] snapshot reçu — révision ${body.data.revision} — ${body.data.zones.length} zone(s), ${body.data.grants.length} grant(s), ${body.data.lightIntervals.length} intervalle(s) lumière, ${body.data.commands.length} commande(s)`,
    );
    if (body.data.commands.length > 0) {
      console.log("  commandes livrées :", JSON.stringify(body.data.commands));
      // Simule l'exécution physique (impulsion verrou / bascule éclairage) puis
      // l'ACK — RASPBERRY_PROTOCOL.md : sans cet ACK, la commande resterait
      // redélivrée à chaque snapshot jusqu'à expiration.
      for (const command of body.data.commands) {
        const ackRes = await callApi(args.baseUrl, args.key, `/devices/automation/commands/${command.id}/ack`, { method: "POST" });
        console.log(`  ACK commande ${command.id} (${command.type}) : ${ackRes.status}`);
      }
    }
  } else {
    console.error(`[${new Date().toISOString()}] snapshot en échec : ${snapshotRes.status} ${await snapshotRes.text()}`);
    return;
  }

  const heartbeatRes = await callApi(args.baseUrl, args.key, "/devices/automation/heartbeat", {
    method: "POST",
    body: JSON.stringify({
      revision: lastEtag,
      uptimeSeconds: Math.round(process.uptime()),
      nanoConnected: true,
      logoReachable: true,
      dbOk: true,
      pendingEvents: 0,
      softwareVersion: "simulator-1.0",
    }),
  });
  if (!heartbeatRes.ok) {
    console.error(`[${new Date().toISOString()}] heartbeat en échec : ${heartbeatRes.status} ${await heartbeatRes.text()}`);
  }
}

async function sendSampleEvent(args: Args) {
  const res = await callApi(args.baseUrl, args.key, "/devices/automation/events", {
    method: "POST",
    body: JSON.stringify({
      events: [{ eventId: randomUUID(), type: "SIMULATED_ACCESS_GRANTED", occurredAt: new Date().toISOString(), payload: { source: "simulator" } }],
    }),
  });
  console.log(`[${new Date().toISOString()}] événement envoyé : ${res.status} ${JSON.stringify(await res.json())}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Simulateur d'automatisation démarré — ${args.baseUrl}, intervalle ${args.intervalSeconds}s`);
  await sendSampleEvent(args);
  await tick(args);
  setInterval(() => {
    tick(args).catch((err) => console.error(err));
  }, args.intervalSeconds * 1000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
