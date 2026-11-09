#!/bin/bash
# Backup diario: banco do Omni + bancos SQLite do RAVI. Roda como root no chroot.
set -euo pipefail
KEEP=${1:-7}; B=/home/ravi/backups; d=$(date +%F); mkdir -p $B; chown ravi:ravi $B
su - ravi -c "pg_dump -h /home/ravi/.pg/run -Fc omni > $B/omni-$d.dump"
su - ravi -c "mkdir -p /tmp/rb-$d && bun /usr/local/lib/ravi-guard/sqlite-backup.js /tmp/rb-$d ~/.ravi/*.db >/dev/null && tar -C /home/ravi -czf $B/ravi-$d.tgz -C /tmp rb-$d -C /home/ravi .ravi/.env .omni/config.json && rm -rf /tmp/rb-$d"
gzip -t $B/ravi-$d.tgz; su - ravi -c "pg_restore -l $B/omni-$d.dump >/dev/null"
ls -1t $B/omni-*.dump | tail -n +$((KEEP+1)) | xargs -r rm -f
ls -1t $B/ravi-*.tgz | tail -n +$((KEEP+1)) | xargs -r rm -f
chmod 600 $B/*; chown ravi:ravi $B/*
echo "$(date '+%F %T') backup ok: $(ls $B | wc -l) arquivos"
