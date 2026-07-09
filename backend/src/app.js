const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const authRoutes = require("./routes/auth");
const shiftRoutes = require("./routes/shifts");
const staffRoutes = require("./routes/staff");
const notificationRoutes = require("./routes/notifications");

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ALLOWED_ORIGIN, credentials: true }));
app.use(express.json({ limit: "1mb" }));

// General rate limit across the whole API; auth routes have a stricter one on top.
app.use(rateLimit({
  windowMs: (Number(process.env.RATE_LIMIT_WINDOW_MIN) || 15) * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX) || 100,
  standardHeaders: true,
  legacyHeaders: false,
}));

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.use("/auth", authRoutes);
app.use("/shifts", shiftRoutes);
app.use("/staff", staffRoutes);
app.use("/notifications", notificationRoutes);

// Central error handler — keeps stack traces out of API responses.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

module.exports = app;
