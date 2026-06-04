import { useState } from "react";
import { useLeague, ATTR_KEYS, type AttrKey } from "@/state/league";
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

export function TeamEditorSuite() {
  const { state, updateBudget, updatePlayer, toggleStarter } = useLeague();
  const [team, setTeam] = useState(state.teamOrder[0]);
  const t = state.teams[team];
  const starterCount = t.players.filter((p) => p.starter).length;

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
          {" · "}Starters: <span className={starterCount === 9 ? "font-semibold text-success" : "font-semibold text-destructive"}>{starterCount}/9</span>
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
            </tr>
          </thead>
          <tbody>
            {t.players.map((p, idx) => (
              <tr key={idx} className={`border-b last:border-0 ${p.starter ? "bg-starter" : ""}`}>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Green rows are the active matchday lineup fed to the simulation engine. Toggle START to swap players in or out — the engine uses the 9 flagged starters.
      </p>
    </div>
  );
}
