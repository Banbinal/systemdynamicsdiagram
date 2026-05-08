/**
 * Bundled example models. Each is loaded at build time as a raw string via
 * Vite's `?raw` import. Order is curated: simple ramp-up first, then the
 * canonical SD textbook models (predator-prey, SIR, supply chain), then the
 * applied multi-module models.
 */

import simplePopulation from '../../../examples/v2/simple_population.sd?raw';
import loanPayoff from '../../../examples/v2/loan_payoff.sd?raw';
import predatorPrey from '../../../examples/v2/predator_prey.sd?raw';
import sirEpidemic from '../../../examples/v2/sir_epidemic.sd?raw';
import supplyChain from '../../../examples/v2/supply_chain.sd?raw';
import populationModel from '../../../examples/v2/population_model.sd?raw';
import businessGrowth from '../../../examples/v2/business_growth.sd?raw';
import economicModel from '../../../examples/v2/economic_model.sd?raw';
import archetypeLimitsGrowth from '../../../examples/v2/archetype_limits_to_growth.sd?raw';
import archetypeShiftingBurden from '../../../examples/v2/archetype_shifting_burden.sd?raw';
import archetypeTragedyCommons from '../../../examples/v2/archetype_tragedy_commons.sd?raw';
import archetypeFixesThatFail from '../../../examples/v2/archetype_fixes_that_fail.sd?raw';
import archetypeDriftingGoals from '../../../examples/v2/archetype_drifting_goals.sd?raw';

export interface Example {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly source: string;
}

export const EXAMPLES: readonly Example[] = [
  { id: 'simple_population', slug: 'simple-population', title: 'Simple Population',     source: simplePopulation },
  { id: 'loan_payoff',       slug: 'loan-payoff',       title: 'Loan Payoff',           source: loanPayoff },
  { id: 'predator_prey',     slug: 'predator-prey',     title: 'Predator-Prey · LV',    source: predatorPrey },
  { id: 'sir_epidemic',      slug: 'sir-epidemic',      title: 'SIR Epidemic',          source: sirEpidemic },
  { id: 'supply_chain',      slug: 'supply-chain',      title: 'Supply Chain · Bullwhip', source: supplyChain },
  { id: 'population_model',  slug: 'population',        title: 'Population & Economy',  source: populationModel },
  { id: 'business_growth',   slug: 'business-growth',   title: 'Business Growth',       source: businessGrowth },
  { id: 'economic_model',    slug: 'economic-model',    title: 'Economic Model',        source: economicModel },
  // ── System archetypes (Senge / Kim) — pedagogical templates ───────────
  { id: 'arch_limits_growth',   slug: 'arch-limits-to-growth',   title: 'Archetype · Limits to Growth',     source: archetypeLimitsGrowth },
  { id: 'arch_shifting_burden', slug: 'arch-shifting-the-burden', title: 'Archetype · Shifting the Burden',  source: archetypeShiftingBurden },
  { id: 'arch_tragedy_commons', slug: 'arch-tragedy-of-commons', title: 'Archetype · Tragedy of Commons',   source: archetypeTragedyCommons },
  { id: 'arch_fixes_that_fail', slug: 'arch-fixes-that-fail',    title: 'Archetype · Fixes that Fail',      source: archetypeFixesThatFail },
  { id: 'arch_drifting_goals',  slug: 'arch-drifting-goals',     title: 'Archetype · Drifting Goals',       source: archetypeDriftingGoals },
];

export const DEFAULT_EXAMPLE = EXAMPLES[0]!;
