/**
 * La règle d'exécution : sous-agent ou session.
 *
 * Six règles ordonnées, la première qui s'applique l'emporte. Elles se
 * déduisent du fichier de rôle seul — aucune heuristique, aucun jugement.
 *
 * Le défaut est délibérément le sous-agent : c'est le mode le moins cher, et
 * c'est donc celui qu'on doit obtenir sans rien demander. Choisir une session
 * revient à renoncer au routage de modèle, ce qui doit être un acte conscient.
 */

const GLOB_LARGE = /\*\*/;

export function decider(role) {
  const ex = role.execution || {};
  const writes = (role.scope && role.scope.writes) || [];

  // ① mode explicite
  if (ex.mode === 'subagent' || ex.mode === 'session') {
    return {
      mode: ex.mode,
      regle: 1,
      pourquoi: ex.reason
        ? `imposé — ${ex.reason}`
        : 'imposé dans le rôle (execution.reason non renseigné)',
      avertissement: ex.reason ? null : 'execution.reason devrait justifier le choix',
    };
  }

  // ② intervention humaine déclarée
  if (role.interactive === true) {
    return { mode: 'session', regle: 2, pourquoi: 'interactive: true — un humain doit pouvoir intervenir' };
  }

  // ③ écriture large
  if (writes.some((w) => GLOB_LARGE.test(w))) {
    return { mode: 'session', regle: 3, pourquoi: `écrit sur un chemin large (${writes.find((w) => GLOB_LARGE.test(w))})` };
  }
  if (writes.length > 3) {
    return { mode: 'session', regle: 3, pourquoi: `écrit dans ${writes.length} chemins` };
  }

  // ④ travail long
  const tours = ex.budget && ex.budget.max_turns;
  if (typeof tours === 'number' && tours > 20) {
    return { mode: 'session', regle: 4, pourquoi: `budget de ${tours} tours — au-delà de 20, l'isolation coûte plus qu'elle ne rapporte` };
  }

  // ⑤ purement analytique
  if (writes.length === 0) {
    return { mode: 'subagent', regle: 5, pourquoi: "n'écrit rien — rien à observer, tout à isoler" };
  }

  // ⑥ défaut
  return { mode: 'subagent', regle: 6, pourquoi: 'défaut — le mode économe gagne quand rien ne s\'y oppose' };
}

/** Ordonnance les rôles par vagues, selon depends_on. Détecte les cycles. */
export function vagues(roles) {
  const parNom = new Map(roles.map((r) => [r.role, r]));
  const restants = new Set(parNom.keys());
  const faits = new Set();
  const out = [];

  while (restants.size) {
    const prets = [...restants].filter((n) => {
      const dep = parNom.get(n).depends_on || [];
      return (Array.isArray(dep) ? dep : [dep]).every((d) => faits.has(d) || !parNom.has(d));
    });
    if (prets.length === 0) {
      throw new Error(`dépendances circulaires ou introuvables entre : ${[...restants].join(', ')}`);
    }
    out.push(prets.sort());
    prets.forEach((n) => { restants.delete(n); faits.add(n); });
  }
  return out;
}
