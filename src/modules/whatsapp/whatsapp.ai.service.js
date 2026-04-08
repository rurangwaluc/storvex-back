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

function collapseSpaces(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
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

function clampConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function cleanSearchQuery(value) {
  const text = collapseSpaces(
    String(value || "")
      .replace(/[^\p{L}\p{N}\s/+.-]/gu, " ")
      .replace(/\b(price|stock|available|availability|how much|cost|buy|order|please|need|want)\b/gi, " ")
  );

  return text && text.length >= 2 ? text : null;
}

function normalizeAiExtraction(raw, fallbackText = null) {
  const data = raw && typeof raw === "object" ? raw : {};

  const normalizedQuery =
    cleanSearchQuery(data.normalizedQuery) ||
    cleanSearchQuery(data.model) ||
    cleanSearchQuery(data.productType) ||
    cleanSearchQuery(fallbackText);

  return {
    normalizedQuery,
    brand: normalizeText(data.brand),
    category: normalizeText(data.category),
    productType: normalizeText(data.productType),
    model: normalizeText(data.model),
    storage: normalizeText(data.storage),
    color: normalizeText(data.color),
    condition: normalizeText(data.condition),
    accessories: clampStringArray(data.accessories),
    alternatives: clampStringArray(data.alternatives),
    confidence: clampConfidence(data.confidence),
    needsHumanReview: Boolean(data.needsHumanReview),
    notes: normalizeText(data.notes),
  };
}

function buildFallbackExtraction(text, note) {
  const normalized = cleanSearchQuery(text);

  return {
    normalizedQuery: normalized,
    brand: null,
    category: null,
    productType: null,
    model: null,
    storage: null,
    color: null,
    condition: null,
    accessories: [],
    alternatives: [],
    confidence: normalized ? 0.25 : 0,
    needsHumanReview: true,
    notes: note || "Fallback extraction used",
  };
}

async function extractProductIntent({ messageText }) {
  const text = normalizeText(messageText);

  if (!text) {
    return buildFallbackExtraction("", "Empty message");
  }

  let openai;
  try {
    openai = getClient();
  } catch (err) {
    return buildFallbackExtraction(text, "OpenAI key missing");
  }

  const system = `
You extract shopping intent from a customer's WhatsApp message for a retail inventory system.

Your job:
- understand what product the customer most likely means
- rewrite that into a short database-friendly search query
- do not invent stock, price, or availability
- do not invent exact model details if the message is unclear
- prefer a concise normalized search phrase useful for inventory lookup

Rules:
- return JSON only
- do not include markdown
- keep normalizedQuery short and practical
- if unclear, set needsHumanReview to true
- confidence must be between 0 and 1

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
Customer WhatsApp message:
${text}

Extract only what is reasonably supported by the message.
`.trim();

  try {
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
      return buildFallbackExtraction(text, "AI returned non-JSON output");
    }

    const normalized = normalizeAiExtraction(parsed, text);

    if (!normalized.normalizedQuery) {
      return buildFallbackExtraction(text, "AI did not return a usable query");
    }

    return normalized;
  } catch (err) {
    console.error("extractProductIntent error:", err?.message || err);
    return buildFallbackExtraction(text, "AI request failed");
  }
}

function shouldUseAiFallback({ text, deterministicQuery, searchResultsCount }) {
  const cleanText = normalizeText(text);
  const cleanDeterministic = cleanSearchQuery(deterministicQuery);

  if (!cleanText) return false;
  if (Number(searchResultsCount || 0) > 0) return false;

  if (!cleanDeterministic) return true;

  const rawLower = cleanText.toLowerCase();
  const deterministicLower = cleanDeterministic.toLowerCase();

  if (rawLower === deterministicLower) return false;

  if (cleanText.length >= 4) return true;

  return false;
}

module.exports = {
  extractProductIntent,
  shouldUseAiFallback,
};