const path = require("path");
const jwt = require("jsonwebtoken");
const { getCollections, toObjectId, sanitizeUser } = require("../config/db");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const JWT_SECRET =
  process.env.JWT_SECRET || "pizzahub_jwt_secret_key_2026_cat009_secure";

function signToken(user) {
  return jwt.sign(
    {
      uid: user.uid || user._id?.toString(),
      email: user.email.toLowerCase().trim(),
      role: user.role || "customer",
      name: user.name || "",
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

async function verifySubscriptionStatus(userDoc) {
  if (
    userDoc.role === "vendor" &&
    userDoc.subscriptionPlan === "premium" &&
    userDoc.subscriptionExpiresAt
  ) {
    const expiresAt = new Date(userDoc.subscriptionExpiresAt).getTime();
    if (!Number.isNaN(expiresAt) && expiresAt <= Date.now()) {
      const { usersCollection, menuItemsCollection } = await getCollections();
      await usersCollection.updateOne(
        { _id: userDoc._id },
        {
          $set: {
            subscriptionPlan: "free",
            subscriptionExpiresAt: null,
            updatedAt: new Date().toISOString(),
          },
        }
      );
      await menuItemsCollection.updateMany(
        { vendorId: userDoc._id.toString() },
        { $set: { vendorIsPremium: false } }
      );
      return {
        ...userDoc,
        subscriptionPlan: "free",
        subscriptionExpiresAt: null,
      };
    }
  }
  return userDoc;
}

async function verifyToken(req, res, next) {
  try {
    let token = null;
    const authHeader = req.headers.authorization || req.headers.Authorization;

    if (
      authHeader &&
      typeof authHeader === "string" &&
      authHeader.startsWith("Bearer ")
    ) {
      token = authHeader.slice(7).trim();
    } else if (req.cookies && req.cookies.pizzahub_token) {
      token = req.cookies.pizzahub_token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Authentication token is required.",
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (jwtErr) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Invalid or expired authentication token.",
      });
    }

    const { usersCollection } = await getCollections();
    const userObjectId = toObjectId(decoded.uid);

    let userDoc = null;
    if (userObjectId) {
      userDoc = await usersCollection.findOne({ _id: userObjectId });
    }
    if (!userDoc && decoded.email) {
      userDoc = await usersCollection.findOne({
        email: decoded.email.toLowerCase().trim(),
      });
    }

    if (!userDoc) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Account no longer exists.",
      });
    }

    if (userDoc.isBlocked) {
      return res.status(403).json({
        success: false,
        message:
          "Forbidden: Your account has been blocked by an administrator.",
      });
    }

    userDoc = await verifySubscriptionStatus(userDoc);
    req.user = sanitizeUser(userDoc);
    next();
  } catch (error) {
    next(error);
  }
}

async function optionalAuth(req, res, next) {
  try {
    let token = null;
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (
      authHeader &&
      typeof authHeader === "string" &&
      authHeader.startsWith("Bearer ")
    ) {
      token = authHeader.slice(7).trim();
    } else if (req.cookies && req.cookies.pizzahub_token) {
      token = req.cookies.pizzahub_token;
    }

    if (!token) {
      req.user = null;
      return next();
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const { usersCollection } = await getCollections();
      const userObjectId = toObjectId(decoded.uid);
      let userDoc = userObjectId
        ? await usersCollection.findOne({ _id: userObjectId })
        : null;
      if (!userDoc && decoded.email) {
        userDoc = await usersCollection.findOne({
          email: decoded.email.toLowerCase().trim(),
        });
      }
      if (userDoc && !userDoc.isBlocked) {
        userDoc = await verifySubscriptionStatus(userDoc);
        req.user = sanitizeUser(userDoc);
      } else {
        req.user = null;
      }
    } catch {
      req.user = null;
    }
    next();
  } catch (error) {
    req.user = null;
    next();
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Authentication is required.",
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: This action requires ${allowedRoles.join(" or ")} privileges.`,
      });
    }

    next();
  };
}

module.exports = {
  JWT_SECRET,
  signToken,
  verifyToken,
  optionalAuth,
  requireRole,
  verifySubscriptionStatus,
};
