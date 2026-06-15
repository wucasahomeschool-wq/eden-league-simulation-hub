// Builds factual digests from REAL league state for the Negotiation Suite.
// Every value here is derived strictly from existing data (rosters, ratings,
// computed trade values, budgets, salary cap) — no fabricated numbers. The AI
// manager narrates only these facts.
import type { LeagueState, LeagueTeam } from "@/state/league";
import { calculatePlayerValue, parseBudget } from "@/lib/trades";

function rosterLines(team: LeagueTeam): string {
  return team.players
    .map((p) => {
      const status =
        p.injuryWeeks > 0 ? ` [injured ${p.injuryWeeks >= 99 ? "season" : p.injuryWeeks + "wk"}]`
        : p.suspensionWeeks > 0 ? ` [suspended ${p.suspensionWeeks}wk]`
        : "";
      return `    - ${p.name} (${p.position}, age ${p.age}, rating ${p.rating.toFixed(1)}, value $${calculatePlayerValue(p)}M, ${p.contractYears}yr deal @ $${p.salary}M)${status}`;
    })
    .join("\n");
}

function payrollOf(team: LeagueTeam): number {
  return Math.round(team.players.reduce((s, p) => s + (p.salary ?? 0), 0) * 10) / 10;
}

export function buildNegotiationBrief(
  state: LeagueState,
  userTeamName: string,
  aiTeamName: string
): string | null {
  const userTeam = state.teams[userTeamName];
  const aiTeam = state.teams[aiTeamName];
  if (!userTeam || !aiTeam) return null;

  const cap = state.salaryCap ?? 0;

  const userMgrRaw = state.managers?.[userTeamName]?.name?.trim();
  const userMgr =
    userMgrRaw && userMgrRaw.toUpperCase() !== "USER CONTROLLED" ? userMgrRaw : null;
  const userLabel = userMgr
    ? `${userTeamName} (the USER's club, managed by ${userMgr})`
    : `${userTeamName} (the USER's club)`;

  return [
    `SALARY CAP: $${cap}M hard cap (a club's total payroll cannot exceed this after a trade).`,
    ``,
    `${userLabel} — tactical style "${userTeam.tactical_style}":`,
    `  Transfer budget: ${userTeam.budget}. Current payroll: $${payrollOf(userTeam)}M.`,
    `  Roster:`,
    rosterLines(userTeam),
    ``,
    `${aiTeamName} (YOUR club) — tactical style "${aiTeam.tactical_style}":`,
    `  Transfer budget: ${aiTeam.budget}. Current payroll: $${payrollOf(aiTeam)}M.`,
    `  Roster:`,
    rosterLines(aiTeam),
    ``,
    `Note: player "value" is the league's fair-market valuation in $M. Use it to judge whether a deal is fair, a steal, or an overpay.`,
  ].join("\n");
}

// Convenience: budget as a number for client-side guardrails/UI.
export function budgetM(team: LeagueTeam): number {
  return parseBudget(team.budget);
}
