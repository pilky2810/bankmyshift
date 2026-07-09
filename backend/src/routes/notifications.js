const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// GET /notifications — the signed-in user's own notifications, newest first
router.get("/", async (req, res) => {
  const { rows } = await db.query(
    `SELECT * FROM notifications WHERE user_id = $1 ORDER BY sent_at DESC LIMIT 100`,
    [req.user.id]
  );
  res.json(rows);
});

// PATCH /notifications/:id/read
router.patch("/:id/read", async (req, res) => {
  const { rows } = await db.query(
    `UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 RETURNING *`,
    [req.params.id, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Notification not found." });
  res.json(rows[0]);
});

module.exports = router;
