import fs from 'fs';
import path from 'path';
import { parseYaml, ErreurYaml } from './yaml.mjs';

/**
 * Chargement et validation des rôles.
 *
 * La validation est volontairement stricte et bavarde : un rôle mal écrit doit
 * échouer au chargement avec un message actionnable, jamais à l'exécution après
 * avoir consommé des tokens.
 */

const REQUIS = ['role', 'mission', 'scope', 'brief'];

export function chargerRole(fichier, racine) {
  let brut;
  try {
    brut = parseYaml(fs.readFileSync(fichier, 'utf8'));
  } catch (e) {
    if (e instanceof ErreurYaml) throw new Error(`${path.basename(fichier)} — ${e.message}`);
    throw e;
  }

  const nom = path.basename(fichier);
  const manquants = REQUIS.filter((c) => brut[c] === undefined || brut[c] === null);
  if (manquants.length) throw new Error(`${nom} — champ(s) obligatoire(s) absent(s) : ${manquants.join(', ')}`);
  if (!brut.scope.writes && !brut.scope.reads) throw new Error(`${nom} — scope doit déclarer reads et/ou writes`);

  // {{artifacts}} est résolu au chargement : un rôle ne doit jamais contenir de
  // chemin absolu, sinon il n'est plus transposable d'un projet à l'autre.
  const subst = (v) => typeof v === 'string' ? v.replaceAll('{{artifacts}}', racine.artifacts) : v;
  const profond = (o) => Array.isArray(o) ? o.map(profond)
    : (o && typeof o === 'object') ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, profond(v)]))
    : subst(o);

  const role = profond(brut);
  role.scope.reads = role.scope.reads || [];
  role.scope.writes = role.scope.writes || [];
  role.outputs = role.outputs || [];
  role.execution = role.execution || {};
  role._fichier = fichier;

  for (const [i, o] of role.outputs.entries()) {
    if (!o.path) throw new Error(`${nom} — outputs[${i}] : « path » obligatoire`);
    if (!o.must && !o.review) throw new Error(`${nom} — outputs[${i}] : ni « must » ni « review », ce contrat ne prouve rien`);
  }
  return role;
}

export function chargerDispositif(racineProjet) {
  const base = path.join(racineProjet, '.harness');
  const fDisp = path.join(base, 'dispositif.yaml');
  if (!fs.existsSync(fDisp)) throw new Error(`aucun dispositif trouvé : ${fDisp} est absent (lancez l'installation)`);

  const disp = parseYaml(fs.readFileSync(fDisp, 'utf8'));
  const racine = { projet: racineProjet, artifacts: path.join(racineProjet, disp.artifacts || '.harness/artifacts') };

  const dossier = path.join(base, 'roles');
  const fichiers = fs.existsSync(dossier)
    ? fs.readdirSync(dossier).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml')).sort()
    : [];

  const roles = [], erreurs = [];
  for (const f of fichiers) {
    try { roles.push(chargerRole(path.join(dossier, f), racine)); }
    catch (e) { erreurs.push(e.message); }
  }

  const ce = contreExpertise(roles, racine, disp);
  if (ce) roles.push(ce);

  return { disp, roles, erreurs, racine };
}

/**
 * La contre-expertise, synthétisée automatiquement.
 *
 * Elle n'est pas un rôle que l'utilisateur pense à demander : c'est la pièce qui
 * donne sa valeur au reste. Un dispositif où trois agents produisent et où
 * personne ne les contredit produit trois rapports qui se valident mutuellement
 * par omission — exactement ce qu'on cherchait à éviter en montant le dispositif.
 *
 * Elle est donc posée d'office, et il faut un geste explicite pour s'en passer :
 * « contre_expertise: false » dans dispositif.yaml.
 *
 * Son contrat mérite un mot. Exiger « au moins trois objections » pousserait à
 * en inventer une troisième. On exige donc une **prise de position par rôle
 * relu** : soit une objection, soit un « rien à redire » assumé et signé. Le
 * silence devient impossible, la fabrication reste inutile.
 */
export function contreExpertise(roles, racine, disp) {
  if (disp.contre_expertise === false) return null;

  // Un rôle écrit à la main qui fait déjà ce travail a la priorité : on ne
  // double pas la dépense.
  if (roles.some((r) => r.contradicts === true || r.role === 'contre-expertise')) return null;

  const relus = roles.filter((r) => (r.outputs || []).length > 0).map((r) => r.role).sort();
  if (relus.length < 2) return null;   // contredire un seul avis, c'est un avis de plus

  const chemin = path.join(racine.artifacts, 'contre-expertise.md');
  return {
    role: 'contre-expertise',
    name: 'Contre-expertise',
    mission: "Contredire les autres rôles. Une revue qui valide tout ne sert à rien.",
    depends_on: relus,
    context: { from_roles: relus },
    scope: { reads: [path.join(racine.artifacts, '**')], writes: [chemin] },
    outputs: [{
      id: 'objections',
      path: chemin,
      must: {
        frontmatter: ['role', 'date'],
        // Une section par rôle relu : couverture vérifiée par machine.
        matches: relus.map((n) => ({
          pattern: `^## (Objection|Rien à redire) — ${n}`,
          min_count: 1,
        })),
      },
    }],
    execution: {
      // Le seul endroit du dispositif où la qualité du raisonnement se paie.
      model: disp.contre_expertise_model || 'maximal',
      budget: { max_turns: 12 },
    },
    brief: [
      'Tu relis les artefacts produits par les autres rôles. Tu ne relis pas le code.',
      '',
      'Pour CHACUN des rôles suivants, écris une section et une seule :',
      ...relus.map((n) => `  ## Objection — ${n}      ou      ## Rien à redire — ${n}`),
      '',
      'Une objection nomme le fichier et la ligne du constat qu\'elle attaque, et dit',
      'ce qu\'elle coûterait à corriger. Une objection sans référence est du bruit.',
      '',
      'Cherche en priorité :',
      '  · les affirmations chiffrées sans source',
      '  · les recommandations dont le coût n\'est pas mentionné',
      '  · les angles morts : ce que le rôle aurait dû regarder et n\'a pas regardé',
      '  · les contradictions entre deux rôles, qu\'aucun des deux n\'a vues',
      '',
      '« Rien à redire » est une réponse acceptable et parfois la bonne. Ne fabrique',
      'pas une objection pour remplir. Mais signe-la : dis ce que tu as vérifié.',
      '',
      'Termine par « ## Pour l\'orchestrateur » : ce qui doit être tranché par un',
      'humain, et ce qui peut être corrigé sans arbitrage.',
    ].join('\n'),
    _auto: true,
  };
}
