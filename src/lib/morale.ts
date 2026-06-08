// Eden League Morale Engine — faithful TypeScript port of the EdenMoraleEngine
// Python reference. Tracks rolling Team Morale (0–100, baseline 50) and
// Individual Player Morale (0–100, baseline 50), drives a dynamic event matrix,
// scales match-simulation weights, and triggers AI managerial sackings.
import type { LeaguePlayer, LeagueTeam } from "@/state/league";

// Manual score-entry clubs bypass player-level micro events (their match
// details are never simulated). Team-level macro events still apply to them.
export const EXEMPT_TEAMS = new Set(["Gugu Team", "Spams", "Socks"]);

export const MORALE_BASELINE = 50;
export const SACK_THRESHOLD = 25;
export const MANAGER_RENEWAL_MORALE = 60;
export const HIGH_MORALE = 75;
export const LOW_MORALE = 35;

// --- TEAM MORALE POINT MATRIX (engine reference values) ---
export const TEAM_EVENTS = {
  elite_victory: 12, // Victory against a top-5 ranked team
  standard_victory: 8, // Victory against any standard team
  stalemate: 2, // A drawn match
  standard_defeat: -8, // A standard match loss
  upset_defeat: -15, // Losing to a bottom-5 ranked team
  underdog_playoff_run: 30, // Bottom-5 team qualifying for playoffs
  high_budget_failure: -40, // Top-5 budget team missing playoffs
  locker_room_crisis: -10, // Key player injured during a match
  locker_room_boost: 10, // Key player returning from long-term IR
  market_triumph: 8, // High-utility trade completed
  asset_depletion: -12, // Important player sold without replacement
} as const;
export type TeamEvent = keyof typeof TEAM_EVENTS;

// --- PLAYER MORALE POINT MATRIX (engine reference values) ---
export const PLAYER_EVENTS = {
  goal: 10,
  assist: 8,
  clean_sheet: 12,
  starting_selection: 5,
  bench_penalty: -10, // healthy player benched (per week)
  red_card: -15,
  yellow_card: -3,
  injured: -20,
  comeback: 15,
  career_promotion: 15, // traded to a higher-prestige club
  career_demotion: -15, // traded to a lower-prestige club
  veteran_fulfillment: 10, // offseason veteran mental progression
} as const;
export type PlayerEvent = keyof typeof PLAYER_EVENTS;

const TACTICS = [
  "Balanced", "Possession", "Counterattack", "High Press",
  "Gegenpress", "Deep Block", "Chaos Attack",
];

export function clampMorale(v: number): number {
  return Math.max(0, Math.min(100, v));
}

// Apply a team macro event in place; returns whether a sacking was triggered.
export function applyTeamEvent(team: LeagueTeam, event: TeamEvent): boolean {
  team.morale = clampMorale((team.morale ?? MORALE_BASELINE) + TEAM_EVENTS[event]);
  if (team.morale < SACK_THRESHOLD) {
    triggerManagerSack(team);
    return true;
  }
  return false;
}

// Fire the manager: random new tactical mentality + morale reset to 60%.
export function triggerManagerSack(team: LeagueTeam): void {
  const options = TACTICS.filter((t) => t !== team.tactical_style);
  team.tactical_style = options[Math.floor(Math.random() * options.length)];
  team.morale = MANAGER_RENEWAL_MORALE;
}

// Apply a player micro event in place. Exempt clubs ignore player events.
export function applyPlayerEvent(
  team: LeagueTeam,
  player: LeaguePlayer,
  event: PlayerEvent
): void {
  if (EXEMPT_TEAMS.has(team.name)) return;
  player.morale = clampMorale((player.morale ?? MORALE_BASELINE) + PLAYER_EVENTS[event]);
}

// ---------------- Match simulation scaling ----------------
// Morale scales the attributes fed into the engine. Team morale applies a
// blanket optimization to every starter; individual morale nudges composure /
// positioning up when high, or degrades passing / tackling when low.
const ATTRS: (keyof LeaguePlayer)[] = [
  "rating", "FIN", "SHO", "PAS", "VIS", "DRI", "PAC", "STA",
  "DEF", "TAC", "POS_attr", "COM", "WR", "AGG", "STR", "AER",
];

export function teamMoraleFactor(teamMorale: number): number {
  if (teamMorale >= HIGH_MORALE) return 1.03;
  if (teamMorale <= LOW_MORALE) return 0.97;
  return 1.0;
}

const clampAttr = (n: number) => Math.max(1.0, Math.min(10.0, n));

// Return a shallow copy of the attribute set scaled by morale.
export function moraleScaledAttrs(
  player: LeaguePlayer,
  teamMorale: number,
  playerMorale: number
): Record<string, number> {
  const factor = teamMoraleFactor(teamMorale);
  const out: Record<string, number> = {};
  for (const key of ATTRS) {
    out[key] = clampAttr((player[key] as number) * factor);
  }
  const pm = playerMorale ?? MORALE_BASELINE;
  if (pm >= HIGH_MORALE) {
    out.POS_attr = clampAttr(out.POS_attr * 1.05);
    out.COM = clampAttr(out.COM * 1.05);
  } else if (pm <= LOW_MORALE) {
    out.PAS = clampAttr(out.PAS * 0.95);
    out.TAC = clampAttr(out.TAC * 0.95);
  }
  return out;
}

export function moraleLabel(morale: number): { text: string; tone: "high" | "mid" | "low" } {
  if (morale >= HIGH_MORALE) return { text: "Buoyant", tone: "high" };
  if (morale <= LOW_MORALE) return { text: "Fragile", tone: "low" };
  return { text: "Steady", tone: "mid" };
}
