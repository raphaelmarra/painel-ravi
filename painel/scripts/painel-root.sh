#!/system/bin/sh
# Ajudante root do painel. Roda no Android. Lê pedidos da fila e executa SÓ as ações abaixo.
# Fila: /data/local/ravi/run/painel-root/{req,res}. Pedido: linhas acao=<nome> e arg=<valor>.
F=/data/local/ravi/run/painel-root; C=/data/adb/ravi/chroot.sh; G=/data/adb/ravi/guard
L=$F/root.lock
if [ -f $L ] && kill -0 $(cat $L) 2>/dev/null; then exit 0; fi
mkdir -p $F/req $F/res; chown 1000:1000 $F $F/req $F/res; chmod 770 $F $F/req $F/res
echo $$ > $L
responde(){ # responde <id> <rc>  (saida em $F/res/<id>)
  echo "__rc=$2" >> $F/res/$1; chown 1000:1000 $F/res/$1; touch $F/res/$1.ok; chown 1000:1000 $F/res/$1.ok; }
executa(){ id=$1; acao=$(sed -n 's/^acao=//p' $F/req/$id | head -1); arg=$(sed -n 's/^arg=//p' $F/req/$id | head -1); rm -f $F/req/$id
  out=$F/res/$id; : > $out
  case "$acao" in
    status)   { cat $G/status.json; echo; echo ---; tail -n 50 $G/alerts.log 2>/dev/null; } > $out 2>&1; responde $id 0 ;;
    guardlog) tail -n 100 $G/guard.log > $out 2>&1; responde $id $? ;;
    versoes)  { echo "LineageOS $(getprop ro.lineage.version)"; echo "Android $(getprop ro.build.version.release) (patch $(getprop ro.build.version.security_patch))"; echo "Magisk $(su -v 2>/dev/null || /debug_ramdisk/magisk -v)"; } > $out 2>&1; responde $id 0 ;;
    backup)   ( timeout 1800 $C /bin/bash /usr/local/lib/ravi-guard/backup.sh 7 > $out 2>&1; responde $id $? ) & ;;
    update)   ( timeout 3600 $C /bin/bash /usr/local/lib/ravi-guard/update.sh "$arg" > $out 2>&1; rc=$?; cat $out >> $G/update.log; responde $id $rc ) & ;;
    updatelog) tail -n 120 $G/update.log > $out 2>&1; responde $id 0 ;;
    aptcheck) timeout 170 $C /bin/bash -c 'apt-get update -qq >/dev/null 2>&1; apt list --upgradable 2>/dev/null | grep -c upgradable' > $out 2>&1; responde $id 0 ;;
    tela)     case "$arg" in
                uso)      settings put system screen_brightness 110; settings put system screen_off_timeout 300000; input keyevent 224; date +%s > $G/state/tela_uso; responde $id 0 ;;
                servidor) settings put system screen_brightness 1; settings put system screen_off_timeout 15000; rm -f $G/state/tela_uso; responde $id 0 ;;
                *) echo "modo invalido" > $out; responde $id 2 ;;
              esac ;;
    reboot)   echo "reiniciando" > $out; responde $id 0; (sleep 3; reboot) & ;;
    *)        echo "acao fora da lista" > $out; responde $id 2 ;;
  esac; }
while true; do
  for r in $F/req/*; do [ -f "$r" ] || continue; case "$r" in *.tmp) continue ;; esac; executa $(basename $r); done
  sleep 1
done
