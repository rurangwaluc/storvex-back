function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function collapseSpaces(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function digitsOnly(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

const GREETING_WORDS = [
  "hi",
  "hello",
  "hey",
  "muraho",
  "amakuru",
  "mwaramutse",
  "mwiriwe",
  "good morning",
  "good afternoon",
  "good evening",
];

const HUMAN_HELP_WORDS = [
  "help",
  "human",
  "agent",
  "staff",
  "person",
  "umukozi",
  "operator",
  "support",
  "customer care",
  "service",
];

const PRODUCT_INTENT_WORDS = [
  "price",
  "how much",
  "combien",
  "igiciro",
  "angahe",
  "cost",
  "stock",
  "available",
  "availability",
  "murafite",
  "mufite",
  "have",
  "do you have",
  "buy",
  "order",
  "reserve",
  "book",
  "need",
  "want",
  "nkeneye",
  "ndashaka",
  "ndayishaka",
  "nabona",
  "looking for",
  "searching for",
];

const PRODUCT_CATEGORY_HINTS = [
  "iphone",
  "samsung",
  "tecno",
  "infinix",
  "itel",
  "nokia",
  "xiaomi",
  "redmi",
  "oppo",
  "vivo",
  "google pixel",
  "pixel",
  "hp",
  "dell",
  "lenovo",
  "asus",
  "acer",
  "macbook",
  "laptop",
  "computer",
  "phone",
  "smartphone",
  "charger",
  "type c",
  "type-c",
  "cable",
  "airpods",
  "earbuds",
  "earphones",
  "headphones",
  "speaker",
  "power bank",
  "router",
  "wifi",
  "printer",
  "ssd",
  "hard drive",
  "flash",
  "usb drive",
  "mouse",
  "keyboard",
  "screen protector",
  "case",
  "cover",
];

const LEADING_INTENT_PREFIX =
  /^(price|stock|available|availability|how much|cost|murafite|murafite se|mufite|igiciro|angahe|do you have|have you got|looking for|searching for)\s*[:\-]?\s*/i;

function removeNoiseWords(text) {
  return collapseSpaces(
    String(text || "")
      .replace(/\b(price|stock|available|availability|how much|cost|murafite|mufite|igiciro|angahe|need|want|buy|order|reserve|book)\b/gi, " ")
      .replace(/[?]/g, " ")
  );
}

function looksLikeGreeting(text) {
  const t = normalizeLower(text);
  if (!t) return false;
  return GREETING_WORDS.includes(t);
}

function looksLikeHumanHelp(text) {
  const t = normalizeLower(text);
  if (!t) return false;
  return HUMAN_HELP_WORDS.some((w) => t.includes(w));
}

function hasProductSignal(text) {
  const t = normalizeLower(text);
  if (!t) return false;

  if (PRODUCT_INTENT_WORDS.some((w) => t.includes(w))) return true;
  if (PRODUCT_CATEGORY_HINTS.some((w) => t.includes(w))) return true;

  const hasModelPattern =
    /\b[a-z]{1,6}\d{1,4}[a-z]?\b/i.test(t) ||
    /\b\d{2,4}gb\b/i.test(t) ||
    /\btype[-\s]?c\b/i.test(t);

  return hasModelPattern;
}

function extractProductQuery(text) {
  let t = normalizeText(text);
  if (!t) return null;

  t = t.replace(LEADING_INTENT_PREFIX, "");
  t = removeNoiseWords(t);

  return t && t.length >= 2 ? t : null;
}

function parsePayCommand(text) {
  const t = collapseSpaces(normalizeText(text));
  if (!t) return null;

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
  const t = collapseSpaces(normalizeText(text));
  if (!t) return null;

  const m = t.match(
    /^(BUY|ORDER|RESERVE|BOOK|NDAYISHAKA|NDASHAKA|NKENEYE|I WANT|I NEED)\s+(?:(\d+)\s+)?(.+)$/i
  );

  if (!m) return null;

  const qty = m[2] ? Number(m[2]) : 1;
  if (!Number.isInteger(qty) || qty <= 0) return null;

  const query = normalizeText(m[3]);
  if (!query || query.length < 2) return null;

  return {
    quantity: qty,
    query,
  };
}

function parseImplicitBuyIntent(text) {
  const t = normalizeLower(text);
  if (!t) return null;

  const patterns = [
    /^(?:i want|i need|ndashaka|ndayishaka|nkeneye)\s+(?:(\d+)\s+)?(.+)$/i,
    /^(?:can i get|please give me|give me)\s+(?:(\d+)\s+)?(.+)$/i,
  ];

  for (const rx of patterns) {
    const m = collapseSpaces(text).match(rx);
    if (!m) continue;

    const qty = m[1] ? Number(m[1]) : 1;
    const query = normalizeText(m[2]);

    if (!Number.isInteger(qty) || qty <= 0) return null;
    if (!query || query.length < 2) return null;

    return { quantity: qty, query };
  }

  return null;
}

function parseSimpleQuantityFirstBuy(text) {
  const t = collapseSpaces(normalizeText(text));
  if (!t) return null;

  const m = t.match(/^(\d+)\s+(.+)$/);
  if (!m) return null;

  const qty = Number(m[1]);
  const query = normalizeText(m[2]);

  if (!Number.isInteger(qty) || qty <= 0) return null;
  if (!query || query.length < 2) return null;
  if (!hasProductSignal(query)) return null;

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

  const explicitBuy = parseBuyCommand(raw);
  if (explicitBuy) {
    return { type: "BUY", raw, payload: explicitBuy };
  }

  const implicitBuy = parseImplicitBuyIntent(raw);
  if (implicitBuy) {
    return { type: "BUY", raw, payload: implicitBuy };
  }

  const quantityFirstBuy = parseSimpleQuantityFirstBuy(raw);
  if (quantityFirstBuy) {
    return { type: "BUY", raw, payload: quantityFirstBuy };
  }

  if (looksLikeGreeting(raw)) {
    return { type: "GREETING", raw };
  }

  if (looksLikeHumanHelp(raw)) {
    return { type: "HUMAN_HELP", raw };
  }

  const productQuery = extractProductQuery(raw);
  if (hasProductSignal(raw) && productQuery) {
    return {
      type: "PRODUCT_QUERY",
      raw,
      payload: { query: productQuery },
    };
  }

  return { type: "UNKNOWN", raw };
}

module.exports = {
  extractProductQuery,
  parsePayCommand,
  parseBuyCommand,
  detectIntent,
};