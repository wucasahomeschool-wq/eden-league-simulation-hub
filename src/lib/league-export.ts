// League data export + version-snapshot helpers.
// Exports produce downloadable JSON; version snapshots capture all league data
// EXCEPT Team Editor data (rosters, budgets, formations/lineups, player attrs).
import type {
  LeagueState, StandingRow, Leaderboards, FixtureEntry,
} from "@/state/league";

// ---------------- Generic browser download ----------------
export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".json") ? filename : `${filename}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

// ---------------- Full league export ----------------
// Everything: rosters, schedule, results, commentary, standings, leaderboards.
export function buildLeagueExport(
  state: LeagueState,
  standings: StandingRow[],
  leaderboards: Leaderboards
) {
  return {
    exportedAt: new Date().toISOString(),
    kind: "eden-league-full-export",
    season: state.season,
    currentWeek: state.currentWeek,
    salaryCap: state.salaryCap,
    teamOrder: state.teamOrder,
    teams: state.teams,
    fixtures: state.fixtures,
    results: state.results,
    matchCommentary: state.payloads,
    playoffs: state.playoffs ?? null,
    tradeProposals: state.tradeProposals,
    freeAgents: state.freeAgents,
    standings,
    goldenBoot: leaderboards.scorers,
    assistLeaders: leaderboards.assists,
    goldenGlove: leaderboards.keepers,
  };
}

export function downloadLeagueExport(
  state: LeagueState,
  standings: StandingRow[],
  leaderboards: Leaderboards
) {
  downloadJson(
    `eden-league-S${state.season}-W${state.currentWeek}-${stamp()}`,
    buildLeagueExport(state, standings, leaderboards)
  );
}

// ---------------- Single-week export ----------------
// Results + match commentary for one week, plus a snapshot of all current
// Team Editor data (rosters/budgets/lineups) at the moment of export.
export function buildWeekExport(state: LeagueState, week: number) {
  const weekFixtures = state.fixtures.filter((f) => f.week === week);
  const matches = weekFixtures.map((f: FixtureEntry) => ({
    fixtureId: f.id,
    week: f.week,
    home: f.home,
    away: f.away,
    result: state.results[f.id] ?? null,
    commentary: state.payloads[f.id]?.log ?? null,
    playerStats: state.payloads[f.id]?.players ?? null,
    goalkeeperStats: state.payloads[f.id]?.goalkeepers ?? null,
    injuries: state.payloads[f.id]?.injuries ?? null,
  }));
  return {
    exportedAt: new Date().toISOString(),
    kind: "eden-league-week-export",
    season: state.season,
    week,
    matches,
    teamEditorSnapshot: {
      teamOrder: state.teamOrder,
      teams: state.teams,
      salaryCap: state.salaryCap,
      freeAgents: state.freeAgents,
    },
  };
}

export function downloadWeekExport(state: LeagueState, week: number) {
  downloadJson(`eden-league-S${state.season}-week-${week}-${stamp()}`, buildWeekExport(state, week));
}

// ---------------- Version snapshots (Team Editor data EXCLUDED) ----------------
export interface VersionData {
  currentWeek: number;
  season: number;
  fixtures: LeagueState["fixtures"];
  results: LeagueState["results"];
  payloads: LeagueState["payloads"];
  playoffs: LeagueState["playoffs"];
  tradeProposals: LeagueState["tradeProposals"];
  freeAgents: LeagueState["freeAgents"];
  salaryCap: number;
  contractsInitialized: boolean;
}

export function extractVersionData(state: LeagueState): VersionData {
  return {
    currentWeek: state.currentWeek,
    season: state.season,
    fixtures: state.fixtures,
    results: state.results,
    payloads: state.payloads,
    playoffs: state.playoffs,
    tradeProposals: state.tradeProposals,
    freeAgents: state.freeAgents,
    salaryCap: state.salaryCap,
    contractsInitialized: state.contractsInitialized,
  };
}
