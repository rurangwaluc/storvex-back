// src/config/plans.js

const CURRENCY = String(process.env.BILLING_CURRENCY || "RWF").toUpperCase();
const TRIAL_PLAN_KEY = "TRIAL";
const ENTERPRISE_PLAN_KEY = "ENTERPRISE";

const TIER_KEYS = Object.freeze({
  TRIAL: "TRIAL",
  SOLO: "SOLO",
  DUO: "DUO",
  TEAM_3: "TEAM_3",
  TEAM_4: "TEAM_4",
  TEAM_5: "TEAM_5",
  TEAM_10: "TEAM_10",
  ENTERPRISE: "ENTERPRISE",
});

const CYCLE_KEYS = Object.freeze({
  TRIAL: "TRIAL",
  M1: "M1",
  M3: "M3",
  M6: "M6",
  Y1: "Y1",
  CUSTOM: "CUSTOM",
});

function getTrialDays() {
  const trialDays = Number(process.env.TRIAL_DAYS || 30);
  return Number.isFinite(trialDays) && trialDays > 0 ? trialDays : 30;
}

function getGraceDays() {
  const graceDays = Number(process.env.GRACE_DAYS || 3);
  return Number.isFinite(graceDays) && graceDays >= 0 ? graceDays : 3;
}

function getTrialStaffLimit() {
  const n = Number(process.env.TRIAL_STAFF_LIMIT || 3);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3;
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

const PAID_PLANS = Object.freeze([
  {
    key: "SOLO_M1",
    tierKey: TIER_KEYS.SOLO,
    cycleKey: CYCLE_KEYS.M1,
    label: "Solo • Monthly",
    tierLabel: "Solo",
    cycleLabel: "Monthly",
    days: 30,
    price: money(15000),
    currency: CURRENCY,
    staffLimit: 1,
    isEnterprise: false,
  },
  {
    key: "SOLO_M3",
    tierKey: TIER_KEYS.SOLO,
    cycleKey: CYCLE_KEYS.M3,
    label: "Solo • 3 Months",
    tierLabel: "Solo",
    cycleLabel: "3 Months",
    days: 90,
    price: money(40500),
    currency: CURRENCY,
    staffLimit: 1,
    isEnterprise: false,
  },
  {
    key: "SOLO_M6",
    tierKey: TIER_KEYS.SOLO,
    cycleKey: CYCLE_KEYS.M6,
    label: "Solo • 6 Months",
    tierLabel: "Solo",
    cycleLabel: "6 Months",
    days: 180,
    price: money(76500),
    currency: CURRENCY,
    staffLimit: 1,
    isEnterprise: false,
  },
  {
    key: "SOLO_Y1",
    tierKey: TIER_KEYS.SOLO,
    cycleKey: CYCLE_KEYS.Y1,
    label: "Solo • 1 Year",
    tierLabel: "Solo",
    cycleLabel: "1 Year",
    days: 365,
    price: money(144000),
    currency: CURRENCY,
    staffLimit: 1,
    isEnterprise: false,
  },

  {
    key: "DUO_M1",
    tierKey: TIER_KEYS.DUO,
    cycleKey: CYCLE_KEYS.M1,
    label: "Duo • Monthly",
    tierLabel: "Duo",
    cycleLabel: "Monthly",
    days: 30,
    price: money(25000),
    currency: CURRENCY,
    staffLimit: 2,
    isEnterprise: false,
  },
  {
    key: "DUO_M3",
    tierKey: TIER_KEYS.DUO,
    cycleKey: CYCLE_KEYS.M3,
    label: "Duo • 3 Months",
    tierLabel: "Duo",
    cycleLabel: "3 Months",
    days: 90,
    price: money(67500),
    currency: CURRENCY,
    staffLimit: 2,
    isEnterprise: false,
  },
  {
    key: "DUO_M6",
    tierKey: TIER_KEYS.DUO,
    cycleKey: CYCLE_KEYS.M6,
    label: "Duo • 6 Months",
    tierLabel: "Duo",
    cycleLabel: "6 Months",
    days: 180,
    price: money(127500),
    currency: CURRENCY,
    staffLimit: 2,
    isEnterprise: false,
  },
  {
    key: "DUO_Y1",
    tierKey: TIER_KEYS.DUO,
    cycleKey: CYCLE_KEYS.Y1,
    label: "Duo • 1 Year",
    tierLabel: "Duo",
    cycleLabel: "1 Year",
    days: 365,
    price: money(240000),
    currency: CURRENCY,
    staffLimit: 2,
    isEnterprise: false,
  },

  {
    key: "TEAM_3_M1",
    tierKey: TIER_KEYS.TEAM_3,
    cycleKey: CYCLE_KEYS.M1,
    label: "Team 3 • Monthly",
    tierLabel: "Team 3",
    cycleLabel: "Monthly",
    days: 30,
    price: money(35000),
    currency: CURRENCY,
    staffLimit: 3,
    isEnterprise: false,
  },
  {
    key: "TEAM_3_M3",
    tierKey: TIER_KEYS.TEAM_3,
    cycleKey: CYCLE_KEYS.M3,
    label: "Team 3 • 3 Months",
    tierLabel: "Team 3",
    cycleLabel: "3 Months",
    days: 90,
    price: money(94500),
    currency: CURRENCY,
    staffLimit: 3,
    isEnterprise: false,
  },
  {
    key: "TEAM_3_M6",
    tierKey: TIER_KEYS.TEAM_3,
    cycleKey: CYCLE_KEYS.M6,
    label: "Team 3 • 6 Months",
    tierLabel: "Team 3",
    cycleLabel: "6 Months",
    days: 180,
    price: money(178500),
    currency: CURRENCY,
    staffLimit: 3,
    isEnterprise: false,
  },
  {
    key: "TEAM_3_Y1",
    tierKey: TIER_KEYS.TEAM_3,
    cycleKey: CYCLE_KEYS.Y1,
    label: "Team 3 • 1 Year",
    tierLabel: "Team 3",
    cycleLabel: "1 Year",
    days: 365,
    price: money(336000),
    currency: CURRENCY,
    staffLimit: 3,
    isEnterprise: false,
  },

  {
    key: "TEAM_4_M1",
    tierKey: TIER_KEYS.TEAM_4,
    cycleKey: CYCLE_KEYS.M1,
    label: "Team 4 • Monthly",
    tierLabel: "Team 4",
    cycleLabel: "Monthly",
    days: 30,
    price: money(45000),
    currency: CURRENCY,
    staffLimit: 4,
    isEnterprise: false,
  },
  {
    key: "TEAM_4_M3",
    tierKey: TIER_KEYS.TEAM_4,
    cycleKey: CYCLE_KEYS.M3,
    label: "Team 4 • 3 Months",
    tierLabel: "Team 4",
    cycleLabel: "3 Months",
    days: 90,
    price: money(121500),
    currency: CURRENCY,
    staffLimit: 4,
    isEnterprise: false,
  },
  {
    key: "TEAM_4_M6",
    tierKey: TIER_KEYS.TEAM_4,
    cycleKey: CYCLE_KEYS.M6,
    label: "Team 4 • 6 Months",
    tierLabel: "Team 4",
    cycleLabel: "6 Months",
    days: 180,
    price: money(229500),
    currency: CURRENCY,
    staffLimit: 4,
    isEnterprise: false,
  },
  {
    key: "TEAM_4_Y1",
    tierKey: TIER_KEYS.TEAM_4,
    cycleKey: CYCLE_KEYS.Y1,
    label: "Team 4 • 1 Year",
    tierLabel: "Team 4",
    cycleLabel: "1 Year",
    days: 365,
    price: money(432000),
    currency: CURRENCY,
    staffLimit: 4,
    isEnterprise: false,
  },

  {
    key: "TEAM_5_M1",
    tierKey: TIER_KEYS.TEAM_5,
    cycleKey: CYCLE_KEYS.M1,
    label: "Team 5 • Monthly",
    tierLabel: "Team 5",
    cycleLabel: "Monthly",
    days: 30,
    price: money(55000),
    currency: CURRENCY,
    staffLimit: 5,
    isEnterprise: false,
  },
  {
    key: "TEAM_5_M3",
    tierKey: TIER_KEYS.TEAM_5,
    cycleKey: CYCLE_KEYS.M3,
    label: "Team 5 • 3 Months",
    tierLabel: "Team 5",
    cycleLabel: "3 Months",
    days: 90,
    price: money(148500),
    currency: CURRENCY,
    staffLimit: 5,
    isEnterprise: false,
  },
  {
    key: "TEAM_5_M6",
    tierKey: TIER_KEYS.TEAM_5,
    cycleKey: CYCLE_KEYS.M6,
    label: "Team 5 • 6 Months",
    tierLabel: "Team 5",
    cycleLabel: "6 Months",
    days: 180,
    price: money(280500),
    currency: CURRENCY,
    staffLimit: 5,
    isEnterprise: false,
  },
  {
    key: "TEAM_5_Y1",
    tierKey: TIER_KEYS.TEAM_5,
    cycleKey: CYCLE_KEYS.Y1,
    label: "Team 5 • 1 Year",
    tierLabel: "Team 5",
    cycleLabel: "1 Year",
    days: 365,
    price: money(528000),
    currency: CURRENCY,
    staffLimit: 5,
    isEnterprise: false,
  },

  {
    key: "TEAM_10_M1",
    tierKey: TIER_KEYS.TEAM_10,
    cycleKey: CYCLE_KEYS.M1,
    label: "Team 10 • Monthly",
    tierLabel: "Team 10",
    cycleLabel: "Monthly",
    days: 30,
    price: money(95000),
    currency: CURRENCY,
    staffLimit: 10,
    isEnterprise: false,
  },
  {
    key: "TEAM_10_M3",
    tierKey: TIER_KEYS.TEAM_10,
    cycleKey: CYCLE_KEYS.M3,
    label: "Team 10 • 3 Months",
    tierLabel: "Team 10",
    cycleLabel: "3 Months",
    days: 90,
    price: money(256500),
    currency: CURRENCY,
    staffLimit: 10,
    isEnterprise: false,
  },
  {
    key: "TEAM_10_M6",
    tierKey: TIER_KEYS.TEAM_10,
    cycleKey: CYCLE_KEYS.M6,
    label: "Team 10 • 6 Months",
    tierLabel: "Team 10",
    cycleLabel: "6 Months",
    days: 180,
    price: money(484500),
    currency: CURRENCY,
    staffLimit: 10,
    isEnterprise: false,
  },
  {
    key: "TEAM_10_Y1",
    tierKey: TIER_KEYS.TEAM_10,
    cycleKey: CYCLE_KEYS.Y1,
    label: "Team 10 • 1 Year",
    tierLabel: "Team 10",
    cycleLabel: "1 Year",
    days: 365,
    price: money(912000),
    currency: CURRENCY,
    staffLimit: 10,
    isEnterprise: false,
  },

  {
    key: ENTERPRISE_PLAN_KEY,
    tierKey: TIER_KEYS.ENTERPRISE,
    cycleKey: CYCLE_KEYS.CUSTOM,
    label: "Enterprise • Custom",
    tierLabel: "Enterprise",
    cycleLabel: "Custom",
    days: 30,
    price: 0,
    currency: CURRENCY,
    staffLimit: null,
    isEnterprise: true,
  },
]);

function getTrialPlan() {
  return {
    key: TRIAL_PLAN_KEY,
    tierKey: TIER_KEYS.TRIAL,
    cycleKey: CYCLE_KEYS.TRIAL,
    label: "Free Trial",
    tierLabel: "Free Trial",
    cycleLabel: "30 Days",
    days: getTrialDays(),
    price: 0,
    currency: CURRENCY,
    staffLimit: getTrialStaffLimit(),
    isEnterprise: false,
  };
}

function getPaidPlans() {
  return PAID_PLANS;
}

function getAllPlans() {
  return [getTrialPlan(), ...PAID_PLANS];
}

function normalizeKey(value) {
  return String(value || "").trim().toUpperCase();
}

function getPlanByKey(planKey) {
  const key = normalizeKey(planKey);
  if (!key) return null;
  if (key === TRIAL_PLAN_KEY) return getTrialPlan();
  return PAID_PLANS.find((p) => p.key === key) || null;
}

function getPlansByTierKey(tierKey) {
  const key = normalizeKey(tierKey);
  return PAID_PLANS.filter((p) => p.tierKey === key);
}

function getPlansByCycleKey(cycleKey) {
  const key = normalizeKey(cycleKey);
  return PAID_PLANS.filter((p) => p.cycleKey === key);
}

function getPlanByTierAndCycle(tierKey, cycleKey) {
  const tier = normalizeKey(tierKey);
  const cycle = normalizeKey(cycleKey);
  return PAID_PLANS.find((p) => p.tierKey === tier && p.cycleKey === cycle) || null;
}

function isTrialPlanKey(planKey) {
  return normalizeKey(planKey) === TRIAL_PLAN_KEY;
}

function isEnterprisePlanKey(planKey) {
  return normalizeKey(planKey) === ENTERPRISE_PLAN_KEY;
}

function getStaffLimitForPlanKey(planKey) {
  const plan = getPlanByKey(planKey);
  return plan?.staffLimit ?? null;
}

function getPriceForPlanKey(planKey) {
  const plan = getPlanByKey(planKey);
  return plan?.price ?? null;
}

function getPlanSnapshot(planKey) {
  const plan = getPlanByKey(planKey);
  if (!plan) return null;

  return {
    planKey: plan.key,
    tierKey: plan.tierKey,
    cycleKey: plan.cycleKey,
    label: plan.label,
    tierLabel: plan.tierLabel,
    cycleLabel: plan.cycleLabel,
    days: plan.days,
    price: plan.price,
    currency: plan.currency,
    staffLimit: plan.staffLimit,
    isEnterprise: Boolean(plan.isEnterprise),
  };
}

module.exports = {
  CURRENCY,
  TRIAL_PLAN_KEY,
  ENTERPRISE_PLAN_KEY,
  TIER_KEYS,
  CYCLE_KEYS,
  getTrialDays,
  getGraceDays,
  getTrialStaffLimit,
  getTrialPlan,
  getPaidPlans,
  getAllPlans,
  getPlanByKey,
  getPlansByTierKey,
  getPlansByCycleKey,
  getPlanByTierAndCycle,
  isTrialPlanKey,
  isEnterprisePlanKey,
  getStaffLimitForPlanKey,
  getPriceForPlanKey,
  getPlanSnapshot,
};