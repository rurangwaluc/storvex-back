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

function normalizeLower(value) {
  return String(value || "").trim().toLowerCase();
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

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const direct = safeJsonParse(raw);
  if (direct) return direct;

  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  const sliced = raw.slice(firstBrace, lastBrace + 1);
  return safeJsonParse(sliced);
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
      .replace(/[^\p{L}\p{N}\s/+._-]/gu, " ")
      .replace(
        /\b(price|stock|available|availability|how much|cost|buy|order|reserve|book|please|pls|need|want|do you have|have you got|murafite|mufite|igiciro|angahe|ndashaka|nkeneye|ndayishaka)\b/gi,
        " "
      )
      .replace(/\s+/g, " ")
  );

  return text && text.length >= 2 ? text : null;
}

function normalizeKnownBrand(value) {
  const raw = normalizeLower(value);
  if (!raw) return null;

  const map = {
    iphone: "Apple",
    apple: "Apple",
    samsung: "Samsung",
    tecno: "Tecno",
    infinix: "Infinix",
    itel: "Itel",
    nokia: "Nokia",
    xiaomi: "Xiaomi",
    redmi: "Redmi",
    oppo: "Oppo",
    vivo: "Vivo",
    huawei: "Huawei",
    pixel: "Google",
    google: "Google",
    hp: "HP",
    dell: "Dell",
    lenovo: "Lenovo",
    asus: "Asus",
    acer: "Acer",
    msi: "MSI",
    macbook: "Apple",
    canon: "Canon",
    epson: "Epson",
    brother: "Brother",
    logitech: "Logitech",
    anker: "Anker",
    oraimo: "Oraimo",
    jbl: "JBL",
    sony: "Sony",
    bose: "Bose",
    sandisk: "SanDisk",
    kingston: "Kingston",
    seagate: "Seagate",
    wd: "WD",
    tplink: "TP-Link",
    "tp-link": "TP-Link",
    mikrotik: "MikroTik",
  };

  return map[raw] || normalizeText(value);
}

function normalizeCategory(value) {
  const raw = normalizeLower(value);
  if (!raw) return null;

  if (/\b(phone|smartphone|mobile|telephone|iphone|galaxy)\b/i.test(raw)) return "phone";
  if (/\b(laptop|computer|notebook|pc|macbook)\b/i.test(raw)) return "laptop";
  if (/\b(charger|adapter)\b/i.test(raw)) return "charger";
  if (/\b(cable|usb|type c|type-c|usb-c|lightning)\b/i.test(raw)) return "cable";
  if (/\b(airpods|earbuds|earphones|headphones|pods|headset)\b/i.test(raw)) return "audio";
  if (/\b(speaker|bluetooth speaker)\b/i.test(raw)) return "speaker";
  if (/\b(power bank|powerbank)\b/i.test(raw)) return "power bank";
  if (/\b(watch|smartwatch)\b/i.test(raw)) return "watch";
  if (/\b(mouse)\b/i.test(raw)) return "mouse";
  if (/\b(keyboard)\b/i.test(raw)) return "keyboard";
  if (/\b(router|modem|wifi|wi-fi)\b/i.test(raw)) return "network";
  if (/\b(printer)\b/i.test(raw)) return "printer";
  if (/\b(flash|usb drive|memory card|ssd|hard drive|hdd)\b/i.test(raw)) return "storage";
  if (/\b(case|cover)\b/i.test(raw)) return "case";
  if (/\b(screen protector|protector)\b/i.test(raw)) return "screen protector";

  return normalizeText(value);
}

function inferQueryFromParts(data, fallbackText) {
  const parts = [
    data.brand,
    data.model,
    data.storage,
    data.color,
    data.condition,
    data.productType,
    data.category,
  ]
    .map(normalizeText)
    .filter(Boolean);

  const built = cleanSearchQuery(parts.join(" "));
  if (built) return built;

  return cleanSearchQuery(fallbackText);
}

function normalizeAiExtraction(raw, fallbackText = null) {
  const data = raw && typeof raw === "object" ? raw : {};

  const brand = normalizeKnownBrand(data.brand);
  const category = normalizeCategory(data.category);
  const productType = normalizeText(data.productType);
  const model = normalizeText(data.model);
  const storage = normalizeText(data.storage);
  const color = normalizeText(data.color);
  const condition = normalizeText(data.condition);

  const normalizedQuery =
    cleanSearchQuery(data.normalizedQuery) ||
    cleanSearchQuery(model) ||
    cleanSearchQuery([brand, model, storage].filter(Boolean).join(" ")) ||
    cleanSearchQuery(productType) ||
    inferQueryFromParts(
      {
        brand,
        category,
        productType,
        model,
        storage,
        color,
        condition,
      },
      fallbackText
    );

  return {
    normalizedQuery,
    brand,
    category,
    productType,
    model,
    storage,
    color,
    condition,
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

Business context:
- The store may sell phones, laptops, accessories, chargers, cables, audio devices, routers, printers, storage, and electronics.
- The customer may write in English, French, simple Kinyarwanda, or mixed wording.
- Your output is used only for product lookup.
- Do not invent price, stock, branch, payment status, or availability.
- Do not expose internal branches to the customer.
- Do not create an order.
- Do not assume exact model details if unclear.

Your job:
- identify the product the customer likely means
- rewrite it into a short database-friendly search query
- keep useful model words such as A14, S23, iPhone 13, Type-C, 128GB, HP, Dell, charger
- if unclear, set needsHumanReview to true
- confidence must be between 0 and 1

Kinyarwanda examples:
- "mufite iphone 13?" means product query for iPhone 13
- "igiciro cya type c charger" means price query for Type-C charger
- "ndashaka samsung" means customer wants Samsung product
- "nkeneye chargeur" means customer needs charger

Return JSON only.
Do not include markdown.
Do not include explanations outside JSON.

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
    const parsed = extractJsonObject(outputText);

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

  const hasHumanLanguage =
    /\b(mufite|murafite|igiciro|angahe|ndashaka|nkeneye|ndayishaka|nabona|combien|bonjour)\b/i.test(
      cleanText
    );

  const hasManyWords = cleanText.split(/\s+/).filter(Boolean).length >= 3;

  if (hasHumanLanguage) return true;
  if (hasManyWords) return true;
  if (cleanText.length >= 4) return true;

  return false;
}

module.exports = {
  extractProductIntent,
  shouldUseAiFallback,

  // helpful for safe testing later
  cleanSearchQuery,
  normalizeAiExtraction,
};