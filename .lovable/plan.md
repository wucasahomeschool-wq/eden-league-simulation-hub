# Negotiation Suite — Plan

A new, fully additive suite where you (the user-controlled teams) negotiate trades with the AI managers of other clubs. Each AI club has a distinct manager personality (from your uploaded file); the AI writes in-character replies to your offers and signals when a deal is agreed. Nothing about the simulation engine, contract engine, or existing trade math changes — this layer sits on top.

## Key decisions (locked in)
- **User-controlled teams = the existing "exempt clubs" selector** (`contractExemptTeams`, currently `Gugu Team` + `Spams`). That one Settings control now drives both the contract engine AND negotiations. No new selector.
- **Gugu Team & Spams** get the personality label `USER CONTROLLED` and are never given an AI manager.
- **Negotiation chat is ephemeral** — lives in the session, resets on reload. No database changes.

## How trades route
- The trade engine still scans all 24 clubs exactly as today.
- **Trades Suite**: now shows only proposals where *neither* club is user-controlled (pure AI-vs-AI deals) — unchanged accept/decline behavior.
- **Negotiation Suite**: shows proposals where *one* club is user-controlled. Instead of a one-click accept, you open a chat with that club's AI manager.
- The Manual Trade Builder stays in the Trades Suite, untouched.

## Negotiation flow
1. Pick one of your user-controlled teams' pending proposals (or start a fresh offer against any AI club via a builder).
2. Chat opens with the AI manager, who greets you in-character based on their personality.
3. You send messages / offers (which players + cash each side gives). The AI replies in-character — haggling, countering, or rejecting per its personality and the real player values, budgets, and cap.
4. When the manager agrees to the *current on-the-table terms*, an **INITIATE TRADE** button appears.
5. INITIATE TRADE runs the exact same `executeManualTrade(...)` used by the Trades Suite (with the same `tradeBlockReason` pre-flight guard), so all roster/cap/budget rules are enforced identically.

The AI only ever *talks*. It never mutates league state. The trade is executed by existing, trusted code using the concrete terms shown on screen.

## Manager personalities & sacking
- A new `managers` map is added to league state, seeded from your uploaded personality file for the 22 AI clubs; the 2 user clubs are `USER CONTROLLED`.
- When an AI club's manager is sacked (existing morale mechanic), a fresh AI-generated manager (name + personality) replaces them via Lovable AI. User-controlled clubs are **never** sacked — their manager flag is protected.
- All existing morale math stays identical; only the manager-identity swap is added.

```text
Trade engine (unchanged)
        │ generates proposals
        ▼
 ┌─────────────┬───────────────────────────┐
 │ AI vs AI    │ involves a user team        │
 ▼             ▼
Trades Suite   Negotiation Suite ──chat──► AI manager (Lovable AI)
(1-click)             │ deal agreed
                      ▼
              INITIATE TRADE → executeManualTrade() (shared)
```

## Safety
- Additive only: new suite, new server function, new data file, a new state field with a migration default. Existing suites keep working if the feature is ignored.
- Trade routing is a display filter; execution reuses existing functions.
- AI calls are isolated server-side (like the Newsroom). AI output is never trusted for state changes.
- If Lovable AI is unavailable, negotiation shows a friendly error and the Trades Suite manual builder remains a full fallback.

---

## Technical details

**1. Manager data — `src/data/managers.ts` (new)**
Map of team name → `{ name: string; personality: string; userControlled?: boolean }`, transcribed from the uploaded PDF for 22 clubs; `Gugu Team` & `Spams` → `personality: "USER CONTROLLED"`.

**2. State — `src/state/league.tsx`**
- Add `managers: Record<string, { name: string; personality: string; pendingGeneration?: boolean }>` to `LeagueState`.
- Seed it in `createInitialState` and backfill in `normalize()` (so existing Cloud saves migrate). Persists automatically with the whole-state upsert.
- New context action `replaceManager(team, manager)` (used after AI generation).
- `triggerManagerSack` path: when an AI club is sacked, set its manager to an interim placeholder with `pendingGeneration: true`; guard so exempt/user teams are never sacked (manager untouched). Morale math unchanged.

**3. Sacking guard — `src/lib/morale.ts` + `engine-settings.ts`**
`triggerManagerSack(team)` early-returns the manager swap when `isContractExempt(team.name)` (reusing the existing live check). Tactical/morale numbers unchanged otherwise.

**4. AI server functions — `src/lib/negotiation.functions.ts` (new)**, mirroring `news.functions.ts`:
- `negotiateTrade`: inputs = manager personality, factual trade brief (real player names/ratings/values, both budgets, salary cap headroom), conversation history, and the user's latest message + current proposed terms. Returns `{ reply: string; accepts: boolean }`. System prompt forbids inventing players/stats and enforces in-character tone + the personality's trading tolerance.
- `generateManager`: generates a new in-character `{ name, personality }` for a sacked AI club.
- Both use the Lovable AI gateway (`google/gemini-3-flash-preview`) with the same 429/402 error handling as the Newsroom.

**5. Fact brief — `src/lib/negotiation-brief.ts` (new)**
Pure functions assembling the factual digest (players, `calculatePlayerValue`, budgets, cap) from real state — no fabricated numbers.

**6. UI — `src/components/NegotiationSuite.tsx` (new)**
- Lists pending proposals involving user teams; chat panel with markdown replies (`react-markdown`, already installed); offer builder (reuse the cascading player/cash pattern from `TradesSuite`).
- On `accepts === true` for current terms, show **INITIATE TRADE** → runs `tradeBlockReason` then `executeManualTrade(...)`, toast on success.
- A `useEffect` watches for managers with `pendingGeneration` and calls `generateManager`, then `replaceManager`.

**7. Trades Suite filter — `src/components/TradesSuite.tsx`**
Filter the auto-desk list to proposals where neither club `isContractExempt`. Manual builder unchanged.

**8. Register suite — `src/routes/index.tsx`**
Add `{ name: "Negotiation", render: () => <NegotiationSuite /> }` to the `SUITES` array.

**9. Memory**
Save a feature memory documenting: exempt selector = user-controlled teams, negotiation routing, AI manager personalities + sacking regeneration, ephemeral chat.