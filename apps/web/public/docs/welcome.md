# Welcome to SYSDYN

A web-based **System Dynamics workbench** — write a model in a small text-based DSL, simulate it instantly, and explore behaviour through interactive charts, gauges, sensitivity panels, and reality checks.

Designed to feel like an IDE for the SD modeller: type, see the diagram update live, run, scrub through time, change parameters with sliders, share with a link.

## What you get

The simulator covers the canonical System Dynamics toolchain plus a few features that are normally locked behind expensive desktop tiers (Vensim DSS, Stella Architect):

- **Stocks, flows, calcs, constants, maps, modules** — the standard SD primitives.
- **Stock-and-flow diagram** with live polarity, R/B loop detection, animated matter flow, gauges showing each stock's level over time.
- **Causal Loop view** (CLD toggle) collapsing the SFD plumbing into a pure causal arc graph.
- **Causal Lens** — click any node to drill into its time series and inputs.
- **Time scrubber + playback** — replay a run step by step. The dominant feedback loop highlights as time advances.
- **Live tweak (SyntheSim)** — sliders on every constant; the chart redraws as you drag.
- **Phase plot** — trajectory of any two stocks in state space.
- **Sensitivity (tornado)** — one-at-a-time parameter swings, ranked by amplitude.
- **Scenarios + sweeps** — declare alternatives in the DSL, compare them side by side.
- **Reality Check** — assertion-based model validation à la Vensim DSS.
- **Calibration** — fit constants to observed data via Nelder-Mead.
- **Reference modes** — overlay your expected behaviour on the simulated curve.
- **Subscripts** — write the same structure once, expand it across cohorts/regions/products.
- **Units annotations** — optional `[unit]` tags with dimensional consistency checks.
- **AI loop explanation** — bring your own Gemini key, get an LLM explanation of any detected loop.
- **PDF export** + **share link** + **embed iframe** + **XMILE import/export** for interop with Stella, Insight Maker, Simlin, PySD.

## Who it's for

- **Modellers** who want a faster feedback loop than Vensim/Stella, without giving up rigour.
- **Educators** who want students to share runnable models in a tab.
- **Consultants** who want a stakeholder-facing simulator in a `?embed=1` iframe.
- **Researchers** doing exploratory dynamics work who want to stay in a browser.

## Getting started in 30 seconds

1. The model selector in the header has a dozen examples — pick **Simple Population** to start.
2. The right pane shows three tabs: **Model** (the diagram), **Simulation** (the chart), and **Compare** (when you have scenarios). When the model declares them, you'll also see **Checks**, **Sensitivity** and **Calibrate** tabs.
3. Switch to **Simulation** and drag a slider in the right-hand "Live tweak" panel — the chart redraws live.
4. Press the play button on the time scrubber above the diagram (Model tab) — watch matter flow through the diagram.
5. Click the **Share** button in the header. You get a URL with the entire model embedded in the JWT — anyone you send it to opens a tab with your model loaded.
6. Edit the source in the left pane. Errors appear inline; the right pane updates within 200 ms.

## How the rest of these docs are organised

- **DSL guide** — the language. Stocks, flows, calcs, modules, scenarios, sweeps, the time-aware builtins, the polarity arrows, indentation rules.
- **Simulator guide** — every tab, every control, every diagram convention, every panel. The behavioural tour.
- **Discipline features** — the methodology stack. When and why to add `reference` modes, `check` assertions, `calibrate`, `[unit]` annotations, `exogenous` tags, `subscript` dimensions.
- **For LLMs** — the bundled Claude Code skill. Download it as a zip, drop it in `~/.claude/skills/`, and Claude can write `.sd` models for you and hand back signed share links.

You can also peek at the **gap analysis** in the source repository (`docs/sd-theory-gap.md` and `docs/sd-gap-analysis-v2.md`) — they catalogue what's shipped, what remains, and the mapping to canonical SD theory + the competitive landscape.

---

If you came here from a share link and just want to *use* the model someone sent you: ignore the rest of these docs. Switch to the **Simulation** tab and start dragging sliders.
