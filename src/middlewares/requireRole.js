module.exports = (...allowedRoles) => {
  return (req, res, next) => {
    const role = req.user?.role;

    if (!role) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    next();
  };
};





// module.exports = function requireRole(...allowedRoles) {
//   return function (req, res, next) {
 
//   if (!req.user) {
//       return res.status(401).json({ message: "Unauthenticated" });
//     }

//     const { role } = req.user;

//     if (!allowedRoles.includes(role)) {
//       return res.status(403).json({
//         message: "Insufficient permissions",
//       });
//     }

//     next();
//   };
// };
