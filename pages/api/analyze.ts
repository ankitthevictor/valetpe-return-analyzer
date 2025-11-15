import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";
import * as cheerio from "cheerio";

// ---------------------------------------------
// TYPES
// ---------------------------------------------
type RiskLevel = "green" | "yellow" | "red";

type ApiResult = {
  brand: string;
  category: string;
  returnWindow: string;
  refundType: string;
  returnMethod: string;
  costs: string;
  conditions: string[];
  riskScore: string;
  riskLevel: RiskLevel;
  benchmark: string;
  tip: string;
};

// ---------------------------------------------
// OPENAI CLIENT (cheaper model gpt-4o-mini)
// ---------------------------------------------
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ---------------------------------------------
// SIMPLE IN-MEMORY CACHE
// ---------------------------------------------
// Lives per Vercel function instance (still saves many calls).
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const CACHE_VERSION = "v1"; // bump when you change scoring logic
const cache = new Map<string, { timestamp: number; data: ApiResult }>();

// ---------------------------------------------
// SYSTEM PROMPT
// ---------------------------------------------
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

Rules:
- If ANY detail is missing or unclear → "Not mentioned".
- Strict, vague, or one-sided policies → lower score.
- Clear policy, free pickup, refund-to-source, reasonable window → higher score.
- Score bands: 0–4 = 🔴 High risk, 5–7 = 🟡 Mixed, 8–10 = 🟢 Customer-friendly.
- Keep everything concise.
`;

// ---------------------------------------------
// HELPERS
// ---------------------------------------------
const KEYWORDS = ["return", "refund", "exchange", "cancellation"];

function fallbackResponse(domain: string): ApiResult {
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
    riskLevel: "red",
    benchmark: "This is riskier than typical Indian e-commerce policies.",
    tip: "Be cautious for high-value orders; confirm policy with customer support.",
  };
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch URL: ${res.status} ${res.statusText}`);
  }
  return await res.text();
}

// ---------------------------------------------
// Scraping logic – find policy page and extract text
// ---------------------------------------------
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

    // find links that look like return / refund / exchange / cancellation pages
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

    // if we found no specific policy page, just use this page's text
    if (candidates.length === 0) {
      $("script, style, noscript").remove();
      const txt = $("body").text().replace(/\s+/g, " ").trim().slice(0, 24000);
      return { text: txt, domain };
    }
  } catch (err) {
    console.error("Scraping error:", err);
    return { text: "", domain };
  }

  // Try each candidate return/refund page
  for (const candidate of candidates) {
    try {
      const html = await fetchHtml(candidate);
      const $ = cheerio.load(html);
      $("script, style, noscript").remove();
      const txt = $("body").text().replace(/\s+/g, " ").trim();
      if (txt.length > 0) {
        return { text: txt.slice(0, 24000), domain };
      }
    } catch {
      // ignore and move to next candidate
    }
  }

  // Final fallback: original page text
  try {
    const html = await fetchHtml(productUrl);
    const $ = cheerio.load(html);
    $("script, style, noscript").remove();
    const txt = $("body").text().replace(/\s+/g, " ").trim().slice(0, 24000);
    return { text: txt, domain };
  } catch (err) {
    console.error("Final fallback error:", err);
    return { text: "", domain };
  }
}

// ---------------------------------------------
// MAIN HANDLER
// ---------------------------------------------
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") return res.status(405).send("Only POST allowed");

  let { url } = req.body as { url?: string };

  if (!url || typeof url !== "string") {
    return res.status(200).json(fallbackResponse("Unknown"));
  }

  // NORMALIZE URL – handles "jumkey.com", "www.jumkey.com" etc.
  url = url.trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }

  const cacheKey = `${CACHE_VERSION}|${url}`;
  const now = Date.now();

  // ---------------------------------------------
  // CACHE CHECK
  // ---------------------------------------------
  const cached = cache.get(cacheKey);
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    console.log("Serving from cache:", cacheKey);
    return res.status(200).json(cached.data);
  }

  console.log("Cache miss, scraping + summarising:", cacheKey);

  try {
    const { text: policyText, domain } = await extractPolicyText(url);

    // If we couldn't read any text, return fallback (but don't cache it)
    if (!policyText || policyText.trim().length === 0) {
      const fb = fallbackResponse(domain);
      return res.status(200).json(fb);
    }

    const userPrompt = `
Summarize the following policy EXACTLY as JSON in the schema from the system instructions:

"""${policyText}"""
`;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini", // cheaper model
      temperature: 0.2,
      max_tokens: 500,
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

    const response: ApiResult = {
      brand: parsed.brand || domain,
      category: parsed.category || "Other",
      returnWindow: parsed.returnWindow || "Not mentioned",
      refundType: parsed.refundType || "Not mentioned",
      returnMethod: parsed.returnMethod || "Not mentioned",
      costs: parsed.costs || "Not mentioned",
      conditions:
        Array.isArray(parsed.conditions) && parsed.conditions.length > 0
          ? parsed.conditions.slice(0, 3)
          : ["Details not clearly mentioned in policy."],
      riskScore: parsed.riskScore || "5/10 – 🟡 Mixed",
      riskLevel:
        parsed.riskLevel === "green" ||
        parsed.riskLevel === "yellow" ||
        parsed.riskLevel === "red"
          ? parsed.riskLevel
          : "yellow",
      benchmark:
        parsed.benchmark ||
        "Broadly aligned with India’s typical return practices.",
      tip:
        parsed.tip ||
        "Keep packaging and tags until you decide to keep the product.",
    };

    // STORE REAL RESULT IN CACHE
    cache.set(cacheKey, { timestamp: now, data: response });

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
