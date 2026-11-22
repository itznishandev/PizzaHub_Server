const express = require("express");
const crypto = require("crypto");
const { getCollections, toObjectId } = require("../config/db");
const {
  verifyToken,
  optionalAuth,
  requireRole,
} = require("../middleware/auth");

const router = express.Router();

const FREE_PLAN_ACTIVE_LIMIT = 3;

const PIZZA_CATEGORIES = [
  "Classic Pizzas",
  "Vegetarian Pizzas",
  "Meat Lovers",
  "Specialty / Gourmet Pizzas",
  "Sides & Appetizers",
  "Beverages & Desserts",
];

// GET /api/menu/featured - Public featured menu items (at least 6 approved items, Premium prioritized)
router.get("/menu/featured", async (req, res, next) => {
  try {
    const { menuItemsCollection } = await getCollections();
    const items = await menuItemsCollection
      .find({ status: "approved" })
      .sort({ vendorIsPremium: -1, averageRating: -1, createdAt: -1 })
      .limit(6)
      .toArray();

    return res.status(200).json({
      success: true,
      count: items.length,
      items,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/menu/categories - Public list of categories with approved item counts
router.get("/menu/categories", async (req, res, next) => {
  try {
    const { menuItemsCollection } = await getCollections();
    const countsAgg = await menuItemsCollection
      .aggregate([
        { $match: { status: "approved" } },
        { $group: { _id: "$category", count: { $sum: 1 } } },
      ])
      .toArray();

    const countMap = new Map(countsAgg.map((row) => [row._id, row.count]));
    const categories = PIZZA_CATEGORIES.map((name) => ({
      name,
      count: countMap.get(name) || 0,
    }));

    return res.status(200).json({
      success: true,
      categories,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/menu - Public Browse Menu with search, filters, and sorting
router.get("/menu", async (req, res, next) => {
  try {
    const {
      search = "",
      category = "",
      location = "",
      minPrice,
      maxPrice,
      sort = "featured",
    } = req.query;

    const { menuItemsCollection } = await getCollections();

    const query = { status: "approved" };

    if (search && search.trim()) {
      const safeSearch = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(safeSearch, "i");
      query.$or = [
        { itemName: regex },
        { description: regex },
        { businessName: regex },
        { location: regex },
      ];
    }

    if (category && category !== "All") {
      query.category = category.trim();
    }

    if (location && location !== "All") {
      const safeLocation = location.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.location = new RegExp(safeLocation, "i");
    }

    const priceFilter = {};
    if (minPrice !== undefined && minPrice !== "" && !Number.isNaN(Number(minPrice))) {
      priceFilter.$gte = Number(minPrice);
    }
    if (maxPrice !== undefined && maxPrice !== "" && !Number.isNaN(Number(maxPrice))) {
      priceFilter.$lte = Number(maxPrice);
    }
    if (Object.keys(priceFilter).length > 0) {
      query.price = priceFilter;
    }

    let sortStage = { vendorIsPremium: -1, createdAt: -1 };
    if (sort === "price_asc") {
      sortStage = { price: 1, vendorIsPremium: -1 };
    } else if (sort === "price_desc") {
      sortStage = { price: -1, vendorIsPremium: -1 };
    } else if (sort === "rating_desc") {
      sortStage = { averageRating: -1, reviewCount: -1, vendorIsPremium: -1 };
    } else if (sort === "newest") {
      sortStage = { createdAt: -1 };
    }

    const items = await menuItemsCollection.find(query).sort(sortStage).toArray();
    const availableLocations = await menuItemsCollection.distinct("location", {
      status: "approved",
    });

    return res.status(200).json({
      success: true,
      count: items.length,
      items,
      locations: availableLocations.filter(Boolean).sort(),
      categories: PIZZA_CATEGORIES,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/menu/:id - Single menu item details
router.get("/menu/:id", optionalAuth, async (req, res, next) => {
  try {
    const objectId = toObjectId(req.params.id);
    if (!objectId) {
      return res.status(404).json({
        success: false,
        message: "Invalid menu item ID.",
      });
    }

    const { menuItemsCollection, usersCollection } = await getCollections();
    const item = await menuItemsCollection.findOne({ _id: objectId });

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Menu item not found.",
      });
    }

    const isOwnerOrAdmin =
      req.user &&
      (req.user.role === "admin" || req.user.uid === item.vendorId);

    if (item.status !== "approved" && !isOwnerOrAdmin) {
      return res.status(404).json({
        success: false,
        message: "This menu item is not currently available.",
      });
    }

    let vendorProfile = null;
    const vendorObjectId = toObjectId(item.vendorId);
    if (vendorObjectId) {
      const vendorDoc = await usersCollection.findOne({ _id: vendorObjectId });
      if (vendorDoc) {
        vendorProfile = {
          uid: vendorDoc._id.toString(),
          name: vendorDoc.name,
          businessName: vendorDoc.businessName || item.businessName,
          image: vendorDoc.image || null,
          subscriptionPlan: vendorDoc.subscriptionPlan || "free",
          isPremium: vendorDoc.subscriptionPlan === "premium",
        };
      }
    }

    return res.status(200).json({
      success: true,
      item,
      vendor: vendorProfile,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/vendor/menu - List all menu items owned by the authenticated vendor
router.get(
  "/vendor/menu",
  verifyToken,
  requireRole("vendor"),
  async (req, res, next) => {
    try {
      const { menuItemsCollection } = await getCollections();
      const items = await menuItemsCollection
        .find({ vendorId: req.user.uid })
        .sort({ createdAt: -1 })
        .toArray();

      const activeCount = items.filter((item) =>
        ["pending", "approved"].includes(item.status)
      ).length;

      return res.status(200).json({
        success: true,
        items,
        activeCount,
        maxFreeItems: FREE_PLAN_ACTIVE_LIMIT,
        subscriptionPlan: req.user.subscriptionPlan || "free",
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/menu - Create a new menu item (Vendor only, enforced Free Plan 3-item cap)
router.post(
  "/menu",
  verifyToken,
  requireRole("vendor"),
  async (req, res, next) => {
    try {
      const { itemName, category, description, price, location, images, image } =
        req.body || {};

      if (!itemName || typeof itemName !== "string" || itemName.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: "Item name must be at least 2 characters long.",
        });
      }

      if (!PIZZA_CATEGORIES.includes(category)) {
        return res.status(400).json({
          success: false,
          message: "Please select a valid PizzaHub category.",
        });
      }

      if (!description || typeof description !== "string" || description.trim().length < 10) {
        return res.status(400).json({
          success: false,
          message: "Description must be at least 10 characters long.",
        });
      }

      const numericPrice = Number(price);
      if (Number.isNaN(numericPrice) || numericPrice <= 0) {
        return res.status(400).json({
          success: false,
          message: "Price must be a valid positive number.",
        });
      }

      if (!location || typeof location !== "string" || !location.trim()) {
        return res.status(400).json({
          success: false,
          message: "Restaurant area or city location is required.",
        });
      }

      const imageList = Array.isArray(images)
        ? images.filter((u) => typeof u === "string" && u.trim())
        : image && typeof image === "string" && image.trim()
        ? [image.trim()]
        : [];

      if (imageList.length === 0) {
        return res.status(400).json({
          success: false,
          message: "At least one uploaded item image is required.",
        });
      }

      const { menuItemsCollection } = await getCollections();

      if (req.user.subscriptionPlan !== "premium") {
        const activeCount = await menuItemsCollection.countDocuments({
          vendorId: req.user.uid,
          status: { $in: ["pending", "approved"] },
        });
        if (activeCount >= FREE_PLAN_ACTIVE_LIMIT) {
          return res.status(403).json({
            success: false,
            code: "PLAN_LIMIT_REACHED",
            message:
              "Free plan allows up to 3 active or pending menu items. Upgrade to Premium for unlimited listings.",
          });
        }
      }

      const now = new Date().toISOString();
      const newMenuItem = {
        vendorId: req.user.uid,
        vendorName: req.user.name,
        vendorEmail: req.user.email,
        businessName: req.user.businessName || `${req.user.name} Kitchen`,
        vendorIsPremium: req.user.subscriptionPlan === "premium",
        itemName: itemName.trim(),
        category,
        description: description.trim(),
        price: Number(numericPrice.toFixed(2)),
        location: location.trim(),
        images: imageList,
        image: imageList[0],
        status: "pending",
        reviews: [],
        averageRating: 0,
        reviewCount: 0,
        createdAt: now,
        updatedAt: now,
      };

      const insertResult = await menuItemsCollection.insertOne(newMenuItem);
      newMenuItem._id = insertResult.insertedId;

      return res.status(201).json({
        success: true,
        message: "Menu item submitted and awaiting admin approval.",
        item: newMenuItem,
      });
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/menu/:id - Update own menu item or toggle approved/inactive availability
router.put(
  "/menu/:id",
  verifyToken,
  requireRole("vendor"),
  async (req, res, next) => {
    try {
      const objectId = toObjectId(req.params.id);
      if (!objectId) {
        return res.status(404).json({
          success: false,
          message: "Invalid menu item ID.",
        });
      }

      const { menuItemsCollection } = await getCollections();
      const existing = await menuItemsCollection.findOne({ _id: objectId });

      if (!existing) {
        return res.status(404).json({
          success: false,
          message: "Menu item not found.",
        });
      }

      if (existing.vendorId !== req.user.uid) {
        return res.status(403).json({
          success: false,
          message: "Forbidden: You can only update your own menu items.",
        });
      }

      const {
        itemName,
        category,
        description,
        price,
        location,
        images,
        image,
        status,
      } = req.body || {};

      const updates = {
        updatedAt: new Date().toISOString(),
      };

      if (itemName !== undefined) {
        if (!itemName || itemName.trim().length < 2) {
          return res.status(400).json({
            success: false,
            message: "Item name must be at least 2 characters long.",
          });
        }
        updates.itemName = itemName.trim();
      }

      if (category !== undefined) {
        if (!PIZZA_CATEGORIES.includes(category)) {
          return res.status(400).json({
            success: false,
            message: "Invalid category selected.",
          });
        }
        updates.category = category;
      }

      if (description !== undefined) {
        if (!description || description.trim().length < 10) {
          return res.status(400).json({
            success: false,
            message: "Description must be at least 10 characters long.",
          });
        }
        updates.description = description.trim();
      }

      if (price !== undefined) {
        const numericPrice = Number(price);
        if (Number.isNaN(numericPrice) || numericPrice <= 0) {
          return res.status(400).json({
            success: false,
            message: "Price must be a valid positive number.",
          });
        }
        updates.price = Number(numericPrice.toFixed(2));
      }

      if (location !== undefined) {
        if (!location || !location.trim()) {
          return res.status(400).json({
            success: false,
            message: "Location cannot be empty.",
          });
        }
        updates.location = location.trim();
      }

      if (images !== undefined || image !== undefined) {
        const imageList = Array.isArray(images)
          ? images.filter((u) => typeof u === "string" && u.trim())
          : image && typeof image === "string" && image.trim()
          ? [image.trim()]
          : [];
        if (imageList.length === 0) {
          return res.status(400).json({
            success: false,
            message: "At least one item image is required.",
          });
        }
        updates.images = imageList;
        updates.image = imageList[0];
      }

      if (status !== undefined && status !== existing.status) {
        if (!["approved", "inactive"].includes(status)) {
          return res.status(403).json({
            success: false,
            message: "Vendors can only toggle availability between active and inactive.",
          });
        }
        if (["pending", "rejected"].includes(existing.status)) {
          return res.status(403).json({
            success: false,
            message: `Cannot change availability while item is ${existing.status}.`,
          });
        }
        if (status === "approved" && req.user.subscriptionPlan !== "premium") {
          const activeCount = await menuItemsCollection.countDocuments({
            vendorId: req.user.uid,
            status: { $in: ["pending", "approved"] },
          });
          if (activeCount >= FREE_PLAN_ACTIVE_LIMIT) {
            return res.status(403).json({
              success: false,
              code: "PLAN_LIMIT_REACHED",
              message:
                "Free plan allows up to 3 active menu items. Upgrade to Premium to activate more.",
            });
          }
        }
        updates.status = status;
      }

      await menuItemsCollection.updateOne({ _id: objectId }, { $set: updates });
      const updatedItem = await menuItemsCollection.findOne({ _id: objectId });

      return res.status(200).json({
        success: true,
        message: "Menu item updated successfully.",
        item: updatedItem,
      });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/menu/:id - Delete a menu item (Vendor owner or Admin)
router.delete(
  "/menu/:id",
  verifyToken,
  requireRole("vendor", "admin"),
  async (req, res, next) => {
    try {
      const objectId = toObjectId(req.params.id);
      if (!objectId) {
        return res.status(404).json({
          success: false,
          message: "Invalid menu item ID.",
        });
      }

      const { menuItemsCollection } = await getCollections();
      const existing = await menuItemsCollection.findOne({ _id: objectId });

      if (!existing) {
        return res.status(404).json({
          success: false,
          message: "Menu item not found.",
        });
      }

      if (req.user.role === "vendor" && existing.vendorId !== req.user.uid) {
        return res.status(403).json({
          success: false,
          message: "Forbidden: You can only delete your own menu items.",
        });
      }

      await menuItemsCollection.deleteOne({ _id: objectId });

      return res.status(200).json({
        success: true,
        message: "Menu item deleted successfully.",
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/menu/:id/reviews - Submit or update customer rating & review
router.post(
  "/menu/:id/reviews",
  verifyToken,
  requireRole("customer"),
  async (req, res, next) => {
    try {
      const objectId = toObjectId(req.params.id);
      if (!objectId) {
        return res.status(404).json({
          success: false,
          message: "Invalid menu item ID.",
        });
      }

      const { rating, comment } = req.body || {};
      const numericRating = Number(rating);
      if (
        Number.isNaN(numericRating) ||
        numericRating < 1 ||
        numericRating > 5
      ) {
        return res.status(400).json({
          success: false,
          message: "Rating must be between 1 and 5 stars.",
        });
      }

      if (!comment || typeof comment !== "string" || comment.trim().length < 3) {
        return res.status(400).json({
          success: false,
          message: "Please write a brief review comment.",
        });
      }

      const { menuItemsCollection } = await getCollections();
      const item = await menuItemsCollection.findOne({ _id: objectId });

      if (!item || item.status !== "approved") {
        return res.status(404).json({
          success: false,
          message: "Approved menu item not found.",
        });
      }

      const existingReviews = Array.isArray(item.reviews) ? item.reviews : [];
      const filteredReviews = existingReviews.filter(
        (r) => r.customerId !== req.user.uid
      );

      const newReview = {
        reviewId: crypto.randomUUID(),
        customerId: req.user.uid,
        customerName: req.user.name,
        customerImage: req.user.image || null,
        rating: Math.round(numericRating),
        comment: comment.trim(),
        createdAt: new Date().toISOString(),
      };

      const updatedReviews = [newReview, ...filteredReviews];
      const totalScore = updatedReviews.reduce((acc, r) => acc + r.rating, 0);
      const averageRating = Number(
        (totalScore / updatedReviews.length).toFixed(1)
      );

      await menuItemsCollection.updateOne(
        { _id: objectId },
        {
          $set: {
            reviews: updatedReviews,
            averageRating,
            reviewCount: updatedReviews.length,
            updatedAt: new Date().toISOString(),
          },
        }
      );

      const updatedItem = await menuItemsCollection.findOne({ _id: objectId });

      return res.status(201).json({
        success: true,
        message: "Review submitted successfully.",
        item: updatedItem,
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
module.exports.PIZZA_CATEGORIES = PIZZA_CATEGORIES;
