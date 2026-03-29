// src/modules/notifications/index.js
const { sendEmailOtp } = require("./email.provider");
const { sendSmsOtp } = require("./sms.provider");

module.exports = {
  sendEmailOtp,
  sendSmsOtp,
};