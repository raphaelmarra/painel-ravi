// Fases A e B: descobre as operações do RAVI e do Omni e classifica cada uma.
// Sem efeito colateral: só lê os catálogos OpenAPI. Roda no S20 como usuário ravi.
// Uso: bun descobrir.ts <pasta-de-saida>
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";

const out = process.argv[2] ?? "/tmp/painel-descoberta";
mkdirSync(out, { recursive: true });

type Op = { fonte: string; id: string; metodo: string; resumo: string; params: string };

// RAVI: o CLI emite o próprio registro como OpenAPI.
const emit = Bun.spawnSync(["ravi", "sdk", "openapi", "emit"], { cwd: "/tmp" });
const raviFile = "/tmp/docs/openapi.json";
if (!existsSync(raviFile)) throw new Error("ravi sdk openapi emit não gerou " + raviFile + ": " + emit.stderr);
const ravi = JSON.parse(readFileSync(raviFile, "utf8"));
// Omni: a API publica o catálogo sem autenticação.
const omni = await (await fetch("http://127.0.0.1:8882/api/v2/openapi.json")).json();

function campos(op: any): string {
  const s = op.requestBody?.content?.["application/json"]?.schema;
  const props = s?.properties ? Object.keys(s.properties) : [];
  const req = new Set<string>(s?.required ?? []);
  const q = (op.parameters ?? []).map((p: any) => p.name + (p.required ? "*" : ""));
  return [...props.map((p) => p + (req.has(p) ? "*" : "")), ...q].join(",");
}

const ops: Op[] = [];
for (const [path, metodos] of Object.entries<any>(ravi.paths))
  for (const [m, op] of Object.entries<any>(metodos))
    ops.push({ fonte: "ravi", id: path.replace(/^\/api\/v1\//, "").replaceAll("/", " "), metodo: m.toUpperCase(), resumo: (op.summary ?? "").replace(/\s+/g, " "), params: campos(op) });
for (const [path, metodos] of Object.entries<any>(omni.paths))
  for (const [m, op] of Object.entries<any>(metodos))
    if (["get", "post", "put", "patch", "delete"].includes(m))
      ops.push({ fonte: "omni", id: m.toUpperCase() + " " + path, metodo: m.toUpperCase(), resumo: (op.summary ?? "").replace(/\s+/g, " "), params: campos(op) });

// Fase B: classes L, M, D, S, E por regra de código. Ordem importa: a mais grave ganha.
const R = {
  S: /\b(login|logout|token|key|keys|credential|credentials|secret|secrets|password|auth|oauth|passkey)\b/i,
  E: /\b(send|say|react|publish|notify|broadcast|message|messages|reply|post to|dispatch|imagine|charge|pay|invoice)\b/i,
  D: /\b(delete|remove|revoke|purge|reset|disconnect|destroy|drop|wipe|uninstall|kill|stop|logout|archive|unlink)\b/i,
  M: /\b(create|set|update|add|enable|disable|edit|save|start|restart|connect|pair|link|install|sync|import|move|rename|assign|register|configure|write|upsert|patch|apply)\b/i,
  L: /\b(list|show|get|status|read|info|inspect|view|search|find|describe|doctor|health|whoami|stats|trace|tail|logs|export|count|check|help)\b/i,
};
function classe(o: Op): { c: string; certo: boolean } {
  const texto = o.id + " " + o.resumo;
  if (R.S.test(texto)) return { c: "S", certo: true };
  if (R.E.test(o.id) || (o.fonte === "ravi" && R.E.test(o.resumo))) return { c: "E", certo: true };
  if (o.metodo === "DELETE" || R.D.test(o.id)) return { c: "D", certo: true };
  if (o.fonte === "omni") return o.metodo === "GET" ? { c: "L", certo: true } : { c: "M", certo: !R.D.test(o.resumo) };
  if (R.M.test(o.id)) return { c: "M", certo: true };
  if (R.L.test(o.id)) return { c: "L", certo: true };
  if (R.L.test(o.resumo) && !R.M.test(o.resumo)) return { c: "L", certo: true };
  if (R.M.test(o.resumo)) return { c: "M", certo: true };
  return { c: "?", certo: false };
}

const cab = "fonte\tid\tmetodo\tclasse\tparams\tresumo";
const linhas = ops.map((o) => { const k = classe(o); return { o, ...k }; });
const tsv = (xs: typeof linhas) => [cab, ...xs.map(({ o, c }) => [o.fonte, o.id, o.metodo, c, o.params, o.resumo].join("\t"))].join("\n") + "\n";
writeFileSync(join(out, "catalogo-classificado.tsv"), tsv(linhas));
writeFileSync(join(out, "ambiguos.tsv"), tsv(linhas.filter((x) => !x.certo)));

const cont: Record<string, number> = {};
for (const x of linhas) { const k = x.o.fonte + ":" + x.c; cont[k] = (cont[k] ?? 0) + 1; }
console.log(JSON.stringify({ total: ops.length, ravi: ops.filter((o) => o.fonte === "ravi").length, omni: ops.filter((o) => o.fonte === "omni").length, porClasse: cont, ambiguos: linhas.filter((x) => !x.certo).length }));
