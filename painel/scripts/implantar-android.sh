#!/bin/bash
# Implanta o painel num Android com RAVI (extras/android), pela tailnet. Idempotente.
set -euo pipefail
cd "$(dirname "$0")/.."
CFG=../config.env; [ -f "$CFG" ] || { echo "Crie o config.env a partir de config.env.example"; exit 1; }
set -a; . "$CFG"; set +a
[ -n "${ANDROID_HOST:-}" ] || { echo "ANDROID_HOST vazio no config.env"; exit 1; }
H=$ANDROID_HOST; K=$(eval echo "$ANDROID_SSH_KEY"); PINF=$(eval echo "$PIN_ARQUIVO")
SSH=(ssh -i "$K" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15)
SCP=(scp -q -i "$K" -o IdentitiesOnly=yes -o BatchMode=yes)

echo "== copiando arquivos"
"${SSH[@]}" root@$H 'rm -rf /tmp/painel-dep && mkdir -p /tmp/painel-dep'
"${SCP[@]}" src/server.ts src/acoes.ts src/ui.html src/alerta.ts scripts/pin-inicial.ts scripts/painel-root.sh scripts/alert.sh scripts/instalar-android.sh scripts/versoes.ts scripts/update.sh root@$H:/tmp/painel-dep/

echo "== instalando no chroot e no Android"
"${SSH[@]}" root@$H 'set -e
install -d -o ravi -g ravi /opt/painel
install -o ravi -g ravi -m 644 /tmp/painel-dep/server.ts /tmp/painel-dep/acoes.ts /tmp/painel-dep/ui.html /tmp/painel-dep/alerta.ts /tmp/painel-dep/pin-inicial.ts /opt/painel/
install -d -o ravi -g ravi -m 770 /run/painel-root
install -m 644 /tmp/painel-dep/versoes.ts /usr/local/lib/ravi-guard/versoes.ts
cp /usr/local/lib/ravi-guard/update.sh /usr/local/lib/ravi-guard/update.sh.bak-$(date +%Y%m%d%H%M) 2>/dev/null; install -m 755 /tmp/painel-dep/update.sh /usr/local/lib/ravi-guard/update.sh
grep -q "^echo \"painel=" /usr/local/lib/ravi-guard/probe.sh || echo "echo \"painel=\$(timeout 5 curl -s http://127.0.0.1:8090/healthz | grep -q ok && echo ok || echo fail)\"" >> /usr/local/lib/ravi-guard/probe.sh
nsenter -t 1 -m -- /system/bin/sh /data/local/ravi/tmp/painel-dep/instalar-android.sh
rm -rf /tmp/painel-dep'

echo "== subindo o processo painel"
PIN=$("${SSH[@]}" ravi@$H 'cd /opt/painel; [ -f ~/.painel/auth.json ] || bun pin-inicial.ts; (pm2 describe painel >/dev/null 2>&1 && pm2 restart painel >/dev/null) || pm2 start bun --name painel --interpreter none -- /opt/painel/server.ts >/dev/null; sleep 4; pm2 save >/dev/null; curl -s http://127.0.0.1:8090/healthz >&2' )
if [ -n "$PIN" ]; then mkdir -p "$(dirname "$PINF")"; (umask 077; echo "$PIN" > "$PINF"); echo "PIN inicial salvo em $PINF (troque pelo painel em Sistema)"; fi
echo "$SERVIDORES_JSON" | "${SSH[@]}" ravi@$H 'cat > ~/.painel/servidores.json'

echo "== tailscale serve"
"${SSH[@]}" root@$H 'tailscale serve --bg --https=443 http://127.0.0.1:8090 2>&1 | tail -2 || tailscale serve --bg --http=80 http://127.0.0.1:8090 2>&1 | tail -2; tailscale serve status 2>&1 | head -5'
echo "== pronto"
