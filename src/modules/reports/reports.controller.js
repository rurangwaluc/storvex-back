// src/modules/reports/reports.controller.js

const { RepairStatus } = require("@prisma/client");
const PDFDocument = require("pdfkit");

const {
  parseRange,
  getTenantForPdf,
  buildSalesSummary,
  buildExpenseSummary,
  buildRepairSummary,
  buildDashboardSummary,
  buildTopSellers,
  buildDailyClose,
  buildInsights,
  buildFinancialSummary,
  buildIncomeStatement,
  buildCashFlowSummary,
  buildBranchPerformance,
  computePeriodSummary,
  getReorderSuggestions,
  getOverdueCollections,
} = require("./reports.service");

// ---- local helpers kept for PDF rendering ----
function parseDateOnly(s) {
  if (!s) return null;
  const d = new Date(String(s));
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function money(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function formatRwf(n) {
  const x = Number(n || 0);
  return `RWF ${x.toLocaleString()}`;
}

function cleanString(x) {
  const s = x == null ? "" : String(x).trim();
  return s || null;
}

function formatTenantLine(tenant) {
  if (!tenant) return "Store: —";
  const parts = [];
  const name = cleanString(tenant.name);
  const phone = cleanString(tenant.phone);
  const email = cleanString(tenant.email);

  if (name) parts.push(name);
  if (phone) parts.push(phone);
  if (email) parts.push(email);

  return parts.length ? `Store: ${parts.join(" • ")}` : "Store: —";
}

function pctChange(current, previous) {
  const c = Number(current || 0);
  const p = Number(previous || 0);
  if (p === 0) return null;
  return ((c - p) / p) * 100;
}

function shiftRangeBackward(start, end) {
  const durationMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - durationMs);
  return { prevStart: startOfDay(prevStart), prevEnd: endOfDay(prevEnd) };
}

function getLimit(query = {}, fallback = 10, max = 50) {
  const raw = Number(query.limit);
  return Number.isFinite(raw) && raw > 0 && raw <= max ? Math.floor(raw) : fallback;
}

function getThreshold(query = {}, fallback = 5, max = 10000) {
  const raw = Number(query.threshold);
  return Number.isFinite(raw) && raw >= 0 && raw <= max ? Math.floor(raw) : fallback;
}

function sendReportError(res, err, fallbackMessage) {
  return res
    .status(err?.status || 500)
    .json({ message: err?.message || fallbackMessage });
}

// -------------------------
// GET /reports/sales-summary
// -------------------------
async function salesSummary(req, res) {
  try {
    const payload = await buildSalesSummary({
      user: req.user,
      query: req.query,
    });

    return res.json(payload);
  } catch (err) {
    console.error("salesSummary error:", err);
    return sendReportError(res, err, "Failed to load sales summary");
  }
}

// ---------------------------
// GET /reports/expense-summary
// ---------------------------
async function expenseSummary(req, res) {
  try {
    const payload = await buildExpenseSummary({
      user: req.user,
      query: req.query,
    });

    return res.json(payload);
  } catch (err) {
    console.error("expenseSummary error:", err);
    return sendReportError(res, err, "Failed to load expense summary");
  }
}

// --------------------------
// GET /reports/repair-summary
// --------------------------
async function repairSummary(req, res) {
  try {
    const payload = await buildRepairSummary({
      user: req.user,
      query: req.query,
    });

    return res.json({
      ...payload,
      allowedStatuses: Object.values(RepairStatus),
    });
  } catch (err) {
    console.error("repairSummary error:", err);
    return sendReportError(res, err, "Failed to load repair summary");
  }
}

// ----------------------
// GET /reports/dashboard
// ----------------------
async function dashboard(req, res) {
  try {
    const payload = await buildDashboardSummary({
      user: req.user,
      query: req.query,
    });

    return res.json(payload);
  } catch (err) {
    console.error("dashboard error:", err);
    return sendReportError(res, err, "Failed to load dashboard");
  }
}

// ---------------------------------
// GET /reports/daily-close?date=YYYY-MM-DD
// ---------------------------------
async function dailyClose(req, res) {
  try {
    const payload = await buildDailyClose({
      user: req.user,
      query: req.query,
    });

    return res.json(payload);
  } catch (err) {
    console.error("dailyClose error:", err);
    return sendReportError(res, err, "Failed to load daily close");
  }
}

// ---------------------------------
// GET /reports/top-sellers?from&to&limit
// ---------------------------------
async function topSellers(req, res) {
  try {
    const payload = await buildTopSellers({
      user: req.user,
      query: req.query,
    });

    return res.json(payload);
  } catch (err) {
    console.error("topSellers error:", err);
    return sendReportError(res, err, "Failed to load top sellers");
  }
}

// ---------------------------------
// GET /reports/insights?from&to&limit&threshold
// ---------------------------------
async function insights(req, res) {
  try {
    const payload = await buildInsights({
      user: req.user,
      query: req.query,
    });

    return res.json(payload);
  } catch (err) {
    console.error("insights error:", err);
    return sendReportError(res, err, "Failed to load insights");
  }
}

// ---------------------------------
// GET /reports/financial-summary
// ---------------------------------
async function financialSummary(req, res) {
  try {
    const payload = await buildFinancialSummary({
      user: req.user,
      query: req.query,
    });

    return res.json(payload);
  } catch (err) {
    console.error("financialSummary error:", err);
    return sendReportError(res, err, "Failed to load financial summary");
  }
}

// ---------------------------------
// GET /reports/income-statement
// ---------------------------------
async function incomeStatement(req, res) {
  try {
    const payload = await buildIncomeStatement({
      user: req.user,
      query: req.query,
    });

    return res.json(payload);
  } catch (err) {
    console.error("incomeStatement error:", err);
    return sendReportError(res, err, "Failed to load income statement");
  }
}

// ---------------------------------
// GET /reports/cash-flow
// ---------------------------------
async function cashFlowSummary(req, res) {
  try {
    const payload = await buildCashFlowSummary({
      user: req.user,
      query: req.query,
    });

    return res.json(payload);
  } catch (err) {
    console.error("cashFlowSummary error:", err);
    return sendReportError(res, err, "Failed to load cash flow summary");
  }
}

// ---------------------------------
// GET /reports/branch-performance
// ---------------------------------
async function branchPerformance(req, res) {
  try {
    const payload = await buildBranchPerformance({
      user: req.user,
      query: req.query,
    });

    return res.json(payload);
  } catch (err) {
    console.error("branchPerformance error:", err);
    return sendReportError(res, err, "Failed to load branch performance");
  }
}

// ---------------------------------
// PDF: GET /reports/daily-close.pdf?date=YYYY-MM-DD
// ---------------------------------
async function dailyClosePdf(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const threshold = getThreshold(req.query, 5, 10000);

    const [tenant, payload] = await Promise.all([
      getTenantForPdf(tenantId),
      buildDailyClose({
        user: req.user,
        query: req.query,
      }),
    ]);

    const dateBase = parseDateOnly(req.query.date) || new Date();
    const start = startOfDay(dateBase);
    const end = endOfDay(dateBase);
    const { prevStart, prevEnd } = shiftRangeBackward(start, end);

    const branchScope = payload.branchScope;

    const [current, previous, reorderList, collectionsList] = await Promise.all([
      computePeriodSummary(branchScope, start, end),
      computePeriodSummary(branchScope, prevStart, prevEnd),
      getReorderSuggestions(branchScope, start, end, 5, threshold),
      getOverdueCollections(branchScope, 5),
    ]);

    const actions = {
      comparison: {
        revenuePct: pctChange(current.revenue, previous.revenue),
        profitPct: pctChange(current.profitEstimate, previous.profitEstimate),
      },
      reorder: reorderList,
      collections: collectionsList,
    };

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="storvex-daily-close-${payload.date}.pdf"`
    );

    const doc = new PDFDocument({ margin: 40 });
    doc.pipe(res);

    renderDailyClosePdf(doc, payload, tenant, actions);

    doc.end();
  } catch (err) {
    console.error("dailyClosePdf error:", err);
    return sendReportError(res, err, "Failed to generate daily close PDF");
  }
}

// ---------------------------------
// PDF: GET /reports/period.pdf?from&to&limit&threshold
// ---------------------------------
async function periodPdf(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const { start, end } = parseRange(req.query);
    const limit = getLimit(req.query, 10, 50);
    const threshold = getThreshold(req.query, 5, 10000);

    const [tenant, dash, tops] = await Promise.all([
      getTenantForPdf(tenantId),
      buildDashboardSummary({
        user: req.user,
        query: req.query,
      }),
      buildTopSellers({
        user: req.user,
        query: req.query,
      }),
    ]);

    const topList = tops.topSellers || [];
    const branchScope = dash.branchScope;

    const { prevStart, prevEnd } = shiftRangeBackward(start, end);
    const [current, previous, reorderList, collectionsList] = await Promise.all([
      computePeriodSummary(branchScope, start, end),
      computePeriodSummary(branchScope, prevStart, prevEnd),
      getReorderSuggestions(branchScope, start, end, limit, threshold),
      getOverdueCollections(branchScope, limit),
    ]);

    const actions = {
      comparison: {
        revenuePct: pctChange(current.revenue, previous.revenue),
        expensesPct: pctChange(current.expensesApproved, previous.expensesApproved),
        profitPct: pctChange(current.profitEstimate, previous.profitEstimate),
      },
      reorder: reorderList,
      collections: collectionsList,
    };

    const fromISO = isoDate(start);
    const toISO = isoDate(end);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="storvex-period-report-${fromISO}-to-${toISO}.pdf"`
    );

    const doc = new PDFDocument({ margin: 40 });
    doc.pipe(res);

    renderPeriodPdf(doc, dash, topList, { fromISO, toISO }, tenant, actions);

    doc.end();
  } catch (err) {
    console.error("periodPdf error:", err);
    return sendReportError(res, err, "Failed to generate period PDF");
  }
}

// =========================
// PDF render helpers (styled)
// =========================
function drawHeader(doc, { title, subtitleLine1, subtitleLine2 }) {
  const pageWidth = doc.page.width;
  const margin = doc.page.margins.left;

  doc.save();
  doc.rect(0, 0, pageWidth, 92).fill("#0f172a");
  doc.restore();

  doc.fillColor("#ffffff");
  doc.font("Helvetica-Bold").fontSize(20).text("Storvex", margin, 20);

  doc.font("Helvetica").fontSize(10).fillColor("#cbd5e1");
  doc.text(subtitleLine1, margin, 46);
  if (subtitleLine2) doc.text(subtitleLine2, margin, 62);

  doc.font("Helvetica-Bold").fontSize(16).fillColor("#ffffff");
  doc.text(title, margin, 20, { align: "right" });

  doc.fillColor("#e2e8f0");
  doc.rect(margin, 98, pageWidth - margin * 2, 1).fill();

  doc.fillColor("#0f172a").font("Helvetica");
}

function drawCard(doc, { x, y, w, h, title, value, tone = "neutral", sub }) {
  const toneColor =
    tone === "success"
      ? "#16a34a"
      : tone === "warning"
      ? "#d97706"
      : tone === "danger"
      ? "#dc2626"
      : "#64748b";

  doc.save();
  doc.roundedRect(x, y, w, h, 10).fill("#ffffff").stroke("#e2e8f0");
  doc.restore();

  doc.save();
  doc.roundedRect(x, y, 8, h, 10).fill(toneColor);
  doc.restore();

  doc.fillColor("#475569").font("Helvetica").fontSize(10).text(title, x + 16, y + 10, {
    width: w - 24,
  });
  doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(16).text(value, x + 16, y + 28, {
    width: w - 24,
  });

  if (sub) {
    doc.fillColor("#64748b").font("Helvetica").fontSize(9).text(sub, x + 16, y + 52, {
      width: w - 24,
    });
  }

  doc.fillColor("#0f172a").font("Helvetica");
}

function drawSectionTitle(doc, { x, y, title }) {
  doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(12).text(title, x, y);
  doc.fillColor("#0f172a").font("Helvetica");
}

function drawKeyValueList(doc, { x, y, items }) {
  let yy = y;
  for (const { k, v } of items) {
    doc.fillColor("#475569").fontSize(10).text(k, x, yy, { continued: true });
    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(10).text(` ${v}`);
    doc.font("Helvetica");
    yy += 16;
  }
  doc.fillColor("#0f172a");
  return yy;
}

function drawTable(doc, { x, y, w, columns, rows }) {
  const headerH = 22;
  const rowH = 20;

  doc.save();
  doc.roundedRect(x, y, w, headerH, 8).fill("#f1f5f9").stroke("#e2e8f0");
  doc.restore();

  let cx = x;
  doc.fillColor("#334155").font("Helvetica-Bold").fontSize(10);
  for (const col of columns) {
    doc.text(col.label, cx + 8, y + 6, {
      width: col.w - 16,
      align: col.align || "left",
    });
    cx += col.w;
  }
  doc.font("Helvetica").fillColor("#0f172a");

  let yy = y + headerH;
  rows.forEach((r, idx) => {
    doc.save();
    doc.rect(x, yy, w, rowH).fill(idx % 2 === 0 ? "#ffffff" : "#fbfdff");
    doc.restore();

    doc.save();
    doc.rect(x, yy, w, rowH).stroke("#e2e8f0");
    doc.restore();

    let rx = x;
    for (const col of columns) {
      doc.text(String(r[col.key] ?? ""), rx + 8, yy + 5, {
        width: col.w - 16,
        align: col.align || "left",
      });
      rx += col.w;
    }
    yy += rowH;
  });

  return yy;
}

function drawFooter(doc, { leftText }) {
  const margin = doc.page.margins.left;
  const bottom = doc.page.height - doc.page.margins.bottom;

  doc.fillColor("#94a3b8").fontSize(8).text(leftText, margin, bottom - 14, { align: "left" });
  doc.text(`Page ${doc.page.number}`, margin, bottom - 14, { align: "right" });
  doc.fillColor("#0f172a").font("Helvetica");
}

function fmtPct(x) {
  if (x == null) return "—";
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function renderOwnerActions(doc, { x, y, w, actions, title = "Owner Actions" }) {
  drawSectionTitle(doc, { x, y, title });
  y += 16;

  const gap = 12;
  const colW = (w - gap * 2) / 3;
  const boxH = 78;

  doc.save();
  doc.roundedRect(x, y, colW, boxH, 10).fill("#ffffff").stroke("#e2e8f0");
  doc.restore();
  doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(10).text("Trend", x + 12, y + 10);
  doc.fillColor("#475569").font("Helvetica").fontSize(9).text(
    `Revenue: ${fmtPct(actions?.comparison?.revenuePct)}\nProfit: ${fmtPct(
      actions?.comparison?.profitPct
    )}${
      actions?.comparison?.expensesPct != null
        ? `\nExpenses: ${fmtPct(actions?.comparison?.expensesPct)}`
        : ""
    }`,
    x + 12,
    y + 28
  );

  const rx = x + colW + gap;
  doc.save();
  doc.roundedRect(rx, y, colW, boxH, 10).fill("#ffffff").stroke("#e2e8f0");
  doc.restore();
  doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(10).text("Reorder", rx + 12, y + 10);
  doc.fillColor("#475569").font("Helvetica").fontSize(9).text(
    `${(actions?.reorder || []).length} item(s)\nLow stock top sellers`,
    rx + 12,
    y + 28
  );

  const cx = x + (colW + gap) * 2;
  doc.save();
  doc.roundedRect(cx, y, colW, boxH, 10).fill("#ffffff").stroke("#e2e8f0");
  doc.restore();
  doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(10).text("Collect", cx + 12, y + 10);
  doc.fillColor("#475569").font("Helvetica").fontSize(9).text(
    `${(actions?.collections || []).length} customer(s)\nOverdue credit`,
    cx + 12,
    y + 28
  );

  y += boxH + 14;

  const reorder = actions?.reorder || [];
  const collections = actions?.collections || [];

  drawSectionTitle(doc, { x, y, title: "Reorder list" });
  y += 14;

  if (!reorder.length) {
    doc.fillColor("#64748b").fontSize(10).text("No reorder suggestions.", x, y);
    doc.fillColor("#0f172a");
    y += 18;
  } else {
    const rows = reorder.slice(0, 10).map((p, idx) => ({
      rank: idx + 1,
      name: p.name,
      stock: p.stockQty,
      sold: p.soldQty,
    }));

    y =
      drawTable(doc, {
        x,
        y,
        w,
        columns: [
          { key: "rank", label: "#", w: 40, align: "left" },
          { key: "name", label: "Product", w: w - 40 - 70 - 70, align: "left" },
          { key: "sold", label: "Sold", w: 70, align: "right" },
          { key: "stock", label: "Stock", w: 70, align: "right" },
        ],
        rows,
      }) + 14;
  }

  drawSectionTitle(doc, { x, y, title: "Collections list" });
  y += 14;

  if (!collections.length) {
    doc.fillColor("#64748b").fontSize(10).text("No overdue customers.", x, y);
    doc.fillColor("#0f172a");
    y += 18;
  } else {
    const rows = collections.slice(0, 10).map((c, idx) => ({
      rank: idx + 1,
      name: c.name,
      phone: c.phone,
      amount: formatRwf(c.overdueAmount),
    }));

    y =
      drawTable(doc, {
        x,
        y,
        w,
        columns: [
          { key: "rank", label: "#", w: 40, align: "left" },
          { key: "name", label: "Customer", w: w - 40 - 120 - 110, align: "left" },
          { key: "phone", label: "Phone", w: 120, align: "left" },
          { key: "amount", label: "Overdue", w: 110, align: "right" },
        ],
        rows,
      }) + 6;
  }

  return y;
}

function renderDailyClosePdf(doc, payload, tenant, actions) {
  drawHeader(doc, {
    title: "Daily Close",
    subtitleLine1: formatTenantLine(tenant),
    subtitleLine2: `Date: ${payload.date} • Generated: ${new Date().toISOString()}`,
  });

  const margin = doc.page.margins.left;
  const pageW = doc.page.width - margin * 2;
  let y = 116;

  const gap = 12;
  const cardW = (pageW - gap * 2) / 3;
  const cardH = 72;

  drawCard(doc, {
    x: margin,
    y,
    w: cardW,
    h: cardH,
    title: "Cash collected",
    value: formatRwf(payload.cashCollectedToday),
    tone: "success",
    sub: "Cash sales + credit payments",
  });
  drawCard(doc, {
    x: margin + cardW + gap,
    y,
    w: cardW,
    h: cardH,
    title: "Revenue",
    value: formatRwf(payload.sales.revenueToday),
    tone: "neutral",
    sub: "Cash + credit sales",
  });
  drawCard(doc, {
    x: margin + (cardW + gap) * 2,
    y,
    w: cardW,
    h: cardH,
    title: "Profit estimate",
    value: formatRwf(payload.profitEstimateToday),
    tone:
      payload.profitEstimateToday > 0
        ? "success"
        : payload.profitEstimateToday < 0
        ? "danger"
        : "neutral",
    sub: "Revenue − approved expenses",
  });

  y += cardH + 18;

  if (actions) {
    y = renderOwnerActions(doc, {
      x: margin,
      y,
      w: pageW,
      actions,
      title: "Owner Actions (Today)",
    }) + 10;
  }

  const colGap = 18;
  const colW = (pageW - colGap) / 2;

  drawSectionTitle(doc, { x: margin, y, title: "Sales breakdown" });
  drawSectionTitle(doc, { x: margin + colW + colGap, y, title: "Credit exposure" });

  const leftEnd = drawKeyValueList(doc, {
    x: margin,
    y: y + 18,
    items: [
      { k: "Cash sales total:", v: formatRwf(payload.sales.cash.total) },
      { k: "Cash sales count:", v: String(payload.sales.cash.count) },
      { k: "Credit sales total:", v: formatRwf(payload.sales.credit.total) },
      { k: "Credit sales count:", v: String(payload.sales.credit.count) },
      { k: "Approved expenses:", v: formatRwf(payload.expenses.approvedTotal) },
    ],
  });

  const rightEnd = drawKeyValueList(doc, {
    x: margin + colW + colGap,
    y: y + 18,
    items: [
      {
        k: "Outstanding:",
        v: `${formatRwf(payload.creditExposure.outstandingTotal)} (${payload.creditExposure.outstandingCount})`,
      },
      {
        k: "Overdue:",
        v: `${formatRwf(payload.creditExposure.overdueTotal)} (${payload.creditExposure.overdueCount})`,
      },
    ],
  });

  y = Math.max(leftEnd, rightEnd) + 18;

  drawSectionTitle(doc, { x: margin, y, title: "Top sellers" });
  y += 16;

  if (!payload.topSellers.length) {
    doc.fillColor("#64748b").fontSize(10).text("No sales for this day.", margin, y);
    doc.fillColor("#0f172a");
    y += 20;
  } else {
    const rows = payload.topSellers.map((p, idx) => ({
      rank: idx + 1,
      name: p.name,
      qty: p.soldQty,
    }));
    y =
      drawTable(doc, {
        x: margin,
        y,
        w: pageW,
        columns: [
          { key: "rank", label: "#", w: 40, align: "left" },
          { key: "name", label: "Product", w: pageW - 40 - 80, align: "left" },
          { key: "qty", label: "Qty", w: 80, align: "right" },
        ],
        rows,
      }) + 14;
  }

  drawSectionTitle(doc, { x: margin, y, title: "Totals" });
  y += 18;

  const totalsRows = [
    { k: "Total revenue:", v: formatRwf(payload.sales.revenueToday) },
    { k: "Total cash collected:", v: formatRwf(payload.cashCollectedToday) },
    { k: "Total approved expenses:", v: formatRwf(payload.expenses.approvedTotal) },
    { k: "Profit estimate:", v: formatRwf(payload.profitEstimateToday) },
    { k: "Outstanding credit:", v: formatRwf(payload.creditExposure.outstandingTotal) },
    { k: "Overdue credit:", v: formatRwf(payload.creditExposure.overdueTotal) },
  ];

  drawKeyValueList(doc, { x: margin, y, items: totalsRows });
  drawFooter(doc, { leftText: "Storvex • Daily Close Report" });
}

function renderPeriodPdf(doc, dash, topList, meta, tenant, actions) {
  drawHeader(doc, {
    title: "Period Report",
    subtitleLine1: formatTenantLine(tenant),
    subtitleLine2: `From: ${meta.fromISO} • To: ${meta.toISO} • Generated: ${new Date().toISOString()}`,
  });

  const margin = doc.page.margins.left;
  const pageW = doc.page.width - margin * 2;
  let y = 116;

  const gap = 12;
  const cardW = (pageW - gap * 2) / 3;
  const cardH = 72;

  drawCard(doc, {
    x: margin,
    y,
    w: cardW,
    h: cardH,
    title: "Revenue",
    value: formatRwf(dash.sales.total),
    tone: "neutral",
    sub: `${dash.sales.count} sale(s)`,
  });
  drawCard(doc, {
    x: margin + cardW + gap,
    y,
    w: cardW,
    h: cardH,
    title: "Approved expenses",
    value: formatRwf(dash.expenses.approvedTotal),
    tone: "warning",
    sub: `${dash.expenses.approvedCount} item(s)`,
  });
  drawCard(doc, {
    x: margin + (cardW + gap) * 2,
    y,
    w: cardW,
    h: cardH,
    title: "Profit estimate",
    value: formatRwf(dash.profitEstimate),
    tone:
      dash.profitEstimate > 0 ? "success" : dash.profitEstimate < 0 ? "danger" : "neutral",
    sub: "Revenue − expenses",
  });

  y += cardH + 18;

  if (actions) {
    y = renderOwnerActions(doc, {
      x: margin,
      y,
      w: pageW,
      actions,
      title: "Owner Actions (This Period)",
    }) + 10;
  }

  drawSectionTitle(doc, { x: margin, y, title: "Repairs by status" });
  y += 16;

  const byStatus = dash.repairs?.byStatus || {};
  const statuses = Object.keys(byStatus);

  if (!statuses.length) {
    doc.fillColor("#64748b").fontSize(10).text("No repairs in this period.", margin, y);
    doc.fillColor("#0f172a");
    y += 16;
  } else {
    const rows = statuses.map((k) => ({ status: k, count: byStatus[k] }));
    y =
      drawTable(doc, {
        x: margin,
        y,
        w: pageW,
        columns: [
          { key: "status", label: "Status", w: pageW - 80, align: "left" },
          { key: "count", label: "Count", w: 80, align: "right" },
        ],
        rows,
      }) + 18;
  }

  drawSectionTitle(doc, { x: margin, y, title: "Top sellers" });
  y += 16;

  let topRevenueTotal = 0;

  if (!topList.length) {
    doc.fillColor("#64748b").fontSize(10).text("No sales in this period.", margin, y);
    doc.fillColor("#0f172a");
    y += 20;
  } else {
    const rows = topList.map((p, idx) => {
      topRevenueTotal += money(p.revenue);
      return {
        rank: idx + 1,
        name: p.name,
        qty: p.soldQty,
        revenue: formatRwf(p.revenue),
      };
    });

    y =
      drawTable(doc, {
        x: margin,
        y,
        w: pageW,
        columns: [
          { key: "rank", label: "#", w: 40, align: "left" },
          { key: "name", label: "Product", w: pageW - 40 - 80 - 120, align: "left" },
          { key: "qty", label: "Qty", w: 80, align: "right" },
          { key: "revenue", label: "Revenue", w: 120, align: "right" },
        ],
        rows,
      }) + 14;
  }

  drawSectionTitle(doc, { x: margin, y, title: "Totals" });
  y += 18;

  const totalsRows = [
    { k: "Total revenue:", v: formatRwf(dash.sales.total) },
    { k: "Sales count:", v: String(dash.sales.count) },
    { k: "Total approved expenses:", v: formatRwf(dash.expenses.approvedTotal) },
    { k: "Profit estimate:", v: formatRwf(dash.profitEstimate) },
    { k: "Top sellers revenue (top 10):", v: formatRwf(topRevenueTotal) },
  ];

  drawKeyValueList(doc, { x: margin, y, items: totalsRows });
  drawFooter(doc, { leftText: "Storvex • Period Report" });
}

module.exports = {
  salesSummary,
  expenseSummary,
  repairSummary,
  dashboard,
  dailyClose,
  topSellers,
  insights,
  financialSummary,
  incomeStatement,
  cashFlowSummary,
  branchPerformance,
  dailyClosePdf,
  periodPdf,
};