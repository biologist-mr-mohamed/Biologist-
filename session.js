/**
 * 🔐 js/core/session.js - نظام إدارة الجلسة الآمن (الإصدار 5.0.0)
 * ============================================================================
 * 📝 المسؤولية: إدارة جلسة المستخدم بشكل آمن باستخدام AES‑GCM (Web Crypto API)
 * 🧠 الهندسة:
 *   - مصدر وحيد للحقيقة لحالة المستخدم الحالية (`window.$currentUser`).
 *   - تشفير بيانات الجلسة في `localStorage` باستخدام مفتاح مؤقت يُخزَّن في `sessionStorage`.
 *   - دعم وضع "تذكرني" عبر تخزين المفتاح المشفَّر في `localStorage` بمفتاح رئيسي ثابت.
 *   - جاهز للتكامل مع `api.js` و `router.js` و `main.js`.
 *   - دعم RTL كامل في التعليقات والرسائل.
 * ============================================================================
 */

// 🔗 استيراد ثابت (وليس ديناميكي) — event-bus.js لا يستورد session.js إطلاقاً
// لذا لا يوجد أي خطر Circular Import هنا (بعكس حالة api.js أدناه)
import { EventBus } from './event-bus.js';

// ====== 1. الثوابت والتكوين ======
const SESSION_CONFIG = {
  STORAGE_KEY: 'biologist_session',           // مفتاح تخزين بيانات الجلسة المشفَّرة
  KEY_STORAGE_KEY: 'biologist_key',           // مفتاح تخزين مفتاح التشفير المؤقت (sessionStorage)
  REMEMBER_KEY_STORAGE: 'biologist_remember_key', // مفتاح تخزين المفتاح المشفَّر للتذكر
  MASTER_KEY_SALT: 'biologist_master_salt_v5',    // ملح لاشتقاق المفتاح الرئيسي
  ALGORITHM: 'AES-GCM',
  KEY_LENGTH: 256,
  IV_LENGTH: 12, // 96 بت لـ GCM
  REMEMBER_PHONE_KEY: 'biologist_remember_phone', // لتخزين رقم الهاتف للتذكر
  SESSION_EXPIRY_DAYS: 7,                     // مدة صلاحية الجلسة بالأيام (للوضع "تذكرني")
  MAX_IDLE_TIME: 30 * 60 * 1000               // 30 دقيقة كحد أقصى للخمول (يمكن استخدامها لاحقاً)
};

// ====== 2. الحالة الداخلية ======
let $sessionState = {
  currentUser: null,            // كائن المستخدم الحالي (بدون كلمة مرور)
  refreshTokenCallback: null,   // دالة لإنعاش الجلسة من الخادم
  isInitialized: false,
  lastActivity: Date.now()
};

// ====== 3. دوال التشفير باستخدام Web Crypto API ======

/**
 * التحقق من توفر Web Crypto API
 * @returns {boolean}
 */
function isCryptoAvailable() {
  return !!(window.crypto && window.crypto.subtle);
}

/**
 * اشتقاق مفتاح رئيسي ثابت من عبارة مرور افتراضية (تُستخدم فقط لحماية مفتاح "تذكرني")
 * @returns {Promise<CryptoKey>} مفتاح CryptoKey
 */
async function deriveMasterKey() {
  if (!isCryptoAvailable()) {
    throw new Error('Web Crypto API غير متوفر');
  }
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode('biologist_master_secret_' + SESSION_CONFIG.MASTER_KEY_SALT),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(SESSION_CONFIG.MASTER_KEY_SALT),
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: SESSION_CONFIG.ALGORITHM, length: SESSION_CONFIG.KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * توليد مفتاح عشوائي جديد لـ AES‑GCM
 * @returns {Promise<CryptoKey>}
 */
async function generateAESKey() {
  if (!isCryptoAvailable()) {
    throw new Error('Web Crypto API غير متوفر');
  }
  return crypto.subtle.generateKey(
    { name: SESSION_CONFIG.ALGORITHM, length: SESSION_CONFIG.KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * تشفير نص باستخدام مفتاح معين
 * @param {string} plaintext - النص المطلوب تشفيره
 * @param {CryptoKey} key - مفتاح التشفير
 * @returns {Promise<{ ciphertext: ArrayBuffer, iv: Uint8Array }>}
 */
async function encryptWithKey(plaintext, key) {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(SESSION_CONFIG.IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt(
    { name: SESSION_CONFIG.ALGORITHM, iv },
    key,
    enc.encode(plaintext)
  );
  return { ciphertext, iv };
}

/**
 * فك تشفير نص باستخدام مفتاح معين
 * @param {{ ciphertext: ArrayBuffer, iv: Uint8Array }} encryptedData
 * @param {CryptoKey} key
 * @returns {Promise<string>}
 */
async function decryptWithKey(encryptedData, key) {
  const decrypted = await crypto.subtle.decrypt(
    { name: SESSION_CONFIG.ALGORITHM, iv: encryptedData.iv },
    key,
    encryptedData.ciphertext
  );
  return new TextDecoder().decode(decrypted);
}

/**
 * تحويل ArrayBuffer إلى سلسلة Base64 (للتخزين)
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * تحويل سلسلة Base64 إلى ArrayBuffer
 */
function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * تخزين المفتاح في sessionStorage (غير مشفر)
 */
async function storeSessionKey(key) {
  const exportedKey = await crypto.subtle.exportKey('raw', key);
  sessionStorage.setItem(SESSION_CONFIG.KEY_STORAGE_KEY, arrayBufferToBase64(exportedKey));
}

/**
 * استرداد المفتاح من sessionStorage
 */
async function loadSessionKey() {
  const keyBase64 = sessionStorage.getItem(SESSION_CONFIG.KEY_STORAGE_KEY);
  if (!keyBase64) return null;
  try {
    const keyBuffer = base64ToArrayBuffer(keyBase64);
    return crypto.subtle.importKey('raw', keyBuffer, SESSION_CONFIG.ALGORITHM, true, ['encrypt', 'decrypt']);
  } catch {
    return null;
  }
}

/**
 * تخزين المفتاح بشكل دائم (مع تشفيره بالمفتاح الرئيسي) في localStorage (لحالة "تذكرني")
 */
async function storeRememberedKey(aesKey) {
  const masterKey = await deriveMasterKey();
  const exportedKey = await crypto.subtle.exportKey('raw', aesKey);
  const keyString = arrayBufferToBase64(exportedKey);
  const { ciphertext, iv } = await encryptWithKey(keyString, masterKey);
  const encryptedKey = {
    ciphertext: arrayBufferToBase64(ciphertext),
    iv: arrayBufferToBase64(iv)
  };
  localStorage.setItem(SESSION_CONFIG.REMEMBER_KEY_STORAGE, JSON.stringify(encryptedKey));
}

/**
 * استرداد المفتاح الدائم من localStorage وفك تشفيره
 */
async function loadRememberedKey() {
  const stored = localStorage.getItem(SESSION_CONFIG.REMEMBER_KEY_STORAGE);
  if (!stored) return null;
  try {
    const encryptedKey = JSON.parse(stored);
    const encryptedData = {
      ciphertext: base64ToArrayBuffer(encryptedKey.ciphertext),
      iv: base64ToArrayBuffer(encryptedKey.iv)
    };
    const masterKey = await deriveMasterKey();
    const keyString = await decryptWithKey(encryptedData, masterKey);
    const keyBuffer = base64ToArrayBuffer(keyString);
    return crypto.subtle.importKey('raw', keyBuffer, SESSION_CONFIG.ALGORITHM, true, ['encrypt', 'decrypt']);
  } catch {
    return null;
  }
}

/**
 * 🔴 إصلاح حرج (1.1) — النسخة النهائية: توحيد كامل على EventBus.
 * كان هذا الملف يُصدر الحدث عبر document.dispatchEvent فقط، بينما dashboard.js
 * وhome.js يستمعان عبر EventBus.on — فلا يصلهما الحدث أبداً. بعد تحديث main.js
 * وrouter.js وprofile.js (المستمعين الوحيدين المتبقيين عبر document.addEventListener)
 * ليستمعوا عبر EventBus.on أيضاً، أصبح بإمكان هذا الملف الاعتماد على EventBus
 * حصرياً كما يفرض README — مصدر وحيد للحقيقة لحدث تغيّر حالة المستخدم.
 * @param {{action: 'login'|'logout', user?: Object}} detail
 */
function emitUserStateChanged(detail) {
  EventBus.emit('userStateChanged', detail);
}

// ====== 4. دوال الجلسة الأساسية ======

/**
 * تهيئة الجلسة – استعادة المستخدم من localStorage إن وجدت جلسة صالحة
 * (تُستدعى من main.js)
 */
export async function initializeSession() {
  if ($sessionState.isInitialized) return;

  console.log('🔐 تهيئة نظام الجلسة (v5.0.0)...');
  try {
    // التحقق من توفر التشفير
    if (!isCryptoAvailable()) {
      console.warn('⚠️ Web Crypto API غير متوفر، سيتم استخدام وضع التوافق (غير آمن للإنتاج)');
      // وضع Fallback: تخزين غير مشفر (يُستخدم فقط للتطوير)
      initializeFallbackSession();
      return;
    }

    // محاولة تحميل المفتاح (الأولوية للجلسة المؤقتة ثم الدائمة)
    let cryptoKey = await loadSessionKey();
    let usedPersistent = false;
    if (!cryptoKey) {
      cryptoKey = await loadRememberedKey();
      usedPersistent = true;
    }
    if (!cryptoKey) {
      // لا توجد جلسة
      $sessionState.currentUser = null;
      window.$currentUser = null;
      $sessionState.isInitialized = true;
      console.log('🔓 لا توجد جلسة نشطة');
      return;
    }

    const encryptedSession = localStorage.getItem(SESSION_CONFIG.STORAGE_KEY);
    if (!encryptedSession) {
      // تنظيف المفاتيح التالفة
      clearSession();
      // 🛠️ إصلاح: كانت الدالة ترجع هنا دون تعليم isInitialized،
      // فيعيد أي استدعاء لاحق لـ initializeSession() تنفيذ التهيئة كاملة من الصفر
      $sessionState.isInitialized = true;
      return;
    }

    const sessionData = JSON.parse(encryptedSession);
    const encrypted = {
      ciphertext: base64ToArrayBuffer(sessionData.ciphertext),
      iv: base64ToArrayBuffer(sessionData.iv)
    };
    const decrypted = await decryptWithKey(encrypted, cryptoKey);
    const user = JSON.parse(decrypted);

    // التحقق من صلاحية الجلسة (يمكن إضافة فحص تاريخ انتهاء)
    if (user.expiresAt && Date.now() > user.expiresAt) {
      console.log('⏰ انتهت صلاحية الجلسة');
      clearSession();
      // 🛠️ إصلاح: كان هذا المسار يرجع دون تعليم isInitialized (خلافاً لمسار
      // "لا يوجد Session بيانات مخزّنة" الذي أُصلح أعلاه لنفس السبب بالضبط) —
      // فيعيد أي استدعاء لاحق لـ initializeSession() تنفيذ التهيئة كاملة من الصفر.
      $sessionState.isInitialized = true;
      return;
    }

    // تأكد من عدم وجود كلمة مرور
    delete user.password;

   // مزامنة المفضلة من الخادم عند استعادة الجلسة (لا تعيق تسجيل الدخول عند الفشل)
    if (user?.id) {
      try {
        const { getUserFavorites } = await import('./api.js');
        user.favorites = await getUserFavorites(user.id);
      } catch (e) {
        console.warn('⚠️ تعذر جلب المفضلة من الخادم، سيتم استخدام النسخة المحلية إن وجدت', e);
        user.favorites = Array.isArray(user.favorites) ? user.favorites : [];
      }
    } else {
      user.favorites = Array.isArray(user.favorites) ? user.favorites : [];
    }

    $sessionState.currentUser = user;
    window.$currentUser = user;
    $sessionState.lastActivity = Date.now();

    // إذا تم استخدام المفتاح الدائم، نعيد تخزينه في sessionStorage لاستمرار الجلسة الحالية
    if (usedPersistent) {
      await storeSessionKey(cryptoKey);
    }

    $sessionState.isInitialized = true;
    console.log(`✅ تم استعادة الجلسة للمستخدم: ${user.full_name || user.username}`);

    // إطلاق حدث تغير حالة المستخدم
    emitUserStateChanged({ action: 'login', user: user });

    // تحديث آخر نشاط في الخلفية
    updateLastActivity();

  } catch (error) {
    console.error('❌ فشل تهيئة الجلسة:', error);
    clearSession(); // تنظيف البيانات التالفة
    $sessionState.isInitialized = true;
    window.$currentUser = null;
  }
}

/**
 * وضع Fallback للتطوير فقط (بدون تشفير)
 */
function initializeFallbackSession() {
  try {
    const stored = localStorage.getItem('biologist_session_fallback');
    if (stored) {
      const user = JSON.parse(stored);
      $sessionState.currentUser = user;
      window.$currentUser = user;
      console.warn('⚠️ استخدام جلسة غير مشفرة (وضع التطوير)');
      // 🛠️ إصلاح: كان هذا المسار (Web Crypto غير متاح) لا يُصدر 'userStateChanged' إطلاقاً
      // خلافاً لمسار الجلسة المشفرة في initializeSession، فتبقى الواجهة (navbar/drawer/notifications)
      // على حالتها الافتراضية رغم استعادة جلسة صالحة فعلياً.
      emitUserStateChanged({ action: 'login', user });
    }
    $sessionState.isInitialized = true;
  } catch (e) {
    console.error('فشل تهيئة وضع fallback', e);
  }
}

/**
 * تعيين جلسة جديدة (بعد تسجيل الدخول)
 * @param {Object} user - كائن المستخدم (يجب ألا يحتوي على كلمة المرور)
 * @param {boolean} rememberMe - هل يريد المستخدم البقاء متصلاً؟
 */
export async function setSession(user, rememberMe = false, favorites = null) {
  if (!user || !user.id) {
    throw new Error('بيانات المستخدم غير صالحة');
  }

  // إزالة أي حقول حساسة
  const cleanUser = { ...user };
  delete cleanUser.password;

  // تضمين المفضلة: نُفضّل القيمة الممرّرة صراحةً، وإلا نحتفظ بأي قيمة موجودة مسبقاً في user، وإلا مصفوفة فارغة
  cleanUser.favorites = Array.isArray(favorites)
    ? favorites.map(String)
    : (Array.isArray(cleanUser.favorites) ? cleanUser.favorites.map(String) : []);
  // إضافة تاريخ انتهاء الجلسة إذا كان "تذكرني" مفعلاً
  if (rememberMe) {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + SESSION_CONFIG.SESSION_EXPIRY_DAYS);
    cleanUser.expiresAt = expiry.getTime();
  } else {
    delete cleanUser.expiresAt;
  }

  try {
    if (!isCryptoAvailable()) {
      // وضع Fallback
      localStorage.setItem('biologist_session_fallback', JSON.stringify(cleanUser));
      $sessionState.currentUser = cleanUser;
      window.$currentUser = cleanUser;
      console.warn('⚠️ تم حفظ الجلسة بدون تشفير (وضع التطوير)');
      emitUserStateChanged({ action: 'login', user: cleanUser });
      return;
    }

    // توليد مفتاح تشفير جديد للجلسة
    const aesKey = await generateAESKey();
    
    // تشفير بيانات المستخدم
    const jsonUser = JSON.stringify(cleanUser);
    const { ciphertext, iv } = await encryptWithKey(jsonUser, aesKey);
    
    const sessionData = {
      ciphertext: arrayBufferToBase64(ciphertext),
      iv: arrayBufferToBase64(iv)
    };
    localStorage.setItem(SESSION_CONFIG.STORAGE_KEY, JSON.stringify(sessionData));

    // تخزين المفتاح في sessionStorage (جلسة مؤقتة)
    await storeSessionKey(aesKey);

    // إذا كان "تذكرني" مفعّلاً، نخزن المفتاح مشفرًا في localStorage
    if (rememberMe) {
      await storeRememberedKey(aesKey);
    } else {
      // نضمن إزالة أي مفتاح دائم سابق
      localStorage.removeItem(SESSION_CONFIG.REMEMBER_KEY_STORAGE);
    }

    $sessionState.currentUser = cleanUser;
    window.$currentUser = cleanUser;
    $sessionState.lastActivity = Date.now();

    console.log(`🔒 تم إنشاء جلسة للمستخدم: ${cleanUser.full_name || cleanUser.username}`);

    // إطلاق حدث
    emitUserStateChanged({ action: 'login', user: cleanUser });

  } catch (error) {
    console.error('❌ فشل حفظ الجلسة:', error);
    throw error;
  }
}

/**
 * مسح الجلسة الحالية (تسجيل الخروج)
 */
export async function clearSession() {
  localStorage.removeItem(SESSION_CONFIG.STORAGE_KEY);
  localStorage.removeItem(SESSION_CONFIG.REMEMBER_KEY_STORAGE);
  sessionStorage.removeItem(SESSION_CONFIG.KEY_STORAGE_KEY);
  localStorage.removeItem('biologist_session_fallback'); // تنظيف fallback

  const previousUser = $sessionState.currentUser;
  $sessionState.currentUser = null;
  window.$currentUser = null;

  if (previousUser) {
    emitUserStateChanged({ action: 'logout' });
  }

  console.log('🚪 تم مسح الجلسة');
}

/**
 * الحصول على كائن المستخدم الحالي (من الذاكرة)
 * @returns {Object|null}
 */
export function getCurrentUser() {
  if (!$sessionState.currentUser) return null;
  // نضمن وجود favorites كمصفوفة دائماً، حتى للجلسات القديمة التي أُنشئت قبل هذا التعديل
  return { favorites: [], ...$sessionState.currentUser };
}

// للتوافق مع المكونات القديمة
export const getSession = getCurrentUser;

/**
 * التحقق من وجود مستخدم مسجل الدخول
 * @returns {boolean}
 */
export function isAuthenticated() {
  return !!$sessionState.currentUser;
}

/**
 * التحقق من أن المستخدم الحالي هو معلم
 */
export function isTeacher(user = $sessionState.currentUser) {
  return user && user.user_type === 'teacher';
}

/**
 * التحقق من أن المستخدم الحالي هو مشرف
 */
export function isModerator(user = $sessionState.currentUser) {
  return user && user.user_type === 'moderator';
}

/**
 * التحقق من أن المستخدم الحالي هو طالب
 */
export function isStudent(user = $sessionState.currentUser) {
  return user && user.user_type === 'student';
}


/**
 * تحديث آخر نشاط للمستخدم (تُستدعى بشكل دوري)
 * يمكن استدعاء API لتحديث `last_activity` في Firestore.
 */
export async function updateLastActivity() {
  if (!$sessionState.currentUser) return;
  
  $sessionState.lastActivity = Date.now();
  
  // تحديث في Firestore عبر api.js (اختياري، لتجنب الاعتماد الدائري)
  if (window.api && typeof window.api.updateUserActivity === 'function') {
    try {
      await window.api.updateUserActivity($sessionState.currentUser.id);
    } catch (e) {
      // تجاهل الخطأ
    }
  }
}

/**
 * تعيين دالة لإنعاش الجلسة (تُستخدم عندما تنتهي صلاحية الجلسة ويحتاج النظام لتجديدها)
 * @param {Function} callback - دالة تقوم بجلب بيانات المستخدم من الخادم
 */
export function setRefreshTokenCallback(callback) {
  if (typeof callback === 'function') {
    $sessionState.refreshTokenCallback = callback;
  }
}

/**
 * إنعاش الجلسة (يُستدعى عند اكتشاف انتهاء الصلاحية)
 */
export async function refreshSession() {
  if (!$sessionState.refreshTokenCallback) {
    throw new Error('لم يتم تعيين دالة إنعاش الجلسة');
  }
  const user = await $sessionState.refreshTokenCallback();
  if (user) {
    const rememberMe = localStorage.getItem(SESSION_CONFIG.REMEMBER_KEY_STORAGE) !== null;
    await setSession(user, rememberMe);
  }
  return user;
}

// ====== 5. دوال مساعدة خاصة بتذكر رقم الهاتف ======

/**
 * تخزين رقم الهاتف لتعبئته تلقائياً في شاشة تسجيل الدخول
 */
export function setRememberedPhone(phone) {
  if (phone) {
    localStorage.setItem(SESSION_CONFIG.REMEMBER_PHONE_KEY, phone);
  } else {
    localStorage.removeItem(SESSION_CONFIG.REMEMBER_PHONE_KEY);
  }
}

/**
 * استرداد رقم الهاتف المحفوظ
 */
export function getRememberedPhone() {
  return localStorage.getItem(SESSION_CONFIG.REMEMBER_PHONE_KEY) || '';
}

// ====== 6. تصدير إضافي للواجهة العامة ======
export default {
  initialize: initializeSession,
  setSession,
  clearSession,
  getCurrentUser,
  getSession,
  isAuthenticated,
  isTeacher,
  isModerator,
  isStudent,
  updateLastActivity,
  setRefreshTokenCallback,
  refreshSession,
  setRememberedPhone,
  getRememberedPhone
};

// تعريض بعض الدوال على window للتوافق مع الأنظمة القديمة
if (typeof window !== 'undefined') {
  window.$session = {
    getCurrentUser,
    isAuthenticated,
    clearSession,
    isTeacher,
    isModerator
  };
}

console.log('✅ [session.js] نظام إدارة الجلسة v5.0.0 جاهز');