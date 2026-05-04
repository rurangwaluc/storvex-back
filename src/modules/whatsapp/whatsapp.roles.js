/**
 * WhatsApp role groups
 *
 * Customer-facing strategy:
 * - One WhatsApp number per store/tenant.
 *
 * Internal Storvex rule:
 * - Owners/managers control setup, broadcasts, promotions, and account settings.
 * - Store staff can work inside inbox conversations when permitted.
 * - Business actions created from WhatsApp must still respect branch truth.
 */

/**
 * Can manage WhatsApp account settings, promotions, and broadcasts.
 *
 * Keep this strict. WhatsApp setup and mass messaging should not be open
 * to every staff role.
 */
const WHATSAPP_OWNER_ROLES = [
  "OWNER",
  "MANAGER",
];

/**
 * Can open and work inside the WhatsApp inbox.
 *
 * These roles may reply, view assigned/allowed conversations, and participate
 * in customer workflows depending on branch access.
 */
const WHATSAPP_WORKSPACE_ROLES = [
  "OWNER",
  "MANAGER",
  "CASHIER",
  "SELLER",
  "STOREKEEPER",
  "TECHNICIAN",
];

/**
 * Can be assigned to WhatsApp conversations.
 *
 * Keep this separate so we can later remove roles like STOREKEEPER or
 * TECHNICIAN from assignment without changing inbox access.
 */
const WHATSAPP_ASSIGNABLE_ROLES = [
  "OWNER",
  "MANAGER",
  "CASHIER",
  "SELLER",
  "STOREKEEPER",
  "TECHNICIAN",
];

module.exports = {
  WHATSAPP_OWNER_ROLES,
  WHATSAPP_WORKSPACE_ROLES,
  WHATSAPP_ASSIGNABLE_ROLES,
};