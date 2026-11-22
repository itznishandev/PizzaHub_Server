const express = require("express");
const { getCollections, toObjectId } = require("../config/db");
const { optionalAuth } = require("../middleware/auth");

const router = express.Router();

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

module.exports = router;
module.exports.PIZZA_CATEGORIES = PIZZA_CATEGORIES;
