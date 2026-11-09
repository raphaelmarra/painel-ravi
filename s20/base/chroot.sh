#!/system/bin/sh
# Executa um comando no chroot do RAVI como root. Para o usuario ravi: chroot.sh su - ravi -c '<cmd>'
R=${RAVI_ROOT:-/data/local/ravi}
sh /data/adb/ravi/mount.sh $R
exec chroot $R /usr/bin/env -i HOME=/root TERM=xterm LANG=C.UTF-8 \
  PATH=/root/.local/bin:/root/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin "$@"
