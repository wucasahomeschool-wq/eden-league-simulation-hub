# Eden League — Negotiation polish, search, and the Draft Suite

Four changes. 1–3 are contained; 4 is a large new offseason system that also
extends the trade engine to handle draft picks. Cross-suite navigation infra
(needed for "View in Team Editor" and "NEGOTIATE") is built once and reused.

## 1. Balance trading tolerance + add human variance

The current personalities range from "accepts anything" to "impossible". Two
fixes, both in the AI layer only (personality text stays as flavor):

- **Compress tolerance into a usable band.** In `src/lib/negotiation.functions.ts`,
  add a normalized "tolerance" instruction to the system prompt that overrides
  extreme wording: every manager should accept a *fair-to-slightly-favorable*
  deal eventually, and reject only clearly lopsided ones. The personality still
  shifts *how hard* they push (tough managers haggle more, fair ones less), but
  no manager is auto-yes or auto-no. Phrase it as a rule: "Tolerance ranges only
  from somewhat-stubborn to somewhat-generous; never refuse a genuinely fair
  deal and never accept a clearly bad one."
- **Add mood / human variance.** Inject a per-reply hidden "mood" (e.g. a random
  pick from a small set like upbeat, impatient, distracted, hard-nosed, warm)
  passed into the prompt each turn, instructing the model to color tone and
  flexibility *slightly* without abandoning the core personality. Keep the
  existing `temperature: 0.9`. The mood nudges acceptance threshold by a small
  amount so the same offer isn't always judged identically — making repeat
  negotiations feel alive but still personality-driven.

Net effect: negotiations are winnable with all 24 managers, vary turn to turn,
and still feel like distinct characters.

## 2. Remove the utility display on the Trades Suite

In `src/components/TradesSuite.tsx`, delete the two `Utility +{deltaUA/UB}` lines
in `ProposalCard`. Utility still drives ranking internally; it's just no longer
shown.

## 3. Player search bars (Trades + Negotiation suites)

A shared `<PlayerSearch />` component (new `src/components/PlayerSearch.tsx`)
rendered at the bottom of both suites.

- **Query parsing.** Free-text box. Plain words match player name (substring).
  Structured filters can be combined in the same query, space-separated:
  - position: `pos:RW` or just a bare known position token.
  - attribute comparisons: `speed > 8.5`, `FIN >= 9`, `strength < 4`, etc.
    A keyword map resolves friendly words (speed→PAC, finishing→FIN,
    strength→STR, vision→VIS, pace→PAC, rating/ovr→rating, …) **and** raw codes
    (PAC, FIN, STR, VIS, OVR…). Operators: `> >= < <= =`.
- **Results.** Scans every team's roster. Each hit renders the player's full
  stat row (same columns as the Team Editor slot) plus the owning club, and a
  **"View in Team Editor"** button.
- **View in Team Editor** uses the new navigation infra (below) to switch to the
  Team Editor suite with that club preselected (and the player highlighted).

## 4. Draft picks as assets + the Draft Suite

### 4a. Cross-suite navigation infrastructure
The Hub currently holds `idx` in local state. Add a lightweight navigation
context (new `src/state/navigation.tsx`, provided in `routes/index.tsx`) exposing
`goToSuite(name, payload?)`. Payload carries optional focus hints
(`{ team, player }` for Team Editor; a pending negotiation seed for Negotiation).
Add "Draft" to the `SUITES` list. Team Editor reads the focus hint to preselect
the club; Negotiation reads a seeded session and, on close, calls back to Draft.

### 4b. Draft picks as tradeable assets (year-round, all suites)
Extend the data model and trade engine so picks trade like players/cash.

- **State.** Add to `LeagueState`: `draft?: DraftState` and `draftPicks: DraftPick[]`.
  `DraftPick = { id, season, round (1|2), slot (1–24), originalTeam, owner }`.
  Picks are (re)generated for the upcoming season from reverse final standings;
  `owner` changes when traded. Persists in the Cloud `league_state` JSON like
  everything else.
- **Trade terms.** Extend `TradeProposal` / negotiation `NegotiationTerms` with
  optional `aPicks` / `bPicks` (pick ids). `tradeBlockReason` validates pick
  ownership (the sending club must currently own the pick) and rejects
  duplicates. `executeManualTrade` / `executeTrade` reassign pick `owner`.
- **AI trade engine.** `buildTradeMarketBrief` lists each club's owned picks;
  `trade-ai.functions.ts` may include picks in `aSends`/`bSends`. Returned deals
  are re-validated client-side exactly like player deals before surfacing.
- **UI.** Trade/Negotiation pickers gain a "Picks" selector alongside players;
  proposal cards show traded picks (e.g. "S6 R1 P3").

### 4c. The Draft Suite (offseason)
New `src/components/DraftSuite.tsx`. Locked until the regular season + playoffs
are complete (reuse existing season-end detection); shows a locked message
otherwise.

**Stage 1 — Prospect pool.**
- Sort dropdown (by OVR, by position, by name).
- **"CREATE NEW PROSPECT PLAYER"** → prospect creation screen.
- Once 48 prospects exist, **"START EDEN LEAGUE DRAFT"** appears.

**Prospect creation.**
- Editable name (default "NEW PROSPECT PLAYER"), position, Overall Rating.
- On confirm, call a new AI server fn `generateProspectRatings`
  (`src/lib/draft-ai.functions.ts`): given name + position + OVR, returns the
  individual attribute spread (FIN, PAC, STR, VIS, …) themed by the name
  (Boulder→STR/TAC up, Einstein→COM/VIS/POS up, Noodle→STR down), constrained so
  the weighted overall lands on the chosen OVR.
- Show an editable player slot (Team Editor style, **without** morale, salary, or
  health fields) prefilled with AI values. **"ADD PROSPECT PLAYER TO DRAFT
  POOL"** saves it and returns to the pool.

**Stage 2 — Draft board.**
- Build 48 picks from reverse final regular-season standings (last place = pick 1;
  round 2 repeats the same order). These reuse the `DraftPick` records, so any
  picks already traded show their current owner.
- Each pick = a slot in order. The current pick has **"SIMULATE PICK"**.
- On SIMULATE PICK:
  1. Run the AI trade engine scoped to draft assets/needs. Surface **only the
     best** proposals (high combined value; none if nothing good) to avoid spam.
  2. Any proposal involving a user-controlled club shows a **"NEGOTIATE"** button
     that jumps to the Negotiation Suite (seeded); on close it returns to the
     Draft Suite at the same pick. The user may also initiate their own offers to
     user clubs via the same route.
  3. After trades are accepted/declined, the pick's **current owner** selects.
     AI-owned picks: an AI selection (best available prospect by need + OVR, via
     a small server fn or deterministic best-fit). User-owned picks: manual
     pick from the pool.
  4. Selected prospect is removed from the pool and **added to the owning club's
     roster** with a fixed rookie contract (**$2M, 2 years**), then auto-slotted
     into the starting XI if good enough (reuse `bestReplacement` / lineup sync),
     exactly like an acquired player.
  5. Return to the board for the next pick.
- When all 48 picks are made, the draft is marked complete and the pool/board
  reset for the next offseason.

## Technical notes
- AI server fns (`generateProspectRatings`, draft trade scoping, AI pick) follow
  the existing gateway pattern in `negotiation.functions.ts` /
  `trade-ai.functions.ts` (model `google/gemini-3-flash-preview`, 30s abort,
  429/402 handling, tolerant JSON extraction). All AI output is re-validated
  client-side; the AI never mutates state directly.
- Rookie attributes use the existing `computeOverall` so the slot's OVR stays
  consistent with the rest of the app.
- Draft state and picks persist via the existing Cloud `league_state` flow; no
  schema/table changes. `undoStack` stays local as today.
- Golden rule preserved: the match simulation engine is untouched.

## Out of scope
- Promotion/relegation automation (user still edits the relegated club into the
  new club in the Team Editor, as today).
- Multi-round snake ordering (using reverse standings, same order both rounds).
