const path = require("path");
const prisma = require("../../config/database");
const {
  createSupportUploadUrl,
  createSignedDownloadUrl,
} = require("../../lib/r2");

const ALLOWED_FILE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024;

function cleanString(value) {
  const s = String(value || "").trim();
  return s || null;
}

function getTenantId(req) {
  return cleanString(req.tenant?.id || req.user?.tenantId);
}

function safeFileName(value) {
  const raw = cleanString(value) || "support-file";
  const ext = path.extname(raw).slice(0, 20);
  const name = path.basename(raw, ext);

  return `${name || "support-file"}${ext || ""}`
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 140);
}

function extractStorageKey(value) {
  const raw = cleanString(value);

  if (!raw) return null;

  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    try {
      const url = new URL(raw);
      return url.pathname.replace(/^\/+/, "");
    } catch {
      return raw;
    }
  }

  return raw.replace(/^\/+/, "");
}

async function createSupportAttachmentUpload(req, res) {
  const tenantId = getTenantId(req);

  if (!tenantId) {
    return res.status(400).json({
      message: "Business context is required",
      code: "TENANT_CONTEXT_REQUIRED",
    });
  }

  const fileName = safeFileName(req.body?.fileName);
  const fileType = cleanString(req.body?.fileType);
  const fileSize = Number(req.body?.fileSize || 0);

  if (!fileType || !ALLOWED_FILE_TYPES.has(fileType)) {
    return res.status(400).json({
      message: "Only JPG, PNG, WEBP, GIF, and PDF files are allowed",
      code: "SUPPORT_ATTACHMENT_TYPE_NOT_ALLOWED",
    });
  }

  if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_FILE_SIZE) {
    return res.status(400).json({
      message: "File size must be greater than 0 and not more than 10MB",
      code: "SUPPORT_ATTACHMENT_SIZE_INVALID",
    });
  }

  try {
    const upload = await createSupportUploadUrl({
      tenantId,
      fileName,
      fileType,
    });

    return res.json({
      upload: {
        uploadUrl: upload.uploadUrl,
        storageKey: upload.storageKey,
        fileName,
        fileType,
        fileSize,
      },
      attachment: {
        fileUrl: upload.storageKey,
        fileName,
        fileType,
        fileSize,
      },
    });
  } catch (err) {
    console.error("createSupportAttachmentUpload error:", err);

    return res.status(500).json({
      message: "Failed to prepare support attachment upload",
      code: "SUPPORT_ATTACHMENT_UPLOAD_PREPARE_FAILED",
    });
  }
}

async function getSupportAttachmentDownloadUrl(req, res) {
  const tenantId = getTenantId(req);
  const attachmentId = cleanString(req.params?.id);

  if (!tenantId) {
    return res.status(400).json({
      message: "Business context is required",
      code: "TENANT_CONTEXT_REQUIRED",
    });
  }

  if (!attachmentId) {
    return res.status(400).json({
      message: "Attachment id is required",
      code: "SUPPORT_ATTACHMENT_ID_REQUIRED",
    });
  }

  try {
    const attachment = await prisma.supportAttachment.findFirst({
      where: {
        id: attachmentId,
        ticket: {
          tenantId,
        },
      },
      select: {
        id: true,
        fileUrl: true,
        fileName: true,
        fileType: true,
        fileSize: true,
      },
    });

    if (!attachment) {
      return res.status(404).json({
        message: "Support attachment not found",
        code: "SUPPORT_ATTACHMENT_NOT_FOUND",
      });
    }

    const storageKey = extractStorageKey(attachment.fileUrl);

    if (!storageKey) {
      return res.status(400).json({
        message: "Support attachment storage key is missing",
        code: "SUPPORT_ATTACHMENT_STORAGE_KEY_MISSING",
      });
    }

    const downloadUrl = await createSignedDownloadUrl(storageKey);

    return res.json({
      downloadUrl,
      attachment: {
        ...attachment,
        storageKey,
      },
    });
  } catch (err) {
    console.error("getSupportAttachmentDownloadUrl error:", err);

    return res.status(500).json({
      message: "Failed to prepare support attachment download",
      code: "SUPPORT_ATTACHMENT_DOWNLOAD_PREPARE_FAILED",
    });
  }
}

module.exports = {
  createSupportAttachmentUpload,
  getSupportAttachmentDownloadUrl,
};