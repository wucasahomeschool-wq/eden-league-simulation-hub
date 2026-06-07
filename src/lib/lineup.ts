// Matchday & Lineup Safety Validation Layer.
// Runs immediately before a match simulation is permitted. A legal lineup is
// exactly 9 healthy, non-suspended players in the starting group, with no
// injured/suspended player left in the starting nine. If a team's total pool of
// healthy players drops below 9, an emergency youth fill-in is required.
import { isPlayerOut, type LeagueTeam } from "@/state/league";

export interface LineupValidation {
  ok: boolean;
  errors: string[];
  emergency: boolean; // healthy pool < 9 — must add players to proceed
  healthyTotal: number;
  healthyStarters: number;
  outStarters: number;
}

export function validateLineup(team: LeagueTeam): LineupValidation {
  const errors: string[] = [];
  const healthy = team.players.filter((p) => !isPlayerOut(p));
  const healthyStarters = team.players.filter((p) => p.starter && !isPlayerOut(p)).length;
  const outStarters = team.players.filter((p) => p.starter && isPlayerOut(p)).length;
  const healthyTotal = healthy.length;

  const emergency = healthyTotal < 9;
  if (emergency) {
    errors.push(
      `${team.name} has only ${healthyTotal} healthy player${healthyTotal === 1 ? "" : "s"} — an injury crisis. Add blank or youth players to reach 9 before the match can be played.`
    );
  }

  if (outStarters > 0) {
    errors.push(
      `${outStarters} injured/suspended player${outStarters === 1 ? " is" : "s are"} still flagged as a starter for ${team.name}. Remove them from the starting nine.`
    );
  }

  if (!emergency && healthyStarters !== 9) {
    errors.push(
      `${team.name} must field exactly 9 healthy starters (currently ${healthyStarters}). Adjust the starting lineup in the Team Editor.`
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    emergency,
    healthyTotal,
    healthyStarters,
    outStarters,
  };
}

export function validateMatchup(home: LeagueTeam, away: LeagueTeam): LineupValidation {
  const h = validateLineup(home);
  const a = validateLineup(away);
  return {
    ok: h.ok && a.ok,
    errors: [...h.errors, ...a.errors],
    emergency: h.emergency || a.emergency,
    healthyTotal: Math.min(h.healthyTotal, a.healthyTotal),
    healthyStarters: Math.min(h.healthyStarters, a.healthyStarters),
    outStarters: h.outStarters + a.outStarters,
  };
}
