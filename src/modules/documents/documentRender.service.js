"use strict";

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cleanString(x) {
  const s = String(x ?? "").trim();
  return s || "";
}

function normalizeHexColor(input, fallback = "#0F4C81") {
  const value = cleanString(input);
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

function hexToRgb(hex, fallback = { r: 15, g: 76, b: 129 }) {
  const safe = normalizeHexColor(hex, "#0F4C81");
  const match = safe.match(/^#([0-9a-fA-F]{6})$/);
  if (!match) return fallback;

  const value = match[1];
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function rgba(hex, alpha = 1) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function money(n, currency = "RWF") {
  const value = Number(n || 0);
  return `${currency} ${value.toLocaleString()}`;
}

function fmtDate(d) {
  if (!d) return "—";

  try {
    return new Date(d).toLocaleDateString("en-GB", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return "—";
  }
}

function fmtDateLong(d) {
  if (!d) return "—";

  try {
    return new Date(d).toLocaleDateString("en-GB", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch {
    return "—";
  }
}

function fmtDateTime(d) {
  if (!d) return "—";

  try {
    return new Date(d).toLocaleString("en-GB");
  } catch {
    return "—";
  }
}

function normalizeItems(items = []) {
  if (!Array.isArray(items)) return [];

  return items.map((it) => {
    const quantity = Number(it.quantity || 0);
    const unitPrice = Number(it.unitPrice ?? it.price ?? 0);
    const total = Number(it.total ?? quantity * unitPrice);

    return {
      productName: cleanString(it.productName || it.name || it.product || "—"),
      serial: cleanString(it.serial || it.imei1 || ""),
      sku: cleanString(it.sku || ""),
      barcode: cleanString(it.barcode || ""),
      quantity,
      unitPrice,
      total,
    };
  });
}

function computeTotals(items = [], providedTotals = {}, fallbackCurrency = "RWF") {
  const subtotal =
    providedTotals.subtotal != null
      ? Number(providedTotals.subtotal || 0)
      : items.reduce((sum, it) => sum + Number(it.total || 0), 0);

  const total =
    providedTotals.total != null ? Number(providedTotals.total || 0) : subtotal;

  const amountPaid = Number(providedTotals.amountPaid || 0);

  const balanceDue =
    providedTotals.balanceDue != null
      ? Number(providedTotals.balanceDue || 0)
      : Math.max(0, total - amountPaid);

  return {
    currency: cleanString(providedTotals.currency || fallbackCurrency || "RWF"),
    subtotal,
    total,
    amountPaid,
    balanceDue,
  };
}

function resolveBrandTheme(tenant = {}, overrides = {}) {
  const primary = normalizeHexColor(
    overrides.primaryColor ||
      tenant.documentPrimaryColor ||
      tenant.brandColor ||
      "#0F4C81",
    "#0F4C81"
  );

  const accent = normalizeHexColor(
    overrides.accentColor ||
      tenant.documentAccentColor ||
      "#E8EEF5",
    "#E8EEF5"
  );

  return {
    primary,
    accent,
    ink: "#0F172A",
    inkSoft: "#334155",
    muted: "#64748B",
    line: "#D9E3EF",
    lineStrong: "#C9D5E4",
    soft: "#F8FAFC",
    softAlt: "#F1F5F9",
    pageBg: "#FFFFFF",

    primarySoft: rgba(primary, 0.08),
    primaryBorder: rgba(primary, 0.22),
    primaryDeep: rgba(primary, 0.96),
    primaryMuted: rgba(primary, 0.16),

    accentSoft: rgba(accent, 0.72),
    accentStrong: rgba(accent, 0.96),

    heroGlow: rgba(primary, 0.20),
    shadow: "0 26px 80px rgba(15, 23, 42, 0.16)",
  };
}

function logoHtml(tenant) {
  if (tenant?.logoSignedUrl) {
    return `<img class="logoImg" src="${esc(tenant.logoSignedUrl)}" alt="Logo" />`;
  }

  if (tenant?.logoUrl) {
    return `<img class="logoImg" src="${esc(tenant.logoUrl)}" alt="Logo" />`;
  }

  const letter = cleanString(tenant?.name || "S").charAt(0).toUpperCase() || "S";
  return `<div class="logoFallback">${esc(letter)}</div>`;
}

function commonStyles(theme = resolveBrandTheme()) {
  return `
<style>
:root{
  --ink:${theme.ink};
  --ink-soft:${theme.inkSoft};
  --muted:${theme.muted};
  --line:${theme.line};
  --line-strong:${theme.lineStrong};
  --soft:${theme.soft};
  --soft-alt:${theme.softAlt};
  --page-bg:${theme.pageBg};

  --brand:${theme.primary};
  --brand-deep:${theme.primaryDeep};
  --brand-soft:${theme.primarySoft};
  --brand-muted:${theme.primaryMuted};
  --brand-border:${theme.primaryBorder};
  --accent:${theme.accent};
  --accent-soft:${theme.accentSoft};
  --accent-strong:${theme.accentStrong};

  --hero-glow:${theme.heroGlow};
  --page-shadow:${theme.shadow};
}

*{ box-sizing:border-box; }

html,body{
  margin:0;
  padding:0;
  background:#EEF2F7;
  color:var(--ink);
  font-family:Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

body{
  -webkit-print-color-adjust:exact;
  print-color-adjust:exact;
}

.pageWrap{
  padding:24px;
}

.actions{
  width:210mm;
  margin:0 auto 14px auto;
  display:flex;
  justify-content:flex-end;
  gap:10px;
}

.btn{
  border:1px solid var(--line);
  background:#fff;
  color:var(--ink);
  padding:10px 14px;
  border-radius:14px;
  font-size:12px;
  font-weight:700;
  cursor:pointer;
}

.btn.primary{
  background:var(--brand);
  border-color:var(--brand);
  color:#fff;
}

.page{
  width:210mm;
  min-height:297mm;
  margin:0 auto;
  background:var(--page-bg);
  position:relative;
  overflow:hidden;
  box-shadow:var(--page-shadow);
}

.pageInner{
  position:relative;
  min-height:297mm;
}

.hero{
  position:relative;
  min-height:86mm;
  padding:18mm 18mm 10mm 18mm;
  background:
    radial-gradient(90mm 35mm at 86% 0%, rgba(255,255,255,.18) 0%, rgba(255,255,255,0) 62%),
    linear-gradient(135deg, var(--brand-deep) 0%, var(--brand) 100%);
  color:#fff;
  overflow:hidden;
}

.heroGlow{
  position:absolute;
  right:-12mm;
  top:-14mm;
  width:72mm;
  height:72mm;
  border-radius:50%;
  background:var(--hero-glow);
  filter:blur(14px);
}

.heroCurveShadowA{
  position:absolute;
  left:-14%;
  right:-8%;
  bottom:-44mm;
  height:74mm;
  background:rgba(15,23,42,.07);
  filter:blur(8px);
  border-radius:50%;
}

.heroCurveA{
  position:absolute;
  left:-14%;
  right:-8%;
  bottom:-40mm;
  height:70mm;
  background:rgba(255,255,255,.98);
  border-radius:50%;
  box-shadow:0 -8px 18px rgba(15,23,42,.06);
}

.heroCurveB{
  position:absolute;
  left:18%;
  right:-25%;
  bottom:-52mm;
  height:86mm;
  background:var(--accent-soft);
  border-radius:50%;
  opacity:.92;
}

.heroRow{
  position:relative;
  z-index:3;
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:18px;
}

.docTitleBlock{
  flex:1 1 auto;
  min-width:0;
}

.docTitle{
  margin:0;
  font-size:30px;
  line-height:1;
  font-weight:950;
  letter-spacing:2.8px;
  text-transform:uppercase;
}

.docSubtitle{
  margin-top:8px;
  font-size:12px;
  line-height:1.5;
  max-width:78mm;
  color:rgba(255,255,255,.88);
}

.brand{
  display:flex;
  gap:12px;
  align-items:center;
  min-width:0;
  justify-content:flex-end;
}

.logoImg{
  width:54px;
  height:54px;
  border-radius:16px;
  object-fit:cover;
  background:#fff;
  border:1px solid rgba(255,255,255,.42);
}

.logoFallback{
  width:54px;
  height:54px;
  border-radius:16px;
  background:rgba(255,255,255,.18);
  border:1px solid rgba(255,255,255,.35);
  color:#fff;
  display:flex;
  align-items:center;
  justify-content:center;
  font-weight:900;
  font-size:18px;
  letter-spacing:.4px;
}

.brandText{
  min-width:0;
  text-align:right;
}

.brandName{
  margin:0;
  font-size:17px;
  font-weight:850;
  letter-spacing:.3px;
}

.brandMeta{
  margin-top:4px;
  font-size:11.5px;
  line-height:1.5;
  opacity:.92;
}

.brandMeta div{
  white-space:nowrap;
}

.content{
  position:relative;
  z-index:3;
  padding:4mm 18mm 0 18mm;
}

.metaTopGrid{
  display:grid;
  grid-template-columns:1fr 72mm;
  gap:16px;
  margin-top:-2mm;
}

.partyCard,
.infoCard,
.tableShell,
.noteCard,
.totalCard,
.signatureCard{
  border:1px solid var(--line);
  background:#fff;
  border-radius:18px;
}

.partyCard,
.infoCard,
.noteCard,
.totalCard,
.signatureCard{
  padding:14px;
}

.sectionLabel{
  margin:0 0 10px 0;
  font-size:11px;
  font-weight:850;
  text-transform:uppercase;
  letter-spacing:1px;
  color:var(--muted);
}

.partyName{
  font-size:24px;
  font-weight:900;
  line-height:1.15;
  margin:0;
  color:var(--ink);
}

.partyMeta{
  margin-top:8px;
  display:grid;
  gap:6px;
}

.metaRow{
  display:flex;
  justify-content:space-between;
  gap:12px;
  padding:7px 0;
  border-bottom:1px dashed #E7EDF5;
  font-size:12.5px;
}

.metaRow:last-child{
  border-bottom:none;
}

.metaKey{
  color:var(--muted);
}

.metaValue{
  color:var(--ink);
  font-weight:700;
  text-align:right;
}

.infoCard{
  background:linear-gradient(180deg, #fff 0%, var(--soft) 100%);
}

.tableSection{
  padding:14px 18mm 0 18mm;
  position:relative;
  z-index:3;
}

.tableShell{
  overflow:hidden;
}

table{
  width:100%;
  border-collapse:collapse;
}

thead th{
  padding:12px 14px;
  font-size:12px;
  text-align:left;
  font-weight:850;
  letter-spacing:.4px;
  color:#1E293B;
  background:linear-gradient(180deg, var(--soft-alt) 0%, var(--accent) 100%);
  border-bottom:1px solid var(--line-strong);
}

tbody td{
  padding:14px;
  border-bottom:1px solid #EDF2F7;
  font-size:12.5px;
  vertical-align:top;
  color:var(--ink);
}

tbody tr:last-child td{
  border-bottom:none;
}

.tdNo{
  width:48px;
  text-align:center;
  color:var(--muted);
}

.tdQty{
  width:80px;
  text-align:right;
  font-weight:800;
}

.tdMoney{
  width:132px;
  text-align:right;
  font-weight:800;
}

.itemName{
  font-weight:800;
  color:var(--ink);
}

.itemMeta{
  margin-top:4px;
  font-size:11px;
  color:var(--muted);
  line-height:1.5;
}

.bottomGrid{
  margin:16px 18mm 0 18mm;
  display:grid;
  grid-template-columns:1.18fr .82fr;
  gap:16px;
  align-items:start;
  position:relative;
  z-index:3;
}

.noteTitle{
  font-size:11px;
  font-weight:850;
  text-transform:uppercase;
  letter-spacing:1px;
  color:var(--muted);
  margin:0 0 10px 0;
}

.noteText{
  font-size:12.5px;
  color:var(--ink-soft);
  line-height:1.72;
  white-space:pre-wrap;
}

.summaryRows{
  display:grid;
  gap:6px;
}

.totalsRow{
  display:flex;
  justify-content:space-between;
  gap:12px;
  font-size:12.5px;
  padding:7px 0;
}

.totalsLabel{
  color:var(--muted);
}

.totalsValue{
  color:var(--ink);
  font-weight:800;
}

.totalsDivider{
  height:1px;
  background:var(--line);
  margin:8px 0 10px 0;
}

.totalsGrand{
  border-radius:16px;
  padding:14px 14px;
  background:linear-gradient(135deg, var(--brand-deep) 0%, var(--brand) 100%);
  color:#fff;
  display:flex;
  justify-content:space-between;
  gap:12px;
  font-size:16px;
  font-weight:950;
  letter-spacing:.2px;
  box-shadow:0 10px 26px rgba(15,23,42,.12);
}

.signatureArea{
  padding:16px 18mm 0 18mm;
  position:relative;
  z-index:3;
}

.signatureRow{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:16px;
}

.signatureLabel{
  font-size:11px;
  font-weight:850;
  text-transform:uppercase;
  letter-spacing:1px;
  color:var(--muted);
}

.signatureLine{
  height:36px;
  border-bottom:1px solid #CBD5E1;
  margin:14px 0 10px 0;
}

.signatureMeta{
  display:flex;
  justify-content:space-between;
  gap:12px;
  font-size:12px;
  color:var(--muted);
}

.statusBadge{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  padding:6px 10px;
  border-radius:999px;
  border:1px solid var(--brand-border);
  background:var(--brand-soft);
  color:var(--brand);
  font-size:11px;
  font-weight:850;
  letter-spacing:.5px;
  text-transform:uppercase;
}

.footerBand{
  position:absolute;
  left:0;
  right:0;
  bottom:0;
  height:70mm;
  pointer-events:none;
}

.footerCurveShadow{
  position:absolute;
  left:-12%;
  right:-12%;
  bottom:8mm;
  height:56mm;
  background:rgba(15,23,42,.06);
  filter:blur(10px);
  border-radius:50%;
}

.footerCurveA{
  position:absolute;
  left:-12%;
  right:-12%;
  bottom:10mm;
  height:52mm;
  background:rgba(255,255,255,.98);
  border-radius:50%;
}

.footerCurveB{
  position:absolute;
  left:30%;
  right:-20%;
  bottom:6mm;
  height:60mm;
  background:var(--accent-soft);
  border-radius:50%;
  opacity:.82;
}

.footerBrand{
  position:absolute;
  left:0;
  right:0;
  bottom:0;
  height:42mm;
  background:linear-gradient(135deg, var(--brand-deep) 0%, var(--brand) 100%);
}

.footerMeta{
  position:absolute;
  left:18mm;
  right:18mm;
  bottom:8mm;
  z-index:4;
  display:flex;
  justify-content:space-between;
  gap:16px;
  color:#fff;
  font-size:11px;
  font-weight:700;
}

.footerMetaLeft,
.footerMetaRight{
  max-width:78mm;
}

.helperMuted{
  color:var(--muted);
}

.emptyCell{
  padding:18px 14px !important;
  color:var(--muted);
  text-align:center;
}

@media print{
  html,body{
    background:#fff !important;
  }

  .actions{
    display:none !important;
  }

  .pageWrap{
    padding:0 !important;
  }

  .page{
    width:210mm !important;
    min-height:297mm !important;
    box-shadow:none !important;
    margin:0 !important;
  }
}

@media screen and (max-width:900px){
  .pageWrap{
    padding:12px;
  }

  .actions,
  .page{
    width:100%;
  }

  .hero{
    padding:18px 16px 42px 16px;
    min-height:auto;
  }

  .heroRow{
    flex-direction:column;
    gap:16px;
  }

  .brand{
    justify-content:flex-start;
  }

  .brandText{
    text-align:left;
  }

  .content{
    padding:10px 16px 0 16px;
  }

  .metaTopGrid,
  .bottomGrid,
  .signatureRow{
    grid-template-columns:1fr;
  }

  .tableSection{
    padding:14px 16px 0 16px;
  }

  .signatureArea{
    padding:16px 16px 0 16px;
  }

  .footerMeta{
    left:16px;
    right:16px;
    bottom:8px;
    flex-direction:column;
  }
}
</style>`;
}

function renderActions(title) {
  return `
    <div class="actions">
      <button class="btn" onclick="window.history.back()">Back</button>
      <button class="btn primary" onclick="window.print()">Print ${esc(title)}</button>
    </div>
  `;
}

function getDocumentNumber(document = {}) {
  return cleanString(
    document.number ||
      document.invoiceNumber ||
      document.receiptNumber ||
      document.proformaNumber ||
      document.deliveryNoteNumber ||
      document.warrantyNumber ||
      "—"
  );
}

function renderTopSection(data) {
  const { tenant, document, extra, title } = data;

  return `
    <section class="hero">
      <div class="heroGlow"></div>
      <div class="heroCurveShadowA"></div>
      <div class="heroCurveA"></div>
      <div class="heroCurveB"></div>

      <div class="heroRow">
        <div class="docTitleBlock">
          <h2 class="docTitle">${esc(title)}</h2>
          <div class="docSubtitle">
            ${esc(cleanString(extra.subtitle || "Professional business document generated by Storvex"))}
          </div>
        </div>

        <div class="brand">
          ${logoHtml(tenant)}

          <div class="brandText">
            <h1 class="brandName">${esc(cleanString(tenant.name || "Business"))}</h1>
            <div class="brandMeta">
              ${tenant.receiptHeader ? `<div>${esc(tenant.receiptHeader)}</div>` : ""}
              ${
                tenant.phone || tenant.email
                  ? `<div>${[
                      tenant.phone ? `Tel: ${esc(tenant.phone)}` : "",
                      tenant.email ? `Email: ${esc(tenant.email)}` : "",
                    ]
                      .filter(Boolean)
                      .join(" • ")}</div>`
                  : ""
              }
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="content">
      <div class="metaTopGrid">
        <div class="partyCard">
          <div class="sectionLabel">${esc(extra.customerTitle || "Document To")}</div>
          <h3 class="partyName">${esc(cleanString(data.customer.name || "Walk-in Customer"))}</h3>

          <div class="partyMeta">
            <div class="metaRow">
              <span class="metaKey">Phone</span>
              <span class="metaValue">${esc(cleanString(data.customer.phone || "—"))}</span>
            </div>

            ${
              data.customer.email
                ? `<div class="metaRow">
                    <span class="metaKey">Email</span>
                    <span class="metaValue">${esc(cleanString(data.customer.email))}</span>
                  </div>`
                : ""
            }

            ${
              data.customer.address
                ? `<div class="metaRow">
                    <span class="metaKey">Address</span>
                    <span class="metaValue">${esc(cleanString(data.customer.address))}</span>
                  </div>`
                : ""
            }
          </div>
        </div>

        <div class="infoCard">
          <div class="sectionLabel">Document Info</div>

          <div class="metaRow">
            <span class="metaKey">Number</span>
            <span class="metaValue">${esc(getDocumentNumber(document))}</span>
          </div>

          <div class="metaRow">
            <span class="metaKey">Date</span>
            <span class="metaValue">${esc(fmtDate(document.date || document.createdAt))}</span>
          </div>

          ${
            extra.status
              ? `<div class="metaRow">
                  <span class="metaKey">Status</span>
                  <span class="metaValue"><span class="statusBadge">${esc(extra.status)}</span></span>
                </div>`
              : ""
          }

          ${
            (extra.rightRows || []).length
              ? extra.rightRows
                  .map(
                    ([k, v]) => `
                      <div class="metaRow">
                        <span class="metaKey">${esc(k)}</span>
                        <span class="metaValue">${esc(v == null || v === "" ? "—" : String(v))}</span>
                      </div>
                    `
                  )
                  .join("")
              : ""
          }
        </div>
      </div>
    </section>
  `;
}

function renderItemsTable(data) {
  const { items, totals, showPrices } = data;

  const headCols = showPrices
    ? `
      <th class="tdNo">SL.</th>
      <th>Item Description</th>
      <th class="tdMoney">Price</th>
      <th class="tdQty">Qty.</th>
      <th class="tdMoney">Total</th>
    `
    : `
      <th class="tdNo">SL.</th>
      <th>Item Description</th>
      <th>Details</th>
      <th class="tdQty">Qty.</th>
    `;

  const rows = items.length
    ? items
        .map((it, idx) => {
          if (showPrices) {
            return `
              <tr>
                <td class="tdNo">${idx + 1}</td>
                <td>
                  <div class="itemName">${esc(it.productName || "—")}</div>
                  ${
                    it.serial || it.sku || it.barcode
                      ? `<div class="itemMeta">
                          ${[
                            it.serial ? `Serial: ${esc(it.serial)}` : "",
                            it.sku ? `SKU: ${esc(it.sku)}` : "",
                            it.barcode ? `Barcode: ${esc(it.barcode)}` : "",
                          ]
                            .filter(Boolean)
                            .join(" • ")}
                        </div>`
                      : ""
                  }
                </td>
                <td class="tdMoney">${esc(money(it.unitPrice, totals.currency))}</td>
                <td class="tdQty">${esc(String(it.quantity))}</td>
                <td class="tdMoney">${esc(money(it.total, totals.currency))}</td>
              </tr>
            `;
          }

          return `
            <tr>
              <td class="tdNo">${idx + 1}</td>
              <td>
                <div class="itemName">${esc(it.productName || "—")}</div>
                <div class="itemMeta">
                  ${
                    [
                      it.serial ? `Serial: ${esc(it.serial)}` : "",
                      it.sku ? `SKU: ${esc(it.sku)}` : "",
                      it.barcode ? `Barcode: ${esc(it.barcode)}` : "",
                    ]
                      .filter(Boolean)
                      .join(" • ") || "—"
                  }
                </div>
              </td>
              <td>${esc(cleanString(it.serial || it.sku || it.barcode || "—"))}</td>
              <td class="tdQty">${esc(String(it.quantity))}</td>
            </tr>
          `;
        })
        .join("")
    : `
      <tr>
        <td colspan="${showPrices ? 5 : 4}" class="emptyCell">No items</td>
      </tr>
    `;

  return `
    <section class="tableSection">
      <div class="tableShell">
        <table>
          <thead>
            <tr>${headCols}</tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderBottomSection(data) {
  const { totals, extra, showPrices, showPaymentSummary, showSignature, title } = data;

  const noteText = cleanString(
    extra.notes ||
      extra.terms ||
      "Thank you for your business.\nKeep this document for your records."
  );

  const totalsHtml = showPrices
    ? `
      <div class="totalCard">
        <div class="sectionLabel">Summary</div>

        <div class="summaryRows">
          <div class="totalsRow">
            <span class="totalsLabel">Sub Total</span>
            <span class="totalsValue">${esc(money(totals.subtotal, totals.currency))}</span>
          </div>

          ${
            showPaymentSummary
              ? `
                <div class="totalsRow">
                  <span class="totalsLabel">Paid</span>
                  <span class="totalsValue">${esc(money(totals.amountPaid, totals.currency))}</span>
                </div>
                <div class="totalsRow">
                  <span class="totalsLabel">Balance</span>
                  <span class="totalsValue">${esc(money(totals.balanceDue, totals.currency))}</span>
                </div>
              `
              : ""
          }
        </div>

        <div class="totalsDivider"></div>

        <div class="totalsGrand">
          <span>Total</span>
          <span>${esc(money(totals.total, totals.currency))}</span>
        </div>
      </div>
    `
    : `
      <div class="totalCard">
        <div class="sectionLabel">Summary</div>

        <div class="summaryRows">
          <div class="totalsRow">
            <span class="totalsLabel">Items</span>
            <span class="totalsValue">${esc(String(data.items.length))}</span>
          </div>
          <div class="totalsRow">
            <span class="totalsLabel">Document type</span>
            <span class="totalsValue">${esc(title)}</span>
          </div>
          <div class="totalsRow">
            <span class="totalsLabel">Prepared on</span>
            <span class="totalsValue">${esc(fmtDateLong(data.document.date || data.document.createdAt))}</span>
          </div>
        </div>
      </div>
    `;

  const signatureHtml = showSignature
    ? `
      <section class="signatureArea">
        <div class="signatureRow">
          <div class="signatureCard">
            <div class="signatureLabel">Prepared By</div>
            <div class="signatureLine"></div>
            <div class="signatureMeta">
              <span>${esc(cleanString(extra.preparedBy || extra.cashier || "Staff"))}</span>
              <span>${esc(fmtDate(data.document.date || data.document.createdAt))}</span>
            </div>
          </div>

          <div class="signatureCard">
            <div class="signatureLabel">Authorised Sign</div>
            <div class="signatureLine"></div>
            <div class="signatureMeta">
              <span>${esc(cleanString(extra.approvedBy || "Authorised Signature"))}</span>
              <span>${esc(fmtDate(data.document.date || data.document.createdAt))}</span>
            </div>
          </div>
        </div>
      </section>
    `
    : "";

  return `
    <section class="bottomGrid">
      <div class="noteCard">
        <div class="noteTitle">Terms & Conditions</div>
        <div class="noteText">${esc(noteText)}</div>
      </div>

      ${totalsHtml}
    </section>

    ${signatureHtml}

    <div class="footerBand">
      <div class="footerCurveShadow"></div>
      <div class="footerCurveA"></div>
      <div class="footerCurveB"></div>
      <div class="footerBrand"></div>

      <div class="footerMeta">
        <div class="footerMetaLeft">
          ${esc(cleanString(data.tenant.receiptFooter || ""))}
        </div>
        <div class="footerMetaRight">
          ${esc(cleanString(data.tenant.name || "Business"))}
        </div>
      </div>
    </div>
  `;
}

function buildPage({
  title,
  tenant,
  document,
  customer,
  items,
  totals,
  extra,
  badgeText,
  showPrices = true,
  showPaymentSummary = true,
  showSignature = true,
  theme,
}) {
  const normalizedItems = normalizeItems(items);
  const normalizedTotals = computeTotals(
    normalizedItems,
    totals,
    extra?.currency || "RWF"
  );

  const resolvedTheme = resolveBrandTheme(tenant, theme || {});

  const data = {
    tenant: tenant || {},
    customer: customer || {},
    document: document || {},
    extra: {
      ...(extra || {}),
      status: badgeText || extra?.status || null,
    },
    items: normalizedItems,
    totals: normalizedTotals,
    showPrices,
    showPaymentSummary,
    showSignature,
    title,
  };

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${esc(title)} ${esc(document?.number || "")}</title>
  ${commonStyles(resolvedTheme)}
</head>
<body>
  <div class="pageWrap">
    ${renderActions(title)}
    <div class="page">
      <div class="pageInner">
        ${renderTopSection(data)}
        ${renderItemsTable(data)}
        ${renderBottomSection(data)}
      </div>
    </div>
  </div>
</body>
</html>`;
}

function renderReceiptHtml(payload) {
  return buildPage({
    title: "Receipt",
    tenant: payload.tenant,
    document: payload.document,
    customer: payload.customer,
    items: payload.items,
    totals: payload.totals,
    badgeText: payload.extra?.saleType || payload.extra?.status || "PAID",
    showPrices: true,
    showPaymentSummary: true,
    showSignature: false,
    theme:
      payload.theme || {
        primaryColor: payload.tenant?.documentPrimaryColor,
        accentColor: payload.tenant?.documentAccentColor,
      },
    extra: {
      currency: payload.totals?.currency,
      subtitle: "Payment confirmation and sales record",
      notes:
        payload.extra?.notes ||
        payload.tenant?.receiptFooter ||
        "Keep this receipt for support and warranty.",
      rightRows: [
        ["Cashier", payload.extra?.cashier || "—"],
        ["Sale Type", payload.extra?.saleType || "—"],
        ["Paid Status", payload.extra?.status || "—"],
      ],
    },
  });
}

function renderInvoiceHtml(payload) {
  return buildPage({
    title: "Invoice",
    tenant: payload.tenant,
    document: payload.document,
    customer: payload.customer,
    items: payload.items,
    totals: payload.totals,
    badgeText: payload.extra?.status || "INVOICE",
    showPrices: true,
    showPaymentSummary: true,
    showSignature: true,
    theme:
      payload.theme || {
        primaryColor: payload.tenant?.documentPrimaryColor,
        accentColor: payload.tenant?.documentAccentColor,
      },
    extra: {
      currency: payload.totals?.currency,
      subtitle: "Formal billing document",
      notes:
        payload.extra?.invoiceTerms ||
        payload.tenant?.invoiceTerms ||
        payload.extra?.notes ||
        "Invoice terms apply.",
      rightRows: [
        ["Due Date", payload.extra?.dueDate ? fmtDate(payload.extra.dueDate) : "—"],
        ["Cashier", payload.extra?.cashier || "—"],
        ["Sale Ref", payload.extra?.saleRef || "—"],
      ],
    },
  });
}

function renderProformaHtml(payload) {
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
    theme:
      payload.theme || {
        primaryColor: payload.tenant?.documentPrimaryColor,
        accentColor: payload.tenant?.documentAccentColor,
      },
    extra: {
      currency: payload.totals?.currency,
      subtitle: "Quotation-style preliminary document",
      notes:
        payload.extra?.notes ||
        payload.tenant?.proformaTerms ||
        "This proforma is not a final receipt and does not confirm payment.",
      rightRows: [
        ["Prepared By", payload.extra?.preparedBy || "—"],
        ["Validity", payload.extra?.validUntil ? fmtDate(payload.extra.validUntil) : "—"],
        ["Reference", payload.extra?.reference || "—"],
      ],
    },
  });
}

function renderDeliveryNoteHtml(payload) {
  return buildPage({
    title: "Delivery Note",
    tenant: payload.tenant,
    document: payload.document,
    customer: payload.customer,
    items: payload.items,
    totals: payload.totals,
    badgeText: payload.extra?.badgeText || "DELIVERY",
    showPrices: false,
    showPaymentSummary: false,
    showSignature: true,
    theme:
      payload.theme || {
        primaryColor: payload.tenant?.documentPrimaryColor,
        accentColor: payload.tenant?.documentAccentColor,
      },
    extra: {
      subtitle: "Goods handover confirmation",
      notes:
        payload.extra?.notes ||
        payload.tenant?.deliveryNoteTerms ||
        "Please confirm that all delivered items were received in good condition.",
      preparedBy: payload.extra?.deliveredBy || "—",
      approvedBy: payload.extra?.receivedBy || "—",
      rightRows: [
        ["Delivered By", payload.extra?.deliveredBy || "—"],
        ["Received By", payload.extra?.receivedBy || "—"],
        ["Receiver Phone", payload.extra?.receivedByPhone || "—"],
      ],
    },
  });
}

function renderWarrantyHtml(payload) {
  return buildPage({
    title: "Warranty Certificate",
    tenant: payload.tenant,
    document: payload.document,
    customer: payload.customer,
    items: payload.items,
    totals: payload.totals,
    badgeText: "WARRANTY",
    showPrices: false,
    showPaymentSummary: false,
    showSignature: true,
    theme:
      payload.theme || {
        primaryColor: payload.tenant?.documentPrimaryColor,
        accentColor: payload.tenant?.documentAccentColor,
      },
    extra: {
      subtitle: "After-sales warranty coverage document",
      notes:
        payload.extra?.warrantyTerms ||
        payload.tenant?.warrantyTerms ||
        payload.extra?.notes ||
        "Warranty applies under the store warranty terms.",
      preparedBy: payload.extra?.issuedBy || "—",
      approvedBy: payload.customer?.name || "—",
      rightRows: [
        ["Start Date", payload.extra?.startDate ? fmtDate(payload.extra.startDate) : "—"],
        ["End Date", payload.extra?.endDate ? fmtDate(payload.extra.endDate) : "—"],
        ["Issued By", payload.extra?.issuedBy || "—"],
      ],
    },
  });
}

module.exports = {
  esc,
  cleanString,
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
  commonStyles,
  buildPage,
  renderReceiptHtml,
  renderInvoiceHtml,
  renderProformaHtml,
  renderDeliveryNoteHtml,
  renderWarrantyHtml,
};