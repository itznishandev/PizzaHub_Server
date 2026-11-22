const path = require("path");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "pizzahub_db";

let cachedClient = null;
let cachedDb = null;

async function connectDB() {
  if (cachedDb && cachedClient) {
    return { client: cachedClient, db: cachedDb };
  }

  if (!uri) {
    throw new Error("MONGODB_URI is missing in environment configuration.");
  }

  const client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: false,
      deprecationErrors: true,
    },
    maxPoolSize: 10,
  });

  await client.connect();
  const db = client.db(dbName);

  try {
    await db.collection("users").createIndex({ email: 1 }, { unique: true });
    await db.collection("users").createIndex({ role: 1 });
    await db.collection("menuItems").createIndex({ vendorId: 1 });
    await db.collection("menuItems").createIndex({ status: 1, category: 1 });
    await db.collection("menuItems").createIndex({ price: 1 });
    await db.collection("orders").createIndex({ customerId: 1, createdAt: -1 });
    await db.collection("orders").createIndex({ vendorId: 1, createdAt: -1 });
    await db.collection("orders").createIndex({ itemId: 1, customerId: 1, deliveryDate: 1 });
    await db.collection("transactions").createIndex({ vendorId: 1, createdAt: -1 });
    await db.collection("transactions").createIndex({ stripeSessionId: 1 });
  } catch (indexErr) {
    // Indexes may already exist on Atlas
  }

  cachedClient = client;
  cachedDb = db;
  return { client, db };
}

async function getCollections() {
  const { db } = await connectDB();
  return {
    db,
    usersCollection: db.collection("users"),
    menuItemsCollection: db.collection("menuItems"),
    ordersCollection: db.collection("orders"),
    transactionsCollection: db.collection("transactions"),
  };
}

function toObjectId(id) {
  if (!id || typeof id !== "string" || !ObjectId.isValid(id)) {
    return null;
  }
  return new ObjectId(id);
}

function sanitizeUser(userDoc) {
  if (!userDoc) return null;
  return {
    uid: userDoc._id.toString(),
    name: userDoc.name,
    email: userDoc.email,
    image: userDoc.image || null,
    role: userDoc.role || "customer",
    isBlocked: Boolean(userDoc.isBlocked),
    businessName: userDoc.businessName || "",
    subscriptionPlan: userDoc.subscriptionPlan || "free",
    subscriptionExpiresAt: userDoc.subscriptionExpiresAt || null,
    phone: userDoc.phone || "",
    address: userDoc.address || "",
    favorites: Array.isArray(userDoc.favorites) ? userDoc.favorites : [],
    createdAt: userDoc.createdAt || null,
  };
}

module.exports = {
  connectDB,
  getCollections,
  toObjectId,
  sanitizeUser,
  ObjectId,
};
