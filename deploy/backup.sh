#!/usr/bin/env bash
# Copia di sicurezza del database in deploy/backups/, compressa. Tiene gli ultimi 14 giorni.
# Uso:  ~/check-mage/deploy/backup.sh
# Automatico ogni notte alle 3 (guida: docs/DEPLOY.md, passo 11):
#   0 3 * * * /root/check-mage/deploy/backup.sh >> /root/check-mage/deploy/backups/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups

file="backups/checkmage-$(date +%F_%H%M).sql.gz"
# Prima in un file temporaneo: se qualcosa va storto non resta un backup a metà.
docker compose exec -T db pg_dump -U chessuser -d chessdb | gzip > "$file.tmp"
mv "$file.tmp" "$file"

find backups -name 'checkmage-*.sql.gz' -mtime +14 -delete
echo "$(date '+%F %T') backup salvato: deploy/$file ($(du -h "$file" | cut -f1))"
