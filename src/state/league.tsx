// League state: types, localStorage persistence, initialization, and actions.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { RAW_TEAMS } from "@/data/rosters";
import { INITIAL_BUDGETS } from "@/data/budgets";
import { INITIAL_SCHEDULE, MANUAL_ONLY_TEAMS } from "@/data/schedule";
import { buildEngineTeam, run_match } from "@/engine/engine";
import { computeOverall } from "@/lib/ratings";
import { buildMatchPayload, type MatchPayload } from "@/lib/match-payload";
import {
  generateTradeProposals, parseBudget, formatBudget, type TradeProposal,
} from "@/lib/trades";

const STORAGE_KEY = "eden_league_state_v4";
const LEGACY_STORAGE_KEYS = ["eden_league_state_v3", "eden_league_state_v2", "eden_league_state_v1"];

// Transfer window: the automatic trade engine only runs at the end of regular
// season match weeks (1–12).
export const TRANSFER_WINDOW_LAST_WEEK = 12;
// A weeks-out value at or above this is treated as "out for the rest of the season".
export const SEASON_ENDING_WEEKS = 99;
// Disciplinary thresholds.
const YELLOW_WINDOW_WEEKS = 2; // 2 yellows within this many weeks => suspension
const YELLOW_SUSPENSION = 1;
const RED_SUSPENSION = 2;

export const ATTR_KEYS = [
  "rating", "FIN", "SHO", "PAS", "VIS", "DRI", "PAC", "STA",
  "DEF", "TAC", "POS_attr", "COM", "WR", "AGG", "STR", "AER",
] as const;
export type AttrKey = (typeof ATTR_KEYS)[number];

export interface LeaguePlayer {
  name: string;
  position: string;
  starter: boolean;
  injuryWeeks: number; // 0 = healthy; SEASON_ENDING_WEEKS = out for season
  suspensionWeeks: number; // 0 = not suspended
  yellowLog: number[]; // weeks in which unpunished yellows were received
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

export interface PlayoffMatch {
  id: string;
  round: number; // 1 = Wild Card, 2 = Divisional, 3 = Semifinal, 4 = Final
  homeSeed: number;
  awaySeed: number;
  home: string;
  away: string;
  result?: MatchRecord;
}

export interface PlayoffsState {
  seeds: string[]; // top 14, index 0 = seed 1
  rounds: PlayoffMatch[][]; // rounds[0] = Wild Card, etc.
  champion?: string;
}

export interface LeagueState {
  currentWeek: number;
  season: number;
  teamOrder: string[];
  teams: Record<string, LeagueTeam>;
  fixtures: FixtureEntry[];
  results: Record<string, MatchRecord>;
  payloads: Record<string, MatchPayload>; // keyed by fixture / playoff match id
  playoffs?: PlayoffsState;
  tradeProposals: TradeProposal[];
  snapshots: string[]; // serialized states at the start of each week (rollback stack)
}

export interface StandingRow {
  rank: number;
  team: string;
  pld: number; w: number; d: number; l: number;
  gf: number; ga: number; gd: number; pts: number;
}

// ---------------- Player leaderboards ----------------
export interface ScorerRow { team: string; name: string; goals: number; assists: number; }
export interface AssistRow { team: string; name: string; assists: number; goals: number; }
export interface KeeperRow { team: string; name: string; cleanSheets: number; conceded: number; apps: number; }
export interface Leaderboards { scorers: ScorerRow[]; assists: AssistRow[]; keepers: KeeperRow[]; }

// ---------------- Helpers ----------------
export function isPlayerOut(p: LeaguePlayer): boolean {
  return p.injuryWeeks > 0 || p.suspensionWeeks > 0;
}

export function blankPlayer(): LeaguePlayer {
  const base: LeaguePlayer = {
    name: "New Player", position: "CM", starter: false,
    injuryWeeks: 0, suspensionWeeks: 0, yellowLog: [],
    rating: 5.0, FIN: 5.0, SHO: 5.0, PAS: 5.0, VIS: 5.0, DRI: 5.0,
    PAC: 5.0, STA: 5.0, DEF: 5.0, TAC: 5.0, POS_attr: 5.0, COM: 5.0,
    WR: 5.0, AGG: 5.0, STR: 5.0, AER: 5.0,
  };
  return { ...base, rating: computeOverall(base) };
}

// A 1.0-rated youth academy fill-in to legally complete a depleted squad.
export function youthPlayer(): LeaguePlayer {
  const base: LeaguePlayer = {
    name: "Youth Academy Call-up", position: "CM", starter: true,
    injuryWeeks: 0, suspensionWeeks: 0, yellowLog: [],
    rating: 1.0, FIN: 1.0, SHO: 1.0, PAS: 1.0, VIS: 1.0, DRI: 1.0,
    PAC: 1.0, STA: 1.0, DEF: 1.0, TAC: 1.0, POS_attr: 1.0, COM: 1.0,
    WR: 1.0, AGG: 1.0, STR: 1.0, AER: 1.0,
  };
  return { ...base, rating: computeOverall(base) };
}

// Exponential injury duration: 1 week is most common, escalating up to a rare
// season-ending blow. Only applied to players carried off (emergency-subbed).
export function rollInjuryWeeks(): number {
  let weeks = 1;
  while (Math.random() < 0.5 && weeks < 14) weeks++;
  return weeks >= 12 ? SEASON_ENDING_WEEKS : weeks;
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
      players: t.roster.map((p, i) => {
        const player: LeaguePlayer = {
          name: p.name,
          position: p.position,
          starter: i < 9,
          injuryWeeks: 0,
          suspensionWeeks: 0,
          yellowLog: [],
          rating: p.rating, FIN: p.FIN, SHO: p.SHO, PAS: p.PAS, VIS: p.VIS, DRI: p.DRI,
          PAC: p.PAC, STA: p.STA, DEF: p.DEF, TAC: p.TAC, POS_attr: p.POS_attr, COM: p.COM,
          WR: p.WR, AGG: p.AGG, STR: p.STR, AER: p.AER,
        };
        // OVR is an automated weighted average — derive it from the attributes.
        return { ...player, rating: computeOverall(player) };
      }),
    };
  }
  const fixtures: FixtureEntry[] = INITIAL_SCHEDULE.map((f, i) => ({
    id: `w${f.week}-m${i}`,
    week: f.week,
    home: f.home,
    away: f.away,
  }));
  return {
    currentWeek: 1, season: 1, teamOrder, teams, fixtures,
    results: {}, payloads: {}, tradeProposals: [], snapshots: [],
  };
}

// Ensure migrated/older state has all required fields.
function normalize(state: LeagueState): LeagueState {
  const teams: Record<string, LeagueTeam> = {};
  for (const name of state.teamOrder) {
    const t = state.teams[name];
    teams[name] = {
      ...t,
      players: t.players.map((p) => {
        const player: LeaguePlayer = {
          ...p,
          injuryWeeks: p.injuryWeeks ?? 0,
          suspensionWeeks: p.suspensionWeeks ?? 0,
          yellowLog: p.yellowLog ?? [],
        };
        return { ...player, rating: computeOverall(player) };
      }),
    };
  }
  return {
    ...state,
    season: state.season ?? 1,
    tradeProposals: state.tradeProposals ?? [],
    payloads: state.payloads ?? {},
    snapshots: state.snapshots ?? [],
    teams,
  };
}

function loadState(): LeagueState {
  if (typeof window === "undefined") return initState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw) as LeagueState);
    for (const key of LEGACY_STORAGE_KEYS) {
      const legacy = window.localStorage.getItem(key);
      if (legacy) return normalize(JSON.parse(legacy) as LeagueState);
    }
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

// ---------------- Player leaderboards (derived from match payloads) ----------------
export function computeLeaderboards(state: LeagueState): Leaderboards {
  const scorerMap = new Map<string, ScorerRow>();
  const keeperMap = new Map<string, KeeperRow>();

  for (const payload of Object.values(state.payloads)) {
    for (const p of payload.players) {
      const key = `${p.team}::${p.name}`;
      const cur = scorerMap.get(key) ?? { team: p.team, name: p.name, goals: 0, assists: 0 };
      cur.goals += p.goals;
      cur.assists += p.assists;
      scorerMap.set(key, cur);
    }
    for (const g of payload.goalkeepers) {
      const key = `${g.team}::${g.name}`;
      const cur = keeperMap.get(key) ?? { team: g.team, name: g.name, cleanSheets: 0, conceded: 0, apps: 0 };
      cur.cleanSheets += g.cleanSheet ? 1 : 0;
      cur.conceded += g.conceded;
      cur.apps += 1;
      keeperMap.set(key, cur);
    }
  }

  const scorers = [...scorerMap.values()]
    .filter((r) => r.goals > 0)
    .sort((a, b) => b.goals - a.goals || b.assists - a.assists || a.name.localeCompare(b.name));
  const assists = [...scorerMap.values()]
    .filter((r) => r.assists > 0)
    .map((r) => ({ team: r.team, name: r.name, assists: r.assists, goals: r.goals }))
    .sort((a, b) => b.assists - a.assists || b.goals - a.goals || a.name.localeCompare(b.name));
  const keepers = [...keeperMap.values()]
    .filter((r) => r.apps > 0)
    .sort((a, b) => b.cleanSheets - a.cleanSheets || a.conceded - b.conceded || a.name.localeCompare(b.name));

  return { scorers, assists, keepers };
}

// ---------------- Schedule helpers ----------------
export function isWeekComplete(state: LeagueState, week: number): boolean {
  const wk = state.fixtures.filter((f) => f.week === week);
  return wk.length > 0 && wk.every((f) => state.results[f.id]);
}

export function maxScheduledWeek(state: LeagueState): number {
  return state.fixtures.reduce((m, f) => Math.max(m, f.week), 0);
}

const ROUND_NAMES = ["", "Wild Card", "Divisional", "Semifinal", "Final"];
export const PLAYOFF_ROUND_NAMES = ROUND_NAMES;

// ---------------- Playoffs (NFL-style reseeding) ----------------
function buildRound(
  round: number,
  participants: { team: string; seed: number }[]
): PlayoffMatch[] {
  const sorted = [...participants].sort((a, b) => a.seed - b.seed);
  const out: PlayoffMatch[] = [];
  const n = sorted.length;
  for (let i = 0; i < n / 2; i++) {
    const high = sorted[i];
    const low = sorted[n - 1 - i];
    out.push({
      id: `po-r${round}-m${i}`,
      round,
      homeSeed: high.seed,
      awaySeed: low.seed,
      home: high.team,
      away: low.team,
    });
  }
  return out;
}

export function matchWinner(m: PlayoffMatch): string | null {
  if (!m.result) return null;
  if (m.result.homeGoals > m.result.awayGoals) return m.home;
  if (m.result.awayGoals > m.result.homeGoals) return m.away;
  return null; // tie — must be resolved before advancing
}

function buildPlayoffs(state: LeagueState): PlayoffsState {
  const seeds = computeStandings(state).slice(0, 14).map((s) => s.team);
  const wildCard = seeds.slice(2).map((team, i) => ({ team, seed: i + 3 }));
  return { seeds, rounds: [buildRound(1, wildCard)] };
}

function seedOf(playoffs: PlayoffsState, team: string): number {
  return playoffs.seeds.indexOf(team) + 1;
}

function advancePlayoffs(playoffs: PlayoffsState): PlayoffsState {
  const last = playoffs.rounds[playoffs.rounds.length - 1];
  const winners = last.map(matchWinner);
  if (winners.some((w) => w === null)) return playoffs;
  const roundNum = last[0].round;

  if (roundNum === 4) {
    return { ...playoffs, champion: winners[0]! };
  }

  let advancing: string[] = winners as string[];
  if (roundNum === 1) {
    advancing = [playoffs.seeds[0], playoffs.seeds[1], ...advancing];
  }
  if (advancing.length < 2) return playoffs;

  const participants = advancing.map((team) => ({ team, seed: seedOf(playoffs, team) }));
  const next = buildRound(roundNum + 1, participants);
  return { ...playoffs, rounds: [...playoffs.rounds, next] };
}

export function isManualOnly(home: string, away: string): boolean {
  return MANUAL_ONLY_TEAMS.includes(home) || MANUAL_ONLY_TEAMS.includes(away);
}

// Build the ordered roster for the engine: available starters first, then
// available bench. Injured/suspended players are excluded entirely.
export function rosterForEngine(team: LeagueTeam) {
  const available = team.players.filter((p) => !isPlayerOut(p));
  const starters = available.filter((p) => p.starter);
  const bench = available.filter((p) => !p.starter);
  return [...starters, ...bench].map((p) => ({
    name: p.name, position: p.position, rating: p.rating,
    FIN: p.FIN, SHO: p.SHO, PAS: p.PAS, VIS: p.VIS, DRI: p.DRI, PAC: p.PAC, STA: p.STA,
    DEF: p.DEF, TAC: p.TAC, POS_attr: p.POS_attr, COM: p.COM, WR: p.WR, AGG: p.AGG,
    STR: p.STR, AER: p.AER,
  }));
}

export interface SimOutput {
  log: string[];
  homeGoals: number;
  awayGoals: number;
  injured: { team: string; name: string }[]; // severe (carried off) injuries
  payload: MatchPayload;
}

export function simulateMatch(
  state: LeagueState,
  home: string,
  away: string,
  tempo: number,
  goalMultiplier: number
): SimOutput {
  const ht = state.teams[home];
  const at = state.teams[away];
  const engineHome = buildEngineTeam(ht.name, ht.tactical_style, rosterForEngine(ht));
  const engineAway = buildEngineTeam(at.name, at.tactical_style, rosterForEngine(at));
  const result = run_match(engineHome, engineAway, tempo, goalMultiplier);

  // Build the structured JSON payload from the final engine state. Reading the
  // post-match flags does NOT alter the engine's math or random sequence.
  const payload = buildMatchPayload(
    engineHome, engineAway, home, away, result.homeGoals, result.awayGoals
  );
  return { ...result, injured: payload.injuries, payload };
}

// ---------------- Match effects (injuries + disciplinary) ----------------
// Applies a match payload's disciplinary outcomes and injuries to the team map.
// Returns the new teams and a protected-key set (players whose timers should NOT
// decrement during this week's advance because the event happened this week).
function applyMatchEffects(
  teams: Record<string, LeagueTeam>,
  payload: MatchPayload | undefined,
  injured: { team: string; name: string }[] | undefined,
  currentWeek: number
): { teams: Record<string, LeagueTeam>; protectedKeys: Set<string> } {
  const next = { ...teams };
  const protectedKeys = new Set<string>();

  const updatePlayerIn = (
    teamName: string,
    playerName: string,
    fn: (p: LeaguePlayer) => LeaguePlayer
  ) => {
    const team = next[teamName];
    if (!team) return;
    const idx = team.players.findIndex((p) => p.name === playerName);
    if (idx < 0) return;
    const players = team.players.map((p, i) => (i === idx ? fn(p) : p));
    next[teamName] = { ...team, players };
  };

  // Disciplinary: yellow accumulation + straight reds.
  if (payload) {
    for (const ps of payload.players) {
      if (ps.red) {
        updatePlayerIn(ps.team, ps.name, (p) => ({
          ...p,
          suspensionWeeks: Math.max(p.suspensionWeeks, RED_SUSPENSION),
          yellowLog: [],
          starter: false,
        }));
        protectedKeys.add(`${ps.team}::${ps.name}`);
      } else if (ps.yellow > 0) {
        updatePlayerIn(ps.team, ps.name, (p) => {
          const log = [...p.yellowLog, currentWeek].filter(
            (w) => w > currentWeek - YELLOW_WINDOW_WEEKS
          );
          if (log.length >= 2) {
            protectedKeys.add(`${ps.team}::${ps.name}`);
            return {
              ...p,
              suspensionWeeks: Math.max(p.suspensionWeeks, YELLOW_SUSPENSION),
              yellowLog: [],
              starter: false,
            };
          }
          return { ...p, yellowLog: log };
        });
      }
    }
  }

  // Injuries (carried off): roll a duration and pull from the lineup.
  if (injured && injured.length) {
    for (const inj of injured) {
      updatePlayerIn(inj.team, inj.name, (p) => ({
        ...p,
        injuryWeeks: Math.max(p.injuryWeeks, rollInjuryWeeks()),
        starter: false,
      }));
      protectedKeys.add(`${inj.team}::${inj.name}`);
    }
  }

  return { teams: next, protectedKeys };
}

// ---------------- Context ----------------
interface LeagueContextValue {
  state: LeagueState;
  setResult: (
    fixtureId: string,
    homeGoals: number,
    awayGoals: number,
    method: "SIM" | "MANUAL",
    payload?: MatchPayload
  ) => void;
  resetMatchResult: (fixtureId: string) => void;
  rollbackWeek: () => void;
  canRollback: boolean;
  updateBudget: (team: string, budget: string) => void;
  updatePlayer: (team: string, index: number, patch: Partial<LeaguePlayer>) => void;
  toggleStarter: (team: string, index: number) => void;
  setInjuryWeeks: (team: string, index: number, weeks: number) => void;
  setSuspensionWeeks: (team: string, index: number, weeks: number) => void;
  addPlayer: (team: string) => void;
  addYouthPlayer: (team: string) => void;
  removePlayer: (team: string, index: number) => void;
  renameTeam: (oldName: string, newName: string) => void;
  addFixtures: (entries: { week: number; home: string; away: string }[]) => void;
  removeFixture: (fixtureId: string) => void;
  scheduleFinalFour: (entries: { week: number; home: string; away: string }[]) => void;
  scheduleNewSeason: (entries: { week: number; home: string; away: string }[]) => void;
  startNewSeason: () => void;
  generatePlayoffs: () => void;
  setPlayoffResult: (matchId: string, homeGoals: number, awayGoals: number, method: "SIM" | "MANUAL", payload?: MatchPayload) => void;
  executeTrade: (proposal: TradeProposal) => void;
  declineTrade: (proposalId: string) => void;
  refreshTradeProposals: () => void;
  resetLeague: () => void;
  standings: StandingRow[];
  leaderboards: Leaderboards;
}

const LeagueContext = createContext<LeagueContextValue | null>(null);

// Move a player (by name) from one team to another, and shift cash.
function applyTrade(prev: LeagueState, t: TradeProposal): LeagueState {
  const teamA = prev.teams[t.teamA];
  const teamB = prev.teams[t.teamB];
  if (!teamA || !teamB) return prev;

  const aIdx = teamA.players.findIndex((p) => p.name === t.aSends);
  const bIdx = teamB.players.findIndex((p) => p.name === t.bSends);
  if (aIdx < 0 || bIdx < 0) return prev;

  const playerFromA = { ...teamA.players[aIdx], starter: false };
  const playerFromB = { ...teamB.players[bIdx], starter: false };

  const newA = teamA.players.filter((_, i) => i !== aIdx).concat(playerFromB);
  const newB = teamB.players.filter((_, i) => i !== bIdx).concat(playerFromA);

  const aBudget = parseBudget(teamA.budget) + t.cashAReceives - t.cashBReceives;
  const bBudget = parseBudget(teamB.budget) + t.cashBReceives - t.cashAReceives;

  return {
    ...prev,
    teams: {
      ...prev.teams,
      [t.teamA]: { ...teamA, players: newA, budget: formatBudget(aBudget) },
      [t.teamB]: { ...teamB, players: newB, budget: formatBudget(bBudget) },
    },
  };
}

// Serialize a state for the rollback stack (without the stack itself).
function serializeSnapshot(state: LeagueState): string {
  return JSON.stringify({ ...state, snapshots: [] });
}

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
  const leaderboards = useMemo(() => computeLeaderboards(state), [state]);

  // Decrement injuries/suspensions for everyone EXCEPT players affected this week,
  // then run the weekly trade engine if inside the transfer window.
  function onWeekAdvanced(next: LeagueState, protectedKeys: Set<string>): LeagueState {
    const teams: Record<string, LeagueTeam> = {};
    for (const name of next.teamOrder) {
      const t = next.teams[name];
      teams[name] = {
        ...t,
        players: t.players.map((p) => {
          if (protectedKeys.has(`${name}::${p.name}`)) return p;
          if (p.injuryWeeks === 0 && p.suspensionWeeks === 0) return p;
          return {
            ...p,
            injuryWeeks: p.injuryWeeks >= SEASON_ENDING_WEEKS ? p.injuryWeeks : Math.max(0, p.injuryWeeks - 1),
            suspensionWeeks: Math.max(0, p.suspensionWeeks - 1),
          };
        }),
      };
    }
    let advanced: LeagueState = { ...next, teams };
    if (advanced.currentWeek <= TRANSFER_WINDOW_LAST_WEEK) {
      advanced = { ...advanced, tradeProposals: generateTradeProposals(advanced) };
    }
    return advanced;
  }

  function advanceWeekIfComplete(next: LeagueState, protectedKeys: Set<string>): LeagueState {
    const wk = next.currentWeek;
    const weekFixtures = next.fixtures.filter((f) => f.week === wk);
    const allPlayed = weekFixtures.length > 0 && weekFixtures.every((f) => next.results[f.id]);
    if (!allPlayed) return next;
    const maxWeek = maxScheduledWeek(next);
    if (wk < maxWeek) {
      const advanced = onWeekAdvanced({ ...next, currentWeek: wk + 1 }, protectedKeys);
      // Snapshot the clean start of the new week for the rollback stack.
      const snaps = [...advanced.snapshots, serializeSnapshot(advanced)].slice(-24);
      return { ...advanced, snapshots: snaps };
    }
    return onWeekAdvanced(next, protectedKeys);
  }

  const value: LeagueContextValue = {
    state,
    standings,
    leaderboards,
    canRollback: state.snapshots.length > 0,
    setResult: (fixtureId, homeGoals, awayGoals, method, payload) =>
      setState((prev) => {
        const { teams, protectedKeys } = applyMatchEffects(
          prev.teams, payload, payload?.injuries, prev.currentWeek
        );
        const next: LeagueState = {
          ...prev,
          teams,
          results: { ...prev.results, [fixtureId]: { homeGoals, awayGoals, method } },
          payloads: payload ? { ...prev.payloads, [fixtureId]: payload } : prev.payloads,
        };
        return advanceWeekIfComplete(next, protectedKeys);
      }),
    resetMatchResult: (fixtureId) =>
      setState((prev) => {
        const results = { ...prev.results };
        delete results[fixtureId];
        const payloads = { ...prev.payloads };
        delete payloads[fixtureId];
        return { ...prev, results, payloads };
      }),
    rollbackWeek: () =>
      setState((prev) => {
        if (!prev.snapshots.length) return prev;
        const stack = [...prev.snapshots];
        const last = stack.pop()!;
        try {
          const restored = JSON.parse(last) as LeagueState;
          return normalize({ ...restored, snapshots: stack });
        } catch {
          return prev;
        }
      }),
    updateBudget: (team, budget) =>
      setState((prev) => ({
        ...prev,
        teams: { ...prev.teams, [team]: { ...prev.teams[team], budget } },
      })),
    updatePlayer: (team, index, patch) =>
      setState((prev) => {
        const players = prev.teams[team].players.map((p, i) => {
          if (i !== index) return p;
          const merged = { ...p, ...patch };
          // OVR is automated: always recompute from attributes / position.
          return { ...merged, rating: computeOverall(merged) };
        });
        return { ...prev, teams: { ...prev.teams, [team]: { ...prev.teams[team], players } } };
      }),
    toggleStarter: (team, index) =>
      setState((prev) => {
        const players = prev.teams[team].players.map((p, i) =>
          i === index ? { ...p, starter: !p.starter } : p
        );
        return { ...prev, teams: { ...prev.teams, [team]: { ...prev.teams[team], players } } };
      }),
    setInjuryWeeks: (team, index, weeks) =>
      setState((prev) => {
        const players = prev.teams[team].players.map((p, i) =>
          i === index ? { ...p, injuryWeeks: Math.max(0, weeks) } : p
        );
        return { ...prev, teams: { ...prev.teams, [team]: { ...prev.teams[team], players } } };
      }),
    setSuspensionWeeks: (team, index, weeks) =>
      setState((prev) => {
        const players = prev.teams[team].players.map((p, i) =>
          i === index ? { ...p, suspensionWeeks: Math.max(0, weeks) } : p
        );
        return { ...prev, teams: { ...prev.teams, [team]: { ...prev.teams[team], players } } };
      }),
    addPlayer: (team) =>
      setState((prev) => ({
        ...prev,
        teams: {
          ...prev.teams,
          [team]: { ...prev.teams[team], players: [...prev.teams[team].players, blankPlayer()] },
        },
      })),
    addYouthPlayer: (team) =>
      setState((prev) => ({
        ...prev,
        teams: {
          ...prev.teams,
          [team]: { ...prev.teams[team], players: [...prev.teams[team].players, youthPlayer()] },
        },
      })),
    removePlayer: (team, index) =>
      setState((prev) => ({
        ...prev,
        teams: {
          ...prev.teams,
          [team]: { ...prev.teams[team], players: prev.teams[team].players.filter((_, i) => i !== index) },
        },
      })),
    renameTeam: (oldName, newName) =>
      setState((prev) => {
        const trimmed = newName.trim();
        if (!trimmed || trimmed === oldName || prev.teams[trimmed]) return prev;
        const teamOrder = prev.teamOrder.map((n) => (n === oldName ? trimmed : n));
        const teams: Record<string, LeagueTeam> = {};
        for (const n of prev.teamOrder) {
          if (n === oldName) teams[trimmed] = { ...prev.teams[oldName], name: trimmed };
          else teams[n] = prev.teams[n];
        }
        const fixtures = prev.fixtures.map((f) => ({
          ...f,
          home: f.home === oldName ? trimmed : f.home,
          away: f.away === oldName ? trimmed : f.away,
        }));
        let playoffs = prev.playoffs;
        if (playoffs) {
          playoffs = {
            ...playoffs,
            seeds: playoffs.seeds.map((s) => (s === oldName ? trimmed : s)),
            champion: playoffs.champion === oldName ? trimmed : playoffs.champion,
            rounds: playoffs.rounds.map((round) =>
              round.map((m) => ({
                ...m,
                home: m.home === oldName ? trimmed : m.home,
                away: m.away === oldName ? trimmed : m.away,
              }))
            ),
          };
        }
        const tradeProposals = prev.tradeProposals.map((t) => ({
          ...t,
          teamA: t.teamA === oldName ? trimmed : t.teamA,
          teamB: t.teamB === oldName ? trimmed : t.teamB,
        }));
        return { ...prev, teamOrder, teams, fixtures, playoffs, tradeProposals };
      }),
    addFixtures: (entries) =>
      setState((prev) => {
        const base = prev.fixtures.length;
        const added: FixtureEntry[] = entries.map((e, i) => ({
          id: `s${prev.season}-w${e.week}-m${base + i}-${Date.now() + i}`,
          week: e.week,
          home: e.home,
          away: e.away,
        }));
        return advanceWeekIfComplete({ ...prev, fixtures: [...prev.fixtures, ...added] }, new Set());
      }),
    removeFixture: (fixtureId) =>
      setState((prev) => {
        const fixtures = prev.fixtures.filter((f) => f.id !== fixtureId);
        const results = { ...prev.results };
        delete results[fixtureId];
        const payloads = { ...prev.payloads };
        delete payloads[fixtureId];
        return { ...prev, fixtures, results, payloads };
      }),
    scheduleFinalFour: (entries) =>
      setState((prev) => {
        const base = prev.fixtures.length;
        const added: FixtureEntry[] = entries.map((e, i) => ({
          id: `s${prev.season}-w${e.week}-m${base + i}-${Date.now() + i}`,
          week: e.week,
          home: e.home,
          away: e.away,
        }));
        return advanceWeekIfComplete({ ...prev, fixtures: [...prev.fixtures, ...added] }, new Set());
      }),
    scheduleNewSeason: (entries) =>
      setState((prev) => {
        // Carry rosters & budgets; clear everything else and lay down the new
        // 12-week schedule in one step (this starts the new season).
        const season = prev.season + 1;
        const teams: Record<string, LeagueTeam> = {};
        for (const name of prev.teamOrder) {
          const t = prev.teams[name];
          teams[name] = {
            ...t,
            players: t.players.map((p) => ({ ...p, injuryWeeks: 0, suspensionWeeks: 0, yellowLog: [] })),
          };
        }
        const fixtures: FixtureEntry[] = entries.map((e, i) => ({
          id: `s${season}-w${e.week}-m${i}-${Date.now() + i}`,
          week: e.week,
          home: e.home,
          away: e.away,
        }));
        return {
          ...prev,
          season,
          currentWeek: 1,
          fixtures,
          results: {},
          payloads: {},
          playoffs: undefined,
          tradeProposals: [],
          snapshots: [],
          teams,
        };
      }),
    startNewSeason: () =>
      setState((prev) => {
        // Keep rosters & budgets; clear results/fixtures/playoffs and all
        // injury/suspension counters; reset to a fresh pre-season.
        const teams: Record<string, LeagueTeam> = {};
        for (const name of prev.teamOrder) {
          const t = prev.teams[name];
          teams[name] = {
            ...t,
            players: t.players.map((p) => ({ ...p, injuryWeeks: 0, suspensionWeeks: 0, yellowLog: [] })),
          };
        }
        return {
          ...prev,
          season: prev.season + 1,
          currentWeek: 1,
          fixtures: [],
          results: {},
          payloads: {},
          playoffs: undefined,
          tradeProposals: [],
          snapshots: [],
          teams,
        };
      }),
    generatePlayoffs: () =>
      setState((prev) => {
        if (prev.playoffs) return prev;
        return { ...prev, playoffs: buildPlayoffs(prev) };
      }),
    setPlayoffResult: (matchId, homeGoals, awayGoals, method, payload) =>
      setState((prev) => {
        if (!prev.playoffs) return prev;
        const { teams } = applyMatchEffects(
          prev.teams, payload, payload?.injuries, prev.currentWeek
        );
        const rounds = prev.playoffs.rounds.map((round) =>
          round.map((m) =>
            m.id === matchId ? { ...m, result: { homeGoals, awayGoals, method } } : m
          )
        );
        return {
          ...prev,
          teams,
          payloads: payload ? { ...prev.payloads, [matchId]: payload } : prev.payloads,
          playoffs: advancePlayoffs({ ...prev.playoffs, rounds }),
        };
      }),
    executeTrade: (proposal) =>
      setState((prev) => {
        const next = applyTrade(prev, proposal);
        if (next === prev) return prev;
        return { ...next, tradeProposals: next.tradeProposals.filter((t) => t.id !== proposal.id) };
      }),
    declineTrade: (proposalId) =>
      setState((prev) => ({
        ...prev,
        tradeProposals: prev.tradeProposals.filter((t) => t.id !== proposalId),
      })),
    refreshTradeProposals: () =>
      setState((prev) => ({ ...prev, tradeProposals: generateTradeProposals(prev) })),
    resetLeague: () => setState(initState()),
  };

  return <LeagueContext.Provider value={value}>{children}</LeagueContext.Provider>;
}

export function useLeague(): LeagueContextValue {
  const ctx = useContext(LeagueContext);
  if (!ctx) throw new Error("useLeague must be used within LeagueProvider");
  return ctx;
}
