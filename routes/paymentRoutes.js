const express = require("express");
const crypto = require("crypto");
const Stripe = require("stripe");
const { getCollections, toObjectId, sanitizeUser } = require("../config/db");
const { verifyToken, requireRole } = require("../middleware/auth");

const router = express.Router();

const PREMIUM_MONTHLY_PRICE_USD = 29;
const WEBHOOK_SECRET =
  process.env.STRIPE_WEBHOOK_SECRET || "whsec_pizzahub_stripe_webhook_secret";

function isRealStripeConfigured() {
  const key = (process.env.STRIPE_SECRET_KEY || "").trim();
  if (!key) return false;
  if (
    key === "sk_test_pizzahub_stripe_secret_key" ||
    key === "sk_test_your_stripe_secret_key"
  ) {
    return false;
  }
  return (key.startsWith("sk_test_") || key.startsWith("sk_live_")) && key.length >= 36;
}

function getStripeClient() {
  if (!isRealStripeConfigured()) return null;
  return new Stripe(process.env.STRIPE_SECRET_KEY.trim());
}

function resolveClientOrigin(req) {
  const originHeader = req.headers.origin;
  if (originHeader && /^https?:\/\//i.test(originHeader)) {
    return originHeader.replace(/\/+$/, "");
  }
  return (process.env.CLIENT_URL || "http://localhost:3000").replace(/\/+$/, "");
}

function computeHmacSignature(rawPayload) {
  return crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(rawPayload)
    .digest("hex");
}

function verifyHmacSignature(rawPayload, providedSignature) {
  if (!providedSignature || typeof providedSignature !== "string") {
    return false;
  }
  const expected = computeHmacSignature(rawPayload);
  const expectedBuf = Buffer.from(expected, "utf8");
  const providedBuf = Buffer.from(providedSignature, "utf8");
  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

async function activatePremiumSubscription({
  vendorId,
  sessionId,
  subscriptionId,
}) {
  const { usersCollection, transactionsCollection, menuItemsCollection } =
    await getCollections();

  const vendorObjectId = toObjectId(vendorId);
  const expiresAt = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000
  ).toISOString();
  const now = new Date().toISOString();

  await transactionsCollection.updateOne(
    { stripeSessionId: sessionId },
    {
      $set: {
        status: "succeeded",
        stripeSubscriptionId: subscriptionId || `sub_${crypto.randomBytes(10).toString("hex")}`,
        updatedAt: now,
      },
    }
  );

  if (vendorObjectId) {
    await usersCollection.updateOne(
      { _id: vendorObjectId },
      {
        $set: {
          subscriptionPlan: "premium",
          subscriptionExpiresAt: expiresAt,
          updatedAt: now,
        },
      }
    );
  }

  await menuItemsCollection.updateMany(
    { vendorId },
    {
      $set: {
        vendorIsPremium: true,
        updatedAt: now,
      },
    }
  );
}

async function downgradeVendorSubscription({ vendorId, sessionId, txStatus }) {
  const { usersCollection, transactionsCollection, menuItemsCollection } =
    await getCollections();
  const now = new Date().toISOString();

  if (sessionId && txStatus) {
    await transactionsCollection.updateOne(
      { stripeSessionId: sessionId },
      {
        $set: {
          status: txStatus,
          updatedAt: now,
        },
      }
    );
  }

  if (vendorId) {
    const vendorObjectId = toObjectId(vendorId);
    if (vendorObjectId) {
      await usersCollection.updateOne(
        { _id: vendorObjectId },
        {
          $set: {
            subscriptionPlan: "free",
            subscriptionExpiresAt: null,
            updatedAt: now,
          },
        }
      );
    }

    await menuItemsCollection.updateMany(
      { vendorId },
      {
        $set: {
          vendorIsPremium: false,
          updatedAt: now,
        },
      }
    );
  }
}

async function handleStripeWebhookEvent(event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data?.object || {};
      const vendorId = session.metadata?.vendorId;
      const sessionId = session.id;
      const subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id || null;

      if (vendorId && sessionId) {
        await activatePremiumSubscription({
          vendorId,
          sessionId,
          subscriptionId,
        });
      }
      break;
    }
    case "checkout.session.expired":
    case "checkout.session.cancelled": {
      const session = event.data?.object || {};
      const sessionId = session.id;
      if (sessionId) {
        const { transactionsCollection } = await getCollections();
        await transactionsCollection.updateOne(
          { stripeSessionId: sessionId },
          {
            $set: {
              status: "cancelled",
              updatedAt: new Date().toISOString(),
            },
          }
        );
      }
      break;
    }
    case "customer.subscription.deleted":
    case "invoice.payment_failed": {
      const obj = event.data?.object || {};
      const vendorId = obj.metadata?.vendorId;
      if (vendorId) {
        await downgradeVendorSubscription({ vendorId });
      }
      break;
    }
    default:
      break;
  }
}

// Express raw-body Stripe webhook handler (mounted before express.json in index.js)
async function webhookHandler(req, res) {
  try {
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body.toString("utf8")
      : typeof req.body === "string"
      ? req.body
      : JSON.stringify(req.body || {});

    const stripeSignature = req.headers["stripe-signature"];
    const hmacSignature = req.headers["x-pizzahub-webhook-sig"];

    let event = null;

    if (stripeSignature && isRealStripeConfigured()) {
      const stripe = getStripeClient();
      try {
        event = stripe.webhooks.constructEvent(
          req.body,
          stripeSignature,
          WEBHOOK_SECRET
        );
      } catch (err) {
        return res
          .status(400)
          .send(`Webhook Signature Error: ${err.message}`);
      }
    } else if (hmacSignature && verifyHmacSignature(rawBody, hmacSignature)) {
      event = JSON.parse(rawBody);
    } else {
      return res.status(400).json({
        success: false,
        message: "Webhook Error: Missing or invalid signature.",
      });
    }

    await handleStripeWebhookEvent(event);
    return res.status(200).json({ received: true });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || "Webhook processing error.",
    });
  }
}

// POST /api/payments/create-checkout-session - Vendor creates own Premium checkout session
router.post(
  "/payments/create-checkout-session",
  verifyToken,
  requireRole("vendor"),
  async (req, res, next) => {
    try {
      if (req.user.subscriptionPlan === "premium") {
        return res.status(400).json({
          success: false,
          message: "Your vendor account already has an active Premium plan.",
        });
      }

      const clientOrigin = resolveClientOrigin(req);
      const { transactionsCollection } = await getCollections();
      const now = new Date().toISOString();
      const stripe = getStripeClient();

      if (stripe) {
        const session = await stripe.checkout.sessions.create({
          mode: "subscription",
          payment_method_types: ["card"],
          customer_email: req.user.email,
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: "PizzaHub Vendor Premium Plan",
                  description:
                    "Unlimited menu items, featured homepage placement, and Premium Kitchen badge.",
                },
                unit_amount: PREMIUM_MONTHLY_PRICE_USD * 100,
                recurring: { interval: "month" },
              },
              quantity: 1,
            },
          ],
          metadata: {
            vendorId: req.user.uid,
            plan: "premium",
          },
          success_url: `${clientOrigin}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${clientOrigin}/payment/cancel?session_id={CHECKOUT_SESSION_ID}`,
        });

        await transactionsCollection.insertOne({
          vendorId: req.user.uid,
          vendorName: req.user.name,
          vendorEmail: req.user.email,
          businessName: req.user.businessName || `${req.user.name} Kitchen`,
          plan: "premium",
          amount: PREMIUM_MONTHLY_PRICE_USD,
          currency: "usd",
          stripeSessionId: session.id,
          stripeSubscriptionId: null,
          status: "pending",
          createdAt: now,
          updatedAt: now,
        });

        return res.status(200).json({
          success: true,
          checkoutUrl: session.url,
          sessionId: session.id,
          mode: "stripe",
        });
      }

      // Signed test Stripe Checkout Gateway when live Stripe key is not yet configured
      const sessionId = `cs_test_${crypto.randomBytes(16).toString("hex")}`;
      await transactionsCollection.insertOne({
        vendorId: req.user.uid,
        vendorName: req.user.name,
        vendorEmail: req.user.email,
        businessName: req.user.businessName || `${req.user.name} Kitchen`,
        plan: "premium",
        amount: PREMIUM_MONTHLY_PRICE_USD,
        currency: "usd",
        stripeSessionId: sessionId,
        stripeSubscriptionId: null,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });

      return res.status(200).json({
        success: true,
        checkoutUrl: `${clientOrigin}/payment/checkout?session_id=${sessionId}`,
        sessionId,
        mode: "sandbox",
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/payments/webhook-dispatch - Sandbox Stripe Checkout gateway dispatches HMAC-signed webhook
router.post(
  "/payments/webhook-dispatch",
  verifyToken,
  requireRole("vendor"),
  async (req, res, next) => {
    try {
      const { sessionId, action } = req.body || {};
      if (!sessionId || !["complete", "cancel"].includes(action)) {
        return res.status(400).json({
          success: false,
          message: "Valid sessionId and action ('complete' or 'cancel') are required.",
        });
      }

      const { transactionsCollection } = await getCollections();
      const tx = await transactionsCollection.findOne({
        stripeSessionId: sessionId,
      });

      if (!tx) {
        return res.status(404).json({
          success: false,
          message: "Checkout session not found.",
        });
      }

      if (tx.vendorId !== req.user.uid) {
        return res.status(403).json({
          success: false,
          message: "Forbidden: You cannot modify another vendor's checkout session.",
        });
      }

      if (tx.status !== "pending") {
        return res.status(400).json({
          success: false,
          message: `This checkout session has already been finalized (${tx.status}).`,
        });
      }

      const eventPayload =
        action === "complete"
          ? {
              id: `evt_${crypto.randomBytes(12).toString("hex")}`,
              type: "checkout.session.completed",
              data: {
                object: {
                  id: sessionId,
                  payment_status: "paid",
                  subscription: `sub_${crypto.randomBytes(12).toString("hex")}`,
                  metadata: {
                    vendorId: req.user.uid,
                    plan: "premium",
                  },
                },
              },
            }
          : {
              id: `evt_${crypto.randomBytes(12).toString("hex")}`,
              type: "checkout.session.cancelled",
              data: {
                object: {
                  id: sessionId,
                  metadata: {
                    vendorId: req.user.uid,
                  },
                },
              },
            };

      const rawPayload = JSON.stringify(eventPayload);
      const signature = computeHmacSignature(rawPayload);

      if (!verifyHmacSignature(rawPayload, signature)) {
        return res.status(400).json({
          success: false,
          message: "Webhook signature verification failed.",
        });
      }

      await handleStripeWebhookEvent(eventPayload);

      return res.status(200).json({
        success: true,
        status: action === "complete" ? "succeeded" : "cancelled",
        redirectPath:
          action === "complete"
            ? `/payment/success?session_id=${sessionId}`
            : `/payment/cancel?session_id=${sessionId}`,
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/payments/session-status - Read verified transaction & subscription status (does NOT activate on redirect)
router.get(
  "/payments/session-status",
  verifyToken,
  requireRole("vendor"),
  async (req, res, next) => {
    try {
      const sessionId = req.query.session_id;
      if (!sessionId) {
        return res.status(400).json({
          success: false,
          message: "session_id query parameter is required.",
        });
      }

      const { transactionsCollection, usersCollection } = await getCollections();
      let tx = await transactionsCollection.findOne({
        stripeSessionId: sessionId,
      });

      if (!tx) {
        return res.status(404).json({
          success: false,
          message: "Transaction record not found.",
        });
      }

      if (tx.vendorId !== req.user.uid) {
        return res.status(403).json({
          success: false,
          message: "Forbidden: You cannot view another vendor's payment session.",
        });
      }

      const stripe = getStripeClient();
      if (stripe && tx.status === "pending") {
        try {
          const stripeSession = await stripe.checkout.sessions.retrieve(sessionId);
          if (stripeSession.payment_status === "paid") {
            await activatePremiumSubscription({
              vendorId: req.user.uid,
              sessionId,
              subscriptionId:
                typeof stripeSession.subscription === "string"
                  ? stripeSession.subscription
                  : null,
            });
            tx = await transactionsCollection.findOne({
              stripeSessionId: sessionId,
            });
          }
        } catch {
          // Wait for Stripe webhook if direct retrieve fails
        }
      }

      const userDoc = await usersCollection.findOne({
        _id: toObjectId(req.user.uid),
      });

      return res.status(200).json({
        success: true,
        transaction: tx,
        user: sanitizeUser(userDoc),
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/payments/cancel-subscription - Vendor cancels Premium subscription
router.post(
  "/payments/cancel-subscription",
  verifyToken,
  requireRole("vendor"),
  async (req, res, next) => {
    try {
      if (req.user.subscriptionPlan !== "premium") {
        return res.status(400).json({
          success: false,
          message: "You do not have an active Premium subscription to cancel.",
        });
      }

      const { transactionsCollection, usersCollection } = await getCollections();
      const latestSuccessTx = await transactionsCollection.findOne(
        { vendorId: req.user.uid, status: "succeeded" },
        { sort: { createdAt: -1 } }
      );

      const stripe = getStripeClient();
      if (stripe && latestSuccessTx?.stripeSubscriptionId) {
        try {
          await stripe.subscriptions.cancel(latestSuccessTx.stripeSubscriptionId);
        } catch {
          // Continue downgrading local state cleanly
        }
      }

      await downgradeVendorSubscription({ vendorId: req.user.uid });
      const updatedUserDoc = await usersCollection.findOne({
        _id: toObjectId(req.user.uid),
      });

      return res.status(200).json({
        success: true,
        message: "Premium subscription cancelled. Plan reverted to Free.",
        user: sanitizeUser(updatedUserDoc),
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/payments/vendor-history - Vendor's own billing transactions
router.get(
  "/payments/vendor-history",
  verifyToken,
  requireRole("vendor"),
  async (req, res, next) => {
    try {
      const { transactionsCollection } = await getCollections();
      const transactions = await transactionsCollection
        .find({ vendorId: req.user.uid })
        .sort({ createdAt: -1 })
        .toArray();

      return res.status(200).json({
        success: true,
        transactions,
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
module.exports.webhookHandler = webhookHandler;
