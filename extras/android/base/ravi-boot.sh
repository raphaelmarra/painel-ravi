#!/system/bin/sh
# Boot do S20 como servidor RAVI (Magisk service.d). Rollback: apagar este arquivo.
exec >/data/adb/ravi/boot.log 2>&1
until [ "$(getprop sys.boot_completed)" = "1" ]; do sleep 3; done
sleep 5
echo "$(date) boot"
echo ravi > /sys/power/wake_lock
C=/data/adb/ravi/chroot.sh
sh /data/adb/ravi/mount.sh
setsid $C tailscaled --tun=userspace-networking --statedir=/var/lib/tailscale --port=41641 >/data/adb/ravi/tailscaled.log 2>&1 &
mkdir -p /data/local/ravi/run/sshd
setsid $C /usr/sbin/sshd >/dev/null 2>&1 &
$C su - ravi -c 'pm2 resurrect'
# Guardiao: o laco externo reergue o guardiao se ele morrer
setsid sh /data/adb/ravi/painel-root.sh >/dev/null 2>&1 &
setsid sh /data/adb/ravi/guard/run.sh >/dev/null 2>&1 &
echo "$(date) pronto"
