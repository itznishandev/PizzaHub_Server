const express = require("express");
const { getCollections, toObjectId } = require("../config/db");
const { verifyToken, requireRole } = require("../middleware/auth");
const { sendOrderStatusNotification } = require("../utils/mailer");

const router = express.Router();

function isPastDate(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return true;
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return true;
  const todayStr = new Date().toISOString().slice(0, 10);
  const inputStr = dateStr.slice(0, 10);
  return inputStr < todayStr;
}

// POST /api/orders - Place a pizza order (Customer only)
router.post(
  "/orders",
  verifyToken,
  requireRole("customer"),
  async (req, res, next) => {
    try {
      const { itemId, deliveryDate, deliveryAddress, message, quantity = 1 } =
        req.body || {};

      const itemObjectId = toObjectId(itemId);
      if (!itemObjectId) {
        return res.status(400).json({
          success: false,
          message: "Invalid menu item selected.",
        });
      }

      if (!deliveryDate || isPastDate(deliveryDate)) {
        return res.status(400).json({
          success: false,
          message: "Please select today or a future delivery date.",
        });
      }

      if (
        !deliveryAddress ||
        typeof deliveryAddress !== "string" ||
        deliveryAddress.trim().length < 5
      ) {
        return res.status(400).json({
          success: false,
          message: "Please provide a complete delivery address (at least 5 characters).",
        });
      }

      const parsedQty = Math.max(1, Math.min(25, parseInt(quantity, 10) || 1));

      const { menuItemsCollection, ordersCollection } = await getCollections();
      const menuItem = await menuItemsCollection.findOne({ _id: itemObjectId });

      if (!menuItem) {
        return res.status(404).json({
          success: false,
          message: "Menu item not found.",
        });
      }

      if (menuItem.status !== "approved") {
        return res.status(400).json({
          success: false,
          message: "Only approved and active menu items can be ordered.",
        });
      }

      if (menuItem.vendorId === req.user.uid) {
        return res.status(403).json({
          success: false,
          message: "You cannot place an order for your own menu item.",
        });
      }

      const normalizedDate = deliveryDate.slice(0, 10);
      const duplicateOrder = await ordersCollection.findOne({
        customerId: req.user.uid,
        itemId: menuItem._id.toString(),
        deliveryDate: normalizedDate,
        status: { $in: ["pending", "accepted"] },
      });

      if (duplicateOrder) {
        return res.status(409).json({
          success: false,
          message:
            "You already have an active order for this item on the selected delivery date.",
        });
      }

      const now = new Date().toISOString();
      const totalPrice = Number((menuItem.price * parsedQty).toFixed(2));

      const newOrder = {
        itemId: menuItem._id.toString(),
        itemName: menuItem.itemName,
        itemImage: menuItem.image || (menuItem.images && menuItem.images[0]) || "",
        itemPrice: menuItem.price,
        itemCategory: menuItem.category,
        vendorId: menuItem.vendorId,
        vendorName: menuItem.vendorName,
        businessName: menuItem.businessName,
        customerId: req.user.uid,
        customerName: req.user.name,
        customerEmail: req.user.email,
        customerImage: req.user.image || null,
        deliveryDate: normalizedDate,
        deliveryAddress: deliveryAddress.trim(),
        message: typeof message === "string" ? message.trim() : "",
        quantity: parsedQty,
        totalPrice,
        status: "pending",
        statusHistory: [
          {
            status: "pending",
            timestamp: now,
            note: "Order submitted and awaiting restaurant confirmation.",
          },
        ],
        emailNotification: null,
        createdAt: now,
        updatedAt: now,
      };

      const insertRes = await ordersCollection.insertOne(newOrder);
      newOrder._id = insertRes.insertedId;

      return res.status(201).json({
        success: true,
        message: "Order placed successfully! Waiting for vendor acceptance.",
        order: newOrder,
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/orders/customer - Get logged-in customer's orders
router.get(
  "/orders/customer",
  verifyToken,
  requireRole("customer"),
  async (req, res, next) => {
    try {
      const { ordersCollection } = await getCollections();
      const orders = await ordersCollection
        .find({ customerId: req.user.uid })
        .sort({ createdAt: -1 })
        .toArray();

      const stats = {
        total: orders.length,
        pending: orders.filter((o) => o.status === "pending").length,
        accepted: orders.filter((o) => o.status === "accepted").length,
        rejected: orders.filter((o) => o.status === "rejected").length,
        cancelled: orders.filter((o) => o.status === "cancelled").length,
      };

      return res.status(200).json({
        success: true,
        orders,
        stats,
      });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/orders/:id/cancel - Cancel own pending order
router.patch(
  "/orders/:id/cancel",
  verifyToken,
  requireRole("customer"),
  async (req, res, next) => {
    try {
      const orderObjectId = toObjectId(req.params.id);
      if (!orderObjectId) {
        return res.status(404).json({
          success: false,
          message: "Invalid order ID.",
        });
      }

      const { ordersCollection } = await getCollections();
      const order = await ordersCollection.findOne({ _id: orderObjectId });

      if (!order) {
        return res.status(404).json({
          success: false,
          message: "Order not found.",
        });
      }

      if (order.customerId !== req.user.uid) {
        return res.status(403).json({
          success: false,
          message: "Forbidden: You can only cancel your own orders.",
        });
      }

      if (order.status !== "pending") {
        return res.status(400).json({
          success: false,
          message: `Cannot cancel an order that is already ${order.status}.`,
        });
      }

      const now = new Date().toISOString();
      const historyEntry = {
        status: "cancelled",
        timestamp: now,
        note: "Order cancelled by customer.",
      };

      await ordersCollection.updateOne(
        { _id: orderObjectId },
        {
          $set: { status: "cancelled", updatedAt: now },
          $push: { statusHistory: historyEntry },
        }
      );

      const updatedOrder = await ordersCollection.findOne({ _id: orderObjectId });

      return res.status(200).json({
        success: true,
        message: "Order cancelled successfully.",
        order: updatedOrder,
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/orders/vendor - List incoming orders for authenticated vendor
router.get(
  "/orders/vendor",
  verifyToken,
  requireRole("vendor"),
  async (req, res, next) => {
    try {
      const { ordersCollection } = await getCollections();
      const orders = await ordersCollection
        .find({ vendorId: req.user.uid })
        .sort({ createdAt: -1 })
        .toArray();

      const stats = {
        total: orders.length,
        pending: orders.filter((o) => o.status === "pending").length,
        accepted: orders.filter((o) => o.status === "accepted").length,
        rejected: orders.filter((o) => o.status === "rejected").length,
        cancelled: orders.filter((o) => o.status === "cancelled").length,
      };

      return res.status(200).json({
        success: true,
        orders,
        stats,
      });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/orders/:id/status - Accept or reject a pending order once (Vendor only)
router.patch(
  "/orders/:id/status",
  verifyToken,
  requireRole("vendor"),
  async (req, res, next) => {
    try {
      const orderObjectId = toObjectId(req.params.id);
      if (!orderObjectId) {
        return res.status(404).json({
          success: false,
          message: "Invalid order ID.",
        });
      }

      const { status, note } = req.body || {};
      if (!["accepted", "rejected"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Order status update must be either 'accepted' or 'rejected'.",
        });
      }

      const { ordersCollection } = await getCollections();
      const order = await ordersCollection.findOne({ _id: orderObjectId });

      if (!order) {
        return res.status(404).json({
          success: false,
          message: "Order not found.",
        });
      }

      if (order.vendorId !== req.user.uid) {
        return res.status(403).json({
          success: false,
          message: "Forbidden: You cannot modify orders belonging to another vendor.",
        });
      }

      if (order.status !== "pending") {
        return res.status(400).json({
          success: false,
          message: `Only pending orders can be updated. This order is already ${order.status}.`,
        });
      }

      const now = new Date().toISOString();
      const businessName =
        req.user.businessName || order.businessName || `${req.user.name} Kitchen`;

      const emailNotification = await sendOrderStatusNotification({
        order,
        newStatus: status,
        businessName,
      });

      const historyEntry = {
        status,
        timestamp: now,
        note:
          (typeof note === "string" && note.trim()) ||
          (status === "accepted"
            ? `Order accepted by ${businessName}. Fresh dough is heading to the oven!`
            : `Order declined by ${businessName}.`),
      };

      await ordersCollection.updateOne(
        { _id: orderObjectId },
        {
          $set: {
            status,
            emailNotification,
            updatedAt: now,
          },
          $push: { statusHistory: historyEntry },
        }
      );

      const updatedOrder = await ordersCollection.findOne({ _id: orderObjectId });

      return res.status(200).json({
        success: true,
        message: `Order ${status} and customer notified at ${order.customerEmail}.`,
        order: updatedOrder,
        emailNotification,
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
