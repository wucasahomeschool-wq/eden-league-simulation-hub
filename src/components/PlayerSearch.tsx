import { useMemo, useState } from "react";
import { useLeague, type LeaguePlayer } from "@/state/league";
import { useNavigation } from "@/state/navigation";
import { parseSearchQuery, playerMatchesQuery } from "@/lib/player-search";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const STAT_COLS: { key: keyof LeaguePlayer; label: string }[] = [
  { key: "rating", label: "OVR" },
  { key: "FIN", label: "FIN" }, { key: "SHO", label: "SHO" }, { key: "PAS", label: "PAS" },
  { key: "VIS", label: "VIS" }, { key: "DRI", label: "DRI" }, { key: "PAC", label: "PAC" },
  { key: "STA", label: "STA" }, { key: "DEF", label: "DEF" }, { key: "TAC", label: "TAC" },
  { key: "POS_attr", label: "POS" }, { key: "COM", label: "COM" }, { key: "WR", label: "WR" },
  { key: "AGG", label: "AGG" }, { key: "STR", label: "STR" }, { key: "AER", label: "AER" },
];

const MAX_RESULTS = 40;

export function PlayerSearch() {
  const { state } = useLeague();
  const { goToSuite } = useNavigation();
  const [query, setQuery] = useState("");

  const parsed = useMemo(() => parseSearchQuery(query), [query]);

  const results = useMemo(() => {
    if (parsed.isEmpty) return [];
    const hits: { team: string; player: LeaguePlayer }[] = [];
    for (const name of state.teamOrder) {
      const t = state.teams[name];
      if (!t) continue;
      for (const p of t.players) {
        if (playerMatchesQuery(p, parsed)) hits.push({ team: name, player: p });
      }
    }
    return hits.slice(0, MAX_RESULTS);
  }, [parsed, state.teamOrder, state.teams]);

  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="mb-1 text-base font-extrabold uppercase tracking-wide">Player Search</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Search by name, position, or traits — combine them freely. Examples:{" "}
        <span className="font-mono">Salmon</span>,{" "}
        <span className="font-mono">RW speed &gt; 8.5</span>,{" "}
        <span className="font-mono">pos:CB STR &gt;= 8 PAC &lt; 6</span>. Friendly words
        (speed, finishing, strength…) and raw codes (PAC, FIN, STR…) both work.
      </p>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="e.g. striker finishing > 8.5"
        className="bg-background"
      />

      {!parsed.isEmpty && (
        <div className="mt-3">
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground">No players match that search.</p>
          ) : (
            <div className="space-y-3">
              {results.map(({ team, player }, i) => (
                <div key={`${team}-${player.name}-${i}`} className="rounded-lg border bg-background p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-sm font-bold">{player.name}</span>{" "}
                      <span className="text-xs text-muted-foreground">{player.position} · {team} · age {player.age}</span>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => goToSuite("Team Editor", { team, player: player.name })}>
                      View in Team Editor
                    </Button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-[11px]">
                      <thead>
                        <tr className="text-muted-foreground">
                          {STAT_COLS.map((c) => <th key={c.label} className="px-1.5 py-0.5 text-center font-semibold">{c.label}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          {STAT_COLS.map((c) => (
                            <td key={c.label} className={`px-1.5 py-0.5 text-center font-mono tabular-nums ${c.key === "rating" ? "font-bold text-primary" : ""}`}>
                              {Number(player[c.key]).toFixed(1)}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
              {results.length === MAX_RESULTS && (
                <p className="text-center text-[11px] text-muted-foreground">Showing first {MAX_RESULTS} matches — refine your search to narrow it down.</p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
