# Cahier des charges — Framework d'orchestration multi-agents

> Document de cadrage. Destiné à être confié à un agent de codage ou à une
> équipe pour construction. Version 1, à challenger.

---

## 1. Le problème

Le dispositif éprouvé sur un cas réel (six rôles cloisonnés produisant un dossier
d'architecture) a démontré sa valeur : un rôle mandaté pour contredire les autres
a trouvé une faille de sécurité dans le code produit par un autre agent.

Il a aussi montré quatre manques, tous reproductibles :

| Manque constaté | Conséquence vécue |
|---|---|
| Aucun signal de fin | Quatre agents bloqués sur une demande de permission, indiscernables d'agents au travail |
| Aucune preuve de travail | Un rapport rendu annonçant du code qui n'existait pas |
| Aucune mémoire partagée | Quatre incohérences découvertes seulement à l'assemblage |
| Tout est à réécrire à chaque projet | Les briefs de rôle, les permissions, le script de lancement |

**L'objet du framework** : rendre ce dispositif réutilisable, observable et
économe, pour deux familles d'usage très différentes.

## 2. Les deux familles d'usage

### A. Fabrique logicielle assistée

Un développeur travaille dans un dépôt avec un agent de codage. Il veut faire
intervenir plusieurs rôles spécialisés sur son produit : revoir le design,
challenger le modèle économique, améliorer la testabilité, proposer d'autres
implémentations, rechercher et proposer les options de commercialisation, se mettre dans la peau d'un utilsateur final réel et identifier la véritable apport de valeur et de potentiels frictions, ou tout autre tâches pouvant être délégué à un agent autonome

- **Où ça tourne** : sur la machine du développeur, dans l'agent de codage
- **Ce que ça manipule** : des fichiers, un dépôt git, des tests
- **Qui valide** : le développeur, en direct
- **Modèle** : celui de l'outil, pas de clé d'API à fournir

### B. Processus métier autonome

Une organisation veut automatiser un processus : qualifier des demandes, produire
un dossier, contrôler une conformité. Plusieurs rôles se répartissent le travail.

- **Où ça tourne** : sur un serveur, sans humain devant l'écran
- **Ce que ça manipule** : des données métier, des systèmes externes
- **Qui valide** : des règles, et un humain aux points de décision
- **Modèle** : au choix, par clé d'API — c'est une exigence dure

> **Décision structurante** : ces deux familles partagent **la définition du
> dispositif**, pas son exécution. Un noyau commun, deux moteurs.

## 3. Architecture cible

```
                     ┌──────────────────────────────┐
                     │          LE NOYAU            │
                     │  déclaratif, sans exécution  │
                     │                              │
                     │  • définition des rôles      │
                     │  • capacités et interdits    │
                     │  • contrats d'entrée/sortie  │
                     │  • séquencement et portes    │
                     │  • format du journal         │
                     └───────────┬──────────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
      ┌────────────────────┐         ┌────────────────────┐
      │  MOTEUR LOCAL      │         │  MOTEUR AUTONOME   │
      │  agent de codage   │         │  serveur           │
      ├────────────────────┤         ├────────────────────┤
      │ sous-agents natifs │         │ appels API directs │
      │ sessions tmux      │         │ modèle au choix    │
      │ fichiers + git     │         │ état persistant    │
      │ humain en boucle   │         │ reprise sur erreur │
      └────────────────────┘         └────────────────────┘
```

**Ce qui vit dans le noyau** doit être vrai des deux côtés. Test de validation :
*si une notion ne se traduit que dans un seul moteur, elle n'appartient pas au
noyau.* Exemple : « périmètre d'écriture de fichiers » est spécifique au local —
la notion de noyau est « périmètre de ressources modifiables ».

## 4. Le format de rôle — pièce centrale

Un rôle est un fichier unique, lisible par un humain, exploitable par les deux
moteurs. Rien d'autre ne décrit un rôle : pas de code, pas de configuration
éparpillée.

```yaml
role: securite
name: "Revue de sécurité"

mission: >
  Contredire les autres rôles. Une revue qui valide tout ne sert à rien.

# ── PÉRIMÈTRE ─────────────────────────────────────────────────────────────
# Traduit par chaque moteur :
#   local    → règles deny/allow sur les chemins
#   autonome → liste blanche d'outils et de ressources
scope:
  reads:   ["**"]                      # lire large
  writes:  ["reports/securite.md"]     # écrire étroit
  forbids: ["vcs:history", "deploy:*"] # interdits explicites, quel que soit le reste

# ── DÉCLENCHEMENT ─────────────────────────────────────────────────────────
depends_on: [architecture, backend]    # ne démarre pas avant leur sortie valide

# ── CONTRAT DE SORTIE ─────────────────────────────────────────────────────
# Deux niveaux : mécanique (gratuit, toujours) et sémantique (coûteux, optionnel)
outputs:
  - id: revue
    path: reports/securite.md

    must:                              # vérifications machine, sans modèle
      exists: true
      min_bytes: 800
      frontmatter: [role, date, reviewed]
      matches:
        - pattern: "^## Objection"
          min_count: 3
        - pattern: "`[^`]+\\.(ts|py|sql):[0-9]+`"   # une référence fichier:ligne
          min_count: 3

    review:                            # vérification sémantique, facultative
      model: minimal                   # jamais le modèle cher pour vérifier
      asks: >
        Chaque objection désigne-t-elle un défaut précis, et non une préférence
        de style ? Réponds strictement par PASS ou FAIL suivi d'une ligne.

# ── EXÉCUTION ─────────────────────────────────────────────────────────────
execution:
  mode: auto                 # auto | subagent | session  (cf. §7)
  model: standard            # minimal | standard | maximal
  budget:
    max_turns: 25
    max_tokens: 120000
    timeout: 20m
  on_failure: block          # block | continue | retry:2

# ── CONTEXTE ──────────────────────────────────────────────────────────────
# Ce que le rôle reçoit. Jamais « tout le dépôt ».
context:
  files: ["docs/CONTEXT.md", "reports/*.md"]
  from_roles: [architecture]           # leurs artefacts de sortie, pas leur transcript
  max_bytes: 200000                    # garde-fou : au-delà, le moteur refuse

brief: |
  Instructions détaillées, en langage naturel.
  Injectées en instruction système, jamais en message utilisateur.
```

### Les six décisions de conception, et ce qu'elles coûtent

**① `must` mécanique avant `review` sémantique.** C'est la correction la plus
importante par rapport à une première intuition. Écrire une assertion en langage
naturel — *« contient au moins 3 objections »* — n'est **pas vérifiable par
machine** : il faut un modèle pour la juger, donc un coût, donc on ne la vérifie
pas, donc elle devient décorative. Les `must` sont des tests : existence, taille,
expressions régulières, champs obligatoires. Gratuits et sans ambiguïté.
*Coût* : écrire une regex est moins naturel qu'une phrase. C'est le prix d'une
vérification qui ne ment pas.

**② `review` est optionnel et toujours confié au modèle le moins cher.** Vérifier
est une tâche de lecture, pas de création. La réponse est contrainte à
`PASS`/`FAIL` — pas de texte libre, pas de négociation.
*Coût* : un jugement sémantique reste faillible. Il ne remplace pas les `must`,
il les complète.

**③ `execution` dans le rôle, pas dans le dispositif.** Le choix sous-agent ou
session est une propriété du **travail**, pas du projet. Le même rôle « revue »
sera un sous-agent sur un petit dépôt et une session sur un gros.
*Coût* : un auteur de rôle doit comprendre la distinction. D'où `auto` par
défaut, qui applique la règle de §7.

**④ `budget` obligatoire.** Un rôle sans limite est un rôle qui peut consommer
sans fin. Trois bornes indépendantes : tours, tokens, temps. La première atteinte
arrête le rôle, et l'événement part au journal.
*Coût* : un budget trop serré coupe un travail légitime. Les valeurs sont donc
révisables par dispositif, et le journal indique toujours **quelle** borne a
coupé.

**⑤ `context.from_roles` et non `context.files` pour les dépendances.** Un rôle
qui dépend d'un autre reçoit **son artefact de sortie**, jamais sa conversation.
C'est ce qui empêche le contexte de croître de façon multiplicative quand les
rôles s'enchaînent.
*Coût* : un rôle ne voit pas le raisonnement de son prédécesseur. Si ce
raisonnement compte, il doit figurer dans l'artefact — ce qui est une bonne
discipline.

**⑥ `context.max_bytes` bloquant.** Le moteur refuse de lancer un rôle dont le
contexte dépasse la borne, plutôt que de tronquer en silence. Un dépassement est
un défaut de conception du rôle, pas un incident d'exécution.
*Coût* : un refus au lancement est frustrant. Il est préférable à un agent qui
perd le fil au milieu.

### Ce qui est délibérément absent

- **Pas de conditions ni de boucles.** `depends_on` exprime un ordre, pas une
  logique. Un dispositif qui a besoin d'un `if` est un programme — écris un
  programme.
- **Pas d'appel direct entre rôles.** Un rôle ne peut pas « demander » quelque
  chose à un autre. Il produit, l'autre consomme. Le seul lien est l'artefact.
- **Pas de priorité ni de poids.** Deux rôles prêts démarrent ensemble. S'il faut
  un ordre, c'est une dépendance.

## 5. Le journal d'événements — la pièce qui manquait

Le dispositif éprouvé n'avait aucun canal entre agents autre que l'orchestrateur.
**Le framework ajoute un journal partagé, en ajout seul.**

```jsonl
{"t":"2026-09-20T10:04:11Z","role":"architecture","event":"started"}
{"t":"...","role":"architecture","event":"artifact","path":"docs/01.md","assertions":"pass"}
{"t":"...","role":"architecture","event":"finished","tokens":18400}
{"t":"...","role":"securite","event":"objection","target":"backend","ref":"ADR-062","severity":"high"}
{"t":"...","role":"orchestrateur","event":"arbitration","objection":"...","decision":"retained"}
```

Ce fichier unique résout trois manques d'un coup :

- **Le signal de fin** devient un événement, plus une lecture d'écran
- **La preuve de travail** est l'événement `artifact` avec ses assertions
- **La supervision** se fait en lisant un fichier, pas en capturant des pixels

> Et il donne la traçabilité que réclame toute démarche sérieuse : qui a décidé
> quoi, quand, sur quelle base.

## 6. Stratégie d'économie des tokens

Exigence explicite. Cinq leviers, par ordre d'effet.

| Levier | Effet | Comment |
|---|---|---|
| **1. Routage de modèle** | **×5 à ×20** | Un rôle qui cherche, résume ou vérifie n'a pas besoin du modèle le plus cher. `model_hint` le déclare, le moteur l'applique. |
| **2. Contexte déclaré** | ×2 à ×5 | `context:` liste ce que le rôle doit lire. Sans ça, chaque agent recharge tout le dépôt. |
| **3. Isolation par sous-agent** | ×2 à ×4 | Une recherche qui lit trente fichiers doit rendre trois lignes. Le contexte de fouille meurt avec le sous-agent. |
| **4. Instruction système stable** | ×1,5 à ×3 | Un brief injecté en système est mis en cache par le fournisseur. Le changer à chaque tour annule le bénéfice. |
| **5. Reprise plutôt que relance** | variable | Un rôle dont l'artefact satisfait ses assertions ne se relance pas. |

**Règle opposable à inscrire dans le framework :**

> *Aucun rôle ne reçoit le dépôt entier. Un rôle qui a besoin de tout lire est un
> rôle mal défini.*

**Différence entre les deux moteurs, à ne pas confondre :**

- **Local** : le coût est un forfait. Le levier réel est le *temps* et la
  saturation du contexte — un agent qui déborde perd le fil et refait du travail.
- **Autonome** : chaque token est facturé. Le routage de modèle et le cache
  deviennent des postes budgétaires suivis.

## 7. Quand sous-agent, quand session — la règle

La décision se prend **par rôle**, jamais pour tout un dispositif. Et elle se
déduit du rôle lui-même : `execution.mode: auto` applique les règles ci-dessous
sans intervention.

### Ce qui sépare réellement les deux

| | Sous-agent | Session |
|---|---|---|
| Fin de tâche | **Signalée nativement** | Via le journal |
| Choix du modèle | **Par tâche** — levier ×5 à ×20 | Celui de la session |
| Outils autorisés | **Liste blanche par rôle** | Permissions du moteur |
| Contexte | Isolé, **jeté à la fin** | Cumulatif, persistant |
| Observation en direct | Aucune | Totale |
| Correction en cours de route | Impossible | Possible |
| Relance | Idempotente, sans état | Reprend où elle en était |

> **L'arbitrage tient en une phrase** : choisir une session, c'est renoncer au
> routage de modèle — donc au principal levier d'économie — pour gagner la
> possibilité d'intervenir. Ce renoncement doit être justifié, pas subi.

### Règles de décision — la première qui s'applique l'emporte

```
  ① execution.mode est explicite (subagent | session)
       └──► on respecte. Le champ execution.reason devient obligatoire.

  ② interactive: true dans le rôle
       └──► SESSION. L'auteur déclare qu'un humain doit pouvoir intervenir.

  ③ scope.writes contient un glob large ( ** ou plus de 3 chemins )
       └──► SESSION. Un rôle qui écrit partout produit longtemps.

  ④ budget.max_turns > 20
       └──► SESSION. Au-delà, l'isolation du contexte coûte plus qu'elle ne rapporte.

  ⑤ scope.writes est vide  (rôle purement analytique)
       └──► SOUS-AGENT. Rien à observer, tout à isoler.

  ⑥ par défaut
       └──► SOUS-AGENT. C'est le mode le moins cher : il doit être celui
            qu'on obtient sans rien demander.
```

**Le défaut est délibérément le sous-agent.** Le dispositif éprouvé avait tout
mis en session, et c'est ce qui a coûté le plus cher. Quand on ne sait pas, le
mode économe doit gagner.

### Ce que ça donne en pratique

Sur un dispositif type, en reprenant les rôles réellement écrits :

| Rôle | Mode retenu | Règle déclenchée |
|---|---|---|
| Revue de sécurité | sous-agent | ⑤ — écrit un seul rapport, lit beaucoup |
| Analyse de l'existant | sous-agent | ⑤ — ne produit qu'une synthèse |
| Vérification de contrat | sous-agent | ⑥ — tâche courte, modèle minimal |
| Architecture fonctionnelle | **session** | ③ — écrit un document et une dizaine de décisions |
| Développement d'un module | **session** | ④ — travail long et itératif |
| Arbitrage | **session** | ② — c'est l'humain qui tranche, avec l'agent |

> Sur dix rôles, on attend six à sept sous-agents. Un dispositif où tout est en
> session révèle des rôles mal découpés — probablement trop larges.

### Traduction dans le moteur autonome

Sur un serveur, « session » n'existe pas : il n'y a ni terminal, ni humain
devant l'écran. Le noyau reste pourtant valide, parce qu'il décrit une **nature
de travail**, pas un mécanisme :

| Noyau | Moteur local | Moteur autonome |
|---|---|---|
| `subagent` | Sous-agent natif de l'outil | Un appel, contexte jeté après réponse |
| `session` | Fenêtre de terminal persistante | **Conversation persistée** : l'état est sauvegardé entre appels, rechargé au suivant |
| `interactive: true` | L'humain corrige en direct | **Point d'arrêt** : le processus suspend et attend une validation externe |

C'est la validation du test de §3 : la notion appartient bien au noyau, puisque
les deux moteurs savent la traduire sans la trahir.

## 8. Disposition du terminal

Règle automatique, dérivée du nombre de rôles en session :

```
  ≤ 3 sessions            1 fenêtre, l'orchestrateur en haut, les rôles dessous
                          ┌──────────────────────────┐
                          │      ORCHESTRATEUR       │
                          ├────────┬────────┬────────┤
                          │ rôle A │ rôle B │ rôle C │
                          └────────┴────────┴────────┘

  4 à 8 sessions          1 fenêtre pilote + 1 fenêtre par phase
                          [0:pilote] [1:conception] [2:build] [3:revue]

  > 8 sessions            regroupement par domaine, 4 panes maximum par fenêtre
                          [0:pilote] [1:produit] [2:technique] [3:qualité]
```

**Nommage imposé** : `<index>:<phase>` pour les fenêtres, et le titre du pane
porte `<rôle>`. Une règle de nommage stable est ce qui permet au pilote
d'adresser un rôle sans le chercher.

**Exigence** : l'écran doit répondre à une question en un coup d'œil — *qui
travaille, qui attend, qui a fini*. Le journal alimente un bandeau d'état.

## 9. Les deux modes d'installation

**Mode squelette** — on part de rien.

```
  <outil> init mon-dispositif
  └── crée la structure complète, prête à décrire des rôles
```

**Mode greffe** — on entre dans un projet existant.

```
  cd /mon/projet/existant
  <outil> graft
  └── ajoute .harness/ et rien d'autre
      ne touche ni au code, ni à la configuration, ni aux dépendances
```

> **Exigence dure du mode greffe** : réversible par la suppression d'un seul
> répertoire. Un framework qui s'infiltre dans un projet existant ne sera pas
> adopté.

Structure posée dans les deux cas :

```
  .harness/
  ├── dispositif.yaml        le dispositif : rôles, séquence, portes
  ├── roles/                 un fichier par rôle
  ├── skills/                capacités réutilisables
  ├── journal.jsonl          le journal d'événements
  └── artifacts/             les productions, si le projet n'a pas de place
```

## 10. Les skills — deux familles

### A. Les skills du framework

Livrés avec le produit, indépendants du domaine :

| Skill | Ce qu'il fait |
|---|---|
| `contradict` | Prend un artefact, produit des objections datées et référencées |
| `arbitrate` | Prend des objections, produit une décision tracée avec son coût |
| `trace` | Maintient le registre des décisions, l'indexe, détecte les contradictions |
| `verify` | Évalue un contrat de sortie : `must` mécanique puis `review` sémantique |
| `scope` | Traduit un périmètre déclaré en règles du moteur courant |
| `report` | Produit la synthèse de fin, y compris ce qui n'a pas été fait |

> `contradict` et `arbitrate` sont le cœur. Le reste est de l'outillage.

Deux autres ne relèvent pas du même registre : ils n'agissent pas sur un artefact,
ils pilotent le dispositif lui-même.

| Skill | Ce qu'il fait |
|---|---|
| `harness-roles` | Traduit un besoin exprimé en langage courant en fichier de rôle |
| `harness-orchestrate` | Tient la boucle plan → run → dispatch → verify, et sait quand escalader |

Ensemble, ils tiennent une exigence qui n'était pas explicite au départ et qui
gouverne tout le reste : **l'utilisateur ne tape aucune commande.**

| | Utilisateur | Orchestrateur |
|---|---|---|
| Décrire les rôles | en langage courant | écrit les fichiers |
| Lancer | « vas-y » | `plan`, `run`, dispatch |
| Pendant | regarde les panes | `verify`, relance les échecs |
| Décisions structurantes | tranche | présente le choix et son coût |

Ce que ça impose au produit : tout ce qui est aujourd'hui une commande doit être
documenté comme un comportement attendu de l'orchestrateur, pas comme une étape
d'un mode d'emploi. Un README qui dit « maintenant lancez `harness verify` » est
le symptôme que cette exigence n'est pas tenue.

### La complétude avant l'écriture des rôles

**Décision** : avant d'écrire le moindre fichier de rôle, l'orchestrateur ferme
les trous de la demande — une question à la fois, chacune accompagnée de sa
recommandation et de sa justification. Le skill `interroge` de claude-mastery
encode exactement ce protocole ; `harness-roles` s'y raccroche plutôt que de le
réécrire, avec un repli si le skill est absent.

Le problème traité : un rôle bâti sur un besoin mal lu produit un artefact
parfaitement vérifié qui répond à côté. Le contrat de sortie ne protège de rien
ici — il garantit la forme, pas la pertinence. C'est le seul endroit du
dispositif où l'erreur ne se rattrape pas plus tard.

La règle d'arrêt est la seule qui compte : **on s'arrête quand la question
suivante ne changerait pas le fichier.** Souvent une question, rarement plus de
trois. La longueur n'est pas un signe de sérieux ; la phase existe pour lever
l'ambiguïté, pas pour l'exhiber. Et si la demande est déjà précise, on saute la
phase — mais on énonce en une ligne ce qu'on a compris, pour qu'une lecture
fausse soit attrapée avant de coûter quelque chose.

Ce qui se demande, par ordre de rendement : la **frontière** (ce qui n'est
explicitement pas l'affaire du rôle — le hors-périmètre façonne le résultat plus
que le périmètre), l'**usage** de l'artefact, ce qui rendrait la sortie
**inutile** (cette phrase devient le contrat `must`), et l'**ordre** entre rôles.

Ce qui ne se demande jamais : le modèle, le budget, le mode d'exécution, le
chemin de l'artefact. Les poser transforme un briefing en formulaire, et ce sont
des décisions que le produit sait prendre seul.

### Le droit de demander

**Décision** : chaque ordre accorde explicitement à l'agent le droit de s'arrêter
pour demander, et lui ouvre un canal pour le faire — `.harness/questions/<rôle>.md`.

Le problème qu'elle traite : un sous-agent est isolé, il ne parle qu'une fois, à
la fin. Un agent qui doute n'avait donc que deux issues — poser une hypothèse et
la taire, ou échouer sans dire pourquoi. La première est la plus coûteuse : le
travail est fait sur une prémisse fausse, le contrat passe, et personne ne le
découvre avant de lire l'artefact.

Deux natures, délibérément distinguées :

| | Sens | Suite |
|---|---|---|
| `## Bloquant` | L'agent s'est arrêté, il attend | Ne pas relancer avant d'avoir répondu |
| `## Avis` | L'agent a fait le travail mais conteste la méthode | À lire avant son artefact |

Les confondre ferait passer tout désaccord pour un blocage, et plus personne ne
signalerait rien.

Côté orchestrateur, la règle est asymétrique et c'est voulu : il répond seul
**uniquement** si la réponse est dans le projet et qu'il peut dire où. Promesse
produit, arbitrage entre deux directions, périmètre — tout cela remonte à
l'humain. Le test pratique inscrit dans le skill : si la phrase qu'il s'apprête
à écrire commence par « je suppose que », c'est une question, pas une réponse.

Ce que ça coûte : un aller-retour humain au milieu d'une vague, et une vague qui
ne se termine pas toute seule. C'est exactement ce qu'on achète — l'autonomie
n'a jamais été l'objectif, le rendement par jeton consommé l'est.

### La contre-expertise est posée d'office

**Décision** : `harness` synthétise un rôle de contre-expertise dès qu'au moins
deux rôles produisent un artefact. Aucun fichier à écrire, aucune option à
connaître. Il faut un geste explicite pour s'en passer — `contre_expertise: false`.

Le raisonnement : trois spécialistes qui ne se relisent pas produisent trois
rapports qui **se valident par omission**. Chacun est resté dans son périmètre,
donc aucun n'a vu que la migration qui ajoute `tenant_id` est précisément celle
que le rôle isolation supposait déjà déployée. Personne n'a tort ; le trou est
entre eux. C'est exactement ce qu'on montait le dispositif pour attraper, et
c'était jusqu'ici laissé à la mémoire de l'utilisateur.

Sa forme de contrat mérite d'être notée, parce que le premier jet était mauvais.
Exiger « au moins trois objections » crée une prime à l'invention : le troisième
point sera fabriqué. On exige donc **une prise de position par rôle relu** —
`^## (Objection|Rien à redire) — <rôle>`, une occurrence par rôle, vérifiée par
machine. Le silence devient impossible, la fabrication reste sans bénéfice, et
« rien à redire, voici ce que j'ai vérifié » redevient une réponse honorable.

Ce que ça coûte :

- **Un rôle de plus à chaque dispositif**, sur le modèle le plus cher. C'est
  assumé : c'est le seul endroit où la qualité du raisonnement se paie.
- **Les objections arrivent après coup.** Une contre-expertise par vague serait
  plus tôt donc moins chère à corriger, mais contredirait une image partielle.
  Tranché pour v1 : une seule, à la fin.
- **Moins de deux rôles producteurs, elle ne se déclenche pas.** Contredire un
  avis unique, c'est un avis de plus, pas une contre-expertise.

#### Où vivent les skills, et pourquoi pas dans `.claude/`

Chaque agent de codage cherche ses instructions à un endroit différent et dans un
format différent. Poser le skill dans `.claude/skills/` le rend invisible à
Cursor, Copilot, Windsurf, Codex — soit une large part des projets existants,
alors que le mode greffe vise précisément ceux-là.

**Décision** : le corps du skill vit dans `.harness/skills/`, emplacement neutre
qui n'appartient à aucun agent. Chaque agent détecté reçoit un **adaptateur de
trois lignes** dans son format natif, qui ne contient que la phrase de
déclenchement et le chemin du corps.

| Agent | Adaptateur | Chargement |
|---|---|---|
| Claude Code | `.claude/skills/harness-roles/SKILL.md` (lien symbolique) | à la demande |
| Cursor | `.cursor/rules/harness-roles.mdc` — `alwaysApply: false` | à la demande |
| Windsurf | `.windsurf/rules/harness-roles.md` | à la demande |
| Copilot | bloc dans `.github/copilot-instructions.md` | permanent |
| Codex · Zed · Aider · Gemini | bloc dans `AGENTS.md`, s'il existe | permanent |

Ce que ça coûte :

- **Deux agents n'ont pas de chargement à la demande.** Chez Copilot et via
  `AGENTS.md`, les trois lignes sont en contexte à chaque tour. C'est le prix du
  mécanisme de ces agents, pas un défaut d'implémentation — et c'est la raison
  pour laquelle l'adaptateur fait trois lignes et non trois cents.
- **La détection est faillible.** Un agent qui range sa configuration ailleurs
  n'est pas vu. D'où `--agents=` pour forcer.
- **Un lien symbolique n'existe pas partout.** Repli sur une copie, au prix d'une
  divergence possible si l'utilisateur édite la copie.

Contrepartie tenue : **un seul texte à maintenir**. Un skill dupliqué en cinq
formats aurait divergé dès la première correction.

Les blocs écrits dans des fichiers partagés sont bornés par
`<!-- harness:begin -->` / `<!-- harness:end -->` : réinstaller remplace au lieu
d'empiler, et désinstaller retire un bloc sans toucher au reste. Rien n'est créé
dans un projet qui ne montre aucun signe d'utiliser l'agent concerné ; `AGENTS.md`
est enrichi s'il existe, jamais créé d'office.

### B. Les skills tiers, installés pour l'utilisateur

Le framework n'a pas à réinventer ce qui existe. Il installe, **dans le périmètre
du projet et non globalement**, un socle d'outils utiles au cycle de vie d'un
dispositif :

| Skill | Pourquoi il est utile ici |
|---|---|
| **claude-mastery** | Pratiques d'usage de l'agent de codage — le socle pour écrire de bons briefs de rôle |
| **spec-kit** (`specify`) | Spec-driven development : cadrer avant de produire, ce que tout rôle devrait faire |
| **archify** | Diagrammes d'architecture validés — pour représenter le dispositif lui-même et ce qu'il produit |
| **skill-creator** | Créer de nouveaux skills — un dispositif mature finit par avoir besoin des siens |

**Trois règles d'installation, non négociables :**

**① Vérifier avant d'installer.** Un skill déjà présent, en projet ou en global,
n'est pas réinstallé. Le journal d'installation dit ce qui a été trouvé et ce qui
a été ajouté. *(Cas réel : sur un poste de test, archify et spec-kit étaient déjà
présents globalement, claude-mastery non. Réinstaller aurait été du bruit.)*

**② Portée projet par défaut.** Un framework qui pollue l'installation globale
d'un utilisateur se fait désinstaller. Le global n'est utilisé que si
l'utilisateur le demande explicitement.

**③ Tout est tracé et réversible.** L'installation écrit ce qu'elle fait, ligne
par ligne, et note ce qu'elle a ajouté pour pouvoir le retirer. Un skill déjà
présent avant l'installation n'est jamais retiré par la désinstallation.

### La commande unique

```
  <outil> install
```

Et rien d'autre. Elle enchaîne, en affichant chaque étape :

```
  ▸ Vérification de l'environnement
      node v22        ✓
      agent de codage ✓
  ▸ Structure du dispositif
      .harness/ créé  (roles/ skills/ artifacts/ journal.jsonl)
  ▸ Skills du framework
      contradict, arbitrate, trace, verify, scope, report   6 posés
  ▸ Skills tiers — portée projet
      archify          déjà présent (global)     → ignoré
      spec-kit         déjà présent (global)     → ignoré
      claude-mastery   absent                    → installé
      skill-creator    déjà présent (global)     → ignoré
  ▸ Terminé.  1 skill ajouté, 3 déjà présents.
      Pour décrire votre premier rôle : .harness/roles/exemple.yaml
```

> **Exigence** : aucune étape silencieuse. Un utilisateur doit pouvoir lire ce
> qui s'est passé sur sa machine sans ouvrir le script.

## 11. Hors périmètre — version 1

Dire ce qu'on ne fait pas vaut autant que dire ce qu'on fait.

- **Pas d'interface graphique.** Terminal et fichiers.
- **Pas de gestion d'état distribué.** Un dispositif tourne sur une machine.
- **Pas d'apprentissage.** Le framework n'améliore pas les rôles tout seul.
- **Pas de marché de rôles.** Les rôles sont écrits par ceux qui les utilisent.
- **Pas de garantie de reprise à chaud** pour le moteur local en version 1.

## 12. Risques

| Risque | Mitigation |
|---|---|
| **Le noyau se contamine** de notions propres à un moteur | Test de validation §3 appliqué à chaque ajout |
| **Les assertions deviennent décoratives** — on écrit « contient 3 objections » sans le vérifier | `verify` est bloquant, pas indicatif |
| **Le framework coûte plus qu'il ne rapporte** sur les petits dispositifs | Seuil documenté : en dessous de trois rôles, ne pas l'utiliser |
| **L'orchestrateur reste le goulot** | Le journal réduit la charge, il ne la supprime pas. À mesurer. |
| **Dérive vers un moteur de workflow généraliste** | Le dispositif reste déclaratif. Pas de conditions, pas de boucles dans le YAML. |

## 13. Séquencement proposé

| Étape | Contenu | Ce qu'on peut démontrer |
|---|---|---|
| **1** | Noyau : format de rôle, journal, `verify` | Un dispositif décrit, un artefact vérifié |
| **2** | Moteur local, sous-agents seulement | Trois rôles bornés sur un vrai dépôt |
| **3** | Moteur local, sessions + tmux | Le dispositif complet, observable |
| **4** | Skills `contradict` et `arbitrate` | La boucle de contradiction, automatisée |
| **5** | Mode greffe | Application à un projet existant |
| **6** | Moteur autonome, modèle au choix | Un processus métier sans humain |

> L'étape 2 est le premier jalon qui vaut la peine d'être montré. L'étape 4 est
> celle qui distingue ce framework d'un simple lanceur de tâches.

## 14. Critères de réussite

- Un dispositif de cinq rôles se décrit en **moins d'une heure** par quelqu'un
  qui n'a pas écrit le framework.
- Le mode greffe s'installe et se retire **sans laisser de trace**.
- Le coût en tokens d'un dispositif est **inférieur de moitié** à la même chose
  faite en sessions non routées.
- Un rôle qui échoue **ne bloque pas** les autres, et son échec est lisible dans
  le journal.
- La supervision d'un dispositif de dix rôles tient sur **un écran**.
