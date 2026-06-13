import { useMemo, useState } from "react";
import {
  useLeague, TRANSFER_WINDOW_LAST_WEEK, type LeagueTeam,
} from "@/state/league";
import { calculatePlayerValue, tradeBlockReason, type TradeProposal } from "@/lib/trades";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const TOP_COUNT = 5;


const NONE = "__none__";

export function TradesSuite() {
  const { state, executeTrade, executeManualTrade, declineTrade, refreshTradeProposals } = useLeague();
  const lastWindowWeek = state.settings?.transferWindowLastWeek ?? TRANSFER_WINDOW_LAST_WEEK;
  const inWindow = state.currentWeek <= lastWindowWeek;
  const [showAll, setShowAll] = useState(false);


  function acceptProposal(t: TradeProposal) {
    const reason = tradeBlockReason(state, t.teamA, t.teamB, [t.aSends], [t.bSends], t.cashAReceives, t.cashBReceives);
    if (reason) {
      toast.error("Trade blocked", { description: reason });
      return;
    }
    executeTrade(t);
    toast.success("Trade completed", { description: `${t.teamA} ↔ ${t.teamB}` });
  }

  function submitManualTrade(
    teamA: string, teamB: string, aPlayers: string[], bPlayers: string[], cashA: number, cashB: number,
  ): boolean {
    const reason = tradeBlockReason(state, teamA, teamB, aPlayers, bPlayers, cashA, cashB);
    if (reason) {
      toast.error("Trade blocked", { description: reason });
      return false;
    }
    executeManualTrade(teamA, teamB, aPlayers, bPlayers, cashA, cashB);
    toast.success("Trade completed", { description: `${teamA} ↔ ${teamB}` });
    return true;
  }

  return (
    <div className="space-y-8">
      {/* AUTOMATIC SECTION */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-extrabold uppercase tracking-wide">Automatic Trade Desk</h2>
            <p className="text-xs text-muted-foreground">
              The market engine scans all 24 clubs each match week and surfaces every deal whose
              combined utility clears the quality threshold — not a fixed count.{" "}
              {inWindow ? "Transfer window OPEN." : `Window closed (reopens next season, runs through Week ${lastWindowWeek}).`}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={refreshTradeProposals}>
            RUN TRADE ENGINE NOW
          </Button>
        </div>

        {state.tradeProposals.length === 0 ? (
          <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
            No proposals clear the utility threshold right now. Deals are generated automatically each
            week, or run the engine now.
          </div>
        ) : (
          <div className="space-y-3">
            {state.tradeProposals.map((t) => (
              <ProposalCard
                key={t.id}
                t={t}
                onAccept={() => acceptProposal(t)}
                onDecline={() => declineTrade(t.id)}
              />
            ))}
          </div>
        )}
      </section>

      {/* MANUAL SECTION */}
      <section>
        <h2 className="mb-3 text-base font-extrabold uppercase tracking-wide">Manual Trade Builder</h2>
        <ManualTrade teams={state.teamOrder.map((n) => state.teams[n])} onSubmit={submitManualTrade} />
      </section>
    </div>
  );
}

function ProposalCard({
  t, onAccept, onDecline,
}: {
  t: TradeProposal; onAccept: () => void; onDecline: () => void;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border bg-panel/40 p-3">
          <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t.teamA}</div>
          <p className="mt-1 text-sm">
            Sends <span className="font-semibold">{t.aSends}</span>
            {t.cashBReceives > 0 && <> + <span className="font-mono">${t.cashBReceives}M</span></>}
          </p>
          <p className="mt-1 text-[11px] font-mono text-success">Utility +{t.deltaUA}</p>
        </div>
        <div className="rounded-lg border bg-panel/40 p-3">
          <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t.teamB}</div>
          <p className="mt-1 text-sm">
            Sends <span className="font-semibold">{t.bSends}</span>
            {t.cashAReceives > 0 && <> + <span className="font-mono">${t.cashAReceives}M</span></>}
          </p>
          <p className="mt-1 text-[11px] font-mono text-success">Utility +{t.deltaUB}</p>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onDecline}>DECLINE</Button>
        <Button size="sm" onClick={onAccept}>ACCEPT</Button>
      </div>
    </div>
  );
}

function ManualTrade({
  teams, onSubmit,
}: {
  teams: LeagueTeam[];
  onSubmit: (teamA: string, teamB: string, aPlayers: string[], bPlayers: string[], cashA: number, cashB: number) => boolean;
}) {
  const [teamAName, setTeamAName] = useState(teams[0].name);
  const [teamBName, setTeamBName] = useState(teams[1].name);
  const teamA = teams.find((t) => t.name === teamAName) ?? teams[0];
  const teamB = teams.find((t) => t.name === teamBName) ?? teams[1];

  const [aPlayers, setAPlayers] = useState<string[]>([]);
  const [bPlayers, setBPlayers] = useState<string[]>([]);
  const [cashAReceives, setCashAReceives] = useState("0");
  const [cashBReceives, setCashBReceives] = useState("0");

  // Reset selections when a club changes so stale names don't linger.
  const aRosterKey = useMemo(() => teamA.players.map((p) => p.name).join("|"), [teamA]);
  const bRosterKey = useMemo(() => teamB.players.map((p) => p.name).join("|"), [teamB]);
  const validA = useMemo(() => aPlayers.filter((n) => teamA.players.some((p) => p.name === n)), [aPlayers, aRosterKey]);
  const validB = useMemo(() => bPlayers.filter((n) => teamB.players.some((p) => p.name === n)), [bPlayers, bRosterKey]);

  const sameTeam = teamAName === teamBName;
  const aValueTotal = validA.reduce((s, n) => s + (calculatePlayerValue(teamA.players.find((p) => p.name === n)!) || 0), 0);
  const bValueTotal = validB.reduce((s, n) => s + (calculatePlayerValue(teamB.players.find((p) => p.name === n)!) || 0), 0);
  const nothing = validA.length === 0 && validB.length === 0;

  function submit() {
    if (sameTeam || nothing) return;
    const ok = onSubmit(
      teamAName, teamBName, validA, validB,
      Math.max(0, parseFloat(cashAReceives) || 0),
      Math.max(0, parseFloat(cashBReceives) || 0),
    );
    if (!ok) return; // keep the form intact so the deal can be adjusted
    setAPlayers([]); setBPlayers([]); setCashAReceives("0"); setCashBReceives("0");
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <TeamPicker label="Team A" value={teamAName} teams={teams} onChange={(v) => { setTeamAName(v); setAPlayers([]); }} />
          <CascadingPlayers label="A sends" team={teamA} value={validA} onChange={setAPlayers} />
          <p className="text-[11px] text-muted-foreground">Total value out: <span className="font-mono">${aValueTotal.toFixed(1)}M</span></p>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cash A receives ($M)</label>
            <Input type="number" min={0} step="0.1" value={cashAReceives} onChange={(e) => setCashAReceives(e.target.value)} className="bg-card" />
          </div>
        </div>
        <div className="space-y-2">
          <TeamPicker label="Team B" value={teamBName} teams={teams} onChange={(v) => { setTeamBName(v); setBPlayers([]); }} />
          <CascadingPlayers label="B sends" team={teamB} value={validB} onChange={setBPlayers} />
          <p className="text-[11px] text-muted-foreground">Total value out: <span className="font-mono">${bValueTotal.toFixed(1)}M</span></p>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cash B receives ($M)</label>
            <Input type="number" min={0} step="0.1" value={cashBReceives} onChange={(e) => setCashBReceives(e.target.value)} className="bg-card" />
          </div>
        </div>
      </div>
      {sameTeam && <p className="mt-2 text-xs text-destructive">Pick two different clubs.</p>}
      <div className="mt-4 flex justify-end">
        <Button onClick={submit} disabled={sameTeam || nothing} className="px-6 font-semibold">
          INITIATE TRADE
        </Button>
      </div>
    </div>
  );
}

function TeamPicker({
  label, value, teams, onChange,
}: {
  label: string; value: string; teams: LeagueTeam[]; onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full bg-card"><SelectValue /></SelectTrigger>
        <SelectContent>
          {teams.map((t) => <SelectItem key={t.name} value={t.name}>{t.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

// Cascading player picker: starts with a single "No player" dropdown. Selecting
// a real player reveals another dropdown (defaulting to "No player") containing
// the remaining roster, and so on.
function CascadingPlayers({
  label, team, value, onChange,
}: {
  label: string; team: LeagueTeam; value: string[]; onChange: (v: string[]) => void;
}) {
  const rows = [...value, ""]; // trailing empty slot for the next pick

  function setAt(i: number, name: string) {
    const next = [...value];
    if (name === "") next.splice(i, 1);
    else next[i] = name;
    onChange(next.filter(Boolean));
  }

  return (
    <div>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</label>
      <div className="space-y-1.5">
        {rows.map((cur, i) => {
          const taken = new Set(value.filter((_, j) => j !== i));
          const options = team.players.filter((p) => !taken.has(p.name));
          return (
            <Select
              key={i}
              value={cur || NONE}
              onValueChange={(v) => setAt(i, v === NONE ? "" : v)}
            >
              <SelectTrigger className="w-full bg-card"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No player</SelectItem>
                {options.map((p) => (
                  <SelectItem key={p.name} value={p.name}>{p.name} ({p.position})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        })}
      </div>
    </div>
  );
}
