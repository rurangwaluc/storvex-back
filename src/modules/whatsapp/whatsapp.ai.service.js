// src/modules/whatsapp/whatsapp.ai.service.js

const OpenAI = require("openai");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

let client = null;

function getClient() {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY_MISSING");
  }

  if (!client) {
    client = new OpenAI({ apiKey: OPENAI_API_KEY });
  }

  return client;
}

function normalizeText(value) {
  const s = String(value || "").trim();
  return s || null;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function clampStringArray(arr, max = 8) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => normalizeText(x))
    .filter(Boolean)
    .slice(0, max);
}

function normalizeAiExtraction(raw) {
  const data = raw && typeof raw === "object" ? raw : {};

  return {
    normalizedQuery: normalizeText(data.normalizedQuery),
    brand: normalizeText(data.brand),
    category: normalizeText(data.category),
    productType: normalizeText(data.productType),
    model: normalizeText(data.model),
    storage: normalizeText(data.storage),
    color: normalizeText(data.color),
    condition: normalizeText(data.condition),
    accessories: clampStringArray(data.accessories),
    alternatives: clampStringArray(data.alternatives),
    confidence:
      Number.isFinite(Number(data.confidence)) &&
      Number(data.confidence) >= 0 &&
      Number(data.confidence) <= 1
        ? Number(data.confidence)
        : 0,
    needsHumanReview: Boolean(data.needsHumanReview),
    notes: normalizeText(data.notes),
  };
}

async function extractProductIntent({ messageText }) {
  const text = normalizeText(messageText);

  if (!text) {
    return {
      normalizedQuery: null,
      brand: null,
      category: null,
      productType: null,
      model: null,
      storage: null,
      color: null,
      condition: null,
      accessories: [],
      alternatives: [],
      confidence: 0,
      needsHumanReview: true,
      notes: "Empty message",
    };
  }

  const openai = getClient();

  const system = `
You extract shopping/product intent from a customer's WhatsApp message for a retail inventory system.

Rules:
- Return JSON only.
- Do not invent stock, price, or availability.
- Do not claim certainty when unclear.
- Your job is only to normalize the user's wording into a better product search query.
- Prefer concise normalized search text that can be used against a store inventory database.

Return exactly this JSON shape:
{
  "normalizedQuery": string|null,
  "brand": string|null,
  "category": string|null,
  "productType": string|null,
  "model": string|null,
  "storage": string|null,
  "color": string|null,
  "condition": string|null,
  "accessories": string[],
  "alternatives": string[],
  "confidence": number,
  "needsHumanReview": boolean,
  "notes": string|null
}
`.trim();

  const user = `
Customer message:
${text}

Extract the likely intended product in a way useful for database lookup.
`.trim();

  const response = await openai.responses.create({
    model: OPENAI_MODEL,
    input: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.1,
    max_output_tokens: 300,
  });

  const outputText = response.output_text || "";
  const parsed = safeJsonParse(outputText);

  if (!parsed) {
    return {
      normalizedQuery: text,
      brand: null,
      category: null,
      productType: null,
      model: null,
      storage: null,
      color: null,
      condition: null,
      accessories: [],
      alternatives: [],
      confidence: 0.2,
      needsHumanReview: true,
      notes: "AI returned non-JSON output",
    };
  }

  return normalizeAiExtraction(parsed);
}

function shouldUseAiFallback({ text, deterministicQuery, searchResultsCount }) {
  const cleanText = normalizeText(text);
  const cleanDeterministic = normalizeText(deterministicQuery);

  if (!cleanText) return false;
  if (!cleanDeterministic) return true;
  if (Number(searchResultsCount || 0) > 0) return false;

  return cleanText.length >= 4;
}

module.exports = {
  extractProductIntent,
  shouldUseAiFallback,
};