"use strict";

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cleanStr(value) {
  const s = String(value ?? "").trim();
  return s || "";
}

function oneLine(value) {
  return cleanStr(value).replace(/\s+/g, " ");
}

function normalizeHexColor(input, fallback = "#1a56db") {
  const value = cleanStr(input);
  if (!value) return fallback;

  const normalized = value.startsWith("#") ? value : `#${value}`;

  if (/^#[0-9a-fA-F]{6}$/.test(normalized)) return normalized.toUpperCase();

  if (/^#[0-9a-fA-F]{3}$/.test(normalized)) {
    const r = normalized[1];
    const g = normalized[2];
    const b = normalized[3];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }

  return fallback;
}

function hexToRgb(hex) {
  const safe = normalizeHexColor(hex, "#1a56db");
  const match = safe.match(/^#([0-9a-fA-F]{6})$/);

  if (!match) {
    return { r: 26, g: 86, b: 219 };
  }

  return {
    r: parseInt(match[1].slice(0, 2), 16),
    g: parseInt(match[1].slice(2, 4), 16),
    b: parseInt(match[1].slice(4, 6), 16),
  };
}

function rgba(hex, alpha = 1) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function money(value, currency = "RWF") {
  const safeCurrency = oneLine(currency || "RWF");
  const amount = Number(value || 0);

  return `${safeCurrency} ${Number.isFinite(amount) ? amount.toLocaleString() : "0"}`;
}

function fmtDate(value) {
  if (!value) return "—";

  try {
    return new Date(value).toLocaleDateString("en-GB", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return "—";
  }
}

function fmtDateLong(value) {
  if (!value) return "—";

  try {
    return new Date(value).toLocaleDateString("en-GB", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch {
    return "—";
  }
}

function fmtDateTime(value) {
  if (!value) return "—";

  try {
    return new Date(value).toLocaleString("en-GB");
  } catch {
    return "—";
  }
}

function toSafeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function hasOwnValue(obj, key) {
  return obj && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined;
}

function getLocationName(payload = {}) {
  return oneLine(
    payload.sellingLocation ||
      payload.storeLocation ||
      payload.locationName ||
      payload.location ||
      payload.branchName ||
      payload.branch ||
      "",
  );
}

function getLocationLabel(extra = {}) {
  return oneLine(extra.locationLabel || "Selling location");
}

function sanitizeInfoKey(key) {
  const normalized = oneLine(key);

  if (!normalized) return "";

  const upper = normalized.toUpperCase();

  if (upper === "BRANCH" || upper === "BRANCH NAME" || upper === "BRANCH CODE") {
    return "Selling location";
  }

  if (upper === "REF" || upper === "SALE REF") {
    return "Reference";
  }

  return normalized;
}

function normalizeInfoRows(rows = []) {
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row) => {
      if (!Array.isArray(row)) return null;

      const key = sanitizeInfoKey(row[0]);
      const value = oneLine(row[1]);

      if (!key || !value) return null;

      return [key, value];
    })
    .filter(Boolean);
}

function normalizeItems(items = []) {
  if (!Array.isArray(items)) return [];

  return items.map((item) => {
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice ?? item.price ?? 0);
    const total = Number(item.total ?? quantity * unitPrice);

    return {
      productName: oneLine(item.productName || item.name || item.product || "—"),
      serial: oneLine(item.serial || item.imei1 || ""),
      sku: oneLine(item.sku || ""),
      barcode: oneLine(item.barcode || ""),
      quantity,
      unitPrice,
      total,
    };
  });
}

function normalizeHeaderDisplay(value) {
  const mode = cleanStr(value || "LOGO_AND_NAME").toUpperCase();

  if (mode === "LOGO_ONLY") return "LOGO_ONLY";
  if (mode === "NAME_ONLY") return "NAME_ONLY";

  return "LOGO_AND_NAME";
}

function normalizeDocumentSizeMode(value) {
  const mode = cleanStr(value || "AUTO").toUpperCase();

  if (mode === "COMPACT") return "COMPACT";
  if (mode === "STANDARD") return "STANDARD";

  return "AUTO";
}

function resolveDocumentSizeMode(tenant = {}, items = []) {
  const mode = normalizeDocumentSizeMode(tenant.documentSizeMode);

  if (mode !== "AUTO") return mode;

  return Array.isArray(items) && items.length <= 3 ? "COMPACT" : "STANDARD";
}

function normalizeTaxMode(value) {
  const mode = cleanStr(value || "NONE").toUpperCase();

  if (
    mode === "NONE" ||
    mode === "VAT_18" ||
    mode === "TURNOVER_3_INTERNAL" ||
    mode === "VAT_18_PLUS_TURNOVER_3" ||
    mode === "CUSTOM"
  ) {
    return mode;
  }

  return "NONE";
}

function normalizeTaxDisplayMode(value) {
  const mode = cleanStr(value || "HIDDEN").toUpperCase();

  if (mode === "HIDDEN" || mode === "CUSTOMER_FACING" || mode === "INTERNAL_ONLY") {
    return mode;
  }

  return "HIDDEN";
}

function defaultTaxRateBps(mode, fallback = 0) {
  if (mode === "VAT_18") return 1800;
  if (mode === "TURNOVER_3_INTERNAL") return 300;
  if (mode === "VAT_18_PLUS_TURNOVER_3") return 2100;

  return Number(fallback || 0);
}

function defaultTaxName(mode, fallback = "") {
  const cleanFallback = oneLine(fallback);
  if (cleanFallback) return cleanFallback;

  if (mode === "VAT_18") return "VAT 18% included";
  if (mode === "TURNOVER_3_INTERNAL") return "Turnover tax estimate 3% included";
  if (mode === "VAT_18_PLUS_TURNOVER_3") return "Tax 21% included";
  if (mode === "CUSTOM") return "Tax included";

  return "";
}

function clampRateBps(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(10000, Math.floor(n)));
}

function resolveTaxSettings(tenant = {}, provided = {}) {
  const taxMode = normalizeTaxMode(provided.taxMode || tenant.taxMode);
  const taxDisplayMode = normalizeTaxDisplayMode(
    provided.taxDisplayMode || tenant.taxDisplayMode,
  );

  const explicitRate = Number(
    provided.taxRateBps ?? tenant.taxRateBps ?? defaultTaxRateBps(taxMode, 0),
  );

  const rateBps = Number.isFinite(explicitRate)
    ? Math.max(0, Math.min(10000, Math.floor(explicitRate)))
    : 0;

  const showTaxOnCustomerDocuments = Boolean(
    provided.showTaxOnCustomerDocuments ?? tenant.showTaxOnCustomerDocuments,
  );

  const customerFacing =
    taxDisplayMode === "CUSTOMER_FACING" &&
    showTaxOnCustomerDocuments &&
    taxMode !== "NONE" &&
    rateBps > 0;

  return {
    taxMode,
    taxDisplayMode,
    taxName: defaultTaxName(taxMode, oneLine(provided.taxName || tenant.taxName)),
    taxRateBps: rateBps,
    pricesIncludeTax: Boolean(provided.pricesIncludeTax ?? tenant.pricesIncludeTax),
    showTaxOnCustomerDocuments,
    customerFacing,
  };
}

function hasStoredSaleTaxSnapshot(provided = {}) {
  return (
    hasOwnValue(provided, "subtotalAmount") ||
    hasOwnValue(provided, "taxableAmount") ||
    hasOwnValue(provided, "taxAmount") ||
    hasOwnValue(provided, "taxMode") ||
    hasOwnValue(provided, "taxDisplayMode") ||
    hasOwnValue(provided, "taxRateBps") ||
    hasOwnValue(provided, "pricesIncludeTax") ||
    hasOwnValue(provided, "showTaxOnCustomerDocuments")
  );
}

function computeTotalsFromSaleSnapshot(items = [], provided = {}, fallbackCurrency = "RWF") {
  const itemSubtotal = items.reduce((sum, item) => sum + Number(item.total || 0), 0);

  const taxMode = normalizeTaxMode(provided.taxMode);
  const taxDisplayMode = normalizeTaxDisplayMode(provided.taxDisplayMode);
  const taxRateBps = clampRateBps(provided.taxRateBps, defaultTaxRateBps(taxMode, 0));
  const taxAmount = toSafeNumber(provided.taxAmount, 0);

  const storedSubtotal = hasOwnValue(provided, "subtotalAmount")
    ? toSafeNumber(provided.subtotalAmount, 0)
    : null;

  const providedSubtotal = hasOwnValue(provided, "subtotal")
    ? toSafeNumber(provided.subtotal, itemSubtotal)
    : null;

  const subtotal =
    storedSubtotal && storedSubtotal > 0
      ? storedSubtotal
      : providedSubtotal && providedSubtotal > 0
        ? providedSubtotal
        : itemSubtotal > 0
          ? itemSubtotal
          : storedSubtotal ?? providedSubtotal ?? 0;

  const taxableSubtotal = hasOwnValue(provided, "taxableAmount")
    ? toSafeNumber(provided.taxableAmount, subtotal)
    : provided.pricesIncludeTax
      ? Math.max(0, subtotal - taxAmount)
      : subtotal;

  const total = hasOwnValue(provided, "total")
    ? toSafeNumber(provided.total, subtotal + taxAmount)
    : provided.pricesIncludeTax
      ? subtotal
      : subtotal + taxAmount;

  const amountPaid = toSafeNumber(provided.amountPaid, 0);

  const balanceDue = hasOwnValue(provided, "balanceDue")
    ? toSafeNumber(provided.balanceDue, Math.max(0, total - amountPaid))
    : Math.max(0, total - amountPaid);

  const showTaxOnCustomerDocuments = Boolean(provided.showTaxOnCustomerDocuments);
  const showTaxLine = taxMode !== "NONE" && taxAmount > 0;

  return {
    currency: oneLine(provided.currency || fallbackCurrency || "RWF"),
    subtotal,
    taxableSubtotal,
    taxAmount,
    taxName: defaultTaxName(taxMode, provided.taxName),
    taxRateBps,
    taxMode,
    taxDisplayMode,
    pricesIncludeTax: Boolean(provided.pricesIncludeTax),
    showTaxOnCustomerDocuments,
    showTaxLine,
    total,
    amountPaid,
    balanceDue,
  };
}

function computeTotals(items = [], provided = {}, fallbackCurrency = "RWF", tenant = {}) {
  if (hasStoredSaleTaxSnapshot(provided)) {
    return computeTotalsFromSaleSnapshot(items, provided, fallbackCurrency);
  }

  const subtotal =
    provided.subtotal != null
      ? Number(provided.subtotal || 0)
      : items.reduce((sum, item) => sum + Number(item.total || 0), 0);

  const taxSettings = resolveTaxSettings(tenant, provided);

  let taxableSubtotal = subtotal;
  let taxAmount = 0;

  if (taxSettings.customerFacing) {
    if (taxSettings.pricesIncludeTax) {
      taxAmount = Math.round(
        (subtotal * taxSettings.taxRateBps) / (10000 + taxSettings.taxRateBps),
      );
      taxableSubtotal = Math.max(0, subtotal - taxAmount);
    } else {
      taxAmount = Math.round((subtotal * taxSettings.taxRateBps) / 10000);
    }
  }

  const computedTotal = taxSettings.customerFacing
    ? taxSettings.pricesIncludeTax
      ? subtotal
      : subtotal + taxAmount
    : subtotal;

  const total = provided.total != null ? Number(provided.total || 0) : computedTotal;
  const amountPaid = Number(provided.amountPaid || 0);

  const balanceDue =
    provided.balanceDue != null
      ? Number(provided.balanceDue || 0)
      : Math.max(0, total - amountPaid);

  return {
    currency: oneLine(provided.currency || fallbackCurrency || "RWF"),
    subtotal,
    taxableSubtotal,
    taxAmount,
    taxName: taxSettings.taxName,
    taxRateBps: taxSettings.taxRateBps,
    taxMode: taxSettings.taxMode,
    taxDisplayMode: taxSettings.taxDisplayMode,
    pricesIncludeTax: taxSettings.pricesIncludeTax,
    showTaxOnCustomerDocuments: taxSettings.showTaxOnCustomerDocuments,
    showTaxLine: Number(taxAmount || 0) > 0 && taxSettings.taxMode !== "NONE",
    total,
    amountPaid,
    balanceDue,
  };
}

function resolveBrandTheme(tenant = {}, overrides = {}) {
  const primary = normalizeHexColor(
    overrides.primaryColor || tenant.documentPrimaryColor || tenant.brandColor,
    "#1a56db",
  );

  return {
    primary,
    primarySoft: rgba(primary, 0.08),
    primaryBorder: rgba(primary, 0.25),
    primaryDeep: rgba(primary, 0.96),
    ink: "#0f172a",
    inkSoft: "#334155",
    muted: "#64748b",
    line: "#e2e8f0",
    soft: "#f8fafc",
    softAlt: "#f1f5f9",
    green: "#059669",
    greenBg: "#d1fae5",
    amber: "#d97706",
    amberBg: "#fef3c7",
    danger: "#dc2626",
    dangerBg: "#fee2e2",
  };
}

function logoHtml(tenant, theme) {
  const logoUrl = tenant?.logoSignedUrl || tenant?.logoUrl;

  if (logoUrl) {
    return `
      <div class="logoFrame">
        <img class="logo" src="${esc(logoUrl)}" alt="Business logo" />
      </div>`;
  }

  const letter = cleanStr(tenant?.name || "S").charAt(0).toUpperCase() || "S";

  return `<div class="logoFallback" style="background:${theme.primary}">${esc(letter)}</div>`;
}

function renderBrandContactLines(tenant) {
  const lines = [];

  if (tenant?.receiptHeader) lines.push(tenant.receiptHeader);
  if (tenant?.address) lines.push(tenant.address);
  if (tenant?.phone) lines.push(`Tel: ${tenant.phone}`);
  if (tenant?.email) lines.push(`Email: ${tenant.email}`);
  if (tenant?.tin) lines.push(`TIN: ${tenant.tin}`);

  return lines.map((line) => `<div>${esc(oneLine(line))}</div>`).join("");
}

function renderBrandIdentity(tenant, theme) {
  const display = normalizeHeaderDisplay(tenant?.documentHeaderDisplay);
  const hasLogo = Boolean(tenant?.logoSignedUrl || tenant?.logoUrl);

  if (display === "LOGO_ONLY" && hasLogo) {
    return `
      <div class="brandBlock brandBlockLogoOnly">
        ${logoHtml(tenant, theme)}
      </div>`;
  }

  if (display === "NAME_ONLY") {
    return `
      <div class="brandBlock">
        <div>
          <div class="brandName">${esc(oneLine(tenant?.name || "Business"))}</div>
          <div class="brandSub">
            ${renderBrandContactLines(tenant)}
          </div>
        </div>
      </div>`;
  }

  return `
    <div class="brandBlock">
      ${logoHtml(tenant, theme)}
      <div>
        <div class="brandName">${esc(oneLine(tenant?.name || "Business"))}</div>
        <div class="brandSub">
          ${renderBrandContactLines(tenant)}
        </div>
      </div>
    </div>`;
}

function badgeHtml(status, theme) {
  if (!status) return "";

  const value = String(status).toUpperCase();
  let bg;
  let color;
  let border;

  if (["PAID", "COMPLETED", "ACTIVE", "DELIVERED", "SENT", "CONVERTED"].includes(value)) {
    bg = "#d1fae5";
    color = "#065f46";
    border = "#6ee7b7";
  } else if (
    ["PARTIAL", "PARTIALLY PAID", "DRAFT", "PENDING", "PROFORMA", "INVOICE"].includes(value)
  ) {
    bg = "#fef3c7";
    color = "#92400e";
    border = "#fcd34d";
  } else if (["OVERDUE", "EXPIRED", "CANCELLED", "RETURNED"].includes(value)) {
    bg = "#fee2e2";
    color = "#991b1b";
    border = "#fca5a5";
  } else if (value === "WARRANTY" || value === "DELIVERY") {
    bg = theme.primarySoft;
    color = theme.primary;
    border = theme.primaryBorder;
  } else {
    bg = theme.primarySoft;
    color = theme.primary;
    border = theme.primaryBorder;
  }

  return `<span class="badge" style="background:${bg};color:${color};border-color:${border}">${esc(status)}</span>`;
}

function buildStyles(theme) {
  return `
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  html, body {
    background: #eef2f7;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: ${theme.ink};
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .wrap { padding: 28px 20px 40px; }

  .actions {
    width: 210mm;
    margin: 0 auto 14px;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .actBtn {
    height: 36px;
    padding: 0 16px;
    border-radius: 10px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    border: 1px solid ${theme.line};
    background: #fff;
    color: ${theme.ink};
  }

  .actBtn.primary {
    background: ${theme.primary};
    border-color: ${theme.primary};
    color: #fff;
  }

  .page {
    width: 210mm;
    margin: 0 auto;
    background: #fff;
    border-radius: 20px;
    box-shadow: 0 20px 60px rgba(15,23,42,0.14);
    overflow: hidden;
    position: relative;
  }

  .pageInner { padding: 40px 44px 52px; }

  .header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    padding-bottom: 24px;
    border-bottom: 3px solid ${theme.primary};
    margin-bottom: 28px;
  }

  .brandBlock {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    min-width: 0;
    max-width: 56%;
  }

  .brandBlockLogoOnly { max-width: 44%; }

  .logoFrame {
    width: 64px;
    height: 64px;
    flex-shrink: 0;
    border-radius: 14px;
    border: 1px solid ${theme.line};
    background: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    padding: 6px;
  }

  .logo {
    display: block;
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    object-fit: contain;
    object-position: center;
  }

  .logoFallback {
    width: 64px;
    height: 64px;
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: 22px;
    font-weight: 900;
    flex-shrink: 0;
  }

  .brandName {
    font-size: 26px;
    font-weight: 900;
    letter-spacing: -0.5px;
    color: ${theme.primary};
    line-height: 1.1;
    overflow-wrap: anywhere;
  }

  .brandSub {
    margin-top: 5px;
    font-size: 12px;
    color: ${theme.muted};
    line-height: 1.5;
  }

  .brandSub div { margin-top: 1px; }

  .docBlock {
    text-align: right;
    flex-shrink: 0;
    max-width: 40%;
  }

  .docType {
    font-size: 38px;
    font-weight: 950;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: ${theme.ink};
    line-height: 1;
    white-space: nowrap;
  }

  .docNum {
    margin-top: 8px;
    font-size: 14px;
    font-weight: 700;
    color: ${theme.primary};
    overflow-wrap: anywhere;
  }

  .docMeta {
    margin-top: 4px;
    font-size: 12px;
    color: ${theme.muted};
    line-height: 1.7;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    padding: 3px 10px;
    border-radius: 999px;
    border: 1px solid;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    margin-top: 6px;
  }

  .infoStrip {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0;
    border: 1px solid ${theme.line};
    border-radius: 12px;
    overflow: hidden;
    margin-bottom: 28px;
  }

  .infoCol {
    padding: 16px 18px;
    border-right: 1px solid ${theme.line};
    min-width: 0;
  }

  .infoCol:last-child { border-right: none; }

  .infoLabel {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: ${theme.muted};
    margin-bottom: 8px;
  }

  .infoName {
    font-size: 15px;
    font-weight: 800;
    color: ${theme.ink};
    margin-bottom: 7px;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  .infoLine {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
    padding: 4px 0;
    font-size: 12.5px;
    color: ${theme.inkSoft};
    line-height: 1.45;
  }

  .infoKey {
    display: block;
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #94a3b8;
    white-space: nowrap;
  }

  .infoValue {
    display: block;
    font-weight: 700;
    color: ${theme.inkSoft};
    overflow-wrap: break-word;
  }

  .tableWrap {
    border: 1px solid ${theme.line};
    border-radius: 12px;
    overflow: hidden;
    margin-bottom: 24px;
    flex: 1;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  thead th {
    background: ${theme.softAlt};
    padding: 10px 14px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: ${theme.inkSoft};
    text-align: left;
    border-bottom: 1px solid ${theme.line};
  }

  th.r, td.r { text-align: right; }
  th.c, td.c { text-align: center; }

  tbody td {
    padding: 13px 14px;
    font-size: 13px;
    color: ${theme.ink};
    border-bottom: 1px solid ${theme.line};
    vertical-align: top;
  }

  tbody tr:last-child td { border-bottom: none; }
  tbody tr:nth-child(even) { background: ${theme.soft}; }

  .iNum {
    color: ${theme.muted};
    font-size: 12px;
  }

  .iName {
    font-weight: 700;
    color: ${theme.ink};
  }

  .iMeta {
    margin-top: 3px;
    font-size: 11px;
    color: ${theme.muted};
    line-height: 1.5;
  }

  .iAmt { font-weight: 800; }

  .emptyRow td {
    padding: 28px 14px;
    text-align: center;
    color: ${theme.muted};
    font-size: 13px;
  }

  .totalsSection {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 28px;
  }

  .totalsBox {
    width: 430px;
    max-width: 100%;
  }

  .totalsRow {
    display: grid;
    grid-template-columns: minmax(0, 1fr) max-content;
    align-items: center;
    column-gap: 18px;
    padding: 7px 0;
    font-size: 13px;
    border-bottom: 1px solid ${theme.line};
  }

  .totalsRow:last-child { border-bottom: none; }

  .totalsBox > .totalsRow:nth-last-child(2) {
    border-bottom: none;
  }

  .totalsKey {
    color: ${theme.muted};
    white-space: nowrap;
    overflow: visible;
    text-overflow: clip;
  }

  .totalsVal {
    font-weight: 800;
    color: ${theme.ink};
    text-align: right;
    white-space: nowrap;
  }

  .totalsValGreen {
    font-weight: 800;
    color: ${theme.green};
    text-align: right;
    white-space: nowrap;
  }

  .totalsBalance {
    display: grid;
    grid-template-columns: minmax(0, 1fr) max-content;
    align-items: center;
    column-gap: 18px;
    padding: 11px 0 4px;
    border-top: 2px solid ${theme.line};
    margin-top: 4px;
  }

  .totalsBalanceKey {
    font-size: 16px;
    font-weight: 900;
    color: ${theme.amber};
    letter-spacing: -0.2px;
    white-space: nowrap;
  }

  .totalsBalanceVal {
    font-size: 20px;
    font-weight: 900;
    color: ${theme.amber};
    letter-spacing: -0.5px;
    text-align: right;
    white-space: nowrap;
    word-spacing: 2px;
  }

  .footerArea {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 24px;
    margin-top: 28px;
    padding-top: 24px;
    border-top: 1px solid ${theme.line};
  }

  .footerArea.noFooterSignature {
    display: block;
  }

  .termsBlock { max-width: 52%; }

  .footerArea.noFooterSignature .termsBlock {
    max-width: 100%;
  }

  .termsTitle {
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: ${theme.muted};
    margin-bottom: 7px;
  }

  .termsText {
    font-size: 12px;
    color: ${theme.inkSoft};
    line-height: 1.7;
    white-space: pre-wrap;
  }

  .sigBlock {
    text-align: right;
    flex-shrink: 0;
  }

  .sigLine {
    width: 140px;
    height: 1px;
    background: ${theme.line};
    margin: 36px 0 8px auto;
  }

  .sigLabel {
    font-size: 11px;
    color: ${theme.muted};
    font-weight: 600;
  }

  .sigName {
    font-size: 13px;
    font-weight: 800;
    color: ${theme.primary};
    margin-top: 3px;
  }

  .sigRow {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-top: 24px;
    padding-top: 24px;
    border-top: 1px solid ${theme.line};
  }

  .sigCard {
    border: 1px solid ${theme.line};
    border-radius: 12px;
    padding: 14px 16px;
  }

  .sigCardLabel {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: ${theme.muted};
    margin-bottom: 32px;
  }

  .sigCardLine {
    height: 1px;
    background: ${theme.line};
    margin-bottom: 8px;
  }

  .sigCardMeta {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: ${theme.muted};
  }

  .compactPage .pageInner { padding: 30px 38px 38px; }

  .compactPage .header {
    padding-bottom: 18px;
    margin-bottom: 20px;
  }

  .compactPage .logoFrame,
  .compactPage .logoFallback {
    width: 54px;
    height: 54px;
    border-radius: 12px;
  }

  .compactPage .brandBlockLogoOnly .logoFrame {
    width: 76px;
    height: 76px;
    border-radius: 16px;
  }

  .compactPage .brandName { font-size: 23px; }
  .compactPage .brandSub { font-size: 11.5px; }
  .compactPage .docType { font-size: 32px; }
  .compactPage .infoStrip { margin-bottom: 20px; }
  .compactPage .infoCol { padding: 13px 15px; }
  .compactPage tbody td { padding: 10px 12px; }
  .compactPage thead th { padding: 9px 12px; }
  .compactPage .tableWrap { margin-bottom: 18px; }
  .compactPage .totalsSection { margin-bottom: 18px; }
  .compactPage .footerArea {
    margin-top: 18px;
    padding-top: 18px;
  }

  .brandBlockLogoOnly .logoFrame {
    width: 92px;
    height: 92px;
    border-radius: 18px;
  }

  .brandBlockLogoOnly .logo {
    max-width: 100%;
    max-height: 100%;
  }

  @media screen and (max-width: 750px) {
    .wrap { padding: 12px 8px 24px; }
    .actions, .page { width: 100%; }
    .pageInner { padding: 24px 20px 36px; }
    .header { flex-direction: column; gap: 16px; }
    .brandBlock, .docBlock { max-width: 100%; }
    .docBlock { text-align: left; }
    .infoStrip { grid-template-columns: 1fr; }
    .infoCol { border-right: none; border-bottom: 1px solid ${theme.line}; }
    .infoCol:last-child { border-bottom: none; }
    .totalsBox { width: 100%; }
    .footerArea { flex-direction: column; }
    .termsBlock { max-width: 100%; }
    .sigBlock { text-align: left; }
    .sigLine { margin-left: 0; }
    .sigRow { grid-template-columns: 1fr; }
    .docType { font-size: 26px; }
  }

  @page {
    size: A4 portrait;
    margin: 12mm 14mm;
  }

  @media print {
    html, body { background: #fff !important; }
    .actions { display: none !important; }
    .wrap { padding: 0 !important; }
    .page {
      width: 100% !important;
      border-radius: 0 !important;
      box-shadow: none !important;
    }
    .pageInner { padding: 0 !important; }
    tbody tr { page-break-inside: avoid; }
    .footerArea { page-break-inside: avoid; }
    .sigRow { page-break-inside: avoid; }
    .totalsSection { page-break-inside: avoid; }
    .header { page-break-inside: avoid; }
  }
</style>`;
}

function renderActions(title) {
  return `
  <div class="actions">
    <button class="actBtn" onclick="window.history.back()">Back</button>
    <button class="actBtn primary" onclick="window.print()">Print ${esc(title)}</button>
  </div>`;
}

function getDocNumber(document = {}) {
  return oneLine(
    document.number ||
      document.invoiceNumber ||
      document.receiptNumber ||
      document.proformaNumber ||
      document.deliveryNoteNumber ||
      document.warrantyNumber ||
      "—",
  );
}

function renderHeader({ tenant, document, title, extra, theme }) {
  const number = getDocNumber(document);
  const status = extra?.status || extra?.badgeText || null;

  return `
  <div class="header">
    ${renderBrandIdentity(tenant, theme)}

    <div class="docBlock">
      <div class="docType">${esc(title)}</div>
      <div class="docNum"># ${esc(number)}</div>
      <div class="docMeta">
        <div>Date: ${esc(fmtDate(document.date || document.createdAt))}</div>
        ${extra?.dueDate ? `<div>Due: ${esc(fmtDate(extra.dueDate))}</div>` : ""}
      </div>
      ${status ? badgeHtml(status, theme) : ""}
    </div>
  </div>`;
}

function renderInfoStrip({ customer, extra }) {
  const col1Label = extra?.customerTitle || "Billed To";
  const col2Label = extra?.col2Label || "Details";
  const col3Label = extra?.col3Label || "Issued By";

  const col2Lines = normalizeInfoRows(extra?.col2Lines || extra?.rightRows || []);
  const col3Lines = normalizeInfoRows(extra?.col3Lines || []);

  return `
  <div class="infoStrip">
    <div class="infoCol">
      <div class="infoLabel">${esc(col1Label)}</div>
      <div class="infoName">${esc(oneLine(customer?.name || "Walk-in Customer"))}</div>
      ${customer?.phone ? `<div class="infoLine"><span class="infoValue">${esc(oneLine(customer.phone))}</span></div>` : ""}
      ${customer?.email ? `<div class="infoLine"><span class="infoValue">${esc(oneLine(customer.email))}</span></div>` : ""}
      ${customer?.address ? `<div class="infoLine"><span class="infoValue">${esc(oneLine(customer.address))}</span></div>` : ""}
      ${customer?.tin ? `<div class="infoLine"><span class="infoKey">TIN</span><span class="infoValue">${esc(oneLine(customer.tin))}</span></div>` : ""}
    </div>

    <div class="infoCol">
      <div class="infoLabel">${esc(col2Label)}</div>
      ${col2Lines
        .map(
          ([key, value]) =>
            `<div class="infoLine"><span class="infoKey">${esc(key)}</span><span class="infoValue">${esc(String(value))}</span></div>`,
        )
        .join("")}
    </div>

    <div class="infoCol">
      <div class="infoLabel">${esc(col3Label)}</div>
      ${col3Lines
        .map(
          ([key, value]) =>
            `<div class="infoLine"><span class="infoKey">${esc(key)}</span><span class="infoValue">${esc(String(value))}</span></div>`,
        )
        .join("")}
    </div>
  </div>`;
}

function renderItemMeta(item) {
  const parts = [];

  if (item.serial) parts.push(`<div>Serial: ${esc(item.serial)}</div>`);
  if (item.sku) parts.push(`<div>SKU: ${esc(item.sku)}</div>`);
  if (item.barcode) parts.push(`<div>Barcode: ${esc(item.barcode)}</div>`);

  if (!parts.length) return "";

  return `<div class="iMeta">${parts.join("")}</div>`;
}

function renderNonPriceDetails(item) {
  if (item.sku) return `SKU: ${item.sku}`;
  if (item.barcode) return `Barcode: ${item.barcode}`;
  if (item.serial) return "Serial recorded";

  return "Recorded";
}

function renderTable({ items, totals, showPrices }) {
  const head = showPrices
    ? `<th class="c">#</th><th>Product</th><th>SKU</th><th class="c">Qty</th><th class="r">Unit Price</th><th class="r">Subtotal</th>`
    : `<th class="c">#</th><th>Product</th><th>Details</th><th class="c">Qty</th>`;

  const rows = items.length
    ? items
        .map((item, index) => {
          if (showPrices) {
            return `
      <tr>
        <td class="c iNum">${index + 1}</td>
        <td>
          <div class="iName">${esc(item.productName || "—")}</div>
          ${renderItemMeta(item)}
        </td>
        <td class="iMeta">${esc(item.sku || item.barcode || "—")}</td>
        <td class="c">${esc(String(item.quantity))}</td>
        <td class="r">${esc(money(item.unitPrice, totals.currency).replace(/^RWF\s/, ""))}</td>
        <td class="r iAmt">${esc(money(item.total, totals.currency).replace(/^RWF\s/, ""))}</td>
      </tr>`;
          }

          return `
      <tr>
        <td class="c iNum">${index + 1}</td>
        <td>
          <div class="iName">${esc(item.productName || "—")}</div>
          ${renderItemMeta(item)}
        </td>
        <td class="iMeta">${esc(renderNonPriceDetails(item))}</td>
        <td class="c">${esc(String(item.quantity))}</td>
      </tr>`;
        })
        .join("")
    : `<tr class="emptyRow"><td colspan="${showPrices ? 6 : 4}">No items</td></tr>`;

  return `
  <div class="tableWrap">
    <table>
      <thead><tr>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function renderTotals({ totals, showPrices, showPaymentSummary }) {
  if (!showPrices) {
    return `
    <div class="totalsSection">
      <div class="totalsBox">
        <div class="totalsBalance">
          <span class="totalsBalanceKey">${esc(totals._itemCountLabel || "Items")}</span>
          <span class="totalsBalanceVal">${esc(String(totals._itemCount || 0))}</span>
        </div>
      </div>
    </div>`;
  }

  const paid = Number(totals.amountPaid || 0);

  return `
  <div class="totalsSection">
    <div class="totalsBox">
      ${
        totals.showTaxLine && totals.pricesIncludeTax
          ? `
      <div class="totalsRow">
        <span class="totalsKey">Subtotal before tax</span>
        <span class="totalsVal">${esc(money(totals.taxableSubtotal, totals.currency))}</span>
      </div>
      <div class="totalsRow">
        <span class="totalsKey">${esc(totals.taxName || "Tax included")}</span>
        <span class="totalsVal">${esc(money(totals.taxAmount, totals.currency))}</span>
      </div>
      <div class="totalsRow">
        <span class="totalsKey">Subtotal</span>
        <span class="totalsVal">${esc(money(totals.subtotal, totals.currency))}</span>
      </div>`
          : `
      <div class="totalsRow">
        <span class="totalsKey">Subtotal</span>
        <span class="totalsVal">${esc(money(totals.subtotal, totals.currency))}</span>
      </div>
      ${
        totals.showTaxLine
          ? `
      <div class="totalsRow">
        <span class="totalsKey">${esc(totals.taxName || "Tax")}</span>
        <span class="totalsVal">${esc(money(totals.taxAmount, totals.currency))}</span>
      </div>`
          : ""
      }`
      }

      ${
        showPaymentSummary && paid > 0
          ? `
      <div class="totalsRow">
        <span class="totalsKey">Amount Paid</span>
        <span class="totalsValGreen">${esc(money(paid, totals.currency))}</span>
      </div>`
          : ""
      }

      <div class="totalsBalance">
        <span class="totalsBalanceKey">Total</span>
        <span class="totalsBalanceVal">${esc(money(totals.total, totals.currency))}</span>
      </div>
    </div>
  </div>`;
}

function renderFooter({ tenant, extra }) {
  const terms = cleanStr(
    extra?.notes ||
      extra?.terms ||
      tenant?.receiptFooter ||
      "Thank you for your business.\nKeep this document for your records.",
  );

  const hideFooterSignature = Boolean(extra?.hideFooterSignature);

  return `
  <div class="footerArea${hideFooterSignature ? " noFooterSignature" : ""}">
    <div class="termsBlock">
      <div class="termsTitle">Terms &amp; Conditions</div>
      <div class="termsText">${esc(terms)}</div>
    </div>

    ${
      hideFooterSignature
        ? ""
        : `
    <div class="sigBlock">
      <div class="sigLine"></div>
      <div class="sigLabel">Authorized Signature</div>
      <div class="sigName">${esc(oneLine(tenant?.name || "Business"))}</div>
    </div>`
    }
  </div>`;
}

function renderSigRow({ extra }) {
  const left = oneLine(extra?.preparedBy || extra?.cashier || extra?.deliveredBy || extra?.issuedBy || "Staff");
  const right = oneLine(extra?.approvedBy || extra?.receivedBy || "Authorised Signature");

  return `
  <div class="sigRow">
    <div class="sigCard">
      <div class="sigCardLabel">Prepared By</div>
      <div class="sigCardLine"></div>
      <div class="sigCardMeta"><span>${esc(left)}</span></div>
    </div>

    <div class="sigCard">
      <div class="sigCardLabel">Authorised Sign</div>
      <div class="sigCardLine"></div>
      <div class="sigCardMeta"><span>${esc(right)}</span></div>
    </div>
  </div>`;
}

function buildPage({
  title,
  tenant = {},
  document = {},
  customer = {},
  items = [],
  totals = {},
  extra = {},
  badgeText,
  showPrices = true,
  showPaymentSummary = true,
  showSignature = false,
  theme: themeOverride,
}) {
  const normalizedItems = normalizeItems(items);

  const normalizedTotals = computeTotals(
    normalizedItems,
    totals,
    extra?.currency || "RWF",
    tenant,
  );

  normalizedTotals._itemCount = normalizedItems.length;
  normalizedTotals._itemCountLabel = totals._itemCountLabel || extra.itemCountLabel || "Items";

  const theme = resolveBrandTheme(tenant, themeOverride || {});
  const sizeMode = resolveDocumentSizeMode(tenant, normalizedItems);
  const pageClass = sizeMode === "COMPACT" ? "page compactPage" : "page";

  const effectiveExtra = {
  ...extra,
  status: badgeText || extra?.status || null,
  hideFooterSignature: Boolean(extra?.hideFooterSignature || showSignature),
};

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${esc(title)} ${esc(getDocNumber(document))}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" />
  ${buildStyles(theme)}
</head>
<body>
<div class="wrap">
  ${renderActions(title)}
  <div class="${pageClass}">
    <div class="pageInner">
      ${renderHeader({ tenant, document, title, extra: effectiveExtra, theme })}
      ${renderInfoStrip({ customer, extra: effectiveExtra })}
      ${renderTable({ items: normalizedItems, totals: normalizedTotals, showPrices })}
      ${renderTotals({ totals: normalizedTotals, showPrices, showPaymentSummary, theme })}
      ${showSignature ? renderSigRow({ extra: effectiveExtra }) : ""}
      ${renderFooter({ tenant, extra: effectiveExtra, theme })}
    </div>
  </div>
</div>
</body>
</html>`;
}

function renderReceiptHtml(payload) {
  const saleType = oneLine(payload.extra?.saleType || "CASH");
  const status = oneLine(payload.extra?.status || "PAID");
  const cashier = oneLine(payload.extra?.cashier || "—");
  const paid = Number(payload.totals?.amountPaid || 0);
  const balance = Number(payload.totals?.balanceDue || 0);
  const sellingLocation = getLocationName({
    ...payload.tenant,
    ...payload.extra,
  });

  return buildPage({
    title: "Receipt",
    tenant: payload.tenant,
    document: payload.document,
    customer: payload.customer,
    items: payload.items,
    totals: payload.totals,
    badgeText: status,
    showPrices: true,
    showPaymentSummary: true,
    showSignature: false,
    theme: payload.theme || { primaryColor: payload.tenant?.documentPrimaryColor },
    extra: {
      currency: payload.totals?.currency,
      col2Label: "Payment",
      col2Lines: [
        ["Type", saleType],
        ["Paid", money(paid, payload.totals?.currency || "RWF")],
        ["Balance", money(balance, payload.totals?.currency || "RWF")],
      ],
      col3Label: "Issued By",
      col3Lines: [
        ["Cashier", cashier],
        [getLocationLabel(payload.extra), sellingLocation || "—"],
      ],
      notes: payload.extra?.notes || payload.tenant?.receiptFooter || "Keep this receipt for your records.",
    },
  });
}

function renderInvoiceHtml(payload) {
  const status = oneLine(payload.extra?.status || "INVOICE");
  const cashier = oneLine(payload.extra?.cashier || "—");
  const paid = Number(payload.totals?.amountPaid || 0);
  const balance = Number(payload.totals?.balanceDue || 0);
  const saleRef = oneLine(payload.extra?.saleRef || "—");
  const sellingLocation = getLocationName({
    ...payload.tenant,
    ...payload.extra,
  });

  return buildPage({
    title: "Invoice",
    tenant: payload.tenant,
    document: payload.document,
    customer: payload.customer,
    items: payload.items,
    totals: payload.totals,
    badgeText: status,
    showPrices: true,
    showPaymentSummary: true,
    showSignature: true,
    theme: payload.theme || { primaryColor: payload.tenant?.documentPrimaryColor },
    extra: {
      currency: payload.totals?.currency,
      dueDate: payload.extra?.dueDate,
      col2Label: "Payment",
      col2Lines: [
        ["Sale Type", oneLine(payload.extra?.saleType || "CREDIT")],
        ["Paid", money(paid, payload.totals?.currency || "RWF")],
        ["Balance", money(balance, payload.totals?.currency || "RWF")],
      ],
      col3Label: "Issued By",
      col3Lines: [
        ["Cashier", cashier],
        ["Reference", saleRef],
        [getLocationLabel(payload.extra), sellingLocation || "—"],
      ],
      notes:
        payload.extra?.invoiceTerms ||
        payload.tenant?.invoiceTerms ||
        payload.extra?.notes ||
        "Invoice terms apply. Payment is due by the date stated above.",
      preparedBy: cashier,
      approvedBy: payload.tenant?.name || "Authorized Signature",
    },
  });
}

function renderProformaHtml(payload) {
  const preparedBy = oneLine(payload.extra?.preparedBy || payload.extra?.cashier || "—");
  const validUntil = payload.extra?.validUntil ? fmtDate(payload.extra.validUntil) : "—";
  const reference = oneLine(payload.extra?.reference || "—");
  const sellingLocation = getLocationName({
    ...payload.tenant,
    ...payload.extra,
  });

  return buildPage({
    title: "Proforma",
    tenant: payload.tenant,
    document: payload.document,
    customer: payload.customer,
    items: payload.items,
    totals: payload.totals,
    badgeText: "PROFORMA",
    showPrices: true,
    showPaymentSummary: false,
    showSignature: true,
    theme: payload.theme || { primaryColor: payload.tenant?.documentPrimaryColor },
    extra: {
      currency: payload.totals?.currency,
      col2Label: "Quotation Details",
      col2Lines: [
        ["Validity", validUntil],
        ["Reference", reference],
      ],
      col3Label: "Prepared By",
      col3Lines: [
        ["Staff", preparedBy],
        [getLocationLabel(payload.extra), sellingLocation || "—"],
      ],
      notes:
        payload.extra?.notes ||
        payload.tenant?.proformaTerms ||
        "This proforma is not a final invoice and does not confirm payment.",
      preparedBy,
      approvedBy: "Authorised Signature",
    },
  });
}

function renderDeliveryNoteHtml(payload) {
  const deliveredBy = cleanStr(payload.extra?.deliveredBy || "—");
  const receivedBy = cleanStr(payload.extra?.receivedBy || "—");
  const receivedByPhone = cleanStr(payload.extra?.receivedByPhone || "—");
  const badgeText = cleanStr(payload.extra?.badgeText || "DELIVERY");
  const sellingLocation = getLocationName({
    ...payload.tenant,
    ...payload.extra,
  });

  return buildPage({
    title: "Delivery Note",
    tenant: payload.tenant,
    document: payload.document,
    customer: payload.customer,
    items: payload.items,
    totals: {
      ...(payload.totals || {}),
      _itemCount: Array.isArray(payload.items) ? payload.items.length : 0,
      _itemCountLabel: "Delivered items",
    },
    badgeText,
    showPrices: false,
    showPaymentSummary: false,
    showSignature: true,
    theme: payload.theme || { primaryColor: payload.tenant?.documentPrimaryColor },
    extra: {
      customerTitle: "Delivered To",
      col2Label: "Delivery details",
      col2Lines: [
        ["Delivered By", deliveredBy],
        ["Received By", receivedBy],
        ["Receiver Phone", receivedByPhone],
      ],
      col3Label: "Store details",
      col3Lines: [
        ["Store location", sellingLocation || "—"],
        ["Date", fmtDate(payload.document?.date || payload.document?.createdAt)],
      ],
      notes:
        payload.extra?.notes ||
        payload.tenant?.deliveryNoteTerms ||
        "Please confirm that all delivered items were received in good condition.",
      preparedBy: deliveredBy,
      approvedBy: receivedBy || "Receiver Signature",
      itemCountLabel: "Delivered items",
      hideFooterSignature: true,
    },
  });
}

function renderWarrantyHtml(payload) {
  const issuedBy = oneLine(payload.extra?.issuedBy || payload.extra?.cashier || "—");
  const startDate = payload.extra?.startDate ? fmtDate(payload.extra.startDate) : "—";
  const endDate = payload.extra?.endDate ? fmtDate(payload.extra.endDate) : "—";
  const sellingLocation = getLocationName({
    ...payload.tenant,
    ...payload.extra,
  });

  return buildPage({
    title: "Warranty",
    tenant: payload.tenant,
    document: payload.document,
    customer: payload.customer,
    items: payload.items,
    totals: {
      ...(payload.totals || {}),
      _itemCount: Array.isArray(payload.items) ? payload.items.length : 0,
      _itemCountLabel: "Items covered",
    },
    badgeText: "WARRANTY",
    showPrices: false,
    showPaymentSummary: false,
    showSignature: true,
    theme: payload.theme || { primaryColor: payload.tenant?.documentPrimaryColor },
    extra: {
      customerTitle: "Issued To",
      col2Label: "Coverage Period",
      col2Lines: [
        ["Start Date", startDate],
        ["End Date", endDate],
      ],
      col3Label: "Issued By",
      col3Lines: [
        ["Staff", issuedBy],
        [getLocationLabel(payload.extra), sellingLocation || "—"],
      ],
      notes:
        payload.extra?.warrantyTerms ||
        payload.tenant?.warrantyTerms ||
        payload.extra?.notes ||
        "Warranty is void if the product is physically damaged or tampered with.",
      preparedBy: issuedBy,
      approvedBy: payload.customer?.name || "Customer Signature",
      itemCountLabel: "Items covered",
      hideFooterSignature: true,
    },
  });
}

module.exports = {
  esc,
  cleanString: cleanStr,
  normalizeHexColor,
  hexToRgb,
  rgba,
  money,
  fmtDate,
  fmtDateLong,
  fmtDateTime,
  normalizeItems,
  computeTotals,
  resolveBrandTheme,
  logoHtml,
  commonStyles: (theme) => buildStyles(resolveBrandTheme({}, { primaryColor: theme?.primary })),
  buildPage,
  renderReceiptHtml,
  renderInvoiceHtml,
  renderProformaHtml,
  renderDeliveryNoteHtml,
  renderWarrantyHtml,
};

