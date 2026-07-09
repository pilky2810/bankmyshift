require("dotenv").config();
const app = require("./app");
const { startReminderJob } = require("./jobs/reminders");

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Bank My Shift API listening on port ${PORT} (${process.env.NODE_ENV || "development"})`);
  startReminderJob();
});
