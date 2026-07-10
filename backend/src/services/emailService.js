// Sends via Brevo's transactional email REST API directly (no SDK dependency —
// just Node's built-in fetch), since it's a single simple POST. Switched from
// SendGrid because SendGrid kept flagging/banning this account during setup.
const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

async function send({ to, subject, text, html }) {
  if (!process.env.BREVO_API_KEY) {
    // Fails loudly in dev rather than silently pretending to send — flip this
    // on in your hosting provider's env vars once you have a Brevo account.
    console.warn(`[emailService] BREVO_API_KEY not set — would have sent "${subject}" to ${to}`);
    return;
  }
  try {
    const res = await fetch(BREVO_API_URL, {
      method: "POST",
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        sender: { email: process.env.EMAIL_FROM, name: process.env.EMAIL_FROM_NAME || "Bank My Shift" },
        to: [{ email: to }],
        subject,
        textContent: text,
        htmlContent: html || text,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`Failed to send email to ${to}: ${res.status} ${body}`);
    }
  } catch (err) {
    console.error(`Failed to send email to ${to}:`, err.message);
  }
}

const templates = {
  resetCode: (name, code) => ({
    subject: "Your Bank My Shift password reset code",
    text: `Hi ${name},\n\nYour password reset code is: ${code}\n\nThis code expires in ${process.env.RESET_TOKEN_EXPIRES_MIN || 30} minutes. If you didn't request this, you can ignore this email.${process.env.APP_URL ? `\n\nReset it here: ${process.env.APP_URL}` : ""}`,
  }),
  welcomeNewStaff: (name, loginEmail, tempPassword) => ({
    subject: "Your Bank My Shift account is ready",
    text: `Hi ${name},\n\nAn account has been created for you on Bank My Shift, so you can view and claim bank shifts.\n\nYour sign-in details:\nEmail: ${loginEmail}\nTemporary password: ${tempPassword}\n\nPlease sign in and change this password as soon as possible — go to Profile > Change password once you're logged in.${process.env.APP_URL ? `\n\nSign in here: ${process.env.APP_URL}` : ""}`,
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
  shiftReinstated: (name, shift) => ({
    subject: `Shift reinstated — ${shift.location_name}`,
    text: `Hi ${name},\n\nYour shift at ${shift.location_name} on ${shift.date}, ${shift.start_time}–${shift.end_time} has been reinstated after being cancelled.`,
  }),
  handbackRequested: (name, shift, requesterName) => ({
    subject: `Hand-back request — ${shift.location_name}`,
    text: `Hi ${name},\n\n${requesterName || "A staff member"} has asked to hand back the shift at ${shift.location_name} on ${shift.date}, ${shift.start_time}–${shift.end_time}. Review it in the app's Approvals tab.`,
  }),
  handbackApproved: (name, shift) => ({
    subject: `Hand-back approved — ${shift.location_name}`,
    text: `Hi ${name},\n\nYour request to hand back the shift at ${shift.location_name} on ${shift.date} was approved. You're no longer scheduled for this shift.`,
  }),
  handbackDenied: (name, shift) => ({
    subject: `Hand-back request declined — ${shift.location_name}`,
    text: `Hi ${name},\n\nYour request to hand back the shift at ${shift.location_name} on ${shift.date} wasn't approved. You're still confirmed for this shift.`,
  }),
};

module.exports = {
  sendPasswordResetEmail: (to, name, code) => send({ to, ...templates.resetCode(name, code) }),
  sendWelcomeEmail: (to, name, tempPassword) => send({ to, ...templates.welcomeNewStaff(name, to, tempPassword) }),
  sendNewShiftEmail: (to, name, shift) => send({ to, ...templates.newShift(name, shift) }),
  sendClaimApprovedEmail: (to, name, shift) => send({ to, ...templates.claimApproved(name, shift) }),
  sendClaimRejectedEmail: (to, name, shift) => send({ to, ...templates.claimRejected(name, shift) }),
  sendShiftCancelledEmail: (to, name, shift) => send({ to, ...templates.shiftCancelled(name, shift) }),
  sendReminderEmail: (to, name, shift) => send({ to, ...templates.reminder(name, shift) }),
  sendShiftReinstatedEmail: (to, name, shift) => send({ to, ...templates.shiftReinstated(name, shift) }),
  sendHandbackRequestedEmail: (to, name, shift, requesterName) => send({ to, ...templates.handbackRequested(name, shift, requesterName) }),
  sendHandbackApprovedEmail: (to, name, shift) => send({ to, ...templates.handbackApproved(name, shift) }),
  sendHandbackDeniedEmail: (to, name, shift) => send({ to, ...templates.handbackDenied(name, shift) }),
};
