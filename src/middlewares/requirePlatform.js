module.exports = function requirePlatform(req, res, next) {
  if (!req.platformUser || req.user?.platform !== true) {
    return res.status(403).json({
      message: "Platform access only",
      code: "PLATFORM_ACCESS_ONLY",
    });
  }

  return next();
};