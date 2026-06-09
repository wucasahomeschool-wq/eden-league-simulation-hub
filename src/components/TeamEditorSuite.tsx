import { useEffect, useState } from "react";
import {
  useLeague, ATTR_KEYS, isPlayerOut, SEASON_ENDING_WEEKS,
  buildLineupSlots, isValidFormation, type AttrKey, type LineupSlot,
} from "@/state/league";
import { CONTRACT_EXEMPT_TEAMS } from "@/lib/contracts";
import { moraleLabel } from "@/lib/morale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const NUM_COLS: { key: AttrKey; label: string }[] = [
  { key: "rating", label: "OVR" },
  { key: "FIN", label: "FIN" },
  { key: "SHO", label: "SHO" },
  { key: "PAS", label: "PAS" },
  { key: "VIS", label: "VIS" },
  { key: "DRI", label: "DRI" },
  { key: "PAC", label: "PAC" },
  { key: "STA", label: "STA" },
  { key: "DEF", label: "DEF" },
  { key: "TAC", label: "TAC" },
  { key: "POS_attr", label: "POS" },
  { key: "COM", label: "COM" },
  { key: "WR", label: "WR" },
  { key: "AGG", label: "AGG" },
  { key: "STR", label: "STR" },
  { key: "AER", label: "AER" },
];

const GROUP_COLOR: Record<string, string> = {
  GK: "bg-amber-500/15 border-amber-500/40",
  DF: "bg-sky-500/15 border-sky-500/40",
  MF: "bg-emerald-500/15 border-emerald-500/40",
  ST: "bg-rose-500/15 border-rose-500/40",
};

function weeksLabel(weeks: number): string {
  if (weeks >= SEASON_ENDING_WEEKS) return "Season";
  return `${weeks} wk`;
}

export function TeamEditorSuite() {
  const {
    state, updateBudget, updatePlayer,
    setInjuryWeeks, setSuspensionWeeks, addPlayer, removePlayer, renameTeam,
    setLineupSlot, setFormation, autoFillLineup,
    setSalary, setContractYears,
  } = useLeague();
  const [team, setTeam] = useState(state.teamOrder[0]);
  const [nameDraft, setNameDraft] = useState(team);
  const [formationDraft, setFormationDraft] = useState("3-3-2");

  useEffect(() => {
    if (!state.teams[team]) setTeam(state.teamOrder[0]);
  }, [state.teams, state.teamOrder, team]);
  useEffect(() => { setNameDraft(team); }, [team]);
  useEffect(() => {
    if (state.teams[team]) setFormationDraft(state.teams[team].formation);
  }, [team, state.teams]);

  const t = state.teams[team];
  if (!t) return null;

  const contractEditable = CONTRACT_EXEMPT_TEAMS.has(team);
  const payroll = t.players.reduce((s, p) => s + (p.salary ?? 0), 0);
  const slots = buildLineupSlots(t.formation);
  const starterCount = t.lineup.filter((n) => {
    const p = t.players.find((x) => x.name === n);
    return p && !isPlayerOut(p);
  }).length;
  const reserves = t.players
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => isPlayerOut(p));
  const ml = moraleLabel(t.morale);
  const moraleTone =
    ml.tone === "high" ? "text-success" : ml.tone === "low" ? "text-destructive" : "text-foreground";

  function saveName() {
    const next = nameDraft.trim();
    if (next && next !== team && !state.teams[next]) {
      renameTeam(team, next);
      setTeam(next);
    } else {
      setNameDraft(team);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Club
          </label>
          <Select value={team} onValueChange={setTeam}>
            <SelectTrigger className="w-64 bg-card"><SelectValue /></SelectTrigger>
            <SelectContent>
              {state.teamOrder.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Team Name (rename for promotion/relegation)
          </label>
          <div className="flex gap-2">
            <Input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveName()}
              className="h-9 w-56 bg-card"
            />
            <Button size="sm" variant="secondary" onClick={saveName} disabled={nameDraft.trim() === team || !nameDraft.trim()}>
              SAVE NAME
            </Button>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Budget (Liquid Capital)
          </label>
          <input
            value={t.budget}
            onChange={(e) => updateBudget(team, e.target.value)}
            className="h-9 w-40 rounded-md border bg-card px-3 font-mono text-sm font-semibold"
          />
        </div>
        <div className="ml-auto text-right text-xs text-muted-foreground">
          <div>Tactical style: <span className="font-semibold text-foreground">{t.tactical_style}</span></div>
          <div>Team Morale: <span className={`font-semibold ${moraleTone}`}>{t.morale.toFixed(0)}% · {ml.text}</span></div>
          <div>Active starters: <span className={starterCount === slots.length ? "font-semibold text-success" : "font-semibold text-destructive"}>{starterCount}/{slots.length}</span></div>
        </div>
      </div>

      {/* Formation pitch */}
      <div className="mb-6 rounded-xl border border-border bg-card/60 p-4 shadow-lg">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Formation (any rows; digits must total 8 outfielders)
            </label>
            <div className="flex gap-2">
              <Input
                value={formationDraft}
                onChange={(e) => setFormationDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && isValidFormation(formationDraft) && setFormation(team, formationDraft)}
                placeholder="3-3-2"
                className="h-9 w-32 bg-card font-mono"
              />
              <Button size="sm" variant="secondary" disabled={!isValidFormation(formationDraft)} onClick={() => setFormation(team, formationDraft)}>
                APPLY
              </Button>
              <Button size="sm" variant="outline" onClick={() => autoFillLineup(team)}>
                AUTO-FILL
              </Button>
            </div>
            {!isValidFormation(formationDraft) && (
              <p className="mt-1 text-xs text-destructive">Digits must sum to 8 (e.g. 3-3-2, 4-4, 2-3-2-1, 1-2-3-2).</p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Any player can be slotted into any position. A simulation requires all 9 slots filled with
            healthy players.
          </p>
        </div>

        <PitchField slots={slots} team={team} t={t} setLineupSlot={setLineupSlot} />
      </div>


      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b bg-panel text-left font-bold uppercase tracking-wide text-muted-foreground">
              <th className="px-2 py-2 text-left">PLAYER</th>
              <th className="px-2 py-2 text-center">POS</th>
              <th className="px-1.5 py-2 text-center">AGE</th>
              <th className="px-1.5 py-2 text-center">MOR</th>
              {NUM_COLS.map((c) => <th key={c.key} className="px-1.5 py-2 text-center">{c.label}</th>)}
              <th className="px-2 py-2 text-center">HEALTH</th>
              <th className="px-1.5 py-2 text-center">INJ</th>
              <th className="px-1.5 py-2 text-center">SUS</th>
              <th className="px-2 py-2 text-center" />
            </tr>
          </thead>
          <tbody>
            {t.players.map((p, idx) => {
              const out = isPlayerOut(p);
              return (
                <tr
                  key={idx}
                  className={`border-b last:border-0 ${out ? "bg-destructive/10" : p.starter ? "bg-starter" : ""}`}
                >
                  <td className="px-1 py-1">
                    <input
                      value={p.name}
                      onChange={(e) => updatePlayer(team, idx, { name: e.target.value })}
                      className="w-36 rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-border focus:border-ring focus:bg-card focus:outline-none"
                    />
                  </td>
                  <td className="px-1 py-1 text-center">
                    <input
                      value={p.position}
                      onChange={(e) => updatePlayer(team, idx, { position: e.target.value })}
                      className="w-12 rounded border border-transparent bg-transparent px-1 py-0.5 text-center uppercase hover:border-border focus:border-ring focus:bg-card focus:outline-none"
                    />
                  </td>
                  <td className="px-0.5 py-1 text-center">
                    <input
                      type="number"
                      min={15}
                      max={45}
                      value={p.age}
                      onChange={(e) => updatePlayer(team, idx, { age: parseInt(e.target.value) || 0 })}
                      className="w-11 rounded border border-transparent bg-transparent px-1 py-0.5 text-center tabular-nums hover:border-border focus:border-ring focus:bg-card focus:outline-none"
                    />
                  </td>
                  <td className="px-0.5 py-1 text-center">
                    <span className="font-mono tabular-nums text-muted-foreground">{p.morale.toFixed(0)}</span>
                  </td>
                  {NUM_COLS.map((c) =>
                    c.key === "rating" ? (
                      <td key={c.key} className="px-0.5 py-1 text-center">
                        <span
                          title="Auto-calculated weighted average of attributes"
                          className="inline-block w-12 cursor-not-allowed rounded bg-muted px-1 py-0.5 text-center font-mono font-bold tabular-nums text-primary"
                        >
                          {p.rating.toFixed(1)}
                        </span>
                      </td>
                    ) : (
                      <td key={c.key} className="px-0.5 py-1 text-center">
                        <input
                          type="number"
                          step="0.1"
                          value={p[c.key]}
                          onChange={(e) =>
                            updatePlayer(team, idx, { [c.key]: parseFloat(e.target.value) || 0 } as never)
                          }
                          className="w-12 rounded border border-transparent bg-transparent px-1 py-0.5 text-center tabular-nums hover:border-border focus:border-ring focus:bg-card focus:outline-none"
                        />
                      </td>
                    )
                  )}
                  <td className="px-2 py-1 text-center">
                    {p.injuryWeeks > 0 ? (
                      <span className="rounded bg-destructive px-1.5 py-0.5 text-[10px] font-bold uppercase text-destructive-foreground">Injured</span>
                    ) : p.suspensionWeeks > 0 ? (
                      <span className="rounded bg-muted-foreground px-1.5 py-0.5 text-[10px] font-bold uppercase text-background">Susp.</span>
                    ) : (
                      <span className="rounded bg-success px-1.5 py-0.5 text-[10px] font-bold uppercase text-success-foreground">Healthy</span>
                    )}
                  </td>
                  <td className="px-0.5 py-1 text-center">
                    <input
                      type="number"
                      min={0}
                      value={p.injuryWeeks}
                      onChange={(e) => setInjuryWeeks(team, idx, parseInt(e.target.value) || 0)}
                      className="w-12 rounded border border-transparent bg-transparent px-1 py-0.5 text-center tabular-nums hover:border-border focus:border-ring focus:bg-card focus:outline-none"
                    />
                  </td>
                  <td className="px-0.5 py-1 text-center">
                    <input
                      type="number"
                      min={0}
                      value={p.suspensionWeeks}
                      onChange={(e) => setSuspensionWeeks(team, idx, parseInt(e.target.value) || 0)}
                      className="w-12 rounded border border-transparent bg-transparent px-1 py-0.5 text-center tabular-nums hover:border-border focus:border-ring focus:bg-card focus:outline-none"
                    />
                  </td>
                  <td className="px-2 py-1 text-center">
                    <button
                      onClick={() => removePlayer(team, idx)}
                      className="text-[11px] font-semibold text-destructive hover:underline"
                    >
                      remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => addPlayer(team)} className="font-semibold">
          + ADD BLANK PLAYER
        </Button>
        <p className="text-xs text-muted-foreground">
          Assign your starting nine via the pitch above. AGE is editable (auto-seeded from a
          physical/mental profile and used by the offseason aging engine). MOR is rolling player
          morale. OVR is auto-calculated from attributes by position.
        </p>
      </div>

      <div className="mt-5 rounded-xl border bg-panel/40 p-4">
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide">Injured / Suspended Reserve</h3>
        {reserves.length === 0 ? (
          <p className="text-xs text-muted-foreground">No players unavailable — full squad fit.</p>
        ) : (
          <ul className="divide-y">
            {reserves.map(({ p, idx }) => (
              <li key={idx} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                <span className="font-medium">
                  {p.name} <span className="text-muted-foreground">({p.position})</span>
                </span>
                <span className="flex gap-3 font-mono text-xs">
                  {p.injuryWeeks > 0 && (
                    <span className="text-destructive">INJURY · {weeksLabel(p.injuryWeeks)} left</span>
                  )}
                  {p.suspensionWeeks > 0 && (
                    <span className="text-muted-foreground">SUSPENSION · {p.suspensionWeeks} wk left</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PitchRow({
  slots, group, team, t, setLineupSlot,
}: {
  slots: { group: string; label: string }[];
  group: string;
  team: string;
  t: { players: { name: string; position: string }[]; lineup: string[] };
  setLineupSlot: (team: string, slot: number, name: string) => void;
}) {
  const indices = slots
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.group === group);
  if (!indices.length) return null;

  return (
    <div className="mb-3 flex flex-wrap justify-center gap-3 last:mb-0">
      {indices.map(({ s, i }) => {
        const current = t.lineup[i] ?? "";
        const eligible = t.players.filter((p) => positionGroup(p.position) === group);
        return (
          <div key={i} className={`w-40 rounded-lg border p-1.5 ${GROUP_COLOR[group] ?? "bg-card"}`}>
            <div className="mb-1 text-center text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              {s.label}
            </div>
            <Select
              value={current || "__none__"}
              onValueChange={(v) => setLineupSlot(team, i, v === "__none__" ? "" : v)}
            >
              <SelectTrigger className="h-8 w-full bg-card text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— empty —</SelectItem>
                {eligible.map((p) => (
                  <SelectItem key={p.name} value={p.name}>{p.name} ({p.position})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      })}
    </div>
  );
}
