import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";

// ---------------- OPENAI CLIENT ----------------
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ---------------- SYSTEM PROMPT ----------------
const SYSTEM_PROMPT = `
You are "ValetPe Return
