import { useEffect, useState } from "react";
import {
  useLeague, ATTR_KEYS, isPlayerOut, SEASON_ENDING_WEEKS, type AttrKey,
} from "@/state/league";
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

function weeksLabel(weeks: number): string {
  if (weeks >= SEASON_ENDING_WEEKS) return "Season";
  return `${weeks} wk`;
}

export function TeamEditorSuite() {
  const {
    state, updateBudget, updatePlayer, toggleStarter,
    setInjuryWeeks, setSuspensionWeeks, addPlayer, removePlayer, renameTeam,
  } = useLeague();
  const [team, setTeam] = useState(state.teamOrder[0]);
  const [nameDraft, setNameDraft] = useState(team);

  // Keep selection valid if teams change; sync name draft to selection.
  useEffect(() => {
    if (!state.teams[team]) setTeam(state.teamOrder[0]);
  }, [state.teams, state.teamOrder, team]);
  useEffect(() => { setNameDraft(team); }, [team]);

  const t = state.teams[team];
  if (!t) return null;

  const starterCount = t.players.filter((p) => p.starter && !isPlayerOut(p)).length;
  const reserves = t.players
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => isPlayerOut(p));

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
        <div className="ml-auto text-xs text-muted-foreground">
          Tactical style: <span className="font-semibold text-foreground">{t.tactical_style}</span>
          {" · "}Active starters: <span className={starterCount === 9 ? "font-semibold text-success" : "font-semibold text-destructive"}>{starterCount}/9</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b bg-panel text-left font-bold uppercase tracking-wide text-muted-foreground">
              <th className="px-2 py-2 text-center">START</th>
              <th className="px-2 py-2 text-left">PLAYER</th>
              <th className="px-2 py-2 text-center">POS</th>
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
                  <td className="px-2 py-1 text-center">
                    <input
                      type="checkbox"
                      checked={p.starter}
                      onChange={() => toggleStarter(team, idx)}
                      className="h-4 w-4 accent-[var(--color-success)]"
                    />
                  </td>
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
                  {NUM_COLS.map((c) => (
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
                  ))}
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
          Green rows = active matchday lineup. Red rows are on the injured/suspended reserve and are
          excluded from the simulation. INJ / SUS are weeks remaining (set manually anytime).
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
