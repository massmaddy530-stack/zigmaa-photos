import nodemailer from "nodemailer";

export function getMailer() {
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === "true" || port === 465;
  const user = process.env.SMTP_USER || "massmaddy530@gmail.com";
  const pass = (process.env.SMTP_PASSWORD || "cokqpefjvxgcpmmg").replace(/\s+/g, "");

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: {
      rejectUnauthorized: false,
    },
  });
}

export async function sendOtpEmail(toEmail: string, otp: string): Promise<boolean> {
  const transporter = getMailer();
  const from = process.env.SMTP_FROM || `"Zigmaa Photos" <massmaddy530@gmail.com>`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Zigmaa Photos Verification Code</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0b0f19; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #0b0f19; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 500px; background: #131926; border: 1px solid rgba(229, 9, 20, 0.25); border-radius: 20px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.6);">
          
          <!-- Header with Red Banner -->
          <tr>
            <td style="padding: 32px 32px 24px; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.06); background: radial-gradient(circle at top, rgba(229, 9, 20, 0.15) 0%, transparent 70%);">
              <div style="display: inline-block; padding: 10px 16px; background: rgba(229, 9, 20, 0.1); border: 1px solid rgba(229, 9, 20, 0.3); border-radius: 12px; margin-bottom: 16px;">
                <span style="font-size: 20px; font-weight: 800; letter-spacing: 2px; color: #ffffff;">
                  ZIGMAA <span style="color: #e50914;">PHOTOS</span>
                </span>
              </div>
              <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #ffffff;">Password Reset Verification</h1>
              <p style="margin: 8px 0 0; font-size: 13px; color: #94a3b8;">AI Event Photography & Studio Workspace</p>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 32px 32px 24px;">
              <p style="margin: 0 0 16px; font-size: 14px; line-height: 1.6; color: #cbd5e1;">
                Hello,
              </p>
              <p style="margin: 0 0 24px; font-size: 14px; line-height: 1.6; color: #cbd5e1;">
                We received a request to verify your account or reset your password for Zigmaa Photos. Use the 6-digit one-time passcode below:
              </p>

              <!-- OTP Code Display -->
              <div style="text-align: center; margin: 28px 0;">
                <div style="display: inline-block; background: #0f1420; border: 2px dashed #e50914; border-radius: 14px; padding: 18px 36px; letter-spacing: 10px; font-family: 'Courier New', Courier, monospace; font-size: 34px; font-weight: 800; color: #ffffff; text-shadow: 0 0 12px rgba(229,9,20,0.5);">
                  ${otp}
                </div>
                <p style="margin: 12px 0 0; font-size: 12px; color: #f87171; font-weight: 500;">
                  ⏱ Valid for 10 minutes only
                </p>
              </div>

              <div style="background: rgba(255,255,255,0.03); border-left: 3px solid #e50914; padding: 14px 16px; border-radius: 0 10px 10px 0; margin-top: 24px;">
                <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #94a3b8;">
                  <strong style="color: #ffffff;">Security Alert:</strong> Never share this OTP with anyone, including Zigmaa staff. If you did not initiate this request, your account is secure and you can safely ignore this email.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background: #0b0f19; border-top: 1px solid rgba(255,255,255,0.06); text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #64748b;">
                © ${new Date().getFullYear()} Zigmaa Photos Studio. All rights reserved.
              </p>
              <p style="margin: 6px 0 0; font-size: 11px; color: #475569;">
                This is an automated notification. Replies to this email are not monitored.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  try {
    const info = await transporter.sendMail({
      from,
      to: toEmail,
      subject: `Your Zigmaa Photos OTP: ${otp}`,
      text: `Your Zigmaa Photos verification code is ${otp}. Valid for 10 minutes. Do not share this code.`,
      html,
    });
    console.log(`[SMTP] OTP email sent to ${toEmail}: ${info.messageId}`);
    return true;
  } catch (err) {
    console.error("[SMTP] Error sending OTP email:", err);
    throw err;
  }
}

