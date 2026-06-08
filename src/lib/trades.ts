// Eden League AI Trade Negotiation Protocol — faithful TS port of the Python
// reference (player valuation, team utility, fair-deal pre-flight). Used to
// auto-generate weekly trade proposals across the whole league market at once.
import type { LeaguePlayer, LeagueState, LeagueTeam } from "@/state/league";

// ---------------- Budget parsing / formatting ----------------
// Budgets are stored as display strings like "$21M" / "$24.6M". The algorithm
// works in millions of dollars (numbers).
export function parseBudget(budget: string): number {
  const m = budget.replace(/[^0-9.]/g, "");
  const v = parseFloat(m);
  return Number.isFinite(v) ? v : 0;
}

export function formatBudget(valueM: number): string {
  const rounded = Math.round(valueM * 10) / 10;
  return `$${rounded}M`;
}

// ---------------- Helpers ----------------
const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

const ATT_POS = ["ST", "LW", "RW", "Winger"];
const MID_POS = ["CAM", "CM", "CDM", "LM", "RM"];
const DEF_POS = ["CB", "LB", "RB", "LWB", "RWB"];

function countPositions(players: LeaguePlayer[]) {
  const c = { GK: 0, DEF: 0, MID: 0, ATT: 0 };
  for (const p of players) {
    if (p.position === "GK") c.GK++;
    else if (DEF_POS.includes(p.position)) c.DEF++;
    else if (MID_POS.includes(p.position)) c.MID++;
    else if (ATT_POS.includes(p.position)) c.ATT++;
  }
  return c;
}

// ---------------- Positional guardrails ----------------
// Before any automated proposal is surfaced, verify the post-trade roster of
// BOTH clubs would still be able to field a valid lineup. A legal roster keeps:
//   • at least 1 active, uninjured Goalkeeper
//   • at least 11 healthy (non-injured, non-suspended) players
//   • the core tactical spine: >= 2 defenders, >= 2 midfielders, >= 1 attacker
const isHealthy = (p: LeaguePlayer) => p.injuryWeeks === 0 && p.suspensionWeeks === 0;

function isRosterLegal(players: LeaguePlayer[]): boolean {
  const healthy = players.filter(isHealthy);
  if (healthy.length < 11) return false;
  const counts = countPositions(healthy);
  return counts.GK >= 1 && counts.DEF >= 2 && counts.MID >= 2 && counts.ATT >= 1;
}

// Post-trade legality for a single club (sends `out`, receives `incoming`).
function tradeKeepsRosterLegal(team: LeagueTeam, out: LeaguePlayer, incoming: LeaguePlayer): boolean {
  const post = [...team.players.filter((p) => p !== out), incoming];
  return isRosterLegal(post);
}



// ---------------- 2. Mathematical player valuation (V_p) ----------------
export function calculatePlayerValue(p: LeaguePlayer): number {
  let keyAvg: number;
  if (ATT_POS.includes(p.position)) keyAvg = mean([p.FIN, p.DRI, p.PAC]);
  else if (MID_POS.includes(p.position)) keyAvg = mean([p.PAS, p.VIS, p.DRI, p.STA]);
  else if (DEF_POS.includes(p.position)) keyAvg = mean([p.DEF, p.TAC, p.AER, p.STR]);
  else if (p.position === "GK") keyAvg = mean([p.rating, p.COM]);
  else keyAvg = p.rating;

  const ws = p.rating * 0.6 + keyAvg * 0.4;

  let base: number;
  if (ws < 4.0) base = 1.0 + (Math.max(0, ws) / 4.0) * 2.5;
  else if (ws <= 5.5) base = 3.5 + ((ws - 4.0) / 1.5) * 3.0;
  else if (ws <= 7.0) base = 6.5 + ((ws - 5.6) / 1.4) * 5.5;
  else if (ws <= 8.5) base = 12.0 + ((ws - 7.1) / 1.4) * 6.0;
  else base = 18.0 + ((ws - 8.5) / 1.5) * 27.0;

  return round1(Math.min(50.0, base));
}

// ---------------- 3. Positional shortage & roster balance utility ----------------
// A trade-eligible squad = players not injured/suspended. First 9 = active, rest bench.
interface Squad {
  active: LeaguePlayer[];
  bench: LeaguePlayer[];
  budgetM: number;
}

function buildSquad(team: LeagueTeam): Squad {
  const available = team.players.filter((p) => p.injuryWeeks === 0 && p.suspensionWeeks === 0);
  const ordered = [...available].sort((a, b) => Number(b.starter) - Number(a.starter));
  return {
    active: ordered.slice(0, 9),
    bench: ordered.slice(9),
    budgetM: parseBudget(team.budget),
  };
}

type PosKey = "GK" | "DEF" | "MID" | "ATT";
function groupOf(position: string): PosKey {
  if (position === "GK") return "GK";
  if (DEF_POS.includes(position)) return "DEF";
  if (ATT_POS.includes(position)) return "ATT";
  return "MID";
}

// Minimum healthy depth a club wants per position group before it is "stocked".
const REQUIRED: Record<PosKey, number> = { GK: 2, DEF: 4, MID: 4, ATT: 3 };
// A group this far above requirement is "stacked" — the club won't add more.
const SURPLUS: Record<PosKey, number> = { GK: 3, DEF: 6, MID: 6, ATT: 5 };

function groupCounts(squad: Squad): Record<PosKey, number> {
  const c: Record<PosKey, number> = { GK: 0, DEF: 0, MID: 0, ATT: 0 };
  for (const p of [...squad.active, ...squad.bench]) c[groupOf(p.position)]++;
  return c;
}

function isShortage(squad: Squad, g: PosKey): boolean {
  return groupCounts(squad)[g] < REQUIRED[g];
}
function isSurplus(squad: Squad, g: PosKey): boolean {
  const counts = groupCounts(squad);
  return counts[g] >= SURPLUS[g];
}

function squadUtility(squad: Squad): number {
  const activeRating = sum(squad.active.map((p) => p.rating));
  const benchRating = sum(squad.bench.map((p) => p.rating)) * 0.4;
  const counts = countPositions([...squad.active, ...squad.bench]);
  let scarcity = 0;
  if (counts.GK < 1) scarcity += 15.0;
  if (counts.DEF < 3) scarcity += 10.0;
  if (counts.ATT < 2) scarcity += 8.0;
  const cashUtility = squad.budgetM * 0.25;
  return activeRating + benchRating - scarcity + cashUtility;
}

function tradeUtilityDelta(
  squad: Squad,
  playerOut: LeaguePlayer,
  playerIn: LeaguePlayer,
  cashChange: number
): number {
  const active = squad.active.filter((p) => p !== playerOut);
  const bench = squad.bench.filter((p) => p !== playerOut);
  if (active.length < 9) active.push(playerIn);
  else bench.push(playerIn);
  const after: Squad = { active, bench, budgetM: squad.budgetM + cashChange };
  let delta = squadUtility(after) - squadUtility(squad);

  // ---- Positional Trade Urgency ----
  const inGroup = groupOf(playerIn.position);
  const outGroup = groupOf(playerOut.position);
  // Stacking an already-stocked position the club doesn't need: flat reject.
  if (isSurplus(squad, inGroup) && !isShortage(squad, inGroup) && inGroup !== outGroup) {
    return -100;
  }
  // Active shortage at the incoming player's position: scale the weighting up
  // by 150% so the club is willing to overpay for a missing piece.
  if (isShortage(squad, inGroup) && inGroup !== outGroup) {
    delta *= 1.5;
  }
  // Selling out of a position the club is already short on: penalize.
  if (isShortage(squad, outGroup) && inGroup !== outGroup) {
    delta -= 5;
  }
  return delta;
}

// ---------------- 4. The negotiation loop (global market scan) ----------------
export interface TradeProposal {
  id: string;
  teamA: string;
  teamB: string;
  aSends: string; // player name A sends to B
  bSends: string; // player name B sends to A
  cashAReceives: number; // $M paid by B to A
  cashBReceives: number; // $M paid by A to B
  deltaUA: number;
  deltaUB: number;
}

function sample<T>(arr: T[], k: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  const n = Math.min(k, copy.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

// Minimum combined utility gain for a deal to be surfaced to the user. Quality,
// not quantity: any deal clearing this bar is sent to the Trade Suite.
export const UTILITY_THRESHOLD = 4.0;
// Hard safety cap so a pathological week can't flood the desk.
const MAX_SURFACED = 25;

export function generateTradeProposals(state: LeagueState): TradeProposal[] {
  const teams = state.teamOrder.map((name) => state.teams[name]);
  const squads = new Map<string, Squad>();
  for (const t of teams) squads.set(t.name, buildSquad(t));

  const deals: TradeProposal[] = [];
  let counter = 0;

  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const teamA = teams[i];
      const teamB = teams[j];
      const squadA = squads.get(teamA.name)!;
      const squadB = squads.get(teamB.name)!;
      const poolA = [...squadA.active, ...squadA.bench];
      const poolB = [...squadB.active, ...squadB.bench];
      if (!poolA.length || !poolB.length) continue;

      const playersA = sample(poolA, 3);
      const playersB = sample(poolB, 3);

      for (const pA of playersA) {
        for (const pB of playersB) {
          const valA = calculatePlayerValue(pA);
          const valB = calculatePlayerValue(pB);
          const diff = valA - valB;
          const cashA = diff > 0 ? diff : 0; // B pays A
          const cashB = diff < 0 ? -diff : 0; // A pays B

          // Affordability check.
          if (cashA > squadB.budgetM || cashB > squadA.budgetM) continue;

          // Positional guardrails: block any deal that would leave either club
          // unable to field a valid lineup.
          if (!tradeKeepsRosterLegal(teamA, pA, pB)) continue;
          if (!tradeKeepsRosterLegal(teamB, pB, pA)) continue;

          const deltaUA = tradeUtilityDelta(squadA, pA, pB, cashA - cashB);
          const deltaUB = tradeUtilityDelta(squadB, pB, pA, cashB - cashA);


          if (deltaUA > 0 && deltaUB > 0) {
            deals.push({
              id: `tp-${state.season}-w${state.currentWeek}-${counter++}`,
              teamA: teamA.name,
              teamB: teamB.name,
              aSends: pA.name,
              bSends: pB.name,
              cashAReceives: round1(cashA),
              cashBReceives: round1(cashB),
              deltaUA: round2(deltaUA),
              deltaUB: round2(deltaUB),
            });
          }
        }
      }
    }
  }

  // Surface every deal above the utility threshold, best first (capped).
  deals.sort((a, b) => b.deltaUA + b.deltaUB - (a.deltaUA + a.deltaUB));
  return deals
    .filter((d) => d.deltaUA + d.deltaUB >= UTILITY_THRESHOLD)
    .slice(0, MAX_SURFACED);
}
