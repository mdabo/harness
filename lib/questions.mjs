import fs from 'fs';
import path from 'path';

/**
 * Le canal de retour des agents vers l'orchestrateur.
 *
 * Un sous-agent est isolé : il ne peut pas lever la main en cours de route, il
 * ne parle qu'une fois, à la fin. Sans canal dédié, un agent qui doute n'a que
 * deux issues — inventer une hypothèse et la taire, ou échouer sans dire
 * pourquoi. Les deux coûtent une vague entière.
 *
 * D'où un fichier par rôle, à un emplacement connu. Il est détectable par
 * machine, donc l'orchestrateur n'a pas à relire toutes les productions pour
 * savoir que quelqu'un attend une réponse.
 *
 * Deux natures, délibérément séparées :
 *   · bloquant — l'agent s'est arrêté, il attend
 *   · avis     — l'agent a fait le travail, mais conteste la manière
 * Confondre les deux ferait passer tout désaccord pour un blocage, et plus
 * personne ne signalerait rien.
 */

export const DOSSIER = '.harness/questions';

export function cheminQuestions(nomRole, racineProjet) {
  return path.join(racineProjet, DOSSIER, `${nomRole}.md`);
}

export function lireQuestions(racineProjet) {
  const d = path.join(racineProjet, DOSSIER);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => {
      const texte = fs.readFileSync(path.join(d, f), 'utf8');
      return {
        role: f.replace(/\.md$/, ''),
        fichier: path.join(DOSSIER, f),
        bloquant: /^##\s*Bloquant/im.test(texte),
        avis: /^##\s*Avis/im.test(texte),
        texte,
      };
    })
    .filter((q) => q.bloquant || q.avis);
}
