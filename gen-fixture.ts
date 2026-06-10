import { initState, computeStandings, type LeagueState } from "./src/state/league";

type Fixture = { id: string; week: number; home: string; away: string };
type Match = { id: string; round: number; homeSeed: number; awaySeed: number; home: string; away: string; result?: { homeGoals: number; awayGoals: number; method: string } };

function rec(state: any, id: string, h: number, a: number) {
  state.results[id] = { homeGoals: h, awayGoals: a, method: "SIMULATED" };
}

// Record every regular-season fixture (weeks 1-12) with deterministic scores.
function playRegular(state: any) {
  for (const f of state.fixtures as Fixture[]) {
    const h = (f.home.length + f.week) % 4;
    const a = (f.away.length + f.week) % 3;
    rec(state, f.id, h, a);
  }
}

// Replicates buildRound / buildPlayoffs / advancePlayoffs from league.tsx.
function buildRound(round: number, participants: { team: string; seed: number }[]): Match[] {
  const sorted = [...participants].sort((x, y) => x.seed - y.seed);
  const out: Match[] = [];
  const n = sorted.length;
  for (let i = 0; i < n / 2; i++) {
    const high = sorted[i], low = sorted[n - 1 - i];
    out.push({ id: `po-r${round}-m${i}`, round, homeSeed: high.seed, awaySeed: low.seed, home: high.team, away: low.team });
  }
  return out;
}
function winner(m: Match): string { return m.result!.homeGoals >= m.result!.awayGoals ? m.home : m.away; }

function fullPlayoffs(state: any) {
  const seeds = computeStandings(state).slice(0, 14).map((s) => s.team);
  const seedOf = (t: string) => seeds.indexOf(t) + 1;
  let rounds: Match[][] = [buildRound(1, seeds.slice(2).map((team, i) => ({ team, seed: i + 3 })))];
  // play round 1
  const play = (rs: Match[][]) => rs[rs.length - 1].forEach((m) => (m.result = { homeGoals: 2, awayGoals: 1, method: "SIMULATED" }));
  play(rounds);
  // round 2: top 2 seeds + 6 winners
  let adv = [seeds[0], seeds[1], ...rounds[0].map(winner)];
  rounds.push(buildRound(2, adv.map((t) => ({ team: t, seed: seedOf(t) }))));
  play(rounds);
  // round 3
  adv = rounds[1].map(winner);
  rounds.push(buildRound(3, adv.map((t) => ({ team: t, seed: seedOf(t) }))));
  play(rounds);
  // final (round 4)
  adv = rounds[2].map(winner);
  rounds.push(buildRound(4, adv.map((t) => ({ team: t, seed: seedOf(t) }))));
  play(rounds);
  const champion = winner(rounds[3][0]);
  return { seeds, rounds, champion };
}

function variant(kind: "week12" | "week16" | "champion"): LeagueState {
  const s: any = initState();
  playRegular(s);
  s.currentWeek = 12;
  if (kind === "week12") { s.undoStack = []; return s; }

  // Add Final Four fixtures (weeks 13-16) using the top 4 teams.
  const top = computeStandings(s).slice(0, 4).map((r) => r.team);
  const base = s.fixtures.length;
  const ff: Fixture[] = [
    { id: `s1-w13-m${base}`, week: 13, home: top[0], away: top[3] },
    { id: `s1-w14-m${base + 1}`, week: 14, home: top[1], away: top[2] },
    { id: `s1-w15-m${base + 2}`, week: 15, home: top[0], away: top[1] },
    { id: `s1-w16-m${base + 3}`, week: 16, home: top[2], away: top[3] },
  ];
  s.fixtures = [...s.fixtures, ...ff];
  for (const f of ff) rec(s, f.id, 2, 1);
  s.currentWeek = 16;
  if (kind === "week16") { s.undoStack = []; return s; }

  s.playoffs = fullPlayoffs(s);
  s.undoStack = [];
  return s;
}

const kind = (process.argv[2] || "week12") as any;
const out = variant(kind);
console.log(JSON.stringify(out));
