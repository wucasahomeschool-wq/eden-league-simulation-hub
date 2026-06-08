// League state: types, localStorage persistence, initialization, and actions.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { RAW_TEAMS } from "@/data/rosters";
import { INITIAL_BUDGETS } from "@/data/budgets";
import { INITIAL_SCHEDULE, MANUAL_ONLY_TEAMS } from "@/data/schedule";
import { buildEngineTeam, run_match } from "@/engine/engine";
import { computeOverall } from "@/lib/ratings";
import { computeStartingAge, ageOnePlayer } from "@/lib/aging";
import { buildMatchPayload, type MatchPayload } from "@/lib/match-payload";
import {
  applyTeamEvent, applyPlayerEvent, moraleScaledAttrs, MORALE_BASELINE,
  EXEMPT_TEAMS, clampMorale,
} from "@/lib/morale";
import {
  generateTradeProposals, parseBudget, formatBudget, type TradeProposal,
} from "@/lib/trades";

const STORAGE_KEY = "eden_league_state_v5";
const LEGACY_STORAGE_KEYS = ["eden_league_state_v4", "eden_league_state_v3", "eden_league_state_v2", "eden_league_state_v1"];

// Transfer window: the automatic trade engine only runs at the end of regular
// season match weeks (1–12).
export const TRANSFER_WINDOW_LAST_WEEK = 12;
// A weeks-out value at or above this is treated as "out for the rest of the season".
export const SEASON_ENDING_WEEKS = 99;
// Disciplinary thresholds.
const YELLOW_WINDOW_WEEKS = 2; // 2 yellows within this many weeks => suspension
const YELLOW_SUSPENSION = 1;
const RED_SUSPENSION = 2;

export const DEFAULT_FORMATION = "3-3-2";
const MAX_UNDO = 60;

export const ATTR_KEYS = [
  "rating", "FIN", "SHO", "PAS", "VIS", "DRI", "PAC", "STA",
  "DEF", "TAC", "POS_attr", "COM", "WR", "AGG", "STR", "AER",
] as const;
export type AttrKey = (typeof ATTR_KEYS)[number];

export interface LeaguePlayer {
  name: string;
  position: string;
  starter: boolean;
  age: number;
  morale: number; // 0–100, baseline 50
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
  morale: number; // 0–100, baseline 50
  formation: string; // e.g. "3-3-2" (DEF-MID-ATT, GK implicit)
  lineup: string[]; // ordered slot assignments (player names; "" = empty)
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
  undoStack: string[]; // serialized prior states (universal undo)
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

export type PosGroup = "GK" | "DF" | "MF" | "ST";
const DF_POS = ["CB", "LB", "RB", "LWB", "RWB", "FB"];
const MF_POS = ["CDM", "CM", "CAM", "LM", "RM"];
const ST_POS = ["ST", "CF", "LW", "RW", "WINGER"];

export function positionGroup(pos: string): PosGroup {
  const p = (pos || "").toUpperCase().trim();
  if (p === "GK") return "GK";
  if (DF_POS.includes(p)) return "DF";
  if (MF_POS.includes(p)) return "MF";
  if (ST_POS.includes(p)) return "ST";
  return "MF";
}

export function parseFormation(f: string): { def: number; mid: number; att: number } {
  const parts = (f || "").split("-").map((n) => parseInt(n.trim(), 10)).filter((n) => !isNaN(n));
  if (parts.length === 3 && parts[0] + parts[1] + parts[2] === 8) {
    return { def: parts[0], mid: parts[1], att: parts[2] };
  }
  return { def: 3, mid: 3, att: 2 };
}

export interface LineupSlot { group: PosGroup; label: string; }
export function buildLineupSlots(formation: string): LineupSlot[] {
  const { def, mid, att } = parseFormation(formation);
  const slots: LineupSlot[] = [{ group: "GK", label: "GK" }];
  for (let i = 0; i < def; i++) slots.push({ group: "DF", label: `DF${i + 1}` });
  for (let i = 0; i < mid; i++) slots.push({ group: "MF", label: `MF${i + 1}` });
  for (let i = 0; i < att; i++) slots.push({ group: "ST", label: `ST${i + 1}` });
  return slots;
}

// Pick a sensible default lineup from the available roster honoring slot groups.
export function buildDefaultLineup(players: LeaguePlayer[], formation: string): string[] {
  const slots = buildLineupSlots(formation);
  const used = new Set<string>();
  const ranked = [...players].sort((a, b) => b.rating - a.rating);
  const lineup: string[] = [];
  for (const slot of slots) {
    let pick = ranked.find((p) => !used.has(p.name) && !isPlayerOut(p) && positionGroup(p.position) === slot.group);
    if (!pick) pick = ranked.find((p) => !used.has(p.name) && !isPlayerOut(p));
    if (!pick) pick = ranked.find((p) => !used.has(p.name));
    if (pick) { used.add(pick.name); lineup.push(pick.name); }
    else lineup.push("");
  }
  return lineup;
}

// Re-derive each player's `starter` flag from the team lineup.
export function syncStarters(team: LeagueTeam): LeagueTeam {
  const inLineup = new Set(team.lineup.filter(Boolean));
  return {
    ...team,
    players: team.players.map((p) => ({ ...p, starter: inLineup.has(p.name) })),
  };
}

export function blankPlayer(): LeaguePlayer {
  const base: LeaguePlayer = {
    name: "New Player", position: "CM", starter: false,
    age: 24, morale: MORALE_BASELINE,
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
    age: 18, morale: MORALE_BASELINE,
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
    const players = t.roster.map((p, i) => {
      const player: LeaguePlayer = {
        name: p.name,
        position: p.position,
        starter: i < 9,
        age: 25,
        morale: MORALE_BASELINE,
        injuryWeeks: 0,
        suspensionWeeks: 0,
        yellowLog: [],
        rating: p.rating, FIN: p.FIN, SHO: p.SHO, PAS: p.PAS, VIS: p.VIS, DRI: p.DRI,
        PAC: p.PAC, STA: p.STA, DEF: p.DEF, TAC: p.TAC, POS_attr: p.POS_attr, COM: p.COM,
        WR: p.WR, AGG: p.AGG, STR: p.STR, AER: p.AER,
      };
      const withAge = { ...player, age: computeStartingAge(player) };
      return { ...withAge, rating: computeOverall(withAge) };
    });
    const lineup = buildDefaultLineup(players, DEFAULT_FORMATION);
    teams[t.name] = syncStarters({
      name: t.name,
      tactical_style: t.tactical_style,
      budget: INITIAL_BUDGETS[t.name] ?? "$0M",
      morale: MORALE_BASELINE,
      formation: DEFAULT_FORMATION,
      lineup,
      players,
    });
  }
  const fixtures: FixtureEntry[] = INITIAL_SCHEDULE.map((f, i) => ({
    id: `w${f.week}-m${i}`,
    week: f.week,
    home: f.home,
    away: f.away,
  }));
  return {
    currentWeek: 1, season: 1, teamOrder, teams, fixtures,
    results: {}, payloads: {}, tradeProposals: [], undoStack: [],
  };
}

// Ensure migrated/older state has all required fields.
function normalize(state: LeagueState): LeagueState {
  const teams: Record<string, LeagueTeam> = {};
  for (const name of state.teamOrder) {
    const t = state.teams[name];
    const players = t.players.map((p) => {
      const player: LeaguePlayer = {
        ...p,
        injuryWeeks: p.injuryWeeks ?? 0,
        suspensionWeeks: p.suspensionWeeks ?? 0,
        yellowLog: p.yellowLog ?? [],
        morale: p.morale ?? MORALE_BASELINE,
        age: p.age ?? 25,
      };
      const withAge = player.age ? player : { ...player, age: computeStartingAge(player) };
      return { ...withAge, rating: computeOverall(withAge) };
    });
    const formation = t.formation ?? DEFAULT_FORMATION;
    let lineup = t.lineup;
    if (!lineup || lineup.length === 0) {
      // Migrate from old `starter` booleans, falling back to a default lineup.
      const starters = players.filter((p) => p.starter).map((p) => p.name);
      lineup = starters.length === buildLineupSlots(formation).length
        ? starters
        : buildDefaultLineup(players, formation);
    }
    teams[name] = syncStarters({
      ...t,
      morale: t.morale ?? MORALE_BASELINE,
      formation,
      lineup,
      players,
    });
  }
  return {
    ...state,
    season: state.season ?? 1,
    tradeProposals: state.tradeProposals ?? [],
    payloads: state.payloads ?? {},
    undoStack: state.undoStack ?? [],
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
// available bench. Injured/suspended players are excluded entirely. Morale
// scales the attributes fed into the engine.
export function rosterForEngine(team: LeagueTeam) {
  const available = team.players.filter((p) => !isPlayerOut(p));
  const inLineup = new Set(team.lineup.filter(Boolean));
  const starters = available.filter((p) => inLineup.has(p.name));
  const bench = available.filter((p) => !inLineup.has(p.name));
  return [...starters, ...bench].map((p) => {
    const a = moraleScaledAttrs(p, team.morale, p.morale);
    return {
      name: p.name, position: p.position, rating: a.rating,
      FIN: a.FIN, SHO: a.SHO, PAS: a.PAS, VIS: a.VIS, DRI: a.DRI, PAC: a.PAC, STA: a.STA,
      DEF: a.DEF, TAC: a.TAC, POS_attr: a.POS_attr, COM: a.COM, WR: a.WR, AGG: a.AGG,
      STR: a.STR, AER: a.AER,
    };
  });
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

  const payload = buildMatchPayload(
    engineHome, engineAway, home, away, result.homeGoals, result.awayGoals
  );
  return { ...result, injured: payload.injuries, payload };
}

// ---------------- Match effects (injuries + disciplinary) ----------------
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

// ---------------- Morale: match events ----------------
// Mutates clones of the two affected clubs in the teams map and returns a new
// map. Disciplinary/injury changes already applied to those players are kept.
function applyMatchMorale(
  teams: Record<string, LeagueTeam>,
  standings: StandingRow[],
  homeName: string,
  awayName: string,
  homeGoals: number,
  awayGoals: number,
  payload: MatchPayload | undefined
): Record<string, LeagueTeam> {
  const next = { ...teams };
  const clone = (name: string): LeagueTeam | undefined => {
    if (!next[name]) return undefined;
    const t: LeagueTeam = { ...next[name], players: next[name].players.map((p) => ({ ...p })) };
    next[name] = t;
    return t;
  };
  const home = clone(homeName);
  const away = clone(awayName);
  if (!home || !away) return next;

  const rankOf = (name: string) => standings.find((s) => s.team === name)?.rank ?? 99;
  const total = standings.length;
  const top5 = (name: string) => rankOf(name) <= 5;
  const bottom5 = (name: string) => rankOf(name) > total - 5;

  // Team macro events (apply to all 24 clubs).
  if (homeGoals === awayGoals) {
    applyTeamEvent(home, "stalemate");
    applyTeamEvent(away, "stalemate");
  } else {
    const winner = homeGoals > awayGoals ? home : away;
    const loser = homeGoals > awayGoals ? away : home;
    applyTeamEvent(winner, top5(loser.name) ? "elite_victory" : "standard_victory");
    applyTeamEvent(loser, bottom5(winner.name) ? "upset_defeat" : "standard_defeat");
  }

  // Player micro events (exempt clubs are skipped inside applyPlayerEvent).
  if (payload) {
    const sideOf = (teamName: string) => (teamName === home.name ? home : teamName === away.name ? away : undefined);
    for (const ps of payload.players) {
      const side = sideOf(ps.team);
      if (!side) continue;
      const player = side.players.find((p) => p.name === ps.name);
      if (!player) continue;
      for (let i = 0; i < ps.goals; i++) applyPlayerEvent(side, player, "goal");
      for (let i = 0; i < ps.assists; i++) applyPlayerEvent(side, player, "assist");
      for (let i = 0; i < ps.yellow; i++) applyPlayerEvent(side, player, "yellow_card");
      if (ps.red) applyPlayerEvent(side, player, "red_card");
      if (ps.injured) applyPlayerEvent(side, player, "injured");
    }
    for (const g of payload.goalkeepers) {
      const side = sideOf(g.team);
      if (!side || !g.cleanSheet) continue;
      const keeper = side.players.find((p) => p.name === g.name);
      if (keeper) applyPlayerEvent(side, keeper, "clean_sheet");
    }
    // Locker room crisis: a starter injured during the match.
    for (const inj of payload.injuries) {
      const side = sideOf(inj.team);
      if (side) applyTeamEvent(side, "locker_room_crisis");
    }
  }

  return next;
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
  undo: () => void;
  canUndo: boolean;
  updateBudget: (team: string, budget: string) => void;
  updatePlayer: (team: string, index: number, patch: Partial<LeaguePlayer>) => void;
  setLineupSlot: (team: string, slot: number, playerName: string) => void;
  setFormation: (team: string, formation: string) => void;
  autoFillLineup: (team: string) => void;
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
  executeManualTrade: (teamA: string, teamB: string, aPlayers: string[], bPlayers: string[], cashAReceives: number, cashBReceives: number) => void;
  declineTrade: (proposalId: string) => void;
  refreshTradeProposals: () => void;
  resetLeague: () => void;
  standings: StandingRow[];
  leaderboards: Leaderboards;
}

const LeagueContext = createContext<LeagueContextValue | null>(null);

// Auto-promote acquired players into the lineup if they outrate the current
// starter in their position group (feature: new acquisitions take a spot).
function autoPromote(team: LeagueTeam, incoming: LeaguePlayer[]): LeagueTeam {
  const slots = buildLineupSlots(team.formation);
  const lineup = [...team.lineup];
  for (const inc of incoming) {
    const g = positionGroup(inc.position);
    let worstIdx = -1;
    let worstRating = Infinity;
    slots.forEach((s, i) => {
      if (s.group !== g) return;
      if (lineup[i] === inc.name) { worstIdx = -2; return; } // already starting
      const cur = team.players.find((p) => p.name === lineup[i]);
      const r = cur ? cur.rating : -1;
      if (r < worstRating) { worstRating = r; worstIdx = i; }
    });
    if (worstIdx >= 0 && inc.rating > worstRating) lineup[worstIdx] = inc.name;
  }
  return { ...team, lineup };
}

// Core multi-player trade: move named players + cash between two clubs, apply
// morale events, auto-promote upgrades, and re-sync lineups.
function moveTrade(
  prev: LeagueState,
  aName: string,
  bName: string,
  aPlayers: string[],
  bPlayers: string[],
  cashAReceives: number,
  cashBReceives: number
): LeagueState {
  if (aName === bName) return prev;
  const teamA = prev.teams[aName];
  const teamB = prev.teams[bName];
  if (!teamA || !teamB) return prev;

  const aSet = new Set(aPlayers.filter(Boolean));
  const bSet = new Set(bPlayers.filter(Boolean));
  const movingFromA = teamA.players.filter((p) => aSet.has(p.name)).map((p) => ({ ...p, starter: false }));
  const movingFromB = teamB.players.filter((p) => bSet.has(p.name)).map((p) => ({ ...p, starter: false }));
  if (!movingFromA.length && !movingFromB.length && cashAReceives === 0 && cashBReceives === 0) return prev;

  const aBudgetBefore = parseBudget(teamA.budget);
  const bBudgetBefore = parseBudget(teamB.budget);

  let aTeam: LeagueTeam = {
    ...teamA,
    budget: formatBudget(aBudgetBefore + cashAReceives - cashBReceives),
    lineup: teamA.lineup.map((n) => (aSet.has(n) ? "" : n)),
    players: teamA.players.filter((p) => !aSet.has(p.name)).concat(movingFromB),
  };
  let bTeam: LeagueTeam = {
    ...teamB,
    budget: formatBudget(bBudgetBefore + cashBReceives - cashAReceives),
    lineup: teamB.lineup.map((n) => (bSet.has(n) ? "" : n)),
    players: teamB.players.filter((p) => !bSet.has(p.name)).concat(movingFromA),
  };

  // Auto-promote upgrades into the lineup.
  aTeam = autoPromote(aTeam, movingFromB);
  bTeam = autoPromote(bTeam, movingFromA);

  // Team morale: market triumph for both; asset depletion when sending without
  // receiving a player back.
  applyTeamEvent(aTeam, "market_triumph");
  applyTeamEvent(bTeam, "market_triumph");
  if (movingFromA.length > 0 && movingFromB.length === 0) applyTeamEvent(aTeam, "asset_depletion");
  if (movingFromB.length > 0 && movingFromA.length === 0) applyTeamEvent(bTeam, "asset_depletion");

  // Player career promotion / demotion based on destination club budget.
  for (const moved of movingFromA) {
    const player = bTeam.players.find((p) => p.name === moved.name);
    if (!player) continue;
    if (bBudgetBefore > aBudgetBefore) applyPlayerEvent(bTeam, player, "career_promotion");
    else if (bBudgetBefore < aBudgetBefore) applyPlayerEvent(bTeam, player, "career_demotion");
  }
  for (const moved of movingFromB) {
    const player = aTeam.players.find((p) => p.name === moved.name);
    if (!player) continue;
    if (aBudgetBefore > bBudgetBefore) applyPlayerEvent(aTeam, player, "career_promotion");
    else if (aBudgetBefore < bBudgetBefore) applyPlayerEvent(aTeam, player, "career_demotion");
  }

  aTeam = syncStarters(aTeam);
  bTeam = syncStarters(bTeam);

  return { ...prev, teams: { ...prev.teams, [aName]: aTeam, [bName]: bTeam } };
}

// Offseason aging + retirement for one club.
function offseasonTeam(team: LeagueTeam): LeagueTeam {
  const players: LeaguePlayer[] = [];
  let moraleBump = 0;
  for (const p of team.players) {
    const res = ageOnePlayer({ ...p, injuryWeeks: 0, suspensionWeeks: 0, yellowLog: [] });
    if (res.veteranFulfilled) moraleBump += 1;
    players.push(res.retired ? res.replacement! : res.player);
  }
  // Veteran fulfillment lifts overall club morale slightly.
  const morale = Math.max(0, Math.min(100, team.morale + moraleBump * 2));
  const lineup = buildDefaultLineup(players, team.formation);
  return syncStarters({ ...team, players, morale, lineup });
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

  // Universal undo: every mutating action snapshots the prior state.
  function update(producer: (prev: LeagueState) => LeagueState) {
    setState((prev) => {
      const next = producer(prev);
      if (next === prev) return prev;
      const snap = JSON.stringify({ ...prev, undoStack: [] });
      return { ...next, undoStack: [...prev.undoStack, snap].slice(-MAX_UNDO) };
    });
  }

  function onWeekAdvanced(next: LeagueState, protectedKeys: Set<string>): LeagueState {
    const teams: Record<string, LeagueTeam> = {};
    for (const name of next.teamOrder) {
      const t = next.teams[name];
      const inLineup = new Set(t.lineup.filter(Boolean));
      const exempt = EXEMPT_TEAMS.has(name);
      const players = t.players.map((p) => {
        let np = p;
        if (!protectedKeys.has(`${name}::${p.name}`) && (p.injuryWeeks > 0 || p.suspensionWeeks > 0)) {
          const wasOut = p.injuryWeeks > 0 || p.suspensionWeeks > 0;
          np = {
            ...p,
            injuryWeeks: p.injuryWeeks >= SEASON_ENDING_WEEKS ? p.injuryWeeks : Math.max(0, p.injuryWeeks - 1),
            suspensionWeeks: Math.max(0, p.suspensionWeeks - 1),
          };
          // Comeback: returned to availability this week.
          if (wasOut && np.injuryWeeks === 0 && np.suspensionWeeks === 0) {
            np = { ...np, morale: clampMorale(np.morale + 15) };
          }
        }
        // Weekly selection / bench morale (player micro-events skip exempt clubs).
        if (!exempt && np.injuryWeeks === 0 && np.suspensionWeeks === 0) {
          const delta = inLineup.has(np.name) ? 5 : -10;
          np = { ...np, morale: clampMorale(np.morale + delta) };
        }
        return np;
      });
      teams[name] = { ...t, players };
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
      return onWeekAdvanced({ ...next, currentWeek: wk + 1 }, protectedKeys);
    }
    return onWeekAdvanced(next, protectedKeys);
  }

  const value: LeagueContextValue = {
    state,
    standings,
    leaderboards,
    canUndo: state.undoStack.length > 0,
    setResult: (fixtureId, homeGoals, awayGoals, method, payload) =>
      update((prev) => {
        const fixture = prev.fixtures.find((f) => f.id === fixtureId);
        const preStandings = computeStandings(prev);
        const { teams, protectedKeys } = applyMatchEffects(
          prev.teams, payload, payload?.injuries, prev.currentWeek
        );
        const moraleTeams = fixture
          ? applyMatchMorale(teams, preStandings, fixture.home, fixture.away, homeGoals, awayGoals, payload)
          : teams;
        const next: LeagueState = {
          ...prev,
          teams: moraleTeams,
          results: { ...prev.results, [fixtureId]: { homeGoals, awayGoals, method } },
          payloads: payload ? { ...prev.payloads, [fixtureId]: payload } : prev.payloads,
        };
        return advanceWeekIfComplete(next, protectedKeys);
      }),
    undo: () =>
      setState((prev) => {
        if (!prev.undoStack.length) return prev;
        const stack = [...prev.undoStack];
        const last = stack.pop()!;
        try {
          const restored = JSON.parse(last) as LeagueState;
          return normalize({ ...restored, undoStack: stack });
        } catch {
          return prev;
        }
      }),
    updateBudget: (team, budget) =>
      update((prev) => ({
        ...prev,
        teams: { ...prev.teams, [team]: { ...prev.teams[team], budget } },
      })),
    updatePlayer: (team, index, patch) =>
      update((prev) => {
        const oldName = prev.teams[team].players[index]?.name;
        const players = prev.teams[team].players.map((p, i) => {
          if (i !== index) return p;
          const merged = { ...p, ...patch };
          return { ...merged, rating: computeOverall(merged) };
        });
        // If the player was renamed, keep the lineup reference in sync.
        const newName = players[index]?.name;
        let lineup = prev.teams[team].lineup;
        if (oldName && newName && oldName !== newName) {
          lineup = lineup.map((n) => (n === oldName ? newName : n));
        }
        return {
          ...prev,
          teams: { ...prev.teams, [team]: syncStarters({ ...prev.teams[team], players, lineup }) },
        };
      }),
    setLineupSlot: (team, slot, playerName) =>
      update((prev) => {
        const t = prev.teams[team];
        const lineup = [...t.lineup];
        // Prevent duplicates: clear the player from any other slot first.
        for (let i = 0; i < lineup.length; i++) {
          if (lineup[i] === playerName && i !== slot) lineup[i] = "";
        }
        lineup[slot] = playerName;
        return { ...prev, teams: { ...prev.teams, [team]: syncStarters({ ...t, lineup }) } };
      }),
    setFormation: (team, formation) =>
      update((prev) => {
        const t = prev.teams[team];
        const slots = buildLineupSlots(formation);
        const oldLineup = t.lineup;
        const lineup = slots.map((_, i) => oldLineup[i] ?? "");
        return { ...prev, teams: { ...prev.teams, [team]: syncStarters({ ...t, formation, lineup }) } };
      }),
    autoFillLineup: (team) =>
      update((prev) => {
        const t = prev.teams[team];
        const lineup = buildDefaultLineup(t.players, t.formation);
        return { ...prev, teams: { ...prev.teams, [team]: syncStarters({ ...t, lineup }) } };
      }),
    setInjuryWeeks: (team, index, weeks) =>
      update((prev) => {
        const players = prev.teams[team].players.map((p, i) =>
          i === index ? { ...p, injuryWeeks: Math.max(0, weeks) } : p
        );
        return { ...prev, teams: { ...prev.teams, [team]: { ...prev.teams[team], players } } };
      }),
    setSuspensionWeeks: (team, index, weeks) =>
      update((prev) => {
        const players = prev.teams[team].players.map((p, i) =>
          i === index ? { ...p, suspensionWeeks: Math.max(0, weeks) } : p
        );
        return { ...prev, teams: { ...prev.teams, [team]: { ...prev.teams[team], players } } };
      }),
    addPlayer: (team) =>
      update((prev) => ({
        ...prev,
        teams: {
          ...prev.teams,
          [team]: { ...prev.teams[team], players: [...prev.teams[team].players, blankPlayer()] },
        },
      })),
    addYouthPlayer: (team) =>
      update((prev) => ({
        ...prev,
        teams: {
          ...prev.teams,
          [team]: { ...prev.teams[team], players: [...prev.teams[team].players, youthPlayer()] },
        },
      })),
    removePlayer: (team, index) =>
      update((prev) => {
        const t = prev.teams[team];
        const removed = t.players[index]?.name;
        const players = t.players.filter((_, i) => i !== index);
        const lineup = t.lineup.map((n) => (n === removed ? "" : n));
        return { ...prev, teams: { ...prev.teams, [team]: syncStarters({ ...t, players, lineup }) } };
      }),
    renameTeam: (oldName, newName) =>
      update((prev) => {
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
      update((prev) => {
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
      update((prev) => {
        const fixtures = prev.fixtures.filter((f) => f.id !== fixtureId);
        const results = { ...prev.results };
        delete results[fixtureId];
        const payloads = { ...prev.payloads };
        delete payloads[fixtureId];
        return { ...prev, fixtures, results, payloads };
      }),
    scheduleFinalFour: (entries) =>
      update((prev) => {
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
      update((prev) => {
        // Offseason: age all squads, run retirements, carry rosters/budgets/morale.
        const season = prev.season + 1;
        const teams: Record<string, LeagueTeam> = {};
        for (const name of prev.teamOrder) {
          teams[name] = offseasonTeam(prev.teams[name]);
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
          teams,
        };
      }),
    startNewSeason: () =>
      update((prev) => {
        const teams: Record<string, LeagueTeam> = {};
        for (const name of prev.teamOrder) {
          teams[name] = offseasonTeam(prev.teams[name]);
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
          teams,
        };
      }),
    generatePlayoffs: () =>
      update((prev) => {
        if (prev.playoffs) return prev;
        return { ...prev, playoffs: buildPlayoffs(prev) };
      }),
    setPlayoffResult: (matchId, homeGoals, awayGoals, method, payload) =>
      update((prev) => {
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
      update((prev) => {
        const next = moveTrade(
          prev, proposal.teamA, proposal.teamB,
          [proposal.aSends], [proposal.bSends],
          proposal.cashAReceives, proposal.cashBReceives
        );
        if (next === prev) return prev;
        return { ...next, tradeProposals: next.tradeProposals.filter((t) => t.id !== proposal.id) };
      }),
    executeManualTrade: (teamA, teamB, aPlayers, bPlayers, cashAReceives, cashBReceives) =>
      update((prev) => moveTrade(prev, teamA, teamB, aPlayers, bPlayers, cashAReceives, cashBReceives)),
    declineTrade: (proposalId) =>
      update((prev) => ({
        ...prev,
        tradeProposals: prev.tradeProposals.filter((t) => t.id !== proposalId),
      })),
    refreshTradeProposals: () =>
      update((prev) => ({ ...prev, tradeProposals: generateTradeProposals(prev) })),
    resetLeague: () => setState(initState()),
  };

  return <LeagueContext.Provider value={value}>{children}</LeagueContext.Provider>;
}

export function useLeague(): LeagueContextValue {
  const ctx = useContext(LeagueContext);
  if (!ctx) throw new Error("useLeague must be used within LeagueProvider");
  return ctx;
}
