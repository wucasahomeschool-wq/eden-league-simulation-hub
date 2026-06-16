import { createServerFn } from "@tanstack/react-start";

// AI trade engine — Lovable AI generates realistic trade proposals across the
// whole league market. The model only PROPOSES; the client re-validates every
// returned deal against the existing safety guards (roster legality, salary
// cap, affordability, fieldability) before any proposal is surfaced.

export interface AiProposedTerm {
  teamA: string;
  teamB: string;
  aSends: string; // player name teamA gives to teamB ("" if none)
  bSends: string; // player name teamB gives to teamA ("" if none)
  cashAReceives: number; // $M paid by B to A
  cashBReceives: number; // $M paid by A to B
  aPicks?: string[]; // draft pick labels teamA gives to teamB
  bPicks?: string[]; // draft pick labels teamB gives to teamA
}

interface GenerateInput {
  brief: string; // full-league factual digest assembled on the client
  count?: number; // desired number of proposals
}

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

function extractJsonArray<T>(content: string): T[] | null {
  const start = content.indexOf("[");
  const end = content.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed = JSON.parse(content.slice(start, end + 1));
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

async function callGateway(apiKey: string, system: string, user: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(GATEWAY, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.95,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new Error("AI request timed out");
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429) throw new Error("RATE_LIMIT");
  if (res.status === 402) throw new Error("CREDITS");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AI request failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content?.trim() ?? "";
}

const TRADE_RULES = `
Eden League is a fictional 24-team 9v9 soccer league. You are the league's trade market engine. Using ONLY the DATA block, propose a set of realistic, mutually-beneficial one-for-one player trades between clubs.

ABSOLUTE RULES:
- Use ONLY clubs and players that appear in the DATA. Never invent players, ratings, values, or clubs.
- Each proposal swaps exactly ONE player from club A for ONE player from club B, optionally with cash to bridge a value gap.
- Cash is in $M and must be affordable from the paying club's transfer budget. The richer-value side receives cash; if values are equal, cash is 0.
- A deal must make sense for BOTH clubs: address a positional need, upgrade a weak spot, cash in on a surplus, or get fair value. Avoid lopsided robberies.
- Never propose a deal that would leave a club unable to field a team or that pushes a club over the salary cap (salaries travel with the player).
- Draw on the FULL league picture: relative team strength, positional depth, ages, contract situations, and budgets.

OUTPUT FORMAT:
- Respond with ONLY a JSON array of proposal objects, no prose, no markdown:
[{"teamA":"<club>","teamB":"<club>","aSends":"<player on teamA>","bSends":"<player on teamB>","cashAReceives":<number>,"cashBReceives":<number>}]
- cashAReceives is $M teamB pays teamA; cashBReceives is $M teamA pays teamB. At most one is greater than 0.
`;

export const generateAiTradeProposals = createServerFn({ method: "POST" })
  .inputValidator((data: GenerateInput) => {
    if (!data || typeof data.brief !== "string" || data.brief.trim().length === 0) {
      throw new Error("Missing trade market brief");
    }
    return data;
  })
  .handler(async ({ data }): Promise<{ proposals: AiProposedTerm[] }> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI is not configured");

    const count = Math.min(Math.max(data.count ?? 12, 4), 25);
    const user = [
      `DATA (the only facts you may use):`,
      ``,
      data.brief,
      ``,
      `Propose up to ${count} of the best, most realistic trades right now. JSON array only.`,
    ].join("\n");

    const content = await callGateway(apiKey, TRADE_RULES, user);
    const raw = extractJsonArray<Record<string, unknown>>(content) ?? [];

    const proposals: AiProposedTerm[] = [];
    for (const r of raw) {
      const teamA = typeof r.teamA === "string" ? r.teamA : "";
      const teamB = typeof r.teamB === "string" ? r.teamB : "";
      const aSends = typeof r.aSends === "string" ? r.aSends : "";
      const bSends = typeof r.bSends === "string" ? r.bSends : "";
      if (!teamA || !teamB || !aSends || !bSends) continue;
      proposals.push({
        teamA,
        teamB,
        aSends,
        bSends,
        cashAReceives: Number(r.cashAReceives) || 0,
        cashBReceives: Number(r.cashBReceives) || 0,
      });
    }
    return { proposals };
  });
