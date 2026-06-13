import { createServerFn } from "@tanstack/react-start";

// Negotiation Suite — AI trade negotiation against personality-driven managers.
// Entertainment/strategy layer ONLY: the AI talks, it never mutates league
// state. The CLIENT assembles a factual brief (real rosters, ratings, values,
// budgets, cap) and the concrete on-the-table terms; this function narrates a
// reply in character and signals whether the manager accepts THOSE terms.
// The actual trade is executed client-side by the existing trade engine.

export interface NegotiationTerms {
  userTeam: string;
  aiTeam: string;
  userSends: string[]; // player names the user's club gives up
  aiSends: string[]; // player names the AI club gives up
  cashUserReceives: number; // $M paid by AI club to user club
  cashAiReceives: number; // $M paid by user club to AI club
}

export interface NegotiationTurn {
  role: "user" | "manager";
  text: string;
}

interface NegotiateInput {
  managerName: string;
  personality: string;
  brief: string; // factual digest assembled on the client
  terms: NegotiationTerms;
  history: NegotiationTurn[];
  userMessage: string;
}

interface GenerateManagerInput {
  team: string;
  tacticalStyle?: string;
}

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

function describeTerms(t: NegotiationTerms): string {
  const userSends =
    (t.userSends.length ? t.userSends.join(", ") : "no players") +
    (t.cashAiReceives > 0 ? ` + $${t.cashAiReceives}M cash` : "");
  const aiSends =
    (t.aiSends.length ? t.aiSends.join(", ") : "no players") +
    (t.cashUserReceives > 0 ? ` + $${t.cashUserReceives}M cash` : "");
  return [
    `CURRENT PROPOSED TERMS (the deal on the table right now):`,
    `  - ${t.userTeam} (the user) GIVES: ${userSends}`,
    `  - ${t.aiTeam} (you) GIVE: ${aiSends}`,
  ].join("\n");
}

// Tolerant JSON extraction: models sometimes wrap JSON in prose or code fences.
function extractJson<T>(content: string): T | null {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(content.slice(start, end + 1)) as T;
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
        temperature: 0.9,
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

const NEGOTIATION_RULES = `
Eden League is a fictional 24-team 9v9 soccer league. You are an AI club manager negotiating a trade with another club's manager (the user). Stay fully in character at all times.

ABSOLUTE RULES:
- Use ONLY the facts in the DATA block (rosters, ratings, player values, budgets, salary cap). Never invent players, stats, ratings, money, or league events not present in the DATA.
- Player ratings and values are real; higher is better. Cash figures are in $M.
- You may propose counter-offers IN WORDS, but you cannot change league state — only the user clicks the final button. Negotiate over the players and cash listed in the DATA.
- Judge the CURRENT PROPOSED TERMS through the lens of YOUR personality and trading tolerance. A tough negotiator should push back hard; a fair or low-tolerance manager should accept reasonable deals.
- "accepts" must be true ONLY if you are genuinely willing to complete the deal exactly as described in the CURRENT PROPOSED TERMS. If you want changes, accepts is false and your reply should say what you want instead.

TONE:
- Vivid, human, in-character. Use your personality's voice, quirks, and attitude.
- Keep replies tight: 1-3 short paragraphs of conversational dialogue. No bullet lists, no stat dumps.

OUTPUT FORMAT:
- Respond with a single JSON object: {"reply": "<your in-character message>", "accepts": <true|false>}
- No markdown, no extra text outside the JSON.
`;

export const negotiateTrade = createServerFn({ method: "POST" })
  .inputValidator((data: NegotiateInput) => {
    if (!data || typeof data.brief !== "string" || data.brief.trim().length === 0) {
      throw new Error("Missing trade brief");
    }
    if (typeof data.userMessage !== "string" || data.userMessage.trim().length === 0) {
      throw new Error("Empty message");
    }
    if (!data.terms || typeof data.terms !== "object") throw new Error("Missing terms");
    return data;
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI is not configured");

    const system =
      `You are ${data.managerName}, manager of ${data.terms.aiTeam} in the Eden League.\n` +
      `YOUR PERSONALITY: ${data.personality}\n` +
      NEGOTIATION_RULES;

    const historyText = data.history.length
      ? data.history
          .map((h) => `${h.role === "user" ? "USER MANAGER" : "YOU"}: ${h.text}`)
          .join("\n")
      : "(no prior messages — this is the opening of the negotiation)";

    const user = [
      `DATA (the only facts you may use):`,
      ``,
      data.brief,
      ``,
      describeTerms(data.terms),
      ``,
      `CONVERSATION SO FAR:`,
      historyText,
      ``,
      `USER MANAGER'S LATEST MESSAGE: ${data.userMessage}`,
      ``,
      `Reply now as ${data.managerName}, in JSON only.`,
    ].join("\n");

    const content = await callGateway(apiKey, system, user);
    const parsed = extractJson<{ reply?: string; accepts?: boolean }>(content);
    let reply = parsed && typeof parsed.reply === "string" ? parsed.reply : content;
    const accepts = parsed?.accepts === true;
    if (!reply.trim()) reply = "…";
    return { reply: reply.trim(), accepts };
  });

const NEW_MANAGER_RULES = `
Eden League is a fictional 24-team 9v9 soccer league. Invent a brand-new club manager who has just been appointed after the previous one was sacked.

RULES:
- Create ONE fresh, original manager: a short characterful name and a distinctive negotiating personality.
- The personality should read like the league's existing GM profiles: a vivid one-to-three sentence description of demeanor PLUS an explicit trading tolerance (e.g. "High trading tolerance; ...").
- Make it memorable and varied — do not reuse obvious real-world figures.

OUTPUT FORMAT:
- Respond with a single JSON object: {"name": "<manager name>", "personality": "<description + trading tolerance>"}
- No markdown, no extra text outside the JSON.
`;

export const generateManager = createServerFn({ method: "POST" })
  .inputValidator((data: GenerateManagerInput) => {
    if (!data || typeof data.team !== "string" || data.team.trim().length === 0) {
      throw new Error("Missing team");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI is not configured");

    const user =
      `Appoint a new manager for the club "${data.team}"` +
      (data.tacticalStyle ? ` (they currently play a "${data.tacticalStyle}" style).` : ".") +
      ` Return JSON only.`;

    const content = await callGateway(apiKey, "You are a creative sports-fiction writer.\n" + NEW_MANAGER_RULES, user);
    const parsed = extractJson<{ name?: string; personality?: string }>(content);
    if (parsed) {
      const name = (parsed.name ?? "").trim();
      const personality = (parsed.personality ?? "").trim();
      if (name && personality) return { name, personality };
    }
    // Safe fallback so a sacked club always ends up with a usable manager.
    return {
      name: "New Manager",
      personality:
        "A freshly appointed manager finding their feet. Balanced trading tolerance; open to fair, sensible deals.",
    };
  });
