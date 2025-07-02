// firebase.js
const admin = require('firebase-admin');

let db;
if (admin.apps.length) {
  db = admin.firestore();
} else {
  throw new Error("Firebase app not initialized. Make sure to initialize it in index.js before importing this.");
}

module.exports = { admin, db };
