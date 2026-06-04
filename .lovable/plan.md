## Goal

Replace the auto-generated Final Four with a **fully manual fixture builder**, add a **new-season flow** (manual fixture entry for Weeks 1–12 after a draft/team review, keeping rosters & budgets but clearing results), and add **auto-generated playoffs** using the NFL reseeding method. No AI integration is added — you create dramatic fixtures externally with AI and type them in here, using one consistent builder.

## What changes

### 1. Fixture Builder (shared component)
A reusable builder used for both Final Four and new-season schedules:
- Pick **home** and **away** from dropdowns of all 24 teams, assign to a week, add to a list.
- Shows fixtures already added per week, with remove buttons.
- Guards: warns on duplicate matchups in the same week and a team playing twice in one week (allowed but flagged).
- "Save fixtures" commits them into league state.

### 2. Final Four — now manual
- Remove the automatic `generateFinalFour()` trigger after Week 12.
- After Week 12 is fully recorded, the Schedule suite shows a **"Build Final Four"** panel (the shared builder, scoped to Weeks 13–16) with the **current standings table shown beside it** for reference while you enter the AI-made matchups.
- Once saved, Weeks 13–16 render and play exactly like today (simulate / manual entry, with the Socks / Gugu Team / Spams manual-only rule intact).

### 3. New Season flow
A **"Start New Season"** control (in the Schedule suite header, behind a confirm dialog) that:
- Keeps all teams, players, attributes, **and budgets**.
- Clears all results, fixtures, playoffs, and resets to Week 1.
- Increments a `season` counter shown in the UI.
- Drops you into a **pre-season state**: a reminder to run the Eden League draft and review squads in the Team Editor first, then the **Fixture Builder for Weeks 1–12** to enter the new AI-generated schedule manually (same method as Final Four). The season "starts" once Week 1 fixtures exist.

> Note: the draft itself (assigning prospects from a pool) is **not** built here — you review/edit squads in the existing Team Editor. If you want a dedicated draft tool later, that's a separate task.

### 4. Playoffs — auto-generated (NFL reseeding)
After Week 16 is fully recorded, a **Playoffs** view auto-seeds the **top 14** from final standings and builds rounds, regenerating each round from results:
- **Round 1 (Wild Card):** seeds 1 & 2 bye. Matchups: 3v14, 4v13, 5v12, 6v11, 7v10, 8v9 → 6 winners.
- **Round 2 (Divisional):** 8 teams (seeds 1, 2 + 6 winners). Reseed by original seed: highest seed vs lowest remaining, 2nd-highest vs 2nd-lowest, etc. → 4 winners.
- **Round 3 (Semifinals):** reseed again, highest vs lowest → 2 winners.
- **Final:** single game → champion crowned and displayed.
- Each playoff match is single-leg and uses the same simulate / manual-entry controls and the manual-only exclusion rule. Next round only unlocks when the current round is fully recorded.

## Technical details

**`src/state/league.tsx`**
- Extend `LeagueState`: add `season: number`, optional `playoffs` structure (rounds → matchups with seeds, home/away, result), and a `phase` helper (`regular | finalFour | playoffs`).
- Remove `generateFinalFour()` and its call in `advanceWeekIfComplete`; week advancement stays for recorded weeks but no longer auto-creates Weeks 13–16.
- New actions: `addFixtures(entries)` / `removeFixture(id)`, `startNewSeason()` (keep teams+budgets, clear `fixtures`/`results`/`playoffs`, `currentWeek=1`, `season++`), `generatePlayoffs()` (seed top 14 from `computeStandings`, build Round 1), `advancePlayoffRound()` (reseed from winners), and playoff result setters reusing `simulateMatch`.
- Bump persistence key to `eden_league_state_v2` with a safe migration from v1 (default `season=1`, no playoffs) so existing saved state isn't lost.

**`src/components/FixtureBuilder.tsx`** (new) — shared builder described above; takes a week range and an `onSave` callback.

**`src/components/ScheduleSuite.tsx`** — add the New Season control + confirm dialog, the pre-season/empty-schedule prompt, the Final Four builder panel (builder + standings reference) gated on Week 12 completion, and a "Build/edit Weeks 1–12" entry point in pre-season.

**`src/components/PlayoffsSuite.tsx`** (new) — bracket UI: rounds, byes, matchups with simulate/manual controls, reseeding on round completion, champion banner. Reuses `SimulationTerminal` and the manual-entry dialog.

**`src/routes/index.tsx`** — add **Playoffs** as a suite in the looping arrow navigation (shown/enabled once Week 16 is complete).

**Memory** — update `mem://features/league-structure`: Final Four is now manual (remove auto-gen note), document new-season flow (keep rosters+budgets, clear results, manual Weeks 1–12 after draft review) and the NFL-reseed playoff method now being built.

## Out of scope
- AI generation of fixtures (done externally by you).
- A dedicated draft-pool/prospect-assignment tool (squad review uses existing Team Editor).
- Two-leg/aggregate playoff scoring (confirmed single-leg).