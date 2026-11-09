#!/bin/bash
# Sondas de saude. Roda como root dentro do chroot. Saida: chave=valor.
SESSION="$1"
R(){ su - ravi -c "$1" 2>/dev/null; }
BUN=/home/ravi/.bun/bin/bun
j=$(timeout 10 tailscale status --self --json 2>/dev/null)
echo "ts=$(echo "$j" | $BUN -e 'const j=JSON.parse(await Bun.stdin.text()).Self;console.log(j.Online?"ok":"fail")' 2>/dev/null || echo fail)"
echo "ts_expiry_days=$(echo "$j" | $BUN -e 'const k=JSON.parse(await Bun.stdin.text()).Self.KeyExpiry;console.log(k?Math.floor((Date.parse(k)-Date.now())/864e5):9999)' 2>/dev/null || echo 9999)"
R 'timeout 15 pm2 jlist' | $BUN -e 'const a=JSON.parse(await Bun.stdin.text());for(const p of a)console.log("app_"+p.name.replace(/-/g,"_")+"="+p.pm2_env.status+":"+p.pm2_env.restart_time)' 2>/dev/null
h=$(timeout 8 curl -s http://127.0.0.1:8882/api/v2/health)
echo "omni=$(echo "$h" | grep -q '"status":"healthy"' && echo ok || echo fail)"
echo "pg=$(timeout 8 /usr/lib/postgresql/16/bin/pg_isready -q -h 127.0.0.1 && echo ok || echo fail)"
echo "nats=$(timeout 6 $BUN -e 'const t=setTimeout(()=>{console.log("fail");process.exit(1)},4000);await Bun.connect({hostname:"127.0.0.1",port:4222,socket:{data(s,d){const x=d.toString();if(x.startsWith("INFO"))s.write("CONNECT {\"verbose\":false}\r\nPING\r\n");if(x.includes("PONG")){console.log("ok");process.exit(0)}},error(){console.log("fail");process.exit(1)}}})' 2>/dev/null || echo fail)"
if [ -n "$SESSION" ]; then
  echo "ravi=$(R "timeout 15 ravi sessions runtime list '$SESSION' >/dev/null" && echo ok || echo fail)"
else
  echo "ravi=$(R 'timeout 20 ravi daemon status' | grep -q 'ravi: *online' && echo ok || echo fail)"
fi
echo "dns=$(timeout 8 getent hosts pkgs.tailscale.com >/dev/null && echo ok || echo fail)"
echo "painel=$(timeout 5 curl -s http://127.0.0.1:8090/healthz | grep -q ok && echo ok || echo fail)"
