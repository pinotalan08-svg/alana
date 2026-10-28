# Claude Code → modèles gratuits quand la limite est atteinte

Ce dossier installe [FreeLLMAPI](https://github.com/tashfeenahmed/freellmapi), un
routeur local qui regroupe les offres gratuites de nombreux fournisseurs (Gemini,
Groq, OpenRouter, Mistral, Cerebras…). Il installe aussi **`claude-auto`**, un
lanceur pour Claude Code :

- tant que ta limite Claude n'est pas atteinte, `claude` fonctionne comme d'habitude ;
- dès que Claude répond « limite atteinte », `claude` démarre automatiquement sur
  les modèles gratuits de FreeLLMAPI, avec la même interface Claude Code.

Compatible macOS, Linux et Windows via WSL.

## Prérequis

- [Claude Code](https://claude.com/claude-code)
- [Docker Desktop](https://docs.docker.com/get-docker/) (lancé), ou l'application de bureau
  FreeLLMAPI (`.dmg` / `.exe` dans les
  [Releases](https://github.com/tashfeenahmed/freellmapi/releases/latest))
- Au moins une clé API gratuite (par exemple [Google AI Studio](https://aistudio.google.com/apikey)
  ou [Groq](https://console.groq.com/keys))

## Installation

Décompresse `freellm.zip`, puis, depuis le dossier qui contient `freellm/` :

```bash
bash freellm/install.sh
```

Le script :

1. installe FreeLLMAPI avec Docker dans `~/freellmapi` (il utilise le script officiel
   du projet), ou réutilise une instance déjà lancée (port 3001, ou 31415 pour
   l'application de bureau) ;
2. te demande d'ouvrir le tableau de bord sur http://localhost:3001 pour :
   - créer ton compte local. Si on te demande un **code de configuration**, il se
     trouve dans les logs :
     `cd ~/freellmapi && docker compose logs | grep "setup code"`
   - ajouter tes clés gratuites sur la page **Keys** ;
   - copier ta **clé unifiée** (`freellmapi-…`) ;
3. vérifie la clé et l'enregistre dans `~/.config/claude-auto/config` (lisible par
   toi seul) ;
4. installe `claude-auto` dans `~/.local/bin` et ajoute l'alias `claude` dans
   `~/.zshrc` / `~/.bashrc`.

Ouvre ensuite un **nouveau terminal**.

## Utilisation

| Commande | Effet |
| --- | --- |
| `claude` | Claude si ta limite n'est pas atteinte, sinon modèles gratuits |
| `claude --free` | Force les modèles gratuits |
| `claude --claude` | Force Claude, sans vérification |

Toutes les options habituelles de Claude Code passent telles quelles
(`claude -c`, `claude --resume`, `claude -p "…"`…).

**Limite atteinte en pleine session ?** Tape `/exit`, puis `claude -c` : la même
conversation reprend sur les modèles gratuits.

Le choix des modèles gratuits se règle dans le tableau de bord de FreeLLMAPI. Par
défaut, les noms de modèles Claude (opus, sonnet, haiku) sont redirigés vers `auto` :
le routeur choisit un modèle disponible et passe au suivant si un fournisseur
atteint son quota (onglet **Keys → Anthropic**).

## Bon à savoir

- **Vérification au démarrage** : avant chaque session, `claude-auto` envoie une
  mini-requête (« Reply with OK », modèle Haiku, quelques jetons) pour savoir si ta
  limite est atteinte. Cela ajoute quelques secondes au lancement, plafonnées à
  60 s (`CLAUDE_AUTO_PROBE_TIMEOUT`).
- Si FreeLLMAPI est arrêté (installation Docker), `claude-auto` le redémarre tout seul.
- Les modèles gratuits sont moins performants que Claude, et les offres gratuites
  peuvent utiliser tes requêtes pour entraîner leurs modèles. Évite d'y envoyer du code
  ou des données confidentielles.
- Les auteurs de FreeLLMAPI le présentent comme un outil d'expérimentation personnelle.

## Mise à jour / désinstallation

```bash
cd ~/freellmapi && docker compose pull && docker compose up -d
```

Pour désinstaller : supprime le bloc `# claude-auto (FreeLLMAPI)` de `~/.zshrc` /
`~/.bashrc`, puis :

```bash
rm -rf ~/.local/bin/claude-auto ~/.config/claude-auto
```

```bash
cd ~/freellmapi && docker compose down -v && cd .. && rm -rf ~/freellmapi
```
