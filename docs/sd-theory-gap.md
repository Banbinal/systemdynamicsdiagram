# System Dynamics — théorie, état de l'outil, gap analysis

Document de référence interne. Croise les conventions canoniques de la dynamique des systèmes (Forrester, Sterman, Richardson, Senge/Kim/Wolstenholme, écoles Vensim/Stella) avec ce que SystemDiagram v2 sait faire aujourd'hui, et identifie les écarts à prioriser.

> Audience : équipe outil. Style : référence dense, pas tutoriel.

---

## Table des matières

1. [Cartographie de l'outil — état au 2026-05-08](#1-cartographie-de-loutil--état-au-2026-05-08)
2. [Théorie SD — représentations visuelles canoniques](#2-théorie-sd--représentations-visuelles-canoniques)
3. [Gap analysis](#3-gap-analysis)
4. [Recommandations priorisées](#4-recommandations-priorisées)
5. [Sources](#5-sources)

---

## 1. Cartographie de l'outil — état au 2026-05-08

### 1.1 DSL — concepts modélisables

Éléments du DSL v2 (référence : `grammar.md`, `SKILL.md` du skill `sysdyn-modeler`).

**Fondamentaux**
- **`stock`** — variable d'état, accumule au cours du temps. `stock <Name> = <init-expr>`. Quantité conservée (population, inventaire, capital).
- **`flow`** — flux de variation. `flow <Name>: <expr> -+> <Stock>` (ajout) ou `<expr> --> <Stock>` (soustraction). Plusieurs effets possibles par flux (une ligne par stock affecté).
- **`calc`** — variable dérivée, recalculée à chaque pas. `calc <Name> = <expr>`. Dépend uniquement d'états/constantes courants.
- **`constant`** — paramètre compilé une fois. `constant <Name> = <expr>`. Écrasable en scénarios/sweeps.
- **`map`** — lookup table 1D. `map <Name>: linear|step|spline` avec points `(x, y)`. Appel : `<Name>(input)`. Permet des non-linéarités.
- **`module`** — namespace. `module <Name>: <indented-body>`. Noms qualifiés (`Module.Stock`), lookup de scope remonte l'arborescence.

**Temps et politique**
- **`smooth(x, tau)`** — filtre exponentiel, désucré en stock synthétique caché `__smooth_N`.
- **`delay3(x, tau)`** — délai distribué 3e ordre (pipeline), désucré en 3 stocks synthétiques.
- **`step(height, t0)`** — échelon temporel.
- **`pulse(height, t0, width)`** — impulsion sur fenêtre `[t0, t0+width)`.

**Configuration et analyse**
- **`scenario`** — ensemble d'écrasements (`constant`/`stock`) appliqués à une simulation.
- **`sweep`** — une run par valeur de constante. `sweep <Const> = [v1, v2, ...]`.
- **`limit`** — clamp post-step min/max.
- **`plot`** — marque variable pour sortie prominente.

**Polarité**
- Flèches porteuses de signe : `-+>` (ajout = entrée positive), `-->` (soustraction = entrée négative).
- Polarity inference (`polarity.ts`) : sens causal sur chaque chemin (`+`, `-`, ou `?`).

### 1.2 Rendu visuel — diagramme structurel

Mermaid `flowchart LR`, compilé par `programToMermaid.ts`, rendu via `Diagram.tsx`.

| Élément | Forme Mermaid | Style | Note |
|---|---|---|---|
| Stock | Rectangle `["label"]` | Blanc, bord noir 1.5px | Stocks synthétiques `smooth`/`delay3` cachés |
| Flow | Losange `{{"label"}}` | Beige `#F4EFE6`, bord marron `#A0742E` 1px | **Non standard** (canonique = valve/bowtie sur pipe) |
| Source/sink | Cercle vide `(("&nbsp;"))` | Gris clair `#F0EEEA`, bord `#B8B5AE` | Aligné canonique |
| Module | `subgraph` | Fond `#FAFAF9`, bord `#D4D1CB` | Aligné canonique (sectors) |

**Topologie des arêtes** (référence `programToMermaid.ts:60-110`)
- Flux `+` only → cloud → flow → stock(s)
- Flux `-` only → stock(s) → flow → cloud
- Flux mixte → stock sources → flow → stock destinations

**Omissions visuelles**
- Pas de label `+/−` sur arêtes.
- Pas de boucle nommée (R1, B1).
- Pas de marquage de délai (`||`).
- Pas d'unité physique.
- `calc`/`constant`/`map` n'apparaissent pas du tout sur le diagramme.

### 1.3 Rendu visuel — résultats de simulation

Composant `Chart.tsx`, SVG manuel 880×360.

- Line chart temporel multi-séries, axe x ticks intelligents (`niceTicks`), y auto-scaled.
- Baseline pointillée si y-range contient 0.
- Hover crosshair + tooltip flottant Observable-style (240px, séries triées décroissant).
- End-of-line labels si ≤4 séries.
- `Compare.tsx` : une variable sur toutes variations (8 teintes cycliques `--series-1`..`--series-8`).
- `simulateAll` : capped à 64 variations.

**Absents** : phase plot, tornado, confidence bands, animation stock.

### 1.4 Annotations & métadonnées

Présentes : noms courts (dernière composante), couleurs sémantiques par type, modules visualisés.
Absentes : unités, polarités sur arêtes, boucles nommées, marqueurs de délai, force de couplage.

### 1.5 Stack

- React 18 + TypeScript.
- Mermaid 11 pour le diagramme (compilé en SVG).
- SVG manuel pour le chart (pas de D3, React Flow, Canvas).
- CodeMirror 6 pour l'éditeur DSL.
- Compilateur pure-fonction `@sysdyn/core` : lexer → parser → semantic → IR → runtime (RK4).
- Polarity inference par traversée AST (pas de cycle search).

**Implication** : le graphe `program.influences[]` et la polarité sont déjà compilés. Tout ajout visuel des #1, #2, #3 du gap est un travail de *rendu*, pas de *compilateur*.

---

## 2. Théorie SD — représentations visuelles canoniques

### 2.1 Causal Loop Diagrams (CLD)

**Polarité d'arc.** Deux écoles :
- `+/−` (Sterman, *Business Dynamics* 2000) : `+` = "an increase in the cause produces an increase in the effect above what it would otherwise have been", `−` symétrique. Placé près de la pointe.
- `s/o` (same/opposite, Kim, *Systems Thinker*) : moins ambigu pour non-techniciens.

**Tranche académique : `+/−`.** Richardson (1986) recommande explicitement de ne pas utiliser `s/o`. Pratique dominante : System Dynamics Review, MIT, Vensim, Stella.

**Boucles R/B.**
- Compter les liens négatifs autour du cycle. Pair → R (Reinforcing), impair → B (Balancing).
- Numérotation : `R1`, `R2`, `B1`, `B2`… dans l'ordre d'introduction au lecteur. Nom narratif fortement recommandé (`R1: word-of-mouth`).
- Position du label : centre géométrique de la boucle, dans un cadre/ovale.
- Icônes : flèche circulaire (universelle, sens horaire ou anti-horaire selon propagation), parfois doublée d'un `+` ou snowball pour R, `−` ou hourglass pour B. Pictogrammes Kim (snowball pour R, seesaw pour B) optionnels.
- Seul le couple **lettre + numéro + flèche circulaire** est universellement attendu.

**Délais sur arc causal.** Convention canonique : **double-barre `||`** à travers la flèche (Sterman). Variante : un seul trait. Powersim/Vensim parfois remplacent par le mot DELAY. Stella iThink : icône horloge. La double-barre **n'indique pas l'ordre** du délai — c'est qualitatif. Pour quantifier, passer en SFD.

**Variables exogènes vs endogènes.** Pas de convention dure. Pratiques : italique, ovale en pointillés, gris. Sterman minimise les exogènes (*"good models are highly endogenous"*).

**Limitations connues — Richardson 1986** (`Problems with causal-loop diagrams`, SDR 2(2):158-170)
1. Confusion rate-to-level vs information link.
2. Exemple "verre de bière" : un débit positif ne fait jamais baisser le niveau, donc la définition classique du `+` échoue.
3. Exemple "births → population" : une baisse des naissances ne fait pas baisser la population.

Recommandation Richardson : pour spécification *complète*, passer au SFD. Le CLD reste outil de communication et hypothèse dynamique, pas spécification.

### 2.2 Stock-and-Flow Diagrams (SFD)

**Notation Forrester (Industrial Dynamics, 1961)** — métaphore hydraulique.

| Élément | Symbole canonique | Sémantique |
|---|---|---|
| Stock (level) | Rectangle plein | Quantité accumulée, ∫ rate dt |
| Flow (rate) | Valve/bowtie sur pipe double-épaisseur | Débit |
| Source/sink | Cloud | Stock infini hors-modèle |
| Information link | Flèche fine simple, souvent courbe | Dépendance fonctionnelle |
| Auxiliary | Cercle (Forrester orig.) ou texte nu (Vensim) | Calcul intermédiaire |
| Constant | Cercle ou losange (Stella : losange = converter param) | Valeur fixe |

**Distinction critique** : double-épaisseur = matter flow ; fine = information link. Cœur de la résolution du problème de Richardson.

**Conventions par outil**

| Outil | Stock | Flow | Auxiliary | Constant | Particularité |
|---|---|---|---|---|---|
| Vensim | Box | Pipe + bowtie valve | Texte nu | Texte nu | Shadow vars en `<brackets>`, Reality Check, Units Check |
| Stella / iThink | Rectangle | Pipe + valve | Cercle | Losange (converter) | Conveyor, queue, oven (sub-types de stock); Loops that Matter |
| Powersim Studio | Rectangle | Pipe + valve | Cercle | Losange | Différencie visuellement constants/variables |
| AnyLogic | Rectangle | Pipe + valve | Cercle | Losange | Multi-paradigme (SD + ABM + DES), animations 2D/3D |
| Insight Maker | Rectangle | Pipe + valve | Cercle/ghost | — | Web open-source, supporte ABM |
| Sysdea | Rectangle | Flèche large | Texte | Texte | Web, calcul live |
| Simantics | Rectangle | Pipe + valve | Cercle | Losange | Open-source desktop, intégration Modelica |

Convergence : rectangle/pipe-valve/cloud universels. Divergence : forme des auxiliaires (cercle Stella vs texte nu Vensim).

**Délais — matériel vs information**
- **Matériel** (pipeline, conveyor, n-th order material delay) : conserve la masse. Stella `conveyor` (rectangle avec bandes). Mathématiquement = chaîne de stocks.
- **Information** (smooth, exponential smoothing) : adoucit un signal sans conserver de masse. Vensim : `SMOOTH`, `SMOOTH3`, `DELAY1`, `DELAY3`, `DELAY FIXED`.

Marquage : double-barre `||` sur arc d'information ; conveyor distinct pour matériel ; sablier ⧖ usage Stella.

**Sectors / sub-models / views**
- Vensim *views* (onglets), un modèle = N views partagées.
- Stella *modules* (sous-modèles encapsulés avec interface I/O).
- Découpage par secteur fonctionnel ou par vitesse. Sterman : ≤ ~7 stocks par view.

**Unités et initialisation**
- Stella : unités collées aux variables (`Population [people]`), dimensional consistency check.
- Vensim : champ `Units:` dans l'équation, *Units Check*.
- Initialisation parfois affichée sous le rectangle.

### 2.3 Loop dominance & analyse structurelle

- **Coloration de boucles** : dominante en saturé, autres en gris.
- **Épaisseur dynamique** : poids d'arc proportionnel à la contribution (*Loops that Matter*, Schoenberg/Hayward/Eberlein).
- **Animation temporelle** : la boucle dominante change de couleur durant la lecture du run (Stella).

Méthodes formelles
- **LEEA** — Loop Eigenvalue Elasticity Analysis (Forrester 1982, Saleh & Davidsen, Kampmann & Oliva 2006). Eigenvalues du système linéarisé × élasticité par gain de lien.
- **PPM** — Pathway Participation Metrics (Mojtahedzadeh 1996, 2008). Contribution de chaque chemin causal au changement net d'un stock.
- **LTM** — Loops That Matter (Schoenberg, Davidsen, Eberlein 2020+). Métrique single-number par boucle, animable. Implémenté dans Stella.

### 2.4 System Archetypes (Senge, Kim, Wolstenholme)

**Liste consensuelle (Senge 1990, Kim)**

| # | Archetype | Structure |
|---|---|---|
| 1 | Limits to Growth | 1 R + 1 B partageant une variable d'état ; B avec délai |
| 2 | Shifting the Burden | 2 B (symptomatique vs fondamental) + 1 R d'addiction au quick fix |
| 3 | Shifting the Burden to the Intervenor | Variante avec intervenant externe |
| 4 | Tragedy of the Commons | 2 R individuelles + 1 B collective épuisable |
| 5 | Fixes that Fail | 1 B (fix immédiat) + 1 R (effet pervers retardé) |
| 6 | Success to the Successful | 2 R couplées négativement (compétition pour ressource) |
| 7 | Escalation | 2 B en miroir (action/réaction) → R global |
| 8 | Drifting Goals | 2 B (ajuster perf vs ajuster but) → spirale baissière |
| 9 | Growth and Underinvestment | R croissance + B saturation + B sous-investissement avec délai |
| 10 | Accidental Adversaries | Coopération qui dérive en compétition |
| 11 | Attractiveness Principle | Limits to Growth multi-facteurs (Sterman) |

**Wolstenholme 2003-04** — refonte en **4 archétypes génériques** par croisement intentionnel × non-intentionnel : Underachievement, Out of Control, Relative Achievement, Relative Control. Convention visuelle : trait épais + gras pour conséquences voulues, trait fin + italique pour non-voulues.

### 2.5 Visualisations de résultats

| Visualisation | Usage |
|---|---|
| Line chart temporel | Base, multi-séries |
| Phase plot / portrait | Trajectoire (X(t), Y(t)) de deux stocks ; révèle attracteurs, cycles limites, points de selle. Flèches le long de la trajectoire, points pleins = stables, cercles = instables |
| Tornado diagram | Sensibilité déterministe one-at-a-time. Bar chart horizontal trié par amplitude |
| Confidence bounds / Monte Carlo bands | Bandes 50/75/95/100% autour du run nominal, N runs avec inputs aléatoires |
| Comparative scenarios | Plusieurs runs (baseline + perturbations) superposés |
| Behavior pattern signatures | Reconnaissance qualitative : exponential growth (R seul), goal-seeking (B seul), S-curve (R+B sans délai), oscillation (B + délai), overshoot-and-collapse. MIT D-4480, D-4476 |
| Loop dominance over time | Stacked area de contribution de chaque boucle |
| Animated stock visualization | Rectangle qui se remplit, jauge, niveau d'eau (AnyLogic, Stella *flying icons*) |

### 2.6 Subscripts / arrays / dimensions

- **Vensim** subscripts (`Region: North, South, East, West`), fonctions `SUM`, `VMAX`, `VMIN`.
- **Stella** arrays, visualisation tableau.
- **Powersim** array dimensions.

Vues : *compressed* (apparaît une fois avec `[Region]`) ou *exploded* (N copies, illisible au-delà de quelques éléments).

Cas d'usage : cohortes d'âges, régions, gammes de produits, classes de risque.

### 2.7 Méthodologie amont (souvent oubliée)

- **Reference modes** : graphique manuel du comportement attendu/observé sur l'horizon de simulation, avant modélisation. Sterman : *"if you can't draw a reference mode, you don't have a problem"*.
- **Dynamic hypothesis** : théorie verbale + CLD initial expliquant comment la structure génère le reference mode. Output de la *conceptualization*.
- **Boundary diagram** : tableau 3 colonnes endogène / exogène / exclu. Sterman l'érige en livrable systématique.
- **Subsystem diagram** : vue macro des blocs principaux et flux d'info/matière, sans détail intra-bloc.
- **Dimensional consistency checking** : `[unit_LHS] = [unit_RHS]` pour chaque équation. Critique au-delà de ~50 variables.
- **Behavior over time graph (BOTG)** : graphique manuel en début de session (Kim) pour aligner les mental models.
- **Iceberg model** (Senge) : *events / patterns / structure / mental models*. Pas un diagramme SD au sens strict.

### 2.8 Synthèse des écoles divergentes

| Question | École A | École B | Tranche |
|---|---|---|---|
| Polarité CLD | `+/−` (Sterman, Richardson) | `s/o` (Kim) | `+/−` dominant |
| Forme auxiliaires | Cercle (Stella, Forrester orig.) | Texte nu (Vensim) | Pas de consensus |
| Forme constants | Losange (Stella) | Texte nu (Vensim) | Pas de consensus |
| CLD spécifie-t-il la structure ? | Oui (pratique courante) | Non, seul SFD le fait (Richardson 1986) | **Non** académique |
| Archétypes : 8-10 ou 4 génériques ? | 8-10 pédagogique (Senge, Kim) | 4 analytique (Wolstenholme) | Co-existence |
| Délai sur arc | Double-barre `\|\|` | Mot DELAY ou icône | **Double-barre** dominant |

---

## 3. Gap analysis

| # | Dimension SD canonique | État SystemDiagram v2 | Gap | Sévérité |
|---|---|---|---|---|
| 1 | Polarité d'arc `+/−` | Inférée (`polarity.ts`), non affichée | Affichage manquant — l'info existe déjà côté IR | 🔴 Critique |
| 2 | Boucles R/B + label R1/B1 au centre | Aucune détection de cycle, aucun label | Détection cycles sur `influences[]` puis classification (compter les `−`) | 🔴 Critique |
| 3 | Délais marqués `\|\|` sur arcs | `smooth`/`delay3` désucrés en stocks synthétiques invisibles | Garder un tag "délai" sur les arcs concernés et tracer la double-barre | 🟠 Important |
| 4 | Forme canonique des flows : valve/bowtie sur pipe double-épaisseur | Losange Mermaid | Cosmétique — Mermaid ne supporte pas la valve. Acceptable comme proxy, à documenter | 🟡 Mineur |
| 5 | Cloud = source/sink | ✅ Présent | Aligné | ✅ |
| 6 | Stock = rectangle | ✅ Présent | Aligné | ✅ |
| 7 | Distinction matter flow vs information link (cœur du fix Richardson 1986) | Tous les arcs ont la même épaisseur | Pas de moyen direct dans Mermaid d'épaissir un sous-ensemble d'arcs | 🟠 Important |
| 8 | Variables auxiliaires (constants, calcs, lookups) avec forme distincte | `constant`, `calc`, `map` existent mais n'apparaissent pas dans le diagramme | Manque entier de la couche auxiliaires sur le diagramme | 🔴 Critique |
| 9 | Sectors/views/modules visuels | ✅ `module` rendu en `subgraph` | Aligné | ✅ |
| 10 | Unités physiques affichées | Aucune syntaxe d'unité dans le DSL | Ajout DSL + dimensional consistency check | 🟠 Important |
| 11 | Initialisation visible sous le stock | Définie dans le DSL, pas affichée | Ajout dans `programToMermaid` | 🟡 Mineur |
| 12 | Reference modes | Absent | Zone "expected behavior" comparable au run simulé | 🟠 Important |
| 13 | Boundary diagram (endogène/exogène/exclu) | Toute variable est endogène par défaut | Tag DSL `exogenous` + rendering distinct | 🟡 Mineur |
| 14 | Dynamic hypothesis / CLD initial | L'outil saute direct au SFD | Mode "CLD only" qui cache flows et auxiliaires | 🟡 Mineur |
| 15 | System archetypes comme templates | Aucun | Galerie `examples/` du DSL plutôt que feature de rendu | 🟡 Mineur (didactique) |
| 16 | Phase plot (X(t), Y(t)) | Line chart temporel uniquement | Ajout dans `Chart.tsx` — réutilise les séries simulées | 🟠 Important |
| 17 | Tornado / sensibilité one-at-a-time | `sweep` simule mais affiche courbes superposées (Compare.tsx) | Calcul bar-chart des amplitudes sur les sweeps existants | 🟠 Important |
| 18 | Confidence bounds / Monte Carlo | Aucun tirage stochastique | Extension `sweep` → `montecarlo` avec distribution sur constants | 🟠 Important |
| 19 | Behavior pattern signatures (S-curve, oscillation, overshoot) | Aucun matching | Optionnel ; pédagogique mais hors scope v1 | 🟡 Mineur |
| 20 | Loop dominance over time (LTM, LEEA, PPM) | Aucun | Coûteux : analyse linéarisée. Hors scope tant que (1) et (2) ne sont pas faits | 🔴 Critique long-terme |
| 21 | Subscripts / arrays (cohortes, régions, produits) | Aucun ; duplication manuelle | Limitation forte démographie/multi-régions. Lourd (sémantique DSL) | 🟠 Important |
| 22 | Animated stock visualization (rectangle qui se remplit) | Absent | Fort impact pédagogique, faible coût | 🟡 Mineur |
| 23 | Dimensional consistency check au compilateur | Absent (pas d'unités) | Suit (10) | 🟠 Important |
| 24 | `smooth`/`delay3` ordre du délai non distingué visuellement | Désucré, donc invisible | Marquer `\|\|` (info) ou `\|\|\|` (matériel) sur l'arc | 🟠 Important |

### 3.1 Lecture du gap — trois clusters

**Cluster 1 — visualisation structurelle incomplète (critique).** L'outil compile l'information *causale* (polarités, influences, dépendances) mais ne l'affiche pas. Items #1, #2, #3, #8, #24 partagent une racine commune : la couche `programToMermaid.ts` ne consomme qu'une fraction de l'IR. Tout est déjà dans `program.influences[]` et `polarity.ts`. C'est un travail de *rendu*, pas de *compilateur* — typiquement quelques centaines de lignes pour rattraper Vensim/Stella sur ces points.

**Cluster 2 — résultats de simulation pauvres en formats (important).** Phase plot (#16), tornado (#17), Monte Carlo bands (#18), animation stock (#22) sont tous des ajouts *additifs* dans `Chart.tsx` ou un nouveau composant frère. Aucun ne nécessite de toucher au compilateur. Le phase plot a le meilleur ratio impact/coût.

**Cluster 3 — démarche de modélisation amont absente (didactique).** Reference modes (#12), boundary diagram (#13), dynamic hypothesis (#14), archétypes (#15) sont des artefacts de la *méthodologie SD*, pas du modèle simulé. Ils relèvent plus de *templates*, *exemples*, et *modes d'édition* que de fonctionnalités du moteur.

**Limite assumée : Mermaid plafonne le rendu structurel.** La distinction matter-flow / information-link (#7) — au cœur de la résolution du problème de Richardson 1986 — exige des arcs à épaisseur différenciée et des valves bowtie. Mermaid n'offre ni l'un ni l'autre. Si fidélité Forrester complète visée un jour, migrer vers React Flow / Cytoscape / SVG manuel pour le diagramme structurel. Pas urgent : la sémantique est correcte, c'est l'iconographie qui est appauvrie.

---

## 4. Recommandations priorisées

**P0 — impact maximal, coût modéré, infra déjà là**
- Afficher polarités `+/−` sur arcs (#1) — le compilateur les a déjà.
- Détecter cycles + nommer les boucles R1/B1 au centre (#2).
- Faire apparaître `calc`/`constant`/`map` comme nœuds distincts (#8) — sinon le diagramme cache la structure de l'information.
- Marquer délais avec `||` sur arcs concernés (#3, #24) — désucrer en gardant un tag.

**P1 — extension de Chart.tsx, coût faible**
- Phase plot (#16) : un toggle "X = stock A, Y = stock B" sur la vue résultats.
- Tornado sur sweeps existants (#17).

**P2 — méthodologie, faible code**
- Tag `exogenous` dans le DSL + rendu distinct (#13).
- Section `expected_behavior` dans le DSL → reference mode comparé (#12).
- Galerie d'archétypes en `examples/` (#15).

**P3 — gros chantier, pas avant P0**
- Migration Mermaid → React Flow/Cytoscape pour la distinction matter/info link (#7) et icônes Forrester fidèles (#4).
- Subscripts/arrays (#21) — refonte sémantique DSL.
- Loops that Matter / LEEA (#20) — recherche.

**Verdict en une phrase : le compilateur est plus mature que le rendu. La majorité des gaps critiques sont des occasions ratées d'afficher de l'information que l'IR contient déjà.**

---

## 5. Sources

### Théorie SD
- [Sterman 2000 — Business Dynamics (PDF complet)](https://faculty.sites.iastate.edu/tesfatsi/archive/tesfatsi/SystemDynamics.JohnSterman2001.pdf)
- [Richardson 1986 — Problems with causal-loop diagrams](https://onlinelibrary.wiley.com/doi/10.1002/sdr.4260020207)
- [Richardson 1997 — Problems in causal loop diagrams revisited](https://onlinelibrary.wiley.com/doi/abs/10.1002/(SICI)1099-1727(199723)13:3%3C247::AID-SDR128%3E3.0.CO;2-9)
- [Wolstenholme 2003 — Towards a core set of archetypal structures](https://onlinelibrary.wiley.com/doi/abs/10.1002/sdr.259)
- [Wolstenholme 2004 — Using generic system archetypes](https://onlinelibrary.wiley.com/doi/abs/10.1002/sdr.302)
- [Mojtahedzadeh 2008 — Pathway participation vs eigenvalue analysis](https://onlinelibrary.wiley.com/doi/10.1002/sdr.399)
- [Schoenberg, Hayward, Eberlein 2024 — Loops that Matter](https://onlinelibrary.wiley.com/doi/abs/10.1002/sdr.1754)
- [Goncalves 2006 — Eigenvalue and eigenvector analysis](https://proceedings.systemdynamics.org/2006/proceed/papers/GONCA394.pdf)

### Conventions
- [Wikipedia — Causal Loop Diagram](https://en.wikipedia.org/wiki/Causal_loop_diagram)
- [Wikipedia — System Archetype](https://en.wikipedia.org/wiki/System_archetype)
- [Wikipedia — Phase portrait](https://en.wikipedia.org/wiki/Phase_portrait)
- [Wikipedia — Tornado diagram](https://en.wikipedia.org/wiki/Tornado_diagram)
- [Transentis — Causal Loop Diagrams](https://www.transentis.com/page/causal-loop-diagrams)
- [Transentis — Stock and Flow Diagrams](https://www.transentis.com/page/stock-and-flow-diagrams)
- [The Systems Thinker — Fine-Tuning Your Causal Loop Diagrams](https://thesystemsthinker.com/fine-tuning-your-causal-loop-diagrams-part-i/)
- [Daniel Kim — Systems Archetypes Basics (PDF)](https://thesystemsthinker.com/wp-content/uploads/2016/03/Systems-Archetypes-Basics-WB002E.pdf)
- [Saybrook — Eight System Archetypes](https://www.saybrook.edu/unbound/systems-archetypes/)

### Outils
- [Vensim — Stock and Flow Diagrams](https://www.vensim.com/documentation/usr05.html)
- [Vensim — Conventions](https://www.vensim.com/documentation/20390.html)
- [Vensim — Defined & Shadow Variables](https://www.vensim.com/documentation/22890.html)
- [Vensim — System Dynamics Process](https://www.vensim.com/documentation/21360.html)
- [isee systems — Stocks (Stella v10)](https://www.iseesystems.com/resources/help/v10/Content/Reference/Building%20blocks/Stocks.htm)
- [AnyLogic — System Dynamics](https://www.anylogic.com/use-of-simulation/system-dynamics/)
- [System Dynamics Society — Core Software](https://systemdynamics.org/tools/core-software/)

### Méthodologie
- [MIT OCW — Building a System Dynamics Model (D-4597)](https://ocw.mit.edu/courses/15-988-system-dynamics-self-study-fall-1998-spring-1999/1ba2bda320cfc48c71d04cb2cf42409b_building.pdf)
- [MIT OCW — Dynamic Hypotheses](https://ocw.mit.edu/courses/15-875-applications-of-system-dynamics-spring-2004/b60c8e4935577463257f1bdfef5720e7_handout3.pdf)
- [MIT OCW — Exploring S-Shaped Growth (D-4476)](https://ocw.mit.edu/courses/15-988-system-dynamics-self-study-fall-1998-spring-1999/9ff8f09cd17e29b0fa91885f82165353_exploring.pdf)
- [MIT OCW — Overshoot and Collapse (D-4480)](https://ocw.mit.edu/courses/15-988-system-dynamics-self-study-fall-1998-spring-1999/e8bd0c07ef2848b39e55fc8ff52dcb88_generic3.pdf)
- [Boundary Concepts in System Dynamics (SDS proc. 2014)](https://proceedings.systemdynamics.org/2014/proceed/papers/P1175.pdf)
