// Lista fechada de ações do painel. Cada ação tem argv fixo, parâmetros validados e classe.
// Nada aqui passa por shell: Bun.spawn recebe arrays. Ação root vai para a fila do ajudante.
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, unlinkSync, chmodSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

const HOME = "/home/ravi";
// Modo do servidor (PAINEL_MODO):
//   android  = tudo, inclusive ações do Android (bateria, tela, reboot, guardião). "s20" é aceito como sinônimo.
//   completo = servidor Linux comum: tudo, menos as ações do Android.
//   vps      = só leitura e ações reversíveis (servidor em produção).
const MODO_BRUTO = process.env.PAINEL_MODO ?? "android";
export const MODO = (MODO_BRUTO === "s20" ? "android" : MODO_BRUTO) as "android" | "completo" | "vps";
// Ações que dependem do Android (ajudante root, guardião, bateria, tela).
const ACOES_ANDROID = new Set(["inicio.backup", "sis.atualizar", "sis.tela", "sis.reboot", "al.estado", "al.destino", "al.teste"]);
const ACOES_VPS = new Set([
  "inicio.estado", "inicio.reiniciar", "inicio.diagnostico",
  "wpp.lista", "wpp.nova", "wpp.parear", "wpp.qr", "wpp.agente", "rota.lista", "rota.conversas", "rota.add",
  "con.estado", "pi.estado", "pi.modelos",
  "ag.lista", "ag.ver", "ag.salvar", "ag.criar",
  "sis.logs", "sis.versoes", "sis.buscar",
]);
export const permitido = (id: string) => MODO === "android" || (MODO === "completo" ? !ACOES_ANDROID.has(id) : ACOES_VPS.has(id));
const FILA = "/run/painel-root"; // = /data/local/ravi/run/painel-root no Android
const PAINEL = join(HOME, ".painel");
const PI_AUTH = join(HOME, ".pi/agent/auth.json");
// Serviços do Pi por chave de API (ids do próprio pacote, pi-ai/dist/env-api-keys.js + anthropic).
const PI_SERVICOS: Record<string, string> = {
  anthropic: "Anthropic", openai: "OpenAI", google: "Google Gemini", deepseek: "DeepSeek", openrouter: "OpenRouter",
  groq: "Groq", xai: "xAI", mistral: "Mistral", cerebras: "Cerebras", moonshotai: "Moonshot (Kimi)", "kimi-coding": "Kimi For Coding",
  zai: "Z.ai (GLM)", opencode: "OpenCode Zen", "opencode-go": "OpenCode Go", together: "Together AI", fireworks: "Fireworks",
  huggingface: "Hugging Face", nvidia: "NVIDIA NIM", minimax: "MiniMax", "qwen-token-plan-individual": "Qwen", baseten: "Baseten",
  meta: "Meta", xiaomi: "Xiaomi MiMo", "vercel-ai-gateway": "Vercel AI Gateway",
};

export type Classe = "L" | "M" | "D" | "S" | "E";
export type Resultado = { ok: boolean; texto: string; dados?: unknown };
export type Job = { id: string; acao: string; inicio: number; fim?: number; rc?: number; saida: string };

// ---------- utilitários ----------
const SEGREDO = /(omni_sk_[0-9a-f]+|rctx_[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{16,}|sk-ant-[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_.-]+)/g;
export const limpa = (s: string) => s.replace(SEGREDO, "•••").replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");

export async function roda(argv: string[], timeoutMs = 60_000, entrada?: string): Promise<{ rc: number; out: string }> {
  const p = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe", stdin: entrada ? "pipe" : "ignore", env: { ...process.env, HOME, NO_COLOR: "1", FORCE_COLOR: "0" } });
  if (entrada) { p.stdin!.write(entrada); p.stdin!.end(); }
  const t = setTimeout(() => p.kill(), timeoutMs);
  const [o, e] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const rc = await p.exited; clearTimeout(t);
  return { rc, out: limpa((o + (e ? "\n" + e : "")).trim()) };
}
// Lê só o primeiro documento JSON da saída. O Omni escreve a lista e, depois, uma linha
// {"info":"Showing N of M chats"}: ler tudo de uma vez falha (defeito provado em 2026-11-09).
export const json = <T = any>(s: string): T | null => {
  const ini = s.search(/[\[{]/); if (ini < 0) return null;
  let prof = 0, str = false, esc = false;
  for (let i = ini; i < s.length; i++) {
    const c = s[i];
    if (str) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') str = false; continue; }
    if (c === '"') str = true;
    else if (c === "[" || c === "{") prof++;
    else if (c === "]" || c === "}") { prof--; if (prof === 0) { try { return JSON.parse(s.slice(ini, i + 1)); } catch { return null; } } }
  }
  return null;
};

// Fila do ajudante root: grava pedido, espera resposta.
export async function root(acao: string, arg = "", timeoutMs = 60_000): Promise<{ rc: number; out: string }> {
  mkdirSync(join(FILA, "req"), { recursive: true }); mkdirSync(join(FILA, "res"), { recursive: true });
  const id = randomUUID(); const res = join(FILA, "res", id);
  writeFileSync(join(FILA, "req", id + ".tmp"), `acao=${acao}\narg=${arg}\n`);
  Bun.spawnSync(["mv", join(FILA, "req", id + ".tmp"), join(FILA, "req", id)]);
  const fim = Date.now() + timeoutMs;
  while (Date.now() < fim) {
    if (existsSync(res + ".ok")) {
      const t = readFileSync(res, "utf8"); unlinkSync(res); unlinkSync(res + ".ok");
      const m = t.match(/__rc=(\d+)\s*$/); return { rc: m ? +m[1] : 1, out: limpa(t.replace(/__rc=\d+\s*$/, "").trim()) };
    }
    await Bun.sleep(400);
  }
  return { rc: 124, out: "O ajudante root não respondeu a tempo." };
}

// Jobs: ações longas (pair code, logins, atualização) rodam em segundo plano e a UI consulta.
export const jobs = new Map<string, Job>();
export function job(acao: string, fn: (j: Job) => Promise<number>): Job {
  const j: Job = { id: randomUUID(), acao, inicio: Date.now(), saida: "" };
  jobs.set(j.id, j);
  fn(j).then((rc) => { j.rc = rc; }).catch((e) => { j.saida += "\n" + String(e); j.rc = 1; }).finally(() => { j.fim = Date.now(); });
  for (const [k, v] of jobs) if (v.fim && Date.now() - v.fim > 3600_000) jobs.delete(k);
  return j;
}
async function stream(j: Job, argv: string[], timeoutMs: number): Promise<number> {
  const p = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe", env: { ...process.env, HOME, NO_COLOR: "1" } });
  const t = setTimeout(() => p.kill(), timeoutMs);
  const ler = async (s: ReadableStream) => { for await (const c of s) j.saida = limpa(j.saida + new TextDecoder().decode(c)); };
  await Promise.all([ler(p.stdout), ler(p.stderr)]);
  const rc = await p.exited; clearTimeout(t); return rc;
}

// ---------- validação ----------
const V = {
  nome: /^[a-z0-9-]{3,30}$/,            // conexão nova
  inst: /^[A-Za-z0-9][A-Za-z0-9 _.-]{1,49}$/, // conexão existente (nomes antigos podem ter maiúsculas e espaços, ex.: "MINHA LOJA")
  fone: /^\+55\d{10,11}$/,
  svc: /^(ravi|omni-api|omni-nats|omni-pg|ravi-channels)$/,
  logsvc: /^(ravi|omni-api|omni-nats|omni-pg|ravi-channels|painel|guardiao|atualizacao)$/,
  agente: /^[a-z0-9][a-z0-9_-]{0,40}$/,
  token: /^[A-Za-z0-9._-]{20,400}$/,
  modo: /^(uso|servidor)$/,
  pin: /^\d{4,12}$/,
  novoAgente: /^[a-z][a-z0-9-]{1,29}$/,
  provider: /^(claude|codex|pi)$/,
  modeloPi: /^[a-z0-9-]{2,40}\/[A-Za-z0-9._:\/-]{1,120}$/,
};
function exige(p: Record<string, string>, k: string, re: RegExp, msg: string) {
  const v = (p[k] ?? "").trim(); if (!re.test(v)) throw new Error(msg); return v;
}

async function agenteCwd(a: string) {
  const r = await roda(["ravi", "agents", "show", a, "--json"]); const d = json(r.out);
  const cwd = d?.agent?.cwd; if (!cwd || !String(cwd).startsWith(HOME)) throw new Error(`Agente ${a} não encontrado.`); return cwd as string;
}
async function guardaVersao(arquivo: string) {
  if (!existsSync(arquivo)) return;
  const h = join(arquivo, "..", ".historico"); mkdirSync(h, { recursive: true });
  copyFileSync(arquivo, join(h, arquivo.split("/").pop() + "." + new Date().toISOString().replace(/[:.]/g, "-")));
}

// Nomes de função para o usuário comum (auditoria de usabilidade, 2026-11-09).
const NOMES_PROC: Record<string, string> = {
  "omni-pg": "o banco de dados", "omni-nats": "a fila interna", "omni-api": "a ponte do WhatsApp", "ravi": "o RAVI",
  "ravi-channels": "os canais do RAVI", "painel": "o painel", "painel-root": "o ajudante do painel", "tailscaled": "o acesso remoto",
  "sshd": "o acesso remoto por SSH", "pm2": "o gerenciador de serviços", "wifi": "o Wi-Fi",
};
// Converte uma linha de alerta do guardião numa frase comum. Ex.:
// "2026-11-09 09:56:48 omni-pg parou de responder; o guardiao reiniciou." -> "09/11 09:56 · O banco de dados travou e foi religado sozinho."
export function alertaAmigavel(l: string): string {
  const m = l.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2}):\d{2} (.*)$/); if (!m) return l;
  let t = m[5];
  const proc = (n: string) => { const s = NOMES_PROC[n] ?? n; return s[0].toUpperCase() + s.slice(1); };
  t = t.replace(/^(\S+) parou de responder; o guardiao reiniciou\.?/, (_, n) => `${proc(n)} travou e foi religado sozinho.`)
       .replace(/^(\S+) caiu (\d+) vezes em (\d+) min; parei de reiniciar\. Precisa de olho humano\.?/, (_, n, v, w) => `${proc(n)} caiu ${v} vezes em ${w} minutos. O vigia parou de religar: precisa de ajuda.`)
       .replace(/^(\S+) reiniciou (\d+) vezes no ultimo minuto \(loop de falha\)\.?/, (_, n, v) => `${proc(n)} ficou reiniciando sem parar (${v} vezes em 1 minuto).`)
       .replace(/guardiao/g, "vigia");
  return `${m[3]}/${m[2]} ${m[4]} · ${t}`;
}

// Número brasileiro sem o 55: DDD + número (10 ou 11 dígitos). Aceita com ou sem o 55.
function foneLocal(d: string): string {
  const s = d.replace(/\D/g, "");
  if (/^55\d{10,11}$/.test(s)) return s.slice(2);
  if (/^\d{10,11}$/.test(s)) return s;
  return "";
}
function foneBonito(d: string): string {
  const l = foneLocal(d); if (!l) return "+" + d;
  return `+55 (${l.slice(0, 2)}) ${l.length === 11 ? l.slice(2, 7) + "-" + l.slice(7) : l.slice(2, 6) + "-" + l.slice(6)}`;
}

// Pareamento por código: abre a conexão, pede o código para o número e espera conectar.
// Usado por wpp.nova (passos 3 a 5) e wpp.parear (passos 1 a 3).
async function pareia(j: Job, id: string, fone: string, n0: number, total: number): Promise<number> {
  const log = (s: string) => { j.saida += s + "\n"; };
  log(`${n0}/${total} Abrindo a conexão…`);
  const cn = await roda(["omni", "instances", "connect", id, "--json"], 60_000); if (cn.rc !== 0) log("   aviso: " + cn.out); else log("   ok");
  await Bun.sleep(4000);
  log(`${n0 + 1}/${total} Pedindo o código de pareamento para ${fone}…`);
  const pr = await roda(["omni", "instances", "pair", id, "--phone", fone, "--json"], 60_000);
  const pd = json<any>(pr.out); const codigo = pd?.code ?? pd?.pairingCode ?? pd?.data?.code ?? pd?.data?.pairingCode ?? (pr.out.match(/\b[A-Z0-9]{4}-?[A-Z0-9]{4}\b/) ?? [])[0];
  if (!codigo) { log("Falhou ao gerar o código: " + pr.out); return 1; }
  log("CODIGO=" + codigo);
  log("No celular: WhatsApp → Aparelhos conectados → Conectar aparelho → Conectar com número de telefone → digite o código.");
  log(`${n0 + 2}/${total} Esperando a conexão (até 3 min)…`);
  for (let i = 0; i < 60; i++) {
    const st = json<any>((await roda(["omni", "instances", "status", id, "--json"])).out);
    if (st?.isConnected || st?.data?.isConnected) { log("CONECTADO " + (st.profileName ?? st?.data?.profileName ?? "")); return 0; }
    await Bun.sleep(3000);
  }
  log("Tempo esgotado. Gere um código novo e tente de novo."); return 2;
}

// ---------- ações ----------
export type Acao = { classe: Classe; rotulo: string; run: (p: Record<string, string>) => Promise<Resultado | Job> };

export const ACOES: Record<string, Acao> = {
  // Início
  "inicio.estado": { classe: "L", rotulo: "Atualizar estado", run: async () => {
    if (MODO !== "android") {
      const [p, h] = await Promise.all([roda(["pm2", "jlist"]), roda(["curl", "-s", "-m", "8", "http://127.0.0.1:8882/api/v2/health"])]);
      const apps = (json<any[]>(p.out) ?? []).map((x) => ({ nome: x.name, status: x.pm2_env.status, reinicios: x.pm2_env.restart_time, mem: x.monit?.memory }));
      const on = (n: string) => apps.find((a) => a.nome === n)?.status === "online" ? "ok" : "fail";
      const hj = json<any>(h.out);
      const guardiao = { time: new Date().toISOString(), omni: hj?.status === "healthy" ? "ok" : "fail", pg: hj?.checks?.database?.status === "ok" ? "ok" : "fail", nats: hj?.checks?.nats?.status === "ok" ? "ok" : "fail", ravi: on("ravi"), ts: "ok", dns: "ok" };
      return { ok: true, texto: "Estado lido.", dados: { guardiao, alertas: [], apps } };
    }
    const [g, p] = await Promise.all([root("status"), roda(["pm2", "jlist"])]);
    const [st, al] = g.out.split("\n---\n");
    const apps = (json<any[]>(p.out) ?? []).map((x) => ({ nome: x.name, status: x.pm2_env.status, reinicios: x.pm2_env.restart_time, mem: x.monit?.memory }));
    return { ok: g.rc === 0, texto: "Estado lido.", dados: { guardiao: json(st ?? "") ?? {}, alertas: (al ?? "").split("\n").filter(Boolean).slice(-10).map(alertaAmigavel), apps } };
  } },
  "inicio.reiniciar": { classe: "M", rotulo: "Reiniciar serviço", run: async (p) => {
    const s = exige(p, "svc", V.svc, "Serviço inválido.");
    const r = await roda(["pm2", "restart", s], 60_000); return { ok: r.rc === 0, texto: r.rc === 0 ? `${s} reiniciado.` : r.out };
  } },
  "inicio.backup": { classe: "M", rotulo: "Backup agora", run: async () => job("backup", async (j) => { const r = await root("backup", "", 1800_000); j.saida = r.out; return r.rc; }) },
  "inicio.diagnostico": { classe: "L", rotulo: "Diagnóstico", run: async () => {
    const r = await roda(["ravi", "doctor", "--json"], 120_000); const d = json(r.out);
    const achar = (o: any): any[] => Array.isArray(o) ? o : o && typeof o === "object" ? (o.checks ?? achar(o.result)) : [];
    const itens = achar(d).filter((x: any) => /error|warn/.test(x.severity)).map((x: any) => ({ nivel: x.severity, id: x.id, resumo: x.summary ?? x.title }));
    return { ok: true, texto: itens.length ? `${itens.length} pontos de atenção.` : "Sem erros nem avisos.", dados: itens };
  } },

  // WhatsApp
  "wpp.lista": { classe: "L", rotulo: "Conexões", run: async () => {
    const r = await roda(["ravi", "instances", "list", "--json"]); const d = json(r.out);
    return { ok: r.rc === 0, texto: "Conexões lidas.", dados: (d?.instances ?? d?.items ?? []).map((i: any) => ({ nome: i.name, agente: i.agent, instanceId: i.instanceId, status: i.live?.isConnected ? "conectado" : i.instanceId ? "desconectado" : "sem Omni", perfil: i.live?.profileName ?? "" })) };
  } },
  "wpp.nova": { classe: "M", rotulo: "Nova conexão", run: async (p) => {
    const nome = exige(p, "nome", V.nome, "Nome: 3 a 30 letras minúsculas, números ou hífen.");
    const fone = exige(p, "fone", V.fone, "Número: +55, DDD e número, só dígitos.");
    const agente = exige(p, "agente", V.agente, "Agente inválido.");
    return job("wpp.nova", async (j) => {
      const log = (s: string) => { j.saida += s + "\n"; };
      log("1/5 Criando a conexão no Omni…");
      let lista = json<any>((await roda(["omni", "instances", "list", "--json"])).out);
      let inst = (Array.isArray(lista) ? lista : lista?.items ?? []).find((i: any) => i.name === nome);
      if (!inst) { const c = await roda(["omni", "instances", "create", "--name", nome, "--channel", "whatsapp-baileys", "--json"]); inst = json(c.out); if (!inst?.id) { log("Falhou: " + c.out); return 1; } }
      const id = inst.id; log("   ok (" + id.slice(0, 8) + "…)");
      log("2/5 Registrando no RAVI e ligando ao agente " + agente + "…");
      const ex = await roda(["ravi", "instances", "show", nome, "--json"]);
      if (ex.rc !== 0) { const c = await roda(["ravi", "instances", "create", nome, "--agent", agente, "--channel", "whatsapp", "--json"]); if (c.rc !== 0) { log("Falhou: " + c.out); return 1; } }
      const s = await roda(["ravi", "instances", "set", nome, "instanceId", id, "--json"]); if (s.rc !== 0) { log("Falhou: " + s.out); return 1; }
      await roda(["ravi", "instances", "set", nome, "agent", agente, "--json"]);
      log("   ok");
      return pareia(j, id, fone, 3, 5);
    });
  } },
  "wpp.parear": { classe: "M", rotulo: "Código de pareamento", run: async (p) => {
    const nome = exige(p, "nome", V.inst, "Conexão inválida.");
    const fone = exige(p, "fone", V.fone, "Número: +55, DDD e número, só dígitos.");
    const d = json<any>((await roda(["ravi", "instances", "show", nome, "--json"])).out); const id = d?.instance?.instanceId ?? d?.instanceId;
    if (!id) throw new Error("Essa conexão ainda não está no Omni. Use Nova conexão.");
    const st = json<any>((await roda(["omni", "instances", "status", id, "--json"])).out);
    if (st?.isConnected || st?.data?.isConnected) throw new Error(`${nome} já está conectada. Um código novo derrubaria a sessão em uso; desconecte antes (no painel do S20).`);
    return job("wpp.parear", (j) => pareia(j, id, fone, 1, 3));
  } },
  "wpp.qr": { classe: "L", rotulo: "Mostrar QR", run: async (p) => {
    const nome = exige(p, "nome", V.inst, "Conexão inválida.");
    const d = json<any>((await roda(["ravi", "instances", "show", nome, "--json"])).out); const id = d?.instance?.instanceId ?? d?.instanceId;
    if (!id) throw new Error("Conexão sem Omni.");
    const r = await roda(["omni", "instances", "qr", id, "--json"]); const q = json<any>(r.out);
    return { ok: r.rc === 0, texto: "QR gerado.", dados: { qr: q?.qr ?? q?.qrCode ?? q?.data?.qr ?? r.out } };
  } },
  "wpp.agente": { classe: "M", rotulo: "Trocar agente", run: async (p) => {
    const nome = exige(p, "nome", V.inst, "Conexão inválida."); const a = exige(p, "agente", V.agente, "Agente inválido.");
    const r = await roda(["ravi", "instances", "set", nome, "agent", a, "--json"]); return { ok: r.rc === 0, texto: r.rc === 0 ? `${nome} agora responde com o agente ${a}.` : r.out };
  } },
  "rota.lista": { classe: "L", rotulo: "Rotas", run: async (p) => {
    const nome = exige(p, "nome", V.inst, "Conexão inválida.");
    const d = json<any>((await roda(["ravi", "instances", "routes", "list", nome, "--json"])).out);
    const itens = (d?.routes ?? d?.items ?? []).map((x: any) => ({ padrao: x.pattern, agente: x.agent ?? x.agentId, prioridade: x.priority ?? 0 }));
    return { ok: true, texto: "Rotas lidas.", dados: itens };
  } },
  "rota.conversas": { classe: "L", rotulo: "Conversas da conexão", run: async (p) => {
    const nome = exige(p, "nome", V.inst, "Conexão inválida.");
    const tipo = exige(p, "tipo", /^(dm|group)$/, "Tipo inválido.");
    const busca = (p.busca ?? "").trim().slice(0, 60);
    const d = json<any>((await roda(["ravi", "instances", "show", nome, "--json"])).out); const id = d?.instance?.instanceId ?? d?.instanceId;
    if (!id) throw new Error("Essa conexão ainda não está no Omni.");
    const args = ["omni", "chats", "list", "--instance", id, "--type", tipo, "--limit", "60", "--json", ...(busca ? ["--search", busca] : [])];
    const r = await roda(args, 60_000); const lst = json<any>(r.out);
    const itens = (Array.isArray(lst) ? lst : lst?.items ?? lst?.data ?? []).map((c: any) => {
      const ext = String(c.externalId ?? c.chatId ?? c.remoteJid ?? c.jid ?? "");
      let padrao = "";
      if (/@g\.us$/.test(ext)) padrao = "group:" + ext.replace(/@g\.us$/, "");
      // Contato: sufixo "*DDD+número". O Omni guarda alguns números sem o 55; o sufixo casa com e sem
      // o 55 (provado com o matchPattern do RAVI em 2026-11-09).
      let fone = "";
      if (/@s\.whatsapp\.net$/.test(ext)) { fone = ext.replace(/@s\.whatsapp\.net$/, "").replace(/\D/g, ""); const local = foneLocal(fone); if (local) padrao = "*" + local; }
      let nome = c.name ?? c.displayName ?? c.subject ?? "";
      if (!nome || /@/.test(nome)) nome = fone ? foneBonito(fone) : ext;
      return { nome, padrao, ext };
    });
    return { ok: r.rc === 0, texto: itens.length ? `${itens.length} conversas.` : "Nenhuma conversa encontrada.", dados: itens };
  } },
  "rota.add": { classe: "M", rotulo: "Nova rota", run: async (p) => {
    const nome = exige(p, "nome", V.inst, "Conexão inválida."); const a = exige(p, "agente", V.agente, "Agente inválido.");
    const tipo = exige(p, "tipo", /^(contato|prefixo|grupo)$/, "Tipo inválido."); const valor = (p.valor ?? "").replace(/[^\d-]/g, "");
    let padrao = "";
    if (tipo === "contato") { const local = foneLocal(valor); if (!local) throw new Error("Contato: número com DDD, ex.: 11999999999."); padrao = "*" + local; }
    if (tipo === "prefixo") { if (!/^\d{2,8}$/.test(valor)) throw new Error("Prefixo: 2 a 8 dígitos, ex.: 5511."); padrao = valor + "*"; }
    if (tipo === "grupo") { if (!/^[\d-]{5,40}$/.test(valor)) throw new Error("Grupo: o número do grupo (só dígitos e hífen)."); padrao = "group:" + valor; }
    const r = await roda(["ravi", "instances", "routes", "add", nome, padrao, a, "--json"], 60_000);
    return { ok: r.rc === 0, texto: r.rc === 0 ? `Conversas que casam com ${padrao} vão para o agente ${a}.` : "O RAVI recusou: " + r.out.slice(0, 300) };
  } },
  "rota.remover": { classe: "D", rotulo: "Remover rota", run: async (p) => {
    const nome = exige(p, "nome", V.inst, "Conexão inválida."); const padrao = exige(p, "padrao", /^(\d{2,13}\*?|\*\d{10,11}|group:[\d-]{5,40}|\*|thread:\*)$/, "Padrão inválido.");
    const r = await roda(["ravi", "instances", "routes", "remove", nome, padrao, "--json"], 60_000);
    return { ok: r.rc === 0, texto: r.rc === 0 ? `Rota ${padrao} removida (pode ser restaurada no RAVI).` : "O RAVI recusou: " + r.out.slice(0, 300) };
  } },
  "wpp.desconectar": { classe: "D", rotulo: "Desconectar", run: async (p) => {
    const nome = exige(p, "nome", V.inst, "Conexão inválida.");
    if ((p.confirma ?? "") !== nome) throw new Error("Digite o nome da conexão para confirmar.");
    const r = await roda(["ravi", "instances", "disconnect", nome, "--json"]); return { ok: r.rc === 0, texto: r.rc === 0 ? `${nome} desconectada.` : r.out };
  } },

  // Conexões
  "con.estado": { classe: "L", rotulo: "Estado das conexões", run: async () => {
    const [w, env] = [await roda(["ravi", "whoami", "--json"]), existsSync(join(HOME, ".ravi/.env")) ? readFileSync(join(HOME, ".ravi/.env"), "utf8") : ""];
    const who = json<any>(w.out); const codex = await roda(["codex", "login", "status"]).catch(() => ({ rc: 127, out: "" }));
    return { ok: true, texto: "Estado lido.", dados: { console: w.rc === 0 && who ? (who.user?.email ?? who.email ?? who.login ?? "ligado") : null, claude: /^CLAUDE_CODE_OAUTH_TOKEN=.+/m.test(env), codex: codex.rc === 0 ? limpa(codex.out).slice(0, 80) : null } };
  } },
  "con.console": { classe: "S", rotulo: "Conectar ao Ravi Console", run: async () => job("con.console", (j) => stream(j, ["ravi", "login", "--no-open"], 320_000)) },
  "con.logout": { classe: "D", rotulo: "Desligar do Console", run: async () => { const r = await roda(["ravi", "logout"]); return { ok: r.rc === 0, texto: r.rc === 0 ? "S20 desligado do Console." : r.out }; } },
  "con.claude": { classe: "S", rotulo: "Token do Claude", run: async (p) => {
    const t = exige(p, "token", V.token, "Token com formato inválido.");
    const f = join(HOME, ".ravi/.env"); await guardaVersao(f);
    const linhas = (existsSync(f) ? readFileSync(f, "utf8") : "").split("\n").filter((l) => l && !l.startsWith("CLAUDE_CODE_OAUTH_TOKEN="));
    writeFileSync(f, [...linhas, "CLAUDE_CODE_OAUTH_TOKEN=" + t].join("\n") + "\n"); chmodSync(f, 0o600);
    const r = await roda(["ravi", "daemon", "restart"], 90_000);
    return { ok: r.rc === 0, texto: r.rc === 0 ? "Token gravado e RAVI reiniciado. Use \"Testar provider\"." : "Token gravado, mas o reinício falhou: " + r.out };
  } },
  "con.codex": { classe: "S", rotulo: "Instalar e logar Codex", run: async () => job("con.codex", async (j) => {
    if ((await roda(["which", "codex"])).rc !== 0) { j.saida += "Instalando o Codex…\n"; const i = await roda(["bun", "add", "-g", "@openai/codex"], 300_000); if (i.rc !== 0) { j.saida += i.out; return 1; } }
    return stream(j, ["codex", "login", "--device-auth"], 900_000);
  }) },
  // Provider Pi (@earendil-works/pi-coding-agent): uma chave de API por serviço em ~/.pi/agent/auth.json.
  "pi.estado": { classe: "L", rotulo: "Provider Pi", run: async () => {
    const v = await roda(["pi", "--version"]); if (v.rc !== 0) return { ok: true, texto: "Pi não instalado.", dados: { instalado: false, servicos: [] } };
    const auth = existsSync(PI_AUTH) ? JSON.parse(readFileSync(PI_AUTH, "utf8")) : {};
    const servicos = await Promise.all(Object.keys(auth).map(async (p) => {
      const c = json<any>((await roda(["pi", "auth", "check", "--provider", p, "--json", "--no-refresh"], 30_000)).out);
      return { id: p, nome: PI_SERVICOS[p] ?? p, tipo: auth[p]?.type, pronto: c?.status === "ready", motivo: c?.reason ?? "" };
    }));
    return { ok: true, texto: "Pi lido.", dados: { instalado: true, versao: v.out.split("\n")[0], servicos, catalogo: Object.entries(PI_SERVICOS).map(([id, nome]) => ({ id, nome })) } };
  } },
  "pi.instalar": { classe: "M", rotulo: "Instalar Pi", run: async () => job("pi.instalar", async (j) => {
    j.saida = "Instalando o Pi…\n"; const r = await roda(["bun", "add", "-g", "@earendil-works/pi-coding-agent@latest"], 300_000); j.saida += r.out.slice(-500);
    const v = await roda(["pi", "--version"]); j.saida += "\nversão " + v.out; return v.rc;
  }) },
  "pi.chave": { classe: "S", rotulo: "Chave de API do Pi", run: async (p) => {
    const prov = exige(p, "provider", /^[a-z0-9-]{2,40}$/, "Serviço inválido."); if (!PI_SERVICOS[prov]) throw new Error("Serviço fora da lista.");
    const key = exige(p, "chave", /^[\x21-\x7e]{8,500}$/, "Chave com formato inválido (sem espaços).");
    mkdirSync(join(PI_AUTH, ".."), { recursive: true, mode: 0o700 });
    const auth = existsSync(PI_AUTH) ? JSON.parse(readFileSync(PI_AUTH, "utf8")) : {};
    if (existsSync(PI_AUTH)) { const bk = PI_AUTH + ".bak-" + new Date().toISOString().replace(/[:.]/g, "-"); copyFileSync(PI_AUTH, bk); chmodSync(bk, 0o600); }
    auth[prov] = { type: "api_key", key }; writeFileSync(PI_AUTH, JSON.stringify(auth, null, 2)); chmodSync(PI_AUTH, 0o600);
    const c = json<any>((await roda(["pi", "auth", "check", "--provider", prov, "--json"], 30_000)).out);
    return { ok: c?.status === "ready", texto: c?.status === "ready" ? `${PI_SERVICOS[prov]} pronto. A chave não volta a aparecer.` : `Chave gravada, mas o Pi diz: ${c?.reason ?? "sem resposta"}.` };
  } },
  "pi.remover": { classe: "D", rotulo: "Remover chave do Pi", run: async (p) => {
    const prov = exige(p, "provider", /^[a-z0-9-]{2,40}$/, "Serviço inválido.");
    if (!existsSync(PI_AUTH)) throw new Error("Nenhuma chave gravada.");
    const auth = JSON.parse(readFileSync(PI_AUTH, "utf8")); if (!auth[prov]) throw new Error("Esse serviço não tem chave.");
    const bk = PI_AUTH + ".bak-" + new Date().toISOString().replace(/[:.]/g, "-"); copyFileSync(PI_AUTH, bk); chmodSync(bk, 0o600);
    delete auth[prov]; writeFileSync(PI_AUTH, JSON.stringify(auth, null, 2)); chmodSync(PI_AUTH, 0o600);
    return { ok: true, texto: `Chave de ${PI_SERVICOS[prov] ?? prov} removida (cópia anterior guardada no S20).` };
  } },
  "pi.modelos": { classe: "L", rotulo: "Modelos do Pi", run: async () => {
    const r = await roda(["pi", "--list-models"], 60_000);
    const modelos = r.out.split("\n").map((l) => l.trim().split(/\s+/)).filter((c) => c.length >= 2 && /^[a-z0-9-]+$/.test(c[0]) && c[0] !== "provider" && /^[A-Za-z0-9._:\/-]+$/.test(c[1])).map((c) => `${c[0]}/${c[1]}`);
    return { ok: true, texto: modelos.length ? `${modelos.length} modelos.` : "Nenhum modelo: adicione uma chave de serviço.", dados: [...new Set(modelos)] };
  } },
  "con.teste": { classe: "E", rotulo: "Testar provider", run: async () => job("con.teste", (j) => stream(j, ["ravi", "sessions", "send", "agent:main", "Teste do painel: responda só ok.", "--wait"], 240_000)) },

  // Agente
  "ag.lista": { classe: "L", rotulo: "Agentes", run: async () => {
    const d = json<any>((await roda(["ravi", "agents", "list", "--json"])).out);
    return { ok: true, texto: "Agentes lidos.", dados: (d?.agents ?? d?.items ?? []).map((a: any) => a.id) };
  } },
  "ag.ver": { classe: "L", rotulo: "Ver instruções", run: async (p) => {
    const a = exige(p, "agente", V.agente, "Agente inválido."); const f = join(await agenteCwd(a), "AGENTS.md");
    return { ok: true, texto: "Instruções lidas.", dados: { texto: existsSync(f) ? readFileSync(f, "utf8") : "" } };
  } },
  "ag.salvar": { classe: "M", rotulo: "Salvar instruções", run: async (p) => {
    const a = exige(p, "agente", V.agente, "Agente inválido."); const texto = p.texto ?? "";
    if (texto.length > 200_000) throw new Error("Texto grande demais (máx. 200 KB).");
    const cwd = await agenteCwd(a); mkdirSync(cwd, { recursive: true });
    const f = join(cwd, "AGENTS.md"); await guardaVersao(f); writeFileSync(f, texto);
    return { ok: true, texto: "Instruções salvas. A versão anterior ficou em .historico/." };
  } },
  "ag.criar": { classe: "M", rotulo: "Novo agente", run: async (p) => {
    const id = exige(p, "id", V.novoAgente, "Nome do agente: 2 a 30 letras minúsculas, números ou hífen, começando por letra.");
    const prov = exige(p, "provider", V.provider, "Provider inválido.");
    const instr = (p.instrucoes ?? "").trim();
    if (instr.length > 200_000) throw new Error("Instruções grandes demais (máx. 200 KB).");
    const lista = json<any>((await roda(["ravi", "agents", "list", "--json"])).out);
    if ((lista?.agents ?? lista?.items ?? []).some((a: any) => a.id === id)) throw new Error(`Já existe um agente ${id}.`);
    const modelo = prov === "pi" ? exige(p, "modelo", V.modeloPi, "Escolha um modelo do Pi (serviço/modelo).") : "";
    const cwd = join(HOME, "ravi", id); mkdirSync(cwd, { recursive: true });
    const r = await roda(["ravi", "agents", "create", id, cwd, "--provider", prov, ...(modelo ? ["--model", modelo] : []), "--json"], 60_000);
    if (r.rc !== 0) return { ok: false, texto: "O RAVI recusou: " + r.out.slice(0, 300) };
    writeFileSync(join(cwd, "AGENTS.md"), instr || `# ${id}\n\nEscreva aqui as instruções deste agente.\n`);
    return { ok: true, texto: `Agente ${id} criado (provider ${prov}). Edite as instruções e ligue a uma conexão em WhatsApp → Agente.` };
  } },
  "ag.apagar": { classe: "D", rotulo: "Apagar agente", run: async (p) => {
    const id = exige(p, "id", V.agente, "Agente inválido.");
    if (id === "main") throw new Error("O agente main é o padrão e não pode ser apagado pelo painel.");
    if ((p.confirma ?? "") !== id) throw new Error("Digite o nome do agente para confirmar.");
    const cwd = await agenteCwd(id);
    const r = await roda(["ravi", "agents", "delete", id, "--execute", "--json"], 60_000);
    if (r.rc !== 0) return { ok: false, texto: "O RAVI recusou: " + r.out.slice(0, 300) };
    let arq = "";
    if (existsSync(cwd)) { mkdirSync(join(HOME, "arquivo"), { recursive: true }); arq = join(HOME, "arquivo", `${id}-${new Date().toISOString().replace(/[:.]/g, "-")}`); Bun.spawnSync(["mv", cwd, arq]); }
    return { ok: true, texto: `Agente ${id} apagado.` + (arq ? ` A pasta foi guardada em ${arq.replace(HOME, "~")}.` : "") };
  } },
  "ag.teste": { classe: "E", rotulo: "Conversa de teste", run: async (p) => {
    const a = exige(p, "agente", V.agente, "Agente inválido."); const msg = (p.mensagem ?? "").trim();
    if (!msg || msg.length > 2000) throw new Error("Mensagem de 1 a 2000 caracteres.");
    return job("ag.teste", (j) => stream(j, ["ravi", "sessions", "send", "agent:" + a, msg, "--wait"], 300_000));
  } },

  // Alertas
  "al.estado": { classe: "L", rotulo: "Alertas", run: async () => {
    const f = join(PAINEL, "alerta.json"); const g = await root("status");
    return { ok: true, texto: "Alertas lidos.", dados: { destino: existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null, ultimos: (g.out.split("\n---\n")[1] ?? "").split("\n").filter(Boolean).slice(-50).map(alertaAmigavel) } };
  } },
  "al.destino": { classe: "M", rotulo: "Destino dos alertas", run: async (p) => {
    const nome = exige(p, "nome", V.inst, "Conexão inválida."); const fone = exige(p, "fone", V.fone, "Número: +55, DDD e número.");
    const d = json<any>((await roda(["ravi", "instances", "show", nome, "--json"])).out); const id = d?.instance?.instanceId ?? d?.instanceId;
    if (!id) throw new Error("Essa conexão ainda não está no Omni.");
    mkdirSync(PAINEL, { recursive: true }); writeFileSync(join(PAINEL, "alerta.json"), JSON.stringify({ conexao: nome, instanceId: id, para: fone }, null, 2));
    return { ok: true, texto: `Alertas vão para ${fone} pela conexão ${nome}.` };
  } },
  "al.teste": { classe: "E", rotulo: "Enviar alerta de teste", run: async () => {
    const r = await roda(["bun", "/opt/painel/alerta.ts", "Alerta de teste enviado pelo painel."], 60_000);
    return { ok: r.rc === 0, texto: r.rc === 0 ? "Alerta enviado. Confira o WhatsApp." : r.out };
  } },

  // Sistema
  "sis.logs": { classe: "L", rotulo: "Logs", run: async (p) => {
    const s = exige(p, "svc", V.logsvc, "Serviço inválido.");
    if (MODO !== "android" && (s === "guardiao" || s === "atualizacao")) throw new Error("Este registro só existe no modo Android.");
    const r = s === "guardiao" ? await root("guardlog") : s === "atualizacao" ? await root("updatelog") : await roda(["pm2", "logs", s, "--nostream", "--lines", "100", "--raw"]);
    return { ok: r.rc === 0, texto: "Últimas linhas.", dados: { texto: r.out } };
  } },
  "sis.tela": { classe: "M", rotulo: "Modo da tela", run: async (p) => {
    const m = exige(p, "modo", V.modo, "Modo inválido."); const r = await root("tela", m);
    return { ok: r.rc === 0, texto: m === "uso" ? "Tela em modo uso: brilho médio, apaga em 5 min. Volta sozinha ao modo servidor em 30 min." : "Tela em modo servidor: brilho mínimo, apaga em 15 s." };
  } },
  "sis.versoes": { classe: "L", rotulo: "Versões", run: async () => {
    const v = async (a: string[]) => (await roda(a)).out.split("\n")[0];
    const os = readFileSync("/etc/os-release", "utf8").match(/PRETTY_NAME="([^"]+)"/)?.[1];
    const and = MODO !== "android" ? "" : (await root("versoes")).out;
    return { ok: true, texto: "Versões lidas.", dados: { sistema: os, ravi: await v(["ravi", "--version"]), omni: await v(["omni", "--version"]), node: await v(["node", "-v"]), bun: await v(["bun", "--version"]), pm2: await v(["pm2", "--version"]), android: and } };
  } },
  "sis.buscar": { classe: "L", rotulo: "Buscar atualizações", run: async () => {
    if (MODO !== "android") {
      const v = await roda(["bun", join(import.meta.dir, "versoes.ts"), "--json"], 90_000);
      const linhas = (json<any[]>(v.out) ?? []).filter((l) => !["lineage", "magisk"].includes(l.id));
      const pend = linhas.filter((l) => l.estado === "atualizar").length;
      return { ok: v.rc === 0, texto: (pend ? `${pend} com versão nova.` : "Tudo em dia.") + (MODO === "vps" ? " Neste servidor o painel só consulta." : " Atualize pelo gerenciador do servidor."), dados: linhas };
    }
    const [v, apt, and] = await Promise.all([roda(["bun", "/usr/local/lib/ravi-guard/versoes.ts", "--json"], 90_000), root("aptcheck", "", 180_000), root("versoes")]);
    const linhas = json<any[]>(v.out) ?? [];
    const lineage = (and.out.match(/LineageOS (\S+)/) ?? [])[1] ?? "", magisk = (and.out.match(/Magisk (\S+)/) ?? [])[1] ?? "";
    for (const l of linhas) { if (l.id === "lineage") l.instalada = lineage; if (l.id === "magisk") l.instalada = magisk; }
    const n = parseInt(apt.out) || 0;
    linhas.unshift({ id: "apt", nome: "Ubuntu (pacotes)", instalada: "24.04 LTS", nova: n ? `${n} pacotes` : "nenhum pendente", estado: n ? "atualizar" : "em dia" });
    const pend = linhas.filter((l) => l.estado === "atualizar").length, maj = linhas.filter((l) => l.estado === "nova versão maior").length;
    return { ok: v.rc === 0, texto: pend || maj ? `${pend} para atualizar, ${maj} com versão maior nova.` : "Tudo em dia.", dados: linhas };
  } },
  "sis.atualizar": { classe: "D", rotulo: "Atualizar agora", run: async (p) => {
    const majors = (p.majors ?? "").trim();
    if (majors && !/^(node|bun|ravi|omni|pm2|codex|pi|tailscale)(,(node|bun|ravi|omni|pm2|codex|pi|tailscale))*$/.test(majors)) throw new Error("Lista de versões maiores inválida.");
    return job("sis.atualizar", async (j) => { j.saida = "Atualizando (pode levar até 30 min). Se o Tailscale for atualizado, o acesso remoto cai por alguns segundos.\n"; const r = await root("update", majors, 3600_000); j.saida += r.out; return r.rc; });
  } },
  "sis.reboot": { classe: "D", rotulo: "Reiniciar o S20", run: async (p) => {
    if ((p.confirma ?? "") !== "REINICIAR") throw new Error("Digite REINICIAR para confirmar.");
    await root("reboot"); return { ok: true, texto: "O S20 vai reiniciar. O painel volta em cerca de 2 minutos." };
  } },
};
