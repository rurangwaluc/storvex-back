const service = require("./whatsapp.accounts.service");

async function createAccount(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const account = await service.createAccount(tenantId, req.body || {});
    return res.status(201).json({ account });
  } catch (err) {
    console.error("createAccount error:", err);

    if (err.message === "PHONE_NUMBER_REQUIRED") {
      return res.status(400).json({ message: "phoneNumber is required" });
    }

    if (err.message === "PHONE_NUMBER_INVALID") {
      return res.status(400).json({ message: "phoneNumber is invalid" });
    }

    if (err.message === "PHONE_NUMBER_ID_REQUIRED_WHEN_ACTIVE") {
      return res
        .status(400)
        .json({ message: "phoneNumberId is required when isActive=true" });
    }

    if (err.message === "ACCESS_TOKEN_REQUIRED_WHEN_ACTIVE") {
      return res
        .status(400)
        .json({ message: "accessToken is required when isActive=true" });
    }

    if (err.message === "TENANT_NOT_FOUND") {
      return res.status(404).json({ message: "Tenant not found" });
    }

    if (err.code === "P2002") {
      return res.status(409).json({ message: "WhatsApp account already exists" });
    }

    return res.status(500).json({ message: "Failed to create WhatsApp account" });
  }
}

async function listAccounts(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const accounts = await service.listAccounts(tenantId);
    return res.json({ accounts });
  } catch (err) {
    console.error("listAccounts error:", err);

    if (err.message === "TENANT_NOT_FOUND") {
      return res.status(404).json({ message: "Tenant not found" });
    }

    return res.status(500).json({ message: "Failed to list WhatsApp accounts" });
  }
}

async function updateAccount(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const { id } = req.params;

    const account = await service.updateAccount(tenantId, id, req.body || {});
    return res.json({ account });
  } catch (err) {
    console.error("updateAccount error:", err);

    if (err.message === "NOT_FOUND") {
      return res.status(404).json({ message: "WhatsApp account not found" });
    }

    if (err.message === "PHONE_NUMBER_REQUIRED") {
      return res.status(400).json({ message: "phoneNumber is required" });
    }

    if (err.message === "PHONE_NUMBER_INVALID") {
      return res.status(400).json({ message: "phoneNumber is invalid" });
    }

    if (err.message === "PHONE_NUMBER_ID_REQUIRED_WHEN_ACTIVE") {
      return res
        .status(400)
        .json({ message: "phoneNumberId is required when isActive=true" });
    }

    if (err.message === "ACCESS_TOKEN_REQUIRED_WHEN_ACTIVE") {
      return res
        .status(400)
        .json({ message: "accessToken is required when isActive=true" });
    }

    if (err.message === "TENANT_NOT_FOUND") {
      return res.status(404).json({ message: "Tenant not found" });
    }

    if (err.code === "P2002") {
      return res.status(409).json({ message: "WhatsApp account already exists" });
    }

    return res.status(500).json({ message: "Failed to update WhatsApp account" });
  }
}

module.exports = {
  createAccount,
  listAccounts,
  updateAccount,
};