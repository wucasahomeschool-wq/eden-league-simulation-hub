// Builds factual digests from REAL league state for the News Suite.
// Every string returned here is derived strictly from existing data —
// no random values, no fabricated stats. The AI narrates only these facts.
import type { LeagueState, StandingRow, Leaderboards } from "@/state/league";
import type { MatchPayload } from "@/lib/match-payload";

function ratingOf(state: LeagueState, team: string, name: string): string {
  const p = state.teams[team]?.players.find((pl) => pl.name === name);
  return p ? p.rating.toFixed(1) : "?";
}

function describePlayers(state: LeagueState, payload: MatchPayload): string {
  const lines: string[] = [];
  for (const p of payload.players) {
    const bits: string[] = [];
    if (p.goals > 0) bits.push(`${p.goals} goal${p.goals > 1 ? "s" : ""}`);
    if (p.assists > 0) bits.push(`${p.assists} assist${p.assists > 1 ? "s" : ""}`);
    if (p.yellow > 0) bits.push(`${p.yellow} yellow`);
    if (p.red) bits.push("red card");
    if (p.injured) bits.push("injured");
    if (bits.length === 0) continue;
    lines.push(
      `  - ${p.name} (${p.team}, ${p.position}, rating ${ratingOf(state, p.team, p.name)}): ${bits.join(", ")}`
    );
  }
  return lines.length ? lines.join("\n") : "  - No individual events recorded.";
}

export function buildPostgameBrief(state: LeagueState, fixtureId: string): string | null {
  const payload = state.payloads[fixtureId];
  const result = state.results[fixtureId];
  if (!payload || !result) return null;
  const fixture = state.fixtures.find((f) => f.id === fixtureId);
  const week = fixture?.week;

  const homeStyle = state.teams[payload.home]?.tactical_style ?? "?";
  const awayStyle = state.teams[payload.away]?.tactical_style ?? "?";

  const gkLines = payload.goalkeepers
    .map(
      (g) =>
        `  - ${g.name} (${g.team}): conceded ${g.conceded}${g.cleanSheet ? ", CLEAN SHEET" : ""}`
    )
    .join("\n");

  const injuries = payload.injuries.length
    ? payload.injuries.map((i) => `  - ${i.name} (${i.team})`).join("\n")
    : "  - None";

  return [
    `MATCH: ${payload.home} vs ${payload.away}${week ? ` (Week ${week})` : ""}`,
    `FINAL SCORE: ${payload.home} ${result.homeGoals} – ${result.awayGoals} ${payload.away}`,
    `Tactical styles: ${payload.home} play "${homeStyle}", ${payload.away} play "${awayStyle}".`,
    ``,
    `KEY PLAYER EVENTS:`,
    describePlayers(state, payload),
    ``,
    `GOALKEEPERS:`,
    gkLines || "  - Not recorded.",
    ``,
    `INJURIES IN THIS MATCH:`,
    injuries,
  ].join("\n");
}

function topScorers(lb: Leaderboards, n: number): string {
  return lb.scorers.slice(0, n)
    .map((s, i) => `  ${i + 1}. ${s.name} (${s.team}) — ${s.goals} goals, ${s.assists} assists`)
    .join("\n") || "  - No goals recorded yet.";
}

export function buildRoundupBrief(
  state: LeagueState,
  standings: StandingRow[],
  leaderboards: Leaderboards,
  week: number
): string | null {
  const weekFixtures = state.fixtures.filter((f) => f.week === week && state.results[f.id]);
  if (weekFixtures.length === 0) return null;

  const resultsLines = weekFixtures.map((f) => {
    const r = state.results[f.id];
    return `  - ${f.home} ${r.homeGoals} – ${r.awayGoals} ${f.away}`;
  }).join("\n");

  const tableTop = standings.slice(0, 6)
    .map((row) => `  ${row.rank}. ${row.team} — ${row.pts} pts (${row.w}W ${row.d}D ${row.l}L, GD ${row.gd >= 0 ? "+" : ""}${row.gd})`)
    .join("\n");

  const tableBottom = standings.slice(-3)
    .map((row) => `  ${row.rank}. ${row.team} — ${row.pts} pts (GD ${row.gd >= 0 ? "+" : ""}${row.gd})`)
    .join("\n");

  return [
    `EDEN LEAGUE — WEEK ${week} ROUNDUP`,
    ``,
    `WEEK ${week} RESULTS:`,
    resultsLines,
    ``,
    `STANDINGS (top of the table):`,
    tableTop,
    ``,
    `STANDINGS (bottom of the table):`,
    tableBottom,
    ``,
    `GOLDEN BOOT RACE (top scorers, season to date):`,
    topScorers(leaderboards, 5),
  ].join("\n");
}

export function buildDramaBrief(
  state: LeagueState,
  standings: StandingRow[],
  leaderboards: Leaderboards
): string {
  // Team morale extremes (real values stored on each team).
  const moraleSorted = state.teamOrder
    .map((name) => ({ name, morale: state.teams[name]?.morale ?? 50 }))
    .sort((a, b) => b.morale - a.morale);
  const happiest = moraleSorted.slice(0, 3)
    .map((t) => `  - ${t.name}: morale ${Math.round(t.morale)}`).join("\n");
  const unhappiest = moraleSorted.slice(-3)
    .map((t) => `  - ${t.name}: morale ${Math.round(t.morale)}`).join("\n");

  // Long-term / season-ending injuries currently on the books.
  const injured: string[] = [];
  for (const name of state.teamOrder) {
    for (const p of state.teams[name]?.players ?? []) {
      if (p.injuryWeeks > 0) injured.push(`  - ${p.name} (${name}): out ${p.injuryWeeks >= 99 ? "for the season" : `${p.injuryWeeks} wk`}`);
      else if (p.suspensionWeeks > 0) injured.push(`  - ${p.name} (${name}): suspended ${p.suspensionWeeks} wk`);
    }
  }

  const leader = standings[0];
  const chaser = standings[1];

  return [
    `EDEN LEAGUE — STORYLINES & DRAMA (season ${state.season}, week ${state.currentWeek})`,
    ``,
    leader
      ? `TITLE PICTURE: ${leader.team} lead on ${leader.pts} pts${chaser ? `, chased by ${chaser.team} on ${chaser.pts} pts (gap ${leader.pts - chaser.pts})` : ""}.`
      : `TITLE PICTURE: season not yet underway.`,
    ``,
    `DRESSING ROOMS IN GOOD SPIRITS (highest team morale):`,
    happiest,
    ``,
    `DRESSING ROOMS UNDER PRESSURE (lowest team morale):`,
    unhappiest,
    ``,
    `TOP SCORERS (season to date):`,
    topScorers(leaderboards, 5),
    ``,
    `CURRENT ABSENTEES (injuries & suspensions):`,
    injured.length ? injured.slice(0, 12).join("\n") : "  - Full squads available across the league.",
  ].join("\n");
}
