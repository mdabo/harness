#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# harness — installation en une commande.
#
#   bash install.sh                  installe dans le répertoire courant
#   bash install.sh /chemin/projet   installe dans un projet existant (greffe)
#   bash install.sh --global-skills  autorise l'installation globale des skills
#   bash install.sh --agents=cursor,copilot,windsurf,agents-md
#                                    raccroche ces agents même non détectés
#
# Principes tenus par ce script :
#   · rien de silencieux : chaque étape dit ce qu'elle fait et pourquoi
#   · rien n'est réinstallé : ce qui existe déjà est détecté et laissé
#   · rien n'est imposé : portée projet par défaut, jamais le global
#   · réversible : ce qui est ajouté est noté, pour pouvoir être retiré
# ---------------------------------------------------------------------------
set -uo pipefail

HARNESS_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCOPE_FLAG="-p"          # portée projet par défaut
SCOPE_NAME="projet"
TARGET="$PWD"
FORCES=""               # agents à raccrocher même si rien ne les trahit

for arg in "$@"; do
  case "$arg" in
    --global-skills) SCOPE_FLAG="-g"; SCOPE_NAME="global" ;;
    --agents=*)
      FORCES=",$(echo "${arg#--agents=}" | tr -d ' '),"
      # Une valeur inconnue passée sous silence donnerait une installation
      # incomplète sans le moindre signe. Mieux vaut refuser tout de suite.
      for a in $(echo "${arg#--agents=}" | tr ',' ' '); do
        case "$a" in
          cursor|copilot|windsurf|agents-md) ;;
          claude)
            echo "--agents=claude est inutile : Claude Code est toujours raccroché." >&2
            echo "Retirez-le, ou lancez simplement install.sh sans option." >&2
            exit 2 ;;
          *)
            echo "agent inconnu : $a" >&2
            echo "valeurs acceptées : cursor, copilot, windsurf, agents-md" >&2
            echo "(Claude Code est raccroché d'office, il n'a pas à être listé)" >&2
            exit 2 ;;
        esac
      done
      ;;
    -*) echo "option inconnue : $arg" >&2; exit 2 ;;
    *)  TARGET="$(cd "$arg" 2>/dev/null && pwd)" || { echo "répertoire introuvable : $arg" >&2; exit 2; } ;;
  esac
done

# --- présentation ----------------------------------------------------------
say()  { printf '  %s\n' "$*"; }
step() { printf '\n▸ %s\n' "$*"; }
ok()   { printf '      %-22s %s\n' "$1" "✓ $2"; }
add()  { printf '      %-22s %s\n' "$1" "+ $2"; }
skip() { printf '      %-22s %s\n' "$1" "· $2"; }
info() { printf '      \033[2m%s\033[0m\n' "$*"; }
warn() { printf '      %-22s %s\n' "$1" "! $2"; }

printf '\n\033[1mharness\033[0m — mise en place d'"'"'un dispositif multi-agents\n'
say "cible  : $TARGET"
say "portée : $SCOPE_NAME (les skills tiers ne sortiront pas de là)"

# --- 1. environnement ------------------------------------------------------
step "Vérification de l'environnement"
MANQUE=0
if command -v node >/dev/null; then ok "node" "$(node --version)"; else warn "node" "absent — requis"; MANQUE=1; fi
if command -v git  >/dev/null; then ok "git"  "présent"; else warn "git" "absent — la traçabilité sera limitée"; fi
if command -v tmux >/dev/null; then ok "tmux" "présent"; else skip "tmux" "absent — les rôles en session seront indisponibles"; fi
if command -v npx  >/dev/null; then ok "npx"  "présent"; else warn "npx" "absent — les skills tiers seront ignorés"; fi
[ "$MANQUE" = "1" ] && { printf '\n  Installation interrompue : une dépendance requise manque.\n\n'; exit 1; }

# --- 2. structure ----------------------------------------------------------
step "Structure du dispositif"
H="$TARGET/.harness"
if [ -d "$H" ]; then
  skip ".harness/" "déjà présent — contenu préservé"
else
  mkdir -p "$H"/{roles,skills,artifacts}
  : > "$H/journal.jsonl"
  add ".harness/" "créé (roles/ skills/ artifacts/ journal.jsonl)"
fi

# Le manifeste note ce que CETTE installation a ajouté, pour pouvoir le retirer
# sans toucher à ce qui préexistait.
AJOUTES=()
MANIFESTE="$H/.installed.json"
[ -f "$MANIFESTE" ] || echo '{"skills_added":[],"installed_at":null}' > "$MANIFESTE"

if [ ! -f "$H/dispositif.yaml" ]; then
  cp "$HARNESS_SRC/templates/dispositif.yaml" "$H/dispositif.yaml" 2>/dev/null \
    && add "dispositif.yaml" "modèle posé" \
    || warn "dispositif.yaml" "modèle introuvable dans la source"
else
  skip "dispositif.yaml" "déjà présent"
fi

if [ -z "$(ls -A "$H/roles" 2>/dev/null)" ]; then
  cp "$HARNESS_SRC/templates/roles/"*.yaml "$H/roles/" 2>/dev/null \
    && add "roles/" "$(ls -1 "$H/roles" | wc -l | tr -d ' ') rôle(s) d'exemple" \
    || skip "roles/" "aucun modèle à copier"
else
  skip "roles/" "contient déjà des rôles"
fi

# --- 3. skills du framework ------------------------------------------------
# Ils vont dans .claude/skills/ et non dans .harness/ : c'est là que l'agent de
# codage les cherche. Posés ailleurs, ils ne seraient jamais découverts.
step "Skills du framework"
# Le corps du skill vit dans .harness/skills/ : un emplacement neutre, qui
# n'appartient à aucun agent de codage. Chaque agent est ensuite raccroché par
# un adaptateur de trois lignes (§ suivant). Un seul texte à maintenir.
DEST="$TARGET/.harness/skills"
POSES=0
if [ -d "$HARNESS_SRC/skills" ] && [ -n "$(ls -A "$HARNESS_SRC/skills" 2>/dev/null)" ]; then
  mkdir -p "$DEST"
  for s in "$HARNESS_SRC/skills"/*/; do
    n="$(basename "$s")"
    if [ -d "$DEST/$n" ]; then
      skip "$n" "déjà posé"
    else
      cp -R "$s" "$DEST/$n" && { add "$n" "posé dans .harness/skills/"; POSES=$((POSES+1)); AJOUTES+=("skill:$n"); }
    fi
  done
  [ "$POSES" -eq 0 ] && skip "total" "aucun nouveau"
else
  skip "aucun" "les skills du framework ne sont pas encore écrits"
fi

# --- 3ter. lanceur local ---------------------------------------------------
# Sans ça, l'orchestrateur lance « harness plan », reçoit « command not found »,
# en conclut que l'outil n'est pas installé et improvise. C'est arrivé.
# Le lanceur est dans le projet, avec le chemin du framework figé dedans : plus
# rien à mettre dans le PATH, et l'agent n'a pas à deviner où on a cloné.
mkdir -p "$TARGET/.harness/bin"
cat > "$TARGET/.harness/bin/harness" <<LANCEUR
#!/usr/bin/env bash
# Lanceur écrit à l'installation. Le chemin ci-dessous est celui du framework
# au moment de l'installation ; relancer install.sh le remet à jour.
HARNESS_SRC="$HARNESS_SRC"
if [ ! -x "\$HARNESS_SRC/bin/harness" ]; then
  echo "harness introuvable dans \$HARNESS_SRC" >&2
  echo "Le framework a été déplacé ou supprimé. Relancez son install.sh." >&2
  exit 127
fi
exec "\$HARNESS_SRC/bin/harness" "\$@"
LANCEUR
chmod +x "$TARGET/.harness/bin/harness"
add "lanceur" ".harness/bin/harness → $HARNESS_SRC"

# --- 3bis. adaptateurs par agent de codage ---------------------------------
step "Agents de codage détectés"

# Un adaptateur ne contient pas le skill : il contient sa phrase de
# déclenchement et le chemin du corps. Trois lignes, dans le format que l'agent
# sait lire. Le corps n'est chargé que lorsque le besoin se présente — c'est ce
# qui évite de payer ce texte à chaque tour de conversation.
DECLENCHEUR='This project uses harness to run several specialised agents. Two files tell you how, and you are the one who drives it — the user never types harness commands.

- A new agent or role is wanted ("I want an agent that…", "add a role to review…") → read `.harness/skills/harness-roles/SKILL.md`. It turns a plain-language need into a role file; the user never has to learn the format.
- The roles should actually run ("launch them", "go ahead", "where are we") → read `.harness/skills/harness-orchestrate/SKILL.md`. You run plan / run / verify, dispatch the agents, and escalate only structuring decisions.'

BALISE_O="<!-- harness:begin -->"
BALISE_F="<!-- harness:end -->"

# Écrit un bloc balisé dans un fichier partagé, en remplaçant le précédent s'il
# existe. Idempotent : réinstaller ne duplique rien.
bloc_balise() {            # 1=fichier  2=titre
  local f="$1" titre="$2" tmp
  mkdir -p "$(dirname "$f")"
  if [ -f "$f" ] && grep -qF "$BALISE_O" "$f" 2>/dev/null; then
    tmp="$(mktemp)"
    awk -v o="$BALISE_O" -v c="$BALISE_F" '
      index($0,o){skip=1} !skip{print} index($0,c){skip=0}' "$f" > "$tmp"
    mv "$tmp" "$f"
  fi
  # Retirer les lignes vides de fin avant d'ajouter : sinon elles s'accumulent
  # d'une réinstallation à l'autre.
  if [ -f "$f" ] && [ -s "$f" ]; then
    tmp="$(mktemp)"
    awk '{ l[NR]=$0 } END { n=NR; while (n>0 && l[n]=="") n--; for(i=1;i<=n;i++) print l[i] }' "$f" > "$tmp"
    mv "$tmp" "$f"
    printf '\n' >> "$f"
  fi
  {
    printf '%s\n' "$BALISE_O"
    printf '## %s\n\n' "$titre"
    printf '%s\n' "$DECLENCHEUR"
    printf '%s\n' "$BALISE_F"
  } >> "$f"
}

AUTRES=0                # agents autres que Claude Code effectivement raccrochés
force() { [ -n "$FORCES" ] && [ "$FORCES" != "${FORCES/,$1,/}" ]; }

# Claude Code — agent de référence du produit : toujours raccroché. Skill natif,
# donc on lie le corps au lieu de le copier.
if true; then
  LIES=""
  for n in "$TARGET/.harness/skills"/*/; do
    [ -d "$n" ] || continue
    sk="$(basename "$n")"
    mkdir -p "$TARGET/.claude/skills/$sk"
    CIBLE="$TARGET/.claude/skills/$sk/SKILL.md"
    if [ -e "$CIBLE" ] && [ ! -L "$CIBLE" ]; then
      skip "Claude Code" "$sk/SKILL.md déjà présent — laissé tel quel"
    else
      ln -sf "../../../.harness/skills/$sk/SKILL.md" "$CIBLE" 2>/dev/null \
        || cp "$TARGET/.harness/skills/$sk/SKILL.md" "$CIBLE"
      LIES="$LIES $sk"
    fi
  done
  if [ -n "$LIES" ]; then
    add "Claude Code" ".claude/skills/ → lié :$LIES"
    AJOUTES+=("adaptateur:claude")
  fi
fi

# Cursor — même contrat que les skills : alwaysApply false + description lue
# par l'agent pour décider s'il charge la règle.
if [ -d "$TARGET/.cursor" ] || force cursor; then
  mkdir -p "$TARGET/.cursor/rules"
  rm -f "$TARGET/.cursor/rules/harness-roles.mdc"   # nom d'avant, si présent
  cat > "$TARGET/.cursor/rules/harness.mdc" <<CURSOREOF
---
description: Create harness roles from plain language, and run the harness loop
alwaysApply: false
---

$DECLENCHEUR
CURSOREOF
  add "Cursor" ".cursor/rules/harness.mdc"
  AJOUTES+=("adaptateur:cursor"); AUTRES=$((AUTRES+1))
fi

# Windsurf — répertoire de règles, chargement à la demande.
if [ -d "$TARGET/.windsurf" ] || force windsurf; then
  mkdir -p "$TARGET/.windsurf/rules"
  printf '%s\n' "$DECLENCHEUR" > "$TARGET/.windsurf/rules/harness.md"
  add "Windsurf" ".windsurf/rules/harness.md"
  AJOUTES+=("adaptateur:windsurf"); AUTRES=$((AUTRES+1))
fi

# GitHub Copilot — pas de chargement à la demande : le bloc est toujours en
# contexte. D'où sa brièveté ; c'est le prix du mécanisme, pas un oubli.
if [ -d "$TARGET/.github" ] || force copilot; then
  bloc_balise "$TARGET/.github/copilot-instructions.md" "harness — multi-agent setup"
  add "Copilot" ".github/copilot-instructions.md (bloc balisé)"
  AJOUTES+=("adaptateur:copilot"); AUTRES=$((AUTRES+1))
fi

# AGENTS.md — convention commune (Codex, Zed, Aider, Cursor, Gemini…). Enrichi
# s'il existe ; jamais créé d'office, car déposer un fichier à la racine d'un
# projet qui n'en veut pas est une intrusion, pas un service.
if [ -f "$TARGET/AGENTS.md" ]; then
  bloc_balise "$TARGET/AGENTS.md" "harness — multi-agent setup"
  add "AGENTS.md" "bloc balisé — vu à la racine"
  AJOUTES+=("adaptateur:agents-md"); AUTRES=$((AUTRES+1))
elif force agents-md; then
  bloc_balise "$TARGET/AGENTS.md" "harness — multi-agent setup"
  add "AGENTS.md" "créé — demandé par --agents"
  AJOUTES+=("adaptateur:agents-md"); AUTRES=$((AUTRES+1))
fi

info "corps unique dans .harness/skills/ — les adaptateurs n'en sont que des renvois"
if [ "$AUTRES" -eq 0 ]; then
  info "aucun autre agent détecté ; --agents=cursor,copilot,windsurf,agents-md pour en ajouter"
fi

# --- 4. skills tiers -------------------------------------------------------
step "Skills tiers — portée $SCOPE_NAME"

skill_present() {           # 1=nom du skill ; cherche en projet puis en global
  [ -d "$TARGET/.claude/skills/$1" ] && { echo "projet"; return 0; }
  [ -d "$HOME/.claude/skills/$1" ]   && { echo "global"; return 0; }
  return 1
}

installer_skill() {         # 1=nom local ; 2=paquet ; 3=raison
  local nom="$1" pkg="$2" pourquoi="$3" ou
  if ou="$(skill_present "$nom")"; then
    skip "$nom" "déjà présent ($ou) — ignoré"
    return 0
  fi
  if ! command -v npx >/dev/null; then warn "$nom" "npx absent — ignoré"; return 0; fi
  printf '      %-22s … installation (%s)\n' "$nom" "$pourquoi"
  if (cd "$TARGET" && npx --yes skills add "$pkg" "$SCOPE_FLAG" -y >/dev/null 2>&1); then
    add "$nom" "installé"
    AJOUTES+=("$nom")
  else
    warn "$nom" "échec — à installer à la main : npx skills add $pkg $SCOPE_FLAG"
  fi
}

installer_skill "claude-mastery" "naiersaidane/claude-mastery" "écrire de bons briefs de rôle"
installer_skill "archify"        "tt-a1i/archify"              "représenter le dispositif"
installer_skill "skill-creator"  "anthropics/skills"           "créer vos propres skills"

# spec-kit n'est pas un skill : c'est un outil en ligne de commande.
if command -v specify >/dev/null; then
  skip "spec-kit" "déjà présent ($(specify --version 2>/dev/null | head -1))"
elif command -v uv >/dev/null; then
  printf '      %-22s … installation (cadrer avant de produire)\n' "spec-kit"
  if uv tool install specify-cli >/dev/null 2>&1; then
    add "spec-kit" "installé"; AJOUTES+=("spec-kit")
  else
    warn "spec-kit" "échec — à faire à la main : uv tool install specify-cli"
  fi
else
  skip "spec-kit" "uv absent — ignoré"
fi

# --- 5. manifeste ----------------------------------------------------------
if [ ${#AJOUTES[@]} -gt 0 ] && command -v node >/dev/null; then
  node -e '
    const fs=require("fs"), f=process.argv[1];
    const m=JSON.parse(fs.readFileSync(f,"utf8"));
    m.skills_added=[...new Set([...(m.skills_added||[]),...process.argv.slice(2)])];
    m.installed_at=new Date().toISOString();
    fs.writeFileSync(f,JSON.stringify(m,null,2));
  ' "$MANIFESTE" "${AJOUTES[@]}" 2>/dev/null
fi

# --- 6. bilan --------------------------------------------------------------
step "Terminé"
if [ ${#AJOUTES[@]} -gt 0 ]; then
  say "${#AJOUTES[@]} élément(s) ajouté(s) : ${AJOUTES[*]}"
  say "Noté dans .harness/.installed.json — seuls ceux-là seront retirés au désinstall."
else
  say "Rien à ajouter : tout était déjà en place."
fi
printf '\n  Prochaine étape — dans votre agent de codage, pas ici :\n'
say "  dites-lui simplement ce que vous voulez faire surveiller, par exemple"
say "  « mets quelqu'un sur l'isolation des données entre clients »."
say "  Il écrit les rôles, lance le dispositif et vous rend compte."
printf '\n'
say "  Vous n'avez pas de commande à taper. Pour voir ce qu'un dispositif"
say "  coûterait avant de le lancer : .harness/bin/harness plan"
printf '\n'
