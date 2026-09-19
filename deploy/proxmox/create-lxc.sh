#!/usr/bin/env bash
# Crée un conteneur LXC Debian sur l'hôte Proxmox et y installe Glaneur.
# À lancer en root sur l'hôte Proxmox, depuis le dossier du projet copié sur l'hôte :
#   bash deploy/proxmox/create-lxc.sh
#
# Variables facultatives (valeurs par défaut entre parenthèses) :
#   CTID (prochain libre)   CT_HOSTNAME (glaneur)   CORES (2)   MEMORY (1024 Mo)   DISK_GB (6)
#   STORAGE (local-lvm)     TEMPLATE_STORAGE (local)             BRIDGE (vmbr0)
#   IP (dhcp, ou 192.168.1.50/24)   GATEWAY (vide, ou 192.168.1.1)
#   WITH_CHROMIUM (no)      PORT (8080)
set -euo pipefail

info() { printf '\033[1;33m>\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32mOK\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mErreur :\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "lancez ce script en root sur l'hôte Proxmox."
command -v pct >/dev/null 2>&1 || die "pct introuvable : ce script s'exécute sur l'hôte Proxmox."

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
[ -f "$SRC_DIR/package.json" ] || die "package.json introuvable dans $SRC_DIR."

CTID=${CTID:-$(pvesh get /cluster/nextid)}
CT_HOSTNAME=${CT_HOSTNAME:-glaneur}
CORES=${CORES:-2}
MEMORY=${MEMORY:-1024}
DISK_GB=${DISK_GB:-6}
STORAGE=${STORAGE:-local-lvm}
TEMPLATE_STORAGE=${TEMPLATE_STORAGE:-local}
BRIDGE=${BRIDGE:-vmbr0}
IP=${IP:-dhcp}
GATEWAY=${GATEWAY:-}
WITH_CHROMIUM=${WITH_CHROMIUM:-no}
PORT=${PORT:-8080}

if [ "$WITH_CHROMIUM" = "yes" ] && [ "$MEMORY" -lt 2048 ]; then
  info "Chromium demandé : mémoire portée à 2048 Mo."
  MEMORY=2048
fi

info "Recherche du modèle Debian"
pveam update >/dev/null
AVAILABLE=$(pveam available --section system | awk '{print $2}')
TEMPLATE=$(echo "$AVAILABLE" | grep -E '^debian-13-standard_.*_amd64\.tar\.(zst|gz|xz)$' | sort -V | tail -n1 || true)
[ -n "$TEMPLATE" ] || TEMPLATE=$(echo "$AVAILABLE" | grep -E '^debian-12-standard_.*_amd64\.tar\.(zst|gz|xz)$' | sort -V | tail -n1 || true)
[ -n "$TEMPLATE" ] || die "aucun modèle Debian 12 ou 13 disponible."
if ! pveam list "$TEMPLATE_STORAGE" | grep -q "$TEMPLATE"; then
  info "Téléchargement de $TEMPLATE"
  pveam download "$TEMPLATE_STORAGE" "$TEMPLATE"
fi

NET="name=eth0,bridge=${BRIDGE},ip=${IP}"
[ -n "$GATEWAY" ] && NET="${NET},gw=${GATEWAY}"

info "Création du conteneur $CTID ($CT_HOSTNAME)"
pct create "$CTID" "${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}" \
  --hostname "$CT_HOSTNAME" \
  --cores "$CORES" \
  --memory "$MEMORY" \
  --swap 512 \
  --rootfs "${STORAGE}:${DISK_GB}" \
  --net0 "$NET" \
  --unprivileged 1 \
  --features nesting=1 \
  --onboot 1 \
  --timezone host \
  --ostype debian \
  --description "Glaneur : flux RSS sur mesure"
pct start "$CTID"

info "Attente du réseau dans le conteneur"
for _ in $(seq 1 60); do
  if pct exec "$CTID" -- getent hosts deb.debian.org >/dev/null 2>&1; then break; fi
  sleep 2
done
pct exec "$CTID" -- getent hosts deb.debian.org >/dev/null 2>&1 || die "le conteneur n'a pas accès à Internet (réseau ou DNS)."

info "Copie du projet dans le conteneur"
ARCHIVE=$(mktemp /tmp/glaneur-XXXXXX.tar.gz)
tar -C "$SRC_DIR" --exclude=./node_modules --exclude=./dist --exclude=./data --exclude=./.git -czf "$ARCHIVE" .
pct push "$CTID" "$ARCHIVE" /root/glaneur-src.tar.gz
rm -f "$ARCHIVE"
pct exec "$CTID" -- bash -c 'rm -rf /root/glaneur-src && mkdir -p /root/glaneur-src && tar -xzf /root/glaneur-src.tar.gz -C /root/glaneur-src && rm -f /root/glaneur-src.tar.gz'

info "Installation de Glaneur"
pct exec "$CTID" -- env WITH_CHROMIUM="$WITH_CHROMIUM" PORT="$PORT" bash /root/glaneur-src/deploy/install.sh

ADDRESS=$(pct exec "$CTID" -- hostname -I | awk '{print $1}')
ok "Conteneur $CTID prêt : http://${ADDRESS}:${PORT}"
echo "   Pour une mise à jour : copiez la nouvelle version dans le conteneur puis lancez deploy/update.sh."
