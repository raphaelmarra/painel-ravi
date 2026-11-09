// Cria o PIN inicial do painel. Imprime o PIN uma vez; só o hash fica no S20.
import { existsSync, mkdirSync, writeFileSync, chmodSync } from "fs";
import { randomBytes, randomInt } from "crypto";
const dir = "/home/ravi/.painel", f = dir + "/auth.json";
if (existsSync(f) && process.argv[2] !== "--forcar") { console.error("PIN já existe. Use --forcar para trocar."); process.exit(1); }
mkdirSync(dir, { recursive: true, mode: 0o700 });
const pin = Array.from({ length: 8 }, () => randomInt(10)).join("");
writeFileSync(f, JSON.stringify({ pinHash: await Bun.password.hash(pin), segredo: randomBytes(32).toString("hex") })); chmodSync(f, 0o600);
console.log(pin);
