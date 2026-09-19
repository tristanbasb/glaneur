#!/usr/bin/env bash
# Met à jour une installation existante à partir de ce dossier (nouvelle version copiée dans le conteneur).
# Les données (/var/lib/glaneur) et la configuration (/etc/glaneur) sont conservées.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Lancez ce script en root." >&2; exit 1; }
[ -d /opt/glaneur ] || { echo "Aucune installation trouvée dans /opt/glaneur : utilisez deploy/install.sh." >&2; exit 1; }
WITH_CHROMIUM=${WITH_CHROMIUM:-no} exec bash "$(dirname "${BASH_SOURCE[0]}")/install.sh"
