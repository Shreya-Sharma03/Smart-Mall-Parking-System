require("dotenv").config();

const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");
const slotRoutes = require("./routes/slotRoutes");
const reservationRoutes = require("./routes/reservationRoutes");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/slots", slotRoutes);
app.use("/api/reservations", reservationRoutes);

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