const prisma = require("../../config/database");
const {
  SupportTicketCategory,
  SupportTicketPriority,
  SupportTicketStatus,
} = require("@prisma/client");

function cleanString(value) {
  const s = String(value || "").trim();
  return s || null;
}

function safeTake(value, fallback = 20, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), max);
}

function safeSkip(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(Math.trunc(n), 0);
}

function getTenantId(req) {
  return cleanString(req.tenant?.id || req.user?.tenantId);
}

function getTenantUserId(req) {
  return cleanString(req.user?.id);
}

function normalizeCategory(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return SupportTicketCategory.OTHER;

  return Object.values(SupportTicketCategory).includes(raw)
    ? raw
    : SupportTicketCategory.OTHER;
}

function normalizePriority(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return SupportTicketPriority.NORMAL;

  return Object.values(SupportTicketPriority).includes(raw)
    ? raw
    : SupportTicketPriority.NORMAL;
}

function normalizeStatus(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return null;

  return Object.values(SupportTicketStatus).includes(raw) ? raw : null;
}

function ticketSelect() {
  return {
    id: true,
    tenantId: true,
    createdByUserId: true,
    assignedToPlatformUserId: true,
    title: true,
    category: true,
    priority: true,
    status: true,
    lastMessageAt: true,
    resolvedAt: true,
    closedAt: true,
    createdAt: true,
    updatedAt: true,

    createdBy: {
      select: {
        id: true,
        tenantId: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
      },
    },

    assignedToPlatformUser: {
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
      },
    },

    _count: {
      select: {
        messages: true,
        attachments: true,
      },
    },
  };
}

function messageSelect() {
  return {
    id: true,
    ticketId: true,
    senderType: true,
    tenantUserId: true,
    platformUserId: true,
    message: true,
    createdAt: true,

    tenantUser: {
      select: {
        id: true,
        tenantId: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
      },
    },

    platformUser: {
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
      },
    },

    attachments: {
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        ticketId: true,
        messageId: true,
        fileUrl: true,
        fileName: true,
        fileType: true,
        fileSize: true,
        createdAt: true,
      },
    },
  };
}

function attachmentSelect() {
  return {
    id: true,
    ticketId: true,
    messageId: true,
    fileUrl: true,
    fileName: true,
    fileType: true,
    fileSize: true,
    createdAt: true,
  };
}

function attachmentInputList(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => ({
      fileUrl: cleanString(item?.fileUrl),
      fileName: cleanString(item?.fileName),
      fileType: cleanString(item?.fileType),
      fileSize: Number.isFinite(Number(item?.fileSize))
        ? Math.max(Math.trunc(Number(item.fileSize)), 0)
        : null,
    }))
    .filter((item) => item.fileUrl)
    .slice(0, 5);
}

async function listMySupportTickets(req, res) {
  const tenantId = getTenantId(req);

  if (!tenantId) {
    return res.status(400).json({
      message: "Business context is required",
      code: "TENANT_CONTEXT_REQUIRED",
    });
  }

  try {
    const q = cleanString(req.query?.q);
    const status = normalizeStatus(req.query?.status);
    const take = safeTake(req.query?.take, 20, 100);
    const skip = safeSkip(req.query?.skip);

    const where = {
      tenantId,
      ...(status ? { status } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              {
                messages: {
                  some: {
                    message: { contains: q, mode: "insensitive" },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [tickets, count] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
        skip,
        take,
        select: ticketSelect(),
      }),
      prisma.supportTicket.count({ where }),
    ]);

    return res.json({
      tickets,
      count,
      page: {
        skip,
        take,
        returned: tickets.length,
        hasMore: skip + tickets.length < count,
      },
    });
  } catch (err) {
    console.error("listMySupportTickets error:", err);
    return res.status(500).json({
      message: "Failed to load support tickets",
      code: "SUPPORT_TICKETS_LIST_FAILED",
    });
  }
}

async function createSupportTicket(req, res) {
  const tenantId = getTenantId(req);
  const userId = getTenantUserId(req);

  if (!tenantId || !userId) {
    return res.status(400).json({
      message: "Business user context is required",
      code: "TENANT_USER_CONTEXT_REQUIRED",
    });
  }

  const title = cleanString(req.body?.title);
  const message = cleanString(req.body?.message);
  const category = normalizeCategory(req.body?.category);
  const priority = normalizePriority(req.body?.priority);
  const attachments = attachmentInputList(req.body?.attachments);

  if (!title || title.length < 4) {
    return res.status(400).json({
      message: "Ticket title must be at least 4 characters",
      code: "SUPPORT_TICKET_TITLE_REQUIRED",
    });
  }

  if (!message || message.length < 5) {
    return res.status(400).json({
      message: "Support message must be at least 5 characters",
      code: "SUPPORT_MESSAGE_REQUIRED",
    });
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const now = new Date();

      const ticket = await tx.supportTicket.create({
        data: {
          tenantId,
          createdByUserId: userId,
          title,
          category,
          priority,
          status: SupportTicketStatus.OPEN,
          lastMessageAt: now,
        },
        select: {
          id: true,
        },
      });

      const supportMessage = await tx.supportMessage.create({
        data: {
          ticketId: ticket.id,
          senderType: "TENANT_USER",
          tenantUserId: userId,
          message,
        },
        select: {
          id: true,
        },
      });

      if (attachments.length) {
        await tx.supportAttachment.createMany({
          data: attachments.map((attachment) => ({
            ticketId: ticket.id,
            messageId: supportMessage.id,
            fileUrl: attachment.fileUrl,
            fileName: attachment.fileName,
            fileType: attachment.fileType,
            fileSize: attachment.fileSize,
          })),
        });
      }

      return {
        ticketId: ticket.id,
        messageId: supportMessage.id,
      };
    });

    const [ticket, supportMessage] = await Promise.all([
      prisma.supportTicket.findFirst({
        where: {
          id: created.ticketId,
          tenantId,
        },
        select: ticketSelect(),
      }),
      prisma.supportMessage.findFirst({
        where: {
          id: created.messageId,
          ticket: {
            tenantId,
          },
        },
        select: messageSelect(),
      }),
    ]);

    return res.status(201).json({
      message: "Support ticket created",
      ticket,
      supportMessage,
    });
  } catch (err) {
    console.error("createSupportTicket error:", err);
    return res.status(500).json({
      message: "Failed to create support ticket",
      code: "SUPPORT_TICKET_CREATE_FAILED",
    });
  }
}

async function getMySupportTicketById(req, res) {
  const tenantId = getTenantId(req);
  const ticketId = cleanString(req.params?.id);

  if (!tenantId) {
    return res.status(400).json({
      message: "Business context is required",
      code: "TENANT_CONTEXT_REQUIRED",
    });
  }

  if (!ticketId) {
    return res.status(400).json({
      message: "Ticket id is required",
      code: "SUPPORT_TICKET_ID_REQUIRED",
    });
  }

  try {
    const ticket = await prisma.supportTicket.findFirst({
      where: { id: ticketId, tenantId },
      select: {
        ...ticketSelect(),
        messages: {
          orderBy: { createdAt: "asc" },
          select: messageSelect(),
        },
        attachments: {
          orderBy: { createdAt: "desc" },
          select: attachmentSelect(),
        },
      },
    });

    if (!ticket) {
      return res.status(404).json({
        message: "Support ticket not found",
        code: "SUPPORT_TICKET_NOT_FOUND",
      });
    }

    return res.json({ ticket });
  } catch (err) {
    console.error("getMySupportTicketById error:", err);
    return res.status(500).json({
      message: "Failed to load support ticket",
      code: "SUPPORT_TICKET_DETAIL_FAILED",
    });
  }
}

async function replyToMySupportTicket(req, res) {
  const tenantId = getTenantId(req);
  const userId = getTenantUserId(req);
  const ticketId = cleanString(req.params?.id);
  const message = cleanString(req.body?.message);
  const attachments = attachmentInputList(req.body?.attachments);

  if (!tenantId || !userId) {
    return res.status(400).json({
      message: "Business user context is required",
      code: "TENANT_USER_CONTEXT_REQUIRED",
    });
  }

  if (!ticketId) {
    return res.status(400).json({
      message: "Ticket id is required",
      code: "SUPPORT_TICKET_ID_REQUIRED",
    });
  }

  if (!message || message.length < 2) {
    return res.status(400).json({
      message: "Message is required",
      code: "SUPPORT_MESSAGE_REQUIRED",
    });
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const ticket = await tx.supportTicket.findFirst({
        where: { id: ticketId, tenantId },
        select: {
          id: true,
          status: true,
        },
      });

      if (!ticket) {
        const err = new Error("SUPPORT_TICKET_NOT_FOUND");
        err.code = "SUPPORT_TICKET_NOT_FOUND";
        throw err;
      }

      if (ticket.status === SupportTicketStatus.CLOSED) {
        const err = new Error("SUPPORT_TICKET_CLOSED");
        err.code = "SUPPORT_TICKET_CLOSED";
        throw err;
      }

      const supportMessage = await tx.supportMessage.create({
        data: {
          ticketId,
          senderType: "TENANT_USER",
          tenantUserId: userId,
          message,
        },
        select: {
          id: true,
        },
      });

      if (attachments.length) {
        await tx.supportAttachment.createMany({
          data: attachments.map((attachment) => ({
            ticketId,
            messageId: supportMessage.id,
            fileUrl: attachment.fileUrl,
            fileName: attachment.fileName,
            fileType: attachment.fileType,
            fileSize: attachment.fileSize,
          })),
        });
      }

      await tx.supportTicket.update({
        where: { id: ticketId },
        data: {
          status:
            ticket.status === SupportTicketStatus.RESOLVED
              ? SupportTicketStatus.OPEN
              : ticket.status === SupportTicketStatus.WAITING_FOR_TENANT
                ? SupportTicketStatus.IN_PROGRESS
                : ticket.status,
          lastMessageAt: new Date(),
        },
      });

      return {
        messageId: supportMessage.id,
      };
    });

    const supportMessage = await prisma.supportMessage.findFirst({
      where: {
        id: created.messageId,
        ticket: {
          tenantId,
        },
      },
      select: messageSelect(),
    });

    return res.status(201).json({
      message: "Reply added",
      supportMessage,
    });
  } catch (err) {
    if (err?.code === "SUPPORT_TICKET_NOT_FOUND") {
      return res.status(404).json({
        message: "Support ticket not found",
        code: "SUPPORT_TICKET_NOT_FOUND",
      });
    }

    if (err?.code === "SUPPORT_TICKET_CLOSED") {
      return res.status(409).json({
        message: "This support ticket is already closed",
        code: "SUPPORT_TICKET_CLOSED",
      });
    }

    console.error("replyToMySupportTicket error:", err);
    return res.status(500).json({
      message: "Failed to add support reply",
      code: "SUPPORT_TICKET_REPLY_FAILED",
    });
  }
}

async function closeMySupportTicket(req, res) {
  const tenantId = getTenantId(req);
  const ticketId = cleanString(req.params?.id);

  if (!tenantId) {
    return res.status(400).json({
      message: "Business context is required",
      code: "TENANT_CONTEXT_REQUIRED",
    });
  }

  if (!ticketId) {
    return res.status(400).json({
      message: "Ticket id is required",
      code: "SUPPORT_TICKET_ID_REQUIRED",
    });
  }

  try {
    const existing = await prisma.supportTicket.findFirst({
      where: { id: ticketId, tenantId },
      select: { id: true },
    });

    if (!existing) {
      return res.status(404).json({
        message: "Support ticket not found",
        code: "SUPPORT_TICKET_NOT_FOUND",
      });
    }

    const ticket = await prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        status: SupportTicketStatus.CLOSED,
        closedAt: new Date(),
      },
      select: ticketSelect(),
    });

    return res.json({
      message: "Support ticket closed",
      ticket,
    });
  } catch (err) {
    console.error("closeMySupportTicket error:", err);
    return res.status(500).json({
      message: "Failed to close support ticket",
      code: "SUPPORT_TICKET_CLOSE_FAILED",
    });
  }
}

module.exports = {
  listMySupportTickets,
  createSupportTicket,
  getMySupportTicketById,
  replyToMySupportTicket,
  closeMySupportTicket,
};