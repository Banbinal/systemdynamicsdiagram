# Annotated examples

Three complete models, each illustrating a different shape of system. Use these as structural templates — copy the *layout*, not the literal numbers.

---

## Example 1 — Logistic population with a one-off shock

**Domain:** a population that grows toward a carrying capacity, hit by a one-time die-off event.

**Modeling moves:** reinforcing loop dampened by a balancing one (logistic), `pulse` for the event, `limit` to keep things physical, scenarios for two policy alternatives.

```
# Logistic growth with a discrete mortality event.
title Population with mortality shock

StartTime = 0
EndTime   = 80
TimeStep  = 0.25

stock Population = 100

constant IntrinsicGrowth   = 0.05
constant CarryingCapacity  = 5000
constant ShockTime         = 30          # event onset
constant ShockDuration     = 1           # short-window event
constant ShockMortality    = 800         # individuals lost during the window

calc Pressure        = Population / CarryingCapacity
calc EffectiveGrowth = IntrinsicGrowth * (1 - Pressure)
calc MortalityEvent  = pulse(ShockMortality, ShockTime, ShockDuration)

flow Growth:
    Population * EffectiveGrowth -+> Population

flow ShockMortalityFlow:
    MortalityEvent --> Population

limit Population min = 0

scenario MildShock:
    constant ShockMortality = 200

scenario LargerCapacity:
    constant CarryingCapacity = 8000

plot Population
plot EffectiveGrowth
```

**What's worth noticing:**

- The reinforcing loop is `Population → Growth → Population`. The balancing loop is `Population → Pressure → EffectiveGrowth → Growth → Population` — a *negative* loop because higher Population reduces EffectiveGrowth.
- `pulse(...)` lives in a `calc` rather than directly in the flow expression. Both work; the calc form makes the event easy to plot.
- `limit min = 0` is cheap insurance — a large enough shock combined with the wrong step size could otherwise drive Population below zero before the next `Growth` step compensates.

---

## Example 2 — Two-module SaaS funnel with feedback

**Domain:** a marketing funnel where customers refer new prospects, creating a reinforcing growth loop on top of paid acquisition.

**Modeling moves:** two modules (Marketing, Sales), reinforcing loop through referrals, balancing loop through churn, scenario for an aggressive marketing budget.

```
title SaaS funnel with referral loop

StartTime = 0
EndTime   = 36          # months
TimeStep  = 0.1

module Marketing:
    constant MarketingBudget       = 50000      # $/month
    constant CostPerLead           = 100        # $/prospect
    constant ReferralRate          = 0.05       # prospects per customer per month

    calc PaidProspects     = MarketingBudget / CostPerLead
    # Cross-module reference: pulls Customers from the Sales module.
    calc ReferralProspects = Sales.Customers * ReferralRate
    calc TotalProspectInflow = PaidProspects + ReferralProspects

module Sales:
    stock Prospects = 0
    stock Customers = 0

    constant ConversionRate  = 0.20       # fraction of prospects per month
    constant ChurnRate       = 0.03       # fraction of customers per month

    calc ConversionFlow = Prospects * ConversionRate
    calc ChurnFlow      = Customers * ChurnRate

    flow ProspectInflow:
        Marketing.TotalProspectInflow -+> Prospects

    flow Conversion:
        ConversionFlow --> Prospects
        ConversionFlow -+> Customers

    flow Churn:
        ChurnFlow --> Customers

scenario AggressiveMarketing:
    constant Marketing.MarketingBudget = 200000

scenario LowChurn:
    constant Sales.ChurnRate = 0.01

plot Sales.Customers
plot Sales.Prospects
```

**What's worth noticing:**

- The reinforcing loop closes through `Customers → Marketing.ReferralProspects → Sales.Prospects → Sales.Conversion → Sales.Customers`. Crucially, the loop goes *through stocks* (Prospects and Customers) — that's why `Marketing.ReferralProspects` can be a calc without forming a SD0050 cycle.
- The `Conversion` flow has two effects: outflow from Prospects, inflow to Customers. Same magnitude, conservation of mass between compartments.
- Modules are organized by domain concept (acquisition vs. funnel state), not by file structure. Cross-module references walk up to root, then back down into the other module.

---

## Example 3 — Supply chain with delays and a sweep

**Domain:** an inventory manager facing a step demand shock; their forecast lags reality, and their orders take time to arrive.

**Modeling moves:** `step` for the demand shock, `smooth` for forecasting lag, `delay3` for the delivery pipeline, `sweep` for sensitivity to the manager's adjustment time.

```
title Supply chain bullwhip

StartTime = 0
EndTime   = 80
TimeStep  = 0.25

stock Inventory = 100

constant BaselineDemand    = 10
constant DemandShockSize   = 5
constant DemandShockTime   = 10

constant ForecastTime      = 6        # how long to build a stable forecast
constant AdjustmentTime    = 8        # how aggressively to close the inventory gap
constant DeliveryDelay     = 4        # mean delivery time
constant DesiredCoverage   = 4        # weeks of inventory to keep on hand

# Demand profile: baseline plus a permanent step at t = DemandShockTime.
calc CustomerOrderRate = BaselineDemand + step(DemandShockSize, DemandShockTime)

# Manager's forecast: a smoothed view of demand.
calc ExpectedDemand = smooth(CustomerOrderRate, ForecastTime)

# Order policy: replace expected sales + close the inventory gap toward target.
calc DesiredInventory = ExpectedDemand * DesiredCoverage
calc InventoryGap     = DesiredInventory - Inventory
calc DesiredOrderRate = ExpectedDemand + InventoryGap / AdjustmentTime
calc OrderRate        = max(0, DesiredOrderRate)

# Delivery pipeline: orders take time to materialize.
calc DeliveryRate = delay3(OrderRate, DeliveryDelay)

flow Receiving:
    DeliveryRate -+> Inventory

flow Sales:
    CustomerOrderRate --> Inventory

limit Inventory min = 0

scenario AggressiveOrdering:
    constant AdjustmentTime = 2     # over-correct fast → big bullwhip

scenario CautiousOrdering:
    constant AdjustmentTime = 16    # damped response → smaller swings, slower recovery

# Sweep weeks-of-coverage to see how safety stock affects the swing amplitude.
sweep DesiredCoverage = [2, 4, 6, 8]

plot Inventory
plot OrderRate
plot CustomerOrderRate
plot ExpectedDemand
```

**What's worth noticing:**

- Both `smooth` and `delay3` introduce hidden stocks — that's why `Inventory` is the only declared stock yet the system has third-order dynamics.
- `max(0, DesiredOrderRate)` prevents negative orders. We don't ship things back to suppliers in this model.
- The bullwhip is the entire point: a small step in demand produces oscillations in `OrderRate` and `Inventory` because of the lags. The sweep on `DesiredCoverage` shows how a parameter the manager *can* tune affects the swing.
- `time` doesn't appear explicitly because `step` desugars to `(time >= DemandShockTime) * DemandShockSize` for us.

---

## How to use these

When the user describes a system:

1. Decide which example's *shape* it most resembles (single-stock with shocks → ex. 1, networked compartments → ex. 2, control loop with delays → ex. 3).
2. Copy that example as a skeleton.
3. Rename, repurpose, and prune. Drop scenarios/sweeps if the user didn't ask for alternatives.
4. Don't keep numbers from the example — pick values that make sense for the user's domain. If you're unsure of magnitudes, pick round numbers and note in a comment that they're rough.
