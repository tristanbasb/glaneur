#!/usr/bin/env bash
# Installe (ou met à jour) Glaneur dans un conteneur LXC Debian/Ubuntu.
# À lancer en root depuis le dossier du projet :  bash deploy/install.sh
#
# Variables facultatives :
#   WITH_CHROMIUM=yes|no|ask   installe Chromium pour le rendu JavaScript (défaut : ask)
#   PORT=8080                  port d'écoute écrit dans /etc/glaneur/glaneur.env à la première installation
set -euo pipefail

APP_DIR=/opt/glaneur
DATA_DIR=/var/lib/glaneur
CONF_DIR=/etc/glaneur
NODE_MAJOR=24
WITH_CHROMIUM=${WITH_CHROMIUM:-ask}
PORT=${PORT:-8080}

info() { printf '\033[1;33m>\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32mOK\033[0m %s\n' "$*"; }
warn() { printf '\033[1;31m!\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mErreur :\033[0m %s\n' "$*" >&2; exit 1; }

# Installe des paquets sans leurs « recommandés » (services de bureau inutiles sur un serveur, qui échouent
# souvent dans un conteneur). En cas d'échec, affiche la fin de la sortie d'apt.
apt_install() {
  local log
  log=$(mktemp)
  if apt-get install -y -qq --no-install-recommends "$@" >"$log" 2>&1; then
    rm -f "$log"
    return 0
  fi
  tail -n 25 "$log" >&2
  rm -f "$log"
  return 1
}

# Vrai paquet Chromium de Debian. Ubuntu ne propose sous ce nom qu'un paquet de transition vers un snap,
# qui ne peut pas s'installer dans un conteneur LXC.
debian_chromium() {
  local record
  record=$(apt-cache show --no-all-versions chromium 2>/dev/null) || return 1
  grep -q '^Package: chromium$' <<<"$record" && ! grep -q '^Version:.*snap' <<<"$record"
}

[ "$(id -u)" -eq 0 ] || die "lancez ce script en root."
command -v apt-get >/dev/null 2>&1 || die "seules Debian et Ubuntu sont prises en charge."
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "$SRC_DIR/package.json" ] || die "package.json introuvable dans $SRC_DIR."

if [ "$WITH_CHROMIUM" = "ask" ]; then
  if [ -t 0 ]; then
    read -r -p "Installer Chromium pour les sites construits en JavaScript (environ 400 Mo) ? [o/N] " answer
    case "$answer" in o|O|oui|y|Y|yes) WITH_CHROMIUM=yes ;; *) WITH_CHROMIUM=no ;; esac
  else
    WITH_CHROMIUM=no
  fi
fi

export DEBIAN_FRONTEND=noninteractive

if ! command -v curl >/dev/null 2>&1 || ! command -v gpg >/dev/null 2>&1 || [ ! -f /etc/ssl/certs/ca-certificates.crt ]; then
  info "Paquets système"
  apt-get update -qq
  apt_install ca-certificates curl gnupg tar || die "installation des paquets système impossible (détails ci-dessus)."
fi

node_ok() {
  command -v node >/dev/null 2>&1 &&
    node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)'
}

if ! node_ok; then
  info "Node.js ${NODE_MAJOR} (dépôt NodeSource)"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" >/etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt_install nodejs || die "installation de Node.js impossible (détails ci-dessus)."
fi
node_ok || die "Node.js 22.13 ou plus récent est requis."
ok "Node.js $(node --version)"

if [ "$WITH_CHROMIUM" = "yes" ]; then
  info "Chromium"
  CHROMIUM_FAILED="Chromium n'a pas pu être installé (détails ci-dessus) : Glaneur fonctionnera sans rendu JavaScript."
  if debian_chromium; then
    apt_install chromium fonts-liberation || warn "$CHROMIUM_FAILED"
  elif [ "$(dpkg --print-architecture)" = "amd64" ]; then
    # Ubuntu et les autres : Google Chrome, depuis le dépôt de Google.
    install -d -m 0755 /etc/apt/keyrings
    curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor --yes -o /etc/apt/keyrings/google-chrome.gpg
    echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" >/etc/apt/sources.list.d/google-chrome.list
    apt-get update -qq
    apt_install google-chrome-stable fonts-liberation || warn "$CHROMIUM_FAILED"
  else
    info "Chromium indisponible pour cette distribution : rendu JavaScript désactivé."
  fi
fi

info "Utilisateur et dossiers"
id glaneur >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin glaneur
install -d -o glaneur -g glaneur -m 0750 "$DATA_DIR"
install -d -m 0755 "$CONF_DIR"

if [ "$SRC_DIR" != "$APP_DIR" ]; then
  info "Copie de l'application dans $APP_DIR"
  systemctl stop glaneur 2>/dev/null || true
  rm -rf "$APP_DIR"
  install -d -m 0755 "$APP_DIR"
  tar -C "$SRC_DIR" --exclude=./node_modules --exclude=./dist --exclude=./data --exclude=./.git -cf - . | tar -C "$APP_DIR" -xf -
fi

info "Dépendances et compilation (quelques minutes)"
cd "$APP_DIR"
npm ci --no-audit --no-fund --loglevel=error
npm run build --silent
npm prune --omit=dev --no-audit --no-fund --loglevel=error
chown -R root:root "$APP_DIR"

if [ ! -f "$CONF_DIR/glaneur.env" ]; then
  info "Configuration par défaut dans $CONF_DIR/glaneur.env"
  sed -e "s/^PORT=.*/PORT=${PORT}/" "$APP_DIR/deploy/glaneur.env.example" >"$CONF_DIR/glaneur.env"
  if [ -f /etc/timezone ] && ! grep -qiE '^(etc/)?utc$' /etc/timezone; then
    sed -i "s#^TZ=.*#TZ=$(cat /etc/timezone)#" "$CONF_DIR/glaneur.env"
  fi
  chown root:glaneur "$CONF_DIR/glaneur.env"
  chmod 0640 "$CONF_DIR/glaneur.env"
fi

info "Service systemd"
install -m 0644 "$APP_DIR/deploy/glaneur.service" /etc/systemd/system/glaneur.service
systemctl daemon-reload
systemctl enable glaneur >/dev/null 2>&1
systemctl restart glaneur

LISTEN_PORT=$(grep -E '^PORT=' "$CONF_DIR/glaneur.env" | cut -d= -f2)
LISTEN_PORT=${LISTEN_PORT:-8080}
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${LISTEN_PORT}/api/auth/status" >/dev/null 2>&1; then
    ADDRESS=$(hostname -I 2>/dev/null | awk '{print $1}')
    ok "Glaneur est prêt : http://${ADDRESS:-localhost}:${LISTEN_PORT}"
    echo "   Choisissez votre mot de passe au premier accès."
    echo "   Journal : journalctl -u glaneur -f"
    exit 0
  fi
  sleep 1
done
die "le service ne répond pas. Consultez : journalctl -u glaneur -n 50"
