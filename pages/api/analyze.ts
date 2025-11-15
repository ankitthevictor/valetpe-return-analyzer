import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";

// ---------------- OPENAI CLIENT ----------------
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ---------------- SYSTEM PROMPT ----------------
const SYSTEM_PROMPT = `
You are "ValetPe Return Policy Decoder", an assistant helping INDIAN online shoppers understand return, refund & exchange policies.

You will NOT engage in conversation.  
You only receive raw policy text (messy, long, or incomplete).

--------------------------------
WHAT YOU MUST OUTPUT
--------------------------------
Return ONLY valid JSON in the EXACT structure below:

{
  "brand": "string",
  "category": "Fashion | Beauty | Electronics | Home & Kitchen | Furniture | Jewelry | Grocery | Other",
  "returnWindow": "short plain text",
  "refundType": "short plain text",
  "returnMethod": "short plain text",
  "costs": "short plain text",
  "conditions": ["max 3 bullet points"],
  "riskScore": "e.g. 3/10 – 🔴 High risk",
  "riskLevel": "green | yellow | red",
  "benchmark": "one short sentence comparing to typical Indian sites",
  "tip": "one practical tip"
}

--------------------------------
INTERPRETATION RULES
--------------------------------
Think like a consumer advocate.

• If ANY point is unclear → mark it "Not mentioned".  
• If the policy is vague, contradictory or restrictive → risk goes DOWN.  
• If the policy is clear, long window, free pickup, refund-to-source → risk goes UP.  
• ALWAYS fill all fields — NEVER output null or empty strings.

--------------------------------
RISK SCORE RULE OF THUMB
--------------------------------
0–4  = 🔴 High risk  
5–7  = 🟡 Medium / Read conditions  
8–10 = 🟢 Customer-friendly  

--------------------------------
BE VERY CONCISE
--------------------------------
Users want SHORT summaries, not paragraphs.
`;

// ---------------- FALLBACK ----------------
function fallbackResponse(domain: string) {
  return {
    brand: domain || "Unknown",
    category: "Other",
    returnWindow: "Not mentioned",
    refundType: "Not mentioned",
    returnMethod: "Not mentioned",
    costs: "Not mentioned",
    conditions: [
      "No clear return/refund policy could be analyzed for this site.",
    ],
    riskScore: "2/10 – 🔴 High risk",
    riskLevel: "red" as const,
    benchmark: "This is riskier than typical Indian e-commerce policies.",
    tip: "Be cautious for high-value orders; confirm policy with customer support.",
  };
}

// ---------------- HANDLER ----------------
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") return res.status(405).send("Only POST allowed");

  const { policyText, domain } = req.body as {
    policyText?: string;
    domain?: string;
  };

  // ❗ Only fallback if text is literally empty
  if (!policyText || policyText.trim().length === 0) {
    return res.status(200).json(fallbackResponse(domain || "Unknown"));
  }

  try {
    const userPrompt = `
Summarize the following policy EXACTLY according to the JSON schema:

"""${policyText.slice(0, 24000)}"""
`;

    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = completion.choices[0].message.content || "{}";

    // Try parsing directly
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Try extracting JSON from messy LLM output
      const match = raw.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : {};
    }

    // Build final safe response
    const response = {
      brand: parsed.brand || domain || "Unknown",
      category: parsed.category || "Other",
      returnWindow: parsed.returnWindow || "Not mentioned",
      refundType: parsed.refundType || "Not mentioned",
      returnMethod: parsed.returnMethod || "Not mentioned",
      costs: parsed.costs || "Not mentioned",

      conditions:
        Array.isArray(parsed.conditions) && parsed.conditions.length > 0
          ? parsed.conditions.slice(0, 3)
          : ["Details not clearly mentioned in policy."],

      riskScore:
        parsed.riskScore || "5/10 – 🟡 Okay, but review policy carefully",

      riskLevel:
        parsed.riskLevel === "green" ||
        parsed.riskLevel === "yellow" ||
        parsed.riskLevel === "red"
          ? parsed.riskLevel
          : ("yellow" as const),

      benchmark:
        parsed.benchmark ||
        "Broadly in line with what Indian brands usually follow.",

      tip:
        parsed.tip ||
        "Keep original packaging/tags until you decide to keep the product.",
    };

    return res.status(200).json(response);
  } catch (err: any) {
    console.error("OpenAI error:", err);

    // 🔴 Surface actual AI errors to frontend
    return res.status(500).json({
      error:
        "AI summarisation failed: " +
        (err?.message || "Unknown error. Check API key / billing."),
    });
  }
}
