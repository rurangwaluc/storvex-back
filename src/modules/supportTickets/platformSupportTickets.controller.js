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

function getPlatformUser(req) {
  return req.platformUser || req.user || null;
}

function getPlatformUserId(req) {
  return cleanString(getPlatformUser(req)?.id);
}

function normalizeEnum(value, enumObject) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return null;
  return Object.values(enumObject).includes(raw) ? raw : null;
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

    tenant: {
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        shopType: true,
        district: true,
        sector: true,
        address: true,
        createdAt: true,
      },
    },

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

async function getPlatformSupportTicketsOverview(req, res) {
  try {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
      total,
      open,
      inProgress,
      waitingForTenant,
      resolved,
      closed,
      urgent,
      businessBlocked,
      last24Hours,
      unassigned,
      recentTickets,
    ] = await Promise.all([
      prisma.supportTicket.count(),
      prisma.supportTicket.count({ where: { status: SupportTicketStatus.OPEN } }),
      prisma.supportTicket.count({ where: { status: SupportTicketStatus.IN_PROGRESS } }),
      prisma.supportTicket.count({ where: { status: SupportTicketStatus.WAITING_FOR_TENANT } }),
      prisma.supportTicket.count({ where: { status: SupportTicketStatus.RESOLVED } }),
      prisma.supportTicket.count({ where: { status: SupportTicketStatus.CLOSED } }),
      prisma.supportTicket.count({ where: { priority: SupportTicketPriority.URGENT } }),
      prisma.supportTicket.count({ where: { priority: SupportTicketPriority.BUSINESS_BLOCKED } }),
      prisma.supportTicket.count({ where: { createdAt: { gte: yesterday } } }),
      prisma.supportTicket.count({
        where: {
          assignedToPlatformUserId: null,
          status: {
            in: [
              SupportTicketStatus.OPEN,
              SupportTicketStatus.IN_PROGRESS,
              SupportTicketStatus.WAITING_FOR_TENANT,
            ],
          },
        },
      }),
      prisma.supportTicket.findMany({
        orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
        take: 10,
        select: ticketSelect(),
      }),
    ]);

    return res.json({
      overview: {
        total,
        status: {
          open,
          inProgress,
          waitingForTenant,
          resolved,
          closed,
        },
        priority: {
          urgent,
          businessBlocked,
        },
        last24Hours,
        unassigned,
        needsAttention: open + inProgress + waitingForTenant + businessBlocked,
        recentTickets,
      },
    });
  } catch (err) {
    console.error("getPlatformSupportTicketsOverview error:", err);
    return res.status(500).json({
      message: "Failed to load support tickets overview",
      code: "PLATFORM_SUPPORT_TICKETS_OVERVIEW_FAILED",
    });
  }
}

async function listPlatformSupportTickets(req, res) {
  try {
    const q = cleanString(req.query?.q);
    const tenantId = cleanString(req.query?.tenantId);
    const assignedToPlatformUserId = cleanString(
      req.query?.assignedToPlatformUserId
    );

    const status = normalizeEnum(req.query?.status, SupportTicketStatus);
    const category = normalizeEnum(req.query?.category, SupportTicketCategory);
    const priority = normalizeEnum(req.query?.priority, SupportTicketPriority);

    const take = safeTake(req.query?.take, 20, 100);
    const skip = safeSkip(req.query?.skip);

    const where = {
      ...(tenantId ? { tenantId } : {}),
      ...(assignedToPlatformUserId ? { assignedToPlatformUserId } : {}),
      ...(status ? { status } : {}),
      ...(category ? { category } : {}),
      ...(priority ? { priority } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              {
                tenant: {
                  OR: [
                    { name: { contains: q, mode: "insensitive" } },
                    { email: { contains: q, mode: "insensitive" } },
                    { phone: { contains: q, mode: "insensitive" } },
                  ],
                },
              },
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
    console.error("listPlatformSupportTickets error:", err);
    return res.status(500).json({
      message: "Failed to load support tickets",
      code: "PLATFORM_SUPPORT_TICKETS_LIST_FAILED",
    });
  }
}

async function getPlatformSupportTicketById(req, res) {
  const ticketId = cleanString(req.params?.id);

  if (!ticketId) {
    return res.status(400).json({
      message: "Ticket id is required",
      code: "SUPPORT_TICKET_ID_REQUIRED",
    });
  }

  try {
    const ticket = await prisma.supportTicket.findFirst({
      where: { id: ticketId },
      select: {
        ...ticketSelect(),
        messages: {
          orderBy: { createdAt: "asc" },
          select: messageSelect(),
        },
        attachments: {
          orderBy: { createdAt: "desc" },
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
    console.error("getPlatformSupportTicketById error:", err);
    return res.status(500).json({
      message: "Failed to load support ticket",
      code: "PLATFORM_SUPPORT_TICKET_DETAIL_FAILED",
    });
  }
}

async function replyToPlatformSupportTicket(req, res) {
  const platformUserId = getPlatformUserId(req);
  const ticketId = cleanString(req.params?.id);
  const message = cleanString(req.body?.message);
  const attachments = attachmentInputList(req.body?.attachments);

  if (!platformUserId) {
    return res.status(400).json({
      message: "Platform user context is required",
      code: "PLATFORM_USER_CONTEXT_REQUIRED",
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
        where: { id: ticketId },
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
          senderType: "PLATFORM_USER",
          platformUserId,
          message,
        },
        select: { id: true },
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
          status: SupportTicketStatus.WAITING_FOR_TENANT,
          lastMessageAt: new Date(),
        },
      });

      return { messageId: supportMessage.id };
    });

    const supportMessage = await prisma.supportMessage.findFirst({
      where: {
        id: created.messageId,
        ticketId,
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

    console.error("replyToPlatformSupportTicket error:", err);
    return res.status(500).json({
      message: "Failed to add support reply",
      code: "PLATFORM_SUPPORT_TICKET_REPLY_FAILED",
    });
  }
}

async function updatePlatformSupportTicketStatus(req, res) {
  const ticketId = cleanString(req.params?.id);
  const nextStatus = normalizeEnum(req.body?.status, SupportTicketStatus);

  if (!ticketId) {
    return res.status(400).json({
      message: "Ticket id is required",
      code: "SUPPORT_TICKET_ID_REQUIRED",
    });
  }

  if (!nextStatus) {
    return res.status(400).json({
      message: `status must be one of ${Object.values(SupportTicketStatus).join(", ")}`,
      code: "INVALID_SUPPORT_TICKET_STATUS",
    });
  }

  try {
    const ticket = await prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        status: nextStatus,
        ...(nextStatus === SupportTicketStatus.RESOLVED
          ? { resolvedAt: new Date() }
          : { resolvedAt: null }),
        ...(nextStatus === SupportTicketStatus.CLOSED
          ? { closedAt: new Date() }
          : { closedAt: null }),
      },
      select: ticketSelect(),
    });

    return res.json({
      message: "Support ticket status updated",
      ticket,
    });
  } catch (err) {
    if (err?.code === "P2025") {
      return res.status(404).json({
        message: "Support ticket not found",
        code: "SUPPORT_TICKET_NOT_FOUND",
      });
    }

    console.error("updatePlatformSupportTicketStatus error:", err);
    return res.status(500).json({
      message: "Failed to update support ticket status",
      code: "PLATFORM_SUPPORT_TICKET_STATUS_UPDATE_FAILED",
    });
  }
}

async function assignPlatformSupportTicket(req, res) {
  const ticketId = cleanString(req.params?.id);
  const assignedToPlatformUserId = cleanString(
    req.body?.assignedToPlatformUserId
  );

  if (!ticketId) {
    return res.status(400).json({
      message: "Ticket id is required",
      code: "SUPPORT_TICKET_ID_REQUIRED",
    });
  }

  try {
    const ticket = await prisma.$transaction(async (tx) => {
      if (assignedToPlatformUserId) {
        const platformUser = await tx.platformUser.findFirst({
          where: {
            id: assignedToPlatformUserId,
            isActive: true,
          },
          select: { id: true },
        });

        if (!platformUser) {
          const err = new Error("PLATFORM_USER_NOT_FOUND");
          err.code = "PLATFORM_USER_NOT_FOUND";
          throw err;
        }
      }

      return tx.supportTicket.update({
        where: { id: ticketId },
        data: {
          assignedToPlatformUserId: assignedToPlatformUserId || null,
          status: assignedToPlatformUserId
            ? SupportTicketStatus.IN_PROGRESS
            : SupportTicketStatus.OPEN,
        },
        select: ticketSelect(),
      });
    });

    return res.json({
      message: assignedToPlatformUserId
        ? "Support ticket assigned"
        : "Support ticket unassigned",
      ticket,
    });
  } catch (err) {
    if (err?.code === "PLATFORM_USER_NOT_FOUND") {
      return res.status(404).json({
        message: "Platform user not found or inactive",
        code: "PLATFORM_USER_NOT_FOUND",
      });
    }

    if (err?.code === "P2025") {
      return res.status(404).json({
        message: "Support ticket not found",
        code: "SUPPORT_TICKET_NOT_FOUND",
      });
    }

    console.error("assignPlatformSupportTicket error:", err);
    return res.status(500).json({
      message: "Failed to assign support ticket",
      code: "PLATFORM_SUPPORT_TICKET_ASSIGN_FAILED",
    });
  }
}

module.exports = {
  getPlatformSupportTicketsOverview,
  listPlatformSupportTickets,
  getPlatformSupportTicketById,
  replyToPlatformSupportTicket,
  updatePlatformSupportTicketStatus,
  assignPlatformSupportTicket,
};