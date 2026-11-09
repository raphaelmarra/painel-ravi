// Envia um alerta pelo WhatsApp usando o destino configurado no painel. Sem shell.
// Uso: bun alerta.ts "<mensagem>"   (chamado pelo alert.sh do guardião e pelo painel)
import { readFileSync, existsSync } from "fs";
const f = "/home/ravi/.painel/alerta.json";
if (!existsSync(f)) { console.error("Destino dos alertas não configurado no painel."); process.exit(3); }
const { instanceId, para } = JSON.parse(readFileSync(f, "utf8"));
const msg = "[S20] " + (process.argv[2] ?? "alerta").slice(0, 1000);
const p = Bun.spawnSync(["omni", "send", "--instance", instanceId, "--to", para, "--text", msg], { env: { ...process.env, HOME: "/home/ravi" } });
process.stdout.write(p.stdout); process.stderr.write(p.stderr); process.exit(p.exitCode ?? 1);
