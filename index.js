const path = require("path");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const authRoutes = require("./routes/authRoutes");
const menuRoutes = require("./routes/menuRoutes");
const orderRoutes = require("./routes/orderRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const adminRoutes = require("./routes/adminRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");
const { ensureSeedData } = require("./data/seedPizzaHub");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    origin: function (origin, callback) {
      callback(null, true);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "stripe-signature",
      "x-pizzahub-webhook-sig",
    ],
  })
);

// Stripe webhook routes must receive raw request body prior to JSON body parsing
app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  paymentRoutes.webhookHandler
);
app.post(
  "/payments/webhook",
  express.raw({ type: "application/json" }),
  paymentRoutes.webhookHandler
);

app.use(express.json({ limit: "8mb" }));
app.use(cookieParser());

// Lazy seed initialization guard for serverless cold starts
let seedInitPromise = null;
app.use(async (req, res, next) => {
  try {
    if (!seedInitPromise) {
      seedInitPromise = ensureSeedData().catch((err) => {
        seedInitPromise = null;
        throw err;
      });
    }
    await seedInitPromise;
    next();
  } catch (err) {
    next(err);
  }
});

const statusHandler = (req, res) => {
  res.status(200).json({
    success: true,
    platform: "PizzaHub — Pizza Ordering & Delivery Platform API",
    version: "1.0.0",
    status: "operational",
    endpoints: {
      featuredMenu: "GET /api/menu/featured",
      browseMenu: "GET /api/menu?search=&category=&location=&sort=",
      menuDetails: "GET /api/menu/:id",
      register: "POST /api/auth/register",
      login: "POST /api/auth/login",
      orders: "POST /api/orders (Customer JWT)",
      vendorMenu: "GET /api/vendor/menu (Vendor JWT)",
      stripeCheckout: "POST /api/payments/create-checkout-session (Vendor JWT)",
      stripeWebhook: "POST /api/payments/webhook (Verified Signature)",
      adminOverview: "GET /api/dashboard/overview (JWT)",
    },
  });
};

app.get("/", statusHandler);
app.get("/api", statusHandler);

// Mount API routes on /api and root for full proxy compatibility
const allRouters = [
  authRoutes,
  menuRoutes,
  orderRoutes,
  paymentRoutes,
  adminRoutes,
  dashboardRoutes,
];

allRouters.forEach((router) => {
  app.use("/api", router);
  app.use(router);
});

app.use(notFoundHandler);
app.use(errorHandler);

if (require.main === module) {
  app.listen(PORT, async () => {
    try {
      await ensureSeedData();
      console.log(`PizzaHub API Server listening on http://localhost:${PORT}`);
    } catch (err) {
      console.error("Initial seed warning:", err.message);
    }
  });
}

module.exports = app;
