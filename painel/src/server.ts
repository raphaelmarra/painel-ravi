// Painel S20 — servidor. Bun puro, sem dependências. Escuta só em 127.0.0.1.
// Atenção: o tailscaled userspace entrega a tailnet ao 127.0.0.1, então todo acesso exige PIN.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, chmodSync } from "fs";
import { join } from "path";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { ACOES, jobs, limpa, MODO, permitido } from "./acoes";
// Servidores que aparecem no seletor (mesma lista nos dois painéis). Configurável por arquivo.
const SERVIDORES_ARQ = join(process.env.HOME ?? "/home/ravi", ".painel", "servidores.json");
const servidores = () => { try { return JSON.parse(readFileSync(SERVIDORES_ARQ, "utf8")); } catch { return []; } };
const NOME = process.env.PAINEL_NOME ?? (MODO === "android" ? "Android" : "Servidor");

const PORTA = Number(process.env.PAINEL_PORTA ?? 8090);
const DIR = join(process.env.HOME ?? "/home/ravi", ".painel");
const AUTH = join(DIR, "auth.json");
const AUDIT = join(DIR, "auditoria.log");
const DIAS = 30;
mkdirSync(DIR, { recursive: true, mode: 0o700 });

type Auth = { pinHash: string; segredo: string };
function auth(): Auth {
  if (!existsSync(AUTH)) throw new Error("PIN não configurado: rode scripts/pin-inicial.ts");
  return JSON.parse(readFileSync(AUTH, "utf8"));
}
function salvaAuth(a: Auth) { writeFileSync(AUTH, JSON.stringify(a)); chmodSync(AUTH, 0o600); }

// Cookie assinado: <expiração>.<hmac>. Sem estado no servidor.
const assina = (exp: number, seg: string) => createHmac("sha256", seg).update(String(exp)).digest("hex");
function cookieValido(req: Request): boolean {
  const m = (req.headers.get("cookie") ?? "").match(/(?:^|;\s*)painel=(\d+)\.([0-9a-f]{64})/);
  if (!m) return false;
  const exp = +m[1]; if (exp < Date.now()) return false;
  const a = Buffer.from(m[2], "hex"), b = Buffer.from(assina(exp, auth().segredo), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
function novoCookie(): string {
  const exp = Date.now() + DIAS * 864e5;
  return `painel=${exp}.${assina(exp, auth().segredo)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${DIAS * 86400}`;
}

// Freio de tentativas: 5 erros por minuto travam o login; cada trava dobra (1 min, 2, 4... até 60 min).
// Um login certo zera o freio. Necessário porque o PIN pode ter só 4 dígitos.
let erros: number[] = []; let travadoAte = 0; let travas = 0;
function audita(req: Request, acao: string, ok: boolean, detalhe = "") {
  const quem = req.headers.get("tailscale-user-login") ?? (req.headers.get("x-forwarded-for") ? "tailnet" : "local");
  appendFileSync(AUDIT, `${new Date().toISOString()}\t${quem}\t${acao}\t${ok ? "ok" : "erro"}\t${limpa(detalhe).slice(0, 200).replace(/\s+/g, " ")}\n`);
}

const UI = readFileSync(join(import.meta.dir, "ui.html"), "utf8");
const MANIFEST = JSON.stringify({ name: "Painel S20", short_name: "S20", start_url: "/", display: "standalone", background_color: "#000000", theme_color: "#000000",
  icons: [{ src: "/icone.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }] });
const ICONE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="22" fill="#0b0f14"/><circle cx="48" cy="48" r="26" fill="none" stroke="#3ddc97" stroke-width="7"/><circle cx="48" cy="48" r="8" fill="#3ddc97"/></svg>`;

const r = (corpo: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(typeof corpo === "string" ? corpo : JSON.stringify(corpo), { status, headers: { "content-type": typeof corpo === "string" ? "text/plain; charset=utf-8" : "application/json", "cache-control": "no-store", ...extra } });

Bun.serve({
  hostname: "127.0.0.1",
  port: PORTA,
  async fetch(req) {
    const url = new URL(req.url);
    const seg = { "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY" };
    if (url.pathname === "/healthz") return r({ ok: true });
    if (req.method === "GET" && url.pathname === "/") return new Response(UI, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:", ...seg } });
    if (url.pathname === "/manifest.webmanifest") return new Response(MANIFEST, { headers: { "content-type": "application/manifest+json" } });
    if (url.pathname === "/icone.svg") return new Response(ICONE, { headers: { "content-type": "image/svg+xml" } });

    if (!url.pathname.startsWith("/api/")) return r("não encontrado", 404);
    if (req.method !== "GET" && req.headers.get("x-painel") !== "1") return r({ erro: "pedido recusado" }, 403);

    if (url.pathname === "/api/login" && req.method === "POST") {
      if (Date.now() < travadoAte) return r({ erro: `Muitas tentativas. Espere ${Math.ceil((travadoAte - Date.now()) / 60_000)} min.` }, 429);
      const { pin } = await req.json().catch(() => ({}));
      const ok = typeof pin === "string" && /^\d{4,12}$/.test(pin) && (await Bun.password.verify(pin, auth().pinHash));
      audita(req, "login", ok);
      if (!ok) { erros = [...erros.filter((t) => t > Date.now() - 60_000), Date.now()]; if (erros.length >= 5) { travas++; travadoAte = Date.now() + Math.min(60, 2 ** (travas - 1)) * 60_000; erros = []; } return r({ erro: "PIN incorreto." }, 401); }
      travas = 0; erros = [];
      return r({ ok: true }, 200, { "set-cookie": novoCookie() });
    }
    if (!cookieValido(req)) return r({ erro: "Entre com o PIN." }, 401);

    if (url.pathname === "/api/sair" && req.method === "POST") return r({ ok: true }, 200, { "set-cookie": "painel=; Path=/; Max-Age=0" });
    if (url.pathname === "/api/pin" && req.method === "POST") {
      const { atual, novo } = await req.json().catch(() => ({}));
      const a = auth();
      if (!(typeof atual === "string" && (await Bun.password.verify(atual, a.pinHash)))) { audita(req, "sis.pin", false, "pin atual errado"); return r({ erro: "PIN atual incorreto." }, 401); }
      if (typeof novo !== "string" || !/^\d{4,12}$/.test(novo)) return r({ erro: "PIN novo: 4 a 12 dígitos." }, 400);
      salvaAuth({ pinHash: await Bun.password.hash(novo), segredo: randomBytes(32).toString("hex") });
      audita(req, "sis.pin", true); return r({ ok: true, texto: "PIN trocado. Entre de novo." }, 200, { "set-cookie": "painel=; Path=/; Max-Age=0" });
    }
    if (url.pathname.startsWith("/api/job/")) {
      const j = jobs.get(url.pathname.slice(9)); if (!j) return r({ erro: "tarefa não encontrada" }, 404);
      return r({ id: j.id, acao: j.acao, fim: !!j.fim, rc: j.rc ?? null, saida: j.saida });
    }
    if (url.pathname === "/api/info") return r({ nome: NOME, modo: MODO, servidores: servidores() });
    if (url.pathname === "/api/acao" && req.method === "POST") {
      const { id, params } = await req.json().catch(() => ({}));
      const a = typeof id === "string" ? ACOES[id] : undefined;
      if (!a) return r({ erro: "Ação desconhecida." }, 400);
      if (!permitido(id)) { audita(req, id, false, "bloqueada neste servidor"); return r({ ok: false, texto: "Esta ação não está liberada neste servidor (só leitura e ações reversíveis)." }, 403); }
      try {
        const res: any = await a.run(Object.fromEntries(Object.entries(params ?? {}).map(([k, v]) => [k, String(v)])));
        const ehJob = res && typeof res.inicio === "number";
        audita(req, id, ehJob ? true : !!res.ok, ehJob ? "tarefa " + res.id : res.texto);
        return r(ehJob ? { job: res.id } : res);
      } catch (e: any) { audita(req, id, false, e.message); return r({ ok: false, texto: e.message }, 400); }
    }
    return r({ erro: "rota desconhecida" }, 404);
  },
});
console.log(`painel em http://127.0.0.1:${PORTA}`);
