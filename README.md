# systemdiagram

System Dynamics tooling — a clean DSL, a deterministic simulator, and a reference web app.

> **Status:** v2 refactor in progress. The original web app is preserved at `apps/legacy-web/` and remains functional. The new TypeScript core is being built under `packages/`.

## Repository layout

```
systemdiagram/
├─ apps/
│  └─ legacy-web/          # Original web app (v1.2/v1.3) — vanilla JS, kept working
├─ packages/
│  ├─ core/                # @sysdyn/core — DSL parser, compiler, simulator (TS, no DOM)
│  └─ cli/                 # @sysdyn/cli — `sysdyn run model.sd --csv out.csv`
└─ examples/v2/            # System Dynamics models in the v2 grammar
```

## Quick start

Requirements: Node ≥ 20, pnpm 10.

```bash
pnpm install
pnpm test          # run the new core's test suite
pnpm build         # build all packages
```

## The DSL (v2)

System Dynamics models describe the world as **stocks** (state) and **flows** (rates of change), with **calcs** (auxiliary expressions) connecting them. Example:

```
StartTime = 0
EndTime   = 10
TimeStep  = 0.1

stock Population = 1000
constant BirthRate = 0.03
constant DeathRate = 0.01

flow Births:
    Population * BirthRate -+> Population

flow Deaths:
    Population * DeathRate --> Population
```

The full grammar lives in [`packages/core/docs/grammar.md`](packages/core/docs/grammar.md) (in progress).

## License

MIT — see [LICENSE](LICENSE).
