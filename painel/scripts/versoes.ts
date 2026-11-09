// Consulta de atualizações do S20. Só leitura. Roda como ravi (ou root com HOME=/home/ravi).
// Uso: bun versoes.ts --json            -> tabela completa em JSON
//      bun versoes.ts --alvos [node,..] -> linhas "<id> <versão>" do que deve ser atualizado.
//      Versão maior nova só entra em --alvos se o id estiver na lista.
// Política: dentro da mesma versão maior atualiza sozinho; versão maior nova pede confirmação do dono.
const env = { ...process.env, HOME: "/home/ravi", PATH: "/home/ravi/.bun/bin:/usr/local/bin:/usr/bin:/bin" };
const sh = (a: string[]) => { try { const p = Bun.spawnSync(a, { env }); return (p.stdout.toString() + p.stderr.toString()).trim(); } catch { return ""; } };
const get = async (u: string) => { try { const r = await fetch(u, { headers: { "user-agent": "painel-s20" }, signal: AbortSignal.timeout(20000) }); return r.ok ? await r.json() : null; } catch { return null; } };
const ver = (s: string) => { const m = String(s ?? "").match(/\d+\.\d+(\.\d+)?/); return m ? (m[1] ? m[0] : m[0] + ".0") : ""; };
const maj = (v: string) => Number(v.split(".")[0] || -1);
const cmp = (a: string, b: string) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0); return 0; };
const maior = (vs: string[]) => vs.filter(Boolean).sort(cmp).pop() ?? "";

async function npm(pkg: string, inst: string) {
  const d = await get(`https://registry.npmjs.org/${pkg}`); if (!d) return { todas: "?", mesma: "?" };
  // Canal estável: nunca passa do dist-tags.latest (exclui "next" e esquemas antigos de número).
  const latest = d["dist-tags"]?.latest; if (!latest) return { todas: "?", mesma: "?" };
  const estaveis = Object.keys(d.versions ?? {}).filter((v) => /^\d+\.\d+\.\d+$/.test(v) && cmp(v, latest) <= 0);
  return { todas: latest, mesma: maior(estaveis.filter((v) => maj(v) === maj(inst))) };
}
// Última release do GitHub pelo redirecionamento da página (não gasta a cota da API).
async function ghLatest(repo: string) {
  const h = sh(["curl", "-sI", "-m", "20", `https://github.com/${repo}/releases/latest`]);
  return ver((h.match(/^location:\s*(\S+)/im) ?? ["", ""])[1]);
}
const fontes: Record<string, { nome: string; inst: () => string; nova: (i: string) => Promise<{ todas: string; mesma: string }>; manual?: boolean }> = {
  node: { nome: "Node.js", inst: () => ver(sh(["node", "-v"])), nova: async (i) => {
    const lts = ((await get("https://nodejs.org/dist/index.json")) ?? []).filter((r: any) => r.lts).map((r: any) => ver(r.version));
    return { todas: lts[0] ?? "?", mesma: maior(lts.filter((v: string) => maj(v) === maj(i))) };
  } },
  bun: { nome: "Bun", inst: () => ver(sh(["bun", "--version"])), nova: (i) => npm("bun", i) },
  ravi: { nome: "RAVI", inst: () => ver(sh(["ravi", "--version"])), nova: (i) => npm("ravi.bot", i) },
  omni: { nome: "Omni", inst: () => ver(sh(["omni", "--version"])), nova: (i) => npm("@automagik/omni", i) },
  pm2: { nome: "PM2", inst: () => ver(sh(["pm2", "--version"])), nova: (i) => npm("pm2", i) },
  codex: { nome: "Codex", inst: () => ver(sh(["codex", "--version"])), nova: (i) => npm("@openai/codex", i) },
  pi: { nome: "Pi", inst: () => ver(sh(["pi", "--version"])), nova: (i) => npm("@earendil-works/pi-coding-agent", i) },
  tailscale: { nome: "Tailscale", inst: () => ver(sh(["tailscale", "version"])), nova: async (i) => {
    const v = ver((await get("https://pkgs.tailscale.com/stable/?mode=json"))?.TarballsVersion ?? ""); return { todas: v || "?", mesma: maj(v) === maj(i) ? v : "" };
  } },
  lineage: { nome: "LineageOS", inst: () => "", manual: true, nova: async () => {
    const b = (await get("https://download.lineageos.org/api/v2/devices/x1s/builds"))?.[0];
    return { todas: b ? `${b.version} de ${new Date(b.datetime * 1000).toISOString().slice(0, 10)}` : "?", mesma: "" };
  } },
  magisk: { nome: "Magisk", inst: () => "", manual: true, nova: async () => ({ todas: (await ghLatest("topjohnwu/Magisk")) || "?", mesma: "" }) },
};

const linhas = await Promise.all(Object.entries(fontes).map(async ([id, f]) => {
  const instalada = f.inst(); const n = await f.nova(instalada);
  let estado = "em dia";
  if (f.manual) estado = "manual";
  else if (!instalada) estado = "não instalado";
  else if (n.todas === "?") estado = "sem resposta";
  else if (n.mesma && cmp(n.mesma, instalada) > 0) estado = "atualizar";
  else if (maj(n.todas) > maj(instalada)) estado = "nova versão maior";
  return { id, nome: f.nome, instalada, nova: n.todas, novaMesmaMaior: n.mesma, estado };
}));

const i = process.argv.indexOf("--alvos");
if (i > 0) {
  const majors = new Set((process.argv[i + 1] ?? "").split(",").filter(Boolean));
  for (const l of linhas) {
    if (l.estado === "atualizar") console.log(l.id, l.novaMesmaMaior);
    else if (l.estado === "nova versão maior" && majors.has(l.id)) console.log(l.id, l.nova);
  }
} else console.log(JSON.stringify(linhas));
