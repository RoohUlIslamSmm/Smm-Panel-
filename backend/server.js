const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");
const crypto = require("crypto");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

const dataDir = path.join(__dirname, "database");

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new DatabaseSync(
    path.join(dataDir, "smm-panel.db")
);

// Users table
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        passwordHash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        createdAt TEXT NOT NULL
    )
`);

// Orders table
db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        serviceId INTEGER NOT NULL,
        link TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'Pending',
        createdAt TEXT NOT NULL
    )
`);
// Add cost and profit columns safely for existing databases
const orderColumns = db.prepare("PRAGMA table_info(orders)").all();

if (!orderColumns.some((column) => column.name === "cost")) {
    db.exec("ALTER TABLE orders ADD COLUMN cost REAL NOT NULL DEFAULT 0");
}

if (!orderColumns.some((column) => column.name === "profit")) {
    db.exec("ALTER TABLE orders ADD COLUMN profit REAL NOT NULL DEFAULT 0");
}
// Balance table
db.exec(`
    CREATE TABLE IF NOT EXISTS account (
        id INTEGER PRIMARY KEY,
        balance REAL NOT NULL
    )
`);


// Deposits table
db.exec(`
    CREATE TABLE IF NOT EXISTS deposits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        method TEXT NOT NULL,
        amount REAL NOT NULL,
        status TEXT NOT NULL DEFAULT "Pending",
        createdAt TEXT NOT NULL
    )
`);

// Add transaction ID column safely for existing databases
const depositColumns = db.prepare("PRAGMA table_info(deposits)").all();
if (!depositColumns.some((column) => column.name === "transactionId")) {
    db.exec("ALTER TABLE deposits ADD COLUMN transactionId TEXT");
}

// Starting balance
const account = db
    .prepare("SELECT * FROM account WHERE id = 1")
    .get();

if (!account) {
    db.prepare(
        "INSERT INTO account (id, balance) VALUES (?, ?)"
    ).run(1, 100);
}

// Authentication helpers
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(password, salt, 64).toString("hex");
    return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
    const [salt, originalHash] = String(storedHash).split(":");

    if (!salt || !originalHash) {
        return false;
    }

    const hash = crypto.scryptSync(password, salt, 64).toString("hex");

    return crypto.timingSafeEqual(
        Buffer.from(hash, "hex"),
        Buffer.from(originalHash, "hex")
    );
}

// Register
app.post("/api/register", (req, res) => {
    const { name, email, password } = req.body;

    const cleanName = String(name || "").trim();
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanPassword = String(password || "");

    if (!cleanName || !cleanEmail || !cleanPassword) {
        return res.status(400).json({
            error: "Name, email and password are required"
        });
    }

    if (cleanPassword.length < 8) {
        return res.status(400).json({
            error: "Password must be at least 8 characters"
        });
    }

    try {
        const passwordHash = hashPassword(cleanPassword);
        const createdAt = new Date().toISOString();

        const result = db.prepare(
            "INSERT INTO users (name, email, passwordHash, role, createdAt) VALUES (?, ?, ?, ?, ?)"
        ).run(
            cleanName,
            cleanEmail,
            passwordHash,
            "user",
            createdAt
        );

        res.status(201).json({
            success: true,
            message: "Account created successfully",
            user: {
                id: Number(result.lastInsertRowid),
                name: cleanName,
                email: cleanEmail,
                role: "user"
            }
        });
    } catch (error) {
        if (String(error.message).includes("UNIQUE")) {
            return res.status(409).json({
                error: "Email is already registered"
            });
        }

        console.error("Register error:", error);

        res.status(500).json({
            error: "Registration failed"
        });
    }
});

// Login
app.post("/api/login", (req, res) => {
    const { email, password } = req.body;

    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanPassword = String(password || "");

    if (!cleanEmail || !cleanPassword) {
        return res.status(400).json({
            error: "Email and password are required"
        });
    }

    const user = db.prepare(
        "SELECT id, name, email, passwordHash, role FROM users WHERE email = ?"
    ).get(cleanEmail);

    if (!user || !verifyPassword(cleanPassword, user.passwordHash)) {
        return res.status(401).json({
            error: "Invalid email or password"
        });
    }

    res.json({
        success: true,
        message: "Login successful",
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role
        }
    });
});

app.get("/", (req, res) => {
    res.send("SMM PANEL BACKEND WORKING");
});

// Services
app.get("/api/services", (req, res) => {
    res.json([
        {
            id: 1,
            name: "Instagram Likes",
            category: "Instagram",
            price: 150,
            status: "active"
        },
        {
            id: 2,
            name: "Instagram Followers",
            category: "Instagram",
            price: 250,
            status: "active"
        },
        {
            id: 3,
            name: "TikTok Likes",
            category: "TikTok",
            price: 130,
            status: "active"
        },
        {
            id: 4,
            name: "TikTok Followers",
            category: "TikTok",
            price: 300,
            status: "active"
        },
        {
            id: 5,
            name: "YouTube Views",
            category: "YouTube",
            price: 280,
            status: "active"
        },
        {
            id: 6,
            name: "YouTube Subscribers",
            category: "YouTube",
            price: 500,
            status: "active"
        },
        {
            id: 9,
            name: "YouTube Likes",
            category: "YouTube",
            price: 200,
            status: "active"
        },
        {
            id: 10,
            name: "YouTube Watch Time",
            category: "YouTube",
            price: 450,
            status: "active"
        },
        {
            id: 7,
            name: "Facebook Likes",
            category: "Facebook",
            price: 180,
            status: "active"
        },
        {
            id: 8,
            name: "Facebook Followers",
            category: "Facebook",
            price: 300,
            status: "active"
        }
    ]);
});

// Balance
app.get("/api/balance", (req, res) => {
    const account = db
        .prepare("SELECT balance FROM account WHERE id = 1")
        .get();

    res.json({
        balance: account.balance
    });
});

// Get all orders
app.get("/api/orders", (req, res) => {
    const orders = db
        .prepare("SELECT * FROM orders ORDER BY id ASC")
        .all();

    res.json(orders);
});

// Admin - Get all orders
app.get("/api/admin/orders", (req, res) => {
    const orders = db.prepare("SELECT * FROM orders ORDER BY id DESC").all();
    res.json(orders);
});

// Admin - Update order status
app.patch("/api/admin/orders/:id/status", (req, res) => {
    const { status } = req.body;
    const allowedStatuses = ["Pending", "Processing", "Completed", "Cancelled"];

    if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
            error: "Invalid status",
            allowedStatuses
        });
    }

    const orderId = Number(req.params.id);

    if (!Number.isInteger(orderId) || orderId <= 0) {
        return res.status(400).json({
            error: "Invalid order ID"
        });
    }

    const order = db
        .prepare("SELECT * FROM orders WHERE id = ?")
        .get(orderId);

    if (!order) {
        return res.status(404).json({
            error: "Order not found"
        });
    }

    db.prepare(
        "UPDATE orders SET status = ? WHERE id = ?"
    ).run(status, orderId);

    const updatedOrder = db
        .prepare("SELECT * FROM orders WHERE id = ?")
        .get(orderId);

    res.json({
        success: true,
        message: "Order status updated successfully",
        order: updatedOrder
    });
});


// Create deposit request
app.post("/api/deposits", (req, res) => {
    const { method, amount, transactionId } = req.body;

    if (!["Easypaisa", "JazzCash", "Bank Account"].includes(method)) {
        return res.status(400).json({ error: "Invalid payment method" });
    }

    const depositAmount = Number(amount);
    const reference = String(transactionId || "").trim();

    if (!Number.isFinite(depositAmount) || depositAmount <= 0) {
        return res.status(400).json({ error: "Invalid deposit amount" });
    }

    if (!reference) {
        return res.status(400).json({ error: "Transaction ID / Reference Number is required" });
    }

    const createdAt = new Date().toISOString();

    const result = db.prepare(
        "INSERT INTO deposits (method, amount, transactionId, status, createdAt) VALUES (?, ?, ?, ?, ?)"
    ).run(method, depositAmount, reference, "Pending", createdAt);

    res.json({
        success: true,
        message: "Deposit request submitted",
        depositId: Number(result.lastInsertRowid),
        method,
        amount: depositAmount,
        status: "Pending"
    });
});

// Admin deposit requests
app.get("/api/admin/deposits", (req, res) => {
    const deposits = db.prepare("SELECT * FROM deposits ORDER BY id DESC").all();
    res.json(deposits);
});

// Admin deposit status
app.patch("/api/admin/deposits/:id/status", (req, res) => {
    const depositId = Number(req.params.id);
    const { status } = req.body;

    if (!Number.isInteger(depositId) || !["Approved", "Rejected"].includes(status)) {
        return res.status(400).json({ error: "Invalid deposit or status" });
    }

    const deposit = db.prepare("SELECT * FROM deposits WHERE id = ?").get(depositId);

    if (!deposit) {
        return res.status(404).json({ error: "Deposit not found" });
    }

    if (deposit.status !== "Pending") {
        return res.status(400).json({ error: "Deposit already processed" });
    }

    if (status === "Approved") {
        db.exec("BEGIN");
        try {
            db.prepare("UPDATE deposits SET status = ? WHERE id = ?").run("Approved", depositId);
            db.prepare("UPDATE account SET balance = balance + ? WHERE id = 1").run(deposit.amount);
            db.exec("COMMIT");
        } catch (error) {
            db.exec("ROLLBACK");
            throw error;
        }
    } else {
        db.prepare("UPDATE deposits SET status = ? WHERE id = ?").run("Rejected", depositId);
    }

    const updatedDeposit = db.prepare("SELECT * FROM deposits WHERE id = ?").get(depositId);
    const account = db.prepare("SELECT balance FROM account WHERE id = 1").get();

    res.json({
        success: true,
        deposit: updatedDeposit,
        balance: account.balance
    });
});

// Create order
app.post("/api/orders", (req, res) => {
    const { serviceId, link, quantity } = req.body;

    if (!serviceId || !link || !quantity) {
        return res.status(400).json({
            error: "serviceId, link and quantity are required"
        });
    }

    const services = [
        { id: 1, price: 150 },
        { id: 2, price: 250 },
        { id: 3, price: 130 },
        { id: 4, price: 300 },
        { id: 5, price: 280 },
        { id: 6, price: 500 },
        { id: 7, price: 180 },
        { id: 8, price: 300 }
    ];

    const service = services.find(
        (s) => s.id === Number(serviceId)
    );

    if (!service) {
        return res.status(400).json({
            error: "Invalid service"
        });
    }

    const qty = Number(quantity);

    if (!Number.isInteger(qty) || qty <= 0) {
        return res.status(400).json({
            error: "Quantity must be a positive number"
        });
    }

    // Price is per 1000
    const cost = (qty / 1000) * service.price;
    const providerCost = (qty / 1000) * 6;
    const profit = cost - providerCost;

    const account = db
        .prepare("SELECT balance FROM account WHERE id = 1")
        .get();

    if (account.balance < cost) {
        return res.status(400).json({
            error: "Insufficient balance",
            balance: account.balance,
            required: cost
        });
    }

    const createdAt = new Date().toISOString();

    const result = db
        .prepare(`
            INSERT INTO orders
            (serviceId, link, quantity, status, createdAt, cost, profit)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
            Number(serviceId),
            link,
            qty,
            "Pending",
            createdAt,
            cost,
            profit
        );

    db.prepare(
        "UPDATE account SET balance = balance - ? WHERE id = 1"
    ).run(cost);

    const order = db
        .prepare("SELECT * FROM orders WHERE id = ?")
        .get(Number(result.lastInsertRowid));

    const newBalance = db
        .prepare("SELECT balance FROM account WHERE id = 1")
        .get();

    res.json({
        success: true,
        message: "Order created successfully",
        cost: cost,
        balance: newBalance.balance,
        order
    });
});

app.listen(PORT, "0.0.0.0", () => {
    console.log("SMM PANEL BACKEND STARTED");
    console.log(`PORT: ${PORT}`);
});
