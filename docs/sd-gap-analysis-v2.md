# Gap analysis v2 — théorie SD + paysage compétitif (mai 2026)

Successeur de [`sd-theory-gap.md`](./sd-theory-gap.md). L'original cataloguait 24 items de retard versus la théorie canonique au début de la vague de build. Tous ses P0/P1/P2/P3 ont été livrés, plus la liste additive issue du croisement compétitif (Reality Check, SyntheSim, calibration, etc.).

Ce document audite ce qui reste **vs la théorie**, **vs les concurrents en mai 2026**, et **ce que la frontière 2026 rend pertinent à suivre**.

> Audience : équipe outil. Style : référence dense, honnête, table-heavy.
> Date d'audit : 2026-05-09. Tour d'horizon des concurrents : confirmé par recherche web (voir §6).

---

## Table des matières

1. [Tour d'horizon — état au 2026-05-09](#1-tour-dhorizon--état-au-2026-05-09)
2. [Gap résiduel vs théorie SD canonique](#2-gap-résiduel-vs-théorie-sd-canonique)
3. [Gap résiduel vs compétiteurs](#3-gap-résiduel-vs-compétiteurs)
4. [Frontière 2026 — ce qui a bougé en SD ce trimestre](#4-frontière-2026--ce-qui-a-bougé-en-sd-ce-trimestre)
5. [Recommandations priorisées v2](#5-recommandations-priorisées-v2)
6. [Sources](#6-sources)

---

## 1. Tour d'horizon — état au 2026-05-09

### 1.1 Ce qui a été livré depuis v1

Les chantiers shippés depuis le gap analysis v1, dans l'ordre conceptuel.

| Catégorie | Feature | Origine | Item v1 |
|---|---|---|---|
| **Visuel structurel** | Polarité `+/−/?` sur arcs, colorée | Théorie | #1 |
| | Auxiliaires (calc/constant/map) comme nœuds distincts | Théorie | #8 |
| | Détection cycles + R/B + numérotation R1/B1 | Théorie | #2 |
| | Marqueurs `‖` sur arcs délais | Théorie | #3, #24 |
| | Modules visibles (encadrés pointillés) | — | déjà partiel v1 |
| | Clouds rapprochés des stocks | Polish | post-v1 |
| **Rendu live** | Migration Mermaid → React Flow + ELK | Théorie | #7 (partiel) |
| | Jauges de stock | Cross-analyse | bonus |
| | Scrubber temporel + playback | Cross-analyse | bonus |
| | Animation matter-flow (vitesse ∝ rate) | Cross-analyse | bonus |
| | Animation dominance loop (LTM-lite) | Théorie | #20 |
| | Causal Lens (clic → variable + inputs) | Cross-analyse | Stella |
| **Analyse résultats** | Phase plot (X(t), Y(t)) | Théorie | #16 |
| | Tornado sensibilité one-at-a-time | Théorie | #17 |
| | Loops sidebar avec path détecté | Théorie | #2 |
| **Méthodologie** | `reference` modes + overlay chart | Théorie | #12 |
| | `exogenous constant` + badge | Théorie | #13 |
| | Toggle SFD ↔ CLD | Théorie | #14 |
| | Galerie 5 archétypes (Senge/Kim) | Théorie | #15 |
| **Validation** | Reality Check assertions (DSL `check`) | Cross-analyse | Vensim DSS |
| **Calibration** | Nelder-Mead vs reference modes | Cross-analyse | Vensim/BM |
| **Interactivité** | SyntheSim sliders (live re-sim) | Cross-analyse | Vensim |
| **Sémantique DSL** | Subscripts 1D + array literals | Théorie | #21 |
| **Interop** | XMILE import / export | Cross-analyse | Stella/Simlin/PySD |
| **IA** | AI loop explanation (Gemini BYOK) | Cross-analyse | Stella 4.x |
| **Diffusion** | Embed iframe `?embed=1` | Cross-analyse | Loopy |
| **Sortie** | PrintReport via React Flow (drop Mermaid) | Polish | bundle −570 KB |

**Compteur de tests** : 260 + 43 = **303 tests** verts dans `@sysdyn/core` + `@sysdyn/cli`. Bundle web : **2,4 MB** (était 1,3 MB → 3,0 MB pic post-Mermaid → 2,4 MB après son retrait).

### 1.2 Positionnement résultant

Lecture honnête après cette vague :

- **Vs outils web concurrents** (Insight Maker, Sysdea, Simlin, Loopy) : nous sommes **en avance** sur la rigueur (Reality Check assertions, calibration), l'analyse (tornado, phase plot, loop dominance), et l'IA (explication boucles). Légèrement en arrière sur l'écosystème social (galerie publique de modèles, fork culture façon Insight Maker).
- **Vs Vensim PLE** : parité sur l'éditeur, **dépassement** sur l'IA et le rendu interactif (SyntheSim live + animation flux).
- **Vs Vensim DSS** : encore en-dessous sur l'optimisation avancée multi-méthode (LM gradient, contraintes), l'analyse Monte Carlo / Latin hypercube, les subscripts multi-dim, le moteur compilé.
- **Vs Stella Architect** : parité ou dépassement sur les killer features classiques (LTM-style dominance ✓, AI explanations ✓). Manquons : conveyors / queues / ovens (matter-delay primitives), Stories (mode présentation), isee Exchange (publication-as-Sim multi-utilisateurs).
- **Vs AnyLogic** : pas comparable. Multi-paradigme (SD+ABM+DES), animations 2D/3D, scope industriel — orthogonal à notre positionnement.
- **Vs Berkeley Madonna** : en-dessous sur la vitesse pure (notre RK4 JS vs leur compilé C++). Au-dessus sur tout le reste.

---

## 2. Gap résiduel vs théorie SD canonique

### 2.1 Items du v1 non encore shippés

| # v1 | Item | Statut | Sévérité résiduelle |
|---|---|---|---|
| #4 | Iconographie valve/bowtie canonique sur les flows | Hexagone proxy ; pas de bowtie SVG | 🟡 Cosmétique |
| #7 | Distinction matter-flow vs info-link via **épaisseur double-trait** | Différenciation par couleur/épaisseur ; pas le double-trait Forrester | 🟠 Important — cœur du fix Richardson 1986 |
| #10 | Unités physiques affichées | Aucune syntaxe d'unité | 🟠 Important |
| #11 | Initialisation visible sous le rectangle stock | Définie au DSL, jamais affichée | 🟡 Mineur |
| #19 | Behavior pattern signatures (S-curve, oscillation, overshoot) | Aucun matching qualitatif | 🟡 Mineur (didactique) |
| #23 | Dimensional consistency check (compilateur) | Bloqué par #10 | 🟠 Important |

### 2.2 Lacunes théoriques que v1 avait sous-estimées

Six familles d'items qui n'apparaissaient pas (ou trop faiblement) dans v1 et qui méritent leur entrée formelle :

| Lacune | Description | Sévérité |
|---|---|---|
| **Conveyors / queues / ovens** (Stella) | Sous-types de stock pour matter-delays canoniques (chaîne FIFO, pipeline, file d'attente). Différents du `delay3` actuel — préservent la masse exacte par "tranche" plutôt qu'une approximation 3e ordre. | 🟠 Important |
| **Stories / mode présentation** | Stella Architect/Designer permet de scénariser un modèle : étapes, focus visuels, narration. Pédagogique. | 🟡 Mineur |
| **Subsystem diagram / sector map** | Vue zoom-out où chaque module/secteur est un seul nœud avec arcs d'information/matière vers les autres. Sterman l'érige en livrable amont systématique. | 🟠 Important |
| **Dynamic hypothesis comme livrable** | Section explicite dans le DSL ou un panneau dédié décrivant l'hypothèse causale du modèle (= prose + CLD initial). On peut le mettre en commentaire mais pas en first-class. | 🟡 Mineur |
| **Boundary diagram structuré** | Tableau explicite endogène / exogène / exclu. On a le tag `exogenous` mais pas le livrable tabulaire. | 🟡 Mineur |
| **Reality Check v2 — inputs synthétiques sur distributions** | Notre `when X = value` est ponctuel. Vensim DSS génère automatiquement des inputs sur une plage (pulse, ramp, random uniform / normal) et teste l'invariant. | 🟠 Important — c'est ce qui fait la valeur de Reality Check à grande échelle. |

### 2.3 Loop dominance — la version "vraie" reste à faire

Notre implémentation actuelle de la dominance utilise une approximation pragmatique (somme des `|rate|` des flows médiateurs). Les méthodes formelles de la littérature SD restent à implémenter pour être **scientifiquement défendable** :

- **LEEA** — Loop Eigenvalue Elasticity Analysis (Forrester 1982 → Saleh & Davidsen → Kampmann & Oliva 2006) : eigenvalues du système linéarisé × élasticité par gain de lien.
- **PPM** — Pathway Participation Metrics (Mojtahedzadeh 1996, 2008) : contribution de chaque chemin causal au changement net d'un stock.
- **LTM** — Loops That Matter (Schoenberg/Hayward/Eberlein 2024) : métrique single-number par boucle, plus rigoureuse que notre proxy.

Sévérité : 🔴 Long-terme — c'est l'item #20 du v1, classé critique. Notre proxy actuel est un placeholder.

---

## 3. Gap résiduel vs compétiteurs

### 3.1 Vue d'ensemble — features killer encore manquantes

| Feature | Tool source | Notre état | Sévérité |
|---|---|---|---|
| **Stella conveyors/queues/ovens** | Stella | Absent — on a `delay3` mais pas les sous-types stock | 🟠 Important |
| **Stella Stories** | Stella Architect | Absent | 🟡 Mineur |
| **Stella isee Exchange** (publish-as-Sim multi-user) | Stella | Partiellement — on a share link + embed iframe, mais pas l'authoring-as-presentation | 🟡 Mineur |
| **Stella AI Support mode** (lancé 2026-02) | Stella 4.1 | Absent — on a explain-loop mais pas chat-with-model étendu | 🟠 Important (frontière 2026) |
| **Vensim Reality Check synthesised inputs** (auto-pulse/ramp/random) | Vensim DSS | Partiel — on accepte `when` ponctuel, pas distribution | 🟠 Important |
| **Vensim SyntheSim brushing** (drag dans une chart pour faire varier la constante mappée) | Vensim | Absent — sliders dans un panneau séparé | 🟡 Mineur |
| **Vensim optimization** (Powell + LP, contraintes) | Vensim DSS | Absent — Nelder-Mead seul, pas de contraintes au-delà des bornes | 🟠 Important |
| **Vensim Monte Carlo / Latin hypercube** | Vensim PLE+ | Absent — sweep déterministe seul | 🟠 Important |
| **Vensim units check** (dimensional consistency) | Vensim, Stella | Absent — pas d'unités | 🟠 Important |
| **Powersim SAP/Excel/DB live data** | Powersim | Absent | Hors scope (B2B) |
| **AnyLogic 2D/3D animations** | AnyLogic | Absent | Hors scope |
| **AnyLogic multi-paradigme SD+ABM+DES** | AnyLogic | Absent | Hors scope |
| **Berkeley Madonna compiled solver** | Berkeley Madonna v10+ | Absent — RK4 JS interprété | 🟡 Mineur (perf rarement critique à notre échelle) |
| **Berkeley Madonna curve-fit interface** | Berkeley Madonna | ✅ équivalent (calibration Nelder-Mead) | — |
| **Insight Maker public gallery + fork** | Insight Maker | Absent — modèles partagés via JWT, pas de galerie publique | 🟡 Mineur (croissance) |
| **Insight Maker scripting layer** | Insight Maker | Absent — pas de mode programmation au-delà du DSL | 🟢 Hors-scope assumé |
| **kumu narrative-rich documentation** (markdown par élément) | kumu | Absent — on a tooltip court | 🟡 Mineur |
| **kumu SNA metrics** (centrality, betweenness sur le graphe causal) | kumu | Absent — pas d'analyse réseau | 🟡 Mineur |

### 3.2 Vue par catégorie

**Modélisation amont** : on est en parité ou au-dessus (DSL clair, modules, archétypes, exogenous). Manque dynamic hypothesis structuré (~3h de travail).

**Validation** : Reality Check ponctuelle ✅. Manque Reality Check v2 (synthesised inputs avec distributions), units check, dimensional consistency. **Block** sur les unités → toute la famille validation sérieuse est bridée.

**Analyse aval** : phase plot ✅, tornado ✅, loop dominance lite ✅, calibration Nelder-Mead ✅. Manque Monte Carlo / UQ, optimization avancée, LEEA/PPM/LTM rigoureux.

**Visualisation** : SFD interactif avec jauges + scrubber + animation flux + dominance ✅. Manque conveyor/queue rendering distinct, valve canonique bowtie, double-trait Forrester pour matter vs info.

**Interop / partage** : XMILE bidirectionnel ✅, share JWT ✅, embed iframe ✅. Manque galerie publique multi-user, isee Exchange-style publication, integration notebook (Jupyter / Observable).

**IA** : loop explanation ✅, model-from-text ✅ (BYOK Gemini). Manque chat-with-model étendu (Stella Support mode), AI-driven validation suggestions (Schoenberg SDR 2026 direction), auto-generated Reality Check candidates.

---

## 4. Frontière 2026 — ce qui a bougé en SD ce trimestre

### 4.1 Sorties / versions vendor

- **Stella 4.1 + 10.1.2.1044** (isee, mise à jour 2026-02-27) : 3e mode AI **Support** (technique, après Build et Discuss). Confirme l'axe Stella → produit centré sur l'IA. ([release notes](https://www.iseesystems.com/resources/help/v4/Content/Release_Notes.htm))
- **AnyLogic 8.9.8** (2026-02-26) : chart wizard, live 3D scene preview, model templates. Rien de SD-spécifique. ([release notes](https://anylogic.help/anylogic/introduction/release-notes.html))
- **Berkeley Madonna 10.7.9** (2026-03-02) : patch macOS uniquement. Aucune nouvelle fonctionnalité.
- **Vensim, Powersim, Sysdea, Simlin, Insight Maker, PySD** : aucun mouvement public en 2026.

→ **Conclusion** : 2026 est calme côté vendor SD historique, sauf isee qui continue d'investir dans l'IA. Le terrain reste favorable à un nouvel entrant web.

### 4.2 Recherche académique 2026 — sélection

- **Schoenberg, "Building and Learning With Models Using AI"**, *System Dynamics Review* 42(1), 2026 ([doi](https://onlinelibrary.wiley.com/doi/abs/10.1002/sdr.70019)). Méthodologie pour intégrer un LLM en co-modélisateur. Direction : passer d'AI assistant ponctuel à AI compagnon de modélisation.
- **arXiv 2604.18566** (2026) : benchmark SD AI assistants — capability gaps déterminés par architecture/backend, pas par taille du modèle. Pertinent pour notre choix d'API LLM.
- **Kapmeier et al., "Designing for Impact: Engaging Stakeholders With System Dynamics Models"**, *SDR* 42(2), 2026 ([doi](https://onlinelibrary.wiley.com/doi/10.1002/sdr.70024)). Cadre pour l'utilisation des modèles SD avec stakeholders non-techniques. Aligné avec notre direction "outil web accessible".
- **CausalDynamics** (arXiv 2505.16620) : benchmark de découverte structurale sur ODE/SDE et modèles climatiques. Pont SCM ↔ SD. À surveiller pour l'inverse problem (déduire la structure d'un modèle SD depuis les données).
- **Causal Process Models** (arXiv 2507.13920) : RL pour découvrir des graphes causaux temporels.

### 4.3 ISDC 2026 (TU Delft, 20-24 juillet)

Thème : *"Navigating uncertainty, managing instability and crafting futures together"*. La rigueur d'incertitude (= méthodes Bayesian / UQ / scenario planning) est explicitement le centre de gravité de la conférence. → notre absence de Monte Carlo / UQ devient plus saillante.

### 4.4 Probabilistic SciML & SD

- **TAMIDS Spring 2026 SciML Workshop** (29 avril 2026) : focus Bayesian priors sur ODE/SDE/DAE.
- **IMSI Probabilistic SciML programme** : centres de recherche actifs sur l'UQ pour systèmes dynamiques.

→ La calibration Bayesian (vs notre Nelder-Mead point-estimate) entre dans le mainstream. **Direction stratégique** : ajouter `bounds` avec distribution prior + retourner posterior plutôt qu'optimum point.

### 4.5 En-ROADS — la référence du segment "policy widget"

Mars 2026 : 951 Climate Ambassadors dans 91 pays, 372 000 personnes engagées ([phys.org 2026-03](https://phys.org/news/2026-03-simulation-strategy-climate-action.html)). En-ROADS reste **le** modèle SD-as-policy-tool ; pas un compétiteur direct mais un benchmark de ce que la diffusion peut atteindre.

### 4.6 Stagnation du segment "loopy/insight maker successor"

**Aucun nouveau widget iframe-embedabble lancé en 2026.** Loopy reste le standard de fait pour le CLD viral, Insight Maker pour le simulateur web open-source. Notre embed mode + share link nous met dans la conversation ; un push marketing pourrait capturer cet espace.

---

## 5. Recommandations priorisées v2

Triées par ratio impact / coût et par alignement avec les directions 2026.

### P0 — investissements stratégiques alignés sur 2026

1. **Reality Check v2 — synthesised inputs avec distributions.**
   `check X: when DeathRate ~ uniform[0, 1] then Population >= 0 always`. Génère N tirages, exécute, agrège. ~6h. Différenciateur fort : aucun outil web ne l'a, et c'est ce qui transforme `check` d'une assertion ponctuelle en un test stochastique sérieux.
2. **Monte Carlo / UQ — distributions sur les constants.**
   `monte_carlo: BirthRate ~ normal(0.05, 0.01)` puis tirages → bandes de confiance sur le chart. ~5h. Aligné avec le thème ISDC 2026 ("navigating uncertainty"). Catégorie où nous sommes en retard sur Vensim PLE+.
3. **Bayesian calibration — passer d'optimum point à posterior.**
   Réutilise le scaffold calibrate. Algorithme : Approximate Bayesian Computation (ABC) ou Metropolis-Hastings simple. ~10h. Aligné avec Probabilistic SciML wave. Différenciateur naissant.

### P1 — comblement compétitif direct

4. **Conveyors / queues** comme sous-types de stock.
   `conveyor Pipeline = 100 transit 5` avec distribution FIFO de la masse. ~6h. Comble un gap clair vs Stella sur la classe matter-delay.
5. **Units & dimensional consistency.**
   `constant BirthRate = 0.05 [1/year]` ; vérification au compile. ~8h. Débloque toute la famille validation sérieuse.
6. **Stella Support mode équivalent — chat-with-model étendu.**
   Notre AI loop explanation est isolée ; un panneau de chat persistant qui voit le modèle + les résultats + les checks. ~6h sur le scaffold AiAssistModal.

### P2 — théorie résiduelle

7. **Subsystem diagram / sector map.**
   Vue auto-générée où chaque module devient un nœud unique avec arcs agrégés. ~4h.
8. **Behavior pattern signatures.**
   Classifier qualitatif sur la simulation : exponential growth / S-curve / oscillation / overshoot-and-collapse. ~3h.
9. **Loop dominance v2 — vraie LTM.**
   Remplacer notre proxy par l'algorithme Schoenberg/Hayward/Eberlein 2024 avec partial derivatives numériques. ~8h.
10. **Optimization avancée — LM + contraintes.**
    Levenberg-Marquardt en complément de Nelder-Mead, contraintes d'égalité linéaires. ~10h.

### P3 — diffusion / ergonomie

11. **Galerie publique de modèles + fork.**
    Backend minimal (Cloudflare KV ?) pour publier un share link comme entrée d'une galerie navigable. ~8h. Aligné avec Insight Maker / kumu.
12. **Markdown documentation par élément** (hover panel, kumu-style).
    Permet d'enrichir chaque variable avec des notes / sources / vidéos. ~5h.
13. **Dynamic hypothesis section** dans le DSL.
    `hypothesis: """ ... """` comme bloc texte de premier rang affiché en haut du report. ~2h.
14. **Subscripts multi-dim** (`Trade[Origin, Destination]`).
    Refonte du expandSubscripts pour produit cartésien. ~10h. Coût élevé, audience étroite (commerce inter-régional, matrices d'âges croisées).

### P4 — long-terme / hors-scope assumé

- AnyLogic-class 3D/2D animations
- Powersim-class enterprise data bus
- Berkeley Madonna-class compiled solver
- Multi-paradigme SD+ABM+DES dans un même canvas

Ces directions restent orthogonales à notre positionnement web-cohort.

---

## 6. Sources

### Recherche compétitive 2026

- isee Systems Stella release notes : <https://www.iseesystems.com/resources/help/v4/Content/Release_Notes.htm>
- isee Stella feature updates : <https://www.iseesystems.com/store/products/feature-updates.aspx>
- AnyLogic release notes : <https://anylogic.help/anylogic/introduction/release-notes.html>
- Berkeley Madonna releases : <http://www.berkeleymadonna.com/jmadonna/jmadrelease.html>
- Vensim release notes : <https://vensim.com/documentation/release_notes.html>

### Recherche académique 2026

- Schoenberg, *SDR* 42(1), 2026 — *Building and Learning With Models Using AI* : <https://onlinelibrary.wiley.com/doi/abs/10.1002/sdr.70019>
- Kapmeier et al., *SDR* 42(2), 2026 — *Designing for Impact: Engaging Stakeholders With System Dynamics Models* : <https://onlinelibrary.wiley.com/doi/10.1002/sdr.70024>
- Sun, *SDR* 2026 — *Qualitative Meta-Analysis With System Dynamics Modeling* : <https://onlinelibrary.wiley.com/doi/10.1002/sdr.70022>
- arXiv 2604.18566 — Benchmarking SD AI Assistants : <https://arxiv.org/html/2604.18566>
- arXiv 2505.16620 — CausalDynamics : <https://arxiv.org/abs/2505.16620>
- arXiv 2507.13920 — Causal Process Models : <https://arxiv.org/html/2507.13920>

### Conférences & programmes 2026

- ISDC 2026 (TU Delft, 20-24 juillet) : <https://systemdynamics.org/event/2026-international-system-dynamics-conference/>
- TAMIDS Spring 2026 SciML Workshop : <https://sciml.tamids.tamu.edu/2026/04/24/tamids-spring-2026-sciml-workshop/>
- IMSI Probabilistic SciML programme : <https://www.imsi.institute/activities/statistical-and-computational-challenges-in-probabilistic-scientific-machine-learning-sciml/>

### Diffusion / référence

- En-ROADS Climate Ambassadors metrics 2026-03 : <https://phys.org/news/2026-03-simulation-strategy-climate-action.html>
- En-ROADS : <https://www.climateinteractive.org/en-roads/>

### Document précédent

- [`docs/sd-theory-gap.md`](./sd-theory-gap.md) — gap analysis v1 (théorie + tool initial)
