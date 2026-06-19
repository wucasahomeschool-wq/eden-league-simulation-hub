# Eden League — Six-Part Upgrade Plan

## 1. Exponential, editable, two-way blowout dampener
**Files:** `src/engine/engine.ts`, `src/lib/engine-settings.ts`, `src/components/SettingsSuite.tsx`, `src/components/SimulationTerminal.tsx`

- Reframe `blowoutDecay` as a **steepness exponent** (rename label, keep the key to avoid breaking saved state). Default ~`0.05` becomes a steepness factor; sensible new default around `0.6`.
- Rewrite `blowout_modifier(score_margin)` so suppression grows **exponentially with each goal of lead** instead of a flat linear `1 + depth*decay`:
  - `depth = score_margin - threshold + 1`
  - new: `modifier = 1 / (1 + depth^(1 + steepness))` (or `Math.pow(1+steepness, depth)` denominator) — each additional goal of lead bites harder than the last; `steepness` controls how exponential the curve is.
- **Two-way is already structural** (the engine passes the *live* current margin each shot, so when the trailing team scores the margin shrinks and the modifier relaxes automatically). I'll verify this at the three call sites (penalty, open-play SP, header SP) and confirm the modifier rises back toward 1.0 as the gap closes — no separate "reduction" branch needed, but I'll document it so the behavior is intentional and visible.
- **Settings UI:** replace the decay `Slider` with an editable `NumberSetting` (free-form numeric input, no min/max cap on the high end) so any value is allowed. Update help text to explain "higher = more exponential / harsher per-goal suppression; lower = gentler."
- **Simulation Terminal:** the existing blowout `Slider` there is replaced with an editable numeric field bound to the same `blowoutDecay` setting (mirrors Settings).

## 2. AI managers can cancel a negotiation
**Files:** `src/lib/negotiation.functions.ts`, `src/components/NegotiationSuite.tsx`

- Extend the negotiation JSON contract from `{reply, accepts}` to `{reply, accepts, cancels}`. Update `NEGOTIATION_RULES` to permit a hard "no": a manager may set `cancels: true` when an offer is insulting/hopeless or the user is wasting their time — a genuine walk-away, not forced to keep countering.
- Parse `cancels` tolerantly (same pattern as `accepts`).
- In `NegotiationSuite`, when a reply has `cancels: true`: close/exit the negotiation window and surface the message **"{managerName} has canceled the deal."** (toast + reset of the active negotiation state). Keep existing user-side CANCEL/DECLINE/ACCEPT buttons intact.

## 3. Smarter, less repetitive newsroom that can answer hard tactical questions
**Files:** `src/lib/news-brief.ts`, `src/lib/news.functions.ts`, `src/components/NewsSuite.tsx`

- **Root cause of the morale/top-scorer obsession:** the `drama` brief leads with morale + top scorers and the roundup always appends the golden-boot race, so those are the only "color" facts the model gets. Fix by giving every news kind a **richer, fuller league brief**.
- Add a new shared `buildLeagueContext(state, standings, leaderboards)` digest that includes, for relevant teams: full roster ratings & values, tactical style + favored style, recent form/results, remaining schedule (opponents + their strength), current injuries/suspensions, budget/cap, and a short plain-language note on how the sim engine weighs attributes/tactics (so the writer can reason about *why* results happen).
- Append this context to all three briefs, and de-emphasize morale/top-scorer (include them but as optional supporting facts, not the headline anchor).
- Update `SHARED_RULES` in `news.functions.ts`: instruct the writer to behave like a real analyst — directly answer tactical/strategic prompts with a clear verdict (is the tactic working? better option? schedule difficulty vs peers? injury impact on lineup?), grounded in the supplied data, and to **avoid defaulting to morale/top-scorer** unless directly relevant.
- The free-form "Story Angle" box already passes `focus`; ensure the harder example prompts (tactics analysis, injury impact, schedule difficulty) are surfaced as placeholder examples.

## 4. Parity multiplier control in the Simulation Terminal
**Files:** `src/components/SimulationTerminal.tsx`

- Add a Parity Multiplier control alongside the existing Tempo / Goal / Blowout controls, bound to `state.settings.parityMultiplier` via `setSettings` (same pattern as the blowout control already there). Editable so it matches the Settings suite.

## 5. Multi-parameter + natural-language player search
**Files:** `src/lib/player-search.ts`, new `src/lib/player-search.functions.ts`, `src/components/PlayerSearch.tsx`

- **Multi-parameter parsing already mostly works** (the regex collects every `attr op number` and ANDs them, plus position + name terms). I'll harden it so a query like `ST, fin > 9, fin < 9.5, pac > 9` reliably parses: tolerate commas as separators, allow the same attribute to appear twice (range: both a `>` and a `<` on `FIN`), and confirm all comparisons are ANDed. Add quick unit-style verification.
- **Natural language:** add a toggle/"Ask AI" mode. When the user types prose ("fast wingers with great stamina"), call a new `createServerFn` (`interpretSearch`) that uses Lovable AI to translate the sentence into the structured query grammar (position + comparisons), then feed that back through the existing `parseSearchQuery`/`playerMatchesQuery` pipeline so results render identically. Handle 429/402 with inline errors. Falls back to literal parsing if AI is unavailable.

## 6. AI fixture generation with manual editing + conflict auto-fix
**Files:** `src/components/MatchSchedulingSuite.tsx`, `src/components/FixtureBuilder.tsx`, new `src/lib/schedule-ai.functions.ts`, supporting brief builder

- **Generate button + special-request UI** in the Match Scheduling suite:
  - A `GENERATE SCHEDULE` button plus two team dropdowns (24 teams each) and an optional third "week" dropdown for special-request matches. When both team dropdowns are set, an `ADD FIXTURE` (special request) button appears; pressing it queues that requested matchup (optionally pinned to a week) and resets the dropdowns so more can be added.
  - On `GENERATE SCHEDULE`, call a new `createServerFn` (`generateSchedule`) with: the phase (regular 12 weeks vs Final Four), the list of special requests, team list, and a data brief.
- **Data the AI uses:**
  - Regular season (Weeks 1–12): pull **last season's data from the version archive** (`listVersions` / latest archived snapshot) plus current rosters/strengths to build an *exciting yet fair* schedule, honoring special requests. Fairness is best-effort (strength-balanced opponents across the 12 weeks); the prompt explicitly acknowledges perfect equality is impossible.
  - Final Four (Weeks 13–16): use **this season's first-12-week results + current standings** to make matchups dramatic — best vs best, worst vs worst — with no fairness constraint.
- **Output handling:** AI returns a structured list of `{week, home, away}` entries. These populate the existing `FixtureBuilder` drafts so the user can still hand-edit before saving. The brief/output schema is kept small (flat arrays) to stay within the gateway's structured-output limits; validate and repair the count client-side.
- **Conflict handling during manual edits:** `FixtureBuilder` already validates (each team once/week, exactly N matches/week, rematch warnings). Upgrade the error dialog so when a conflict is detected the user gets **two buttons**:
  - `Change Manually` — dismiss and keep editing freely (current behavior, jumps to the bad week).
  - `Use AI to Fix Conflict` — call a new `fixScheduleWeek` server fn that takes the offending week's fixtures + constraints and returns a **minimally-edited** valid week (swap the fewest games possible; if one swap fixes it, only change that one). Replace just that week's drafts with the AI result, then re-validate.
- All schedule AI calls go through Lovable AI (`createServerFn`, server-side key), with 429/402/timeout handling surfaced in the dialog.

## Technical notes
- New server functions live in client-safe `src/lib/*.functions.ts` modules and are called via `useServerFn`.
- `blowoutDecay` key is reused (not renamed) so existing Cloud-saved `LeagueState`/engine-settings keep loading; only its *meaning* and UI change.
- Golden Rule: only the blowout formula (item 1) touches engine math, and it's an isolated tuning hook (`blowout_modifier`) — the ported RNG/event loop is untouched. All other items are UI/AI/data layers.

## Validation
- Build check; run a few sims at extreme blowout values to confirm exponential suppression and recovery when the trail team scores.
- Exercise a negotiation to see a manager walk away; verify the cancel message + window exit.
- Generate a regular-season and a Final-Four schedule, then introduce a manual conflict and test both dialog buttons.
- Test multi-param and natural-language searches.
