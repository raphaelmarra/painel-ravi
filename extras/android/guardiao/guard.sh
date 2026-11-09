#!/system/bin/sh
# Guardiao do S20: supervisiona, reergue e alerta. Roda no Android como root.
# Limites em guard.conf. Estado em state/. Rollback: apagar a linha do guardiao no ravi-boot.sh.
D=/data/adb/ravi/guard
C=/data/adb/ravi/chroot.sh
ST=$D/state; mkdir -p $ST
LOG=$D/guard.log

log(){ echo "$(date '+%F %T') $*" >> $LOG; [ $(stat -c %s $LOG 2>/dev/null || echo 0) -gt 524288 ] && mv $LOG $LOG.1; return 0; }

alert(){ # alert <chave> <mensagem>
  now=$(date +%s); last=$(cat $ST/alert_$1 2>/dev/null || echo 0)
  [ $((now - last)) -lt $ALERT_REPEAT ] && return
  echo $now > $ST/alert_$1
  echo "$(date '+%F %T') $2" >> $D/alerts.log
  log "ALERTA $1: $2"
  [ -x $D/alert.sh ] && (timeout 60 $D/alert.sh "$2" >/dev/null 2>&1 &)
}

can_restart(){ # freio: no maximo MAX_RESTARTS por WINDOW
  f=$ST/restarts_$1; now=$(date +%s); : >> $f
  awk -v n=$now -v w=$WINDOW '$1 > n-w' $f > $f.t; mv $f.t $f
  if [ $(wc -l < $f) -ge $MAX_RESTARTS ]; then
    alert "freio_$1" "$1 caiu $MAX_RESTARTS vezes em $((WINDOW/60)) min; parei de reiniciar. Precisa de olho humano."
    return 1
  fi
  echo $now >> $f; return 0
}

start_tailscaled(){ setsid $C tailscaled --tun=userspace-networking --statedir=/var/lib/tailscale --port=41641 >/data/adb/ravi/tailscaled.log 2>&1 & }
restart_tailscaled(){ pkill -f "tailscaled --tun"; sleep 3; start_tailscaled; }
start_painel_root(){ setsid sh /data/adb/ravi/painel-root.sh >/dev/null 2>&1 & }
start_sshd(){ mkdir -p /data/local/ravi/run/sshd; setsid $C /usr/sbin/sshd >/dev/null 2>&1 & }
pm2(){ timeout 60 $C su - ravi -c "pm2 $*" >/dev/null 2>&1; }
start_pm2(){ # PM2 morto: encerra apps orfaos (evita copias brigando por porta) e ressuscita
  for p in "/home/ravi/.omni/nats-server" "@automagik/omni/dist/server/index.js" "ravi.bot/dist" "pm2-logrotate"; do pkill -f "$p"; done
  pkill -INT -f "postgres -D /home/ravi/.pg/data"; sleep 8
  pkill -9 -f "postgres -D /home/ravi/.pg/data"; rm -f /data/local/ravi/home/ravi/.pg/data/postmaster.pid
  pm2 resurrect
}

fail_count(){ # fail_count <chave> ok|fail -> imprime contagem atual
  f=$ST/fails_$1
  if [ "$2" = ok ]; then echo 0 > $f; echo 0; else n=$(( $(cat $f 2>/dev/null || echo 0) + 1 )); echo $n > $f; echo $n; fi
}

restart(){ # restart <servico> <acao...>
  s=$1; shift
  can_restart $s || return
  log "reiniciando $s"; alert "reinicio_$s" "$s parou de responder; o guardiao reiniciou."
  "$@"
}

daily_and_weekly(){
  h=$(date +%H); day=$(date +%F); dow=$(date +%u); week=$(date +%G-%V)
  if [ "$h" = "$BACKUP_HOUR" ] && [ "$(cat $ST/backup_day 2>/dev/null)" != "$day" ]; then
    echo $day > $ST/backup_day
    if timeout 1800 $C /bin/bash /usr/local/lib/ravi-guard/backup.sh $BACKUP_KEEP >> $D/backup.log 2>&1; then log "backup ok"
    else alert backup "Backup diario falhou. Ver $D/backup.log."; fi
  fi
  if [ "$dow" = "$UPDATE_DOW" ] && [ "$h" = "$UPDATE_HOUR" ] && [ "$(cat $ST/update_week 2>/dev/null)" != "$week" ]; then
    echo $week > $ST/update_week
    timeout 3600 $C /bin/bash /usr/local/lib/ravi-guard/update.sh >> $D/update.log 2>&1
    rc=$?; log "atualizacao rc=$rc"
    [ $rc -ne 0 ] && alert update "Atualizacao semanal com problema (rc=$rc). Ver $D/update.log."
  fi
}

check_once(){
  . $D/guard.conf
  # 1. processos que o PM2 nao supervisiona
  pgrep -f "tailscaled --tun" >/dev/null || restart tailscaled start_tailscaled
  pgrep -f "/usr/sbin/sshd" >/dev/null || restart sshd start_sshd
  pgrep -f "^sh /data/adb/ravi/painel-root.sh" >/dev/null || restart painel-root start_painel_root
  if ! pgrep -f "PM2 v.*God Daemon" >/dev/null; then restart pm2 start_pm2; sleep 20; fi

  # 2. sondas de funcionamento
  P=$(timeout 120 $C /bin/bash /usr/local/lib/ravi-guard/probe.sh "$RAVI_PROBE_SESSION" 2>/dev/null)
  P="$P
bateria=$(cat /sys/class/power_supply/battery/capacity)
bat_modo=$(cat $ST/bat_modo 2>/dev/null || echo auto)"
  get(){ echo "$P" | sed -n "s/^$1=//p" | head -1; }
  echo "{\"time\":\"$(date -Iseconds)\",$(echo "$P" | awk -F= 'NF==2{printf "%s\"%s\":\"%s\"", (n++?",":""), $1, $2}')}" > $D/status.json

  for svc in omni:omni-api pg:omni-pg nats:omni-nats ravi:ravi painel:painel ts:tailscaled; do
    k=${svc%%:*}; app=${svc#*:}; v=$(get $k); [ -z "$v" ] && v=fail
    n=$(fail_count $k $v)
    if [ $n -ge $FAILS ]; then
      echo 0 > $ST/fails_$k
      if [ $app = tailscaled ]; then restart tailscaled restart_tailscaled
      else restart $app pm2 restart $app; fi
    fi
  done
  # apps do PM2 parados ou em erro
  echo "$P" | sed -n 's/^app_\([^=]*\)=\([a-z]*\):\([0-9]*\)$/\1 \2 \3/p' | while read a st rs; do
    name=$(echo $a | tr _ -)
    [ "$st" != online ] && restart $name pm2 restart $name
    prev=$(cat $ST/rs_$a 2>/dev/null || echo $rs); echo $rs > $ST/rs_$a
    [ $((rs - prev)) -ge 5 ] && alert "loop_$a" "$name reiniciou $((rs - prev)) vezes no ultimo minuto (loop de falha)."
  done
  n=$(fail_count dns $(get dns))
  [ $n -ge $((FAILS*5)) ] && { echo 0 > $ST/fails_dns; alert rede "Sem DNS/internet ha $((FAILS*5)) min; reiniciando o Wi-Fi."; can_restart wifi && { svc wifi disable; sleep 5; svc wifi enable; }; }

  # 3. recursos e prazos
  free=$(df /data | awk 'NR==2{gsub("%","",$5); print 100-$5}')
  [ "$free" -lt $DISK_MIN_PCT ] && alert disco "Disco com so $free% livre."
  mem=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
  [ "$mem" -lt $MEM_MIN_MB ] && alert memoria "RAM disponivel baixa: ${mem} MB."
  t=$(( $(cat /sys/class/power_supply/battery/temp) / 10 ))
  [ $t -gt $TEMP_MAX ] && alert temperatura "Bateria a ${t} C."
  hl=$(cat /sys/class/power_supply/battery/health)
  [ "$hl" != Good ] && alert bateria "Saude da bateria: $hl."
  e=$(get ts_expiry_days); [ -n "$e" ] && [ "$e" -lt $TS_EXPIRY_DAYS ] && alert ts_chave "Chave do Tailscale expira em $e dias. Desative a expiracao no painel."

  if [ -f $ST/tela_uso ] && [ $(( $(date +%s) - $(cat $ST/tela_uso) )) -ge $(( ${TELA_USO_MIN:-30} * 60 )) ]; then
    settings put system screen_brightness 1; settings put system screen_off_timeout 15000; rm -f $ST/tela_uso; log "tela voltou ao modo servidor"
  fi
  # ciclo da bateria entre BAT_MIN e BAT_MAX, com histerese
  BT=/sys/class/power_supply/battery; cap=$(cat $BT/capacity); modo=$(cat $ST/bat_modo 2>/dev/null)
  if [ $cap -le ${BAT_MIN:-30} ]; then novo=carregando; elif [ $cap -ge ${BAT_MAX:-80} ]; then novo=drenando; elif [ -n "$modo" ]; then novo=$modo; else novo=drenando; fi
  if [ "$novo" != "$modo" ]; then echo $novo > $ST/bat_modo; log "bateria $cap%: $novo"; fi
  if [ $novo = carregando ]; then echo 0 > $BT/batt_slate_mode; echo 1 > $BT/charging_enabled
    [ "$(cat /sys/class/power_supply/usb/online)$(cat /sys/class/power_supply/ac/online)" = 00 ] && alert carregador "Bateria em $cap% e precisa carregar, mas o carregador esta desconectado."
  else echo 1 > $BT/batt_slate_mode; fi
  [ $cap -le $(( ${BAT_MIN:-30} - 10 )) ] && alert bateria_baixa "Bateria em $cap%: abaixo do minimo. Confira o carregador."
  daily_and_weekly
}

log "guardiao iniciado (pid $$)"
while true; do
  check_once
  . $D/guard.conf; sleep $INTERVAL
done
