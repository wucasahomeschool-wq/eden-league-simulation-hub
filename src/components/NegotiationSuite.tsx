import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useLeague, type LeagueTeam } from "@/state/league";
import { useNavigation } from "@/state/navigation";
import { tradeBlockReason, calculatePlayerValue, pickLabel, type TradeProposal } from "@/lib/trades";
import { buildNegotiationBrief } from "@/lib/negotiation-brief";
import {
  negotiateTrade,
  type NegotiationTerms,
  type NegotiationTurn,
} from "@/lib/negotiation.functions";
import { toast } from "sonner";
import { PlayerSearch } from "@/components/PlayerSearch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const NONE = "__none__";

interface SessionSeed {
  proposalId?: string;
  userTeam: string;
  aiTeam: string;
  userSends: string[];
  aiSends: string[];
  cashUserReceives: number;
  cashAiReceives: number;
  userPicks?: string[]; // draft pick ids the user club sends
  aiPicks?: string[]; // draft pick ids the AI club sends
}


export function NegotiationSuite() {
  const { state } = useLeague();
  const { consumePayload, goToSuite } = useNavigation();
  const exemptList = state.settings?.contractExemptTeams ?? [];
  const isUser = (n: string) => exemptList.includes(n);

  const userTeams = state.teamOrder.filter(isUser);
  const [session, setSession] = useState<SessionSeed | null>(null);
  const returnSuiteRef = useRef<string | null>(null);

  // A seeded negotiation may arrive from another suite (e.g. the Draft Suite).
  useEffect(() => {
    const payload = consumePayload();
    if (payload?.negotiationSeed) {
      setSession(payload.negotiationSeed);
      returnSuiteRef.current = payload.returnSuite ?? null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function closeSession() {
    setSession(null);
    const ret = returnSuiteRef.current;
    returnSuiteRef.current = null;
    if (ret) goToSuite(ret);
  }


  // Proposals that involve at least one user-controlled club.
  const negotiationProposals = useMemo(
    () => state.tradeProposals.filter((p) => isUser(p.teamA) || isUser(p.teamB)),
    [state.tradeProposals, exemptList.join("|")]
  );

  if (userTeams.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
        No user-controlled clubs are set. Open{" "}
        <span className="font-semibold text-foreground">Settings &amp; Version Archives</span> and
        choose your exempt clubs — those become the teams you negotiate with here.
      </div>
    );
  }

  function openFromProposal(p: TradeProposal) {
    const userTeam = isUser(p.teamA) ? p.teamA : p.teamB;
    const aiTeam = userTeam === p.teamA ? p.teamB : p.teamA;
    const seed: SessionSeed =
      userTeam === p.teamA
        ? {
            proposalId: p.id, userTeam, aiTeam,
            userSends: [p.aSends], aiSends: [p.bSends],
            cashUserReceives: p.cashAReceives, cashAiReceives: p.cashBReceives,
            userPicks: p.aPickIds ?? [], aiPicks: p.bPickIds ?? [],
          }
        : {
            proposalId: p.id, userTeam, aiTeam,
            userSends: [p.bSends], aiSends: [p.aSends],
            cashUserReceives: p.cashBReceives, cashAiReceives: p.cashAReceives,
            userPicks: p.bPickIds ?? [], aiPicks: p.aPickIds ?? [],
          };
    setSession(seed);
  }

  if (session) {
    return (
      <NegotiationPanel
        key={`${session.userTeam}-${session.aiTeam}-${session.proposalId ?? "fresh"}`}
        seed={session}
        onClose={closeSession}
      />
    );
  }

  return (
    <div className="space-y-8">
      <div className="rounded-lg border-l-4 border-highlight-blue bg-card px-4 py-2 text-xs text-muted-foreground">
        Trades involving your clubs land here. Open a deal to{" "}
        <span className="font-semibold text-foreground">negotiate directly with the rival manager</span> —
        each speaks in their own personality. Agree terms and hit INITIATE TRADE to complete it.
      </div>

      <section>
        <h2 className="mb-3 text-base font-extrabold uppercase tracking-wide">Proposals On Your Desk</h2>
        {negotiationProposals.length === 0 ? (
          <div className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
            No pending deals involving your clubs. The trade engine routes any deal touching a
            user-controlled club to this suite. You can also open a fresh negotiation below.
          </div>
        ) : (
          <div className="space-y-3">
            {negotiationProposals.map((p) => (
              <ProposalRow key={p.id} state={state} p={p} isUser={isUser} onOpen={() => openFromProposal(p)} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-base font-extrabold uppercase tracking-wide">Start a New Negotiation</h2>
        <FreshNegotiation
          userTeams={userTeams}
          allTeams={state.teamOrder.filter((n) => !isUser(n))}
          onOpen={(userTeam, aiTeam) =>
            setSession({ userTeam, aiTeam, userSends: [], aiSends: [], cashUserReceives: 0, cashAiReceives: 0 })
          }
        />
      </section>

      <PlayerSearch />
    </div>
  );
}

function ProposalRow({
  state, p, isUser, onOpen,
}: {
  state: ReturnType<typeof useLeague>["state"];
  p: TradeProposal;
  isUser: (n: string) => boolean;
  onOpen: () => void;
}) {
  const userTeam = isUser(p.teamA) ? p.teamA : p.teamB;
  const aiTeam = userTeam === p.teamA ? p.teamB : p.teamA;
  const manager = state.managers?.[aiTeam];
  const both = isUser(p.teamA) && isUser(p.teamB);
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-highlight-blue/40 bg-highlight-blue/5 p-3">
          <div className="text-xs font-bold uppercase tracking-wide text-highlight-blue">{p.teamA}</div>
          <p className="mt-1 text-sm">Sends <span className="font-semibold">{p.aSends}</span>
            {p.cashBReceives > 0 && <> + <span className="font-mono">${p.cashBReceives}M</span></>}</p>
        </div>
        <div className="rounded-lg border border-highlight-red/40 bg-highlight-red/5 p-3">
          <div className="text-xs font-bold uppercase tracking-wide text-highlight-red">{p.teamB}</div>
          <p className="mt-1 text-sm">Sends <span className="font-semibold">{p.bSends}</span>
            {p.cashAReceives > 0 && <> + <span className="font-mono">${p.cashAReceives}M</span></>}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">
          {both
            ? "Both clubs are yours — open to complete directly."
            : <>Rival manager: <span className="font-semibold text-foreground">{manager?.name ?? aiTeam}</span></>}
        </p>
        <Button size="sm" onClick={onOpen}>NEGOTIATE</Button>
      </div>
    </div>
  );
}

function FreshNegotiation({
  userTeams, allTeams, onOpen,
}: {
  userTeams: string[];
  allTeams: string[];
  onOpen: (userTeam: string, aiTeam: string) => void;
}) {
  const [userTeam, setUserTeam] = useState(userTeams[0]);
  const [aiTeam, setAiTeam] = useState(allTeams[0] ?? "");
  if (allTeams.length === 0) {
    return <p className="text-sm text-muted-foreground">No rival clubs available.</p>;
  }
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your club</label>
          <Select value={userTeam} onValueChange={setUserTeam}>
            <SelectTrigger className="w-full bg-card"><SelectValue /></SelectTrigger>
            <SelectContent>{userTeams.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rival club</label>
          <Select value={aiTeam} onValueChange={setAiTeam}>
            <SelectTrigger className="w-full bg-card"><SelectValue /></SelectTrigger>
            <SelectContent>{allTeams.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <Button onClick={() => onOpen(userTeam, aiTeam)} disabled={!userTeam || !aiTeam} className="font-semibold">
          OPEN NEGOTIATION
        </Button>
      </div>
    </div>
  );
}

function termsSignature(s: { userSends: string[]; aiSends: string[]; cashUserReceives: number; cashAiReceives: number }) {
  return [
    [...s.userSends].sort().join(","),
    [...s.aiSends].sort().join(","),
    s.cashUserReceives,
    s.cashAiReceives,
  ].join("|");
}

function NegotiationPanel({ seed, onClose }: { seed: SessionSeed; onClose: () => void }) {
  const { state, executeManualTrade, declineTrade } = useLeague();
  const run = useServerFn(negotiateTrade);

  const userTeamObj = state.teams[seed.userTeam];
  const aiTeamObj = state.teams[seed.aiTeam];
  const manager = state.managers?.[seed.aiTeam];

  const [userSends, setUserSends] = useState<string[]>(seed.userSends);
  const [aiSends, setAiSends] = useState<string[]>(seed.aiSends);
  const [cashUserReceives, setCashUserReceives] = useState(String(seed.cashUserReceives || 0));
  const [cashAiReceives, setCashAiReceives] = useState(String(seed.cashAiReceives || 0));

  // Draft picks in this deal are fixed from the seed (set in the source suite).
  const userPickIds = useMemo(() => seed.userPicks ?? [], [seed.userPicks]);
  const aiPickIds = useMemo(() => seed.aiPicks ?? [], [seed.aiPicks]);
  const labelFor = (id: string) => {
    const pk = state.draftPicks.find((p) => p.id === id);
    return pk ? pickLabel(pk) : id;
  };
  const userPickLabels = userPickIds.map(labelFor);
  const aiPickLabels = aiPickIds.map(labelFor);

  const [messages, setMessages] = useState<NegotiationTurn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agreedSignature, setAgreedSignature] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const terms: NegotiationTerms = {
    userTeam: seed.userTeam,
    aiTeam: seed.aiTeam,
    userSends,
    aiSends,
    cashUserReceives: Math.max(0, parseFloat(cashUserReceives) || 0),
    cashAiReceives: Math.max(0, parseFloat(cashAiReceives) || 0),
    userPicks: userPickLabels,
    aiPicks: aiPickLabels,
  };
  const sig = termsSignature(terms);
  const dealReady = agreedSignature !== null && agreedSignature === sig;

  const userValue = userSends.reduce((s, n) => {
    const p = userTeamObj?.players.find((x) => x.name === n);
    return s + (p ? calculatePlayerValue(p) : 0);
  }, 0);
  const aiValue = aiSends.reduce((s, n) => {
    const p = aiTeamObj?.players.find((x) => x.name === n);
    return s + (p ? calculatePlayerValue(p) : 0);
  }, 0);

  async function send() {
    const msg = input.trim();
    if (!msg || loading) return;
    setError(null);
    const brief = buildNegotiationBrief(state, seed.userTeam, seed.aiTeam);
    if (!brief) { setError("Couldn't read club data for this negotiation."); return; }

    const history = messages;
    setMessages((m) => [...m, { role: "user", text: msg }]);
    setInput("");
    setLoading(true);
    try {
      const res = await run({
        data: {
          managerName: manager?.name ?? seed.aiTeam,
          personality: manager?.personality ?? "A balanced, fair negotiator.",
          userManagerName: state.managers?.[seed.userTeam]?.name,
          brief,
          terms,
          history,
          userMessage: msg,
        },
      });
      setMessages((m) => [...m, { role: "manager", text: res.reply }]);
      setAgreedSignature(res.accepts ? sig : null);
      requestAnimationFrame(() => scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight));
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes("RATE_LIMIT")) setError("The manager's line is busy — try again in a moment.");
      else if (m.includes("CREDITS")) setError("AI credits exhausted. Add credits in Settings → Workspace → Usage.");
      else setError("Couldn't reach the manager. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function initiate() {
    const reason = tradeBlockReason(
      state, seed.userTeam, seed.aiTeam, userSends, aiSends,
      terms.cashUserReceives, terms.cashAiReceives
    );
    if (reason) { toast.error("Trade blocked", { description: reason }); return; }
    executeManualTrade(seed.userTeam, seed.aiTeam, userSends, aiSends, terms.cashUserReceives, terms.cashAiReceives, userPickIds, aiPickIds);
    if (seed.proposalId) declineTrade(seed.proposalId);
    toast.success("Trade completed", { description: `${seed.userTeam} ↔ ${seed.aiTeam}` });
    onClose();
  }

  if (!userTeamObj || !aiTeamObj) {
    return (
      <div className="space-y-3">
        <Button size="sm" variant="outline" onClick={onClose}>← Back</Button>
        <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">This negotiation is no longer valid.</div>
      </div>
    );
  }

  const isUserPersonality = (manager?.personality ?? "").trim().toUpperCase() === "USER CONTROLLED";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button size="sm" variant="outline" onClick={onClose}>← Back to desk</Button>
        <div className="text-right">
          <div className="text-sm font-extrabold">{seed.userTeam} <span className="text-muted-foreground">vs</span> {seed.aiTeam}</div>
          <div className="text-[11px] text-muted-foreground">
            Manager: <span className="font-semibold text-foreground">{manager?.name ?? seed.aiTeam}</span>
          </div>
        </div>
      </div>

      {!isUserPersonality && manager?.personality && (
        <div className="rounded-lg border-l-4 border-stadium-gold bg-card px-4 py-2 text-xs italic text-muted-foreground">
          {manager.personality}
        </div>
      )}

      {/* TERMS EDITOR */}
      <div className="rounded-xl border bg-card p-4">
        <h3 className="mb-3 text-xs font-extrabold uppercase tracking-wide text-muted-foreground">Deal On The Table</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <CascadingPlayers label={`${seed.userTeam} (you) send`} team={userTeamObj} value={userSends} onChange={setUserSends} />
            {userPickLabels.length > 0 && (
              <p className="text-[11px] text-muted-foreground">Picks out: <span className="font-mono text-foreground">{userPickLabels.join(", ")}</span></p>
            )}
            <p className="text-[11px] text-muted-foreground">Value out: <span className="font-mono">${userValue.toFixed(1)}M</span></p>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">You pay ($M)</label>
            <Input type="number" min={0} step="0.1" value={cashAiReceives} onChange={(e) => setCashAiReceives(e.target.value)} className="bg-card" />
          </div>
          <div className="space-y-2">
            <CascadingPlayers label={`${seed.aiTeam} send`} team={aiTeamObj} value={aiSends} onChange={setAiSends} />
            {aiPickLabels.length > 0 && (
              <p className="text-[11px] text-muted-foreground">Picks out: <span className="font-mono text-foreground">{aiPickLabels.join(", ")}</span></p>
            )}
            <p className="text-[11px] text-muted-foreground">Value out: <span className="font-mono">${aiValue.toFixed(1)}M</span></p>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">They pay you ($M)</label>
            <Input type="number" min={0} step="0.1" value={cashUserReceives} onChange={(e) => setCashUserReceives(e.target.value)} className="bg-card" />
          </div>
        </div>
        {dealReady && (
          <div className="mt-4 flex items-center justify-between gap-2 rounded-lg border border-success/40 bg-success/5 px-3 py-2">
            <span className="text-sm font-semibold text-success">{manager?.name ?? "The manager"} has agreed to these terms.</span>
            <Button onClick={initiate} className="font-semibold">INITIATE TRADE</Button>
          </div>
        )}
      </div>

      {/* CHAT */}
      {isUserPersonality ? (
        <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
          Both clubs are user-controlled — set the terms above and hit{" "}
          <button onClick={initiate} className="font-semibold text-highlight-blue underline">INITIATE TRADE</button> to complete the deal directly.
        </div>
      ) : (
        <div className="rounded-xl border bg-card p-4">
          <div ref={scrollRef} className="max-h-80 space-y-3 overflow-y-auto pr-1">
            {messages.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Open with an offer or a message to {manager?.name ?? seed.aiTeam}. Adjust the terms above as you haggle.
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
                <div className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "bg-highlight-blue/10 text-foreground"
                    : "border bg-background text-foreground"
                }`}>
                  {m.role === "manager" && <div className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{manager?.name ?? seed.aiTeam}</div>}
                  {m.text}
                </div>
              </div>
            ))}
            {loading && <p className="text-xs text-muted-foreground">{manager?.name ?? "The manager"} is considering…</p>}
          </div>

          {error && <div className="mt-3 rounded-lg border-l-4 border-highlight-red bg-background px-3 py-2 text-sm">{error}</div>}

          <div className="mt-3 flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Make your case, propose terms, push back…"
              className="bg-background"
            />
            <Button onClick={send} disabled={loading || !input.trim()} className="font-semibold">Send</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Compact cascading player picker (mirrors the Trades Suite pattern).
function CascadingPlayers({
  label, team, value, onChange,
}: {
  label: string; team: LeagueTeam; value: string[]; onChange: (v: string[]) => void;
}) {
  const rows = [...value, ""];
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
            <Select key={i} value={cur || NONE} onValueChange={(v) => setAt(i, v === NONE ? "" : v)}>
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
