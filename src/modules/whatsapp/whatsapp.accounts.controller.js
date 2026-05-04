const service = require("./whatsapp.accounts.service");

function getTenantId(req) {
  return req.user?.tenantId || null;
}

function mapAccountError(err, res, fallbackMessage) {
  const code = err?.code || err?.message;

  if (code === "TENANT_REQUIRED") {
    return res.status(401).json({
      ok: false,
      message: "Tenant is required",
      code,
    });
  }

  if (code === "TENANT_NOT_FOUND") {
    return res.status(404).json({
      ok: false,
      message: "Tenant not found",
      code,
    });
  }

  if (code === "NOT_FOUND") {
    return res.status(404).json({
      ok: false,
      message: "WhatsApp account not found",
      code,
    });
  }

  if (code === "PHONE_NUMBER_REQUIRED") {
    return res.status(400).json({
      ok: false,
      message: "WhatsApp phone number is required",
      code,
    });
  }

  if (code === "PHONE_NUMBER_INVALID") {
    return res.status(400).json({
      ok: false,
      message: "WhatsApp phone number is invalid",
      code,
    });
  }

  if (code === "PHONE_NUMBER_ID_REQUIRED_WHEN_ACTIVE") {
    return res.status(400).json({
      ok: false,
      message: "Phone number ID is required before activating WhatsApp",
      code,
    });
  }

  if (code === "ACCESS_TOKEN_REQUIRED_WHEN_ACTIVE") {
    return res.status(400).json({
      ok: false,
      message: "Access token is required before activating WhatsApp",
      code,
    });
  }

  if (code === "WEBHOOK_VERIFY_TOKEN_REQUIRED_WHEN_ACTIVE") {
    return res.status(400).json({
      ok: false,
      message: "Webhook verify token is required before activating WhatsApp",
      code,
    });
  }

  if (code === "ONE_WHATSAPP_ACCOUNT_ALLOWED") {
    return res.status(409).json({
      ok: false,
      message:
        "Only one WhatsApp number is allowed for this store. Edit the existing WhatsApp account instead.",
      code,
      existingAccountId: err?.existingAccountId || undefined,
    });
  }

  if (code === "WHATSAPP_ACCOUNT_CONFLICT" || code === "P2002") {
    return res.status(409).json({
      ok: false,
      message: "This WhatsApp account conflicts with an existing account",
      code,
    });
  }

  console.error("WhatsApp account unhandled error:", err);

  return res.status(500).json({
    ok: false,
    message: fallbackMessage,
    code: code || "WHATSAPP_ACCOUNT_ERROR",
  });
}

async function createAccount(req, res) {
  try {
    const tenantId = getTenantId(req);

    const account = await service.createAccount(tenantId, req.body || {});

    return res.status(201).json({
      ok: true,
      message: "WhatsApp account created",
      account,
    });
  } catch (err) {
    console.error("createAccount error:", err);
    return mapAccountError(err, res, "Failed to create WhatsApp account");
  }
}

async function listAccounts(req, res) {
  try {
    const tenantId = getTenantId(req);

    const accounts = await service.listAccounts(tenantId);

    return res.json({
      ok: true,
      accounts,
      strategy: {
        mode: "ONE_STORE_NUMBER",
        customerFacingLabel: "One WhatsApp number for the store",
        internalBranchRule:
          "Customers use one store WhatsApp number. Storvex assigns conversations and sale actions to branches internally.",
      },
    });
  } catch (err) {
    console.error("listAccounts error:", err);
    return mapAccountError(err, res, "Failed to list WhatsApp accounts");
  }
}

async function getAccount(req, res) {
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;

    const account = await service.getAccount(tenantId, id);

    return res.json({
      ok: true,
      account,
    });
  } catch (err) {
    console.error("getAccount error:", err);
    return mapAccountError(err, res, "Failed to fetch WhatsApp account");
  }
}

async function updateAccount(req, res) {
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;

    const account = await service.updateAccount(tenantId, id, req.body || {});

    return res.json({
      ok: true,
      message: "WhatsApp account updated",
      account,
    });
  } catch (err) {
    console.error("updateAccount error:", err);
    return mapAccountError(err, res, "Failed to update WhatsApp account");
  }
}

async function setAccountActive(req, res) {
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;

    const account = await service.setAccountActive(
      tenantId,
      id,
      req.body?.isActive
    );

    return res.json({
      ok: true,
      message: account.isActive
        ? "WhatsApp account activated"
        : "WhatsApp account deactivated",
      account,
    });
  } catch (err) {
    console.error("setAccountActive error:", err);
    return mapAccountError(err, res, "Failed to update WhatsApp account status");
  }
}

module.exports = {
  createAccount,
  listAccounts,
  getAccount,
  updateAccount,
  setAccountActive,
};