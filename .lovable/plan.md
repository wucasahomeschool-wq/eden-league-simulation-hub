## Goal

Move the Eden League save from each browser's local storage into **Lovable Cloud** (a real backend database), so the entire league — game results, rosters, contracts, morale, playoffs, everything — lives in one shared place. Any window, device, or person opening the app sees the same up-to-date league, and changes propagate live between open windows. After the migration, run a full dry-run test of the **Match Scheduling**, **Playoffs**, and **Contracts** suites so you know they're ready before you finish the real season.

## Why this fixes what you saw

Today the league is stored only in your browser (`localStorage`). That's per-browser/per-device and is read once when a tab opens, so a second window never sees the first window's later changes — exactly the "only Week 1 showed up" behavior. Cloud storage replaces that with a single shared source of truth.

## What changes

### 1. Enable Lovable Cloud
Provision the backend so we have a database to store the league in. (No login screen is added — see the access note below.)

### 2. One shared league record
Create a single database table that holds the whole league as one JSON document (the same `LeagueState` object the app already uses), plus a timestamp and a version number. There is exactly one league row, shared by everyone.

### 3. Rewire saving and loading
- **On open:** the app loads the league from Cloud instead of local storage.
- **On every change:** the app writes the updated league back to Cloud (debounced so rapid edits don't spam the database).
- **First-time migration:** if the Cloud record is empty but your browser still has the current `eden_league_state_v6` save, the app uploads that existing save to Cloud once, so your in-progress season (results, roster changes) carries over and nothing is lost.
- **Offline cache:** local storage is kept only as a read fallback if Cloud is briefly unreachable; Cloud stays the source of truth.

### 4. Live multi-window sync
Subscribe to realtime updates on the league record. When one window saves a change, other open windows update automatically — no refresh needed. To avoid two windows overwriting each other, saves use the version number so the latest write is applied cleanly.

### 5. Undo stays local
The Undo history (up to 1000 snapshots) is **not** pushed to the cloud — it would bloat every save. Undo keeps working within your current session; only the actual league state is synced.

### 6. Verify the three locked suites
After migration, run a temporary fast-forward on a throwaway copy of the data: auto-record a full season + Final Four + playoffs to a champion, then walk through Match Scheduling, Playoffs, and Contracts to confirm each unlocks and behaves correctly. Report results. Your real saved league is not touched by this test.

## Access / security note

Because there's no login, the shared league is readable and writable by anyone who has the app URL. That's the simplest setup and fine for a private group you trust with the link. If you'd later prefer a gate, I can add either a simple shared passphrase or full user login — say the word and I'll layer it on. (I'll flag this in the security memory so it isn't mistaken for an oversight.)

## Technical details

- **Table:** `public.league_state ( id text primary key default 'main', data jsonb not null, version bigint not null default 1, updated_at timestamptz default now() )`. Single row keyed `'main'`. Migration includes explicit GRANTs (anon + authenticated: select/insert/update; service_role: all) and an RLS policy allowing access to that row; table added to the realtime publication.
- **`src/state/league.tsx`:** replace `loadState`/`saveState` localStorage calls with Supabase browser-client reads/writes against the single row. Keep `normalize()` and all migration logic. Strip `undoStack` before persisting to Cloud. Add a realtime subscription that merges incoming `data` into React state. Initial load becomes async (show the existing "Loading league state…" state until the first fetch resolves). First-run uploads any existing `localStorage` `eden_league_state_v6` blob when the Cloud row is absent.
- **Writes:** debounced (~500ms) `update`/`upsert` with `version = version + 1`; realtime echo of our own write is ignored by comparing version.
- **No schema/data changes to the engine, suites, or league rules** — this is purely the persistence layer plus the test pass.

## Out of scope
- User authentication / passphrase gating (offered above, not built unless you ask).
- Per-user separate leagues — this is one shared league by design.
- Any change to simulation math, trades, contracts, or UI behavior.
