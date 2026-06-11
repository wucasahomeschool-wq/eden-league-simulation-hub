import { useState } from "react";
import { useLeague } from "@/state/league";
import { CONTRACT_EXEMPT_TEAMS, type ContractAction } from "@/lib/contracts";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const ACTION_TONE: Record<ContractAction["type"], string> = {
  RESIGNED: "text-success",
  NEGOTIATED: "text-success",
  EMERGENCY_SIGN: "text-primary",
  RELEASED: "text-destructive",
  FREE_AGENT: "text-destructive",
};

export function ContractsSuite() {
  const { state, runContractCycle, signFreeAgent } = useLeague();
  const [log, setLog] = useState<ContractAction[]>([]);
  const [ran, setRan] = useState(false);
  const [signTo, setSignTo] = useState(state.teamOrder[0]);

  const cap = state.salaryCap ?? 0;
  const seasonOver = !!state.playoffs?.champion;
  const freeAgents = state.freeAgents ?? [];

  function handleRun() {
    const actions = runContractCycle();
    setLog(actions);
    setRan(true);
  }

  if (!seasonOver) {
    return (
      <div className="rounded-xl border border-border bg-card/70 p-8 text-center shadow-lg">
        <h2 className="mb-2 text-lg font-extrabold uppercase tracking-wide text-primary">Contracts — Locked</h2>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          The Contracts suite opens once the season has ended (a playoff champion is crowned). Finish the
          playoffs to run the offseason contract cycle, free agency and salary-cap compliance.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card/70 p-4 shadow-lg">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hard Salary Cap</div>
          <div className="font-mono text-2xl font-extrabold text-primary">${cap.toFixed(1)}M</div>
        </div>
        <p className="max-w-xl text-xs text-muted-foreground">
          Run the offseason cycle to decay all contracts by one year, let the AI front offices of the 22
          non-exempt clubs re-sign, negotiate or release expiring players, and emergency-fill any roster
          below 11 from the free-agent pool. Gugu Team and Spams are exempt — handle them manually in the
          Team Editor.
        </p>
        <Button className="ml-auto font-bold" onClick={handleRun}>
          ▶ RUN OFFSEASON CONTRACT CYCLE
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Payroll board */}
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow">
          <div className="border-b bg-panel px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Payroll vs Cap
          </div>
          <table className="w-full text-xs">
            <tbody>
              {state.teamOrder.map((name) => {
                const team = state.teams[name];
                const payroll = team.players.reduce((s, p) => s + (p.salary ?? 0), 0);
                const over = payroll > cap + 0.001;
                const expiring = team.players.filter((p) => (p.contractYears ?? 0) === 0).length;
                return (
                  <tr key={name} className="border-b last:border-0">
                    <td className="px-3 py-1.5 font-medium">
                      {name}
                      {CONTRACT_EXEMPT_TEAMS.has(name) && (
                        <span className="ml-1 rounded bg-amber-200 px-1 text-[9px] font-bold uppercase text-amber-900">manual</span>
                      )}
                    </td>
                    <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${over ? "text-destructive font-bold" : ""}`}>
                      ${payroll.toFixed(1)}M
                    </td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground">
                      {expiring > 0 ? `${expiring} expiring` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Free agents */}
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow">
          <div className="flex items-center gap-2 border-b bg-panel px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Free Agent Pool ({freeAgents.length})
            <div className="ml-auto flex items-center gap-1">
              <Select value={signTo} onValueChange={setSignTo}>
                <SelectTrigger className="h-7 w-44 bg-card text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {state.teamOrder.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {freeAgents.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground">No unattached players. Run the cycle to release expiring players into free agency.</p>
          ) : (
            <table className="w-full text-xs">
              <tbody>
                {[...freeAgents].sort((a, b) => b.rating - a.rating).map((p) => (
                  <tr key={p.name} className="border-b last:border-0">
                    <td className="px-3 py-1.5 font-medium">{p.name} <span className="text-muted-foreground">({p.position})</span></td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">OVR {p.rating.toFixed(1)}</td>
                    <td className="px-3 py-1.5 text-right">
                      <button
                        onClick={() => signFreeAgent(signTo, p.name)}
                        className="text-[11px] font-semibold text-primary hover:underline"
                      >
                        sign → {signTo}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Cycle log */}
      {ran && (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow">
          <div className="border-b bg-panel px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Offseason Front-Office Report
          </div>
          {log.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground">No expiring contracts required action this offseason.</p>
          ) : (
            <ul className="divide-y font-mono text-xs">
              {log.map((a, i) => (
                <li key={i} className="px-3 py-1.5">
                  <span className={`font-bold ${ACTION_TONE[a.type]}`}>{a.type.replace("_", " ")}</span>{" "}
                  <span className="font-semibold">{a.player}</span> · {a.team} — {a.detail}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
