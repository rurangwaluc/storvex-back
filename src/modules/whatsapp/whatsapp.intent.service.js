function normalizeText(value) {
  return String(value || "").trim();
}

const INTENT_WORDS = [
  "price",
  "how much",
  "combien",
  "igiciro",
  "angahe",
  "cost",
  "stock",
  "available",
  "murafite",
  "buy",
  "order",
  "ndayishaka",
  "ndashaka",
  "need",
  "nkeneye",
  "want",
  "mufite",
  "nabona",
  "reserve",
  "book",
];

function looksLikeBuyingIntent(text) {
  const t = normalizeText(text).toLowerCase();
  if (!t) return false;

  for (const w of INTENT_WORDS) {
    if (t.includes(w)) return true;
  }

  const hasModelPattern =
    /([a-z]{1,6}\d{1,4})/i.test(t) ||
    /\b(iphone|samsung|laptop|tecno|infinix|redmi|xiaomi|itel|nokia|airpods|charger|type[-\s]?c)\b/i.test(t);

  return hasModelPattern;
}

function extractProductQuery(text) {
  let t = normalizeText(text);

  t = t.replace(
    /^(price|stock|available|how much|cost|mufite|murafite|murafite se|igiciro|angahe)\s*[:\-]?\s*/i,
    ""
  );

  t = t.replace(/\b(price|stock|available|how much|cost|igiciro|angahe)\b/gi, " ");
  t = t.replace(/\s+/g, " ").trim();

  return t && t.length >= 2 ? t : null;
}

function parsePayCommand(text) {
  const t = normalizeText(text);

  const m = t.match(
    /^PAY\s+(\d+(?:\.\d+)?)\s+(CASH|MOMO|BANK|OTHER)\s+([A-Za-z0-9._-]{3,64})(?:\s+#([A-Za-z0-9]{3,16}))?$/i
  );
  if (!m) return null;

  const amount = Number(m[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  return {
    amount,
    method: String(m[2]).toUpperCase(),
    reference: String(m[3]),
    saleCode: m[4] ? String(m[4]).toUpperCase() : null,
  };
}

function parseBuyCommand(text) {
  const t = normalizeText(text);
  if (!t) return null;

  // BUY 2 Samsung A14
  // BUY Samsung A14
  // order 1 type c charger
  // ndashaka samsung a14
  const m = t.match(
    /^(BUY|ORDER|RESERVE|NDAYISHAKA|NDASHAKA|NKENEYE|I WANT)\s+(?:(\d+)\s+)?(.+)$/i
  );
  if (!m) return null;

  const qty = m[2] ? Number(m[2]) : 1;
  if (!Number.isInteger(qty) || qty <= 0) return null;

  const query = normalizeText(m[3]);
  if (!query || query.length < 2) return null;

  return { quantity: qty, query };
}

function detectIntent(text) {
  const raw = normalizeText(text);
  if (!raw) {
    return { type: "EMPTY", raw };
  }

  const pay = parsePayCommand(raw);
  if (pay) {
    return { type: "PAY", raw, payload: pay };
  }

  const buy = parseBuyCommand(raw);
  if (buy) {
    return { type: "BUY", raw, payload: buy };
  }

  const productQuery = extractProductQuery(raw);
  if (looksLikeBuyingIntent(raw) && productQuery) {
    return {
      type: "PRODUCT_QUERY",
      raw,
      payload: { query: productQuery },
    };
  }

  if (/^(hi|hello|hey|muraho|amakuru|good morning|good afternoon|good evening)$/i.test(raw)) {
    return { type: "GREETING", raw };
  }

  if (/\b(help|human|agent|staff|person|umukozi)\b/i.test(raw)) {
    return { type: "HUMAN_HELP", raw };
  }

  return { type: "UNKNOWN", raw };
}

module.exports = {
  looksLikeBuyingIntent,
  extractProductQuery,
  parsePayCommand,
  parseBuyCommand,
  detectIntent,
};