// Simulation JSON Event Bridge.
// After a match completes, the engine's per-player state is read into a
// structured data payload (no extra RNG draws inside the match loop, so the
// engine's exact random sequence is preserved). The state manager intercepts
// this payload to update league statistics, apply disciplinary counts and roll
// injuries.
import type { EngineTeam } from "@/engine/engine";

export interface PlayerMatchStat {
  team: string;
  name: string;
  position: string;
  goals: number;
  assists: number;
  yellow: number;
  red: boolean;
  injured: boolean;
}

export interface GoalkeeperMatchStat {
  team: string;
  name: string;
  conceded: number;
  cleanSheet: boolean;
}

export interface MatchPayload {
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
  players: PlayerMatchStat[];
  goalkeepers: GoalkeeperMatchStat[];
  injuries: { team: string; name: string }[];
}

// Post-match assist attribution. Runs AFTER the match RNG sequence is complete,
// so it never disturbs the engine's deterministic event loop. Assists are
// distributed across the scoring team's creative outfielders (weighted by
// passing + vision), excluding the goal scorer where possible.
function attributeAssists(team: EngineTeam, goalsToAssign: number, scorerName: string) {
  const assists = new Map<string, number>();
  const all = [...team.active_roster, ...team.bench];
  const creators = all.filter((p) => p.position !== "GK");
  if (!creators.length) return assists;
  for (let g = 0; g < goalsToAssign; g++) {
    // ~70% of goals get an assist.
    if (Math.random() > 0.7) continue;
    const pool = creators.filter((p) => p.name !== scorerName);
    const candidates = pool.length ? pool : creators;
    const weights = candidates.map((p) => Math.max(0.1, p.PAS + p.VIS));
    const totalW = weights.reduce((s, w) => s + w, 0);
    let r = Math.random() * totalW;
    let chosen = candidates[candidates.length - 1];
    for (let i = 0; i < candidates.length; i++) {
      r -= weights[i];
      if (r <= 0) { chosen = candidates[i]; break; }
    }
    assists.set(chosen.name, (assists.get(chosen.name) ?? 0) + 1);
  }
  return assists;
}

export function buildMatchPayload(
  engineHome: EngineTeam,
  engineAway: EngineTeam,
  homeName: string,
  awayName: string,
  homeGoals: number,
  awayGoals: number
): MatchPayload {
  const players: PlayerMatchStat[] = [];
  const goalkeepers: GoalkeeperMatchStat[] = [];
  const injuries: { team: string; name: string }[] = [];

  const sides: { engine: EngineTeam; name: string; conceded: number }[] = [
    { engine: engineHome, name: homeName, conceded: awayGoals },
    { engine: engineAway, name: awayName, conceded: homeGoals },
  ];

  for (const side of sides) {
    const all = [...side.engine.active_roster, ...side.engine.bench];

    // Assist attribution per scorer.
    const teamAssists = new Map<string, number>();
    for (const p of all) {
      if (p.goals > 0) {
        const a = attributeAssists(side.engine, p.goals, p.name);
        for (const [name, count] of a) {
          teamAssists.set(name, (teamAssists.get(name) ?? 0) + count);
        }
      }
    }

    for (const p of all) {
      const assists = teamAssists.get(p.name) ?? 0;
      const played = p.fatigue > 0 || p.goals > 0 || p.yellow_cards > 0 || p.red_card || p.injured_severe || assists > 0;
      if (!played) continue;
      players.push({
        team: side.name,
        name: p.name,
        position: p.position,
        goals: p.goals,
        assists,
        yellow: p.yellow_cards,
        red: p.red_card,
        injured: p.injured_severe,
      });
      if (p.injured_severe) injuries.push({ team: side.name, name: p.name });
    }

    // Goalkeeper of record: the GK that played the most (first GK that took the field).
    const gk = all.find((p) => p.position === "GK" && (p.fatigue > 0 || all.filter((x) => x.position === "GK").length === 1))
      ?? all.find((p) => p.position === "GK");
    if (gk) {
      goalkeepers.push({
        team: side.name,
        name: gk.name,
        conceded: side.conceded,
        cleanSheet: side.conceded === 0,
      });
    }
  }

  return { home: homeName, away: awayName, homeGoals, awayGoals, players, goalkeepers, injuries };
}
