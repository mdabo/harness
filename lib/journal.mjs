import fs from 'fs';
import path from 'path';

/**
 * Journal d'événements, en ajout seul.
 *
 * Il remplace la lecture d'écran qui servait de supervision dans le dispositif
 * éprouvé : le signal de fin devient un événement, la preuve de travail devient
 * une assertion évaluée, et la trace devient interrogeable.
 */
export function journal(racineProjet) {
  const f = path.join(racineProjet, '.harness', 'journal.jsonl');
  return {
    fichier: f,
    ecrire(event) {
      const ligne = JSON.stringify({ t: new Date().toISOString(), ...event });
      try { fs.appendFileSync(f, ligne + '\n'); } catch { /* le journal ne doit jamais bloquer */ }
    },
    lire() {
      if (!fs.existsSync(f)) return [];
      return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    },
  };
}
