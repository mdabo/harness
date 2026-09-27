import fs from 'fs';

/**
 * Évaluation d'un contrat de sortie.
 *
 * Deux niveaux, dans cet ordre :
 *   · « must »   mécanique, gratuit, sans modèle — toujours évalué ici
 *   · « review » sémantique, payant — délégué au moteur, jamais fait ici
 *
 * La règle qui justifie cette séparation : une assertion qu'on ne peut pas
 * vérifier sans modèle ne sera pas vérifiée, donc deviendra décorative.
 */

function lireFrontmatter(texte) {
  const m = texte.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const champs = {};
  for (const l of m[1].split('\n')) {
    const i = l.indexOf(':');
    if (i > 0 && !l.startsWith(' ')) champs[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  }
  return champs;
}

export function verifierSortie(sortie) {
  const checks = [];
  const must = sortie.must || {};
  const existe = fs.existsSync(sortie.path);

  // « exists » est implicite : un artefact absent ne peut satisfaire aucune
  // autre condition, et un échec sans explication n'aide personne.
  if (must.exists !== undefined || !existe) {
    checks.push({
      nom: 'exists',
      ok: must.exists === undefined ? existe : existe === must.exists,
      detail: existe ? 'présent' : 'absent — aucune autre condition évaluable',
    });
  }
  if (!existe) {
    return { path: sortie.path, ok: false, checks, review: sortie.review || null };
  }

  const texte = fs.readFileSync(sortie.path, 'utf8');
  const octets = Buffer.byteLength(texte);

  if (must.min_bytes !== undefined) {
    checks.push({ nom: 'min_bytes', ok: octets >= must.min_bytes, detail: `${octets} / ${must.min_bytes} attendus` });
  }

  if (must.frontmatter) {
    const fm = lireFrontmatter(texte);
    const requis = Array.isArray(must.frontmatter) ? must.frontmatter : [must.frontmatter];
    const absents = fm ? requis.filter((c) => !(c in fm)) : requis;
    checks.push({
      nom: 'frontmatter',
      ok: absents.length === 0,
      detail: !fm ? 'aucun frontmatter' : absents.length ? `manque : ${absents.join(', ')}` : requis.join(', '),
    });
  }

  for (const rg of must.matches || []) {
    let n = 0, err = null;
    try {
      n = (texte.match(new RegExp(rg.pattern, 'gm')) || []).length;
    } catch (e) { err = e.message; }
    const attendu = rg.min_count ?? 1;
    checks.push({
      nom: `matches /${rg.pattern}/`,
      ok: err ? false : n >= attendu,
      detail: err ? `motif invalide : ${err}` : `${n} trouvé(s) / ${attendu} attendu(s)`,
    });
  }

  return { path: sortie.path, ok: checks.every((c) => c.ok), checks, review: sortie.review || null };
}

export function verifierRole(role) {
  const sorties = (role.outputs || []).map(verifierSortie);
  return { role: role.role, ok: sorties.length > 0 && sorties.every((s) => s.ok), sorties };
}
