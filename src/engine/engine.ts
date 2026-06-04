// =============================================================================
// EDEN LEAGUE SIMULATION ENGINE v6.2.1 — faithful TypeScript port.
// Ported line-for-line from the official Python engine. The mathematics, random
// ranges, tactical weightings, fatigue decay, event loop ordering and commentary
// text are preserved EXACTLY. Only Python `print()` calls become log pushes and
// the CLI harness is replaced by the UI bridge. DO NOT alter any formula.
// =============================================================================

// ---- RNG helpers mirroring Python's `random` module semantics ----
function uniform(a: number, b: number): number {
  return a + Math.random() * (b - a);
}
function choice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
// random.choices(population, weights=..., k=1)[0]
function weightedChoice<T>(population: T[], weights: number[]): T {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < population.length; i++) {
    r -= weights[i];
    if (r <= 0) return population[i];
  }
  return population[population.length - 1];
}
function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

export interface EnginePlayer {
  name: string;
  position: string;
  rating: number;
  FIN: number; SHO: number; PAS: number; VIS: number; DRI: number; PAC: number;
  STA: number; DEF: number; TAC: number; POS_attr: number; COM: number; WR: number;
  AGG: number; STR: number; AER: number;
  fatigue: number;
  goals: number;
  fouls: number;
  yellow_cards: number;
  red_card: boolean;
  injured_severe: boolean;
}

export interface EngineTeam {
  name: string;
  tactical_style: string;
  active_roster: EnginePlayer[];
  bench: EnginePlayer[];
  goals_scored: number;
  subs_made: number;
}

function get_stamina_reduction(p: EnginePlayer): number {
  return p.STA * 0.03;
}

function get_top_aer_avg(team: EngineTeam): number {
  const outfielders = team.active_roster.filter((p) => p.position !== "GK");
  outfielders.sort((a, b) => b.AER - a.AER);
  const top_6 = outfielders.slice(0, 6);
  return top_6.length ? mean(top_6.map((p) => p.AER)) : 5.0;
}

function count_positions(team: EngineTeam): [number, number] {
  const attackers = team.active_roster.filter((p) =>
    ["ST", "LW", "RW", "Winger", "CAM"].includes(p.position)
  ).length;
  const defenders = team.active_roster.filter((p) =>
    ["CB", "LB", "RB", "LWB", "RWB", "CDM", "CM"].includes(p.position)
  ).length;
  return [attackers, defenders];
}

// Build a fresh, mutable engine Team from a roster (starters first 9, rest bench).
export function buildEngineTeam(
  name: string,
  tactical_style: string,
  roster: Omit<EnginePlayer, "fatigue" | "goals" | "fouls" | "yellow_cards" | "red_card" | "injured_severe">[]
): EngineTeam {
  const players: EnginePlayer[] = roster.map((r) => ({
    ...r,
    fatigue: 0.0,
    goals: 0,
    fouls: 0,
    yellow_cards: 0,
    red_card: false,
    injured_severe: false,
  }));
  return {
    name,
    tactical_style,
    active_roster: players.slice(0, 9),
    bench: players.slice(9),
    goals_scored: 0,
    subs_made: 0,
  };
}

type Log = string[];
const f1 = (n: number) => n.toFixed(1);

// =============================================================================
// INJURY & DISCIPLINARY MECHANICS
// =============================================================================
function execute_foul(fouling_team: EngineTeam, current_TUP: number, log: Log): void {
  const eligible = fouling_team.active_roster.filter((p) => p.position !== "GK");
  if (!eligible.length) return;

  const fouler = choice(eligible);
  const roll = uniform(1, 100);

  const red_thresh = 99.85;
  const yellow_thresh = 94.0 - (fouler.AGG - 5) * 1.0 - fouler.fouls * 2.0;

  if (roll >= red_thresh) {
    log.push(
      `[${f1(current_TUP)}'] RED CARD! ${fouler.name} (${fouling_team.name}) is sent off for a dangerous tackle! Down to ${fouling_team.active_roster.length - 1} men!`
    );
    fouler.red_card = true;
    fouling_team.active_roster = fouling_team.active_roster.filter((p) => p !== fouler);
  } else if (roll >= yellow_thresh) {
    fouler.yellow_cards += 1;
    fouler.fouls = 0;
    log.push(`[${f1(current_TUP)}'] YELLOW CARD: ${fouler.name} (${fouling_team.name}) is booked.`);
    if (fouler.yellow_cards === 2) {
      log.push(`   -> SECOND YELLOW! ${fouler.name} receives his marching orders!`);
      fouler.red_card = true;
      fouling_team.active_roster = fouling_team.active_roster.filter((p) => p !== fouler);
    }
  } else {
    fouler.fouls += 1;
    log.push(`[${f1(current_TUP)}'] Foul whistled on ${fouler.name} (${fouling_team.name}).`);
  }
}

function check_injuries(team: EngineTeam, current_TUP: number, log: Log): void {
  for (const p of [...team.active_roster]) {
    if (p.position === "GK") continue;
    const roll = uniform(1, 100);
    const thresh = 99.85 + (p.STR - 5) * 0.05 - (p.fatigue / 10.0) * 0.03;

    if (roll >= thresh) {
      const severity_roll = uniform(1, 100) - p.STR * 3.0;
      if (severity_roll > 55.0) {
        log.push(
          `[${f1(current_TUP)}'] SEVERE INJURY! ${p.name} (${team.name}) collapses and must be carried off!`
        );
        p.injured_severe = true;
        team.active_roster = team.active_roster.filter((x) => x !== p);
        force_emergency_sub(team, p, current_TUP, log);
      } else {
        log.push(
          `[${f1(current_TUP)}'] MINOR INJURY: ${p.name} (${team.name}) picks up a knock. Performance slightly degraded.`
        );
        p.rating = Math.max(1.0, p.rating - 1.0);
      }
    }
  }
}

function force_emergency_sub(team: EngineTeam, injured_player: EnginePlayer, TUP: number, log: Log): void {
  const candidates = team.bench.filter((b) => !b.injured_severe);
  if (candidates.length) {
    const sub = candidates[0];
    team.bench = team.bench.filter((b) => b !== sub);
    team.active_roster.push(sub);
    team.subs_made += 1;
    log.push(`   -> EMERGENCY SUB: ${sub.name} comes on to replace ${injured_player.name}.`);
  } else {
    log.push(`   -> NO SUBS LEFT! ${team.name} will play with 10 men.`);
  }
}

// =============================================================================
// PHASE 1: POSSESSION BUILDUP
// =============================================================================
function weighted_possession_flip(team_A: EngineTeam, team_B: EngineTeam): [EngineTeam, EngineTeam] {
  const get_mid_score = (team: EngineTeam): number => {
    const mids = team.active_roster.filter((p) =>
      ["CM", "CDM", "CAM", "LM", "RM"].includes(p.position)
    );
    if (!mids.length) return 15.0;
    return mids.reduce((s, p) => s + p.PAS + p.DRI + p.POS_attr, 0) / mids.length;
  };

  const score_A = get_mid_score(team_A);
  const score_B = get_mid_score(team_B);

  const power_A = score_A ** 3;
  const power_B = score_B ** 3;
  const prob_A = (power_A / (power_A + power_B)) * 100;
  return uniform(1, 100) <= prob_A ? [team_A, team_B] : [team_B, team_A];
}

function calculate_PRV(offense: EngineTeam, defense: EngineTeam): number {
  const off_att =
    mean(offense.active_roster.map((p) => p.PAS + p.VIS + p.DRI + p.PAC)) / 4;
  const off_phys =
    mean(offense.active_roster.map((p) => p.POS_attr + p.COM + p.AGG + p.STA + p.WR + p.STR)) / 6;
  const [num_att] = count_positions(offense);
  let off_score = off_att * 1.2 + off_phys * 0.8 + num_att * 0.5;

  if (!defense.active_roster.length) return 99.0;
  const def_tech = mean(defense.active_roster.map((p) => p.DEF + p.TAC)) / 2;
  const def_phys =
    mean(defense.active_roster.map((p) => p.POS_attr + p.COM + p.AGG + p.STA + p.WR + p.STR)) / 6;
  const [, num_def] = count_positions(defense);
  let def_score = def_tech * 1.5 + def_phys * 0.8 + num_def * 0.5;

  if (offense.tactical_style === "Possession") off_score *= 1.15;
  else if (offense.tactical_style === "Counterattack") def_score *= 1.2;
  else if (offense.tactical_style === "Deep Block") off_score *= 0.85;
  else if (offense.tactical_style === "Chaos Attack") off_score *= 1.1;
  else if (["High Press", "Gegenpress"].includes(offense.tactical_style)) off_score *= 1.05;

  if (["High Press", "Gegenpress"].includes(defense.tactical_style)) def_score *= 1.15;
  else if (defense.tactical_style === "Deep Block") def_score *= 0.9;
  else if (defense.tactical_style === "Chaos Attack") def_score *= 0.85;

  const off_power = off_score ** 2.0;
  const def_power = def_score ** 2.0;
  const total_power = off_power + def_power;

  const PRV = (off_power / total_power) * 100 + uniform(-1.0, 1.0);
  return Math.max(10.0, Math.min(PRV, 95.0));
}

// =============================================================================
// PHASE 2 & 3: ATTACK & FINISHING (LINKED TO USER GOAL MULTIPLIER)
// =============================================================================
function execute_attack_phase(
  attacking_team: EngineTeam,
  defending_team: EngineTeam,
  current_TUP: number,
  match_tempo: number,
  GOAL_MULTIPLIER: number,
  log: Log,
  is_counter = false,
  is_corner = false
): number {
  if (is_corner) {
    return execute_corner_kick(attacking_team, defending_team, current_TUP, match_tempo, GOAL_MULTIPLIER, log);
  }

  let time_consumed = uniform(0.4, 0.8) / match_tempo;
  if (is_counter) time_consumed *= 0.5;
  let new_TUP = current_TUP + time_consumed;

  const outfield_defenders = defending_team.active_roster.filter((p) => p.position !== "GK");
  const avg_def_ability = outfield_defenders.length
    ? mean(outfield_defenders.map((p) => p.DEF + p.TAC))
    : 5.0;

  const outfield_attackers = attacking_team.active_roster.filter((p) => p.position !== "GK");
  const avg_att_vis = outfield_attackers.length
    ? mean(outfield_attackers.map((p) => p.VIS + p.DRI))
    : 5.0;

  let defense_block_chance = 35.0 + (avg_def_ability - avg_att_vis) * 3.5;

  if (defending_team.tactical_style === "Deep Block") defense_block_chance *= 1.2;
  else if (["Chaos Attack", "High Press", "Gegenpress"].includes(defending_team.tactical_style))
    defense_block_chance *= 0.85;

  if (is_counter) defense_block_chance *= 0.7;

  defense_block_chance = Math.max(15.0, Math.min(defense_block_chance, 65.0));

  if (uniform(1, 100) <= defense_block_chance) {
    log.push(
      `[${f1(new_TUP)}'] BUILDUP: ${attacking_team.name} push into the final third, but the defense blocks the passing lane.`
    );
    return new_TUP;
  }

  const shooter = run_weighted_positional_lottery(attacking_team);
  if (!shooter) return new_TUP;

  log.push(
    `[${f1(new_TUP)}'] SHOT! ${shooter.name} (${shooter.position}) receives the ball and lets fly for ${attacking_team.name}!`
  );

  const bxG = is_counter ? 0.42 : 0.35;

  const AF = (shooter.FIN - 5) * 0.05;
  const COM = (shooter.COM - 5) * 0.025;
  const FAT = shooter.fatigue / 200.0;

  let xG = bxG * (1.0 + AF + COM - FAT);

  if (is_counter) xG += 0.08;
  if (attacking_team.tactical_style === "Chaos Attack") xG += 0.06;
  if (attacking_team.tactical_style === "Possession") xG *= 0.9;
  if (defending_team.tactical_style === "Deep Block") xG *= 0.85;

  xG = Math.max(0.08, Math.min(xG, 0.75));

  const gk_player = defending_team.active_roster.find((p) => p.position === "GK") || null;
  const gks_val = gk_player ? gk_player.rating : 5.0;

  const defenders_on_pitch = defending_team.active_roster.filter((p) =>
    ["CB", "LB", "RB", "CDM"].includes(p.position)
  );
  const avg_def_skill = defenders_on_pitch.length
    ? mean(defenders_on_pitch.map((d) => d.DEF))
    : 5.0;

  const FINMOD = (shooter.FIN - 5) * 0.05;
  const COMMOD = (shooter.COM - 5) * 0.02;
  const FAT2 = shooter.fatigue / 250.0;

  let PRESS2 = (avg_def_skill * 1.5) / 100.0;

  if (["High Press", "Gegenpress", "Chaos Attack"].includes(defending_team.tactical_style))
    PRESS2 *= 0.75;
  else if (defending_team.tactical_style === "Deep Block") PRESS2 *= 1.15;

  const GKSHOT = (gks_val - 5) * 0.05;

  // Apply the custom "Goal Knob" value here directly to shot precision
  let SP = xG * (1.0 + FINMOD + COMMOD - PRESS2 - FAT2 - GKSHOT) * GOAL_MULTIPLIER;
  SP = Math.max(0.01, Math.min(SP, 0.95));

  const CPP = uniform(1, 100);
  const threshold = SP * 100;

  if (CPP <= threshold) {
    shooter.goals += 1;
    attacking_team.goals_scored += 1;
    log.push(`   -> GOAL!!! Clinical finish! (${attacking_team.goals_scored}-${defending_team.goals_scored})`);
  } else if (threshold < CPP && CPP <= threshold + 1.5) {
    log.push(`   -> WOODWORK! ${shooter.name} smashes it off the post! Goal kick.`);
  } else if (threshold + 1.5 < CPP && CPP <= threshold + 5.0) {
    log.push(`   -> NEAR MISS! Just wide of the target. Goal kick.`);
  } else if (threshold + 5.0 < CPP && CPP <= threshold + 5.0 + gks_val * 1.8) {
    log.push(`   -> SAVED! The Goalkeeper barely tips it away! CORNER KICK awarded.`);
    new_TUP = execute_corner_kick(attacking_team, defending_team, new_TUP, match_tempo, GOAL_MULTIPLIER, log);
  } else {
    log.push(`   -> BLOCKED/SAVED cleanly. Defense holds strong.`);
  }

  shooter.fatigue += 1.0 * (1.0 - get_stamina_reduction(shooter));
  return new_TUP;
}

function execute_corner_kick(
  attacking_team: EngineTeam,
  defending_team: EngineTeam,
  current_TUP: number,
  match_tempo: number,
  GOAL_MULTIPLIER: number,
  log: Log
): number {
  log.push(`[${f1(current_TUP)}'] CORNER KICK for ${attacking_team.name}...`);
  const avg_aer_att = get_top_aer_avg(attacking_team);
  const avg_aer_def = get_top_aer_avg(defending_team);
  const win_chance = 50.0 + (avg_aer_att - avg_aer_def) * 10;

  if (uniform(1, 100) > win_chance) {
    log.push("   -> CLEARED! The defense wins the header.");
    return current_TUP + 0.15 / match_tempo;
  }

  const shooter = run_weighted_positional_lottery(attacking_team);
  if (!shooter) return current_TUP;

  const gk_player = defending_team.active_roster.find((p) => p.position === "GK") || null;
  const gks_val = gk_player ? gk_player.rating : 5.0;
  log.push(`   -> HEADER WON by ${shooter.name}!`);

  // Apply Goal Knob directly to set pieces as well
  let Header_SP =
    0.25 *
    ((shooter.AER * 1.5 + shooter.FIN + shooter.SHO) / Math.max(1, gks_val * 3.5)) *
    GOAL_MULTIPLIER;
  Header_SP = Math.max(0.01, Math.min(Header_SP, 0.85));

  if (uniform(1, 100) <= Header_SP * 100) {
    shooter.goals += 1;
    attacking_team.goals_scored += 1;
    log.push(`   -> GOAL!!! A bullet header! (${attacking_team.goals_scored}-${defending_team.goals_scored})`);
  } else {
    log.push("   -> Header flies over the crossbar. Goal kick.");
  }

  return current_TUP + 0.15 / match_tempo;
}

function run_weighted_positional_lottery(attacking_team: EngineTeam): EnginePlayer | null {
  const eligible = attacking_team.active_roster.filter((p) => p.position !== "GK");
  if (!eligible.length) return null;
  const weights: number[] = [];
  for (const p of eligible) {
    const base =
      p.position === "ST"
        ? 5.0
        : ["LW", "RW", "CAM"].includes(p.position)
        ? 3.0
        : ["CM", "CDM"].includes(p.position)
        ? 2.0
        : 1.0;
    const perf = Math.max(0.1, 1.0 - p.fatigue / 140.0);
    weights.push(base * p.rating * perf);
  }
  return weightedChoice(eligible, weights);
}

// =============================================================================
// FATIGUE & AI SUBSTITUTION MANAGER
// =============================================================================
function apply_5_minute_fatigue_drain(
  team_A: EngineTeam,
  team_B: EngineTeam,
  match_tempo: number,
  TUP: number,
  log: Log
): void {
  const base_f = match_tempo <= 1.0 ? 2.0 : match_tempo <= 1.2 ? 3.0 : 4.0;
  const pos_pf: Record<string, number> = {
    GK: 0, CB: 1, CDM: 1, ST: 1, FB: 2, LB: 2, RB: 2, CM: 2, CAM: 2, LW: 3, RW: 3,
  };
  const tact_pf: Record<string, number> = {
    "Deep Block": -1, Balanced: 0, Counterattack: 1, Possession: 1,
    "High Press": 2, Gegenpress: 3, "Chaos Attack": 4,
  };

  for (const team of [team_A, team_B]) {
    const t_val = tact_pf[team.tactical_style] ?? 0;
    for (const p of team.active_roster) {
      const p_val = pos_pf[p.position] ?? 1;
      const f_gain = (base_f + p_val + t_val) * (1.0 - get_stamina_reduction(p));
      p.fatigue = Math.min(100.0, p.fatigue + f_gain);
    }
    check_injuries(team, TUP, log);
  }
}

function evaluate_substitutions(team: EngineTeam, TUP: number, goal_diff: number, log: Log): void {
  if (TUP < 45.0 || team.subs_made >= 3) return;

  if (TUP > 75.0) {
    if (goal_diff >= 2) {
      const attackers = team.active_roster.filter((p) => ["ST", "LW", "RW"].includes(p.position));
      const def_bench = team.bench.filter((p) => ["CB", "LB", "RB", "CDM"].includes(p.position));
      if (attackers.length && def_bench.length) {
        const out_p = attackers.reduce((a, b) => (b.fatigue > a.fatigue ? b : a));
        const in_p = def_bench[0];
        team.active_roster = team.active_roster.filter((x) => x !== out_p);
        team.bench = team.bench.filter((x) => x !== in_p);
        team.active_roster.push(in_p);
        team.subs_made += 1;
        log.push(`[${f1(TUP)}'] TACTICAL SUB (${team.name}): Protecting lead. ${in_p.name} ON, ${out_p.name} OFF.`);
        return;
      }
    } else if (goal_diff <= -2) {
      const defenders = team.active_roster.filter((p) => ["CB", "LB", "RB", "CDM"].includes(p.position));
      const att_bench = team.bench.filter((p) => ["ST", "LW", "RW", "CAM"].includes(p.position));
      if (defenders.length && att_bench.length) {
        const out_p = defenders.reduce((a, b) => (b.fatigue > a.fatigue ? b : a));
        const in_p = att_bench[0];
        team.active_roster = team.active_roster.filter((x) => x !== out_p);
        team.bench = team.bench.filter((x) => x !== in_p);
        team.active_roster.push(in_p);
        team.subs_made += 1;
        log.push(`[${f1(TUP)}'] TACTICAL SUB (${team.name}): Chasing game. ${in_p.name} ON, ${out_p.name} OFF.`);
        return;
      }
    }
  }

  for (const starter of [...team.active_roster]) {
    if (starter.position === "GK") continue;
    const candidates = team.bench.filter((b) => b.position === starter.position && !b.injured_severe);
    if (!candidates.length) continue;

    const sub = candidates[0];
    const stay_xG = 0.22 * (1 + (starter.FIN - 5) * 0.035 - starter.fatigue / 250.0);
    let EV_stay = 2.0 * stay_xG;

    if (starter.yellow_cards > 0) {
      const liability_multiplier = Math.max(0.6, 1.0 - 0.005 * (90.0 - TUP));
      EV_stay *= liability_multiplier;
    }

    const sub_xG = 0.22 * (1 + (sub.FIN - 5) * 0.035);
    const EV_sub = 2.0 * sub_xG;

    if (EV_sub - EV_stay > 0.15) {
      team.active_roster = team.active_roster.filter((x) => x !== starter);
      team.bench = team.bench.filter((x) => x !== sub);
      team.active_roster.push(sub);
      team.subs_made += 1;
      const reason = starter.yellow_cards > 0 ? "Yellow Card risk" : "Fatigue";
      log.push(`[${f1(TUP)}'] SMART SUB (${team.name}): ${sub.name} ON, ${starter.name} OFF (${reason}).`);
      return;
    }
  }
}

// =============================================================================
// THE MASTER MATCH TIME SIMULATOR
// =============================================================================
export interface MatchResult {
  log: string[];
  homeGoals: number;
  awayGoals: number;
}

export function run_match(
  team_A: EngineTeam,
  team_B: EngineTeam,
  match_tempo = 1.2,
  GOAL_MULTIPLIER = 0.6
): MatchResult {
  const log: Log = [];
  log.push(`\n==================================================`);
  log.push(`KICKOFF: ${team_A.name} (${team_A.tactical_style}) VS ${team_B.name} (${team_B.tactical_style})`);
  log.push(`==================================================`);

  let TUP = 0.0;
  let last_fatigue_update = 0.0;
  let [team_in_possession, defending_team] = weighted_possession_flip(team_A, team_B);

  while (TUP < 90.0) {
    if (team_A.active_roster.length < 6 || team_B.active_roster.length < 6) {
      log.push(`[${f1(TUP)}'] MATCH ABANDONED: Too few players remaining on the pitch.`);
      break;
    }

    if (TUP >= 45.0 && last_fatigue_update < 45.0) {
      log.push(`\n--- HALFTIME: ${team_A.name} ${team_A.goals_scored} - ${team_B.name} ${team_B.goals_scored} ---`);
      for (const t of [team_A, team_B]) {
        for (const p of t.active_roster) p.fatigue *= 0.9;
      }
      last_fatigue_update = 45.0;
      TUP = 45.0;
      [team_in_possession, defending_team] = weighted_possession_flip(team_A, team_B);
      continue;
    }

    const PRV = calculate_PRV(team_in_possession, defending_team);
    const R1 = uniform(1, 100);

    const prog_thresh = Math.max(1.0, PRV - 5.0);
    const recy_thresh = PRV + 5.0;
    const stop_thresh = Math.min(100.0, PRV + 15.0);

    if (R1 <= prog_thresh) {
      let time_spent = 0.9 / match_tempo;
      if (team_in_possession.tactical_style === "Counterattack") time_spent *= 0.6;
      TUP += time_spent;
      TUP = execute_attack_phase(
        team_in_possession, defending_team, TUP, match_tempo, GOAL_MULTIPLIER, log,
        team_in_possession.tactical_style === "Counterattack"
      );
      [team_in_possession, defending_team] = weighted_possession_flip(team_A, team_B);
    } else if (R1 <= recy_thresh) {
      TUP += 1.3 / match_tempo;
    } else if (R1 <= stop_thresh) {
      TUP += 0.8 / match_tempo;
      if (uniform(1, 100) <= 25.0) {
        log.push(`[${f1(TUP)}'] FOUL in the final third! Free kick awarded.`);
        TUP = execute_attack_phase(team_in_possession, defending_team, TUP, match_tempo, GOAL_MULTIPLIER, log);
      } else {
        execute_foul(defending_team, TUP, log);
      }
      [team_in_possession, defending_team] = weighted_possession_flip(team_A, team_B);
    } else {
      TUP += 0.8 / match_tempo;
      [team_in_possession, defending_team] = [defending_team, team_in_possession];
      if (team_in_possession.tactical_style === "Counterattack") {
        log.push(`[${f1(TUP)}'] INTERCEPTION! ${team_in_possession.name} launch a rapid counterattack!`);
        TUP = execute_attack_phase(team_in_possession, defending_team, TUP, match_tempo, GOAL_MULTIPLIER, log, true);
        [team_in_possession, defending_team] = weighted_possession_flip(team_A, team_B);
      }
    }

    if (TUP - last_fatigue_update >= 5.0) {
      apply_5_minute_fatigue_drain(team_A, team_B, match_tempo, TUP, log);
      const diff_A = team_A.goals_scored - team_B.goals_scored;
      evaluate_substitutions(team_A, TUP, diff_A, log);
      evaluate_substitutions(team_B, TUP, -diff_A, log);
      last_fatigue_update += 5.0;
    }
  }

  log.push("\n==================================================");
  log.push(`FULL-TIME: ${team_A.name} ${team_A.goals_scored} - ${team_B.name} ${team_B.goals_scored}`);
  log.push("==================================================");
  log.push("Match Statistics / Player Performance:");
  for (const team of [team_A, team_B]) {
    log.push(`\n--- ${team.name} ---`);
    const all_players = [...team.active_roster, ...team.bench];
    const played = all_players.filter((p) => p.fatigue > 0.0 || p.goals > 0 || p.yellow_cards > 0);
    for (const p of played) {
      const cards: string[] = [];
      if (p.yellow_cards > 0) cards.push(`YCx${p.yellow_cards}`);
      if (p.red_card) cards.push("RC");
      const card_str = cards.length ? ` [${cards.join(", ")}]` : "";
      const inj_str = p.injured_severe ? " [INJURED]" : "";
      log.push(`${p.name} (${p.position}) - Goals: ${p.goals} | Fatigue: ${p.fatigue.toFixed(1)}${card_str}${inj_str}`);
    }
  }

  return { log, homeGoals: team_A.goals_scored, awayGoals: team_B.goals_scored };
}
