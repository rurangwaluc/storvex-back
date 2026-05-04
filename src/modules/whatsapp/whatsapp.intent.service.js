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

function cleanSearchText(value) {
  return collapseSpaces(
    String(value || "")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/[^\p{L}\p{N}\s#@+./_-]/gu, " ")
      .replace(/\s+/g, " ")
  );
}

function normalizeMoneyAmount(rawValue, unit = "") {
  if (rawValue === undefined || rawValue === null) return null;

  const clean = String(rawValue).replace(/[,\s]/g, "");
  let amount = Number(clean);

  if (!Number.isFinite(amount) || amount <= 0) return null;

  const normalizedUnit = String(unit || "").trim().toLowerCase();

  if (normalizedUnit === "k") amount *= 1000;
  if (normalizedUnit === "m") amount *= 1000000;

  return Math.round(amount);
}

function normalizePaymentMethod(value) {
  const raw = normalizeLower(value);

  if (!raw) return "MOMO";

  if (/\b(cash|amafaranga|frw|rwf)\b/i.test(raw)) return "CASH";

  if (/\b(momo|mobile money|mobilemoney|mtn|mtn momo|mo mo)\b/i.test(raw)) {
    return "MOMO";
  }

  if (/\b(bank|transfer|bank transfer|bk|equity|i&m|imbank|cogebanque)\b/i.test(raw)) {
    return "BANK";
  }

  if (/\b(card|visa|mastercard|debit|credit card)\b/i.test(raw)) {
    return "CARD";
  }

  if (/\b(other)\b/i.test(raw)) return "OTHER";

  return "MOMO";
}

const GREETING_WORDS = [
  "hi",
  "hello",
  "hey",
  "yo",
  "bonjour",
  "salut",
  "muraho",
  "amakuru",
  "bite",
  "mwaramutse",
  "mwiriwe",
  "good morning",
  "good afternoon",
  "good evening",
  "salam",
];

const HUMAN_HELP_WORDS = [
  "help",
  "human",
  "agent",
  "staff",
  "person",
  "real person",
  "umukozi",
  "operator",
  "support",
  "customer care",
  "service",
  "manager",
  "owner",
  "cashier",
  "seller",
  "call me",
  "please call",
  "can you call",
  "talk to",
  "speak to",
  "ndashaka umuntu",
  "muvugishe umuntu",
  "hamagara",
  "mwampamagara",
  "problem",
  "issue",
  "complaint",
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
  "have you got",
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
  "show me",
  "send me",
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
  "adapter",
  "type c",
  "type-c",
  "usb c",
  "usb-c",
  "cable",
  "lightning",
  "airpods",
  "earbuds",
  "earphones",
  "headphones",
  "headset",
  "speaker",
  "power bank",
  "powerbank",
  "router",
  "wifi",
  "printer",
  "ssd",
  "hard drive",
  "hdd",
  "flash",
  "usb drive",
  "memory card",
  "mouse",
  "keyboard",
  "screen protector",
  "protector",
  "case",
  "cover",
];

const LEADING_INTENT_PREFIX =
  /^(price|stock|available|availability|how much|cost|murafite|murafite se|mufite|igiciro|angahe|do you have|have you got|looking for|searching for|show me|send me)\s*[:\-]?\s*/i;

function removeNoiseWords(text) {
  return collapseSpaces(
    String(text || "")
      .replace(
        /\b(price|stock|available|availability|how much|cost|murafite|mufite|igiciro|angahe|need|want|buy|order|reserve|book|please|pls|kindly)\b/gi,
        " "
      )
      .replace(/[?]/g, " ")
  );
}

function looksLikeGreeting(text) {
  const t = normalizeLower(text);
  if (!t) return false;

  return GREETING_WORDS.some((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|\\s)${escaped}(\\s|$|[!.?])`, "i").test(t);
  });
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
    /\b[a-z]{1,8}\d{1,5}[a-z]?\b/i.test(t) ||
    /\b\d{2,4}gb\b/i.test(t) ||
    /\b\d{1,2}\s?tb\b/i.test(t) ||
    /\btype[-\s]?c\b/i.test(t) ||
    /\busb[-\s]?c\b/i.test(t) ||
    /\ba\d{1,3}\b/i.test(t) ||
    /\bs\d{1,3}\b/i.test(t) ||
    /\bnote\s?\d{1,3}\b/i.test(t);

  return hasModelPattern;
}

function extractProductQuery(text) {
  let t = normalizeText(text);
  if (!t) return null;

  t = t.replace(LEADING_INTENT_PREFIX, "");
  t = removeNoiseWords(t);
  t = cleanSearchText(t);

  return t && t.length >= 2 ? t : null;
}

function extractSaleCode(text) {
  const raw = String(text || "");

  const hash = raw.match(/#\s*([a-zA-Z0-9-]{3,40})/);
  if (hash?.[1]) return String(hash[1]).trim().toUpperCase();

  const codeWords = raw.match(
    /\b(?:code|order|order code|draft|draft code|receipt|invoice|sale)\s*[:#-]?\s*([a-zA-Z0-9-]{3,40})\b/i
  );

  if (codeWords?.[1]) return String(codeWords[1]).trim().toUpperCase();

  return null;
}

function extractPaymentReference(text) {
  const raw = String(text || "").trim();

  const explicit = raw.match(
    /\b(?:ref|reference|tx|transaction|txn|code|momo code|payment code)\s*[:#-]?\s*([a-zA-Z0-9._/-]{3,80})\b/i
  );

  if (explicit?.[1]) {
    const candidate = explicit[1].trim();

    if (!/^(cash|momo|mobile|money|bank|card|rwf|frw|pay|paid)$/i.test(candidate)) {
      return candidate;
    }
  }

  const longTokenCandidates = raw
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => /^[a-zA-Z0-9._/-]{4,80}$/.test(x))
    .filter((x) => !/^\d+$/.test(x))
    .filter((x) => !/^#?[a-zA-Z0-9-]{3,40}$/i.test(x) || !raw.includes(`#${x}`))
    .filter((x) => !/^(pay|paid|momo|cash|bank|card|rwf|frw|payment|ref|tx|code)$/i.test(x));

  return longTokenCandidates[longTokenCandidates.length - 1] || null;
}

function extractPaymentAmount(text) {
  const raw = normalizeLower(text);

  const patterns = [
    /\b(?:pay|paid|payment|deposit|advance|sent|transfer|nishyuye|nishyuyeho|nohereje|mboherereje|kwishyura|yishyuye)\s+(\d[\d,.\s]*)(k|m|rwf|frw)?\b/i,
    /\b(\d[\d,.\s]*)(k|m)?\s*(?:rwf|frw)\b/i,
    /\b(?:rwf|frw)\s*(\d[\d,.\s]*)(k|m)?\b/i,
    /\b(\d+(?:[.,]\d+)?)\s*(k|m)\b/i,
    /\b(\d{3,9})\b/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match) continue;

    const amount = normalizeMoneyAmount(match[1], match[2]);
    if (amount && amount > 0) return amount;
  }

  return null;
}

function parsePayCommand(text) {
  const t = collapseSpaces(normalizeText(text));
  if (!t) return null;

  const strict = t.match(
    /^PAY\s+(\d+(?:[.,]\d+)?)\s+(CASH|MOMO|BANK|CARD|OTHER)\s+([A-Za-z0-9._/-]{3,80})(?:\s+#([A-Za-z0-9-]{3,40}))?$/i
  );

  if (strict) {
    const amount = normalizeMoneyAmount(strict[1]);
    if (!amount) return null;

    return {
      amount,
      method: normalizePaymentMethod(strict[2]),
      reference: String(strict[3]),
      saleCode: strict[4] ? String(strict[4]).toUpperCase() : null,
    };
  }

  const raw = normalizeLower(t);

  const hasPaymentVerb =
    /\b(pay|paid|payment|deposit|advance|sent|transfer|momo|mobile money|bank|cash|card)\b/i.test(
      raw
    ) ||
    /\b(nishyuye|nishyuyeho|nohereje|mboherereje|kwishyura|yishyuye)\b/i.test(raw);

  if (!hasPaymentVerb) return null;

  const amount = extractPaymentAmount(t);
  if (!amount) return null;

  return {
    amount,
    method: normalizePaymentMethod(t),
    reference: extractPaymentReference(t) || `WA-${Date.now()}`,
    saleCode: extractSaleCode(t),
  };
}

function extractQuantityFromText(text) {
  const raw = normalizeLower(text);

  const directPatterns = [
    /\b(?:qty|quantity|x)\s*[:#-]?\s*(\d{1,4})\b/i,
    /\b(\d{1,4})\s*(?:pcs|pieces|piece|items|units|phones|laptops|chargers|cables)\b/i,
  ];

  for (const pattern of directPatterns) {
    const match = raw.match(pattern);
    if (!match?.[1]) continue;

    const qty = Number(match[1]);
    if (Number.isInteger(qty) && qty > 0) return Math.min(999, qty);
  }

  if (/\b(two|couple)\b/i.test(raw)) return 2;
  if (/\bthree\b/i.test(raw)) return 3;
  if (/\bfour\b/i.test(raw)) return 4;
  if (/\bfive\b/i.test(raw)) return 5;

  return 1;
}

function removeQuantityWords(text) {
  return collapseSpaces(
    String(text || "")
      .replace(/\b(?:qty|quantity|x)\s*[:#-]?\s*\d{1,4}\b/gi, " ")
      .replace(/\b\d{1,4}\s*(?:pcs|pieces|piece|items|units|phones|laptops|chargers|cables)\b/gi, " ")
      .replace(/\b(two|couple|three|four|five)\b/gi, " ")
  );
}

function cleanBuyQuery(value) {
  return cleanSearchText(
    removeQuantityWords(value)
      .replace(/\b(for me|to me|please|pls|kindly|today|now|right now)\b/gi, " ")
      .replace(/\b(kuri njye|ubu|none)\b/gi, " ")
  );
}

function parseBuyCommand(text) {
  const t = collapseSpaces(normalizeText(text));
  if (!t) return null;

  const m = t.match(
    /^(BUY|ORDER|RESERVE|BOOK|NDAYISHAKA|NDASHAKA|NKENEYE|I WANT|I NEED|MFATIRA|MUMPE|NGURISHA|GURA)\s+(?:(\d+)\s+)?(.+)$/i
  );

  if (!m) return null;

  const qtyFromPrefix = m[2] ? Number(m[2]) : null;
  const quantity =
    Number.isInteger(qtyFromPrefix) && qtyFromPrefix > 0
      ? Math.min(999, qtyFromPrefix)
      : extractQuantityFromText(m[3]);

  const query = cleanBuyQuery(m[3]);

  if (!query || query.length < 2) return null;

  return {
    quantity,
    query,
  };
}

function parseImplicitBuyIntent(text) {
  const t = normalizeLower(text);
  if (!t) return null;

  const patterns = [
    /^(?:i want|i need|i will take|can i get|please give me|give me)\s+(?:(\d+)\s+)?(.+)$/i,
    /^(?:ndashaka|ndayishaka|nkeneye|mumpe|mfatira|ngurisha|ndashaka kugura)\s+(?:(\d+)\s+)?(.+)$/i,
  ];

  for (const rx of patterns) {
    const m = collapseSpaces(text).match(rx);
    if (!m) continue;

    const qtyFromPrefix = m[1] ? Number(m[1]) : null;
    const quantity =
      Number.isInteger(qtyFromPrefix) && qtyFromPrefix > 0
        ? Math.min(999, qtyFromPrefix)
        : extractQuantityFromText(m[2]);

    const query = cleanBuyQuery(m[2]);

    if (!query || query.length < 2) return null;

    return { quantity, query };
  }

  return null;
}

function parseSimpleQuantityFirstBuy(text) {
  const t = collapseSpaces(normalizeText(text));
  if (!t) return null;

  const m = t.match(/^(\d{1,4})\s+(.+)$/);
  if (!m) return null;

  const qty = Number(m[1]);
  const query = cleanBuyQuery(m[2]);

  if (!Number.isInteger(qty) || qty <= 0) return null;
  if (!query || query.length < 2) return null;
  if (!hasProductSignal(query)) return null;

  return {
    quantity: Math.min(999, qty),
    query,
  };
}

function detectProductQueryIntent(text) {
  const raw = normalizeLower(text);
  if (!raw) return null;

  const hasQueryVerb =
    /\b(price|stock|available|availability|how much|cost|do you have|have you got|is there|show me|send me|looking for|searching for)\b/i.test(
      raw
    ) ||
    /\b(igiciro|angahe|mufite|murafite|hari|mbwira|ndashaka kureba|ndashaka kumenya)\b/i.test(
      raw
    );

  const productQuery = extractProductQuery(text);

  if (hasQueryVerb && productQuery) {
    return {
      type: "PRODUCT_QUERY",
      payload: { query: productQuery },
    };
  }

  if (hasProductSignal(raw) && productQuery) {
    return {
      type: "PRODUCT_QUERY",
      payload: { query: productQuery },
    };
  }

  const words = cleanSearchText(raw).split(/\s+/).filter(Boolean);

  if (words.length >= 1 && words.length <= 8 && productQuery) {
    if (!looksLikeGreeting(raw) && !looksLikeHumanHelp(raw)) {
      return {
        type: "PRODUCT_QUERY",
        payload: { query: productQuery },
      };
    }
  }

  return null;
}

function detectIntent(text) {
  const raw = normalizeText(text);

  if (!raw) {
    return { type: "EMPTY", raw, payload: {} };
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
    return { type: "GREETING", raw, payload: { rawText: raw } };
  }

  if (looksLikeHumanHelp(raw)) {
    return { type: "HUMAN_HELP", raw, payload: { rawText: raw } };
  }

  const productQuery = detectProductQueryIntent(raw);
  if (productQuery) {
    return {
      type: "PRODUCT_QUERY",
      raw,
      payload: {
        ...productQuery.payload,
        rawText: raw,
      },
    };
  }

  return { type: "UNKNOWN", raw, payload: { rawText: raw } };
}

module.exports = {
  extractProductQuery,
  parsePayCommand,
  parseBuyCommand,
  parseImplicitBuyIntent,
  parseSimpleQuantityFirstBuy,
  detectIntent,

  // helpful for Postman/manual testing
  extractPaymentAmount,
  extractPaymentReference,
  extractSaleCode,
  extractQuantityFromText,
};