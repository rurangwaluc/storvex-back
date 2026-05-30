"use strict";

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;

  const clean = Math.floor(n);
  return clean > 0 ? clean : fallback;
}

function parsePagination(query = {}, options = {}) {
  const defaultLimit = toPositiveInt(options.defaultLimit, 30);
  const maxLimit = toPositiveInt(options.maxLimit, 100);

  const requestedLimit = toPositiveInt(query.limit, defaultLimit);
  const limit = Math.min(requestedLimit, maxLimit);

  const page = toPositiveInt(query.page, 1);
  const skip = (page - 1) * limit;

  return {
    page,
    limit,
    skip,
  };
}

function buildPaginationMeta({ page, limit, total }) {
  const safeTotal = Number.isFinite(Number(total)) ? Number(total) : 0;
  const totalPages = Math.max(1, Math.ceil(safeTotal / limit));

  return {
    page,
    limit,
    total: safeTotal,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
    nextPage: page < totalPages ? page + 1 : null,
    previousPage: page > 1 ? page - 1 : null,
  };
}

module.exports = {
  parsePagination,
  buildPaginationMeta,
};