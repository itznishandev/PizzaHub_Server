# PizzaHub — Pizza Ordering & Delivery Platform (Server)

Backend REST API powering **PizzaHub**, a full-stack role-based pizza ordering, restaurant storefront, and vendor subscription platform built with **Express.js**, **MongoDB Atlas**, **JWT**, **Stripe Checkout**, and **ImgBB**.

---

## Repositories & Links

- **Server Repository:** [https://github.com/itznishandev/PizzaHub_Server](https://github.com/itznishandev/PizzaHub_Server)
- **Client Repository:** [https://github.com/itznishandev/PizzaHub_Client](https://github.com/itznishandev/PizzaHub_Client)
- **Live Application URL:** [https://pizzahubweb.vercel.app](https://pizzahubweb.vercel.app)
- **Live API Endpoint:** [https://pizzahubweb.vercel.app/api](https://pizzahubweb.vercel.app/api)

---

## Core Backend Features

- **Role-Based JWT Authentication & Block Enforcement:** Issues signed 7-day JWTs via `POST /api/auth/login`, `POST /api/auth/register`, `POST /api/auth/social`, and `POST /api/jwt`. Prevents public registration of `admin` accounts and enforces user active status (`isBlocked`) on every protected API request.
- **MongoDB Four-Collection Architecture:** Strictly organizes business state across `users`, `menuItems`, `orders`, and `transactions` with indexed queries and server-side ownership enforcement.
- **Vendor Free vs. Premium Plan Caps:** Free vendors are capped at 3 active/pending menu items; upgrading via Stripe Checkout unlocks unlimited listings, featured homepage prioritization (`vendorIsPremium`), and a Premium Kitchen badge.
- **Verified Stripe Webhook Subscription Lifecycle:** Premium subscriptions are activated exclusively through `POST /api/payments/webhook` (and signed `webhook-dispatch` verification) rather than trusting client success URL redirects. Handles expiration downgrades and cancellations automatically.
- **Order Workflow & Duplicate Protection:** Prevents customers from ordering their own vendor items, rejects past delivery dates, prevents duplicate active orders for the same item and date, enforces one-time vendor `accept`/`reject` transitions, tracks order status timelines, and dispatches customer email notifications.
- **Admin Governance & Read-Only Ledger:** Admins can search/filter users, block/unblock non-admin accounts, approve/reject/delete menu items, and audit read-only platform transactions.

---

## Challenge Implementation Notes

### 1. Advanced Search & Sorting Query Parameters (`GET /api/menu`)
- Accepts `?search=&category=&location=&minPrice=&maxPrice=&sort=`.
- Always enforces `{ status: "approved" }` so pending, rejected, or inactive dishes never leak into the public menu.
- Escapes user search strings before constructing case-insensitive MongoDB `$regex` filters across `itemName`, `description`, `businessName`, and `location`.
- Supports sorting modes:
  - `featured` (default): sorts by `{ vendorIsPremium: -1, createdAt: -1 }`
  - `price_asc`: `{ price: 1, vendorIsPremium: -1 }`
  - `price_desc`: `{ price: -1, vendorIsPremium: -1 }`
  - `rating_desc`: `{ averageRating: -1, reviewCount: -1, vendorIsPremium: -1 }`
  - `newest`: `{ createdAt: -1 }`

### 2. JWT Verification & Role-Based Middleware Flow
1. `verifyToken` extracts the JWT from `Authorization: Bearer <token>` or the `pizzahub_token` HTTP-only cookie.
2. Returns `401 Unauthorized` when missing, malformed, or expired.
3. Queries the live user record from MongoDB `users` by `uid`/`email` so client-supplied IDs or roles are never trusted.
4. Returns `403 Forbidden` if `user.isBlocked` is `true`, and calls `verifySubscriptionStatus()` to downgrade expired Premium subscriptions automatically.
5. `requireRole(...roles)` verifies `roles.includes(req.user.role)`, returning `403 Forbidden` when unauthorized.
6. Route handlers additionally validate resource ownership (`item.vendorId === req.user.uid`, `order.customerId === req.user.uid`, `order.vendorId === req.user.uid`).

---

## Tech Stack & Packages

- **Runtime & Framework:** Node.js, `express`
- **Database:** `mongodb` (MongoDB Atlas official driver)
- **Auth & Security:** `jsonwebtoken`, `bcryptjs`, `cookie-parser`, `cors`
- **Payments & Notifications:** `stripe`, `nodemailer`
- **Config:** `dotenv`

---

## Environment Variables

Create a `.env` file in the server root (see `.env.example`):

- `PORT`
- `MONGODB_URI`
- `MONGODB_DB`
- `JWT_SECRET`
- `CLIENT_URL`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `IMGBB_API_KEY`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` (optional SMTP mail delivery)

---

## Installation & Running Locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure `.env` using `.env.example` as a reference.
3. Seed sample users, pizzas, orders, and transactions (optional, also runs on boot):
   ```bash
   npm run seed
   ```
4. Start the server:
   ```bash
   npm run dev
   ```
   API runs at `http://localhost:5000`.
