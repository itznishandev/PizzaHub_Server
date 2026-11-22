const express = require("express");
const bcrypt = require("bcryptjs");
const { getCollections, sanitizeUser, toObjectId } = require("../config/db");
const {
  signToken,
  verifyToken,
  verifySubscriptionStatus,
} = require("../middleware/auth");

const router = express.Router();

function validatePasswordStrength(password) {
  if (!password || typeof password !== "string" || password.length < 6) {
    return "Password must be at least 6 characters long.";
  }
  if (!/[A-Z]/.test(password)) {
    return "Password must include at least one uppercase letter.";
  }
  if (!/[a-z]/.test(password)) {
    return "Password must include at least one lowercase letter.";
  }
  return null;
}

function buildDefaultAvatar(name) {
  const safeName = encodeURIComponent((name || "Pizza Lover").trim());
  return `https://ui-avatars.com/api/?name=${safeName}&background=C83E2B&color=ffffff&bold=true`;
}

function setAuthCookie(res, token) {
  res.cookie("pizzahub_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

// POST /api/jwt - Issue JWT for an existing verified account
router.post("/jwt", async (req, res, next) => {
  try {
    const { email } = req.body || {};
    if (!email || typeof email !== "string") {
      return res.status(400).json({
        success: false,
        message: "Email is required to generate an authentication token.",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const { usersCollection } = await getCollections();
    const userDoc = await usersCollection.findOne({ email: normalizedEmail });

    if (!userDoc) {
      return res.status(404).json({
        success: false,
        message: "Account not found for JWT issuance.",
      });
    }

    if (userDoc.isBlocked) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Your account has been blocked by an administrator.",
      });
    }

    const activeDoc = await verifySubscriptionStatus(userDoc);
    const userPayload = sanitizeUser(activeDoc);
    const token = signToken(userPayload);
    setAuthCookie(res, token);

    return res.status(200).json({
      success: true,
      token,
      user: userPayload,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/register - Register a Customer or Vendor account
router.post("/auth/register", async (req, res, next) => {
  try {
    const { name, email, password, image, role, businessName } = req.body || {};

    if (!name || typeof name !== "string" || name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: "Full name must be at least 2 characters long.",
      });
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({
        success: false,
        message: "A valid email address is required.",
      });
    }

    const passwordError = validatePasswordStrength(password);
    if (passwordError) {
      return res.status(400).json({
        success: false,
        message: passwordError,
      });
    }

    const requestedRole = (role || "customer").toLowerCase().trim();
    if (requestedRole === "admin") {
      return res.status(403).json({
        success: false,
        message: "Admin accounts cannot be created through public registration.",
      });
    }
    if (!["customer", "vendor"].includes(requestedRole)) {
      return res.status(400).json({
        success: false,
        message: "Role must be either Customer or Vendor.",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const { usersCollection } = await getCollections();
    const existing = await usersCollection.findOne({ email: normalizedEmail });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const cleanName = name.trim();
    const now = new Date().toISOString();

    const newUserDoc = {
      name: cleanName,
      email: normalizedEmail,
      image: image && typeof image === "string" && image.trim()
        ? image.trim()
        : buildDefaultAvatar(cleanName),
      role: requestedRole,
      isBlocked: false,
      businessName:
        requestedRole === "vendor"
          ? (businessName && businessName.trim()) || `${cleanName} Kitchen`
          : "",
      subscriptionPlan: "free",
      subscriptionExpiresAt: null,
      phone: "",
      address: "",
      favorites: [],
      passwordHash,
      provider: "credentials",
      createdAt: now,
      updatedAt: now,
    };

    const insertResult = await usersCollection.insertOne(newUserDoc);
    newUserDoc._id = insertResult.insertedId;

    const userPayload = sanitizeUser(newUserDoc);
    const token = signToken(userPayload);
    setAuthCookie(res, token);

    return res.status(201).json({
      success: true,
      message: "Account registered successfully.",
      user: userPayload,
      token,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login - Authenticate with email and password
router.post("/auth/login", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const { usersCollection } = await getCollections();
    const userDoc = await usersCollection.findOne({ email: normalizedEmail });

    if (!userDoc || !userDoc.passwordHash) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const isMatch = await bcrypt.compare(password, userDoc.passwordHash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    if (userDoc.isBlocked) {
      return res.status(403).json({
        success: false,
        message: "Your account has been blocked by an administrator.",
      });
    }

    const activeDoc = await verifySubscriptionStatus(userDoc);
    const userPayload = sanitizeUser(activeDoc);
    const token = signToken(userPayload);
    setAuthCookie(res, token);

    return res.status(200).json({
      success: true,
      message: "Signed in successfully.",
      user: userPayload,
      token,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/social - Synchronize Better Auth Google OAuth account
router.post("/auth/social", async (req, res, next) => {
  try {
    const { email, name, image, role, businessName } = req.body || {};
    if (!email || typeof email !== "string") {
      return res.status(400).json({
        success: false,
        message: "Email is required for Google account synchronization.",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const { usersCollection } = await getCollections();
    const existing = await usersCollection.findOne({ email: normalizedEmail });

    if (existing) {
      if (existing.isBlocked) {
        return res.status(403).json({
          success: false,
          message: "Your account has been blocked by an administrator.",
        });
      }

      const activeDoc = await verifySubscriptionStatus(existing);
      const userPayload = sanitizeUser(activeDoc);
      const token = signToken(userPayload);
      setAuthCookie(res, token);

      return res.status(200).json({
        success: true,
        user: userPayload,
        token,
      });
    }

    const requestedRole = (role || "customer").toLowerCase().trim();
    const safeRole = requestedRole === "vendor" ? "vendor" : "customer";
    const cleanName = (name && name.trim()) || normalizedEmail.split("@")[0];
    const now = new Date().toISOString();

    const newUserDoc = {
      name: cleanName,
      email: normalizedEmail,
      image: image || buildDefaultAvatar(cleanName),
      role: safeRole,
      isBlocked: false,
      businessName:
        safeRole === "vendor"
          ? (businessName && businessName.trim()) || `${cleanName} Kitchen`
          : "",
      subscriptionPlan: "free",
      subscriptionExpiresAt: null,
      phone: "",
      address: "",
      favorites: [],
      provider: "google",
      createdAt: now,
      updatedAt: now,
    };

    const insertResult = await usersCollection.insertOne(newUserDoc);
    newUserDoc._id = insertResult.insertedId;

    const userPayload = sanitizeUser(newUserDoc);
    const token = signToken(userPayload);
    setAuthCookie(res, token);

    return res.status(200).json({
      success: true,
      user: userPayload,
      token,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me - Get live authenticated profile
router.get("/auth/me", verifyToken, async (req, res) => {
  return res.status(200).json({
    success: true,
    user: req.user,
  });
});

// PUT /api/auth/profile - Update editable profile fields without touching role or subscription
router.put("/auth/profile", verifyToken, async (req, res, next) => {
  try {
    const { name, image, phone, address, businessName } = req.body || {};
    const cleanName = (name || "").trim();

    if (!cleanName || cleanName.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Name must be at least 2 characters long.",
      });
    }

    const { usersCollection, menuItemsCollection, ordersCollection } =
      await getCollections();

    const userObjectId = toObjectId(req.user.uid);
    const filter = userObjectId ? { _id: userObjectId } : { email: req.user.email };

    const updates = {
      name: cleanName,
      updatedAt: new Date().toISOString(),
    };

    if (typeof image === "string" && image.trim()) {
      updates.image = image.trim();
    }
    if (typeof phone === "string") {
      updates.phone = phone.trim();
    }
    if (typeof address === "string") {
      updates.address = address.trim();
    }
    if (req.user.role === "vendor" && typeof businessName === "string" && businessName.trim()) {
      updates.businessName = businessName.trim();
    }

    await usersCollection.updateOne(filter, { $set: updates });

    if (req.user.role === "vendor") {
      const itemSync = { vendorName: cleanName };
      if (updates.businessName) {
        itemSync.businessName = updates.businessName;
      }
      await menuItemsCollection.updateMany(
        { vendorId: req.user.uid },
        { $set: itemSync }
      );
      await ordersCollection.updateMany(
        { vendorId: req.user.uid },
        { $set: itemSync }
      );
    }

    if (req.user.role === "customer") {
      const orderSync = { customerName: cleanName };
      if (updates.image) {
        orderSync.customerImage = updates.image;
      }
      await ordersCollection.updateMany(
        { customerId: req.user.uid },
        { $set: orderSync }
      );
    }

    const updatedDoc = await usersCollection.findOne(filter);
    const userPayload = sanitizeUser(updatedDoc);
    const token = signToken(userPayload);
    setAuthCookie(res, token);

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      user: userPayload,
      token,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
