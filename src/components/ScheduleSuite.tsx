import { useMemo, useState } from "react";
import {
  useLeague, isManualOnly, isWeekComplete, maxScheduledWeek, type FixtureEntry,
} from "@/state/league";
import { SimulationTerminal } from "@/components/SimulationTerminal";
import { FixtureBuilder } from "@/components/FixtureBuilder";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const REGULAR_WEEKS = Array.from({ length: 12 }, (_, i) => i + 1);
const FINAL_FOUR_WEEKS = [13, 14, 15, 16];

export function ScheduleSuite() {
  const { state, setResult, startNewSeason } = useLeague();
  const [simFixture, setSimFixture] = useState<FixtureEntry | null>(null);
  const [manualFixture, setManualFixture] = useState<FixtureEntry | null>(null);
  const [confirmNewSeason, setConfirmNewSeason] = useState(false);

  const weeks = useMemo(() => {
    const map = new Map<number, FixtureEntry[]>();
    for (const f of state.fixtures) {
      if (!map.has(f.week)) map.set(f.week, []);
      map.get(f.week)!.push(f);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [state.fixtures]);

  const week12Done = isWeekComplete(state, 12);
  const finalFourExists = state.fixtures.some((f) => f.week >= 13);
  const week16Done = isWeekComplete(state, 16);
  const preSeason = state.fixtures.length === 0;
  // Which regular weeks still need fixtures entered (1-12).
  const missingRegularWeeks = REGULAR_WEEKS.filter(
    (w) => !state.fixtures.some((f) => f.week === w)
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm text-muted-foreground">
            Season <span className="font-semibold text-foreground">{state.season}</span>
            {" · "}Active week: <span className="font-semibold text-foreground">Week {state.currentWeek}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {preSeason
              ? "Pre-season — enter Weeks 1–12 to begin"
              : state.currentWeek <= 12
              ? `${12 - state.currentWeek + 1} regular weeks + Final Four remaining`
              : "Final Four phase"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setConfirmNewSeason(true)}>
          START NEW SEASON
        </Button>
      </div>

      {/* Pre-season: build regular schedule */}
      {missingRegularWeeks.length > 0 && (
        <div className="mb-6 space-y-3">
          <div className="rounded-xl border bg-panel/50 p-4 text-sm">
            <p className="font-semibold">Set up Season {state.season}</p>
            <p className="mt-1 text-muted-foreground">
              Run the Eden League draft and review every squad in the <strong>Team Editor</strong> first.
              Then enter the AI-generated Weeks 1–12 fixtures below to start the season.
            </p>
          </div>
          <FixtureBuilder weeks={missingRegularWeeks} title="Build Regular Season (Weeks 1–12)" />
        </div>
      )}

      {/* Final Four builder: after Week 12 completes, manual entry */}
      {week12Done && !finalFourExists && (
        <div className="mb-6 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <FixtureBuilder weeks={FINAL_FOUR_WEEKS} title="Build Final Four (Weeks 13–16)" />
          <StandingsReference />
        </div>
      )}

      <div className="space-y-6">
        {weeks.map(([week, fixtures]) => {
          const isActive = week === state.currentWeek;
          const isFinalFour = week >= 13;
          return (
            <section key={week} className="rounded-xl border bg-card">
              <header className="flex items-center justify-between border-b px-4 py-2.5">
                <h3 className="text-sm font-bold uppercase tracking-wide">
                  {isFinalFour ? `Final Four · Week ${week}` : `Week ${week}`}
                </h3>
                {isActive && (
                  <span className="rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-bold uppercase text-primary-foreground">
                    Active
                  </span>
                )}
              </header>
              <ul className="divide-y">
                {fixtures.map((fx) => {
                  const r = state.results[fx.id];
                  const manualOnly = isManualOnly(fx.home, fx.away);
                  return (
                    <li key={fx.id} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 py-2.5 text-sm">
                      <span className="truncate text-right font-medium">{fx.home}</span>
                      <span className="min-w-[64px] text-center font-mono font-bold tabular-nums">
                        {r ? `${r.homeGoals} - ${r.awayGoals}` : "vs"}
                      </span>
                      <span className="truncate text-left font-medium">{fx.away}</span>

                      {isActive && !r && (
                        <div className="col-span-3 mt-1 flex flex-wrap justify-center gap-2">
                          {!manualOnly && (
                            <Button size="sm" variant="secondary" onClick={() => setSimFixture(fx)}>
                              SIMULATE
                            </Button>
                          )}
                          <Button size="sm" variant="outline" onClick={() => setManualFixture(fx)}>
                            ENTER MATCH RESULT
                          </Button>
                          {manualOnly && (
                            <span className="self-center text-[10px] uppercase text-muted-foreground">
                              Manual entry only
                            </span>
                          )}
                        </div>
                      )}
                      {r && (
                        <span className="col-span-3 mt-0.5 text-center text-[10px] uppercase text-muted-foreground">
                          {r.method === "SIM" ? "Simulated" : "Manual entry"}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {!preSeason && state.currentWeek === 12 && !week12Done && (
          <p className="text-center text-xs text-muted-foreground">
            Final Four (Weeks 13–16) unlock once Week 12 is fully recorded.
          </p>
        )}
        {week16Done && (
          <p className="text-center text-xs font-semibold text-primary">
            Regular season complete — open the Playoffs suite to seed the top 14.
          </p>
        )}
      </div>

      {/* Full-screen simulator overlay */}
      {simFixture && (
        <SimulationTerminal
          initialHome={simFixture.home}
          initialAway={simFixture.away}
          lockTeams
          defaultTempoIndex={1}
          fullscreen
          onComplete={(h, a) => setResult(simFixture.id, h, a, "SIM")}
          onExit={() => setSimFixture(null)}
        />
      )}

      {/* Manual entry modal */}
      <ManualEntryDialog
        fixture={manualFixture}
        onClose={() => setManualFixture(null)}
        onSave={(h, a) => {
          if (manualFixture) setResult(manualFixture.id, h, a, "MANUAL");
          setManualFixture(null);
        }}
      />

      {/* New season confirm */}
      <Dialog open={confirmNewSeason} onOpenChange={setConfirmNewSeason}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Start Season {state.season + 1}?</DialogTitle>
            <DialogDescription>
              Teams, players and budgets are kept. All match results, fixtures and playoffs are
              cleared so you can run the draft and enter a fresh Weeks 1–12 schedule.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmNewSeason(false)}>Cancel</Button>
            <Button
              onClick={() => { startNewSeason(); setConfirmNewSeason(false); }}
            >
              Start New Season
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StandingsReference() {
  const { standings } = useLeague();
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <div className="border-b px-4 py-2.5 text-sm font-bold uppercase tracking-wide">
        Standings Reference
      </div>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b bg-panel text-left font-bold uppercase text-muted-foreground">
            <th className="px-3 py-2">#</th>
            <th className="px-3 py-2">Team</th>
            <th className="px-3 py-2 text-center">PTS</th>
            <th className="px-3 py-2 text-center">GD</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((row) => (
            <tr key={row.team} className="border-b last:border-0 odd:bg-muted/40">
              <td className="px-3 py-1.5 text-center font-mono tabular-nums">{row.rank}</td>
              <td className="px-3 py-1.5 font-medium">{row.team}</td>
              <td className="px-3 py-1.5 text-center font-mono font-bold tabular-nums text-primary">{row.pts}</td>
              <td className="px-3 py-1.5 text-center tabular-nums">{row.gd > 0 ? `+${row.gd}` : row.gd}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ManualEntryDialog({
  fixture, onClose, onSave,
}: {
  fixture: FixtureEntry | null;
  onClose: () => void;
  onSave: (h: number, a: number) => void;
}) {
  const [h, setH] = useState("0");
  const [a, setA] = useState("0");
  return (
    <Dialog open={!!fixture} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Enter Match Result</DialogTitle>
        </DialogHeader>
        {fixture && (
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
            <div>
              <div className="mb-1 truncate text-xs font-semibold">{fixture.home}</div>
              <Input type="number" min={0} value={h} onChange={(e) => setH(e.target.value)} className="text-center" />
            </div>
            <span className="pb-2 font-bold text-muted-foreground">-</span>
            <div>
              <div className="mb-1 truncate text-xs font-semibold">{fixture.away}</div>
              <Input type="number" min={0} value={a} onChange={(e) => setA(e.target.value)} className="text-center" />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(Math.max(0, parseInt(h) || 0), Math.max(0, parseInt(a) || 0))}>
            Log Result
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
