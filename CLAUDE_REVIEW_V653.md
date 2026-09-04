# JARVIS SPEED — Independent Root-Cause Review Request

## Reviewer instruction
Please perform an independent architecture/code review. Do **not** assume the current patches or diagnoses are correct. We have repeatedly patched symptoms and several failures recur. The priority is navigation reliability, not preserving the current implementation.

Repository: `raijin27-boop/JARVIS-SPEED-ROADTEST`
Current road-test line: `v6.14.53`

## User-observed recurring failures
1. iPhone screen still dims/turns off during navigation although keep-awake was requested as a hard requirement.
2. Vehicle can leave the planned route substantially without a timely reroute.
3. After a reroute is created and the rider physically returns to the original route, the reroute route/geometry can remain instead of being discarded/reconciled.
4. Displayed/navigation position can deviate too far from the rider's real GPS position/road, i.e. map matching/smoothing can overrule reality.
5. Earlier builds also had route-line disappearance and reroute chains. Multiple runtime patches have accumulated.

## Important observed diagnostics from earlier road tests
- v6.14.48 and v6.14.50 had route-integrity blocking around a destination endpoint mismatch of about 118 m. v6.14.51 changed the start/end guard policy and allowed the route.
- A road-test showed `projectionS` around 775 m while a matching candidate jumped to roughly 7.5 km along the route. This strongly suggests ambiguous/overlapping geometry could select a far-ahead segment.
- Other diagnostics showed states such as `TRACKING` while deviation/recovery flags remained active, suggesting state ownership/lifecycle inconsistencies.
- Reroutes change the distance-along-route coordinate system, so comparing old/new `s` values without route-generation ownership can produce false backward/forward jumps.

## Patch history that must be challenged, not trusted
### v6.14.48
Runtime `road-test-fixes.js` added atomic route-line replacement, post-reroute stabilization, free-motion gap limiting, wake-lock handling, and arrival-related protections.

### v6.14.49–51
Arrival/wake-lock handling was strengthened. START guard had a longitude bug and then a policy problem: large POIs can have a valid drivable route endpoint away from the POI pin. v6.14.51 relaxed destination endpoint handling while retaining origin integrity checks.

### v6.14.52
`road-test-v652.js` attempted to constrain map matching to a progress corridor around the current route position, added route-generation telemetry/reset behavior, and strengthened Wake Lock monitoring.

### v6.14.53
`road-test-v653.js` attempts:
- faster accuracy-adaptive off-route/reroute detection;
- preserving the original selected route at START;
- restoring the original route after 3 consecutive fixes confirm physical rejoin;
- clearing temporary reroute visual artifacts on restoration;
- an additional low-load video/canvas keep-awake fallback plus frequent Wake Lock checks.

These are runtime overlays on top of the canonical `parts/app.*.txt` code. One major concern is that layered monkey patches may now create conflicting ownership of navigation state and route rendering.

## Files to review first
1. `parts/app.006.txt` through `parts/app.016.txt` — route/motion/navigation/reroute core.
2. `road-test-fixes.js`
3. `road-test-start-fix.js`
4. `road-test-v652.js`
5. `road-test-v653.js`
6. `road-test-ui.js`
7. `site-parts/index.002.html`

Search specifically for these symbols/concepts:
- `jarvisMotionProject`, `jarvisMotionAcceptFix`, `jarvisNearestActiveRoute`
- `jarvisAutoRerouteUpdate`, `jarvisComputeRoute`
- `jarvisRenderRoute`, `navRouteLine`, `navAltRouteLines`, `routeData`, `routeCandidates`, `selectedRouteIndex`
- `jarvisNavTrackingState`, `jarvisPendingRouteRejoin`, deviation escape/rejoin state
- `projectionS`, `candidateS`, route generation/request sequence
- `requestWakeLock`, `releaseWakeLock`, visibility/pageshow/focus lifecycle

## Questions the review must answer
### A. State machine / ownership
Identify every independent variable/flag that can represent TRACKING, OFF_ROUTE, REROUTING, REJOIN, ARRIVED or recovery. Determine whether contradictory combinations are possible. Propose a **single authoritative navigation state machine** and explicit transitions/guards.

### B. Route ownership and rendering
Determine who owns the active route and who owns displayed polylines. Explain how stale route geometry can survive a reroute/rejoin. Propose one atomic route object such as `{generation, route, progress, polyline, reason}` and a single commit/swap path so old geometry cannot remain.

### C. Map matching
Determine whether global nearest-segment search, smoothing, progress monotonicity, heading penalties, or route-corridor constraints can pull the displayed vehicle away from real GPS. The real GPS position must remain the physical truth; map matching should assist guidance, not fabricate motion. Propose bounded matching using spatial distance + progress window + heading + route generation, with a clear fallback to raw/free-motion GPS when confidence is low.

### D. Reroute trigger
Explain why a rider can visibly leave the route without rerouting. Review thresholds, accuracy adjustment, heading evidence, timers, cooldowns, post-reroute stabilization, and any flags that suppress reroute. Propose a deterministic evidence accumulator/hysteresis model with explicit timing and distances suitable for motorcycle navigation.

### E. Rejoin behavior
Define what should happen when the rider returns to the original/planned route after a reroute. Should the system restore the original route, continue the rerouted route if equivalent, or compute a fresh route? Provide a deterministic policy that cannot leave two route geometries visible.

### F. iOS keep-awake
Review whether Screen Wake Lock is actually supported/reliable in the deployed Safari/PWA context and whether video/canvas fallback is technically valid and safe. Distinguish what web code can guarantee from what iOS can still override. Recommend the most reliable web/PWA strategy and required lifecycle telemetry. Do not claim a guarantee that the platform cannot provide.

### G. Patch architecture
Decide whether continuing to stack `road-test-*.js` overrides is now riskier than integrating a clean implementation into canonical `parts/app.*`. Identify duplicate wrappers and order-dependent behavior. Recommend what to delete/consolidate.

## Required output format
1. **Top 5 root causes**, ranked by confidence and impact, each citing exact functions/files.
2. **Contradictory or duplicated state/ownership paths** found in code.
3. **Minimal architecture correction** — not another symptom patch.
4. **Concrete code-change plan**, ordered by dependency, naming exact functions/files to replace/refactor.
5. **Regression test matrix** covering: normal route, deliberate 15–30 m deviation, parallel road, U-turn, overlapping route geometry, reroute then original-route rejoin, GPS accuracy degradation, screen dim/lock lifecycle, foreground/background/foreground, route-line atomicity.
6. Clearly label any conclusion that cannot be proven from the repository/logs.

## Acceptance criteria for the next JARVIS SPEED build
- No route polyline disappears during route replacement.
- At most one authoritative active-route geometry is displayed.
- A real sustained route deviation triggers reroute promptly without GPS-noise reroute loops.
- Rejoining the chosen/original route produces a deterministic route state and removes stale reroute geometry.
- Displayed vehicle position cannot drift far from the physical GPS fix merely to satisfy route matching.
- Far-ahead overlapping segments cannot steal progress from the current route neighborhood.
- Wake-lock acquisition/release/reacquisition is observable in telemetry; unsupported platform behavior is reported rather than hidden.
- Runtime monkey patches are reduced/consolidated into canonical code after the root cause is established.

Please be critical. If the current v6.14.52/v6.14.53 strategy is conceptually wrong, say so and propose the simpler replacement.