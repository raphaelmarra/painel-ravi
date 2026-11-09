#!/system/bin/sh
# Monta um chroot. Uso: mount.sh [raiz]. Idempotente.
R=${1:-/data/local/ravi}
mountpoint -q $R/dev || mount --bind /dev $R/dev
mountpoint -q $R/dev/pts || mount -t devpts devpts $R/dev/pts
mkdir -p $R/dev/shm; mountpoint -q $R/dev/shm || mount -t tmpfs -o size=256m,mode=1777 tmpfs $R/dev/shm
mountpoint -q $R/proc || mount -t proc proc $R/proc
mountpoint -q $R/sys || mount -t sysfs sysfs $R/sys
