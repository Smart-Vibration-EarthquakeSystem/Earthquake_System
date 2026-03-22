import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyDy2zFwAIYCNKRyTHvrFhi1fNyhiVzNprM",
  authDomain: "earth-quake-vibration-detector.firebaseapp.com",
  databaseURL: "https://earth-quake-vibration-detector-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "earth-quake-vibration-detector",
  storageBucket: "earth-quake-vibration-detector.firebasestorage.app",
  messagingSenderId: "763150314839",
  appId: "1:763150314839:web:bef92290885192ec2c6212",
  measurementId: "G-MZXJSMGHVM",
};

try {
  const app = initializeApp(firebaseConfig);
  window.firebaseDB = getDatabase(app);
  window.dispatchEvent(new Event("firebase-ready"));
} catch (error) {
  console.error("Firebase initialization failed:", error);
  window.firebaseInitError = error;
  window.dispatchEvent(new Event("firebase-init-error"));
}
