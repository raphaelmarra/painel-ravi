#!/system/bin/sh
# Parte Android da implantação (roda como root no Android). Idempotente.
D=/data/adb/ravi; T=/data/local/ravi/tmp/painel-dep
cp $T/painel-root.sh $D/painel-root.sh; chmod 755 $D/painel-root.sh
cp $T/alert.sh $D/guard/alert.sh; chmod 755 $D/guard/alert.sh
B=/data/adb/service.d/ravi-boot.sh
if ! grep -q painel-root.sh $B; then
  awk '/^setsid sh \/data\/adb\/ravi\/guard\/run.sh/{print "setsid sh /data/adb/ravi/painel-root.sh >/dev/null 2>&1 &"}{print}' $B > $B.n && mv $B.n $B; chmod 755 $B
fi
G=$D/guard/guard.sh
if ! grep -q start_painel_root $G; then
  cp $G $G.bak-pre-painel
  awk '
    /^start_sshd\(\)\{/{print "start_painel_root(){ setsid sh /data/adb/ravi/painel-root.sh >/dev/null 2>&1 & }"}
    {print}
    /restart sshd start_sshd$/{print "  pgrep -f \"^sh /data/adb/ravi/painel-root.sh\" >/dev/null || restart painel-root start_painel_root"}
  ' $G | sed 's#ravi:ravi ts:tailscaled#ravi:ravi painel:painel ts:tailscaled#' > $G.n && mv $G.n $G; chmod 755 $G
fi
# Tela em modo uso volta sozinha ao modo servidor (limite em guard.conf)
grep -q "^TELA_USO_MIN=" $D/guard/guard.conf || echo "TELA_USO_MIN=30         # minutos ate a tela voltar ao modo servidor" >> $D/guard/guard.conf
if ! grep -q "tela_uso" $G; then
  awk '
    /^  daily_and_weekly$/{
      print "  if [ -f $ST/tela_uso ] && [ $(( $(date +%s) - $(cat $ST/tela_uso) )) -ge $(( ${TELA_USO_MIN:-30} * 60 )) ]; then"
      print "    settings put system screen_brightness 1; settings put system screen_off_timeout 15000; rm -f $ST/tela_uso; log \"tela voltou ao modo servidor\""
      print "  fi"
    }
    {print}' $G > $G.n && mv $G.n $G; chmod 755 $G
fi
# Ciclo da bateria 30-80% (configurável no guard.conf). O guardiao controla; o controle do LineageOS sai.
# Drenar = batt_slate_mode 1 (corta a entrada). Carregar = slate 0 + charging_enabled 1.
# Se o guardiao parar, o boot volta slate 0 e o aparelho carrega normalmente (direcao segura).
grep -q "^BAT_MIN=" $D/guard/guard.conf || printf "BAT_MIN=30             # %% em que volta a carregar\nBAT_MAX=80             # %% em que corta a energia e deixa drenar\n" >> $D/guard/guard.conf
content insert --uri content://lineagesettings/system --bind name:s:charging_control_enabled --bind value:s:0
if ! grep -q "bat_modo" $G; then
  awk '
    /^  daily_and_weekly$/{
      print "  # ciclo da bateria entre BAT_MIN e BAT_MAX, com histerese"
      print "  BT=/sys/class/power_supply/battery; cap=$(cat $BT/capacity); modo=$(cat $ST/bat_modo 2>/dev/null)"
      print "  if [ $cap -le ${BAT_MIN:-30} ]; then novo=carregando; elif [ $cap -ge ${BAT_MAX:-80} ]; then novo=drenando; elif [ -n \"$modo\" ]; then novo=$modo; else novo=drenando; fi"
      print "  if [ \"$novo\" != \"$modo\" ]; then echo $novo > $ST/bat_modo; log \"bateria $cap%: $novo\"; fi"
      print "  if [ $novo = carregando ]; then echo 0 > $BT/batt_slate_mode; echo 1 > $BT/charging_enabled"
      print "    [ \"$(cat /sys/class/power_supply/usb/online)$(cat /sys/class/power_supply/ac/online)\" = 00 ] && alert carregador \"Bateria em $cap% e precisa carregar, mas o carregador esta desconectado.\""
      print "  else echo 1 > $BT/batt_slate_mode; fi"
      print "  [ $cap -le $(( ${BAT_MIN:-30} - 10 )) ] && alert bateria_baixa \"Bateria em $cap%: abaixo do minimo. Confira o carregador.\""
    }
    {print}' $G > $G.n && mv $G.n $G; chmod 755 $G
fi
# Correção de 2026-11-09: o modo da bateria nunca era gravado, porque log() devolvia falso
# e cortava a cadeia "log ... && echo modo > arquivo". Sem modo, a histerese 30-80 não existia.
if grep -qF 'log "bateria $cap%: $novo" && echo $novo > $ST/bat_modo' $G; then
  cp $G $G.bak-pre-bat-fix
  awk '{
    if (index($0, "log \"bateria $cap%: $novo\" && echo $novo > $ST/bat_modo")) print "  if [ \"$novo\" != \"$modo\" ]; then echo $novo > $ST/bat_modo; log \"bateria $cap%: $novo\"; fi";
    else if (index($0, "log(){") == 1 && index($0, "return 0") == 0) { sub(/; }$/, "; return 0; }"); print }
    else print }' $G > $G.n && mv $G.n $G; chmod 755 $G
  echo correcao_bateria_aplicada
fi
# status.json ganha bateria e modo (o painel mostra)
if ! grep -q "bat_modo=" $G; then
  awk '
    /^  get\(\)\{ echo/{
      print "  P=\"$P"
      print "bateria=$(cat /sys/class/power_supply/battery/capacity)"
      print "bat_modo=$(cat $ST/bat_modo 2>/dev/null || echo auto)\""
    }
    {print}' $G > $G.n && mv $G.n $G; chmod 755 $G
fi
sh -n $B && sh -n $G && sh -n $D/painel-root.sh && echo sintaxe_ok
grep -c tela_uso $G | sed 's/^/tela_uso_no_guardiao=/'
grep -c "bat_modo" $G | sed 's/^/bateria_no_guardiao=/'
dumpsys lineagehealth | grep -m1 "Enabled:" | sed 's/^ */lineage_charging_control /'
grep -c "painel" $G | sed 's/^/linhas_painel_no_guardiao=/'
# reinicia o ajudante root para carregar a versao nova (o processo antigo segue com o codigo velho)
kill $(pgrep -f "^sh /data/adb/ravi/painel-root.sh") 2>/dev/null; rm -f /data/local/ravi/run/painel-root/root.lock
setsid sh $D/painel-root.sh </dev/null >/dev/null 2>&1 &
kill $(pgrep -f "^sh /data/adb/ravi/guard/guard.sh") 2>/dev/null
pm enable org.lineageos.jelly >/dev/null 2>&1
echo android_ok
