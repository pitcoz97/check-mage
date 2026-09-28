#!/usr/bin/env bash
# Ripristina il database da un backup fatto con backup.sh. CANCELLA i dati attuali.
# Uso:  ~/check-mage/deploy/restore.sh backups/checkmage-2026-09-28_0300.sql.gz
set -euo pipefail
cd "$(dirname "$0")"

file="${1:-}"
if [ -z "$file" ] || [ ! -f "$file" ]; then
  echo "Uso: ./restore.sh backups/NOME-DEL-BACKUP.sql.gz"
  echo "Backup disponibili:"
  ls -1 backups/*.sql.gz 2>/dev/null || echo "  (nessuno)"
  exit 1
fi

echo "ATTENZIONE: i dati attuali (utenti, partite, mazzi) verranno sostituiti con quelli di:"
echo "  $file"
read -r -p "Scrivi SI (maiuscolo) per continuare: " answer
if [ "$answer" != "SI" ]; then
  echo "Annullato."
  exit 1
fi

echo "==> Fermo il server…"
docker compose stop server

echo "==> Ricreo il database vuoto…"
docker compose exec -T db psql -U chessuser -d postgres \
  -c "DROP DATABASE IF EXISTS chessdb WITH (FORCE);" \
  -c "CREATE DATABASE chessdb OWNER chessuser;"

echo "==> Carico il backup…"
gunzip -c "$file" | docker compose exec -T db psql -q -U chessuser -d chessdb -v ON_ERROR_STOP=1 >/dev/null

echo "==> Riavvio il server…"
docker compose start server
echo "==> Ripristino completato."
