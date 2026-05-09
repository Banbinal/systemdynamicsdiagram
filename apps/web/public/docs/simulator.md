# Simulator guide

A tour of every panel, tab, and control in the workbench.

## The two-pane layout

The header is at the top: model picker, status indicator (compile + simulate elapsed time), Share, Export PDF, Import/Export XMILE, Docs, skill download.

The main area is split:

- **Left pane** — source editor with diagnostics strip on top. Edit the `.sd` source; errors and warnings appear inline within ~200 ms of typing.
- **Right pane** — tabbed view of compilation outputs. The available tabs depend on what the model declares.

## The right-pane tabs

### Model

The stock-and-flow diagram, rendered with React Flow. This is where the model's structure is visible.

#### Conventions

| Shape | Meaning |
|---|---|
| Rectangle (white, black border) | Stock |
| Hexagon (beige, brown border) | Flow |
| Small grey circle | Cloud (source/sink at the model boundary) |
| Rounded rectangle | Calc |
| Diamond | Constant |
| Diamond with dashed border + "exo" badge | Exogenous constant |
| Parallelogram | Map (lookup table) |

| Edge | Meaning |
|---|---|
| Thick warm-tan, plain | Matter flow (cloud → flow → stock or stock → flow) |
| Thin green with `+` | Information link, positive polarity |
| Thin red with `−` | Information link, negative polarity |
| Thin grey dashed with `?` | Information link, ambiguous polarity (multiplication of two non-constants, etc.) |
| Any info-link with `‖` | Goes through a `smooth` or `delay3` delay |

Modules show as faintly-bordered clusters with a small uppercase label.

#### Toolbar

Above the diagram:

- **SFD / CLD** — switch between stock-and-flow view (default) and a collapsed causal-loop view that hides flows + clouds.
- **Show auxiliaries** — toggle calcs/constants/maps on or off.
- **Time scrubber** — only appears once a simulation result is available. Drag to step through time; press play/pause to auto-advance through the run in ~4 seconds.

#### What's animated

- **Stock gauges** fill from the bottom up at each scrubber position, with the same colour as the stock's chart line.
- **Matter-flow arcs** dash forward at a speed proportional to the flow's current rate (zero rate = no movement).
- **Loop highlight** — the dominant feedback loop at the current scrubber time gets thicker, brighter strokes on its arcs. Synchronised with the "dominant" badge in the Loops sidebar.

#### React Flow controls

Bottom-left corner. Zoom in/out, fit-to-view. Pan by dragging the canvas. The diagram lays itself out via ELK; you can't manually drag nodes (avoids accidentally messing up a generated layout).

#### Causal Lens

Click any node. A floating panel opens top-right showing:

- The variable's **kind badge** (stock / flow / calc / constant / map).
- A small **sparkline** of its time series across the whole run.
- **Inputs** — for flows the SFD-correct sources from `flowInputs[]`; for everything else the incoming `influences[]`. Each entry is a clickable button that navigates the lens to that variable.
- **Affects** — outgoing causal arcs, also clickable.

This lets you walk the causal graph step by step without losing the whole diagram.

#### The Loops sidebar (right of the diagram)

Lists every detected feedback loop in the model:

- **R** badge for reinforcing, **B** for balancing. Numbered R1, R2, B1, B2 in order of detection.
- The loop's path: each node, each edge polarity.
- A small **"dominant"** pill on whichever loop is most active at the current scrubber position.
- A **💡 Explain** button per loop. Click and Gemini (your API key, prompted on first use, stored in localStorage) returns a 2-3 sentence prose explanation of what this loop does and why.

### Simulation

The chart of stocks over time.

#### Toolbar

- **Time series / Phase plot** mode toggle.
- In phase plot mode, two axis selectors (X stock, Y stock) appear.

#### Live tweak (right of the chart)

Sliders for every `constant` in the model. Drag and the chart redraws live (re-running the simulation). Each slider:

- Auto-ranges from `0` to `2× initial value` (or symmetric for negatives).
- Shows the current value next to the slider.
- A small ↺ button per row resets that constant to its declared default.
- A "Reset all (N)" button at the top clears every override.

The chart's title sub-label gains a `· live tweak (N)` tag whenever overrides are active.

#### Hover

Hovering over the chart snaps to the nearest time index and shows a vertical crosshair, a dot per visible series, and a floating tooltip listing every series's value at that instant (sorted descending).

#### Reference modes

If the model declares any `reference <Stock>: (t, v) ...` blocks, those points are drawn as a dashed overlay on the chart with the same colour as the stock's solid line. Open circles mark each declared point. Useful for visually checking how close the simulation gets to expected/observed behaviour.

#### Phase plot

When toggled on, the chart switches to plotting one stock against another in state space:

- The trajectory is drawn as ~N short segments with progress-based opacity (faint at the start, full at the end). A small triangular arrowhead at ~75% along reinforces direction.
- Start and end are marked with an open and a filled circle respectively.
- Hover snaps to the nearest data point and shows `(t, X, Y)`.

Reveals dynamical features invisible on the time chart — closed orbits (Lotka-Volterra), spiral attractors, fixed points, bifurcations.

### Compare

Visible only when the model declares ≥ 1 scenario or sweep. Shows one chart per stock with all variations overlaid. Each variation is a single line with its own cyclic colour.

The variation list at the top of the panel acts as a legend (toggle visibility per variation).

### Checks

Visible only when the model declares ≥ 1 `check` block. Lists every check with a pass/fail/error badge.

For each check:

- **PASS (green ✓)** — assertion held throughout (`always`) or at the specified time (`at t=N`). Shows the final values of lhs and rhs.
- **FAIL (red ✗)** — assertion failed at some step. Shows `t`, `lhs ↛ rhs`.
- **ERROR (orange !)** — the simulation aborted (NaN, missing data, etc.) before the check could be evaluated.

Each check runs an isolated simulation with its `when` overrides applied — they don't share state with the base run or with each other.

### Sensitivity

Visible only when the model declares ≥ 1 `sweep`. The Tornado chart: for each swept parameter, the model is run at the parameter's low and high (other sweeps held at their first value), and the resulting swing on the chosen output metric is plotted as a horizontal bar.

Bars are sorted by `|swing|` descending — the canonical tornado shape where the most influential parameter sits on top.

Selectors:

- **Focus stock** — which stock's metric to evaluate.
- **Metric** — final value, peak, trough, integral over time, or mean `|dStock/dt|`.

The vertical dashed line is the baseline (output value when every sweep is at its first value). Green = above baseline, red = below.

### Calibrate

Visible only when the model declares a `calibrate:` block. Shows the parameters being calibrated, the current bounds, and a **Run calibration** button.

When you run it:

- Nelder-Mead (200 iterations max, 1e-4 tolerance) minimises RMSE between the simulated trajectory and every `reference` mode's points.
- The result table shows initial → fitted values, with a small range bar showing where the fitted value sits within the declared bounds.
- "RMSE before / after" makes the improvement quantitative.
- An **Apply to live tweak** button pushes the fitted values into the SyntheSim sliders and switches to the Simulation tab so you can see the chart redrawn against the calibrated parameters.

## The header

Left to right:

- **SYSDYN** wordmark.
- **Model** picker — switches between the bundled examples. Your edits are scoped per slot, so you can have a different model loaded in each example slot during a session.
- **Status pill** — current state (idle / running / live / error) plus elapsed simulate time + step count.
- **Share** — generates a signed JWT containing the source, rewrites the URL hash, copies the URL to the clipboard. Anyone you send it to opens a tab with your model loaded.
- **Export PDF** — print-friendly snapshot of the model: diagram, simulation chart, comparison charts (if any), terminal values, diagnostics, full source as an annex.
- **Import XMILE** — file picker accepting `.xmile`, `.stmx`, `.xml`. Imports models from Stella, Insight Maker, Simlin, PySD into the current slot.
- **Export XMILE** — downloads the current model as XMILE for use elsewhere.
- **Docs** — opens this documentation.
- **Skill (.zip)** — downloads the Claude Code skill bundle (see "For LLMs" doc).

## Embedding

Append `?embed=1` to the URL and the header + editor disappear, leaving just the right pane. Designed to drop into a host page via `<iframe>`. Add `?embed=1&tab=simulation` to pre-select a tab. A small "↗ Open in editor" link in the top-right corner lets readers break out to the full app.

Useful for teaching pages, blog posts, stakeholder demos.

## Sharing details

The Share button produces a URL of the form `https://banbinal.github.io/systemdynamicsdiagram/#t=<JWT>`. The JWT contains the deflate-compressed source. Decoded natively in the browser via `DecompressionStream` — no server round-trip. Typical URLs: 1-3 kB.

The URL is copied to your clipboard and rewritten into the address bar simultaneously. Both surface signal that the share worked.

## Diagnostics

The strip above the editor shows compile + simulate diagnostics. Click any diagnostic to jump to the offending line. Errors block simulation; warnings (e.g. units mismatches) don't.
