// Aging & The Experience Shift.
// Players carry an Age. On ingest, age is inferred from a physical-to-mental
// attribute ratio. Each offseason, veterans (30+) regress physically and
// progress mentally; players who decay past a threshold or hit 35 retire and
// are replaced by a fresh 17-year-old academy prospect.
import type { LeaguePlayer } from "@/state/league";
import { computeOverall } from "@/lib/ratings";

const rand = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;

// Physical-to-mental ratio classification → starting age band.
export function computeStartingAge(p: LeaguePlayer): number {
  const physical = mean([p.PAC, p.STA]);
  const mental = mean([p.VIS, p.COM, p.POS_attr]);
  const ratio = mental === 0 ? 2 : physical / mental;
  if (ratio >= 1.15) return rand(18, 23); // Prospect
  if (ratio <= 0.95) return rand(30, 34); // Veteran
  return rand(24, 29); // Prime
}

// Retirement thresholds.
const RETIRE_AGE = 35;
const CRITICAL_PHYSICAL = 3.0;

export interface AgingResult {
  player: LeaguePlayer;
  retired: boolean;
  veteranFulfilled: boolean; // hit max mental progression this offseason
  replacement?: LeaguePlayer;
}

// Generate a fresh 17-year-old baseline prospect to replace a retiree.
export function youthProspect(position: string): LeaguePlayer {
  const base: LeaguePlayer = {
    name: "Academy Prospect",
    position,
    starter: false,
    age: 17,
    morale: 50,
    injuryWeeks: 0,
    suspensionWeeks: 0,
    reservedSlot: null,
    yellowLog: [],
    salary: 5.0,
    contractYears: 2,
    rating: 5.0, FIN: 5.0, SHO: 5.0, PAS: 4.5, VIS: 4.5, DRI: 5.5,
    PAC: 6.5, STA: 6.5, DEF: 5.0, TAC: 5.0, POS_attr: 4.0, COM: 4.0,
    WR: 5.5, AGG: 5.0, STR: 5.0, AER: 5.0,
  };
  return { ...base, rating: computeOverall(base) };
}

// Advance one offseason for a single player. Returns updated player (rating
// recomputed), retirement status and any replacement prospect.
export function ageOnePlayer(p: LeaguePlayer): AgingResult {
  const age = (p.age ?? 25) + 1;
  let next: LeaguePlayer = { ...p, age };
  let veteranFulfilled = false;

  if (age >= 30) {
    // Physical regression — exponential decline of PAC & STA.
    const decay = 1 - Math.pow(1.12, age - 29) * 0.04; // steeper each year
    const factor = Math.max(0.7, decay);
    next.PAC = Math.max(1.0, Math.round(next.PAC * factor * 10) / 10);
    next.STA = Math.max(1.0, Math.round(next.STA * factor * 10) / 10);

    // Mental progression — VIS, POS_attr, COM rise with experience.
    const gain = 0.3;
    const before = next.VIS + next.POS_attr + next.COM;
    next.VIS = Math.min(10.0, Math.round((next.VIS + gain) * 10) / 10);
    next.POS_attr = Math.min(10.0, Math.round((next.POS_attr + gain) * 10) / 10);
    next.COM = Math.min(10.0, Math.round((next.COM + gain) * 10) / 10);
    // Veteran fulfillment when mental attributes reach the ceiling.
    if (next.VIS >= 10 && next.POS_attr >= 10 && next.COM >= 10 && before < 30) {
      veteranFulfilled = true;
    }
  }

  next.rating = computeOverall(next);

  const retired = age >= RETIRE_AGE || next.PAC < CRITICAL_PHYSICAL || next.STA < CRITICAL_PHYSICAL;
  if (retired) {
    return { player: next, retired: true, veteranFulfilled, replacement: youthProspect(p.position) };
  }
  return { player: next, retired: false, veteranFulfilled };
}
