const prisma = require("../../config/database");

function normalizeText(value) {
  const s = String(value || "").trim();
  return s || null;
}

function normalizeLower(value) {
  return String(value || "").toLowerCase().trim();
}

function collapseSpaces(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatMoneyRwf(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return String(n);
  return `${Math.round(x).toLocaleString("en-US")} RWF`;
}

function normalizeSearchText(value) {
  return collapseSpaces(
    String(value || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s/-]/gu, " ")
      .replace(/[_]+/g, " ")
  );
}

function tokenizeQuery(value) {
  const text = normalizeSearchText(value);
  if (!text) return [];

  const stopWords = new Set([
    "price",
    "stock",
    "available",
    "availability",
    "buy",
    "order",
    "want",
    "need",
    "the",
    "for",
    "with",
    "and",
    "phone",
    "please",
  ]);

  return text
    .split(" ")
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => x.length >= 2)
    .filter((x) => !stopWords.has(x));
}

function buildSearchHaystack(product) {
  return normalizeSearchText(
    [
      product?.name,
      product?.brand,
      product?.category,
      product?.subcategory,
      product?.sku,
      product?.barcode,
      product?.serial,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function extractBudgetFromText(text) {
  const raw = normalizeLower(text);

  const patterns = [
    /\b(?:around|about|budget|under|below|max(?:imum)?|up to|near|within)\s*(\d+(?:[.,]\d+)?)\s*(k|m|rwf)?\b/i,
    /\b(\d+(?:[.,]\d+)?)\s*(k|m)\b/i,
    /\b(\d{5,8})\s*(rwf)?\b/i,
  ];

  for (const rx of patterns) {
    const m = raw.match(rx);
    if (!m) continue;

    let amount = Number(String(m[1]).replace(/,/g, ""));
    if (!Number.isFinite(amount)) continue;

    const unit = String(m[2] || "").toLowerCase();

    if (unit === "k") amount *= 1000;
    if (unit === "m") amount *= 1000000;

    return Math.round(amount);
  }

  return null;
}

function detectBrandFromText(text) {
  const raw = normalizeLower(text);

  const brands = [
    "samsung",
    "apple",
    "iphone",
    "tecno",
    "infinix",
    "xiaomi",
    "redmi",
    "itel",
    "nokia",
    "oppo",
    "vivo",
    "huawei",
    "google",
    "pixel",
    "oneplus",
    "hp",
    "dell",
    "lenovo",
    "asus",
    "acer",
    "msi",
    "toshiba",
    "canon",
    "epson",
    "brother",
    "logitech",
    "anker",
    "oraimo",
    "jbl",
    "sony",
    "bose",
    "beats",
    "sandisk",
    "kingston",
    "seagate",
    "wd",
    "tp-link",
    "tplink",
    "mikrotik",
  ];

  for (const brand of brands) {
    if (raw.includes(brand)) {
      if (brand === "iphone") return "Apple";
      if (brand === "pixel") return "Google";
      if (brand === "tplink") return "TP-Link";
      if (brand === "hp") return "HP";
      if (brand === "wd") return "WD";
      return brand
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join("-");
    }
  }

  return null;
}

function detectCategoryFromText(text) {
  const raw = normalizeLower(text);

  if (/\b(phone|smartphone|mobile|telephone)\b/i.test(raw)) return "phone";
  if (/\b(laptop|computer|notebook|pc|macbook)\b/i.test(raw)) return "laptop";
  if (/\b(charger|adapter)\b/i.test(raw)) return "charger";
  if (/\b(cable|usb|type c|type-c|lightning)\b/i.test(raw)) return "cable";
  if (/\b(airpods|earbuds|earphones|headphones|pods|headset)\b/i.test(raw)) return "audio";
  if (/\b(speaker|bluetooth speaker)\b/i.test(raw)) return "speaker";
  if (/\b(power bank|powerbank)\b/i.test(raw)) return "power bank";
  if (/\b(watch|smartwatch)\b/i.test(raw)) return "watch";
  if (/\b(mouse)\b/i.test(raw)) return "mouse";
  if (/\b(keyboard)\b/i.test(raw)) return "keyboard";
  if (/\b(router|modem|wifi)\b/i.test(raw)) return "network";
  if (/\b(printer)\b/i.test(raw)) return "printer";
  if (/\b(flash|usb drive|memory card|ssd|hard drive|hdd)\b/i.test(raw)) return "storage";
  if (/\b(case|cover)\b/i.test(raw)) return "case";
  if (/\b(screen protector|protector)\b/i.test(raw)) return "screen protector";

  return null;
}

function buildCategoryWhere(category) {
  if (!category) return null;

  const q = normalizeLower(category);

  const map = {
    phone: ["phone", "smartphone", "mobile", "iphone", "galaxy"],
    laptop: ["laptop", "notebook", "computer", "macbook"],
    charger: ["charger", "adapter"],
    cable: ["cable", "usb", "type c", "type-c", "lightning"],
    audio: ["audio", "earbuds", "earphones", "headphones", "airpods", "headset"],
    speaker: ["speaker"],
    "power bank": ["power bank", "powerbank"],
    watch: ["watch", "smartwatch"],
    mouse: ["mouse"],
    keyboard: ["keyboard"],
    network: ["router", "modem", "wifi"],
    printer: ["printer"],
    storage: ["ssd", "hard drive", "hdd", "usb drive", "flash", "memory card"],
    case: ["case", "cover"],
    "screen protector": ["screen protector", "protector"],
  };

  const keywords = map[q] || [q];

  return {
    OR: keywords.flatMap((kw) => [
      { category: { contains: kw, mode: "insensitive" } },
      { subcategory: { contains: kw, mode: "insensitive" } },
      { name: { contains: kw, mode: "insensitive" } },
      { brand: { contains: kw, mode: "insensitive" } },
    ]),
  };
}

function scoreProductAgainstQuery(product, queryTokens) {
  const hay = buildSearchHaystack(product);
  let score = 0;

  for (const token of queryTokens) {
    if (!token) continue;

    const exactWord = new RegExp(`\\b${escapeRegExp(token)}\\b`, "i");
    if (exactWord.test(hay)) {
      score += 8;
      continue;
    }

    if (hay.includes(token.toLowerCase())) {
      score += 3;
    }
  }

  const fullName = normalizeLower(product?.name);
  const fullSku = normalizeLower(product?.sku);
  const fullBarcode = normalizeLower(product?.barcode);

  const joinedQuery = queryTokens.join(" ").trim();
  if (joinedQuery) {
    if (fullName === joinedQuery) score += 10;
    if (fullSku === joinedQuery) score += 12;
    if (fullBarcode === joinedQuery) score += 12;
    if (fullName.includes(joinedQuery)) score += 5;
  }

  if (Number(product?.stockQty || 0) > 0) score += 1;

  return score;
}

function buildProductSelect() {
  return {
    id: true,
    name: true,
    sellPrice: true,
    stockQty: true,
    brand: true,
    category: true,
    subcategory: true,
    sku: true,
    barcode: true,
    serial: true,
  };
}

function dedupeProducts(products) {
  const seen = new Set();
  const out = [];

  for (const p of products || []) {
    const key =
      p?.id ||
      `${normalizeLower(p?.name)}|${normalizeLower(p?.sku)}|${normalizeLower(p?.barcode)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }

  return out;
}

async function searchProducts({ tenantId, q, take = 3 }) {
  const query = normalizeText(q);
  if (!query || query.length < 2) return [];

  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return [];

  const exactOr = [
    { name: { contains: query, mode: "insensitive" } },
    { category: { contains: query, mode: "insensitive" } },
    { subcategory: { contains: query, mode: "insensitive" } },
    { brand: { contains: query, mode: "insensitive" } },
    { sku: { contains: query, mode: "insensitive" } },
    { barcode: { contains: query, mode: "insensitive" } },
    { serial: { contains: query, mode: "insensitive" } },
  ];

  const tokenOr = tokens.flatMap((token) => [
    { name: { contains: token, mode: "insensitive" } },
    { brand: { contains: token, mode: "insensitive" } },
    { category: { contains: token, mode: "insensitive" } },
    { subcategory: { contains: token, mode: "insensitive" } },
    { sku: { contains: token, mode: "insensitive" } },
    { barcode: { contains: token, mode: "insensitive" } },
  ]);

  const products = await prisma.product.findMany({
    where: {
      tenantId,
      isActive: true,
      stockQty: { gt: 0 },
      OR: [...exactOr, ...tokenOr],
    },
    select: buildProductSelect(),
    take: Math.max(20, Number(take) * 6 || 18),
  });

  return dedupeProducts(products)
    .map((p) => ({
      ...p,
      _score: scoreProductAgainstQuery(p, tokens),
    }))
    .sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      if (Number(b.stockQty || 0) !== Number(a.stockQty || 0)) {
        return Number(b.stockQty || 0) - Number(a.stockQty || 0);
      }
      if (Number(a.sellPrice || 0) !== Number(b.sellPrice || 0)) {
        return Number(a.sellPrice || 0) - Number(b.sellPrice || 0);
      }
      return String(a.name || "").localeCompare(String(b.name || ""));
    })
    .filter((p) => p._score > 0)
    .slice(0, take)
    .map(({ _score, ...rest }) => rest);
}

async function searchProductsByBudgetIntent({ tenantId, text, take = 3 }) {
  const budget = extractBudgetFromText(text);
  const brand = detectBrandFromText(text);
  const category = detectCategoryFromText(text);

  if (!budget && !brand && !category) {
    return {
      products: [],
      meta: { budget: null, brand: null, category: null, used: false, relaxed: false },
    };
  }

  const baseAnd = [{ tenantId }, { isActive: true }, { stockQty: { gt: 0 } }];

  if (brand) {
    baseAnd.push({
      OR: [
        { brand: { contains: brand, mode: "insensitive" } },
        { name: { contains: brand, mode: "insensitive" } },
      ],
    });
  }

  const categoryWhere = buildCategoryWhere(category);
  if (categoryWhere) baseAnd.push(categoryWhere);

  let strictProducts = [];

  if (budget) {
    strictProducts = await prisma.product.findMany({
      where: {
        AND: [
          ...baseAnd,
          {
            sellPrice: {
              gte: Math.max(0, Math.round(budget * 0.6)),
              lte: Math.round(budget * 1.15),
            },
          },
        ],
      },
      select: buildProductSelect(),
      take: 25,
    });
  }

  if (strictProducts.length > 0) {
    const products = dedupeProducts(strictProducts)
      .sort((a, b) => {
        const da = Math.abs(Number(a.sellPrice || 0) - budget);
        const db = Math.abs(Number(b.sellPrice || 0) - budget);
        if (da !== db) return da - db;
        if (Number(b.stockQty || 0) !== Number(a.stockQty || 0)) {
          return Number(b.stockQty || 0) - Number(a.stockQty || 0);
        }
        return String(a.name || "").localeCompare(String(b.name || ""));
      })
      .slice(0, take);

    return {
      products,
      meta: {
        budget,
        brand,
        category,
        used: true,
        relaxed: false,
      },
    };
  }

  const relaxedProducts = await prisma.product.findMany({
    where: { AND: baseAnd },
    select: buildProductSelect(),
    take: 30,
  });

  const products = dedupeProducts(relaxedProducts)
    .sort((a, b) => {
      if (budget) {
        const da = Math.abs(Number(a.sellPrice || 0) - budget);
        const db = Math.abs(Number(b.sellPrice || 0) - budget);
        if (da !== db) return da - db;
      }

      if (Number(b.stockQty || 0) !== Number(a.stockQty || 0)) {
        return Number(b.stockQty || 0) - Number(a.stockQty || 0);
      }

      return String(a.name || "").localeCompare(String(b.name || ""));
    })
    .slice(0, take);

  return {
    products,
    meta: {
      budget,
      brand,
      category,
      used: true,
      relaxed: true,
    },
  };
}

async function findBestProductMatch({ tenantId, query }) {
  const cleanQuery = normalizeText(query);
  if (!cleanQuery) {
    return { kind: "NONE", product: null, candidates: [] };
  }

  const candidates = await searchProducts({
    tenantId,
    q: cleanQuery,
    take: 6,
  });

  if (!candidates.length) {
    return { kind: "NONE", product: null, candidates: [] };
  }

  if (candidates.length === 1) {
    return { kind: "ONE", product: candidates[0], candidates };
  }

  const normalizedQuery = normalizeLower(cleanQuery);
  const tokens = tokenizeQuery(cleanQuery);

  const exactName = candidates.find(
    (p) => normalizeLower(p.name) === normalizedQuery
  );
  if (exactName) {
    return { kind: "ONE", product: exactName, candidates };
  }

  const exactSku = candidates.find(
    (p) => normalizeLower(p.sku) === normalizedQuery
  );
  if (exactSku) {
    return { kind: "ONE", product: exactSku, candidates };
  }

  const exactBarcode = candidates.find(
    (p) => normalizeLower(p.barcode) === normalizedQuery
  );
  if (exactBarcode) {
    return { kind: "ONE", product: exactBarcode, candidates };
  }

  const scored = candidates.map((p) => ({
    product: p,
    score: scoreProductAgainstQuery(p, tokens),
  }));

  scored.sort((a, b) => b.score - a.score);

  const first = scored[0];
  const second = scored[1];

  if (!second) {
    return { kind: "ONE", product: first.product, candidates };
  }

  if (first.score >= second.score + 4) {
    return { kind: "ONE", product: first.product, candidates };
  }

  return {
    kind: "MULTIPLE",
    product: null,
    candidates: candidates.slice(0, 4),
  };
}

function formatProductLine(p) {
  const pieces = [];

  if (p?.brand) pieces.push(p.brand);
  if (p?.category) pieces.push(p.category);
  if (p?.sku) pieces.push(`SKU ${p.sku}`);

  return pieces.join(" • ");
}

function buildProductsReply({ businessName, q, products }) {
  if (!products || products.length === 0) {
    return (
      `❌ *${businessName}*\n` +
      `I could not find "${q}" in stock right now.\n` +
      `Reply with another model name, SKU, barcode, or brand.`
    );
  }

  const lines = [];
  lines.push(`✅ *${businessName}*`);
  lines.push(`Here are the closest matches for: "${q}"`);
  lines.push("");

  for (const p of products) {
    lines.push(`📦 *${p.name}*`);
    if (formatProductLine(p)) lines.push(`${formatProductLine(p)}`);
    lines.push(`💰 Price: ${formatMoneyRwf(p.sellPrice)}`);
    lines.push(`📦 In stock: ${p.stockQty}`);
    lines.push("");
  }

  lines.push(`To reserve, reply: *BUY <exact product name>*`);
  return lines.join("\n").trim();
}

function buildBudgetProductsReply({ businessName, originalText, products, meta }) {
  if (!products || products.length === 0) {
    return (
      `❌ *${businessName}*\n` +
      `I could not find a close in-stock match for "${originalText}".\n` +
      `Reply with a model name, exact brand, SKU, or barcode.`
    );
  }

  const lines = [];
  lines.push(`✅ *${businessName}*`);

  if (meta?.relaxed) {
    lines.push(`I did not find an exact match for your budget request.`);
    lines.push(`Here are the closest available options:`);
  } else {
    lines.push(`I found close matches for your request:`);
  }

  const hints = [];
  if (meta?.brand) hints.push(`brand: ${meta.brand}`);
  if (meta?.category) hints.push(`type: ${meta.category}`);
  if (meta?.budget) hints.push(`budget: ${formatMoneyRwf(meta.budget)}`);

  if (hints.length) {
    lines.push(`(${hints.join(" • ")})`);
  }

  lines.push("");

  for (const p of products) {
    lines.push(`📦 *${p.name}*`);
    if (formatProductLine(p)) lines.push(`${formatProductLine(p)}`);
    lines.push(`💰 Price: ${formatMoneyRwf(p.sellPrice)}`);
    lines.push(`📦 In stock: ${p.stockQty}`);
    lines.push("");
  }

  lines.push(`To reserve, reply: *BUY <exact product name>*`);
  return lines.join("\n").trim();
}

function buildBuyCreatedReply({ businessName, product, quantity, draftId }) {
  const code = String(draftId || "").slice(-6).toUpperCase();

  const lines = [];
  lines.push(`✅ *${businessName}*`);
  lines.push(`Your draft order has been created.`);
  lines.push("");
  lines.push(`📦 Product: *${product.name}*`);
  lines.push(`🔢 Quantity: *${quantity}*`);
  lines.push(`💰 Unit price: ${formatMoneyRwf(product.sellPrice)}`);
  lines.push(`🧾 Draft code: *${code}*`);
  lines.push("");
  lines.push(`Our staff can now review and finalize your order.`);

  return lines.join("\n");
}

function buildBuyMultipleReply({ businessName, query, candidates }) {
  const lines = [];
  lines.push(`⚠️ *${businessName}*`);
  lines.push(`I found multiple matches for "${query}".`);
  lines.push(`Please reply with the exact product name:`);
  lines.push("");

  for (const p of candidates || []) {
    lines.push(`• *${p.name}* — ${formatMoneyRwf(p.sellPrice)} — Stock ${p.stockQty}`);
  }

  return lines.join("\n");
}

module.exports = {
  searchProducts,
  searchProductsByBudgetIntent,
  findBestProductMatch,
  formatMoneyRwf,
  buildProductsReply,
  buildBudgetProductsReply,
  buildBuyCreatedReply,
  buildBuyMultipleReply,
};