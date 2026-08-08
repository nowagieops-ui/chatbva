const nodemailer = require("nodemailer");

let transport = null;

function getTransport() {
  if (transport) return transport;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return null;
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "465"),
    secure: process.env.SMTP_SECURE !== "false",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transport;
}

async function sendManagerAlert(subject, html) {
  const t = getTransport();
  if (!t || !process.env.MANAGER_EMAIL) return;
  try {
    await t.sendMail({
      from: `"BVA Open Line" <${process.env.SMTP_USER}>`,
      to: process.env.MANAGER_EMAIL,
      subject,
      html,
    });
  } catch (e) {
    console.error("Mail send failed:", e.message);
  }
}

async function sendBookingConfirmation(toEmail, booking, slotKey) {
  const t = getTransport();
  if (!t || !toEmail) return;
  const [date, time] = slotKey.split("T");
  try {
    await t.sendMail({
      from: `"BVA Open Line" <${process.env.SMTP_USER}>`,
      to: toEmail,
      subject: `Your one to one is confirmed — ${date} at ${time}`,
      html: `
        <p>Hi ${booking.name},</p>
        <p>Your monthly one to one is confirmed:</p>
        <table style="font-family:monospace;border-collapse:collapse">
          <tr><td style="padding:4px 16px 4px 0"><b>Date</b></td><td>${date}</td></tr>
          <tr><td style="padding:4px 16px 4px 0"><b>Time</b></td><td>${time}</td></tr>
          <tr><td style="padding:4px 16px 4px 0"><b>Duration</b></td><td>${booking.duration} minutes</td></tr>
          <tr><td style="padding:4px 16px 4px 0"><b>Format</b></td><td>${booking.mode}</td></tr>
          <tr><td style="padding:4px 16px 4px 0"><b>Reference</b></td><td>${booking.code}</td></tr>
        </table>
        <p>If you need to change or cancel, visit the Open Line and enter your name.</p>
        <p style="color:#888;font-size:12px">BVA Open Line · This message was sent automatically</p>
      `,
    });
  } catch (e) {
    console.error("Confirmation mail failed:", e.message);
  }
}

module.exports = { sendManagerAlert, sendBookingConfirmation };
