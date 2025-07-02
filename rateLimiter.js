// rateLimiter.js
const { admin, db } = require('./firebase'); // ✅ Import shared instance

const RATE_LIMIT = 5;
const TIME_WINDOW_HOURS = 1;

const rateLimiter = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized: No token provided." });
    }

    const firebaseUid = authHeader.split("Bearer ")[1];
    if (!firebaseUid) {
      return res.status(401).json({ error: "Unauthorized: Invalid token." });
    }

    const userRef = db.collection("rateLimits").doc(firebaseUid);
    const doc = await userRef.get();

    const now = admin.firestore.Timestamp.now();
    const windowStart = new admin.firestore.Timestamp(
      now.seconds - TIME_WINDOW_HOURS * 3600,
      now.nanoseconds
    );

    if (!doc.exists || doc.data().firstRequestTimestamp < windowStart) {
      await userRef.set({
        requestCount: 1,
        firstRequestTimestamp: now,
      });
      req.firebaseUid = firebaseUid;
      return next();
    } else {
      const data = doc.data();
      if (data.requestCount >= RATE_LIMIT) {
        return res.status(429).json({
          status: "rate_limited",
          error: "Too many requests. Please try again later.",
        });
      } else {
        await userRef.update({
          requestCount: admin.firestore.FieldValue.increment(1),
        });
        req.firebaseUid = firebaseUid;
        return next();
      }
    }
  } catch (error) {
    console.error("Error in rate limiter:", error);
    return res.status(500).json({ error: "Internal server error in rate limiter." });
  }
};

module.exports = rateLimiter;
