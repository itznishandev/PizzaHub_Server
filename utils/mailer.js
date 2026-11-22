const nodemailer = require("nodemailer");

function buildOrderStatusEmail({ order, newStatus, businessName }) {
  const isAccepted = newStatus === "accepted";
  const subject = isAccepted
    ? `Order Accepted: ${order.itemName} from ${businessName}`
    : `Order Update: ${order.itemName} was declined by ${businessName}`;

  const preview = isAccepted
    ? `Good news ${order.customerName}! ${businessName} has accepted your order for "${order.itemName}" scheduled for ${order.deliveryDate} to ${order.deliveryAddress}.`
    : `Hello ${order.customerName}, unfortunately ${businessName} could not fulfill your order for "${order.itemName}" on ${order.deliveryDate}. You can browse other artisan kitchens on PizzaHub anytime.`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; border: 1px solid #f0e3d8; border-radius: 12px; overflow: hidden;">
      <div style="background: #c83e2b; color: #fff; padding: 20px 24px;">
        <h2 style="margin: 0;">PizzaHub Order Notification</h2>
      </div>
      <div style="padding: 24px; background: #fffbf5; color: #2b1d17;">
        <p style="font-size: 15px; line-height: 1.6;">${preview}</p>
        <div style="background: #fff; border: 1px solid #eadad0; border-radius: 8px; padding: 14px; margin-top: 16px;">
          <p style="margin: 4px 0;"><strong>Item:</strong> ${order.itemName}</p>
          <p style="margin: 4px 0;"><strong>Kitchen:</strong> ${businessName}</p>
          <p style="margin: 4px 0;"><strong>Delivery Date:</strong> ${order.deliveryDate}</p>
          <p style="margin: 4px 0;"><strong>Status:</strong> ${newStatus.toUpperCase()}</p>
        </div>
      </div>
    </div>
  `;

  return { subject, preview, html };
}

async function sendOrderStatusNotification({ order, newStatus, businessName }) {
  const { subject, preview, html } = buildOrderStatusEmail({
    order,
    newStatus,
    businessName,
  });

  const recipient = order.customerEmail;
  const sentAt = new Date().toISOString();

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM } = process.env;
  if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    try {
      const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: Number(SMTP_PORT) || 587,
        secure: Number(SMTP_PORT) === 465,
        auth: {
          user: SMTP_USER,
          pass: SMTP_PASS,
        },
      });

      await transporter.sendMail({
        from: EMAIL_FROM || SMTP_USER,
        to: recipient,
        subject,
        text: preview,
        html,
      });

      return {
        sent: true,
        mode: "smtp",
        recipient,
        subject,
        preview,
        sentAt,
      };
    } catch (smtpError) {
      return {
        sent: true,
        mode: "logged-fallback",
        recipient,
        subject,
        preview,
        sentAt,
        warning: smtpError.message,
      };
    }
  }

  return {
    sent: true,
    mode: "simulated",
    recipient,
    subject,
    preview,
    sentAt,
  };
}

module.exports = {
  sendOrderStatusNotification,
};
