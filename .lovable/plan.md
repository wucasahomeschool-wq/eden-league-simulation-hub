# Three changes: manager names, article export, AI trade engine

## 1. Make AI managers address you by your manager's name

**Current behavior (the answer to your question):** No — putting a name in the
"User Controlled" name slot in the Team Editor does **not** currently make rival
managers address you by it. The negotiation brief (`src/lib/negotiation-brief.ts`)
only tells the AI your **club** name ("the USER's club"). The AI never receives
your manager's name, so it can only address your club, not you. The Team Editor
already lets you rename your manager (`replaceManager` saves it to
`state.managers[yourTeam].name`), but that name is purely cosmetic today.

**Fix:** thread your manager name into the AI prompt.
- `NegotiationSuite.tsx` already knows the user team; look up
  `state.managers[seed.userTeam]?.name` and pass it as a new `userManagerName`
  field when calling `negotiateTrade`.
- `negotiation.functions.ts`: accept `userManagerName`, and add a line to the
  system prompt instructing the manager to address the counterpart by that name
  (falling back to the club name if it's still the literal "USER CONTROLLED" or
  empty).
- `negotiation-brief.ts`: label the user's block with the manager's name so the
  AI has it in the DATA block too.

Result: rename your manager once in the Team Editor and every rival manager
greets/addresses you by that name.

## 2. "Export Article" button in the Newsroom

In `src/components/NewsSuite.tsx`, when an `article` exists, render an **Export
Article** button next to the article header.
- Add a small download helper (plain-text/markdown blob, mirroring the
  `downloadJson` pattern in `src/lib/league-export.ts`).
- Filename includes the article kind and a timestamp, e.g.
  `eden-league-postgame-2026-06-15.md`.
- Export the raw markdown the AI returned (headings/bold preserved) so it's
  readable as a `.md` or plain-text file.

## 3. Replace the static trade formula with Lovable AI — yes, this is possible

Today proposals come from `generateTradeProposals()` in `src/lib/trades.ts` (a
deterministic utility formula over a sampled subset of players). We'll swap the
**proposal generation** to Lovable AI while keeping all the existing safety
checks, because an AI can hallucinate players, cash, or illegal deals.

**New server function** `generateAiTradeProposals` (new file
`src/lib/trade-ai.functions.ts`, mirroring `negotiation.functions.ts`):
- Input: a full-league brief (all 24 rosters with ratings/values/positions/
  contracts/salaries, every club budget, the salary cap, current week). Unlike
  the formula, the AI sees the **entire** league, not a sampled subset.
- Prompt: instruct the model to act as the league's trade market and return a
  JSON array of realistic, mutually-beneficial proposals (player-for-player +
  optional cash), using only real players/values from the DATA.
- Output parsed into the existing `TradeProposal` shape.

**Client wiring (`src/state/league.tsx`):**
- `refreshTradeProposals` becomes async: call the AI function, then **validate
  every returned proposal** through the existing `tradeBlockReason` /
  roster-legality guards in `trades.ts`. Drop any deal that's illegal,
  references a non-existent player, or breaks the cap/fieldability rules. Only
  validated deals are stored.
- Recompute `deltaUA`/`deltaUB` locally (so the Trades Suite still shows utility
  and can rank), or display them as AI-judged — kept consistent with the current
  UI.
- The Trades Suite "RUN TRADE ENGINE NOW" button triggers this; show a loading
  state and handle rate-limit (429) / credits (402) errors with a toast, like
  the other AI suites.

**Weekly auto-generation:** the weekly advance currently calls the formula
synchronously. AI calls are async and cost credits, so weekly advance will keep
working but **not** auto-spend credits every week — instead proposals refresh
on demand via the button (and the Negotiation Suite still routes any
user-club deals). I'll keep the old `generateTradeProposals` formula in the
codebase as an offline fallback if the AI is unavailable.

### Technical notes
- New AI server function follows the exact gateway pattern already used in
  `negotiation.functions.ts` (model `google/gemini-3-flash-preview`, 30s abort,
  429/402 handling, tolerant JSON extraction).
- All trade legality stays enforced client-side by `tradeBlockReason`; the AI
  only *proposes*, it never bypasses validation or mutates state.
- No schema/database changes. `tradeProposals` keeps its current shape and
  Cloud persistence path.

### Out of scope / preserved
- The match **simulation** engine is untouched (golden rule). Only the trade
  *proposal* generator changes.
- Manual Trade Builder and the accept/decline flow are unchanged.
