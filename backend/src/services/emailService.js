const sgMail = require("@sendgrid/mail");

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

async function send({ to, subject, text, html }) {
  if (!process.env.SENDGRID_API_KEY) {
    // Fails loudly in dev rather than silently pretending to send — flip this
    // on in your hosting provider's env vars once you have a SendGrid account.
    console.warn(`[emailService] SENDGRID_API_KEY not set — would have sent "${subject}" to ${to}`);
    return;
  }
  try {
    await sgMail.send({ to, from: process.env.EMAIL_FROM, subject, text, html: html || text });
  } catch (err) {
    console.error(`Failed to send email to ${to}:`, err.response?.body || err.message);
  }
}

const templates = {
  resetCode: (name, code) => ({
    subject: "Your Bank My Shift password reset code",
    text: `Hi ${name},\n\nYour password reset code is: ${code}\n\nThis code expires in ${process.env.RESET_TOKEN_EXPIRES_MIN || 30} minutes. If you didn't request this, you can ignore this email.`,
  }),
  newShift: (name, shift) => ({
    subject: `New bank shift available — ${shift.location_name}`,
    text: `Hi ${name},\n\nA new shift has been posted:\n${shift.location_name}, ${shift.date} ${shift.start_time}–${shift.end_time}\nPay: £${shift.pay_rate}/hr\n\nOpen the app to claim it.`,
  }),
  claimApproved: (name, shift) => ({
    subject: `You're confirmed — ${shift.location_name}`,
    text: `Hi ${name},\n\nYou're confirmed for the shift at ${shift.location_name} on ${shift.date}, ${shift.start_time}–${shift.end_time}.`,
  }),
  claimRejected: (name, shift) => ({
    subject: `Shift request update — ${shift.location_name}`,
    text: `Hi ${name},\n\nYour request for the shift at ${shift.location_name} on ${shift.date} wasn't approved this time. Check the app for other available shifts.`,
  }),
  shiftCancelled: (name, shift) => ({
    subject: `Shift cancelled — ${shift.location_name}`,
    text: `Hi ${name},\n\nYour shift at ${shift.location_name} on ${shift.date}, ${shift.start_time}–${shift.end_time} has been cancelled by your manager.`,
  }),
  reminder: (name, shift) => ({
    subject: `Reminder — your shift starts soon`,
    text: `Hi ${name},\n\nJust a reminder: your shift at ${shift.location_name} starts on ${shift.date} at ${shift.start_time}.`,
  }),
};

module.exports = {
  sendPasswordResetEmail: (to, name, code) => send({ to, ...templates.resetCode(name, code) }),
  sendNewShiftEmail: (to, name, shift) => send({ to, ...templates.newShift(name, shift) }),
  sendClaimApprovedEmail: (to, name, shift) => send({ to, ...templates.claimApproved(name, shift) }),
  sendClaimRejectedEmail: (to, name, shift) => send({ to, ...templates.claimRejected(name, shift) }),
  sendShiftCancelledEmail: (to, name, shift) => send({ to, ...templates.shiftCancelled(name, shift) }),
  sendReminderEmail: (to, name, shift) => send({ to, ...templates.reminder(name, shift) }),
};
