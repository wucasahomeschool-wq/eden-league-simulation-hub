import type { LeaguePlayer } from "@/state/league";

// Maps friendly attribute words AND raw codes to the LeaguePlayer numeric key.
const ATTR_ALIASES: Record<string, keyof LeaguePlayer> = {
  // overall
  ovr: "rating", overall: "rating", rating: "rating",
  // speed
  pac: "PAC", pace: "PAC", speed: "PAC",
  // finishing
  fin: "FIN", finishing: "FIN", finish: "FIN",
  // shooting
  sho: "SHO", shooting: "SHO", shot: "SHO",
  // passing
  pas: "PAS", passing: "PAS", pass: "PAS",
  // vision
  vis: "VIS", vision: "VIS",
  // dribbling
  dri: "DRI", dribbling: "DRI", dribble: "DRI",
  // stamina
  sta: "STA", stamina: "STA",
  // defending
  def: "DEF", defending: "DEF", defense: "DEF", defence: "DEF",
  // tackling
  tac: "TAC", tackling: "TAC", tackle: "TAC",
  // positioning
  pos: "POS_attr", positioning: "POS_attr", position: "POS_attr",
  // composure
  com: "COM", composure: "COM",
  // work rate
  wr: "WR", workrate: "WR", work: "WR",
  // aggression
  agg: "AGG", aggression: "AGG",
  // strength
  str: "STR", strength: "STR", strong: "STR",
  // aerial
  aer: "AER", aerial: "AER", heading: "AER", header: "AER",
  // meta numeric fields
  age: "age", salary: "salary", contract: "contractYears", years: "contractYears",
  morale: "morale",
};

const KNOWN_POSITIONS = new Set([
  "GK", "ST", "LW", "RW", "CAM", "CM", "CDM", "LM", "RM",
  "CB", "LB", "RB", "LWB", "RWB", "WINGER",
]);

type Op = ">" | ">=" | "<" | "<=" | "=";
interface Comparison { key: keyof LeaguePlayer; op: Op; value: number; }

export interface ParsedQuery {
  nameTerms: string[];
  position?: string;
  comparisons: Comparison[];
  isEmpty: boolean;
}

export function parseSearchQuery(raw: string): ParsedQuery {
  let q = raw.trim();
  const comparisons: Comparison[] = [];

  // Extract "<attr> <op> <number>" patterns (spaces optional around the op).
  const cmpRe = /([a-zA-Z_]+)\s*(>=|<=|=|>|<)\s*(\d+(?:\.\d+)?)/g;
  q = q.replace(cmpRe, (full, word: string, op: string, num: string) => {
    const key = ATTR_ALIASES[word.toLowerCase()];
    if (key) {
      comparisons.push({ key, op: op as Op, value: parseFloat(num) });
      return " ";
    }
    return full;
  });

  let position: string | undefined;
  const nameTerms: string[] = [];
  for (const tok of q.split(/\s+/).map((t) => t.trim()).filter(Boolean)) {
    // explicit pos:XX
    const m = tok.match(/^pos:(.+)$/i);
    if (m) { position = m[1].toUpperCase(); continue; }
    // bare known position token
    if (KNOWN_POSITIONS.has(tok.toUpperCase())) { position = tok.toUpperCase(); continue; }
    nameTerms.push(tok.toLowerCase());
  }

  return {
    nameTerms,
    position,
    comparisons,
    isEmpty: nameTerms.length === 0 && !position && comparisons.length === 0,
  };
}

function cmpOk(actual: number, op: Op, value: number): boolean {
  switch (op) {
    case ">": return actual > value;
    case ">=": return actual >= value;
    case "<": return actual < value;
    case "<=": return actual <= value;
    case "=": return Math.abs(actual - value) < 0.0001;
  }
}

export function playerMatchesQuery(p: LeaguePlayer, parsed: ParsedQuery): boolean {
  const name = p.name.toLowerCase();
  if (parsed.nameTerms.some((t) => !name.includes(t))) return false;
  if (parsed.position && p.position.toUpperCase() !== parsed.position) return false;
  for (const c of parsed.comparisons) {
    const actual = Number(p[c.key]);
    if (!Number.isFinite(actual) || !cmpOk(actual, c.op, c.value)) return false;
  }
  return true;
}
