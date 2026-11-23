
// Load the appropriate environment file
const path = require("path");
const dotenv = require("dotenv");

if (process.env.NODE_ENV === "test") {
    dotenv.config({ path: path.resolve(__dirname, ".env.test.local") });
} else {
    dotenv.config({ path: path.resolve(__dirname, ".env") });
}

const express = require("express");
const cors = require("cors");
const session = require("express-session");
const MongoStore = require("connect-mongo");

const connectDB = require("./config/db");
const slotRoutes = require("./routes/slotRoutes");
const reservationRoutes = require("./routes/reservationRoutes");
const adminAuthRouter = require("./routes/adminAuth");

const app = express();

// Parse JSON before routes
app.use(express.json());

// CORS configuration
const allowedOrigins = [
    process.env.VISITOR_ORIGIN,
    process.env.ADMIN_ORIGIN,
    "http://localhost:5174",
    "http://localhost:5173"
].filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error("Not allowed by CORS"));
    },
    credentials: true
}));

// Session configuration
if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET environment variable is not configured.");
}

const mongoUrl = process.env.NODE_ENV === "test"
    ? process.env.TEST_MONGO_URI
    : process.env.MONGO_URI;

if (!mongoUrl) {
    throw new Error("MongoDB connection URI is not configured for this environment.");
}
const sessionStore = MongoStore.create({
    mongoUrl,
    dbName: process.env.NODE_ENV === "test"
        ? "smart_mall_parking_test"
        : undefined,
    collectionName: "sessions"
});

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 30 * 60 * 1000
    },
    rolling: true
}));

// API routes
app.use("/api/admin", adminAuthRouter);
app.use("/api/slots", slotRoutes);
app.use("/api/reservations", reservationRoutes);

// Health routes
app.get("/", (req, res) => {
    res.send("Smart Mall Parking Backend is running!");
});

app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        message: "Backend is working"
    });
});

const PORT = process.env.PORT || 5000;

const startServer = async () => {
    await connectDB();

    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
};

if (require.main === module) {
    startServer();
}

module.exports = app;
module.exports.sessionStore = sessionStore;
