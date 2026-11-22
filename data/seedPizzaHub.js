const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { getCollections } = require("../config/db");

async function ensureSeedData() {
  const {
    usersCollection,
    menuItemsCollection,
    ordersCollection,
    transactionsCollection,
  } = await getCollections();

  const existingAdmin = await usersCollection.findOne({
    email: "admin@pizzahub.com",
  });
  const existingMenuCount = await menuItemsCollection.countDocuments({});

  if (existingAdmin && existingMenuCount > 0) {
    return { seeded: false };
  }

  const now = new Date();
  const daysFromNow = (days) =>
    new Date(now.getTime() + days * 86400000).toISOString().slice(0, 10);
  const daysAgoIso = (days) =>
    new Date(now.getTime() - days * 86400000).toISOString();

  const adminPassHash = await bcrypt.hash("AdminPassword123", 10);
  const vendorPassHash = await bcrypt.hash("VendorPassword123", 10);
  const customerPassHash = await bcrypt.hash("CustomerPassword123", 10);

  async function upsertUser(doc) {
    const existing = await usersCollection.findOne({ email: doc.email });
    if (existing) return existing;
    const res = await usersCollection.insertOne(doc);
    return { ...doc, _id: res.insertedId };
  }

  const adminUser = await upsertUser({
    name: "Nishan Rahman",
    email: "admin@pizzahub.com",
    image:
      "https://ui-avatars.com/api/?name=Nishan+Rahman&background=2B1D17&color=FFFBF5&bold=true",
    role: "admin",
    isBlocked: false,
    businessName: "",
    subscriptionPlan: "free",
    subscriptionExpiresAt: null,
    phone: "+880 1711-000101",
    address: "Gulshan Avenue, Dhaka",
    favorites: [],
    passwordHash: adminPassHash,
    provider: "credentials",
    createdAt: daysAgoIso(30),
    updatedAt: daysAgoIso(1),
  });

  const premiumVendor = await upsertUser({
    name: "Marco Bellini",
    email: "vendor@pizzahub.com",
    image:
      "https://ui-avatars.com/api/?name=Marco+Bellini&background=C83E2B&color=ffffff&bold=true",
    role: "vendor",
    isBlocked: false,
    businessName: "Napoli Woodfire Pizzeria",
    subscriptionPlan: "premium",
    subscriptionExpiresAt: new Date(
      now.getTime() + 28 * 86400000
    ).toISOString(),
    phone: "+880 1712-445566",
    address: "Road 11, Banani, Dhaka",
    favorites: [],
    passwordHash: vendorPassHash,
    provider: "credentials",
    createdAt: daysAgoIso(25),
    updatedAt: daysAgoIso(1),
  });

  const freeVendor = await upsertUser({
    name: "Sadia Karim",
    email: "artisan@pizzahub.com",
    image:
      "https://ui-avatars.com/api/?name=Sadia+Karim&background=E07A2E&color=ffffff&bold=true",
    role: "vendor",
    isBlocked: false,
    businessName: "Crust & Ember Kitchen",
    subscriptionPlan: "free",
    subscriptionExpiresAt: null,
    phone: "+880 1819-332211",
    address: "Satmasjid Road, Dhanmondi, Dhaka",
    favorites: [],
    passwordHash: vendorPassHash,
    provider: "credentials",
    createdAt: daysAgoIso(18),
    updatedAt: daysAgoIso(2),
  });

  const customerUser = await upsertUser({
    name: "Tariq Hasan",
    email: "customer@pizzahub.com",
    image:
      "https://ui-avatars.com/api/?name=Tariq+Hasan&background=15803D&color=ffffff&bold=true",
    role: "customer",
    isBlocked: false,
    businessName: "",
    subscriptionPlan: "free",
    subscriptionExpiresAt: null,
    phone: "+880 1911-778899",
    address: "House 24, Road 4, Uttara Sector 7, Dhaka",
    favorites: [],
    passwordHash: customerPassHash,
    provider: "credentials",
    createdAt: daysAgoIso(20),
    updatedAt: daysAgoIso(1),
  });

  if (existingMenuCount > 0) {
    return { seeded: false };
  }

  const premId = premiumVendor._id.toString();
  const freeId = freeVendor._id.toString();
  const custId = customerUser._id.toString();

  const seedItems = [
    {
      vendorId: premId,
      vendorName: premiumVendor.name,
      vendorEmail: premiumVendor.email,
      businessName: premiumVendor.businessName,
      vendorIsPremium: true,
      itemName: "Margherita Napoletana DOC",
      category: "Classic Pizzas",
      description:
        "72-hour fermented sourdough crust topped with San Marzano tomato sauce, fresh buffalo mozzarella, sweet basil leaves, and cold-pressed Sicilian olive oil.",
      price: 14.5,
      location: "Banani, Dhaka",
      images: [
        "https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=900&q=80",
        "https://images.unsplash.com/photo-1604382354936-07c5d9983bd3?auto=format&fit=crop&w=900&q=80",
      ],
      image:
        "https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=900&q=80",
      status: "approved",
      reviews: [
        {
          reviewId: crypto.randomUUID(),
          customerId: custId,
          customerName: customerUser.name,
          customerImage: customerUser.image,
          rating: 5,
          comment:
            "Blistered crust and authentic San Marzano tang. Arrived piping hot!",
          createdAt: daysAgoIso(4),
        },
      ],
      averageRating: 5.0,
      reviewCount: 1,
      createdAt: daysAgoIso(14),
      updatedAt: daysAgoIso(4),
    },
    {
      vendorId: premId,
      vendorName: premiumVendor.name,
      vendorEmail: premiumVendor.email,
      businessName: premiumVendor.businessName,
      vendorIsPremium: true,
      itemName: "Double Pepperoni & Hot Honey",
      category: "Meat Lovers",
      description:
        "Crispy cupped beef pepperoni layered over aged provolone, whole-milk mozzarella, and finished with wildflower chili-infused honey.",
      price: 18.0,
      location: "Banani, Dhaka",
      images: [
        "https://images.unsplash.com/photo-1628840042765-356cda07504e?auto=format&fit=crop&w=900&q=80",
        "https://images.unsplash.com/photo-1534308983496-4fabb1a015ee?auto=format&fit=crop&w=900&q=80",
      ],
      image:
        "https://images.unsplash.com/photo-1628840042765-356cda07504e?auto=format&fit=crop&w=900&q=80",
      status: "approved",
      reviews: [
        {
          reviewId: crypto.randomUUID(),
          customerId: custId,
          customerName: customerUser.name,
          customerImage: customerUser.image,
          rating: 5,
          comment:
            "Sweet heat from the chili honey balances the smoky pepperoni wonderfully.",
          createdAt: daysAgoIso(3),
        },
      ],
      averageRating: 5.0,
      reviewCount: 1,
      createdAt: daysAgoIso(13),
      updatedAt: daysAgoIso(3),
    },
    {
      vendorId: premId,
      vendorName: premiumVendor.name,
      vendorEmail: premiumVendor.email,
      businessName: premiumVendor.businessName,
      vendorIsPremium: true,
      itemName: "Black Truffle & Wild Mushroom",
      category: "Specialty / Gourmet Pizzas",
      description:
        "Roasted cremini and shiitake mushrooms over whipped ricotta cream, fontina cheese, caramelized shallots, and Umbrian black truffle oil.",
      price: 21.5,
      location: "Gulshan 2, Dhaka",
      images: [
        "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=900&q=80",
        "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=900&q=80",
      ],
      image:
        "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=900&q=80",
      status: "approved",
      reviews: [],
      averageRating: 4.9,
      reviewCount: 0,
      createdAt: daysAgoIso(12),
      updatedAt: daysAgoIso(12),
    },
    {
      vendorId: premId,
      vendorName: premiumVendor.name,
      vendorEmail: premiumVendor.email,
      businessName: premiumVendor.businessName,
      vendorIsPremium: true,
      itemName: "Mediterranean Pesto Garden",
      category: "Vegetarian Pizzas",
      description:
        "Genovese basil pesto base with char-grilled zucchini ribbons, marinated artichokes, Kalamata olives, cherry tomatoes, and feta crumble.",
      price: 15.75,
      location: "Gulshan 2, Dhaka",
      images: [
        "https://images.unsplash.com/photo-1593560708920-61dd98c46a4e?auto=format&fit=crop&w=900&q=80",
        "https://images.unsplash.com/photo-1571407970349-bc81e7e96d47?auto=format&fit=crop&w=900&q=80",
      ],
      image:
        "https://images.unsplash.com/photo-1593560708920-61dd98c46a4e?auto=format&fit=crop&w=900&q=80",
      status: "approved",
      reviews: [],
      averageRating: 4.8,
      reviewCount: 0,
      createdAt: daysAgoIso(11),
      updatedAt: daysAgoIso(11),
    },
    {
      vendorId: premId,
      vendorName: premiumVendor.name,
      vendorEmail: premiumVendor.email,
      businessName: premiumVendor.businessName,
      vendorIsPremium: true,
      itemName: "Roasted Garlic & Herb Knots (6 pcs)",
      category: "Sides & Appetizers",
      description:
        "Hand-tied oven-baked dough knots brushed with roasted garlic butter, aged Parmigiano-Reggiano, and served with warm marinara dip.",
      price: 7.5,
      location: "Banani, Dhaka",
      images: [
        "https://images.unsplash.com/photo-1541745537411-b8046dc6d66c?auto=format&fit=crop&w=900&q=80",
        "https://images.unsplash.com/photo-1619535860434-ba1d8fa12536?auto=format&fit=crop&w=900&q=80",
      ],
      image:
        "https://images.unsplash.com/photo-1541745537411-b8046dc6d66c?auto=format&fit=crop&w=900&q=80",
      status: "approved",
      reviews: [],
      averageRating: 4.7,
      reviewCount: 0,
      createdAt: daysAgoIso(10),
      updatedAt: daysAgoIso(10),
    },
    {
      vendorId: premId,
      vendorName: premiumVendor.name,
      vendorEmail: premiumVendor.email,
      businessName: premiumVendor.businessName,
      vendorIsPremium: true,
      itemName: "Classic Tiramisu & Blood Orange Soda",
      category: "Beverages & Desserts",
      description:
        "Espresso-soaked ladyfingers layered with velvety mascarpone cream paired with a chilled sparkling Sicilian blood orange spritz.",
      price: 9.25,
      location: "Banani, Dhaka",
      images: [
        "https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?auto=format&fit=crop&w=900&q=80",
        "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=900&q=80",
      ],
      image:
        "https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?auto=format&fit=crop&w=900&q=80",
      status: "approved",
      reviews: [],
      averageRating: 4.9,
      reviewCount: 0,
      createdAt: daysAgoIso(9),
      updatedAt: daysAgoIso(9),
    },
    {
      vendorId: freeId,
      vendorName: freeVendor.name,
      vendorEmail: freeVendor.email,
      businessName: freeVendor.businessName,
      vendorIsPremium: false,
      itemName: "Smoked BBQ Chicken & Red Onion",
      category: "Meat Lovers",
      description:
        "Flame-charred chicken breast glazed in house hickory BBQ sauce with pickled red onions, smoked gouda, and fresh cilantro.",
      price: 16.5,
      location: "Dhanmondi, Dhaka",
      images: [
        "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=900&q=80",
        "https://images.unsplash.com/photo-1590947132387-155cc02f3212?auto=format&fit=crop&w=900&q=80",
      ],
      image:
        "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=900&q=80",
      status: "approved",
      reviews: [],
      averageRating: 4.6,
      reviewCount: 0,
      createdAt: daysAgoIso(8),
      updatedAt: daysAgoIso(8),
    },
    {
      vendorId: freeId,
      vendorName: freeVendor.name,
      vendorEmail: freeVendor.email,
      businessName: freeVendor.businessName,
      vendorIsPremium: false,
      itemName: "Four Cheese Quattro Formaggi",
      category: "Classic Pizzas",
      description:
        "Stone-baked crust bubbling with mozzarella fior di latte, gorgonzola dolce, fontina val d'Aosta, and 24-month Parmigiano.",
      price: 15.0,
      location: "Dhanmondi, Dhaka",
      images: [
        "https://images.unsplash.com/photo-1571407970349-bc81e7e96d47?auto=format&fit=crop&w=900&q=80",
        "https://images.unsplash.com/photo-1548369937-47519962c11a?auto=format&fit=crop&w=900&q=80",
      ],
      image:
        "https://images.unsplash.com/photo-1571407970349-bc81e7e96d47?auto=format&fit=crop&w=900&q=80",
      status: "approved",
      reviews: [],
      averageRating: 4.8,
      reviewCount: 0,
      createdAt: daysAgoIso(7),
      updatedAt: daysAgoIso(7),
    },
    {
      vendorId: premId,
      vendorName: premiumVendor.name,
      vendorEmail: premiumVendor.email,
      businessName: premiumVendor.businessName,
      vendorIsPremium: true,
      itemName: "Burrata & Roasted Cherry Tomato",
      category: "Specialty / Gourmet Pizzas",
      description:
        "Whole creamy Pugliese burrata placed gently over oven-blistered heirloom cherry tomatoes, wild arugula, and aged balsamic reduction.",
      price: 20.0,
      location: "Uttara, Dhaka",
      images: [
        "https://images.unsplash.com/photo-1595854341625-f33ee10dbf94?auto=format&fit=crop&w=900&q=80",
        "https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=900&q=80",
      ],
      image:
        "https://images.unsplash.com/photo-1595854341625-f33ee10dbf94?auto=format&fit=crop&w=900&q=80",
      status: "approved",
      reviews: [],
      averageRating: 4.9,
      reviewCount: 0,
      createdAt: daysAgoIso(6),
      updatedAt: daysAgoIso(6),
    },
    {
      vendorId: premId,
      vendorName: premiumVendor.name,
      vendorEmail: premiumVendor.email,
      businessName: premiumVendor.businessName,
      vendorIsPremium: true,
      itemName: "Crispy Truffle Fries & Aioli",
      category: "Sides & Appetizers",
      description:
        "Double-fried hand-cut potatoes tossed in rosemary sea salt, grated parmesan, and served with roasted garlic herb aioli.",
      price: 6.75,
      location: "Bashundhara R/A, Dhaka",
      images: [
        "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=900&q=80",
      ],
      image:
        "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=900&q=80",
      status: "approved",
      reviews: [],
      averageRating: 4.5,
      reviewCount: 0,
      createdAt: daysAgoIso(5),
      updatedAt: daysAgoIso(5),
    },
    {
      vendorId: freeId,
      vendorName: freeVendor.name,
      vendorEmail: freeVendor.email,
      businessName: freeVendor.businessName,
      vendorIsPremium: false,
      itemName: "Fire-Roasted Veggie Fiesta",
      category: "Vegetarian Pizzas",
      description:
        "Sweet bell peppers, caramelized onions, charred corn, jalapeno slices, and smoky chipotle marinara on crispy thin dough.",
      price: 13.75,
      location: "Mirpur 11, Dhaka",
      images: [
        "https://images.unsplash.com/photo-1590947132387-155cc02f3212?auto=format&fit=crop&w=900&q=80",
      ],
      image:
        "https://images.unsplash.com/photo-1590947132387-155cc02f3212?auto=format&fit=crop&w=900&q=80",
      status: "pending",
      reviews: [],
      averageRating: 0,
      reviewCount: 0,
      createdAt: daysAgoIso(1),
      updatedAt: daysAgoIso(1),
    },
    {
      vendorId: premId,
      vendorName: premiumVendor.name,
      vendorEmail: premiumVendor.email,
      businessName: premiumVendor.businessName,
      vendorIsPremium: true,
      itemName: "Sicilian Nutella Calzone",
      category: "Beverages & Desserts",
      description:
        "Folded wood-fired pastry filled with warm hazelnut chocolate spread, crushed toasted pistachios, and powdered sugar.",
      price: 10.5,
      location: "Banani, Dhaka",
      images: [
        "https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=900&q=80",
      ],
      image:
        "https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=900&q=80",
      status: "pending",
      reviews: [],
      averageRating: 0,
      reviewCount: 0,
      createdAt: daysAgoIso(1),
      updatedAt: daysAgoIso(1),
    },
  ];

  const insertedMenuRes = await menuItemsCollection.insertMany(seedItems);
  const firstMenuId = insertedMenuRes.insertedIds[0].toString();
  const secondMenuId = insertedMenuRes.insertedIds[1].toString();

  await usersCollection.updateOne(
    { _id: customerUser._id },
    { $set: { favorites: [firstMenuId, secondMenuId] } }
  );

  const existingOrders = await ordersCollection.countDocuments({});
  if (existingOrders === 0) {
    await ordersCollection.insertMany([
      {
        itemId: firstMenuId,
        itemName: seedItems[0].itemName,
        itemImage: seedItems[0].image,
        itemPrice: seedItems[0].price,
        itemCategory: seedItems[0].category,
        vendorId: premId,
        vendorName: premiumVendor.name,
        businessName: premiumVendor.businessName,
        customerId: custId,
        customerName: customerUser.name,
        customerEmail: customerUser.email,
        customerImage: customerUser.image,
        deliveryDate: daysFromNow(2),
        deliveryAddress: customerUser.address,
        message: "Please slice into 8 pieces and include chili flakes.",
        quantity: 2,
        totalPrice: 29.0,
        status: "accepted",
        statusHistory: [
          {
            status: "pending",
            timestamp: daysAgoIso(2),
            note: "Order submitted and awaiting restaurant confirmation.",
          },
          {
            status: "accepted",
            timestamp: daysAgoIso(1),
            note: "Order accepted by Napoli Woodfire Pizzeria. Fresh dough is heading to the oven!",
          },
        ],
        emailNotification: {
          sent: true,
          mode: "simulated",
          recipient: customerUser.email,
          subject: `Order Accepted: ${seedItems[0].itemName} from ${premiumVendor.businessName}`,
          sentAt: daysAgoIso(1),
        },
        createdAt: daysAgoIso(2),
        updatedAt: daysAgoIso(1),
      },
      {
        itemId: secondMenuId,
        itemName: seedItems[1].itemName,
        itemImage: seedItems[1].image,
        itemPrice: seedItems[1].price,
        itemCategory: seedItems[1].category,
        vendorId: premId,
        vendorName: premiumVendor.name,
        businessName: premiumVendor.businessName,
        customerId: custId,
        customerName: customerUser.name,
        customerEmail: customerUser.email,
        customerImage: customerUser.image,
        deliveryDate: daysFromNow(4),
        deliveryAddress: customerUser.address,
        message: "Extra hot honey drizzle on the side if possible.",
        quantity: 1,
        totalPrice: 18.0,
        status: "pending",
        statusHistory: [
          {
            status: "pending",
            timestamp: daysAgoIso(0),
            note: "Order submitted and awaiting restaurant confirmation.",
          },
        ],
        emailNotification: null,
        createdAt: daysAgoIso(0),
        updatedAt: daysAgoIso(0),
      },
    ]);
  }

  const existingTx = await transactionsCollection.countDocuments({});
  if (existingTx === 0) {
    await transactionsCollection.insertOne({
      vendorId: premId,
      vendorName: premiumVendor.name,
      vendorEmail: premiumVendor.email,
      businessName: premiumVendor.businessName,
      plan: "premium",
      amount: 29,
      currency: "usd",
      stripeSessionId: "cs_test_seed_napoli_premium_001",
      stripeSubscriptionId: "sub_seed_napoli_premium_001",
      status: "succeeded",
      createdAt: daysAgoIso(15),
      updatedAt: daysAgoIso(15),
    });
  }

  return { seeded: true, adminEmail: adminUser.email };
}

if (require.main === module && process.argv.includes("--run")) {
  ensureSeedData()
    .then((res) => {
      console.log("PizzaHub seed check finished:", res);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Seed failure:", err);
      process.exit(1);
    });
}

module.exports = {
  ensureSeedData,
};
