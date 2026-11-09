#!/bin/bash
# Atualização do S20 com volta automática. Roda como root dentro do chroot.
# Uso: update.sh [versões maiores permitidas, ex.: node,tailscale]
# Política: dentro da mesma versão maior atualiza sozinho; versão maior só se estiver na lista.
set -uo pipefail
export DEBIAN_FRONTEND=noninteractive PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
MAJ=${1:-}
IDS="node|bun|ravi|omni|pm2|codex|pi|tailscale"
[[ -z "$MAJ" || "$MAJ" =~ ^($IDS)(,($IDS))*$ ]] || { echo "lista de versões maiores inválida: $MAJ"; exit 5; }
L=/usr/local/lib/ravi-guard; BK=/var/backups/ravi-update; mkdir -p $BK
R(){ su - ravi -c "$1"; }
pkg(){ case $1 in ravi) echo ravi.bot;; omni) echo @automagik/omni;; pm2) echo pm2;; codex) echo @openai/codex;; pi) echo @earendil-works/pi-coding-agent;; esac; }
verpkg(){ R "cat ~/.bun/install/global/node_modules/$1/package.json" 2>/dev/null | grep -m1 '"version"' | cut -d'"' -f4; }

echo "== $(date '+%F %T') início (versões maiores permitidas: ${MAJ:-nenhuma})"
bash $L/backup.sh 7 || { echo "backup falhou: atualização cancelada"; exit 3; }
ALVOS=$(R "bun $L/versoes.ts --alvos $MAJ")
echo "alvos:"; echo "${ALVOS:-  nenhum}"

echo "-> apt"
apt-get update -q >/dev/null && apt-get -y -q full-upgrade >/dev/null && apt-get -y -q autoremove >/dev/null && apt-get clean || echo "apt com erro"

declare -A ANT; NODE_BK=""; TS_BK=""
while read -r id v; do
  [ -z "${id:-}" ] && continue
  [[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "versão inválida: $id $v"; continue; }
  case $id in
    ravi|omni|pm2|codex|pi)
      p=$(pkg $id); ANT[$id]=$(verpkg $p); echo "-> $id ${ANT[$id]} → $v"
      R "bun add -g $p@$v >/dev/null 2>&1" || echo "   falhou" ;;
    bun)
      ANT[bun]=$(R "bun --version"); echo "-> bun ${ANT[bun]} → $v"
      R "curl -fsSL https://bun.sh/install | bash -s bun-v$v >/dev/null 2>&1" || echo "   falhou" ;;
    node)
      echo "-> node $(node -v) → v$v"; NODE_BK=$BK/node-$(node -v).tgz
      tar -C /usr/local -czf $NODE_BK bin/node bin/npm bin/npx bin/corepack lib/node_modules include/node 2>/dev/null
      F=node-v$v-linux-arm64.tar.xz
      ( cd /tmp && curl -fsSLO https://nodejs.org/dist/v$v/$F \
        && curl -fsSL https://nodejs.org/dist/v$v/SHASUMS256.txt | grep " $F\$" | sha256sum -c - >/dev/null \
        && tar -xJf $F -C /usr/local --strip-components=1 --exclude=CHANGELOG.md --exclude=LICENSE --exclude=README.md ) \
        && echo "   ok $(node -v)" || echo "   falhou (checksum ou download)"
      rm -f /tmp/$F ;;
    tailscale)
      echo "-> tailscale $(tailscale version | head -1) → $v"; TS_BK=$BK/tailscale-$(tailscale version | head -1); mkdir -p $TS_BK
      cp /usr/local/bin/tailscale /usr/local/bin/tailscaled $TS_BK/
      F=tailscale_${v}_arm64.tgz
      ( cd /tmp && curl -fsSLO https://pkgs.tailscale.com/stable/$F \
        && echo "$(curl -fsSL https://pkgs.tailscale.com/stable/$F.sha256)  $F" | sha256sum -c - >/dev/null \
        && tar xzf $F && install -m755 tailscale_${v}_arm64/tailscale tailscale_${v}_arm64/tailscaled /usr/local/bin/ ) \
        && echo "   ok; o guardião reinicia o tailscaled" && pkill -f "tailscaled --tun" || echo "   falhou (checksum ou download)"
      rm -rf /tmp/$F /tmp/tailscale_${v}_arm64 ;;
  esac
done <<< "$ALVOS"

R 'pm2 update >/dev/null 2>&1; pm2 restart all >/dev/null 2>&1'; sleep 60
ok(){ P=$(bash $L/probe.sh ""); for k in omni pg nats ravi; do echo "$P" | grep -q "^$k=ok" || return 1; done; }
tsok(){ [ -z "$TS_BK" ] && return 0; for i in $(seq 1 18); do tailscale status --self --json 2>/dev/null | grep -q '"Online": *true' && return 0; sleep 10; done; return 1; }
if ok && tsok; then echo "saúde ok"; echo "== $(date '+%F %T') fim"; exit 0; fi

echo "saúde falhou: voltando às versões anteriores"
for id in "${!ANT[@]}"; do
  case $id in bun) R "curl -fsSL https://bun.sh/install | bash -s bun-v${ANT[bun]} >/dev/null 2>&1" ;;
              *)   R "bun add -g $(pkg $id)@${ANT[$id]} >/dev/null 2>&1" ;; esac
done
[ -n "$NODE_BK" ] && tar -C /usr/local -xzf $NODE_BK
[ -n "$TS_BK" ] && cp $TS_BK/* /usr/local/bin/ && pkill -f "tailscaled --tun"
R 'pm2 restart all >/dev/null 2>&1'; sleep 60
if ok && tsok; then echo "volta ok"; exit 2; else echo "volta falhou"; exit 4; fi
