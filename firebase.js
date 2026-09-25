// 🔥 firebase.js - تهيئة Firebase Firestore مع إدارة متزامنة محكمة
// الإصدار: 12.5.0 | متوافق مع SPA Architecture
// الوظيفة: تهيئة اتصال Firestore فقط بدون Auth مع ضمان التحميل المتزامن

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBUHB1n59dPMVmAs8fbj8S6IFnUoW7xTeg",
  authDomain: "biologist-ca11b.firebaseapp.com",
  projectId: "biologist-ca11b",
  storageBucket: "biologist-ca11b.appspot.com",
  messagingSenderId: "635324645033",
  appId: "1:635324645033:web:8ee0fffacfa0cb50d7b3b8"
};

let firebaseApp = null;
let firestoreDb = null;
let initializationPromise = null;

async function initializeFirebase() {
  if (firestoreDb) return firestoreDb;
  
  if (!initializationPromise) {
    initializationPromise = (async () => {
      try {
        firebaseApp = initializeApp(FIREBASE_CONFIG);
        firestoreDb = getFirestore(firebaseApp);
        
        // اختبار الاتصال البسيط
        const { collection, getDocs } = await import("https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js");
        try {
          await getDocs(collection(firestoreDb, 'connection_test'));
        } catch (e) {
          // نقبل خطأ الإذن في مرحلة التطوير
          if (e.code !== 'permission-denied') throw e;
        }
        
        console.log('✅ Firebase Firestore initialized successfully');
        return firestoreDb;
      } catch (error) {
        console.error('❌ Firebase initialization failed:', error);
        initializationPromise = null;
        throw error;
      }
    })();
  }
  
  return initializationPromise;
}

function getFirestoreInstance() {
  if (!firestoreDb) {
    throw new Error('Firestore not initialized. Call initializeFirebase() first.');
  }
  return firestoreDb;
}

export { initializeFirebase, getFirestoreInstance };