const express = require("express");
const { getCollections } = require("../config/db");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

// GET /api/dashboard/overview - Role-specific analytics and overview statistics
router.get("/dashboard/overview", verifyToken, async (req, res, next) => {
  try {
    const {
      usersCollection,
      menuItemsCollection,
      ordersCollection,
      transactionsCollection,
    } = await getCollections();

    if (req.user.role === "vendor") {
      const [items, orders] = await Promise.all([
        menuItemsCollection.find({ vendorId: req.user.uid }).toArray(),
        ordersCollection
          .find({ vendorId: req.user.uid })
          .sort({ createdAt: -1 })
          .toArray(),
      ]);

      const activeItems = items.filter((i) => i.status === "approved").length;
      const pendingItems = items.filter((i) => i.status === "pending").length;
      const pendingOrders = orders.filter((o) => o.status === "pending").length;
      const acceptedOrders = orders.filter((o) => o.status === "accepted").length;
      const rejectedOrders = orders.filter((o) => o.status === "rejected").length;
      const cancelledOrders = orders.filter((o) => o.status === "cancelled").length;

      const totalOrderRevenue = orders
        .filter((o) => o.status === "accepted")
        .reduce((acc, o) => acc + (Number(o.totalPrice) || 0), 0);

      const categoryMap = new Map();
      items.forEach((item) => {
        categoryMap.set(item.category, (categoryMap.get(item.category) || 0) + 1);
      });

      return res.status(200).json({
        success: true,
        role: "vendor",
        stats: {
          totalMenuItems: items.length,
          activeMenuItems: activeItems,
          pendingMenuItems: pendingItems,
          pendingOrders,
          acceptedOrders,
          totalOrders: orders.length,
          totalOrderRevenue: Number(totalOrderRevenue.toFixed(2)),
          subscriptionPlan: req.user.subscriptionPlan || "free",
        },
        charts: {
          orderStatus: [
            { label: "Pending", value: pendingOrders, color: "#E07A2E" },
            { label: "Accepted", value: acceptedOrders, color: "#15803D" },
            { label: "Rejected", value: rejectedOrders, color: "#C83E2B" },
            { label: "Cancelled", value: cancelledOrders, color: "#6B7280" },
          ],
          menuByCategory: Array.from(categoryMap.entries()).map(([label, value]) => ({
            label,
            value,
          })),
        },
        recentOrders: orders.slice(0, 5),
      });
    }

    if (req.user.role === "customer") {
      const orders = await ordersCollection
        .find({ customerId: req.user.uid })
        .sort({ createdAt: -1 })
        .toArray();

      const pendingOrders = orders.filter((o) => o.status === "pending").length;
      const acceptedOrders = orders.filter((o) => o.status === "accepted").length;
      const rejectedOrders = orders.filter((o) => o.status === "rejected").length;
      const cancelledOrders = orders.filter((o) => o.status === "cancelled").length;
      const totalSpent = orders
        .filter((o) => o.status === "accepted")
        .reduce((acc, o) => acc + (Number(o.totalPrice) || 0), 0);

      return res.status(200).json({
        success: true,
        role: "customer",
        stats: {
          totalOrders: orders.length,
          pendingOrders,
          acceptedOrders,
          rejectedOrders,
          cancelledOrders,
          favoritesCount: Array.isArray(req.user.favorites)
            ? req.user.favorites.length
            : 0,
          totalSpent: Number(totalSpent.toFixed(2)),
        },
        charts: {
          orderStatus: [
            { label: "Pending", value: pendingOrders, color: "#E07A2E" },
            { label: "Accepted", value: acceptedOrders, color: "#15803D" },
            { label: "Rejected", value: rejectedOrders, color: "#C83E2B" },
            { label: "Cancelled", value: cancelledOrders, color: "#6B7280" },
          ],
        },
        recentOrders: orders.slice(0, 5),
      });
    }

    // Admin overview
    const [users, items, orders, transactions] = await Promise.all([
      usersCollection.find({}).toArray(),
      menuItemsCollection.find({}).toArray(),
      ordersCollection.find({}).toArray(),
      transactionsCollection.find({}).sort({ createdAt: -1 }).toArray(),
    ]);

    const totalVendors = users.filter((u) => u.role === "vendor").length;
    const totalCustomers = users.filter((u) => u.role === "customer").length;
    const pendingMenuItems = items.filter((i) => i.status === "pending").length;
    const approvedMenuItems = items.filter((i) => i.status === "approved").length;
    const rejectedMenuItems = items.filter((i) => i.status === "rejected").length;
    const totalRevenue = transactions
      .filter((t) => t.status === "succeeded")
      .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

    const categoryMap = new Map();
    items.forEach((item) => {
      categoryMap.set(item.category, (categoryMap.get(item.category) || 0) + 1);
    });

    return res.status(200).json({
      success: true,
      role: "admin",
      stats: {
        totalUsers: users.length,
        totalVendors,
        totalCustomers,
        totalMenuItems: items.length,
        pendingMenuItems,
        approvedMenuItems,
        totalOrders: orders.length,
        totalTransactions: transactions.length,
        totalRevenue: Number(totalRevenue.toFixed(2)),
      },
      charts: {
        userBreakdown: [
          { label: "Customers", value: totalCustomers, color: "#E07A2E" },
          { label: "Vendors", value: totalVendors, color: "#C83E2B" },
          {
            label: "Admins",
            value: users.filter((u) => u.role === "admin").length,
            color: "#3F2E26",
          },
        ],
        menuStatus: [
          { label: "Approved", value: approvedMenuItems, color: "#15803D" },
          { label: "Pending", value: pendingMenuItems, color: "#E07A2E" },
          { label: "Rejected", value: rejectedMenuItems, color: "#C83E2B" },
        ],
        menuByCategory: Array.from(categoryMap.entries()).map(([label, value]) => ({
          label,
          value,
        })),
      },
      recentTransactions: transactions.slice(0, 5),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
