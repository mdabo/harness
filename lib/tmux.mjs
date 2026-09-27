import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

/**
 * Disposition du terminal pour les rôles en session.
 *
 * Leçon d'un dispositif réel : sans règle de nommage stable, l'orchestrateur
 * ne sait plus adresser un rôle dès qu'une fenêtre est déplacée. La carte des
 * panes est donc écrite sur disque, et elle utilise les identifiants tmux
 * (%N) qui survivent aux réorganisations — contrairement aux index et aux titres.
 */

const MAX_PANES = 4;   // au-delà, un pane devient illisible sur un écran ordinaire

/**
 * Calcule la disposition sans rien créer.
 * L'unité de regroupement est la vague : c'est la seule structure logique dont
 * on dispose, et elle correspond à ce que l'utilisateur observe.
 */
export function calculerDisposition(sessionsParVague, session = 'harness') {
  const fenetres = [];
  const total = sessionsParVague.flat().length;

  if (total === 0) return { session, fenetres, total, strategie: 'aucune' };

  // ≤ 3 rôles : tout tient sous l'œil, une seule fenêtre avec le pilote en haut
  if (total <= 3) {
    fenetres.push({
      index: 0, nom: 'atelier', pilote: true,
      roles: sessionsParVague.flat(),
      layout: 'main-horizontal',
    });
    return { session, fenetres, total, strategie: 'une fenêtre, pilote en haut' };
  }

  // 4 rôles et plus : le pilote a sa fenêtre, les rôles sont groupés par vague
  fenetres.push({ index: 0, nom: 'pilote', pilote: true, roles: [], layout: null });
  let i = 1;
  sessionsParVague.forEach((vague, v) => {
    if (!vague.length) return;
    // une vague trop large est coupée : quatre panes est la limite de lisibilité
    for (let d = 0; d < vague.length; d += MAX_PANES) {
      const morceau = vague.slice(d, d + MAX_PANES);
      const suffixe = vague.length > MAX_PANES ? `-${Math.floor(d / MAX_PANES) + 1}` : '';
      fenetres.push({
        index: i++, nom: `vague${v + 1}${suffixe}`, pilote: false,
        roles: morceau, layout: morceau.length > 1 ? 'tiled' : null,
      });
    }
  });

  return {
    session, fenetres, total,
    strategie: total <= 8 ? 'pilote + une fenêtre par vague' : `pilote + vagues découpées à ${MAX_PANES} panes`,
  };
}

/** Rend la disposition lisible avant de l'appliquer. */
export function dessiner(disp) {
  if (!disp.total) return '  aucun rôle en session — rien à disposer';
  const l = [];
  for (const f of disp.fenetres) {
    const titre = `  [${disp.session}:${f.index}] ${f.nom}`;
    if (f.pilote && !f.roles.length) { l.push(`${titre}  ·  orchestrateur`); continue; }
    l.push(titre);
    if (f.pilote) {
      // le cadre du haut épouse la rangée du bas, sans jamais tronquer le titre
      const large = Math.max(f.roles.length * 11 - 1, 15);
      l.push('     ┌' + '─'.repeat(large) + '┐');
      l.push('     │' + 'ORCHESTRATEUR'.padStart(Math.floor((large + 13) / 2)).padEnd(large) + '│');
      const cellules = f.roles.length * 11 - 1;
      const pad = large > cellules ? '─'.repeat(large - cellules) : '';
      const padV = large > cellules ? ' '.repeat(large - cellules) : '';
      l.push('     ├' + f.roles.map(() => '──────────').join('┬') + pad + '┤');
      l.push('     │' + f.roles.map((r) => ` ${r.slice(0, 8).padEnd(8)} `).join('│') + padV + '│');
      l.push('     └' + f.roles.map(() => '──────────').join('┴') + pad + '┘');
    } else {
      l.push('     ┌' + f.roles.map(() => '──────────').join('┬') + '┐');
      l.push('     │' + f.roles.map((r) => ` ${r.slice(0, 8).padEnd(8)} `).join('│') + '│');
      l.push('     └' + f.roles.map(() => '──────────').join('┴') + '┘');
    }
  }
  return l.join('\n');
}

const sh = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

export function tmuxPresent() {
  try { sh('command -v tmux'); return true; } catch { return false; }
}

/**
 * Applique la disposition. Les panes sont créés vides : c'est l'orchestrateur
 * qui y lance ce qu'il veut, via la carte écrite ici.
 */
export function appliquer(disp, racineProjet) {
  if (!tmuxPresent()) throw new Error('tmux est absent — les rôles en session sont indisponibles');
  const s = disp.session;

  let existe = false;
  try { sh(`tmux has-session -t ${s} 2>/dev/null`); existe = true; } catch { /* absente */ }
  if (existe) throw new Error(`la session tmux « ${s} » existe déjà — fermez-la ou changez de nom`);

  const carte = {};
  const premiere = disp.fenetres[0];
  sh(`tmux new-session -d -s ${s} -n ${premiere.nom} -c ${JSON.stringify(racineProjet)}`);

  for (const f of disp.fenetres) {
    if (f.index > 0) sh(`tmux new-window -t ${s}: -n ${f.nom} -c ${JSON.stringify(racineProjet)}`);
    const cible = `${s}:${f.nom}`;
    const aCreer = f.pilote ? f.roles.length : f.roles.length - 1;
    for (let k = 0; k < aCreer; k++) {
      sh(`tmux split-window -v -t ${cible} -c ${JSON.stringify(racineProjet)}`);
    }
    if (f.layout === 'main-horizontal') {
      sh(`tmux set-window-option -t ${cible} main-pane-height 60%`);
      sh(`tmux select-layout -t ${cible} main-horizontal`);
    } else if (f.layout) {
      sh(`tmux select-layout -t ${cible} ${f.layout}`);
    }

    const ids = sh(`tmux list-panes -t ${cible} -F '#{pane_id}'`).split('\n').filter(Boolean);
    const decalage = f.pilote ? 1 : 0;
    if (f.pilote) carte.ORCHESTRATEUR = ids[0];
    f.roles.forEach((r, k) => {
      const id = ids[k + decalage];
      if (!id) return;
      carte[r] = id;
      // Le titre sert à l'humain ; l'identifiant sert au programme.
      try { sh(`tmux select-pane -t ${id} -T ${JSON.stringify(r)}`); } catch { /* option absente */ }
    });
  }

  const f = path.join(racineProjet, '.harness', 'panes.json');
  fs.writeFileSync(f, JSON.stringify({ session: s, panes: carte, cree_le: new Date().toISOString() }, null, 2));
  return { carte, fichier: f };
}

/** Retrouve l'adresse d'un rôle, même après réorganisation des fenêtres. */
export function adresseDe(role, racineProjet) {
  const f = path.join(racineProjet, '.harness', 'panes.json');
  if (!fs.existsSync(f)) return null;
  const { panes } = JSON.parse(fs.readFileSync(f, 'utf8'));
  const id = panes[role];
  if (!id) return null;
  try { sh(`tmux list-panes -a -F '#{pane_id}' | grep -qx ${id}`); return id; } catch { return null; }
}
