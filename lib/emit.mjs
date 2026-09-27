import fs from 'fs';
import path from 'path';
import { decider } from './decide.mjs';
import { verifierRole } from './verify.mjs';
import { cheminQuestions, DOSSIER } from './questions.mjs';

/**
 * Fabrique d'ordres d'exécution — mode B.
 *
 * Le CLI ne lance rien. Il produit des ordres que la session orchestratrice
 * exécute avec son propre mécanisme de sous-agents. Trois raisons :
 *   · la session détient déjà le contexte du projet, un lanceur externe non
 *   · le signal de fin et le routage de modèle sont natifs de ce mécanisme
 *   · aucune clé d'API à gérer en local
 *
 * L'état n'est stocké nulle part : il se déduit des artefacts présents et de
 * leurs contrats. Relancer est donc sans effet sur ce qui est déjà satisfait.
 */

const MODELES = { minimal: 'haiku', standard: 'sonnet', maximal: 'opus' };

/** Outils déduits du périmètre : qui n'écrit pas ne reçoit pas de quoi écrire. */
function outils(role) {
  const base = ['Read', 'Grep', 'Glob'];
  if ((role.scope.writes || []).length > 0) base.push('Write', 'Edit');
  return base;
}

function listerFichiers(motifs, racine) {
  const out = new Set();
  for (const motif of motifs || []) {
    if (!motif.includes('*')) {
      const p = path.resolve(racine, motif);
      if (fs.existsSync(p)) out.add(path.relative(racine, p));
      continue;
    }
    // Expansion volontairement simple : un motif trop large est un défaut de
    // conception du rôle, pas un cas à supporter.
    const dossier = path.resolve(racine, motif.split('*')[0].replace(/\/$/, '') || '.');
    const ext = path.extname(motif);
    if (!fs.existsSync(dossier)) continue;
    const parcours = (d, prof) => {
      if (prof > 3) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const f = path.join(d, e.name);
        if (e.isDirectory()) { if (motif.includes('**')) parcours(f, prof + 1); }
        else if (!ext || f.endsWith(ext)) out.add(path.relative(racine, f));
      }
    };
    parcours(dossier, 0);
  }
  return [...out].sort();
}

/** Construit le texte d'instruction d'un rôle. C'est lui qui part au modèle. */
export function prompt(role, racine, parNom) {
  const mode = decider(role).mode;
  const l = [];
  l.push(`Tu interviens sous le rôle « ${role.name || role.role} ».`);
  l.push('');
  l.push(`MISSION`);
  l.push(String(role.mission || '').trim());
  l.push('');

  const ctx = role.context || {};
  const fichiers = listerFichiers(ctx.files, racine.projet);
  if (fichiers.length) {
    l.push('CE QUE TU DOIS LIRE');
    l.push(fichiers.map((f) => `  ${f}`).join('\n'));
    l.push('  Ne lis rien d\'autre sans nécessité : le contexte a un coût.');
    l.push('');
  }

  const deps = Array.isArray(ctx.from_roles) ? ctx.from_roles : (ctx.from_roles ? [ctx.from_roles] : []);
  if (deps.length) {
    l.push('PRODUCTIONS DES RÔLES DONT TU DÉPENDS');
    for (const d of deps) {
      const r = parNom.get(d);
      for (const o of (r?.outputs || [])) {
        l.push(`  ${path.relative(racine.projet, o.path)}   (rôle ${d})`);
      }
    }
    l.push("  Tu lis leurs artefacts, jamais leur raisonnement : s'il compte, il");
    l.push('  doit figurer dans l\'artefact.');
    l.push('');
  }

  l.push('CE QUE TU PRODUIS');
  for (const o of role.outputs || []) {
    l.push(`  Fichier : ${path.relative(racine.projet, o.path)}`);
    const m = o.must || {};
    if (m.min_bytes) l.push(`    · au moins ${m.min_bytes} octets`);
    if (m.frontmatter) l.push(`    · frontmatter YAML avec : ${[].concat(m.frontmatter).join(', ')}`);
    for (const rg of m.matches || []) {
      l.push(`    · au moins ${rg.min_count ?? 1} occurrence(s) du motif : ${rg.pattern}`);
    }
    if (o.review) l.push(`    · sera relu sur : ${String(o.review.asks || '').trim().split('\n')[0]}`);
  }
  l.push('  Ces conditions sont vérifiées par machine. Non tenues, ton travail est');
  l.push('  réputé non terminé.');
  l.push('');

  // Chemins relatifs au projet : un chemin absolu trahit l'arborescence de la
  // machine qui a produit l'ordre, et n'apprend rien de plus à l'agent.
  const rel = (c) => (path.isAbsolute(c) ? path.relative(racine.projet, c) : c);
  const w = (role.scope.writes || []).map(rel);
  const fQuestions = path.relative(racine.projet, cheminQuestions(role.role, racine.projet));
  if (w.length) w.push(fQuestions);   // accordé en plus, jamais au détriment du reste
  l.push('PÉRIMÈTRE');
  l.push(w.length ? `  Tu n'écris que dans : ${w.join(', ')}` : "  Tu n'écris aucun fichier : tu rends ton analyse en réponse.");
  if ((role.scope.forbids || []).length) l.push(`  Interdits : ${role.scope.forbids.map(rel).join(', ')}`);
  l.push('  Tu ne touches ni à l\'historique de version, ni à aucun déploiement.');
  l.push('');

  l.push('MÉTHODE');
  l.push(String(role.brief || '').trim());
  l.push('');

  // Un agent qui doute et se tait produit une hypothèse silencieuse, c'est-à-dire
  // un résultat faux que rien ne signale. Le droit de demander doit donc être
  // écrit dans l'ordre, pas supposé acquis.
  l.push('SI QUELQUE CHOSE TE MANQUE');
  l.push("  N'invente pas, et ne devine pas une intention. Si la demande est ambiguë,");
  l.push('  si le contexte fourni ne suffit pas, ou si tu penses que la méthode');
  l.push("  demandée est la mauvaise — dis-le. Personne ne t'en voudra de demander ;");
  l.push('  une hypothèse tue coûte la vague entière.');
  if (mode === 'session') {
    l.push('  Tu travailles dans un pane visible : pose ta question à voix haute et');
    l.push("  attends. L'orchestrateur te lit.");
  } else {
    l.push(`  Écris dans ${fQuestions}, avec l'une ou l'autre de ces sections :`);
    l.push('    ## Bloquant   tu ne peux pas avancer sans la réponse.');
    l.push('                  Écris la question, et ARRÊTE-TOI là. Ne produis pas');
    l.push("                  ton artefact sur une hypothèse que tu n'as pas pu vérifier.");
    l.push('    ## Avis       tu peux avancer, mais tu penses qu\'on s\'y prend mal,');
    l.push('                  ou tu proposes une autre manière de faire.');
    l.push('                  Écris-le, puis FAIS le travail demandé quand même.');
    l.push('  Une question dit ce que tu as déjà cherché pour y répondre seul, sinon');
    l.push("  elle renvoie à l'orchestrateur un travail qui t'incombait.");
  }
  l.push("  L'orchestrateur répond, ou porte la question à l'humain qui supervise.");
  l.push('');
  l.push('Termine en disant ce que tu n\'as pas pu faire, et pourquoi.');
  return l.join('\n');
}

/** Un ordre = tout ce qu'il faut pour lancer un rôle, sans rien deviner. */
export function ordre(role, racine, parNom) {
  const d = decider(role);
  const ex = role.execution || {};
  return {
    role: role.role,
    nom: role.name || role.role,
    mode: d.mode,
    regle: d.regle,
    pourquoi: d.pourquoi,
    modele: MODELES[ex.model || 'standard'] || 'sonnet',
    outils: outils(role),
    budget: ex.budget || {},
    on_failure: ex.on_failure || 'block',
    produit: (role.outputs || []).map((o) => path.relative(racine.projet, o.path)),
    prompt: prompt(role, racine, parNom),
  };
}

/**
 * Quels rôles sont exécutables maintenant.
 * Un rôle est à faire si son contrat n'est pas satisfait et que ceux dont il
 * dépend le sont. L'état vient donc des fichiers, jamais d'un registre séparé.
 */
export function prochaineVague(roles) {
  const parNom = new Map(roles.map((r) => [r.role, r]));
  const satisfait = new Map(roles.map((r) => [r.role, verifierRole(r).ok]));

  const prets = roles.filter((r) => {
    if (satisfait.get(r.role)) return false;
    const dep = r.depends_on ? [].concat(r.depends_on) : [];
    return dep.every((d) => !parNom.has(d) || satisfait.get(d));
  });

  return {
    prets,
    faits: roles.filter((r) => satisfait.get(r.role)),
    bloques: roles.filter((r) => {
      if (satisfait.get(r.role)) return false;
      const dep = r.depends_on ? [].concat(r.depends_on) : [];
      return dep.some((d) => parNom.has(d) && !satisfait.get(d));
    }),
    parNom,
  };
}
