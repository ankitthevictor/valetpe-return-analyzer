import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";
import * as cheerio from "cheerio";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `
You are "ValetPe Return Policy Decoder", an assistant helping INDIAN online shoppers understand return, refund & exchange policies.

You will NOT engage in conversation.
You only receive raw policy text (messy, long, or incomplete).

Return ONLY valid JSON:

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

Think like a consumer advocate:
- If ANY point is unclear -> "Not mentioned".
- Strict, vague, or one-sided policies -> lower risk score.
- Clear, long window, free pickup, refund-to-source -> higher risk score.

0–4  = 🔴 High risk
5–7  = 🟡 Medium / Read conditions
8–10 = 🟢 Customer-friendly

Keep everything SHORT.
`;

const KEYWORDS = ["return", "refund", "exchange", "cancellation"];

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

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch URL: ${res.status} ${res.statusText}`);
  }
  return await res.text();
}

async function extractPolicyText(
  productUrl: string
): Promise<{ text: string; domain: string }> {
  const urlObj = new URL(productUrl);
  const base = urlObj.origin;
  const domain = urlObj.hostname;

  const candidates: string[] = [];

  try {
    const html = await fetchHtml(productUrl);
    const $ = cheerio.load(html);

    // collect anchor candidates
    $("a").each((_, el) => {
      const t = ($(el).text() || "").toLowerCase();
      const h = ($(el).attr("href") || "").toLowerCase();
      const combined = t + " " + h;
      if (KEYWORDS.some((k) => combined.includes(k))) {
        try {
          const abs = new URL(h, base).toString();
          if (!candidates.includes(abs)) candidates.push(abs);
        } catch {
          // ignore invalid URLs
        }
      }
    });

    // if no policy link found, just use page text
    if (candidates.length === 0) {
      $("script, style, noscript").remove();
      const txt = $("body").text().replace(/\s+/g, " ").trim().slice(0, 24000);
      return { text: txt, domain };
    }
  } catch (err) {
    console.error("Error during initial scraping:", err);
    return { text: "", domain };
  }

  // try each candidate policy URL
  for (const candidateUrl of candidates) {
    try {
      const html = await fetchHtml(candidateUrl);
      const $ = cheerio.load(html);
      $("script, style, noscript").remove();
      const txt = $("body").text().replace(/\s+/g, " ").trim();
      if (txt.length > 0) {
        return { text: txt.slice(0, 24000), domain };
      }
    } catch (err) {
      console.error("Error fetching candidate policy URL:", candidateUrl, err);
    }
  }

  // last resort: use original page text
  try {
    const html = await fetchHtml(productUrl);
    const $ = cheerio.load(html);
    $("script, style, noscript").remove();
    const txt = $("body").text().replace(/\s+/g, " ").trim().slice(0, 24000);
    return { text: txt, domain };
  } catch (err) {
    console.error("Error in final fallback:", err);
    return { text: "", domain };
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") return res.status(405).send("Only POST allowed");

  const { url } = req.body as { url?: string };

  if (!url || typeof url !== "string") {
    return res.status(200).json(fallbackResponse("Unknown"));
  }

  try {
    const { text: policyText, domain } = await extractPolicyText(url);

    if (!policyText || policyText.trim().length === 0) {
      return res.status(200).json(fallbackResponse(domain));
    }

    const userPrompt = `
Summarize the following policy EXACTLY according to the JSON schema:

"""${policyText}"""
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

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : {};
    }

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
    return res.status(500).json({
      error:
        "AI summarisation failed: " +
        (err?.message || "Unknown error. Check API key / billing."),
    });
  }
}
