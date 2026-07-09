// Push notifications via Firebase Cloud Messaging.
// Not required for launch — email + in-app notifications cover the MVP.
// To enable: add device tokens to a `push_tokens` table (user_id, token, platform),
// set FCM_SERVER_KEY in .env, and call sendPush() alongside sendNotification()
// in notificationService.js.

async function sendPush(deviceToken, { title, body }) {
  if (!process.env.FCM_SERVER_KEY) {
    console.warn(`[pushService] FCM_SERVER_KEY not set — would have pushed "${title}" to ${deviceToken}`);
    return;
  }
  // Example implementation once ready:
  // const response = await fetch("https://fcm.googleapis.com/fcm/send", {
  //   method: "POST",
  //   headers: {
  //     Authorization: `key=${process.env.FCM_SERVER_KEY}`,
  //     "Content-Type": "application/json",
  //   },
  //   body: JSON.stringify({ to: deviceToken, notification: { title, body } }),
  // });
  // return response.json();
}

module.exports = { sendPush };
