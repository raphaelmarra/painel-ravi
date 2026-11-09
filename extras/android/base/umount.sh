#!/system/bin/sh
# Desmonta um chroot. Uso: umount.sh <raiz>
R=$1; [ -n "$R" ] || exit 1
for m in dev/shm dev/pts dev proc sys; do mountpoint -q $R/$m && umount -l $R/$m; done
[ "$(mount | grep -c " $R/")" = 0 ]
