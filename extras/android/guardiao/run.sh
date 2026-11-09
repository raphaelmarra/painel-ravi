#!/system/bin/sh
# Mantem o guardiao vivo. Uma instancia so.
L=/data/adb/ravi/guard/run.lock
if [ -f $L ] && kill -0 $(cat $L) 2>/dev/null; then exit 0; fi
echo $$ > $L
while true; do sh /data/adb/ravi/guard/guard.sh; sleep 5; done
