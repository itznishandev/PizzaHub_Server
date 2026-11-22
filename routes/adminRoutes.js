const express = require("express");
const { getCollections, toObjectId, sanitizeUser } = require("../config/db");
const { verifyToken, requireRole } = require("../middleware/auth");

const router = express.Router();

// Protect all /admin endpoints strictly for admin role
router.use("/admin", verifyToken, requireRole("admin"));

// GET /api/admin/users - View all users with search and role filter
router.get("/admin/users", async (req, res, next) => {
  try {
    const { search = "", role = "" } = req.query;
    const { usersCollection } = await getCollections();

    const query = {};
    if (role && role !== "all") {
      query.role = role.toLowerCase().trim();
    }
    if (search && search.trim()) {
      const safe = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(safe, "i");
      query.$or = [{ name: regex }, { email: regex }, { businessName: regex }];
    }

    const docs = await usersCollection
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      users: docs.map(sanitizeUser),
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/users/:id/block - Block or unblock a vendor/customer user
router.patch("/admin/users/:id/block", async (req, res, next) => {
  try {
    const userObjectId = toObjectId(req.params.id);
    if (!userObjectId) {
      return res.status(404).json({
        success: false,
        message: "Invalid user ID.",
      });
    }

    const { usersCollection } = await getCollections();
    const targetUser = await usersCollection.findOne({ _id: userObjectId });

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    if (targetUser.role === "admin" || targetUser._id.toString() === req.user.uid) {
      return res.status(403).json({
        success: false,
        message: "Administrator accounts cannot be blocked.",
      });
    }

    const nextBlockedState =
      typeof req.body?.isBlocked === "boolean"
        ? req.body.isBlocked
        : !Boolean(targetUser.isBlocked);

    await usersCollection.updateOne(
      { _id: userObjectId },
      {
        $set: {
          isBlocked: nextBlockedState,
          updatedAt: new Date().toISOString(),
        },
      }
    );

    const updatedDoc = await usersCollection.findOne({ _id: userObjectId });

    return res.status(200).json({
      success: true,
      message: nextBlockedState
        ? `${updatedDoc.name} has been blocked.`
        : `${updatedDoc.name} has been unblocked.`,
      user: sanitizeUser(updatedDoc),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/menu - View, search, and filter all menu items
router.get("/admin/menu", async (req, res, next) => {
  try {
    const { search = "", status = "", category = "" } = req.query;
    const { menuItemsCollection } = await getCollections();

    const query = {};
    if (status && status !== "all") {
      query.status = status.toLowerCase().trim();
    }
    if (category && category !== "all") {
      query.category = category.trim();
    }
    if (search && search.trim()) {
      const safe = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(safe, "i");
      query.$or = [
        { itemName: regex },
        { businessName: regex },
        { vendorName: regex },
        { location: regex },
      ];
    }

    const items = await menuItemsCollection
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      items,
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/menu/:id/status - Approve, reject, or deactivate any menu item
router.patch("/admin/menu/:id/status", async (req, res, next) => {
  try {
    const itemObjectId = toObjectId(req.params.id);
    if (!itemObjectId) {
      return res.status(404).json({
        success: false,
        message: "Invalid menu item ID.",
      });
    }

    const { status } = req.body || {};
    if (!["approved", "rejected", "inactive", "pending"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid menu item status.",
      });
    }

    const { menuItemsCollection } = await getCollections();
    const existing = await menuItemsCollection.findOne({ _id: itemObjectId });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Menu item not found.",
      });
    }

    await menuItemsCollection.updateOne(
      { _id: itemObjectId },
      {
        $set: {
          status,
          updatedAt: new Date().toISOString(),
        },
      }
    );

    const updatedItem = await menuItemsCollection.findOne({ _id: itemObjectId });

    return res.status(200).json({
      success: true,
      message: `Menu item marked as ${status}.`,
      item: updatedItem,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/menu/:id - Delete inappropriate menu item
router.delete("/admin/menu/:id", async (req, res, next) => {
  try {
    const itemObjectId = toObjectId(req.params.id);
    if (!itemObjectId) {
      return res.status(404).json({
        success: false,
        message: "Invalid menu item ID.",
      });
    }

    const { menuItemsCollection } = await getCollections();
    const delResult = await menuItemsCollection.deleteOne({ _id: itemObjectId });

    if (delResult.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Menu item not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Menu item removed from platform.",
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/transactions - Read-only view of all platform transactions
router.get("/admin/transactions", async (req, res, next) => {
  try {
    const { status = "", search = "" } = req.query;
    const { transactionsCollection } = await getCollections();

    const query = {};
    if (status && status !== "all") {
      query.status = status.toLowerCase().trim();
    }
    if (search && search.trim()) {
      const safe = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(safe, "i");
      query.$or = [
        { vendorName: regex },
        { vendorEmail: regex },
        { businessName: regex },
        { stripeSessionId: regex },
      ];
    }

    const transactions = await transactionsCollection
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    const allTx = await transactionsCollection.find({}).toArray();
    const totalRevenue = allTx
      .filter((t) => t.status === "succeeded")
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    return res.status(200).json({
      success: true,
      transactions,
      summary: {
        totalTransactions: allTx.length,
        succeededCount: allTx.filter((t) => t.status === "succeeded").length,
        pendingCount: allTx.filter((t) => t.status === "pending").length,
        totalRevenue,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
