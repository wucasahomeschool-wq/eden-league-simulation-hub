import { useMemo, useState } from "react";
import {
  useLeague, TRANSFER_WINDOW_LAST_WEEK, type LeagueTeam,
} from "@/state/league";
import { calculatePlayerValue, type TradeProposal } from "@/lib/trades";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export function TradesSuite() {
  const { state, executeTrade, declineTrade, refreshTradeProposals } = useLeague();
  const inWindow = state.currentWeek <= TRANSFER_WINDOW_LAST_WEEK;

  return (
    <div className="space-y-8">
      {/* AUTOMATIC SECTION */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-extrabold uppercase tracking-wide">Automatic Trade Desk</h2>
            <p className="text-xs text-muted-foreground">
              The market engine scans all 24 clubs at the end of each match week and surfaces the
              top {5} most mutually beneficial deals.{" "}
              {inWindow ? "Transfer window OPEN." : `Window closed (reopens next season, runs through Week ${TRANSFER_WINDOW_LAST_WEEK}).`}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={refreshTradeProposals}>
            RUN TRADE ENGINE NOW
          </Button>
        </div>

        {state.tradeProposals.length === 0 ? (
          <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
            No active proposals. Deals are generated automatically each week, or run the engine now.
          </div>
        ) : (
          <div className="space-y-3">
            {state.tradeProposals.map((t) => (
              <ProposalCard
                key={t.id}
                t={t}
                onAccept={() => executeTrade(t)}
                onDecline={() => declineTrade(t.id)}
              />
            ))}
          </div>
        )}
      </section>

      {/* MANUAL SECTION */}
      <section>
        <h2 className="mb-3 text-base font-extrabold uppercase tracking-wide">Manual Trade Builder</h2>
        <ManualTrade teams={state.teamOrder.map((n) => state.teams[n])} onSubmit={executeTrade} />
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
  teams: LeagueTeam[]; onSubmit: (t: TradeProposal) => void;
}) {
  const [teamAName, setTeamAName] = useState(teams[0].name);
  const [teamBName, setTeamBName] = useState(teams[1].name);
  const teamA = teams.find((t) => t.name === teamAName) ?? teams[0];
  const teamB = teams.find((t) => t.name === teamBName) ?? teams[1];

  const [aPlayer, setAPlayer] = useState(teamA.players[0]?.name ?? "");
  const [bPlayer, setBPlayer] = useState(teamB.players[0]?.name ?? "");
  const [cashAReceives, setCashAReceives] = useState("0");
  const [cashBReceives, setCashBReceives] = useState("0");

  // Keep player selections valid when team changes.
  const aNames = useMemo(() => teamA.players.map((p) => p.name), [teamA]);
  const bNames = useMemo(() => teamB.players.map((p) => p.name), [teamB]);
  const validA = aNames.includes(aPlayer) ? aPlayer : aNames[0] ?? "";
  const validB = bNames.includes(bPlayer) ? bPlayer : bNames[0] ?? "";

  const sameTeam = teamAName === teamBName;
  const aValue = teamA.players.find((p) => p.name === validA);
  const bValue = teamB.players.find((p) => p.name === validB);

  function submit() {
    if (sameTeam || !validA || !validB) return;
    onSubmit({
      id: `manual-${Date.now()}`,
      teamA: teamAName,
      teamB: teamBName,
      aSends: validA,
      bSends: validB,
      cashAReceives: Math.max(0, parseFloat(cashAReceives) || 0),
      cashBReceives: Math.max(0, parseFloat(cashBReceives) || 0),
      deltaUA: 0,
      deltaUB: 0,
    });
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <TeamPicker label="Team A" value={teamAName} teams={teams} onChange={setTeamAName} />
          <PlayerPicker label="A sends" value={validA} names={aNames} onChange={setAPlayer} />
          {aValue && <p className="text-[11px] text-muted-foreground">Est. value: <span className="font-mono">${calculatePlayerValue(aValue)}M</span></p>}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cash A receives ($M)</label>
            <Input type="number" min={0} step="0.1" value={cashAReceives} onChange={(e) => setCashAReceives(e.target.value)} className="bg-card" />
          </div>
        </div>
        <div className="space-y-2">
          <TeamPicker label="Team B" value={teamBName} teams={teams} onChange={setTeamBName} />
          <PlayerPicker label="B sends" value={validB} names={bNames} onChange={setBPlayer} />
          {bValue && <p className="text-[11px] text-muted-foreground">Est. value: <span className="font-mono">${calculatePlayerValue(bValue)}M</span></p>}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cash B receives ($M)</label>
            <Input type="number" min={0} step="0.1" value={cashBReceives} onChange={(e) => setCashBReceives(e.target.value)} className="bg-card" />
          </div>
        </div>
      </div>
      {sameTeam && <p className="mt-2 text-xs text-destructive">Pick two different clubs.</p>}
      <div className="mt-4 flex justify-end">
        <Button onClick={submit} disabled={sameTeam || !validA || !validB} className="px-6 font-semibold">
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

function PlayerPicker({
  label, value, names, onChange,
}: {
  label: string; value: string; names: string[]; onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full bg-card"><SelectValue /></SelectTrigger>
        <SelectContent>
          {names.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
