const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);

const adminEmail = String(process.env.ADMIN_EMAIL || "")
    .trim()
    .toLowerCase();

const adminPassword = String(process.env.ADMIN_PASSWORD || "");

// ==================== SMM WORLD PROVIDER ====================
// The provider API key must ONLY live in Railway/environment variables.
const SMM_WORLD_API_URL = String(
    process.env.SMM_WORLD_API_URL ||
    "https://my.smmworld.org/api/v2"
).trim();

const SMM_WORLD_API_KEY = String(
    process.env.SMM_WORLD_API_KEY || ""
).trim();

const SMM_WORLD_USD_TO_PKR = Number(
    process.env.SMM_WORLD_USD_TO_PKR || 0
);

const PROVIDER_STATUS_INTERVAL_MS = Math.max(
    2 * 60 * 1000,
    Number(process.env.SMM_WORLD_STATUS_INTERVAL_MS || 180000)
);

app.use(cors());
app.use(express.json());

const dataDir = path.join(__dirname, "database");

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new DatabaseSync(
    path.join(dataDir, "smm-panel.db")
);

// ==================== USERS ====================

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

// ==================== SESSIONS ====================

db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        userId INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        expiresAt TEXT NOT NULL,
        FOREIGN KEY (userId) REFERENCES users(id)
    )
`);

// ==================== ORDERS ====================

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

const orderColumns = db.prepare("PRAGMA table_info(orders)").all();

if (!orderColumns.some((column) => column.name === "cost")) {
    db.exec(
        "ALTER TABLE orders ADD COLUMN cost REAL NOT NULL DEFAULT 0"
    );
}

if (!orderColumns.some((column) => column.name === "profit")) {
    db.exec(
        "ALTER TABLE orders ADD COLUMN profit REAL NOT NULL DEFAULT 0"
    );
}

for (const [column, definition] of [
    ["providerOrderId", "TEXT"],
    ["providerServiceId", "INTEGER"],
    ["providerStatus", "TEXT"],
    ["providerCharge", "REAL"],
    ["providerCurrency", "TEXT"],
    ["providerLastCheckedAt", "TEXT"],
    ["providerError", "TEXT"],
    ["submissionState", "TEXT NOT NULL DEFAULT 'local'"],
]) {
    if (!orderColumns.some((item) => item.name === column)) {
        db.exec(`ALTER TABLE orders ADD COLUMN ${column} ${definition}`);
    }
}

// ==================== BALANCE ====================

db.exec(`
    CREATE TABLE IF NOT EXISTS account (
        id INTEGER PRIMARY KEY,
        balance REAL NOT NULL
    )
`);

// ==================== WITHDRAWALS ====================

db.exec(`
    CREATE TABLE IF NOT EXISTS withdrawals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        amount REAL NOT NULL,
        method TEXT NOT NULL,
        account TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Pending',
        createdAt TEXT NOT NULL
    )
`);

// ==================== DEPOSITS ====================

db.exec(`
    CREATE TABLE IF NOT EXISTS deposits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        method TEXT NOT NULL,
        amount REAL NOT NULL,
        status TEXT NOT NULL DEFAULT "Pending",
        createdAt TEXT NOT NULL
    )
`);

const depositColumns = db.prepare("PRAGMA table_info(deposits)").all();

if (!depositColumns.some((column) => column.name === "transactionId")) {
    db.exec(
        "ALTER TABLE deposits ADD COLUMN transactionId TEXT"
    );
}

// ==================== PROVIDER SERVICE MAPPING ====================

db.exec(`
    CREATE TABLE IF NOT EXISTS provider_service_map (
        localServiceId INTEGER PRIMARY KEY,
        providerServiceId INTEGER NOT NULL,
        providerName TEXT,
        providerType TEXT,
        providerRate REAL,
        providerMin INTEGER,
        providerMax INTEGER,
        providerRefill INTEGER DEFAULT 0,
        providerCancel INTEGER DEFAULT 0,
        updatedAt TEXT NOT NULL
    )
`);

// ==================== DEFAULT SMM WORLD SERVICE MAPPINGS ====================
// These are the verified SMM World service IDs selected for the 10 services
// already offered by the Rooh Ul Islam SMM panel.
//
// INSERT OR IGNORE is intentional: it makes the mappings survive restarts
// and fresh deployments without overwriting an admin's later manual change.
const DEFAULT_PROVIDER_MAPPINGS = [
    { localServiceId: 1, providerServiceId: 23998 }, // Instagram Likes
    { localServiceId: 2, providerServiceId: 24260 }, // Instagram Followers
    { localServiceId: 3, providerServiceId: 24244 }, // TikTok Likes
    { localServiceId: 4, providerServiceId: 23937 }, // TikTok Followers
    { localServiceId: 5, providerServiceId: 23416 }, // YouTube Views
    { localServiceId: 6, providerServiceId: 23381 }, // YouTube Subscribers
    { localServiceId: 9, providerServiceId: 23375 }, // YouTube Likes
    { localServiceId: 10, providerServiceId: 23134 }, // YouTube Watch Time
    { localServiceId: 7, providerServiceId: 22510 }, // Facebook Likes
    { localServiceId: 8, providerServiceId: 23412 }, // Facebook Followers
];

const insertDefaultProviderMapping = db.prepare(`
    INSERT OR IGNORE INTO provider_service_map
    (
        localServiceId,
        providerServiceId,
        providerName,
        providerType,
        providerRate,
        providerMin,
        providerMax,
        providerRefill,
        providerCancel,
        updatedAt
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

for (const mapping of DEFAULT_PROVIDER_MAPPINGS) {
    insertDefaultProviderMapping.run(
        mapping.localServiceId,
        mapping.providerServiceId,
        "SMM World",
        "",
        0,
        0,
        0,
        0,
        0,
        new Date().toISOString()
    );
}

// ==================== STARTING BALANCE ====================

const account = db
    .prepare("SELECT * FROM account WHERE id = 1")
    .get();

if (!account) {
    db.prepare(
        "INSERT INTO account (id, balance) VALUES (?, ?)"
    ).run(1, 100);
}

// ==================== PASSWORD SECURITY ====================

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");

    const hash = crypto
        .scryptSync(password, salt, 64)
        .toString("hex");

    return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
    const parts = String(storedHash).split(":");

    if (parts.length !== 2) {
        return false;
    }

    const [salt, originalHash] = parts;

    if (!salt || !originalHash) {
        return false;
    }

    try {
        const hash = crypto
            .scryptSync(password, salt, 64)
            .toString("hex");

        const originalBuffer = Buffer.from(originalHash, "hex");
        const hashBuffer = Buffer.from(hash, "hex");

        if (originalBuffer.length !== hashBuffer.length) {
            return false;
        }

        return crypto.timingSafeEqual(
            hashBuffer,
            originalBuffer
        );
    } catch (error) {
        return false;
    }
}

// ==================== SESSION SYSTEM ====================

const SESSION_DAYS = 7;

function createSession(userId) {
    const token = crypto
        .randomBytes(32)
        .toString("hex");

    const now = new Date();

    const expires = new Date(
        now.getTime() +
        SESSION_DAYS * 24 * 60 * 60 * 1000
    );

    db.prepare(`
        INSERT INTO sessions
        (token, userId, createdAt, expiresAt)
        VALUES (?, ?, ?, ?)
    `).run(
        token,
        userId,
        now.toISOString(),
        expires.toISOString()
    );

    return token;
}

function getAuthUser(req) {
    const header = String(
        req.headers.authorization || ""
    );

    if (!header.startsWith("Bearer ")) {
        return null;
    }

    const token = header
        .slice(7)
        .trim();

    if (!token) {
        return null;
    }

    const session = db.prepare(`
        SELECT
            u.id,
            u.name,
            u.email,
            u.role,
            s.expiresAt
        FROM sessions s
        JOIN users u
            ON u.id = s.userId
        WHERE s.token = ?
    `).get(token);

    if (!session) {
        return null;
    }

    if (
        new Date(session.expiresAt).getTime()
        <= Date.now()
    ) {
        db.prepare(
            "DELETE FROM sessions WHERE token = ?"
        ).run(token);

        return null;
    }

    return session;
}

// ==================== SMM WORLD API CLIENT ====================

function providerConfigured() {
    return Boolean(SMM_WORLD_API_KEY);
}

async function smmWorldRequest(payload) {
    if (!providerConfigured()) {
        throw new Error("SMM World API key is not configured");
    }

    const response = await fetch(SMM_WORLD_API_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            key: SMM_WORLD_API_KEY,
            ...payload,
        }),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
        throw new Error(`SMM World HTTP ${response.status}`);
    }

    if (!data || typeof data !== "object") {
        throw new Error("Invalid response from SMM World");
    }

    if (data.error) {
        throw new Error(String(data.error));
    }

    return data;
}

async function getProviderServices() {
    const data = await smmWorldRequest({ action: "services" });
    if (!Array.isArray(data)) {
        throw new Error("SMM World returned an invalid services list");
    }
    return data;
}

async function addProviderOrder({ serviceId, link, quantity }) {
    return smmWorldRequest({
        action: "add",
        service: Number(serviceId),
        link,
        quantity: Number(quantity),
    });
}

async function getProviderOrderStatus(providerOrderId) {
    return smmWorldRequest({
        action: "status",
        order: String(providerOrderId),
    });
}

async function getProviderBalance() {
    return smmWorldRequest({ action: "balance" });
}

function mapProviderStatus(status) {
    const value = String(status || "").toLowerCase();

    if (value === "completed") return "Completed";
    if (value === "partial") return "Partial";
    if (value === "canceled" || value === "cancelled") return "Cancelled";
    if (value === "in progress" || value === "processing") return "Processing";
    if (value === "pending") return "Pending";

    return "Processing";
}

function updateOrderProviderFinancials(orderId, providerStatus) {
    const charge = Number(providerStatus.charge);
    const currency = String(providerStatus.currency || "").toUpperCase();

    if (!Number.isFinite(charge) || charge < 0) {
        return;
    }

    const existing = db.prepare(
        "SELECT cost FROM orders WHERE id = ?"
    ).get(orderId);

    if (!existing) return;

    let providerCostPkr = null;

    if (currency === "PKR") {
        providerCostPkr = charge;
    } else if (currency === "USD" && SMM_WORLD_USD_TO_PKR > 0) {
        providerCostPkr = charge * SMM_WORLD_USD_TO_PKR;
    }

    if (providerCostPkr === null) {
        return;
    }

    const profit = Number(existing.cost) - providerCostPkr;

    db.prepare(`
        UPDATE orders
        SET providerCharge = ?,
            providerCurrency = ?,
            profit = ?
        WHERE id = ?
    `).run(
        charge,
        currency || null,
        profit,
        orderId
    );
}

async function refreshProviderOrder(order) {
    if (!order.providerOrderId) return null;

    try {
        const providerStatus = await getProviderOrderStatus(
            order.providerOrderId
        );

        const localStatus = mapProviderStatus(
            providerStatus.status
        );

        db.prepare(`
            UPDATE orders
            SET status = ?,
                providerStatus = ?,
                providerCharge = CASE
                    WHEN ? IS NOT NULL THEN ?
                    ELSE providerCharge
                END,
                providerCurrency = CASE
                    WHEN ? IS NOT NULL THEN ?
                    ELSE providerCurrency
                END,
                providerLastCheckedAt = ?,
                providerError = NULL
            WHERE id = ?
        `).run(
            localStatus,
            String(providerStatus.status || ""),
            Number.isFinite(Number(providerStatus.charge))
                ? Number(providerStatus.charge)
                : null,
            Number.isFinite(Number(providerStatus.charge))
                ? Number(providerStatus.charge)
                : null,
            providerStatus.currency
                ? String(providerStatus.currency)
                : null,
            providerStatus.currency
                ? String(providerStatus.currency)
                : null,
            new Date().toISOString(),
            order.id
        );

        updateOrderProviderFinancials(order.id, providerStatus);

        return providerStatus;
    } catch (error) {
        console.error(
            `Provider status error for local order #${order.id}:`,
            error.message
        );

        db.prepare(`
            UPDATE orders
            SET providerLastCheckedAt = ?,
                providerError = ?
            WHERE id = ?
        `).run(
            new Date().toISOString(),
            String(error.message || "Provider status check failed").slice(0, 500),
            order.id
        );

        return null;
    }
}

async function syncActiveProviderOrders() {
    if (!providerConfigured()) return;

    const orders = db.prepare(`
        SELECT *
        FROM orders
        WHERE providerOrderId IS NOT NULL
          AND providerOrderId != ''
          AND status IN ('Pending', 'Processing', 'Partial')
        ORDER BY id ASC
        LIMIT 100
    `).all();

    for (const order of orders) {
        await refreshProviderOrder(order);
    }
}

// ==================== AUTH MIDDLEWARE ====================

function requireAuth(req, res, next) {
    const user = getAuthUser(req);

    if (!user) {
        return res.status(401).json({
            error: "Authentication required"
        });
    }

    req.user = user;

    next();
}

function requireAdmin(req, res, next) {
    const user = getAuthUser(req);

    if (!user) {
        return res.status(401).json({
            error: "Authentication required"
        });
    }

    if (user.role !== "admin") {
        return res.status(403).json({
            error: "Admin access required"
        });
    }

    req.user = user;

    next();
}

// ==================== ADMIN BOOTSTRAP ====================

if (
    adminEmail &&
    adminPassword.length >= 8
) {
    const existingAdmin = db
        .prepare(
            "SELECT id FROM users WHERE email = ?"
        )
        .get(adminEmail);

    if (existingAdmin) {
        db.prepare(
            "UPDATE users SET role = 'admin' WHERE id = ?"
        ).run(existingAdmin.id);
    } else {
        db.prepare(`
            INSERT INTO users
            (name, email, passwordHash, role, createdAt)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            "Administrator",
            adminEmail,
            hashPassword(adminPassword),
            "admin",
            new Date().toISOString()
        );
    }
}

// ==================== REGISTER ====================

app.post("/api/register", (req, res) => {
    const {
        name,
        email,
        password
    } = req.body;

    const cleanName = String(name || "").trim();
    const cleanEmail = String(email || "")
        .trim()
        .toLowerCase();

    const cleanPassword = String(password || "");

    if (
        !cleanName ||
        !cleanEmail ||
        !cleanPassword
    ) {
        return res.status(400).json({
            error:
                "Name, email and password are required"
        });
    }

    if (cleanPassword.length < 8) {
        return res.status(400).json({
            error:
                "Password must be at least 8 characters"
        });
    }

    try {
        const passwordHash =
            hashPassword(cleanPassword);

        const createdAt =
            new Date().toISOString();

        const result = db.prepare(`
            INSERT INTO users
            (name, email, passwordHash, role, createdAt)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            cleanName,
            cleanEmail,
            passwordHash,
            "user",
            createdAt
        );

        res.status(201).json({
            success: true,
            message:
                "Account created successfully",
            user: {
                id: Number(result.lastInsertRowid),
                name: cleanName,
                email: cleanEmail,
                role: "user"
            }
        });
    } catch (error) {
        if (
            String(error.message)
                .includes("UNIQUE")
        ) {
            return res.status(409).json({
                error:
                    "Email is already registered"
            });
        }

        console.error(
            "Register error:",
            error
        );

        res.status(500).json({
            error:
                "Registration failed"
        });
    }
});

// ==================== LOGIN ====================

app.post("/api/login", (req, res) => {
    const {
        email,
        password
    } = req.body;

    const cleanEmail = String(email || "")
        .trim()
        .toLowerCase();

    const cleanPassword =
        String(password || "");

    if (
        !cleanEmail ||
        !cleanPassword
    ) {
        return res.status(400).json({
            error:
                "Email and password are required"
        });
    }

    const user = db.prepare(`
        SELECT
            id,
            name,
            email,
            passwordHash,
            role
        FROM users
        WHERE email = ?
    `).get(cleanEmail);

    if (
        !user ||
        !verifyPassword(
            cleanPassword,
            user.passwordHash
        )
    ) {
        return res.status(401).json({
            error:
                "Invalid email or password"
        });
    }

    const token =
        createSession(user.id);

    res.json({
        success: true,
        message: "Login successful",
        token,
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role
        }
    });
});

// ==================== CURRENT USER ====================

app.get(
    "/api/me",
    requireAuth,
    (req, res) => {
        res.json({
            user: {
                id: req.user.id,
                name: req.user.name,
                email: req.user.email,
                role: req.user.role
            }
        });
    }
);

// ==================== LOGOUT ====================

app.post(
    "/api/logout",
    requireAuth,
    (req, res) => {
        const header = String(
            req.headers.authorization || ""
        );

        const token =
            header.slice(7).trim();

        db.prepare(
            "DELETE FROM sessions WHERE token = ?"
        ).run(token);

        res.json({
            success: true
        });
    }
);

// ==================== HOME ====================

app.get("/", (req, res) => {
    res.send(
        "SMM PANEL BACKEND WORKING"
    );
});

// ==================== LOCAL SERVICES ====================

const LOCAL_SERVICES = [
    { id: 1, name: "Instagram Likes", category: "Instagram", price: 150, status: "active" },
    { id: 2, name: "Instagram Followers", category: "Instagram", price: 250, status: "active" },
    { id: 3, name: "TikTok Likes", category: "TikTok", price: 130, status: "active" },
    { id: 4, name: "TikTok Followers", category: "TikTok", price: 300, status: "active" },
    { id: 5, name: "YouTube Views", category: "YouTube", price: 280, status: "active" },
    { id: 6, name: "YouTube Subscribers", category: "YouTube", price: 500, status: "active" },
    { id: 9, name: "YouTube Likes", category: "YouTube", price: 200, status: "active" },
    { id: 10, name: "YouTube Watch Time", category: "YouTube", price: 450, status: "active" },
    { id: 7, name: "Facebook Likes", category: "Facebook", price: 180, status: "active" },
    { id: 8, name: "Facebook Followers", category: "Facebook", price: 300, status: "active" },
];

// ==================== SERVICES ====================

app.get("/api/services", (req, res) => {
    res.json(
        LOCAL_SERVICES.map((service) => {
            const mapping = db.prepare(`
                SELECT providerServiceId, providerName, providerMin, providerMax,
                       providerRate, providerRefill, providerCancel
                FROM provider_service_map
                WHERE localServiceId = ?
            `).get(service.id);

            return {
                ...service,
                providerConfigured: Boolean(mapping),
                providerServiceId: mapping?.providerServiceId || null,
                providerName: mapping?.providerName || null,
                min: mapping?.providerMin || null,
                max: mapping?.providerMax || null,
                refill: Boolean(mapping?.providerRefill),
                cancel: Boolean(mapping?.providerCancel),
            };
        })
    );
});

/* Legacy route body replaced below. */
/*
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
'    ]);
});
*/

// ==================== BALANCE ====================
// Customer must be logged in.

app.get(
    "/api/balance",
    requireAuth,
    (req, res) => {
        const account = db
            .prepare(
                "SELECT balance FROM account WHERE id = 1"
            )
            .get();

        res.json({
            balance: account.balance
        });
    }
);

// ==================== CUSTOMER ORDERS ====================
// Customer must be logged in.

app.get(
    "/api/orders",
    requireAuth,
    (req, res) => {
        const orders = db
            .prepare(
                "SELECT * FROM orders ORDER BY id ASC"
            )
            .all();

        res.json(orders);
    }
);

// ==================== ADMIN ORDERS ====================

app.get(
    "/api/admin/orders",
    requireAdmin,
    (req, res) => {
        const orders = db
            .prepare(
                "SELECT * FROM orders ORDER BY id DESC"
            )
            .all();

        res.json(orders);
    }
);

// ==================== ADMIN ORDER STATUS ====================

app.patch(
    "/api/admin/orders/:id/status",
    requireAdmin,
    (req, res) => {
        const {
            status
        } = req.body;

        const allowedStatuses = [
            "Pending",
            "Processing",
            "Completed",
            "Cancelled"
        ];

        if (
            !allowedStatuses.includes(status)
        ) {
            return res.status(400).json({
                error: "Invalid status",
                allowedStatuses
            });
        }

        const orderId =
            Number(req.params.id);

        if (
            !Number.isInteger(orderId) ||
            orderId <= 0
        ) {
            return res.status(400).json({
                error:
                    "Invalid order ID"
            });
        }

        const order = db
            .prepare(
                "SELECT * FROM orders WHERE id = ?"
            )
            .get(orderId);

        if (!order) {
            return res.status(404).json({
                error:
                    "Order not found"
            });
        }

        db.prepare(`
            UPDATE orders
            SET status = ?
            WHERE id = ?
        `).run(
            status,
            orderId
        );

        const updatedOrder = db
            .prepare(
                "SELECT * FROM orders WHERE id = ?"
            )
            .get(orderId);

        res.json({
            success: true,
            message:
                "Order status updated successfully",
            order: updatedOrder
        });
    }
);

// ==================== CUSTOMER DEPOSIT ====================
// Customer must be logged in.

app.post(
    "/api/deposits",
    requireAuth,
    (req, res) => {
        const {
            method,
            amount,
            transactionId
        } = req.body;

        if (
            ![
                "Easypaisa",
                "JazzCash",
                "Bank Account"
            ].includes(method)
        ) {
            return res.status(400).json({
                error:
                    "Invalid payment method"
            });
        }

        const depositAmount =
            Number(amount);

        const reference =
            String(
                transactionId || ""
            ).trim();

        if (
            !Number.isFinite(
                depositAmount
            ) ||
            depositAmount <= 0
        ) {
            return res.status(400).json({
                error:
                    "Invalid deposit amount"
            });
        }

        if (!reference) {
            return res.status(400).json({
                error:
                    "Transaction ID / Reference Number is required"
            });
        }

        const createdAt =
            new Date().toISOString();

        const result = db.prepare(`
            INSERT INTO deposits
            (method, amount, transactionId, status, createdAt)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            method,
            depositAmount,
            reference,
            "Pending",
            createdAt
        );

        res.json({
            success: true,
            message:
                "Deposit request submitted",
            depositId:
                Number(result.lastInsertRowid),
            method,
            amount: depositAmount,
            status: "Pending"
        });
    }
);

// ==================== ADMIN DEPOSITS ====================

app.get(
    "/api/admin/deposits",
    requireAdmin,
    (req, res) => {
        const deposits = db
            .prepare(
                "SELECT * FROM deposits ORDER BY id DESC"
            )
            .all();

        res.json(deposits);
    }
);

// ==================== ADMIN DEPOSIT STATUS ====================

app.patch(
    "/api/admin/deposits/:id/status",
    requireAdmin,
    (req, res) => {
        const depositId =
            Number(req.params.id);

        const {
            status
        } = req.body;

        if (
            !Number.isInteger(
                depositId
            ) ||
            ![
                "Approved",
                "Rejected"
            ].includes(status)
        ) {
            return res.status(400).json({
                error:
                    "Invalid deposit or status"
            });
        }

        const deposit = db
            .prepare(
                "SELECT * FROM deposits WHERE id = ?"
            )
            .get(depositId);

        if (!deposit) {
            return res.status(404).json({
                error:
                    "Deposit not found"
            });
        }

        if (
            deposit.status !== "Pending"
        ) {
            return res.status(400).json({
                error:
                    "Deposit already processed"
            });
        }

        if (status === "Approved") {
            db.exec("BEGIN");

            try {
                db.prepare(`
                    UPDATE deposits
                    SET status = ?
                    WHERE id = ?
                `).run(
                    "Approved",
                    depositId
                );

                db.prepare(`
                    UPDATE account
                    SET balance = balance + ?
                    WHERE id = 1
                `).run(
                    deposit.amount
                );

                db.exec("COMMIT");
            } catch (error) {
                db.exec("ROLLBACK");
                throw error;
            }
        } else {
            db.prepare(`
                UPDATE deposits
                SET status = ?
                WHERE id = ?
            `).run(
                "Rejected",
                depositId
            );
        }

        const updatedDeposit =
            db.prepare(
                "SELECT * FROM deposits WHERE id = ?"
            ).get(depositId);

        const account =
            db.prepare(
                "SELECT balance FROM account WHERE id = 1"
            ).get();

        res.json({
            success: true,
            deposit:
                updatedDeposit,
            balance:
                account.balance
        });
    }
);

// ==================== CREATE ORDER ====================
// Customer must be logged in.

app.post(
    "/api/orders",
    requireAuth,
    async (req, res) => {
        const {
            serviceId,
            link,
            quantity,
        } = req.body;

        const localServiceId = Number(serviceId);
        const qty = Number(quantity);
        const cleanLink = String(link || "").trim();

        if (!Number.isInteger(localServiceId) || !cleanLink || !quantity) {
            return res.status(400).json({
                error: "serviceId, link and quantity are required",
            });
        }

        const service = LOCAL_SERVICES.find(
            (item) => item.id === localServiceId
        );

        if (!service) {
            return res.status(400).json({
                error: "Invalid service",
            });
        }

        if (!Number.isInteger(qty) || qty <= 0) {
            return res.status(400).json({
                error: "Quantity must be a positive whole number",
            });
        }

        const mapping = db.prepare(`
            SELECT *
            FROM provider_service_map
            WHERE localServiceId = ?
        `).get(localServiceId);

        if (!providerConfigured()) {
            return res.status(503).json({
                error: "SMM World API is not configured yet. Add SMM_WORLD_API_KEY in Railway Variables.",
            });
        }

        if (!mapping) {
            return res.status(503).json({
                error: `Service "${service.name}" is not connected to an SMM World service yet. Open Admin Panel → SMM World Setup and map it first.`,
            });
        }

        if (mapping.providerMin && qty < Number(mapping.providerMin)) {
            return res.status(400).json({
                error: `Minimum quantity for this provider service is ${mapping.providerMin}`,
            });
        }

        if (mapping.providerMax && qty > Number(mapping.providerMax)) {
            return res.status(400).json({
                error: `Maximum quantity for this provider service is ${mapping.providerMax}`,
            });
        }

        const cost = (qty / 1000) * Number(service.price);

        const account = db.prepare(
            "SELECT balance FROM account WHERE id = 1"
        ).get();

        if (!account || Number(account.balance) < cost) {
            return res.status(400).json({
                error: "Insufficient balance",
                balance: Number(account?.balance || 0),
                required: cost,
            });
        }

        const createdAt = new Date().toISOString();

        // Reserve customer funds before sending to the provider.
        // If the provider rejects the order, the reservation is returned.
        // The final profit is recalculated from the provider's actual charge
        // as soon as a status response includes charge + currency.
        const provisionalProfit = 0;

        db.exec("BEGIN");
        let localOrderId;
        try {
            const result = db.prepare(`
                INSERT INTO orders
                (
                    serviceId,
                    link,
                    quantity,
                    status,
                    createdAt,
                    cost,
                    profit,
                    providerServiceId,
                    submissionState
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                localServiceId,
                cleanLink,
                qty,
                "Pending",
                createdAt,
                cost,
                provisionalProfit,
                Number(mapping.providerServiceId),
                "submitting"
            );

            localOrderId = Number(result.lastInsertRowid);

            db.prepare(`
                UPDATE account
                SET balance = balance - ?
                WHERE id = 1
            `).run(cost);

            db.exec("COMMIT");
        } catch (error) {
            db.exec("ROLLBACK");
            console.error("Local order reservation error:", error);
            return res.status(500).json({
                error: "Could not create order reservation",
            });
        }

        let providerResponse;
        try {
            providerResponse = await addProviderOrder({
                serviceId: mapping.providerServiceId,
                link: cleanLink,
                quantity: qty,
            });
        } catch (error) {
            db.exec("BEGIN");
            try {
                db.prepare(`
                    UPDATE account
                    SET balance = balance + ?
                    WHERE id = 1
                `).run(cost);

                db.prepare(`
                    UPDATE orders
                    SET status = 'Cancelled',
                        submissionState = 'failed',
                        providerError = ?,
                        profit = 0
                    WHERE id = ?
                `).run(
                    String(error.message || "Provider rejected order").slice(0, 500),
                    localOrderId
                );

                db.exec("COMMIT");
            } catch (rollbackError) {
                db.exec("ROLLBACK");
                console.error("Order refund error:", rollbackError);
            }

            return res.status(502).json({
                error: `SMM World order failed: ${String(error.message || "Unknown provider error")}`,
                refunded: true,
            });
        }

        const providerOrderId = providerResponse?.order;

        if (!providerOrderId) {
            // The provider answered but did not return a usable order ID.
            // Do NOT blindly submit again: that could create a duplicate order.
            db.prepare(`
                UPDATE orders
                SET status = 'Pending',
                    submissionState = 'unknown',
                    providerError = ?
                WHERE id = ?
            `).run(
                "Provider response did not include an order ID. Manual reconciliation required.",
                localOrderId
            );

            const order = db.prepare(
                "SELECT * FROM orders WHERE id = ?"
            ).get(localOrderId);

            const newBalance = db.prepare(
                "SELECT balance FROM account WHERE id = 1"
            ).get();

            return res.status(202).json({
                success: false,
                message: "Provider response needs reconciliation; the order was not resubmitted automatically.",
                balance: Number(newBalance.balance),
                order,
            });
        }

        db.prepare(`
            UPDATE orders
            SET providerOrderId = ?,
                providerStatus = 'Pending',
                submissionState = 'submitted',
                providerError = NULL
            WHERE id = ?
        `).run(
            String(providerOrderId),
            localOrderId
        );

        const order = db.prepare(
            "SELECT * FROM orders WHERE id = ?"
        ).get(localOrderId);

        const newBalance = db.prepare(
            "SELECT balance FROM account WHERE id = 1"
        ).get();

        res.json({
            success: true,
            message: "Order submitted to SMM World successfully",
            cost,
            balance: Number(newBalance.balance),
            order,
        });
    }
);

// ==================== PROFIT SUMMARY ====================

app.get(
    "/api/admin/profit",
    requireAdmin,
    (req, res) => {
        const result =
            db.prepare(`
                SELECT
                    COALESCE(
                        SUM(profit),
                        0
                    ) AS totalProfit
                FROM orders
            `).get();

        const withdrawn =
            db.prepare(`
                SELECT
                    COALESCE(
                        SUM(amount),
                        0
                    ) AS withdrawnProfit
                FROM withdrawals
                WHERE status = 'Approved'
            `).get();

        const totalProfit =
            Number(
                result.totalProfit || 0
            );

        const withdrawnProfit =
            Number(
                withdrawn.withdrawnProfit || 0
            );

        const availableProfit =
            Math.max(
                0,
                totalProfit -
                withdrawnProfit
            );

        res.json({
            totalProfit,
            withdrawnProfit,
            availableProfit
        });
    }
);

// ==================== CREATE WITHDRAWAL ====================

app.post(
    "/api/admin/withdrawals",
    requireAdmin,
    (req, res) => {
        const {
            amount,
            method,
            account
        } = req.body;

        const withdrawalAmount =
            Number(amount);

        if (
            !withdrawalAmount ||
            withdrawalAmount <= 0
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Invalid withdrawal amount"
            });
        }

        if (
            !method ||
            !account
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Withdrawal method and account are required"
            });
        }

        const profitData =
            db.prepare(`
                SELECT
                    COALESCE(
                        SUM(profit),
                        0
                    ) AS totalProfit
                FROM orders
            `).get();

        const withdrawnData =
            db.prepare(`
                SELECT
                    COALESCE(
                        SUM(amount),
                        0
                    ) AS withdrawnProfit
                FROM withdrawals
                WHERE status = 'Approved'
            `).get();

        const availableProfit =
            Number(
                profitData.totalProfit || 0
            ) -
            Number(
                withdrawnData.withdrawnProfit || 0
            );

        if (
            withdrawalAmount >
            availableProfit
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Insufficient available profit",
                availableProfit
            });
        }

        const createdAt =
            new Date().toISOString();

        const result = db.prepare(`
            INSERT INTO withdrawals
            (
                amount,
                method,
                account,
                status,
                createdAt
            )
            VALUES (?, ?, ?, 'Pending', ?)
        `).run(
            withdrawalAmount,
            method,
            account,
            createdAt
        );

        res.json({
            success: true,
            message:
                "Withdrawal request created",
            withdrawalId:
                Number(result.lastInsertRowid),
            amount:
                withdrawalAmount,
            status:
                "Pending"
        });
    }
);

// ==================== WITHDRAWAL HISTORY ====================

app.get(
    "/api/admin/withdrawals",
    requireAdmin,
    (req, res) => {
        const withdrawals =
            db.prepare(`
                SELECT *
                FROM withdrawals
                ORDER BY id DESC
            `).all();

        res.json(withdrawals);
    }
);

// ==================== WITHDRAWAL STATUS ====================

app.patch(
    "/api/admin/withdrawals/:id/status",
    requireAdmin,
    (req, res) => {
        const id =
            Number(req.params.id);

        const {
            status
        } = req.body;

        if (
            ![
                "Approved",
                "Rejected",
                "Pending"
            ].includes(status)
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Invalid status"
            });
        }

        const withdrawal =
            db.prepare(`
                SELECT *
                FROM withdrawals
                WHERE id = ?
            `).get(id);

        if (!withdrawal) {
            return res.status(404).json({
                success: false,
                message:
                    "Withdrawal not found"
            });
        }

        if (
            withdrawal.status ===
                "Approved" &&
            status !== "Approved"
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Approved withdrawal cannot be changed"
            });
        }

        if (
            status === "Approved" &&
            withdrawal.status !== "Approved"
        ) {
            const profitData =
                db.prepare(`
                    SELECT
                        COALESCE(
                            SUM(profit),
                            0
                        ) AS totalProfit
                    FROM orders
                `).get();

            const withdrawnData =
                db.prepare(`
                    SELECT
                        COALESCE(
                            SUM(amount),
                            0
                        ) AS withdrawnProfit
                    FROM withdrawals
                    WHERE status = 'Approved'
                `).get();

            const availableProfit =
                Number(
                    profitData.totalProfit || 0
                ) -
                Number(
                    withdrawnData.withdrawnProfit || 0
                );

            if (
                Number(withdrawal.amount) >
                availableProfit
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Insufficient available profit",
                    availableProfit
                });
            }
        }

        db.prepare(`
            UPDATE withdrawals
            SET status = ?
            WHERE id = ?
        `).run(
            status,
            id
        );

        res.json({
            success: true,
            message:
                `Withdrawal ${status.toLowerCase()}`
        });
    }
);

// ==================== SMM WORLD ADMIN SETUP ====================

app.get(
    "/api/admin/provider/status",
    requireAdmin,
    async (req, res) => {
        if (!providerConfigured()) {
            return res.json({
                configured: false,
                apiUrl: SMM_WORLD_API_URL,
                message: "SMM_WORLD_API_KEY is missing",
            });
        }

        try {
            const balance = await getProviderBalance();
            const mappings = db.prepare(`
                SELECT localServiceId, providerServiceId, providerName,
                       providerRate, providerMin, providerMax,
                       providerRefill, providerCancel, updatedAt
                FROM provider_service_map
                ORDER BY localServiceId ASC
            `).all();

            res.json({
                configured: true,
                apiUrl: SMM_WORLD_API_URL,
                balance: Number(balance.balance || 0),
                currency: balance.currency || null,
                mappings,
            });
        } catch (error) {
            res.status(502).json({
                configured: true,
                apiUrl: SMM_WORLD_API_URL,
                error: String(error.message || "SMM World connection failed"),
            });
        }
    }
);

app.get(
    "/api/admin/provider/services",
    requireAdmin,
    async (req, res) => {
        try {
            const services = await getProviderServices();
            res.json({ services });
        } catch (error) {
            res.status(502).json({
                error: String(error.message || "Could not load SMM World services"),
            });
        }
    }
);

app.get(
    "/api/admin/provider/mappings",
    requireAdmin,
    (req, res) => {
        const mappings = LOCAL_SERVICES.map((local) => {
            const mapping = db.prepare(`
                SELECT *
                FROM provider_service_map
                WHERE localServiceId = ?
            `).get(local.id);

            return {
                localService: local,
                mapping: mapping || null,
            };
        });

        res.json({ mappings });
    }
);

app.put(
    "/api/admin/provider/mappings/:localServiceId",
    requireAdmin,
    async (req, res) => {
        const localServiceId = Number(req.params.localServiceId);
        const providerServiceId = Number(req.body.providerServiceId);

        if (!Number.isInteger(localServiceId) || !Number.isInteger(providerServiceId)) {
            return res.status(400).json({
                error: "Valid local service ID and provider service ID are required",
            });
        }

        const localService = LOCAL_SERVICES.find(
            (item) => item.id === localServiceId
        );

        if (!localService) {
            return res.status(404).json({ error: "Local service not found" });
        }

        let providerService;
        try {
            const services = await getProviderServices();
            providerService = services.find(
                (item) => Number(item.service) === providerServiceId
            );
        } catch (error) {
            return res.status(502).json({
                error: String(error.message || "Could not verify provider service"),
            });
        }

        if (!providerService) {
            return res.status(400).json({
                error: "That SMM World service ID was not found in the current catalog",
            });
        }

        const updatedAt = new Date().toISOString();

        db.prepare(`
            INSERT INTO provider_service_map
            (
                localServiceId,
                providerServiceId,
                providerName,
                providerType,
                providerRate,
                providerMin,
                providerMax,
                providerRefill,
                providerCancel,
                updatedAt
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(localServiceId) DO UPDATE SET
                providerServiceId = excluded.providerServiceId,
                providerName = excluded.providerName,
                providerType = excluded.providerType,
                providerRate = excluded.providerRate,
                providerMin = excluded.providerMin,
                providerMax = excluded.providerMax,
                providerRefill = excluded.providerRefill,
                providerCancel = excluded.providerCancel,
                updatedAt = excluded.updatedAt
        `).run(
            localServiceId,
            providerServiceId,
            String(providerService.name || ""),
            String(providerService.type || ""),
            Number(providerService.rate || 0),
            Number(providerService.min || 0),
            Number(providerService.max || 0),
            providerService.refill ? 1 : 0,
            providerService.cancel ? 1 : 0,
            updatedAt
        );

        const savedMapping = db.prepare(`
            SELECT *
            FROM provider_service_map
            WHERE localServiceId = ?
        `).get(localServiceId);

        res.json({
            success: true,
            localService,
            providerService,
            mapping: savedMapping,
        });
    }
);

app.post(
    "/api/admin/provider/refresh-active-orders",
    requireAdmin,
    async (req, res) => {
        await syncActiveProviderOrders();
        res.json({ success: true });
    }
);

// ==================== START SERVER ====================

app.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            "SMM PANEL BACKEND STARTED"
        );

        console.log(
            `PORT: ${PORT}`
        );

        console.log(
            `SMM World API: ${SMM_WORLD_API_URL}`
        );

        console.log(
            `SMM World key configured: ${providerConfigured() ? "YES" : "NO"}`
        );

        if (providerConfigured()) {
            setTimeout(() => {
                syncActiveProviderOrders().catch((error) =>
                    console.error("Initial provider sync error:", error.message)
                );
            }, 5000);

            setInterval(() => {
                syncActiveProviderOrders().catch((error) =>
                    console.error("Provider sync error:", error.message)
                );
            }, PROVIDER_STATUS_INTERVAL_MS);
        }
    }
);
