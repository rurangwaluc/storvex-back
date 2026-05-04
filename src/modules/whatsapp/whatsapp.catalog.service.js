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

function getModelFields(delegate) {
  try {
    return delegate?.fields || {};
  } catch {
    return {};
  }
}

function modelHasField(delegate, fieldName) {
  const fields = getModelFields(delegate);
  return typeof fields[fieldName] !== "undefined";
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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
    "how",
    "much",
    "do",
    "you",
    "have",
    "mufite",
    "igiciro",
    "angahe",
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
    /\b(?:around|about|budget|under|below|max(?:imum)?|up to|near|within)\s*(\d+(?:[.,]\d+)?)\s*(k|m|rwf|frw)?\b/i,
    /\b(\d+(?:[.,]\d+)?)\s*(k|m)\b/i,
    /\b(\d{5,8})\s*(rwf|frw)?\b/i,
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

  const productFields = getModelFields(prisma.product);
  const keywords = map[q] || [q];

  return {
    OR: keywords.flatMap((kw) => {
      const conditions = [{ name: { contains: kw, mode: "insensitive" } }];

      if (typeof productFields.category !== "undefined") {
        conditions.push({ category: { contains: kw, mode: "insensitive" } });
      }

      if (typeof productFields.subcategory !== "undefined") {
        conditions.push({ subcategory: { contains: kw, mode: "insensitive" } });
      }

      if (typeof productFields.brand !== "undefined") {
        conditions.push({ brand: { contains: kw, mode: "insensitive" } });
      }

      return conditions;
    }),
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
  const fullSerial = normalizeLower(product?.serial);

  const joinedQuery = queryTokens.join(" ").trim();

  if (joinedQuery) {
    if (fullName === joinedQuery) score += 10;
    if (fullSku === joinedQuery) score += 12;
    if (fullBarcode === joinedQuery) score += 12;
    if (fullSerial === joinedQuery) score += 12;
    if (fullName.includes(joinedQuery)) score += 5;
  }

  if (Number(product?.availableQty ?? product?.stockQty ?? 0) > 0) score += 1;

  return score;
}

function buildProductSelect() {
  const productFields = getModelFields(prisma.product);

  return {
    id: true,
    name: true,
    sellPrice: true,
    stockQty: true,
    ...(typeof productFields.brand !== "undefined" ? { brand: true } : {}),
    ...(typeof productFields.category !== "undefined" ? { category: true } : {}),
    ...(typeof productFields.subcategory !== "undefined" ? { subcategory: true } : {}),
    ...(typeof productFields.sku !== "undefined" ? { sku: true } : {}),
    ...(typeof productFields.barcode !== "undefined" ? { barcode: true } : {}),
    ...(typeof productFields.serial !== "undefined" ? { serial: true } : {}),
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

async function attachBranchQuantities({ tenantId, branchId, products }) {
  if (!Array.isArray(products) || products.length === 0) return [];

  if (!branchId || !prisma.branchInventory) {
    return products.map((product) => ({
      ...product,
      branchQty: null,
      availableQty: safeNumber(product.stockQty),
      stockSource: "PRODUCT",
    }));
  }

  const productIds = products.map((product) => product.id).filter(Boolean);

  const rows = await prisma.branchInventory.findMany({
    where: {
      tenantId,
      branchId,
      productId: { in: productIds },
    },
    select: {
      productId: true,
      qtyOnHand: true,
    },
  });

  const qtyByProductId = new Map(
    rows.map((row) => [row.productId, safeNumber(row.qtyOnHand)])
  );

  return products.map((product) => {
    const branchQty = qtyByProductId.has(product.id)
      ? qtyByProductId.get(product.id)
      : 0;

    return {
      ...product,
      branchQty,
      availableQty: branchQty,
      stockSource: "BRANCH_INVENTORY",
    };
  });
}

function buildProductWhere({ tenantId, query = null, tokens = [], budget = null, brand = null, category = null }) {
  const productFields = getModelFields(prisma.product);

  const and = [
    { tenantId },
    ...(typeof productFields.isActive !== "undefined" ? [{ isActive: true }] : []),
  ];

  if (budget) {
    and.push({
      sellPrice: {
        gte: Math.max(0, Math.round(budget * 0.6)),
        lte: Math.round(budget * 1.15),
      },
    });
  }

  if (brand) {
    const brandOr = [{ name: { contains: brand, mode: "insensitive" } }];

    if (typeof productFields.brand !== "undefined") {
      brandOr.push({ brand: { contains: brand, mode: "insensitive" } });
    }

    and.push({ OR: brandOr });
  }

  const categoryWhere = buildCategoryWhere(category);
  if (categoryWhere) and.push(categoryWhere);

  if (query) {
    const exactOr = [{ name: { contains: query, mode: "insensitive" } }];

    if (typeof productFields.category !== "undefined") {
      exactOr.push({ category: { contains: query, mode: "insensitive" } });
    }

    if (typeof productFields.subcategory !== "undefined") {
      exactOr.push({ subcategory: { contains: query, mode: "insensitive" } });
    }

    if (typeof productFields.brand !== "undefined") {
      exactOr.push({ brand: { contains: query, mode: "insensitive" } });
    }

    if (typeof productFields.sku !== "undefined") {
      exactOr.push({ sku: { contains: query, mode: "insensitive" } });
    }

    if (typeof productFields.barcode !== "undefined") {
      exactOr.push({ barcode: { contains: query, mode: "insensitive" } });
    }

    if (typeof productFields.serial !== "undefined") {
      exactOr.push({ serial: { contains: query, mode: "insensitive" } });
    }

    const tokenOr = tokens.flatMap((token) => {
      const conditions = [{ name: { contains: token, mode: "insensitive" } }];

      if (typeof productFields.brand !== "undefined") {
        conditions.push({ brand: { contains: token, mode: "insensitive" } });
      }

      if (typeof productFields.category !== "undefined") {
        conditions.push({ category: { contains: token, mode: "insensitive" } });
      }

      if (typeof productFields.subcategory !== "undefined") {
        conditions.push({ subcategory: { contains: token, mode: "insensitive" } });
      }

      if (typeof productFields.sku !== "undefined") {
        conditions.push({ sku: { contains: token, mode: "insensitive" } });
      }

      if (typeof productFields.barcode !== "undefined") {
        conditions.push({ barcode: { contains: token, mode: "insensitive" } });
      }

      if (typeof productFields.serial !== "undefined") {
        conditions.push({ serial: { contains: token, mode: "insensitive" } });
      }

      return conditions;
    });

    and.push({
      OR: [...exactOr, ...tokenOr],
    });
  }

  return { AND: and };
}

function sortAndLimitProducts({ products, tokens, take, budget = null }) {
  return dedupeProducts(products)
    .map((p) => ({
      ...p,
      _score: scoreProductAgainstQuery(p, tokens),
    }))
    .sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;

      if (budget) {
        const da = Math.abs(Number(a.sellPrice || 0) - budget);
        const db = Math.abs(Number(b.sellPrice || 0) - budget);
        if (da !== db) return da - db;
      }

      if (Number(b.availableQty || 0) !== Number(a.availableQty || 0)) {
        return Number(b.availableQty || 0) - Number(a.availableQty || 0);
      }

      if (Number(a.sellPrice || 0) !== Number(b.sellPrice || 0)) {
        return Number(a.sellPrice || 0) - Number(b.sellPrice || 0);
      }

      return String(a.name || "").localeCompare(String(b.name || ""));
    })
    .filter((p) => p._score > 0 || budget)
    .slice(0, take)
    .map(({ _score, ...rest }) => rest);
}

async function searchProducts({ tenantId, q, take = 3, branchId = null }) {
  const query = normalizeText(q);
  if (!query || query.length < 2) return [];

  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return [];

  const productFields = getModelFields(prisma.product);
  const limit = Math.max(1, Number(take) || 3);

  const products = await prisma.product.findMany({
    where: buildProductWhere({
      tenantId,
      query,
      tokens,
    }),
    select: buildProductSelect(),
    orderBy: [
      { stockQty: "desc" },
      { sellPrice: "asc" },
      { name: "asc" },
    ],
    take: Math.max(20, limit * 6 || 18),
  });

  const withBranchQty = await attachBranchQuantities({
    tenantId,
    branchId,
    products,
  });

  return sortAndLimitProducts({
    products: withBranchQty,
    tokens,
    take: limit,
  }).filter((p) => {
    if (branchId && prisma.branchInventory) return Number(p.availableQty || 0) > 0;
    if (typeof productFields.stockQty !== "undefined") return Number(p.stockQty || 0) > 0;
    return true;
  });
}

async function searchProductsByBudgetIntent({ tenantId, text, take = 3, branchId = null }) {
  const budget = extractBudgetFromText(text);
  const brand = detectBrandFromText(text);
  const category = detectCategoryFromText(text);

  if (!budget && !brand && !category) {
    return {
      products: [],
      meta: { budget: null, brand: null, category: null, used: false, relaxed: false },
    };
  }

  const limit = Math.max(1, Number(take) || 3);
  const tokens = tokenizeQuery([brand, category].filter(Boolean).join(" "));

  let strictProducts = [];

  if (budget) {
    strictProducts = await prisma.product.findMany({
      where: buildProductWhere({
        tenantId,
        budget,
        brand,
        category,
      }),
      select: buildProductSelect(),
      take: 25,
    });
  }

  if (strictProducts.length > 0) {
    const withBranchQty = await attachBranchQuantities({
      tenantId,
      branchId,
      products: strictProducts,
    });

    const products = sortAndLimitProducts({
      products: withBranchQty,
      tokens,
      take: limit,
      budget,
    }).filter((p) => Number(p.availableQty ?? p.stockQty ?? 0) > 0);

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
    where: buildProductWhere({
      tenantId,
      brand,
      category,
    }),
    select: buildProductSelect(),
    take: 30,
  });

  const withBranchQty = await attachBranchQuantities({
    tenantId,
    branchId,
    products: relaxedProducts,
  });

  const products = sortAndLimitProducts({
    products: withBranchQty,
    tokens,
    take: limit,
    budget,
  }).filter((p) => Number(p.availableQty ?? p.stockQty ?? 0) > 0);

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

async function findBestProductMatch({ tenantId, query, branchId = null }) {
  const cleanQuery = normalizeText(query);

  if (!cleanQuery) {
    return { kind: "NONE", product: null, candidates: [] };
  }

  const candidates = await searchProducts({
    tenantId,
    q: cleanQuery,
    take: 6,
    branchId,
  });

  if (!candidates.length) {
    return { kind: "NONE", product: null, candidates: [] };
  }

  if (candidates.length === 1) {
    return { kind: "ONE", product: candidates[0], candidates };
  }

  const normalizedQuery = normalizeLower(cleanQuery);
  const tokens = tokenizeQuery(cleanQuery);

  const exactName = candidates.find((p) => normalizeLower(p.name) === normalizedQuery);
  if (exactName) {
    return { kind: "ONE", product: exactName, candidates };
  }

  const exactSku = candidates.find((p) => normalizeLower(p.sku) === normalizedQuery);
  if (exactSku) {
    return { kind: "ONE", product: exactSku, candidates };
  }

  const exactBarcode = candidates.find((p) => normalizeLower(p.barcode) === normalizedQuery);
  if (exactBarcode) {
    return { kind: "ONE", product: exactBarcode, candidates };
  }

  const exactSerial = candidates.find((p) => normalizeLower(p.serial) === normalizedQuery);
  if (exactSerial) {
    return { kind: "ONE", product: exactSerial, candidates };
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

function availabilityLine(product) {
  const qty = Number(product?.availableQty ?? product?.stockQty ?? 0);

  if (qty <= 0) {
    return "📦 Availability: our team will confirm";
  }

  return `📦 Available: ${Math.round(qty)}`;
}

function buildProductsReply({ businessName, q, products }) {
  if (!products || products.length === 0) {
    return (
      `❌ *${businessName}*\n` +
      `I could not find "${q}" available right now.\n` +
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
    lines.push(availabilityLine(p));
    lines.push("");
  }

  lines.push(`To reserve, reply: *BUY <exact product name>*`);
  lines.push(`Our team will confirm pickup or delivery details.`);

  return lines.join("\n").trim();
}

function buildBudgetProductsReply({ businessName, originalText, products, meta }) {
  if (!products || products.length === 0) {
    return (
      `❌ *${businessName}*\n` +
      `I could not find a close available match for "${originalText}".\n` +
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
    lines.push(availabilityLine(p));
    lines.push("");
  }

  lines.push(`To reserve, reply: *BUY <exact product name>*`);
  lines.push(`Our team will confirm pickup or delivery details.`);

  return lines.join("\n").trim();
}

function buildBuyCreatedReply({ businessName, product, quantity, draftId }) {
  const code = String(draftId || "").slice(-6).toUpperCase();
  const qty = Math.max(1, Number(quantity || 1));
  const total = Number(product?.sellPrice || 0) * qty;

  const lines = [];

  lines.push(`✅ *${businessName}*`);
  lines.push(`Your order request has been prepared.`);
  lines.push("");
  lines.push(`📦 Product: *${product.name}*`);
  lines.push(`🔢 Quantity: *${qty}*`);
  lines.push(`💰 Unit price: ${formatMoneyRwf(product.sellPrice)}`);
  lines.push(`🧾 Draft code: *${code}*`);
  lines.push(`Estimated total: *${formatMoneyRwf(total)}*`);
  lines.push("");
  lines.push(`Our staff will review and finalize your order.`);
  lines.push(`To pay later, send: *PAY ${Math.round(total)} MOMO YOUR_REF #${code}*`);

  return lines.join("\n");
}

function buildBuyMultipleReply({ businessName, query, candidates }) {
  const lines = [];

  lines.push(`⚠️ *${businessName}*`);
  lines.push(`I found multiple matches for "${query}".`);
  lines.push(`Please reply with the exact product name:`);
  lines.push("");

  for (const p of candidates || []) {
    lines.push(
      `• *${p.name}* — ${formatMoneyRwf(p.sellPrice)} — ${availabilityLine(p).replace("📦 ", "")}`
    );
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