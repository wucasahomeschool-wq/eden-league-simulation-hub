// League state: types, localStorage persistence, initialization, and actions.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { RAW_TEAMS } from "@/data/rosters";
import { INITIAL_BUDGETS } from "@/data/budgets";
import { INITIAL_SCHEDULE, MANUAL_ONLY_TEAMS } from "@/data/schedule";
import { buildEngineTeam, run_match } from "@/engine/engine";

const STORAGE_KEY = "eden_league_state_v1";

export const ATTR_KEYS = [
  "rating", "FIN", "SHO", "PAS", "VIS", "DRI", "PAC", "STA",
  "DEF", "TAC", "POS_attr", "COM", "WR", "AGG", "STR", "AER",
] as const;
export type AttrKey = (typeof ATTR_KEYS)[number];

export interface LeaguePlayer {
  name: string;
  position: string;
  starter: boolean;
  rating: number; FIN: number; SHO: number; PAS: number; VIS: number; DRI: number;
  PAC: number; STA: number; DEF: number; TAC: number; POS_attr: number; COM: number;
  WR: number; AGG: number; STR: number; AER: number;
}

export interface LeagueTeam {
  name: string;
  tactical_style: string;
  budget: string;
  players: LeaguePlayer[];
}

export interface MatchRecord {
  homeGoals: number;
  awayGoals: number;
  method: "SIM" | "MANUAL";
}

export interface FixtureEntry {
  id: string;
  week: number;
  home: string;
  away: string;
}

export interface LeagueState {
  currentWeek: number;
  teamOrder: string[];
  teams: Record<string, LeagueTeam>;
  fixtures: FixtureEntry[];
  results: Record<string, MatchRecord>;
}

export interface StandingRow {
  rank: number;
  team: string;
  pld: number; w: number; d: number; l: number;
  gf: number; ga: number; gd: number; pts: number;
}

// ---------------- Initialization ----------------
function initState(): LeagueState {
  const teams: Record<string, LeagueTeam> = {};
  const teamOrder: string[] = [];
  for (const t of RAW_TEAMS) {
    teamOrder.push(t.name);
    teams[t.name] = {
      name: t.name,
      tactical_style: t.tactical_style,
      budget: INITIAL_BUDGETS[t.name] ?? "$0M",
      players: t.roster.map((p, i) => ({
        name: p.name,
        position: p.position,
        starter: i < 9,
        rating: p.rating, FIN: p.FIN, SHO: p.SHO, PAS: p.PAS, VIS: p.VIS, DRI: p.DRI,
        PAC: p.PAC, STA: p.STA, DEF: p.DEF, TAC: p.TAC, POS_attr: p.POS_attr, COM: p.COM,
        WR: p.WR, AGG: p.AGG, STR: p.STR, AER: p.AER,
      })),
    };
  }
  const fixtures: FixtureEntry[] = INITIAL_SCHEDULE.map((f, i) => ({
    id: `w${f.week}-m${i}`,
    week: f.week,
    home: f.home,
    away: f.away,
  }));
  return { currentWeek: 1, teamOrder, teams, fixtures, results: {} };
}

function loadState(): LeagueState {
  if (typeof window === "undefined") return initState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as LeagueState;
  } catch {
    /* ignore corrupt state */
  }
  return initState();
}

// ---------------- Standings ----------------
export function computeStandings(state: LeagueState): StandingRow[] {
  const rows: Record<string, StandingRow> = {};
  state.teamOrder.forEach((name) => {
    rows[name] = { rank: 0, team: name, pld: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 };
  });
  for (const fx of state.fixtures) {
    const r = state.results[fx.id];
    if (!r) continue;
    const h = rows[fx.home];
    const a = rows[fx.away];
    if (!h || !a) continue;
    h.pld++; a.pld++;
    h.gf += r.homeGoals; h.ga += r.awayGoals;
    a.gf += r.awayGoals; a.ga += r.homeGoals;
    if (r.homeGoals > r.awayGoals) { h.w++; a.l++; h.pts += 3; }
    else if (r.homeGoals < r.awayGoals) { a.w++; h.l++; a.pts += 3; }
    else { h.d++; a.d++; h.pts++; a.pts++; }
  }
  const list = Object.values(rows);
  list.forEach((row) => { row.gd = row.gf - row.ga; });
  list.sort((x, y) =>
    y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.team.localeCompare(y.team)
  );
  list.forEach((row, i) => { row.rank = i + 1; });
  return list;
}

// ---------------- Final Four generation (weeks 13-16) ----------------
function generateFinalFour(state: LeagueState): FixtureEntry[] {
  const standings = computeStandings(state);
  const seeds = standings.map((s) => s.team);
  const out: FixtureEntry[] = [];
  for (let k = 0; k < 4; k++) {
    const week = 13 + k;
    const rotated = [...seeds.slice(k), ...seeds.slice(0, k)];
    for (let i = 0; i + 1 < rotated.length; i += 2) {
      out.push({
        id: `w${week}-m${i / 2}`,
        week,
        home: rotated[i],
        away: rotated[i + 1],
      });
    }
  }
  return out;
}

export function isManualOnly(home: string, away: string): boolean {
  return MANUAL_ONLY_TEAMS.includes(home) || MANUAL_ONLY_TEAMS.includes(away);
}

// Build the ordered roster for the engine: flagged starters first, then bench.
export function rosterForEngine(team: LeagueTeam) {
  const starters = team.players.filter((p) => p.starter);
  const bench = team.players.filter((p) => !p.starter);
  return [...starters, ...bench].map((p) => ({
    name: p.name, position: p.position, rating: p.rating,
    FIN: p.FIN, SHO: p.SHO, PAS: p.PAS, VIS: p.VIS, DRI: p.DRI, PAC: p.PAC, STA: p.STA,
    DEF: p.DEF, TAC: p.TAC, POS_attr: p.POS_attr, COM: p.COM, WR: p.WR, AGG: p.AGG,
    STR: p.STR, AER: p.AER,
  }));
}

export function simulateMatch(
  state: LeagueState,
  home: string,
  away: string,
  tempo: number,
  goalMultiplier: number
) {
  const ht = state.teams[home];
  const at = state.teams[away];
  const engineHome = buildEngineTeam(ht.name, ht.tactical_style, rosterForEngine(ht));
  const engineAway = buildEngineTeam(at.name, at.tactical_style, rosterForEngine(at));
  return run_match(engineHome, engineAway, tempo, goalMultiplier);
}

// ---------------- Context ----------------
interface LeagueContextValue {
  state: LeagueState;
  setResult: (fixtureId: string, homeGoals: number, awayGoals: number, method: "SIM" | "MANUAL") => void;
  updateBudget: (team: string, budget: string) => void;
  updatePlayer: (team: string, index: number, patch: Partial<LeaguePlayer>) => void;
  toggleStarter: (team: string, index: number) => void;
  resetLeague: () => void;
  standings: StandingRow[];
}

const LeagueContext = createContext<LeagueContextValue | null>(null);

export function LeagueProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LeagueState>(() => loadState());

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage full / unavailable */
    }
  }, [state]);

  const standings = useMemo(() => computeStandings(state), [state]);

  function advanceWeekIfComplete(next: LeagueState): LeagueState {
    const wk = next.currentWeek;
    const weekFixtures = next.fixtures.filter((f) => f.week === wk);
    const allPlayed = weekFixtures.length > 0 && weekFixtures.every((f) => next.results[f.id]);
    if (!allPlayed) return next;

    // If week 12 just completed and Final Four not yet generated, generate it.
    let fixtures = next.fixtures;
    if (wk === 12 && !next.fixtures.some((f) => f.week >= 13)) {
      fixtures = [...next.fixtures, ...generateFinalFour(next)];
    }
    const maxWeek = Math.max(...fixtures.map((f) => f.week));
    const newWeek = wk < maxWeek ? wk + 1 : wk;
    return { ...next, fixtures, currentWeek: newWeek };
  }

  const value: LeagueContextValue = {
    state,
    standings,
    setResult: (fixtureId, homeGoals, awayGoals, method) =>
      setState((prev) => {
        const next: LeagueState = {
          ...prev,
          results: { ...prev.results, [fixtureId]: { homeGoals, awayGoals, method } },
        };
        return advanceWeekIfComplete(next);
      }),
    updateBudget: (team, budget) =>
      setState((prev) => ({
        ...prev,
        teams: { ...prev.teams, [team]: { ...prev.teams[team], budget } },
      })),
    updatePlayer: (team, index, patch) =>
      setState((prev) => {
        const players = prev.teams[team].players.map((p, i) => (i === index ? { ...p, ...patch } : p));
        return { ...prev, teams: { ...prev.teams, [team]: { ...prev.teams[team], players } } };
      }),
    toggleStarter: (team, index) =>
      setState((prev) => {
        const players = prev.teams[team].players.map((p, i) =>
          i === index ? { ...p, starter: !p.starter } : p
        );
        return { ...prev, teams: { ...prev.teams, [team]: { ...prev.teams[team], players } } };
      }),
    resetLeague: () => setState(initState()),
  };

  return <LeagueContext.Provider value={value}>{children}</LeagueContext.Provider>;
}

export function useLeague(): LeagueContextValue {
  const ctx = useContext(LeagueContext);
  if (!ctx) throw new Error("useLeague must be used within LeagueProvider");
  return ctx;
}
