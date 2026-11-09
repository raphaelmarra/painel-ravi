// Define o PIN do painel. Uso: bun definir-pin.ts <PIN>  ou  echo PIN | bun definir-pin.ts (não aparece no ps). Invalida as sessões abertas.
import { writeFileSync, chmodSync, mkdirSync } from "fs";
import { randomBytes } from "crypto";
const pin = (process.argv[2] ?? (await Bun.stdin.text())).trim();
if (!/^\d{4,12}$/.test(pin)) { console.error("PIN: 4 a 12 dígitos."); process.exit(1); }
mkdirSync("/home/ravi/.painel", { recursive: true, mode: 0o700 });
const f = "/home/ravi/.painel/auth.json";
writeFileSync(f, JSON.stringify({ pinHash: await Bun.password.hash(pin), segredo: randomBytes(32).toString("hex") })); chmodSync(f, 0o600);
console.log("PIN definido.");
