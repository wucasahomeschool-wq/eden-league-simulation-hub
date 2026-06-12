// Central, editable engine settings ("tuning knobs"). Every engine reads from
// the live `settings` singleton at call time, so changing a value here (via the
// Settings suite) immediately changes simulation, contract, trade and morale
// behaviour without touching the ported math. Structural facts (team count,
// season length, formation, playoff seeding) are intentionally NOT here — they
// stay fixed in the engine/league code.

export interface EngineSettings {
  // ---- Simulation engine ----
  manualSimTeams: string[];      // clubs whose matches are entered manually (never simulated)
  defaultTempo: number;          // 1.0 slow / 1.2 normal / 1.4 fast
  goalMultiplier: number;        // global scoring multiplier
  identityBoostWeight: number;   // bonus for a club's favoured tactical style
  dynamicTactics: boolean;       // live in-match tactical shifts
  weatherEffects: boolean;       // randomized weather modifiers
  playoffPenalties: boolean;     // drawn playoff ties go to a shootout

  // ---- Contract engine ----
  demandModifierMin: number;     // lower clamp on player wage demand modifier
  demandModifierMax: number;     // upper clamp on player wage demand modifier
  veteranPaycut: number;         // fraction shaved off a veteran's demand (0.15 = 15%)
  contractExemptTeams: string[]; // clubs the auto contract engine never touches

  // ---- Trade engine ----
  utilityThreshold: number;      // min combined ΔU for an auto proposal to surface
  transferWindowLastWeek: number;// last week the auto trade engine runs
  cashUtilityWeight: number;     // how much a club values cash ($M) in squad utility
  benchRatingWeight: number;     // how much bench depth counts in squad utility

  // ---- Morale engine ----
  moraleBaseline: number;        // neutral morale value
  highMorale: number;            // "buoyant" band threshold
  lowMorale: number;             // "fragile" band threshold
  sackThreshold: number;         // morale below this sacks the manager
  managerRenewalMorale: number;  // morale reset after a sacking
  seasonMoraleReset: number;     // points morale regresses toward baseline each season
}

export const DEFAULT_SETTINGS: EngineSettings = {
  defaultTempo: 1.2,
  goalMultiplier: 0.6,
  identityBoostWeight: 0.6,
  dynamicTactics: true,
  weatherEffects: true,
  playoffPenalties: true,

  demandModifierMin: 0.8,
  demandModifierMax: 1.4,
  veteranPaycut: 0.15,
  contractExemptTeams: ["Gugu Team", "Spams"],

  utilityThreshold: 4.0,
  transferWindowLastWeek: 12,
  cashUtilityWeight: 0.25,
  benchRatingWeight: 0.4,

  moraleBaseline: 50,
  highMorale: 75,
  lowMorale: 35,
  sackThreshold: 25,
  managerRenewalMorale: 60,
  seasonMoraleReset: 7,
};

// Live, mutable singleton every engine reads from.
export const settings: EngineSettings = { ...DEFAULT_SETTINGS };

// Merge persisted settings into the live singleton (missing keys fall back to
// defaults). Called whenever league state is loaded/normalized or edited.
export function applySettings(partial?: Partial<EngineSettings>): EngineSettings {
  Object.assign(settings, DEFAULT_SETTINGS, partial ?? {});
  // Defensive: never allow a non-array exempt list to slip through.
  if (!Array.isArray(settings.contractExemptTeams)) {
    settings.contractExemptTeams = [...DEFAULT_SETTINGS.contractExemptTeams];
  }
  return settings;
}

// Read a fresh copy (e.g. to seed editable form state / persist into LeagueState).
export function getSettings(): EngineSettings {
  return { ...settings, contractExemptTeams: [...settings.contractExemptTeams] };
}

// Live exempt-club check used across contract code & UI.
export function isContractExempt(name: string): boolean {
  return settings.contractExemptTeams.includes(name);
}
