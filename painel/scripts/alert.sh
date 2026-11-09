#!/system/bin/sh
# Hook de alertas do guardião: envia pelo destino configurado no painel. Sem shell no meio.
exec timeout 60 /data/adb/ravi/chroot.sh /usr/bin/setpriv --reuid=1000 --regid=1000 --init-groups \
  /usr/bin/env HOME=/home/ravi PATH=/home/ravi/.bun/bin:/usr/local/bin:/usr/bin:/bin \
  /home/ravi/.bun/bin/bun /opt/painel/alerta.ts "$1"
