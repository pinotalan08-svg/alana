#!/usr/bin/env bash
# Installe FreeLLMAPI (https://github.com/tashfeenahmed/freellmapi) et le
# lanceur claude-auto, qui bascule Claude Code sur des modèles gratuits quand
# ta limite Claude est atteinte. macOS, Linux et Windows (WSL).
#
#   bash freellm/install.sh
#
# Variables optionnelles : FREELLMAPI_URL (défaut http://localhost:3001),
# FREELLMAPI_DIR (défaut ~/freellmapi), BIN_DIR (défaut ~/.local/bin).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FREELLMAPI_DIR="${FREELLMAPI_DIR:-$HOME/freellmapi}"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"
CONFIG_DIR="$HOME/.config/claude-auto"
CONFIG="$CONFIG_DIR/config"
MARKER="# claude-auto (FreeLLMAPI)"

say()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mATTENTION\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mERREUR\033[0m %s\n' "$*" >&2; exit 1; }
ask()  { local reply; read -r -p "$1 [O/n] " reply </dev/tty; [[ ! "$reply" =~ ^[nN] ]]; }

ping_url() { curl -fsS -m 3 "$1/api/ping" >/dev/null 2>&1; }

command -v curl >/dev/null 2>&1 || die "curl est requis."
command -v claude >/dev/null 2>&1 || warn "Claude Code n'est pas encore installé (https://claude.com/claude-code). Installe-le avant d'utiliser claude-auto."

# ── 1. FreeLLMAPI ────────────────────────────────────────────────────────────
# Port 3001 = installation Docker, 31415 = application de bureau (.dmg / .exe).
if [ -z "${FREELLMAPI_URL:-}" ]; then
  for url in http://localhost:3001 http://localhost:31415; do
    if ping_url "$url"; then FREELLMAPI_URL="$url"; break; fi
  done
fi

if [ -n "${FREELLMAPI_URL:-}" ] && ping_url "$FREELLMAPI_URL"; then
  say "FreeLLMAPI tourne déjà sur $FREELLMAPI_URL"
else
  FREELLMAPI_URL="${FREELLMAPI_URL:-http://localhost:3001}"
  command -v docker >/dev/null 2>&1 || die "Docker est requis pour installer FreeLLMAPI.
  Installe Docker Desktop (https://docs.docker.com/get-docker/) et relance ce script,
  ou installe l'application de bureau FreeLLMAPI (.dmg / .exe) :
  https://github.com/tashfeenahmed/freellmapi/releases/latest"
  ask "Installer FreeLLMAPI avec Docker dans $FREELLMAPI_DIR ?" || die "Installation annulée."
  # Official installer: writes docker-compose.yml + .env (encryption key), starts the container.
  curl -fsSL https://freellmapi.co/install.sh | FREELLMAPI_DIR="$FREELLMAPI_DIR" bash
  ping_url "$FREELLMAPI_URL" || die "FreeLLMAPI ne répond pas sur $FREELLMAPI_URL."
fi

# ── 2. Clé unifiée ───────────────────────────────────────────────────────────
cat <<EOF

  Ouvre le tableau de bord : $FREELLMAPI_URL
    1. Crée ton compte (email + mot de passe, tout reste en local).
    2. Page « Keys » : ajoute tes clés gratuites (Gemini, Groq, OpenRouter…).
    3. Copie ta clé unifiée (elle commence par « freellmapi- »).

EOF

KEY="${FREELLMAPI_API_KEY:-}"
while :; do
  if [ -z "$KEY" ]; then
    read -r -s -p "Colle ta clé unifiée FreeLLMAPI (elle ne s'affiche pas) : " KEY </dev/tty
    echo
  fi
  status=$(curl -s -o /dev/null -w '%{http_code}' -m 10 \
    -H "Authorization: Bearer $KEY" "$FREELLMAPI_URL/v1/models" || true)
  [ "$status" = "200" ] && break
  warn "Clé refusée par FreeLLMAPI (HTTP $status). Réessaie."
  KEY=""
done
say "Clé valide."

mkdir -p "$CONFIG_DIR"
(
  umask 077
  cat > "$CONFIG" <<EOF
FREELLMAPI_URL=$FREELLMAPI_URL
FREELLMAPI_API_KEY=$KEY
FREELLMAPI_DIR=$FREELLMAPI_DIR
EOF
)
say "Configuration enregistrée dans $CONFIG (lisible par toi seul)."

# ── 3. Lanceur claude-auto + alias « claude » ────────────────────────────────
mkdir -p "$BIN_DIR"
install -m 755 "$HERE/claude-auto" "$BIN_DIR/claude-auto"
say "claude-auto installé dans $BIN_DIR"

rc_files=()
[ -f "$HOME/.zshrc" ] && rc_files+=("$HOME/.zshrc")
[ -f "$HOME/.bashrc" ] && rc_files+=("$HOME/.bashrc")
if [ ${#rc_files[@]} -eq 0 ]; then
  case "${SHELL:-}" in */zsh) rc_files=("$HOME/.zshrc") ;; *) rc_files=("$HOME/.bashrc") ;; esac
fi
for rc in "${rc_files[@]}"; do
  if grep -qF "$MARKER" "$rc" 2>/dev/null; then
    say "Alias déjà présent dans $rc"
  else
    printf '\n%s\nalias claude="%s/claude-auto"\n' "$MARKER" "$BIN_DIR" >> "$rc"
    say "Alias « claude » ajouté dans $rc"
  fi
done

cat <<EOF

  C'est prêt. Ouvre un nouveau terminal, puis utilise Claude Code comme d'habitude :

    claude              → Claude tant que ta limite n'est pas atteinte, sinon modèles gratuits
    claude --free       → force les modèles gratuits
    claude --claude     → force Claude, sans vérification

  Limite atteinte en pleine session ? Tape /exit puis « claude -c » :
  la même conversation reprend sur les modèles gratuits.

EOF
