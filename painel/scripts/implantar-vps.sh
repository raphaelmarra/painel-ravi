#!/bin/bash
# Implanta o painel numa VPS com RAVI (modo vps: leitura e ações reversíveis). Opcional.
set -euo pipefail
cd "$(dirname "$0")/.."
CFG=../config.env; [ -f "$CFG" ] || { echo "Crie o config.env a partir de config.env.example"; exit 1; }
set -a; . "$CFG"; set +a
[ -n "${VPS_HOST:-}" ] || { echo "VPS_HOST vazio no config.env: nada a fazer"; exit 0; }
KV=$(eval echo "$VPS_SSH_KEY"); KS=$(eval echo "$S20_SSH_KEY"); PINF=$(eval echo "$PIN_ARQUIVO"); SRV=$SERVIDORES_JSON
SSH=(ssh -q -i "$KV" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15)
SCP=(scp -q -i "$KV" -o IdentitiesOnly=yes -o BatchMode=yes)
H=root@$VPS_HOST
"${SSH[@]}" $H 'rm -rf /tmp/painel-dep && mkdir -p /tmp/painel-dep' </dev/null
"${SCP[@]}" src/server.ts src/acoes.ts src/ui.html scripts/versoes.ts scripts/definir-pin.ts $H:/tmp/painel-dep/
"${SSH[@]}" $H "install -d -o ravi -g ravi -m 755 /home/ravi/painel && install -o ravi -g ravi -m 644 /tmp/painel-dep/* /home/ravi/painel/ && rm -rf /tmp/painel-dep
install -d -o ravi -g ravi -m 700 /home/ravi/.painel && echo '$SRV' > /home/ravi/.painel/servidores.json && chown ravi:ravi /home/ravi/.painel/servidores.json" </dev/null
# PIN pelo stdin (não aparece em ps)
cat "$PINF" | "${SSH[@]}" $H "su - ravi -s /bin/bash -c 'cd /home/ravi/painel && bun definir-pin.ts'"
"${SSH[@]}" $H "su - ravi -s /bin/bash -c 'cd /home/ravi/painel; (pm2 describe painel >/dev/null 2>&1 && pm2 restart painel --update-env >/dev/null) || PAINEL_MODO=vps PAINEL_NOME=VPS pm2 start bun --name painel --interpreter none --cwd /home/ravi/painel -- /home/ravi/painel/server.ts >/dev/null; sleep 4; pm2 save >/dev/null; curl -s -m5 http://127.0.0.1:8090/healthz'; echo
tailscale serve --bg --https=443 http://127.0.0.1:8090 >/dev/null 2>&1; tailscale serve status 2>&1 | head -3" </dev/null
# seletor também no S20
echo "$SRV" | ssh -q -i "$KS" -o IdentitiesOnly=yes -o BatchMode=yes ravi@$S20_HOST 'cat > ~/.painel/servidores.json'
echo "== pronto"
