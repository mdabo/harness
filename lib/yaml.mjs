/**
 * Parseur YAML minimal, sans dépendance.
 *
 * Il ne couvre pas YAML. Il couvre le sous-ensemble qu'un fichier de rôle
 * utilise : clés, imbrication par indentation, listes (y compris de blocs),
 * collections en ligne, blocs littéraux « | » et « > », commentaires.
 *
 * Ce choix est assumé : tirer une dépendance pour lire une vingtaine de clés
 * imposerait une installation là où l'outil promet de ne rien installer.
 * Toute construction non reconnue lève une erreur qui cite la ligne — jamais
 * une interprétation silencieuse.
 */

const INLINE_LIST = /^\[(.*)\]$/s;
const INLINE_MAP = /^\{(.*)\}$/s;

function scalaire(brut, ligne) {
  const v = brut.trim();
  if (v === '' || v === '~' || v === 'null') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  if (/^-?\d*\.\d+$/.test(v)) return Number(v);

  if ((v.startsWith('"') && v.endsWith('"') && v.length > 1) ||
      (v.startsWith("'") && v.endsWith("'") && v.length > 1)) {
    return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  const l = v.match(INLINE_LIST);
  if (l) return decouper(l[1]).map((x) => scalaire(x, ligne));
  const m = v.match(INLINE_MAP);
  if (m) {
    const o = {};
    for (const p of decouper(m[1])) {
      const i = p.indexOf(':');
      if (i < 0) throw new ErreurYaml(`paire sans « : » dans « {${m[1]}} »`, ligne);
      o[p.slice(0, i).trim()] = scalaire(p.slice(i + 1), ligne);
    }
    return o;
  }
  return v;
}

/** Découpe sur les virgules de premier niveau, en respectant guillemets et imbrication. */
function decouper(s) {
  const out = [];
  let cur = '', prof = 0, q = null;
  for (const c of s) {
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '[' || c === '{') prof++;
    if (c === ']' || c === '}') prof--;
    if (c === ',' && prof === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim() !== '') out.push(cur);
  return out;
}

export class ErreurYaml extends Error {
  constructor(message, ligne) {
    super(ligne ? `ligne ${ligne} : ${message}` : message);
    this.ligne = ligne;
  }
}

/** Retire commentaire de fin de ligne, sans toucher à ce qui est entre guillemets. */
function sansCommentaire(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i);
  }
  return s;
}

export function parseYaml(texte) {
  const lignes = texte.split('\n').map((l, i) => ({ brut: l, n: i + 1 }));
  let pos = 0;

  const vide = (l) => l.brut.trim() === '' || l.brut.trim().startsWith('#');
  const indent = (l) => l.brut.match(/^ */)[0].length;

  function suivante() {
    while (pos < lignes.length && vide(lignes[pos])) pos++;
    return pos < lignes.length ? lignes[pos] : null;
  }

  /** Lit un bloc littéral « | » (conserve) ou plié « > » (joint). */
  function bloc(style, indentParent) {
    const morceaux = [];
    let base = null;
    while (pos < lignes.length) {
      const l = lignes[pos];
      if (l.brut.trim() === '') { morceaux.push(''); pos++; continue; }
      const ind = indent(l);
      if (ind <= indentParent) break;
      if (base === null) base = ind;
      morceaux.push(l.brut.slice(base));
      pos++;
    }
    while (morceaux.length && morceaux[morceaux.length - 1] === '') morceaux.pop();
    if (style === '|') return morceaux.join('\n') + '\n';
    // « > » : les lignes d'un même paragraphe sont jointes, la ligne vide sépare
    return morceaux.reduce((acc, m) => {
      if (m === '') return acc + '\n\n';
      return acc + (acc && !acc.endsWith('\n') ? ' ' : '') + m.trim();
    }, '').trim() + '\n';
  }

  function valeurBloc(indentMin) {
    const l = suivante();
    if (!l || indent(l) < indentMin) return null;
    return indent(l) >= indentMin && l.brut.trim().startsWith('- ')
      ? liste(indent(l))
      : mapping(indent(l));
  }

  function liste(ind) {
    const out = [];
    while (true) {
      const l = suivante();
      if (!l || indent(l) !== ind || !l.brut.trim().startsWith('-')) break;
      const reste = l.brut.trim().replace(/^-\s*/, '');
      pos++;
      if (reste === '') {
        const v = valeurBloc(ind + 1);
        out.push(v === null ? null : v);
      } else if (/^[A-Za-z_][\w.-]*\s*:/.test(reste)) {
        // élément de liste qui est lui-même un mapping, ouvert sur la même ligne
        const i = reste.indexOf(':');
        const cle = reste.slice(0, i).trim();
        const apres = sansCommentaire(reste.slice(i + 1)).trim();
        const obj = {};
        obj[cle] = apres === '' ? valeurBloc(ind + 2) : scalaire(apres, l.n);
        const suite = mappingDepuis(ind + 2);
        Object.assign(obj, suite);
        out.push(obj);
      } else {
        out.push(scalaire(sansCommentaire(reste), l.n));
      }
    }
    return out;
  }

  function mappingDepuis(ind) {
    const l = suivante();
    if (!l || indent(l) !== ind) return {};
    return mapping(ind);
  }

  function mapping(ind) {
    const out = {};
    while (true) {
      const l = suivante();
      if (!l || indent(l) !== ind) break;
      const contenu = l.brut.trim();
      if (contenu.startsWith('- ')) break;

      const i = contenu.indexOf(':');
      if (i < 0) throw new ErreurYaml(`« : » attendu dans « ${contenu} »`, l.n);
      const cle = contenu.slice(0, i).trim();
      let apres = contenu.slice(i + 1);
      pos++;

      const style = apres.trim();
      if (style === '|' || style === '>') { out[cle] = bloc(style, ind); continue; }
      apres = sansCommentaire(apres).trim();
      out[cle] = apres === '' ? valeurBloc(ind + 1) : scalaire(apres, l.n);
    }
    return out;
  }

  const premiere = suivante();
  if (!premiere) return {};
  return premiere.brut.trim().startsWith('- ') ? liste(indent(premiere)) : mapping(indent(premiere));
}
