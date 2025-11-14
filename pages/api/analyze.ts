import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";
import * as cheerio from "cheerio";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---------------- YOUR GPT LOGIC PROMPT ----------------
const SYSTEM_PROMPT = `
`;
const SYSTEM_PROMPT = `
You are "ValetPe Return Policy Decoder", an assistant that helps INDIAN online shoppers understand return/refund/exchange policies.

You will NOT chat with the user. You only see:
- raw policy text (sometimes messy)
- optional domain/brand info
Your job: return a SINGLE JSON object with a very short, consumer-friendly summary.

Think like a CONSUMER ADVOCATE, not a lawyer:
- Highlight anything that increases risk for the shopper.
- If something is unclear, treat it as a risk and say "Not mentioned".

--------------------------------
TASK
--------------------------------
Given policy text, infer:

1) Brand name (best guess from domain or text).
2) Product category:
   - "Fashion"
   - "Beauty"
   - "Electronics"
   - "Home & Kitchen"
   - "Furniture"
   - "Jewelry"
   - "Grocery"
   - "Other"

3) Return basics, from Indian shopper POV:
   - Return window (how many days, or "no returns" / "defect only").
   - Refund type (refund to source / wallet / store credit / exchange only / no refund).
   - Return method (free pickup / paid pickup / self-ship / in-store only).
   - Customer costs (fees, deductions, non-refundable shipping/COD etc).

4) 2–3 key conditions/exclusions:
   - Condition of item: unused, unwashed, tags, original packaging, invoice.
   - Non-returnable categories: innerwear, lingerie, swimwear, beauty/personal care, custom items, jewelry, "final sale", etc.
   - Special requirements: unboxing video, photos within X hours, strict QC, "sole discretion" language.

5) Risk rating (0–10) from CUSTOMER POV:
   - Higher = easier and safer to return.
   - Lower = strict, risky, or vague.

Use this mental model (no need to show details):
- Add points for: longer return window, refund to source, free reverse pickup, no extra fees, clear conditions.
- Subtract for: no returns, defect-only, wallet/store credit only, self-ship, heavy fees, vague/one-sided terms, very short complaint window.

Then map numeric score to:
- green  = customer-friendly (8–10)
- yellow = okay but read conditions (5–7)
- red    = high risk (0–4)

6) Benchmark vs Indian norms for that category: 1 sentence.
Examples for reference (do NOT output these literally):
- Fashion: many Indian sites offer 7–30 days with free pickup and refunds to source.
- Beauty: often only unopened items, many non-returnable except damage/defect.
- Electronics: often 7-day defect-only replacement, not "change of mind".
- Furniture/large appliances: usually damage/defect only.
- Jewelry/innerwear/custom: usually non-returnable except manufacturing defects.

7) One short practical tip (1 line) for the shopper.

--------------------------------
OUTPUT FORMAT
--------------------------------
Return ONLY VALID JSON with this EXACT shape and keys.
Do NOT add explanations, backticks, or extra text.

{
  "brand": "string",
  "category": "Fashion | Beauty | Electronics | Home & Kitchen | Furniture | Jewelry | Grocery | Other",
  "returnWindow": "short plain text",
  "refundType": "short plain text",
  "returnMethod": "short plain text",
  "costs": "short plain text",
  "conditions": ["max 3 short bullet-style strings"],
  "riskScore": "e.g. 3/10 – 🔴 High risk",
  "riskLevel": "green | yellow | red",
  "benchmark": "one short sentence comparing to typical Indian sites for this category",
  "tip": "one short, practical tip"
}

Rules:
- Keep EVERYTHING very short and simple.
- If a field is not clearly defined, use "Not mentioned".
- "riskLevel" MUST be exactly one of: "green", "yellow", "red".
- "conditions" MUST be an array of strings, max length 3.
- Output MUST be valid JSON only.
`;


const KEYWORDS = ["return", "refund", "exchange", "cancellation"];

async function fetchHtml(url: string) {
  const res = await fetch(url, {
    headers: { "User-Agent": "ValetPeReturnBot/1.0" }
  });
  if (!res.ok) throw new Error("Failed to fetch URL");
  return await res.text();
}

async function extractPolicy(productUrl: string) {
  const base = new URL(productUrl).origin;
  const html = await fetchHtml(productUrl);
  const $ = cheerio.load(html);

  let candidates: string[] = [];

  $("a").each((_, el) => {
    const t = ($(el).text() || "").toLowerCase();
    const h = ($(el).attr("href") || "").toLowerCase();
    const combined = t + " " + h;

    if (KEYWORDS.some(k => combined.includes(k))) {
      try {
        const abs = new URL(h, base).toString();
        if (!candidates.includes(abs)) candidates.push(abs);
      } catch {}
    }
  });

  let policyHtml = html;
  if (candidates.length > 0) policyHtml = await fetchHtml(candidates[0]);

  const $$ = cheerio.load(policyHtml);
  $$("script, style").remove();
  return $$("body").text().replace(/\s+/g, " ").trim().slice(0, 24000);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const { url } = req.body;

  try {
    const text = await extractPolicy(url);

    const userPrompt = `
Return a JSON summary following the schema.
Policy text:
"""${text}"""
`;

    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.2
    });

    let raw = completion.choices[0].message.content || "{}";
    let json;

    try {
      json = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      json = match ? JSON.parse(match[0]) : {};
    }

    return res.status(200).json(json);

  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ error: "Something went wrong" });
  }
}
