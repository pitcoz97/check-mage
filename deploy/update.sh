#!/usr/bin/env bash
# Aggiorna CheckMage all'ultima versione su GitHub e riavvia ciò che è cambiato.
# Uso (dalla VPS):  ~/check-mage/deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Scarico l'ultima versione del codice…"
git pull --ff-only

echo "==> Ricostruisco e riavvio i container (qualche minuto)…"
docker compose up -d --build

echo "==> Tolgo le immagini vecchie per non riempire il disco…"
docker image prune -f >/dev/null

echo "==> Fatto. Stato attuale:"
docker compose ps
