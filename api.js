// 📡 api.js - طبقة API موحدة للتعامل مع Firestore
// الوظيفة: توفير واجهة آمنة ومتزامنة لعمليات CRUD مع إدارة حالات التهيئة
// متوافق تمامًا مع هيكل قاعدة البيانات الفعلي (تم فحصه بتاريخ 2026-02-13)
// 🛠️ تم تحديثه: 2026-02-13 - إصلاح total_score، تحويل الفلاتر، testimonial، إلخ.
// 🛠️ تم التعديل: إزالة دعم 'parent' و 'developer'، الاكتفاء بـ 'student', 'teacher', 'moderator' فقط.

import { initializeFirebase, getFirestoreInstance } from './firebase.js';
import { getCurrentUser, isAuthenticated, isTeacher, isModerator } from './session.js';
import { EventBus } from './event-bus.js';
import {
  collection, query, where, getDocs, getDoc, addDoc,
  updateDoc, deleteDoc, doc, setDoc, orderBy, limit as firestoreLimit,
  serverTimestamp, increment, Timestamp, writeBatch, arrayUnion, arrayRemove,
  runTransaction, startAfter
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

// ===== 2. الثوابت وأسماء المجموعات =====
const COLLECTIONS = {
  LESSONS: 'Biologist_Lessons',
  QUIZZES: 'Biologist_Quizzes',
  USERS: 'Users',
  EXAM_RESULTS: 'Exam_Results',
  USER_PROGRESS: 'User_Progress',
  COMMENTS: 'biologist_comments',
  NOTIFICATIONS: 'Notifications',
  GROUPS: 'Groups',
  GROUP_MESSAGES: 'Group_Messages',
  UNITS: 'Biologist_Units',           //مجموعة الوحدات والأبواب
  SEMESTER_SETTINGS:'Semester_Settings',       //الفصل الدراسي الظاهر للطلاب (لكل مرحلة×صف)
  //  إكمال 1.2: مجموعة مخصصة للشكاوى بدل فلترة التعليقات بحقل is_complaint غير موثّق
  COMPLAINTS: 'Complaints'
};

// أسماء أيام الأسبوع بالعربي — Date.getDay(): 0=الأحد ... 6=السبت (تُستخدم في 1.4)
const WEEKDAY_LABELS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

const CACHE_TTL = {
  LONG: 10 * 60 * 1000, // 10 دقائق
  MEDIUM: 2 * 60 * 1000, // دقيقتان
  SHORT: 30 * 1000 // 30 ثانية
};

// === توليد معرف فريد (رقمي) ===
const generateUniqueId = () => {
  return Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 10000);
};

// === حالة تهيئة API ===
let apiInitialized = false;

// ===== دوال التهيئة والمساعدة =====
async function initializeApi() {
  try {
    await ensureApiInitialized();
    console.log('✅ API layer initialized successfully');
    
    // 🟡 تشغيل تحديث المستخدمين القدامى مرة واحدة بعد 3 ثوانٍ
    setTimeout(() => {
      updateLegacyUsers().catch(err => console.warn('⚠️ Legacy update skipped:', err));
    }, 3000);
    
    return true;
  } catch (error) {
    console.error('❌ API initialization failed:', error);
    return false;
  }
}

async function ensureApiInitialized() {
  if (!apiInitialized) {
    await initializeFirebase();
    apiInitialized = true;
  }
}

function getDb() {
  return getFirestoreInstance();
}

function safeParseInt(value, defaultValue = 0) {
  if (value === undefined || value === null) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

// 🛠️ تطبيع قيم المرحلة/الفصل الدراسي: تقبل عربي أو إنجليزي وتُرجع دائمًا القيمة العربية
// المخزّنة فعليًا في Firestore. هذا يصلح فجوة كانت تُسقط شرط الفلترة بصمت لو القيمة عربية أصلاً.
function normalizeStageValue(stage) {
  const stageMap = { preparatory: 'إعدادي', secondary: 'ثانوي' };
  return stageMap[stage] || stage || null;
}

function normalizeSemesterValue(semester) {
  const semesterMap = { first: 'أول', second: 'ثاني' };
  return semesterMap[semester] || semester || null;
}

//===== تعريف المستخدمين (يدعم فقط student, teacher, moderator) =====
function translateUserType(type) {
  const map = {
    student: 'طالب',
    teacher: 'معلم',
    moderator: 'مشرف'
  };
  return map[type] || 'طالب';
}


// ===== دوال التشفير (كلمات المرور) =====
const SALT = 'biologist_salt_2024';

async function hashPassword(password) {
  try {
    if (!window.crypto?.subtle) {
      console.warn("⚠️ crypto.subtle غير متوفر — fallback");
      return btoa(password + SALT);
    }

    const encoder = new TextEncoder();
    const data = encoder.encode(password + SALT);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (err) {
    console.warn("⚠️ hashing failed — fallback");
    return btoa(password + SALT);
  }
}


function isHashedPassword(str) {
  return typeof str === 'string' && /^[a-f0-9]{64}$/i.test(str);
}

/**
 * التحقق مما إذا كان المستخدم يمكنه تعديل تعليق معين (خلال 5 دقائق)
 * @param {Object} comment 
 * @param {number} userId 
 * @returns {boolean}
 */
function canEditComment(comment, userId) {
  if (!comment || !userId) return false;
  // المعلم أو المشرف يمكنهم تعديل أي تعليق
  const currentUser = getCurrentUser();
  if (currentUser && (isTeacher(currentUser) || isModerator(currentUser))) return true;
  // صاحب التعليق: فقط خلال 5 دقائق من الإنشاء
  if (comment.user_id !== userId) return false;
  const createdAt = comment.created_at?.toDate ? comment.created_at.toDate() : new Date(comment.created_at);
  const now = new Date();
  const diffMinutes = (now - createdAt) / (1000 * 60);
  return diffMinutes <= 5;
}


// ===== دوال المستخدمين =====
async function loginUser(phone, password) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const hashedInput = await hashPassword(password);

    const usersRef = collection(db, COLLECTIONS.USERS);
    const q = query(usersRef, where('phone', '==', phone));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      throw new Error('رقم الهاتف غير مسجل');
    }

    const userDoc = querySnapshot.docs[0];
    const userData = userDoc.data();
    const storedPassword = userData.password;

    // 1. المقارنة بالتجزئة
    let passwordMatch = storedPassword === hashedInput;

    // 2. إذا لم تتطابق، تحقق من وجود كلمة مرور نصية وقم بالترقية
    if (!passwordMatch && storedPassword === password) {
      // تحديث فوري لكلمة المرور إلى النسخة المشفرة
      await updateDoc(userDoc.ref, { password: hashedInput });
      console.log(`🔐 Password upgraded for user ID: ${userData.id}`);
      passwordMatch = true;
    }

    if (!passwordMatch) {
      throw new Error('كلمة المرور غير صحيحة');
    }

    // تحديث آخر نشاط وتسجيل الدخول
    await updateDoc(userDoc.ref, {
      last_login: serverTimestamp(),
      last_activity: serverTimestamp()
    });

    // إرجاع بيانات المستخدم (بدون كلمة المرور)
    return {
      id: userData.id,
      docId: userDoc.id,
      username: userData.username,
      full_name: userData.full_name,
      user_type: userData.user_type || 'student',
      gender: userData.gender,
      age: userData.age || 0,
      phone: userData.phone,
      last_login: userData.last_login,
      last_activity: userData.last_activity,
      total_score: userData.total_score || 0,
      likes_given: userData.likes_given || 0,
      comments_count: userData.comments_count || 0,
      avatar_url: userData.avatar_url || '',
      preferred_theme: userData.preferred_theme || 'light',
      badges: userData.badges || [],
      favorites: userData.favorites || [],
      is_verified: userData.is_verified || false
    };
  } catch (error) {
    console.error('❌ Login failed:', error.message);
    throw error;
  }
}

async function registerUser(userData) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const phoneExists = await checkPhoneExists(userData.phone);
    if (phoneExists) {
      throw new Error('رقم الهاتف مسجل بالفعل');
    }

    const hashedPassword = await hashPassword(userData.password);

    const newUser = {
      id: generateUniqueId(),
      username: `user_${Date.now()}`,
      full_name: `${userData.firstName || ''} ${userData.lastName || ''}`.trim(),
      user_type: userData.user_type || 'student',
      gender: userData.gender,
      age: safeParseInt(userData.age, 0),
      phone: userData.phone,
      password: hashedPassword,
      created_at: serverTimestamp(),
      last_login: serverTimestamp(),
      last_activity: serverTimestamp(),
      total_score: 0,
      likes_given: 0,
      comments_count: 0,
      badges: [],
      favorites: [],
      avatar_url: '',
      avatar_job_index: 0,
      streak: 0,
      preferred_theme: 'light',
      is_verified: false
    };

    const usersRef = collection(db, COLLECTIONS.USERS);
    await addDoc(usersRef, newUser);

    console.log(`✅ User registered with ID: ${newUser.id}`);
    return newUser.id;
  } catch (error) {
    console.error('❌ Registration failed:', error.message);
    throw error;
  }
}

async function checkPhoneExists(phone) {
  await ensureApiInitialized();
  const db = getDb();
  const usersRef = collection(db, COLLECTIONS.USERS);
  const q = query(usersRef, where('phone', '==', phone));
  const querySnapshot = await getDocs(q);
  return !querySnapshot.empty;
}

async function updateUserPreferences(userId, preferences) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const usersRef = collection(db, COLLECTIONS.USERS);
    const q = query(usersRef, where('id', '==', safeParseInt(userId)));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      throw new Error('المستخدم غير موجود');
    }

    const docRef = querySnapshot.docs[0].ref;
    const allowedFields = ['preferred_theme', 'preferred_color_theme', 'avatar_url', 'favorites', 'badges', 'avatar_job_index'];
    const updates = { last_activity: serverTimestamp() };

    Object.keys(preferences).forEach(key => {
      if (allowedFields.includes(key)) {
        updates[key] = preferences[key];
      }
    });

    await updateDoc(docRef, updates);
    return true;
  } catch (error) {
    console.error('❌ Failed to update user preferences:', error.message);
    throw error;
  }
}
/**
 * جلب مصفوفة معرفات الدروس المفضلة لدى المستخدم
 */
async function getUserFavorites(userId) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const usersRef = collection(db, COLLECTIONS.USERS);
    const q = query(usersRef, where('id', '==', safeParseInt(userId)));
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) return [];

    const data = querySnapshot.docs[0].data();
    return Array.isArray(data.favorites) ? data.favorites.map(String) : [];
  } catch (error) {
    console.error('❌ Failed to get user favorites:', error.message);
    return [];
  }
}

/**
 * مزامنة مصفوفة المفضلة الكاملة مع وثيقة المستخدم في Firestore
 */
async function syncUserFavorites(userId, favoritesArray) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const usersRef = collection(db, COLLECTIONS.USERS);
    const q = query(usersRef, where('id', '==', safeParseInt(userId)));
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) throw new Error('المستخدم غير موجود');

    const docRef = querySnapshot.docs[0].ref;
    const cleanFavorites = Array.isArray(favoritesArray) ? favoritesArray.map(String) : [];

    await updateDoc(docRef, {
      favorites: cleanFavorites,
      last_activity: serverTimestamp()
    });

    return cleanFavorites;
  } catch (error) {
    console.error('❌ Failed to sync user favorites:', error.message);
    throw error;
  }
}
async function updateUserLikesGiven(userId, incrementBy = 1) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const usersRef = collection(db, COLLECTIONS.USERS);
    const q = query(usersRef, where('id', '==', safeParseInt(userId)));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      throw new Error('المستخدم غير موجود');
    }

    const docRef = querySnapshot.docs[0].ref;
    await updateDoc(docRef, {
      likes_given: increment(incrementBy),
      last_activity: serverTimestamp()
    });
    return true;
  } catch (error) {
    console.error('❌ Failed to update user likes count:', error.message);
    throw error;
  }
}

async function incrementUserCommentsCount(userId) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const usersRef = collection(db, COLLECTIONS.USERS);
    const q = query(usersRef, where('id', '==', safeParseInt(userId)));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      throw new Error('المستخدم غير موجود');
    }

    const docRef = querySnapshot.docs[0].ref;
    await updateDoc(docRef, {
      comments_count: increment(1),
      last_activity: serverTimestamp()
    });
    return true;
  } catch (error) {
    console.error('❌ Failed to increment user comments count:', error.message);
    throw error;
  }
}

/**
 * 🛠️ الحصول على بيانات مستخدم بواسطة userId – إضافة total_score
 */
 
async function getUserById(userId) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const usersRef = collection(db, COLLECTIONS.USERS);
    const q = query(usersRef, where('id', '==', safeParseInt(userId)));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) return null;

    const userDoc = querySnapshot.docs[0];
    const userData = userDoc.data();

    return {
      id: userData.id,
      docId: userDoc.id,
      username: userData.username,
      full_name: userData.full_name,
      user_type: userData.user_type,
      gender: userData.gender,
      age: userData.age || 0,
      phone: userData.phone,
      email: userData.email || '',
      stage: userData.stage || '',               //  المرحلة الدراسية
      grade: userData.grade || '',               //  الصف
      avatar_url: userData.avatar_url || '',
      avatar_job_index: userData.avatar_job_index ?? 0,  //  مؤشر الوظيفة (0-9)
      preferred_theme: userData.preferred_theme || 'light',
      total_score: userData.total_score || 0,
      likes_given: userData.likes_given || 0,
      comments_count: userData.comments_count || 0,
      streak: userData.streak || 0,
      badges: userData.badges || [],
      favorites: userData.favorites || [],
      is_verified: userData.is_verified || false,
      created_at: userData.created_at,
      last_login: userData.last_login,
      last_activity: userData.last_activity
    };
  } catch (error) {
    console.error('❌ Failed to get user:', error.message);
    throw error;
  }
}

async function updateUserProfile(userId, profileData) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const usersRef = collection(db, COLLECTIONS.USERS);
    const q = query(usersRef, where('id', '==', safeParseInt(userId)));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      throw new Error('المستخدم غير موجود');
    }

    const docRef = querySnapshot.docs[0].ref;
    const updates = { last_activity: serverTimestamp() };

    if (profileData.full_name !== undefined) updates.full_name = profileData.full_name;
    if (profileData.age !== undefined) updates.age = safeParseInt(profileData.age, 0);
    if (profileData.gender !== undefined) updates.gender = profileData.gender;
    if (profileData.user_type !== undefined) updates.user_type = profileData.user_type;
    if (profileData.avatar_url !== undefined) updates.avatar_url = profileData.avatar_url;
    if (profileData.avatar_job_index !== undefined) updates.avatar_job_index = profileData.avatar_job_index; // 
    if (profileData.preferred_theme !== undefined) updates.preferred_theme = profileData.preferred_theme;
    if (profileData.email !== undefined) updates.email = profileData.email;               // 
    if (profileData.stage !== undefined) updates.stage = profileData.stage;               // 
    if (profileData.grade !== undefined) updates.grade = safeParseInt(profileData.grade); // 

    await updateDoc(docRef, updates);
    return true;
  } catch (error) {
    console.error('❌ Failed to update user profile:', error.message);
    throw error;
  }
}

async function updateLegacyUsers() {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const usersRef = collection(db, COLLECTIONS.USERS);
    const snapshot = await getDocs(usersRef);
    const batch = writeBatch(db);
    let updatedCount = 0;

    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      const updates = {};

      if (data.comments_count === undefined) updates.comments_count = 0;
      if (data.likes_given === undefined) updates.likes_given = 0;
      if (data.badges === undefined) updates.badges = [];
      if (data.favorites === undefined) updates.favorites = [];
      if (data.avatar_url === undefined) updates.avatar_url = '';
      if (data.preferred_theme === undefined) updates.preferred_theme = 'light';
      if (data.is_verified === undefined) updates.is_verified = false;
      if (data.created_at === undefined) updates.created_at = serverTimestamp();

      // ترقية كلمات المرور النصية (أثناء التحديث الشامل)
      if (data.password && !isHashedPassword(data.password)) {
        console.warn(`⚠️ Legacy plain password detected for user ${data.id}, skipping auto-upgrade.`);
        // يمكن إضافة منطق الترقية هنا، لكن يُفضل أن تتم أثناء تسجيل الدخول
      }

      if (Object.keys(updates).length > 0) {
        batch.update(docSnap.ref, updates);
        updatedCount++;
      }
    });

    if (updatedCount > 0) {
      await batch.commit();
      console.log(`✅ Updated ${updatedCount} legacy users`);
    }
    return updatedCount;
  } catch (error) {
    console.error('❌ Failed to update legacy users:', error.message);
    throw error;
  }
}

// ===== دوال جديدة لإجمالي النقاط =====
/**
 * إعادة حساب total_score للمستخدم بناءً على جميع نتائج الامتحانات في User_Progress
 * @param {number|string} userId 
 * @returns {Promise<number>} المجموع الجديد
 */
async function recalculateUserTotalScore(userId) {
  await ensureApiInitialized();
  const db = getDb();
  const parsedUserId = safeParseInt(userId);

  try {
    // 1. جلب كل تقدم المستخدم
    const progressRef = collection(db, COLLECTIONS.USER_PROGRESS);
    const q = query(progressRef, where('user_id', '==', parsedUserId));
    const snapshot = await getDocs(q);

    let total = 0;
    snapshot.forEach(doc => {
      const data = doc.data();
      total += data.exam_score || 0;
    });

    // 2. تحديث حقل total_score في وثيقة المستخدم
    const usersRef = collection(db, COLLECTIONS.USERS);
    const userQuery = query(usersRef, where('id', '==', parsedUserId));
    const userSnap = await getDocs(userQuery);
    if (!userSnap.empty) {
      const userRef = userSnap.docs[0].ref;
      await updateDoc(userRef, {
        total_score: total,
        last_activity: serverTimestamp()
      });
      console.log(`✅ Recalculated total_score for user ${parsedUserId}: ${total}`);
    }

    return total;
  } catch (error) {
    console.error('❌ Failed to recalculate total_score:', error.message);
    throw error;
  }
}

// ===== دوال الدروس =====
/**
 * 🛠️ الحصول على قائمة الدروس مع دعم الفلترة والترجمة من إنجليزي لعربي
 */
async function getAllLessons(options = {}) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const {
      stage,
      grade,
      semester,
      limit = 20,
      startAfterDoc,
      startAfterCreatedAt,
      lastId
    } = options;

    const lessonsRef = collection(db, COLLECTIONS.LESSONS);
    let constraints = [];

    // 🛠️ إصلاح حرج: الـ Collection مشتركة بين الدروس والامتحانات المرتبطة بها
    // (createExam بيحفظ بـ type: 'lesson_exam' في نفس المجموعة) - لازم نستبعدها هنا
    constraints.push(where('type', '==', 'lesson'));

// 🛠️ تطبيع المرحلة (تقبل عربي أو إنجليزي)
    const normalizedStage = normalizeStageValue(stage);
    if (normalizedStage) {
      constraints.push(where('stage', '==', normalizedStage));
    }

    if (grade !== undefined) {
      constraints.push(where('grade', '==', safeParseInt(grade)));
    }

    // 🛠️ تطبيع الفصل الدراسي (تقبل عربي أو إنجليزي)
    const normalizedSemester = normalizeSemesterValue(semester);
    if (normalizedSemester) {
      constraints.push(where('semester', '==', normalizedSemester));
    }

    // الترتيب: created_at تنازلياً، ثم id تنازلياً (لكسر التعادل)
    constraints.push(orderBy('created_at', 'desc'));
    constraints.push(orderBy('id', 'desc'));

 // Pagination
if (startAfterDoc) {
  constraints.push(startAfter(startAfterDoc));
} else if (startAfterCreatedAt && lastId !== undefined && lastId !== null) {
  constraints.push(startAfter(startAfterCreatedAt, safeParseInt(lastId)));
}

    constraints.push(firestoreLimit(limit));

    const q = query(lessonsRef, ...constraints);
    const querySnapshot = await getDocs(q);
    const lessons = [];

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      lessons.push({
        docId: doc.id,
        id: data.id,
        stage: data.stage,          // عربي
        semester: data.semester,    // عربي
        grade: data.grade,
        unit_id: data.unit_id ?? null,
        title: data.title,
        description: data.description,
        video_url: data.video_url,
        pdf_url: data.pdf_url,
        cover_image_url: data.cover_image_url || '',
        duration: data.duration || 0,
        comments_count: data.comments_count || 0,
        likes: data.likes || 0,
        liked_by: data.liked_by || [],
        average_rating: data.average_rating || 0,
        ratings_count: Array.isArray(data.ratings) ? data.ratings.length : (data.ratings_count || 0),
        created_at: data.created_at,
        updated_at: data.updated_at
      });
    });

    return lessons;
  } catch (error) {
    console.error('❌ Failed to get lessons:', error.message);
    throw error;
  }
}
/**
 * جلب عدد الدروس حسب معايير الفلترة الأساسية (للاستخدام في الإحصائيات)
 * @param {Object} options - { stage, grade, semester, searchTerm, unitId, category }
 * @returns {Promise<number>}
 */
async function getLessonsCount(options = {}) {
  await ensureApiInitialized();
  const db = getDb();
  
  try {
    const { stage, grade, semester } = options;
    const constraints = [where('type', '==', 'lesson'), where('deleted_at', '==', null)];
    
    if (stage) constraints.push(where('stage', '==', stage));
    if (grade !== undefined) constraints.push(where('grade', '==', safeParseInt(grade)));
    if (semester) constraints.push(where('semester', '==', semester));
    
    // ملاحظة: البحث والتصنيف (مثل المفضلة/المكتملة) لا يمكن فلترتها على مستوى العد
    // لأنها تعتمد على بيانات المستخدم (يجب حسابها منفصلة)
    
    const q = query(collection(db, COLLECTIONS.LESSONS), ...constraints);
    const snapshot = await getDocs(q);
    return snapshot.size;
  } catch (error) {
    console.error('❌ Failed to get lessons count:', error.message);
    return 0;
  }
}
/**
 * 🔍 بحث نصي في الدروس (العنوان أو الوصف) مع دعم الفلاتر
 * ⚠️ يتطلب إنشاء فهارس مركّبة (composite indexes) في Firestore عند أول تشغيل
 * (سيعطيك Firestore رابطاً جاهزاً لإنشائها في الـ Console عند ظهور الخطأ أول مرة)
 */
async function searchLessons(searchText, options = {}) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const { stage, grade, semester, unitId, limit = 20 } = options;
    const text = (searchText || '').trim();
    if (!text) return [];

    // جديد
    const baseConstraints = [where('type', '==', 'lesson')]; // 🛠️ استبعاد امتحانات الدروس من نتائج البحث
    const normalizedStage = normalizeStageValue(stage);
    const normalizedSemester = normalizeSemesterValue(semester);
    if (normalizedStage) baseConstraints.push(where('stage', '==', normalizedStage));
    if (grade !== undefined) baseConstraints.push(where('grade', '==', safeParseInt(grade)));
    if (normalizedSemester) baseConstraints.push(where('semester', '==', normalizedSemester));
    if (unitId !== undefined && unitId !== null) baseConstraints.push(where('unit_id', '==', safeParseInt(unitId)));

    const lessonsRef = collection(db, COLLECTIONS.LESSONS);

    const titleQuery = query(
      lessonsRef, ...baseConstraints,
      where('title', '>=', text), where('title', '<=', text + '\uf8ff'),
      firestoreLimit(limit)
    );
    const descQuery = query(
      lessonsRef, ...baseConstraints,
      where('description', '>=', text), where('description', '<=', text + '\uf8ff'),
      firestoreLimit(limit)
    );

    const [titleSnap, descSnap] = await Promise.all([
      getDocs(titleQuery).catch(() => ({ docs: [] })),
      getDocs(descQuery).catch(() => ({ docs: [] }))
    ]);

    const map = new Map();
    [...titleSnap.docs, ...descSnap.docs].forEach(docSnap => {
      const data = docSnap.data();
      if (!map.has(data.id)) {
        map.set(data.id, {
          docId: docSnap.id,
          id: data.id,
          stage: data.stage,
          semester: data.semester,
          grade: data.grade,
          unit_id: data.unit_id,
          title: data.title,
          description: data.description,
          video_url: data.video_url,
          pdf_url: data.pdf_url,
          cover_image_url: data.cover_image_url || '',
          duration: data.duration || 0,
          comments_count: data.comments_count || 0,
          likes: data.likes || 0,
          liked_by: data.liked_by || [],
          average_rating: data.average_rating || 0,
          ratings_count: Array.isArray(data.ratings) ? data.ratings.length : 0,
          created_at: data.created_at,
          updated_at: data.updated_at
        });
      }
    });

    return Array.from(map.values())
      .sort((a, b) => (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0))
      .slice(0, limit);
  } catch (error) {
    console.error('❌ Failed to search lessons:', error.message);
    return [];
  }
}

async function getLessonById(lessonId) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const lessonsRef = collection(db, COLLECTIONS.LESSONS);
    const q = query(lessonsRef, where('id', '==', safeParseInt(lessonId)));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) return null;

    const docSnap = querySnapshot.docs[0];
    const data = docSnap.data();

    return {
      docId: docSnap.id,
      id: data.id,
      stage: data.stage,
      semester: data.semester,
      grade: data.grade,
      unit_id: data.unit_id ?? null,
      title: data.title,
      description: data.description,
      video_url: data.video_url,
      pdf_url: data.pdf_url,
      cover_image_url: data.cover_image_url || '',
      duration: data.duration || 0,
      comments_count: data.comments_count || 0,
      likes: data.likes || 0,
      liked_by: data.liked_by || [],
      average_rating: data.average_rating || 0,
      ratings_count: Array.isArray(data.ratings) ? data.ratings.length : (data.ratings_count || 0),
      ratings: data.ratings || [],
      created_at: data.created_at,
      
      
      updated_at: data.updated_at
    };
  } catch (error) {
    console.error('❌ Failed to get lesson:', error.message);
    throw error;
  }
}

async function toggleLessonLike(lessonId, userId) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const parsedLessonId = safeParseInt(lessonId);
    const parsedUserId = safeParseInt(userId);

    const lessonsRef = collection(db, COLLECTIONS.LESSONS);
    const lessonQuery = query(lessonsRef, where('id', '==', parsedLessonId));
    const lessonSnap = await getDocs(lessonQuery);
    if (lessonSnap.empty) throw new Error('الدرس غير موجود');
    const lessonRef = lessonSnap.docs[0].ref;

    const usersRef = collection(db, COLLECTIONS.USERS);
    const userQuery = query(usersRef, where('id', '==', parsedUserId));
    const userSnap = await getDocs(userQuery);
    if (userSnap.empty) throw new Error('المستخدم غير موجود');
    const userRef = userSnap.docs[0].ref;

    await runTransaction(db, async (transaction) => {
      const lessonDoc = await transaction.get(lessonRef);
      if (!lessonDoc.exists) throw new Error('الدرس غير موجود');

      const currentLikedBy = lessonDoc.data().liked_by || [];
      const alreadyLiked = currentLikedBy.includes(parsedUserId);

      if (alreadyLiked) {
        transaction.update(lessonRef, {
          liked_by: arrayRemove(parsedUserId),
          likes: increment(-1)
        });
        transaction.update(userRef, {
          likes_given: increment(-1),
          last_activity: serverTimestamp()
        });
      } else {
        transaction.update(lessonRef, {
          liked_by: arrayUnion(parsedUserId),
          likes: increment(1)
        });
        transaction.update(userRef, {
          likes_given: increment(1),
          last_activity: serverTimestamp()
        });
      }
    });

    return true;
  } catch (error) {
    console.error('❌ Failed to toggle lesson like:', error.message);
    throw error;
  }
}

/**
 * تخزين/تحديث تقييم مستخدم لدرس، وإعادة حساب المتوسط
 */
async function rateLesson(lessonId, userId, rating) {
  await ensureApiInitialized();
  const db = getDb();
  const parsedLessonId = safeParseInt(lessonId);
  const parsedUserId = safeParseInt(userId);
  const parsedRating = Math.min(5, Math.max(1, safeParseInt(rating, 0)));

  try {
    const lessonsRef = collection(db, COLLECTIONS.LESSONS);
    const q = query(lessonsRef, where('id', '==', parsedLessonId), where('type', '==', 'lesson'));
    const snapshot = await getDocs(q);
    if (snapshot.empty) throw new Error('الدرس غير موجود');

    const docRef = snapshot.docs[0].ref;
    const data = snapshot.docs[0].data();
    const ratings = Array.isArray(data.ratings) ? [...data.ratings] : [];

    const existingIndex = ratings.findIndex(r => safeParseInt(r.userId) === parsedUserId);
    const newEntry = { userId: parsedUserId, rating: parsedRating, timestamp: Timestamp.now() };

    if (existingIndex > -1) {
      ratings[existingIndex] = newEntry;
    } else {
      ratings.push(newEntry);
    }

    const averageRating = ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length;

    await updateDoc(docRef, {
      ratings,
      average_rating: parseFloat(averageRating.toFixed(2)),
      ratings_count: ratings.length,
      updated_at: serverTimestamp()
    });

    return {
      average_rating: parseFloat(averageRating.toFixed(2)),
      ratings_count: ratings.length
    };
  } catch (error) {
    console.error('❌ Failed to rate lesson:', error.message);
    throw error;
  }
}

async function incrementLessonCommentsCount(lessonId) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const lessonsRef = collection(db, COLLECTIONS.LESSONS);
    const q = query(lessonsRef, where('id', '==', safeParseInt(lessonId)));
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
      const docRef = querySnapshot.docs[0].ref;
      await updateDoc(docRef, {
        comments_count: increment(1)
      });
    }
  } catch (error) {
    console.error('❌ Failed to update comments count:', error.message);
    // لا نرمي الخطأ لأن هذه وظيفة ثانوية
  }
}

// ===== دوال الامتحانات =====
async function getExamById(examId) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const quizzesRef = collection(db, COLLECTIONS.QUIZZES);
    const q = query(quizzesRef, where('exam_id', '==', safeParseInt(examId)));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) return null;

    const questions = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      questions.push({
        docId: doc.id,
        id: data.id,
        lesson_id: data.lesson_id,
        question: data.question,
        option_a: data.option_a,
        option_b: data.option_b,
        option_c: data.option_c,
        option_d: data.option_d,
        correct: data.correct,
        exam_id: data.exam_id,
        difficulty_level: data.difficulty_level || 'Easy',
        question_type: data.question_type || 'MCQ'
      });
    });

    return {
      exam_id: safeParseInt(examId),
      questions,
      total_questions: questions.length
    };
  } catch (error) {
    console.error('❌ Failed to get exam:', error.message);
    throw error;
  }
}

async function saveExamResult(userId, examResult) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const resultsRef = collection(db, COLLECTIONS.EXAM_RESULTS);
    const total = safeParseInt(examResult.totalQuestions, 0);
    const correct = safeParseInt(examResult.correctAnswers, 0);
    const accuracy = total > 0 ? (correct / total) * 100 : 0;

    const resultData = {
      id: generateUniqueId(),
      user_id: safeParseInt(userId),
      exam_id: safeParseInt(examResult.examId),
      score: safeParseInt(examResult.score, 0),
      total_questions: total,
      correct_answers: correct,
      time_taken: safeParseInt(examResult.timeTaken, 0),
      passed: examResult.passed || false,
      accuracy: parseFloat(accuracy.toFixed(2)),
      date: serverTimestamp(),
      feedback: examResult.feedback || ''
    };

    await addDoc(resultsRef, resultData);
    await recalculateUserTotalScore(userId);
    console.log(`✅ Exam result saved with ID: ${resultData.id}`);
    return resultData.id;
  } catch (error) {
    console.error('❌ Failed to save exam result:', error.message);
    throw error;
  }
}

// ===== دوال تقدم المستخدم =====
async function updateUserProgress(userId, lessonId, progress, totalTimeSpent = null) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const parsedUserId = safeParseInt(userId);
    const parsedLessonId = safeParseInt(lessonId);
    const parsedProgress = Math.min(100, Math.max(0, safeParseInt(progress, 0)));
    const parsedTotalTime = totalTimeSpent !== null ? safeParseInt(totalTimeSpent, 0) : null;

    const progressRef = collection(db, COLLECTIONS.USER_PROGRESS);
    const q = query(
      progressRef,
      where('user_id', '==', parsedUserId),
      where('lesson_id', '==', parsedLessonId)
    );

    const querySnapshot = await getDocs(q);
    
    // ==== بيانات التحديث الأساسية ====
    const updateData = {
      progress: parsedProgress,
      completed: parsedProgress >= 100,
      last_accessed: serverTimestamp()
    };
    if (parsedTotalTime !== null) {
      updateData.total_time_spent = parsedTotalTime;
    }

    if (querySnapshot.empty) {
      await addDoc(progressRef, {
        id: generateUniqueId(),
        user_id: parsedUserId,
        lesson_id: parsedLessonId,
        progress: parsedProgress,
        completed: parsedProgress >= 100,
        last_accessed: serverTimestamp(),
        exam_score: 0,
        total_time_spent: parsedTotalTime !== null ? parsedTotalTime : 0,
        exam_date: null
      });
    } else {
      const docRef = querySnapshot.docs[0].ref;
      await updateDoc(docRef, updateData);
    }

    console.log('✅ User progress updated');
    return true;
  } catch (error) {
    console.error('❌ Failed to update progress:', error.message);
    throw error;
  }
}

/**
 * 🛠️ تحديث درجة الامتحان في تقدم المستخدم + إعادة حساب total_score
 */
async function updateUserExamScore(userId, lessonId, score) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const parsedUserId = safeParseInt(userId);
    const parsedLessonId = safeParseInt(lessonId);
    const parsedScore = safeParseInt(score, 0);

    const progressRef = collection(db, COLLECTIONS.USER_PROGRESS);
    const q = query(
      progressRef,
      where('user_id', '==', parsedUserId),
      where('lesson_id', '==', parsedLessonId)
    );

    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      await addDoc(progressRef, {
        id: generateUniqueId(),
        user_id: parsedUserId,
        lesson_id: parsedLessonId,
        progress: 0,
        completed: false,
        last_accessed: serverTimestamp(),
        exam_score: parsedScore,
        total_time_spent: 0,
        exam_date: serverTimestamp()
      });
    } else {
      const docRef = querySnapshot.docs[0].ref;
      await updateDoc(docRef, {
        exam_score: parsedScore,
        last_accessed: serverTimestamp(),
        exam_date: serverTimestamp()
      });
    }

    // 🛠️ إعادة حساب total_score فوراً بعد تحديث الدرجة
    await recalculateUserTotalScore(parsedUserId);

    return true;
  } catch (error) {
    console.error('❌ Failed to update exam score:', error.message);
    throw error;
  }
}

async function getUserProgress(userId) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const progressRef = collection(db, COLLECTIONS.USER_PROGRESS);
    const q = query(progressRef, where('user_id', '==', safeParseInt(userId)));
    const querySnapshot = await getDocs(q);

    const progress = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      progress.push({
        docId: doc.id,
        id: data.id,
        user_id: data.user_id,
        lesson_id: data.lesson_id,
        progress: data.progress || 0,
        completed: data.completed || false,
        last_accessed: data.last_accessed,
        exam_score: data.exam_score || 0,
        total_time_spent: data.total_time_spent || 0,
        exam_date: data.exam_date || null
      });
    });
    return progress;
  } catch (error) {
    console.error('❌ Failed to get user progress:', error.message);
    throw error;
  }
}

// ===== دوال الامتحانات (إضافات جديدة) =====

/**
 *إنشاء امتحان جديد مع أسئلته
 * @param {Object} examData - بيانات الامتحان
 * @param {Array} questions - مصفوفة الأسئلة
 * @returns {Promise<number>} معرف الامتحان الجديد
 */
async function createExam(examData, questions) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const examId = generateUniqueId();
    const batch = writeBatch(db);

    //  نطاق الامتحان: 'unit' (يخص وحدة معينة، مثل نظام الدروس) أو 'comprehensive' (شامل)
    // امتحان الوحدة لازم يكون له unit_id صريح، وأي حاجة تانية تعتبر شاملة
    const examScope = examData.exam_scope === 'unit' ? 'unit' : 'comprehensive';
    const examUnitId = (examScope === 'unit' && examData.unit_id) ? safeParseInt(examData.unit_id) : null;

    // 1. حفظ بيانات الامتحان الرئيسية في Biologist_Lessons (أو مجموعة منفصلة للامتحانات)
    const examMeta = {
      id: examId,
      type: 'exam',
      lesson_id: examData.lesson_id ? safeParseInt(examData.lesson_id) : null,
      exam_scope: examScope,
      unit_id: examUnitId,
      stage: examData.stage,
      grade: safeParseInt(examData.grade),
      semester: examData.semester,
      title: examData.title,
      description: examData.description || '',
      duration: safeParseInt(examData.duration, 30),
      questions_count: questions.length,
      is_challenge: examData.is_challenge || false,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
      order: examData.order || 0,
      cover_image_url: examData.cover_image_url || '',
      deleted_at: null
    };
    
    const examsRef = collection(db, COLLECTIONS.LESSONS); // نستخدم نفس مجموعة الدروس
    const examDocRef = doc(examsRef);
    batch.set(examDocRef, examMeta);
    
    // 2. حفظ الأسئلة في Biologist_Quizzes
    const quizzesRef = collection(db, COLLECTIONS.QUIZZES);
    questions.forEach((q, index) => {
      const questionData = {
        id: generateUniqueId() + index,
        exam_id: examId,
        question: q.text,
        question_type: q.type,
        difficulty_level: q.difficulty || 'easy',
        image_url: q.image || '',
        created_at: serverTimestamp()
      };
      
      if (q.type === 'multiple_choice') {
        questionData.option_a = q.options[0] || '';
        questionData.option_b = q.options[1] || '';
        questionData.option_c = q.options[2] || '';
        questionData.option_d = q.options[3] || '';
        questionData.correct = String.fromCharCode(97 + q.correct);
      } else if (q.type === 'true_false') {
        questionData.correct = q.correct ? 'true' : 'false';
      }
      
      const qDocRef = doc(quizzesRef);
      batch.set(qDocRef, questionData);
    });
    
    await batch.commit();

    // تحديث عدد امتحانات الوحدة (لو الامتحان مرتبط بوحدة)
    if (examUnitId) {
      try {
        await incrementUnitExamsCount(examUnitId, 1);
      } catch (countError) {
        console.error('⚠️ فشل تحديث عداد امتحانات الوحدة (لن يمنع نجاح الإنشاء):', countError.message);
      }
    }

    console.log(`✅ Exam created with ID: ${examId}`);
    return examId;
  } catch (error) {
    console.error('❌ Failed to create exam:', error.message);
    throw error;
  }
}

/**
 *تحديث امتحان موجود (بيانات وأسئلة)
 * @param {number} examId - معرف الامتحان
 * @param {Object} examData - بيانات الامتحان المحدثة
 * @param {Array} questions - الأسئلة المحدثة (سيتم استبدال القديمة)
 */
async function updateExam(examId, examData, questions) {
  await ensureApiInitialized();
  const db = getDb();
  const parsedExamId = safeParseInt(examId);

  try {
    const batch = writeBatch(db);
    
    // 1. تحديث بيانات الامتحان
    const examsRef = collection(db, COLLECTIONS.LESSONS);
    const examQuery = query(examsRef, where('id', '==', parsedExamId), where('type', '==', 'exam'));
    const examSnapshot = await getDocs(examQuery);
    
    if (examSnapshot.empty) throw new Error('الامتحان غير موجود');
    
    const examDoc = examSnapshot.docs[0];
    const examRef = examDoc.ref;
    const oldUnitId = examDoc.data().unit_id ?? null;

    //  نطاق الامتحان: نفس منطق createExam تماماً
    const examScope = examData.exam_scope === 'unit' ? 'unit' : 'comprehensive';
    const newUnitId = (examScope === 'unit' && examData.unit_id) ? safeParseInt(examData.unit_id) : null;

    const updates = {
      title: examData.title,
      exam_scope: examScope,
      unit_id: newUnitId,
      stage: examData.stage,
      grade: safeParseInt(examData.grade),
      semester: examData.semester,
      duration: safeParseInt(examData.duration),
      description: examData.description || '',
      is_challenge: examData.is_challenge || false,
      questions_count: questions.length,
      updated_at: serverTimestamp()
    };
    if (examData.cover_image_url !== undefined) updates.cover_image_url = examData.cover_image_url;
    
    batch.update(examRef, updates);
    
    // 2. حذف الأسئلة القديمة
    const quizzesRef = collection(db, COLLECTIONS.QUIZZES);
    const oldQuestionsQuery = query(quizzesRef, where('exam_id', '==', parsedExamId));
    const oldQuestionsSnapshot = await getDocs(oldQuestionsQuery);
    oldQuestionsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
    
    // 3. إضافة الأسئلة الجديدة
    questions.forEach((q, index) => {
      const questionData = {
        id: generateUniqueId() + index,
        exam_id: parsedExamId,
        question: q.text,
        question_type: q.type,
        difficulty_level: q.difficulty || 'easy',
        image_url: q.image || '',
        created_at: serverTimestamp()
      };
      
      if (q.type === 'multiple_choice') {
        questionData.option_a = q.options[0] || '';
        questionData.option_b = q.options[1] || '';
        questionData.option_c = q.options[2] || '';
        questionData.option_d = q.options[3] || '';
        questionData.correct = String.fromCharCode(97 + q.correct);
      } else if (q.type === 'true_false') {
        questionData.correct = q.correct ? 'true' : 'false';
      }
      
      const qDocRef = doc(quizzesRef);
      batch.set(qDocRef, questionData);
    });
    
    await batch.commit();

    // تحديث عدادات امتحانات الوحدات لو الوحدة اتغيرت
    if (oldUnitId !== newUnitId) {
      try {
        if (oldUnitId) await incrementUnitExamsCount(oldUnitId, -1);
        if (newUnitId) await incrementUnitExamsCount(newUnitId, 1);
      } catch (countError) {
        console.error('⚠️ فشل تحديث عداد امتحانات الوحدة (لن يمنع نجاح التحديث):', countError.message);
      }
    }

    console.log(`✅ Exam ${examId} updated successfully`);
    return true;
  } catch (error) {
    console.error('❌ Failed to update exam:', error.message);
    throw error;
  }
}

/**
 *حذف امتحان (نقل إلى المهملات - soft delete)
 * @param {number} examId - معرف الامتحان
 * @param {boolean} softDelete - حذف منطقي (افتراضي true)
 */
async function deleteExam(examId, softDelete = true) {
  await ensureApiInitialized();
  const db = getDb();
  const parsedExamId = safeParseInt(examId);

  try {
    const examsRef = collection(db, COLLECTIONS.LESSONS);
    const examQuery = query(examsRef, where('id', '==', parsedExamId), where('type', '==', 'exam'));
    const examSnapshot = await getDocs(examQuery);
    
    if (examSnapshot.empty) throw new Error('الامتحان غير موجود');
    
    const examDoc = examSnapshot.docs[0];
    const examUnitId = examDoc.data().unit_id ?? null;
    
    if (softDelete) {
      // تحديث حقل deleted_at لنقله للمهملات
      await updateDoc(examDoc.ref, {
        deleted_at: serverTimestamp(),
        updated_at: serverTimestamp()
      });
      console.log(`✅ Exam ${examId} moved to trash`);
    } else {
      // حذف نهائي
      await deleteDoc(examDoc.ref);
      // حذف الأسئلة المرتبطة
      const quizzesRef = collection(db, COLLECTIONS.QUIZZES);
      const questionsQuery = query(quizzesRef, where('exam_id', '==', parsedExamId));
      const questionsSnapshot = await getDocs(questionsQuery);
      const batch = writeBatch(db);
      questionsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      console.log(`✅ Exam ${examId} permanently deleted`);
    }

    // تحديث عداد امتحانات الوحدة (في الحذف المؤقت والنهائي على حد سواء)
    if (examUnitId) {
      try {
        await incrementUnitExamsCount(examUnitId, -1);
      } catch (countError) {
        console.error('⚠️ فشل تحديث عداد امتحانات الوحدة (لن يمنع نجاح الحذف):', countError.message);
      }
    }

    return true;
  } catch (error) {
    console.error('❌ Failed to delete exam:', error.message);
    throw error;
  }
}

//للبحث عن امتحان متبط بدرس معين
async function getExamByLessonId(lessonId) {
  await ensureApiInitialized();
  const db = getDb();
  const parsedLessonId = safeParseInt(lessonId);

  try {
    const examsRef = collection(db, COLLECTIONS.LESSONS);
    const q = query(
      examsRef,
      where('type', '==', 'exam'),
      where('lesson_id', '==', parsedLessonId),
      where('deleted_at', '==', null),
      limit(1)
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;

    const doc = snapshot.docs[0];
    const data = doc.data();
    return {
      id: data.id,
      title: data.title,
      duration: data.duration,
      questions_count: data.questions_count,
      is_challenge: data.is_challenge || false
    };
  } catch (error) {
    console.error('❌ Failed to get exam by lesson id:', error.message);
    return null;
  }
}
/**
 *جلب قائمة الامتحانات مع فلترة و pagination
 * @param {Object} options - { stage, grade, semester, limit, startAfter, includeDeleted }
 */
async function getExams(options = {}) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const {
      stage,
      grade,
      semester,
      limit = 20,
      startAfterDoc,
      includeDeleted = false
    } = options;

    const examsRef = collection(db, COLLECTIONS.LESSONS);
    let constraints = [where('type', '==', 'exam')];
    
    if (!includeDeleted) {
      constraints.push(where('deleted_at', '==', null));
    }

    // تحويل المرحلة من إنجليزي إلى عربي
    const stageMap = { preparatory: 'إعدادي', secondary: 'ثانوي' };
    if (stage && stageMap[stage]) {
      constraints.push(where('stage', '==', stageMap[stage]));
    }

    if (grade !== undefined) {
      constraints.push(where('grade', '==', safeParseInt(grade)));
    }

    const semesterMap = { first: 'أول', second: 'ثاني' };
    if (semester && semesterMap[semester]) {
      constraints.push(where('semester', '==', semesterMap[semester]));
    }

    // ترتيب حسب order ثم created_at
    constraints.push(orderBy('order', 'asc'));
    constraints.push(orderBy('created_at', 'desc'));

    if (startAfterDoc) {
      constraints.push(startAfter(startAfterDoc));
    }

    constraints.push(firestoreLimit(limit));

    const q = query(examsRef, ...constraints);
    const querySnapshot = await getDocs(q);
    const exams = [];

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      //  امتحانات قديمة أُنشئت قبل إضافة نظام الوحدات ليس لها unit_id/exam_scope إطلاقاً
      // في Firestore — نطبّعها هنا كـ "شامل" تلقائياً بدل ما تختفي من كل التبويبات
      const unitId = data.unit_id ?? null;
      const examScope = data.exam_scope || (unitId ? 'unit' : 'comprehensive');

      exams.push({
        docId: doc.id,
        id: data.id,
        unit_id: unitId,
        exam_scope: examScope,
        stage: data.stage,
        semester: data.semester,
        grade: data.grade,
        title: data.title,
        description: data.description,
        duration: data.duration || 30,
        questions_count: data.questions_count || 0,
        is_challenge: data.is_challenge || false,
        created_at: data.created_at,
        updated_at: data.updated_at,
        order: data.order || 0,
        cover_image_url: data.cover_image_url || ''
      });
    });

    return exams;
  } catch (error) {
    console.error('❌ Failed to get exams:', error.message);
    throw error;
  }
}

/**
 *جلب بيانات امتحان كاملة (مع الأسئلة) للتعديل
 * @param {number} examId 
 */
async function getExamFullData(examId) {
  await ensureApiInitialized();
  const db = getDb();
  const parsedExamId = safeParseInt(examId);

  try {
    // 1. جلب بيانات الامتحان
    const examsRef = collection(db, COLLECTIONS.LESSONS);
    const examQuery = query(examsRef, where('id', '==', parsedExamId), where('type', '==', 'exam'));
    const examSnapshot = await getDocs(examQuery);
    
    if (examSnapshot.empty) return null;
    
    const examDoc = examSnapshot.docs[0];
    const examData = examDoc.data();
    
    // 2. جلب الأسئلة
    const quizzesRef = collection(db, COLLECTIONS.QUIZZES);
    const questionsQuery = query(quizzesRef, where('exam_id', '==', parsedExamId), orderBy('id', 'asc'));
    const questionsSnapshot = await getDocs(questionsQuery);
    
    const questions = [];
    questionsSnapshot.forEach((doc) => {
      const q = doc.data();
      let questionObj = {
        id: q.id,
        text: q.question,
        type: q.question_type,
        image: q.image_url || '',
        difficulty: q.difficulty_level || 'easy'
      };
      
      if (q.question_type === 'multiple_choice') {
        questionObj.options = [q.option_a, q.option_b, q.option_c, q.option_d].filter(opt => opt !== undefined);
        questionObj.correct = q.correct.charCodeAt(0) - 97;
      } else if (q.question_type === 'true_false') {
        questionObj.correct = q.correct === 'true';
      }
      
      questions.push(questionObj);
    });
    
    // نفس منطق التطبيع الموجود في getExams تماماً (امتحانات قديمة بلا unit_id/exam_scope → شامل)
    const unitId = examData.unit_id ?? null;
    const examScope = examData.exam_scope || (unitId ? 'unit' : 'comprehensive');

    return {
      meta: {
        title: examData.title,
        unit_id: unitId,
        exam_scope: examScope,
        stage: examData.stage,
        grade: examData.grade,
        semester: examData.semester,
        duration: examData.duration,
        is_challenge: examData.is_challenge || false,
        description: examData.description || '',
        cover_image_url: examData.cover_image_url || ''
      },
      questions: questions
    };
  } catch (error) {
    console.error('❌ Failed to get exam full data:', error.message);
    throw error;
  }
}

/**
 *تحريك امتحان (تغيير ترتيبه)
 * @param {number} examId - معرف الامتحان
 * @param {string} direction - 'up' أو 'down'
 */
async function moveExam(examId, direction) {
  await ensureApiInitialized();
  const db = getDb();
  const parsedExamId = safeParseInt(examId);

  try {
    // جلب الامتحان الحالي
    const examsRef = collection(db, COLLECTIONS.LESSONS);
    const currentQuery = query(examsRef, where('id', '==', parsedExamId), where('type', '==', 'exam'));
    const currentSnapshot = await getDocs(currentQuery);
    if (currentSnapshot.empty) throw new Error('الامتحان غير موجود');
    
    const currentDoc = currentSnapshot.docs[0];
    const currentData = currentDoc.data();
    const currentOrder = currentData.order || 0;
    
    // جلب جميع الامتحانات في نفس المرحلة/الصف/الفصل
    const filters = {
      stage: currentData.stage,
      grade: currentData.grade,
      semester: currentData.semester
    };
    const allExams = await getExams({ ...filters, limit: 100 });
    
    // ترتيب حسب order
    allExams.sort((a, b) => a.order - b.order);
    const currentIndex = allExams.findIndex(e => e.id === parsedExamId);
    
    let swapExam = null;
    if (direction === 'up' && currentIndex > 0) {
      swapExam = allExams[currentIndex - 1];
    } else if (direction === 'down' && currentIndex < allExams.length - 1) {
      swapExam = allExams[currentIndex + 1];
    }
    
    if (!swapExam) return false; // لا يمكن التحرك
    
    // تبديل قيم order
    const batch = writeBatch(db);
    
    // تحديث الامتحان الحالي
    const currentRef = currentDoc.ref;
    batch.update(currentRef, { order: swapExam.order, updated_at: serverTimestamp() });
    
    // تحديث الامتحان الآخر
    const swapQuery = query(examsRef, where('id', '==', swapExam.id), where('type', '==', 'exam'));
    const swapSnapshot = await getDocs(swapQuery);
    if (!swapSnapshot.empty) {
      batch.update(swapSnapshot.docs[0].ref, { order: currentOrder, updated_at: serverTimestamp() });
    }
    
    await batch.commit();
    console.log(`✅ Exam ${examId} moved ${direction}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to move exam:', error.message);
    throw error;
  }
}

// ===== دوال التعليقات =====
async function addComment(commentData) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const commentsRef = collection(db, COLLECTIONS.COMMENTS);
    const userId = safeParseInt(commentData.userId);
    const lessonId = commentData.lessonId ? safeParseInt(commentData.lessonId) : null;
    const parentId = commentData.parentId ? safeParseInt(commentData.parentId) : null;

    let userTypeAr = 'طالب';
    if (commentData.userType === 'teacher') userTypeAr = 'معلم';
    if (commentData.userType === 'moderator') userTypeAr = 'مشرف';
    // تم حذف parent و developer

    const newComment = {
      id: generateUniqueId(),
      user_id: userId,
      full_name: commentData.fullName || '',
      user_type: userTypeAr,
      lesson_id: lessonId,
      comment: commentData.comment,
      date: serverTimestamp(),
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
      parent_id: parentId,
      likes: 0,
      dislikes: 0,
      replies_count: 0,
      is_deleted: false,
      liked_by: [],
      disliked_by: []
    };

    await addDoc(commentsRef, newComment);

    if (userId) await incrementUserCommentsCount(userId);
    if (lessonId) await incrementLessonCommentsCount(lessonId);

    console.log(`✅ Comment added with ID: ${newComment.id}`);
    return newComment.id;
  } catch (error) {
    console.error('❌ Failed to add comment:', error.message);
    throw error;
  }
}

/**
 * جلب التعليقات مع دعم التقسيم (pagination)
 * @param {number} limit - عدد التعليقات المطلوبة
 * @param {number|null} lessonId - معرف الدرس (اختياري)
 * @param {DocumentSnapshot|null} startAfterDoc - نقطة البداية (اختياري)
 * @returns {Promise<Object|Array>} - إذا كان startAfterDoc معرفاً نعيد { comments, lastDoc, hasMore }، وإلا نعيد مصفوفة للتوافق القديم
 */
async function getComments(limit = 10, lessonId = null, startAfterDoc = null) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const commentsRef = collection(db, COLLECTIONS.COMMENTS);

    // ==== بناء الاستعلام حسب نوع التعليقات المطلوبة ====
    // ملاحظة: Firestore لا يدعم where('field', '==', null) بشكل موثوق
    // لذا نستخدم فلتر parent_id بطريقة مختلفة
    let constraints = [
      where('is_deleted', '==', false),
    ];

    // فلترة حسب الدرس
    if (lessonId !== null && lessonId !== undefined) {
      // تعليقات درس محدد — الردود لها parent_id فلن تظهر في الاستعلام الرئيسي
      constraints.push(where('lesson_id', '==', safeParseInt(lessonId)));
    }
    // للتعليقات العامة (home): لا نضيف فلتر lesson_id
    // سنفلتر parent_id بعد جلب البيانات (client-side) لتجنب مشاكل Firestore مع null

    constraints.push(orderBy('date', 'desc'));
    constraints.push(firestoreLimit((limit + 1) * 3)); // نجلب أكثر لتعويض الفلترة

    if (startAfterDoc) {
      constraints.push(startAfter(startAfterDoc));
    }

    const q = query(commentsRef, ...constraints);
    const querySnapshot = await getDocs(q);

    // ==== فلترة التعليقات الأساسية (بدون parent) من جانب العميل ====
    const allDocs = querySnapshot.docs;
    const rootDocs = allDocs.filter(doc => {
      const data = doc.data();
      // التعليق أساسي إذا لم يكن له parent_id أو كان null أو 0
      return !data.parent_id || data.parent_id === null || data.parent_id === 0;
    });

    const comments = [];
    let lastDoc = null;
    let hasMore = false;

    const targetDocs = rootDocs.length > limit
      ? (hasMore = true, rootDocs.slice(0, limit))
      : rootDocs;

    for (const doc of targetDocs) {
      comments.push(await enrichCommentWithUserData(doc));
    }

    if (targetDocs.length > 0) {
      lastDoc = targetDocs[targetDocs.length - 1];
    }

    return { comments, lastDoc, hasMore };
  } catch (error) {
    console.error('❌ Failed to get comments:', error.message);
    return { comments: [], lastDoc: null, hasMore: false };
  }
}

/**
 * دالة مساعدة لتكملة بيانات التعليق بمعلومات المستخدم (لتجنب تكرار الكود)
 */
async function enrichCommentWithUserData(doc) {
  const data = doc.data();
  const userId = data.user_id;
  let userExtra = { avatar_url: '', gender: 'male', user_type: 'student', total_score: 0, avatar_job_index: 0, is_verified: false };
  
  if (userId) {
    const usersRef = collection(getDb(), COLLECTIONS.USERS);
    const userQuery = query(usersRef, where('id', '==', userId));
    const userSnap = await getDocs(userQuery);
    if (!userSnap.empty) {
      const userData = userSnap.docs[0].data();
      userExtra = {
        avatar_url: userData.avatar_url || '',
        gender: userData.gender || 'male',
        user_type: userData.user_type || 'student',
        total_score: userData.total_score || 0,
        avatar_job_index: userData.avatar_job_index ?? 0,
        is_verified: userData.is_verified || false
      };
    }
  }
  
  return {
    docId: doc.id,
    id: data.id,
    user_id: data.user_id,
    full_name: data.full_name,
    user_type: data.user_type,
    lesson_id: data.lesson_id,
    comment: data.comment,
    date: data.date,
    parent_id: data.parent_id,
    likes: data.likes || 0,
    dislikes: data.dislikes || 0,
    replies_count: data.replies_count || 0,
    is_deleted: data.is_deleted || false,
    liked_by: data.liked_by || [],
    disliked_by: data.disliked_by || [],
    avatar_url: userExtra.avatar_url,
    gender: userExtra.gender,
    commenter_user_type: userExtra.user_type,
    commenter_total_score: userExtra.total_score,
    commenter_avatar_job_index: userExtra.avatar_job_index,
    commenter_is_verified: userExtra.is_verified,
    pinned: data.pinned || false
  };
}

// ==== الحصول على ردود تعليق مع دعم Pagination (startAfter) ====
async function getCommentReplies(commentId, limit = 5, startAfterDoc = null) {
  await ensureApiInitialized();
  const db = getDb();
  const parsedCommentId = safeParseInt(commentId);

  try {
    const commentsRef = collection(db, COLLECTIONS.COMMENTS);
    let constraints = [
      where('parent_id', '==', parsedCommentId),
      where('is_deleted', '==', false),
      orderBy('date', 'desc'),
      firestoreLimit(limit)
    ];
    
    if (startAfterDoc) {
      constraints.push(startAfter(startAfterDoc));
    }
    
    const q = query(commentsRef, ...constraints);
    const querySnapshot = await getDocs(q);
    const lastDoc = querySnapshot.docs[querySnapshot.docs.length - 1] || null;
    
    // ==== استخدم enrichCommentWithUserData لجلب بيانات المستخدم الكاملة (مثل getComments) ====
    const replies = [];
    for (const doc of querySnapshot.docs) {
      const enriched = await enrichCommentWithUserData(doc);
      replies.push(enriched);
    }
    
    return { replies, lastDoc, hasMore: replies.length === limit };
  } catch (error) {
    console.error('❌ Failed to get comment replies:', error.message);
    return { replies: [], lastDoc: null, hasMore: false };
  }
}

async function toggleCommentLike(commentId, userId) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const parsedCommentId = safeParseInt(commentId);
    const parsedUserId = safeParseInt(userId);

    const usersRef = collection(db, COLLECTIONS.USERS);
    const userQuery = query(usersRef, where('id', '==', parsedUserId));
    const userSnap = await getDocs(userQuery);
    if (userSnap.empty) throw new Error('المستخدم غير موجود');
    const userRef = userSnap.docs[0].ref;

    const commentsRef = collection(db, COLLECTIONS.COMMENTS);
    const commentQuery = query(commentsRef, where('id', '==', parsedCommentId));
    const commentSnap = await getDocs(commentQuery);
    if (commentSnap.empty) throw new Error('التعليق غير موجود');
    const commentRef = commentSnap.docs[0].ref;

    await runTransaction(db, async (transaction) => {
      const commentDoc = await transaction.get(commentRef);
      if (!commentDoc.exists) throw new Error('التعليق غير موجود');

      const likedBy = commentDoc.data().liked_by || [];
      const dislikedBy = commentDoc.data().disliked_by || [];

      let likesDelta = 0;
      let dislikesDelta = 0;
      let userLikesDelta = 0;

      if (likedBy.includes(parsedUserId)) {
        transaction.update(commentRef, {
          liked_by: arrayRemove(parsedUserId),
          likes: increment(-1)
        });
        likesDelta = -1;
        userLikesDelta = -1;
      } else if (dislikedBy.includes(parsedUserId)) {
        transaction.update(commentRef, {
          liked_by: arrayUnion(parsedUserId),
          disliked_by: arrayRemove(parsedUserId),
          likes: increment(1),
          dislikes: increment(-1)
        });
        likesDelta = 1;
        dislikesDelta = -1;
        userLikesDelta = 1;
      } else {
        transaction.update(commentRef, {
          liked_by: arrayUnion(parsedUserId),
          likes: increment(1)
        });
        likesDelta = 1;
        userLikesDelta = 1;
      }

      if (userLikesDelta !== 0) {
        transaction.update(userRef, {
          likes_given: increment(userLikesDelta),
          last_activity: serverTimestamp()
        });
      }
    });

    return true;
  } catch (error) {
    console.error('❌ Failed to toggle comment like:', error.message);
    throw error;
  }
}

async function toggleCommentDislike(commentId, userId) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const parsedCommentId = safeParseInt(commentId);
    const parsedUserId = safeParseInt(userId);

    const usersRef = collection(db, COLLECTIONS.USERS);
    const userQuery = query(usersRef, where('id', '==', parsedUserId));
    const userSnap = await getDocs(userQuery);
    if (userSnap.empty) throw new Error('المستخدم غير موجود');
    const userRef = userSnap.docs[0].ref;

    const commentsRef = collection(db, COLLECTIONS.COMMENTS);
    const commentQuery = query(commentsRef, where('id', '==', parsedCommentId));
    const commentSnap = await getDocs(commentQuery);
    if (commentSnap.empty) throw new Error('التعليق غير موجود');
    const commentRef = commentSnap.docs[0].ref;

    await runTransaction(db, async (transaction) => {
      const commentDoc = await transaction.get(commentRef);
      if (!commentDoc.exists) throw new Error('التعليق غير موجود');

      const likedBy = commentDoc.data().liked_by || [];
      const dislikedBy = commentDoc.data().disliked_by || [];

      let likesDelta = 0;
      let dislikesDelta = 0;
      let userLikesDelta = 0;

      if (dislikedBy.includes(parsedUserId)) {
        transaction.update(commentRef, {
          disliked_by: arrayRemove(parsedUserId),
          dislikes: increment(-1)
        });
        dislikesDelta = -1;
      } else if (likedBy.includes(parsedUserId)) {
        transaction.update(commentRef, {
          disliked_by: arrayUnion(parsedUserId),
          liked_by: arrayRemove(parsedUserId),
          dislikes: increment(1),
          likes: increment(-1)
        });
        dislikesDelta = 1;
        likesDelta = -1;
        userLikesDelta = -1;
      } else {
        transaction.update(commentRef, {
          disliked_by: arrayUnion(parsedUserId),
          dislikes: increment(1)
        });
        dislikesDelta = 1;
      }

      if (likesDelta !== 0) transaction.update(commentRef, { likes: increment(likesDelta) });
      if (dislikesDelta !== 0) transaction.update(commentRef, { dislikes: increment(dislikesDelta) });

      if (userLikesDelta !== 0) {
        transaction.update(userRef, {
          likes_given: increment(userLikesDelta),
          last_activity: serverTimestamp()
        });
      }
    });

    return true;
  } catch (error) {
    console.error('❌ Failed to toggle comment dislike:', error.message);
    throw error;
  }
}

async function softDeleteComment(commentId) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const parsedCommentId = safeParseInt(commentId);

    const commentsRef = collection(db, COLLECTIONS.COMMENTS);
    const commentQuery = query(commentsRef, where('id', '==', parsedCommentId));
    const commentSnap = await getDocs(commentQuery);
    if (commentSnap.empty) throw new Error('التعليق غير موجود');

    const commentDoc = commentSnap.docs[0];
    const commentData = commentDoc.data();
    const commentRef = commentDoc.ref;
    const userId = commentData.user_id;
    const lessonId = commentData.lesson_id;

    let userRef = null, lessonRef = null;
    if (userId) {
      const userQuery = query(collection(db, COLLECTIONS.USERS), where('id', '==', userId));
      const userSnap = await getDocs(userQuery);
      if (!userSnap.empty) userRef = userSnap.docs[0].ref;
    }
    if (lessonId) {
      const lessonQuery = query(collection(db, COLLECTIONS.LESSONS), where('id', '==', lessonId));
      const lessonSnap = await getDocs(lessonQuery);
      if (!lessonSnap.empty) lessonRef = lessonSnap.docs[0].ref;
    }

    await runTransaction(db, async (transaction) => {
      transaction.update(commentRef, { is_deleted: true });

      if (userRef) {
        transaction.update(userRef, {
          comments_count: increment(-1),
          last_activity: serverTimestamp()
        });
      }

      if (lessonRef) {
        transaction.update(lessonRef, {
          comments_count: increment(-1)
        });
      }
    });

    return true;
  } catch (error) {
    console.error('❌ Failed to soft delete comment:', error.message);
    throw error;
  }
}


   // ===== دوال إدارة التعليقات المتقدمة =====
/**
 * تحديث نص تعليق موجود
 * @param {number} commentId 
 * @param {string} newText 
 * @returns {Promise<boolean>}
 */
async function updateComment(commentId, newText) {
  await ensureApiInitialized();
  const db = getDb();
  const parsedId = safeParseInt(commentId);

  try {
    const commentsRef = collection(db, COLLECTIONS.COMMENTS);
    const q = query(commentsRef, where('id', '==', parsedId));
    const snapshot = await getDocs(q);
    if (snapshot.empty) throw new Error('التعليق غير موجود');

    const commentRef = snapshot.docs[0].ref;
    await updateDoc(commentRef, {
      comment: newText,
      updated_at: serverTimestamp()
    });
    console.log(`✅ Comment ${commentId} updated`);
    return true;
  } catch (error) {
    console.error('❌ Failed to update comment:', error.message);
    throw error;
  }
}

/**
 * تثبيت / إلغاء تثبيت تعليق (للمعلم والمشرف فقط)
 * @param {number} commentId 
 * @param {boolean} pinned 
 */
async function pinComment(commentId, pinned) {
  await ensureApiInitialized();
  const db = getDb();
  const parsedId = safeParseInt(commentId);

  try {
    const commentsRef = collection(db, COLLECTIONS.COMMENTS);
    const q = query(commentsRef, where('id', '==', parsedId));
    const snapshot = await getDocs(q);
    if (snapshot.empty) throw new Error('التعليق غير موجود');

    const commentRef = snapshot.docs[0].ref;
    await updateDoc(commentRef, { pinned: pinned, updated_at: serverTimestamp() });
    console.log(`✅ Comment ${commentId} pinned = ${pinned}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to pin comment:', error.message);
    throw error;
  }
}
/**
 * 🛠️ إضافة شهادة/توصية (تعليق عام) – استخدام نوع المستخدم الحقيقي (طالب، معلم، مشرف)
 */
async function addTestimonial(commentData) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const currentUser = getCurrentUser();  // ✅ استخدام المصدر الرسمي
    if (!currentUser) {
      throw new Error('يجب تسجيل الدخول لإضافة تعليق');
    }

    const userTypeArabic = translateUserType(currentUser.user_type);

    const newComment = {
      id: generateUniqueId(),
      user_id: safeParseInt(currentUser.id),
      full_name: currentUser.full_name || currentUser.username,
      user_type: userTypeArabic,
      lesson_id: null,
      comment: commentData.comment,
      date: serverTimestamp(),
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
      parent_id: null,
      likes: 0,
      dislikes: 0,
      replies_count: 0,
      is_deleted: false,
      liked_by: [],
      disliked_by: []
    };

    const commentsRef = collection(db, COLLECTIONS.COMMENTS);
    await addDoc(commentsRef, newComment);
    console.log(`✅ Testimonial added with ID: ${newComment.id}`);
    return newComment.id;
  } catch (error) {
    console.error('❌ Failed to add testimonial:', error.message);
    throw error;
  }
}

// ===== دوال الإشعارات (لا تحتوي على parent أو developer) =====
async function createNotification(userId, {
  title,
  message,
  type = 'info',
  related_exam,
  related_lesson,
  related_id,
  sender = 'system'
}) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const notification = {
      id: generateUniqueId(),
      user_id: safeParseInt(userId),
      title: title || '',
      message: message || '',
      type: type,
      read: false,
      created_at: serverTimestamp(),
      sender: sender
    };

    if (related_exam !== undefined) notification.related_exam = safeParseInt(related_exam);
    if (related_lesson !== undefined) notification.related_lesson = safeParseInt(related_lesson);
    if (related_id !== undefined) notification.related_id = related_id;

    const notificationsRef = collection(db, COLLECTIONS.NOTIFICATIONS);
    await addDoc(notificationsRef, notification);
    console.log(`✅ Notification created for user ${userId}, ID: ${notification.id}`);
    return notification.id;
  } catch (error) {
    console.error('❌ Failed to create notification:', error.message);
    throw error;
  }
}

async function getUserNotifications(userId) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const notificationsRef = collection(db, COLLECTIONS.NOTIFICATIONS);
    const q = query(
      notificationsRef,
      where('user_id', '==', safeParseInt(userId)),
      orderBy('created_at', 'desc'),
      firestoreLimit(50)
    );

    const querySnapshot = await getDocs(q);
    const notifications = [];

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      notifications.push({
        docId: doc.id,
        id: data.id,
        user_id: data.user_id,
        title: data.title,
        message: data.message,
        read: data.read || false,
        type: data.type || 'info',
        created_at: data.created_at,
        sender: data.sender || 'system',
        related_lesson: data.related_lesson || 0,
        related_exam: data.related_exam || 0,
        related_id: data.related_id || null
      });
    });
    return notifications;
  } catch (error) {
    console.error('❌ Failed to get notifications:', error.message);
    throw error;
  }
}

async function sendNotification(notificationData) {
  return createNotification(
    notificationData.userId,
    {
      title: notificationData.title,
      message: notificationData.message,
      type: notificationData.type || 'info',
      related_exam: notificationData.relatedExam,
      related_lesson: notificationData.relatedLesson,
      related_id: notificationData.relatedId,
      sender: notificationData.sender || 'system'
    }
  );
}

async function sendBulkNotifications(userIds, notificationData) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const batch = writeBatch(db);
    const notificationsRef = collection(db, COLLECTIONS.NOTIFICATIONS);

    userIds.forEach(userId => {
      const newNotification = {
        id: generateUniqueId(),
        user_id: safeParseInt(userId),
        title: notificationData.title || '',
        message: notificationData.message || '',
        type: notificationData.type || 'info',
        read: false,
        created_at: serverTimestamp(),
        sender: notificationData.sender || 'system'
      };

      if (notificationData.relatedLesson !== undefined) {
        newNotification.related_lesson = safeParseInt(notificationData.relatedLesson);
      }
      if (notificationData.relatedExam !== undefined) {
        newNotification.related_exam = safeParseInt(notificationData.relatedExam);
      }
      if (notificationData.relatedId !== undefined) {
        newNotification.related_id = notificationData.relatedId;
      }

      const docRef = doc(notificationsRef);
      batch.set(docRef, newNotification);
    });

    await batch.commit();
    console.log(`✅ Bulk notifications sent to ${userIds.length} users`);
    return true;
  } catch (error) {
    console.error('❌ Failed to send bulk notifications:', error.message);
    throw error;
  }
}

async function markNotificationRead(notificationDocId) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const notifRef = doc(db, COLLECTIONS.NOTIFICATIONS, notificationDocId);
    await updateDoc(notifRef, { read: true });
    return true;
  } catch (error) {
    console.error('❌ Failed to mark notification as read:', error.message);
    throw error;
  }
}

async function deleteNotification(notificationDocId) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const notifRef = doc(db, COLLECTIONS.NOTIFICATIONS, notificationDocId);
    await deleteDoc(notifRef);
    return true;
  } catch (error) {
    console.error('❌ Failed to delete notification:', error.message);
    throw error;
  }
}

async function clearAllUserNotifications(userId) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const notificationsRef = collection(db, COLLECTIONS.NOTIFICATIONS);
    const q = query(notificationsRef, where('user_id', '==', safeParseInt(userId)));
    const snapshot = await getDocs(q);

    const batch = writeBatch(db);
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    return true;
  } catch (error) {
    console.error('❌ Failed to clear notifications:', error.message);
    throw error;
  }
}

// ===== دوال التقييمات والإحصائيات (لا تحتوي على parent أو developer) =====
async function getTopStudents(count = 5) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const usersRef = collection(db, COLLECTIONS.USERS);
    const q = query(
      usersRef,
      where('user_type', '==', 'student'),
      where('total_score', '>', 0),
      orderBy('total_score', 'desc'),
      firestoreLimit(count)
    );

    const querySnapshot = await getDocs(q);
    const topStudents = [];

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      topStudents.push({
        id: data.id,
        docId: doc.id,
        username: data.username,
        full_name: data.full_name,
        gender: data.gender,
        total_score: data.total_score || 0,
        likes_given: data.likes_given || 0,
        comments_count: data.comments_count || 0,
        avatar_url: data.avatar_url || ''
      });
    });
    return topStudents;
  } catch (error) {
    console.error('❌ Failed to get top students:', error.message);
    throw error;
  }
}

async function getPlatformStats() {
  await ensureApiInitialized();
  const db = getDb();

  try {
    // ==== جلب عدد الطلاب فقط ====
    const studentsQuery = query(collection(db, COLLECTIONS.USERS), where('user_type', '==', 'student'));
    const studentsSnapshot = await getDocs(studentsQuery);
    const studentsCount = studentsSnapshot.size;

    // ==== جلب عدد المعلمين فقط ====
    const teachersQuery = query(collection(db, COLLECTIONS.USERS), where('user_type', '==', 'teacher'));
    const teachersSnapshot = await getDocs(teachersQuery);
    const teachersCount = teachersSnapshot.size;

    // ==== جلب الدروس ====
    const lessonsQuery = query(collection(db, COLLECTIONS.LESSONS));
    const lessonsSnapshot = await getDocs(lessonsQuery);

    // ==== جلب الامتحانات (من quizzes) ====
    const examsQuery = query(collection(db, COLLECTIONS.QUIZZES));
    const examsSnapshot = await getDocs(examsQuery);
    const examIds = new Set();

    examsSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.exam_id) examIds.add(data.exam_id);
    });

    // ==== جلب نتائج الامتحانات ====
    const resultsQuery = query(collection(db, COLLECTIONS.EXAM_RESULTS));
    const resultsSnapshot = await getDocs(resultsQuery);

    // ==== جلب التعليقات ====
    const commentsQuery = query(collection(db, COLLECTIONS.COMMENTS));
    const commentsSnapshot = await getDocs(commentsQuery);

    return {
      students: studentsCount,
      teachers: teachersCount,
      lessons: lessonsSnapshot.size,
      exams: examIds.size,
      exam_results: resultsSnapshot.size,
      comments: commentsSnapshot.size
    };
  } catch (error) {
    console.error('❌ Failed to get platform stats:', error.message);
    return {
      students: 0,
      teachers: 0,
      lessons: 0,
      exams: 0,
      exam_results: 0,
      comments: 0
    };
  }
}

// ===== دوال مساعدة إضافية (معدلة: إزالة parent و developer) =====
function convertUserType(userType, toEnglish = true) {
  if (toEnglish) {
    switch (userType) {
      case 'طالب': return 'student';
      case 'معلم': return 'teacher';
      case 'مشرف': return 'moderator';
      default: return userType;
    }
  } else {
    switch (userType) {
      case 'student': return 'طالب';
      case 'teacher': return 'معلم';
      case 'moderator': return 'مشرف';
      default: return userType;
    }
  }
}

async function checkDatabaseCompatibility() {
  await ensureApiInitialized();
  const db = getDb();

  try {
    console.log('🔍 فحص توافق API مع قاعدة البيانات...');
    const collections = Object.values(COLLECTIONS);
    const results = {};

    for (const collectionName of collections) {
      const ref = collection(db, collectionName);
      const snapshot = await getDocs(query(ref, firestoreLimit(1)));
      results[collectionName] = {
        exists: !snapshot.empty,
        count: snapshot.size
      };
    }
    console.log('📊 نتائج الفحص:', results);
    return results;
  } catch (error) {
    console.error('❌ فشل فحص التوافق:', error.message);
    return null;
  }
}

// ===== إعدادات الفصل الدراسي الظاهر للطلاب (semester_settings) =====
// هذا هو المصدر الوحيد للحقيقة بخصوص "إيه اللي بيشوفه الطالب دلوقتي"، منفصل تمامًا
// عن سياق تصفح المعلم في صفحة الدروس.
const DEFAULT_ACTIVE_SEMESTER = 'أول';
let semesterSettingsCache = null;
let semesterSettingsCacheAt = 0;

/**
 * جلب كل إعدادات الفصل الدراسي (لكل مرحلة×صف) مع كاش بسيط (تتغير نادرًا)
 */
async function getSemesterSettings(forceRefresh = false) {
  await ensureApiInitialized();
  const db = getDb();

  if (!forceRefresh && semesterSettingsCache && (Date.now() - semesterSettingsCacheAt) < CACHE_TTL.LONG) {
    return semesterSettingsCache;
  }

  try {
    const snapshot = await getDocs(collection(db, COLLECTIONS.SEMESTER_SETTINGS));
    const settings = [];
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      settings.push({
        docId: docSnap.id,
        stage: data.stage,
        grade: data.grade,
        active_semester: data.active_semester || DEFAULT_ACTIVE_SEMESTER,
        updated_by: data.updated_by || null,
        updated_at: data.updated_at || null
      });
    });
    semesterSettingsCache = settings;
    semesterSettingsCacheAt = Date.now();
    return settings;
  } catch (error) {
    console.error('❌ Failed to get semester settings:', error.message);
    // في حال فشل الشبكة، أفضل نرجع آخر كاش معروف بدل ما نكسر الصفحة بالكامل
    return semesterSettingsCache || [];
  }
}

/**
 * الفصل الدراسي الحي لصف معيّن — مع قيمة افتراضية آمنة ("أول") لو لسه معملوش إعداد له
 */
async function getActiveSemesterFor(stage, grade) {
  const normalizedStage = normalizeStageValue(stage);
  if (!normalizedStage || grade === undefined || grade === null) return DEFAULT_ACTIVE_SEMESTER;
  const normalizedGrade = safeParseInt(grade);

  const settings = await getSemesterSettings();
  const match = settings.find(s => s.stage === normalizedStage && safeParseInt(s.grade) === normalizedGrade);
  return match?.active_semester || DEFAULT_ACTIVE_SEMESTER;
}

/**
 * تحديد الفصل الدراسي الظاهر للطلاب لصف معيّن (المعلم فقط ينفّذها من لوحة التحكم المستقلة)
 * يسجّل من غيّر الإعداد وإمتى (audit مبسّط داخل نفس المستند)
 */
async function setActiveSemester(stage, grade, semester, teacherId) {
  await ensureApiInitialized();
  const db = getDb();

  const normalizedStage = normalizeStageValue(stage);
  const normalizedSemester = normalizeSemesterValue(semester);
  if (!normalizedStage || grade === undefined || grade === null || !normalizedSemester) {
    throw new Error('بيانات غير مكتملة لتحديد الفصل الدراسي النشط');
  }
  const normalizedGrade = safeParseInt(grade);

  try {
    const docId = `${normalizedStage}_${normalizedGrade}`;
    const settingRef = doc(db, COLLECTIONS.SEMESTER_SETTINGS, docId);

    await setDoc(settingRef, {
      stage: normalizedStage,
      grade: normalizedGrade,
      active_semester: normalizedSemester,
      updated_by: teacherId || null,
      updated_at: serverTimestamp()
    }, { merge: true });

    // إبطال الكاش فورًا عشان أي قراءة تالية تجيب القيمة الجديدة
    semesterSettingsCache = null;

    // بث الحدث عشان أي صفحة مفتوحة (لوحة الدروس مثلاً) تقدر تتفاعل فورًا
    EventBus.emit('semester:active-changed', {
      stage: normalizedStage,
      grade: normalizedGrade,
      semester: normalizedSemester,
      teacherId: teacherId || null
    });

    return true;
  } catch (error) {
    console.error('❌ Failed to set active semester:', error.message);
    throw error;
  }
}

async function getUnits(options = {}) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const { stage, grade, semester } = options;
    const unitsRef = collection(db, COLLECTIONS.UNITS);
    let constraints = [];

    if (stage) {
      constraints.push(where('stage', '==', stage));
    }
    if (grade !== undefined) {
      constraints.push(where('grade', '==', safeParseInt(grade)));
    }
    if (semester) {
      constraints.push(where('semester', '==', semester));
    }

    constraints.push(orderBy('order', 'asc'));
    constraints.push(orderBy('name', 'asc'));

    const q = query(unitsRef, ...constraints);
    const snapshot = await getDocs(q);
    const units = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      units.push({
        id: data.id,
        docId: doc.id,
        name: data.name,
        stage: data.stage,
        grade: data.grade,
        semester: data.semester,
        order: data.order || 0,
        description: data.description || '',
        lessons_count: data.lessons_count || 0,
        exams_count: data.exams_count || 0,
        created_at: data.created_at
      });
    });

    return units;
  } catch (error) {
    console.error('❌ Failed to get units:', error.message);
    throw error;
  }
}

/**
 * إنشاء وحدة جديدة
 * @param {Object} unitData - { name, stage, grade, semester, order, description }
 */
async function createUnit(unitData) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const unitId = generateUniqueId();
    const newUnit = {
      id: unitId,
      name: unitData.name,
      stage: unitData.stage,
      grade: safeParseInt(unitData.grade),
      semester: unitData.semester,
      order: safeParseInt(unitData.order, 0),
      description: unitData.description || '',
      lessons_count: 0,
      exams_count: 0,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp()
    };

    const unitsRef = collection(db, COLLECTIONS.UNITS);
    await addDoc(unitsRef, newUnit);
    console.log(`✅ Unit created with ID: ${unitId}`);
    return unitId;
  } catch (error) {
    console.error('❌ Failed to create unit:', error.message);
    throw error;
  }
}

/**
 * تحديث وحدة موجودة
 */
async function updateUnit(unitId, unitData) {
  await ensureApiInitialized();
  const db = getDb();
  const parsedUnitId = safeParseInt(unitId);

  try {
    const unitsRef = collection(db, COLLECTIONS.UNITS);
    const q = query(unitsRef, where('id', '==', parsedUnitId));
    const snapshot = await getDocs(q);
    if (snapshot.empty) throw new Error('الوحدة غير موجودة');

    const docRef = snapshot.docs[0].ref;
    const updates = {
      name: unitData.name,
      stage: unitData.stage,
      grade: safeParseInt(unitData.grade),
      semester: unitData.semester,
      order: safeParseInt(unitData.order, 0),
      description: unitData.description || '',
      updated_at: serverTimestamp()
    };

    await updateDoc(docRef, updates);
    console.log(`✅ Unit ${unitId} updated`);
    return true;
  } catch (error) {
    console.error('❌ Failed to update unit:', error.message);
    throw error;
  }
}

/**
 * حذف وحدة (لا يمكن حذفها إذا كان هناك دروس مرتبطة)
 */
async function deleteUnit(unitId) {
  await ensureApiInitialized();
  const db = getDb();
  const parsedUnitId = safeParseInt(unitId);

  try {
    // التحقق من وجود دروس مرتبطة
    const lessonsRef = collection(db, COLLECTIONS.LESSONS);
    const lessonsQuery = query(lessonsRef, where('unit_id', '==', parsedUnitId), where('type', '!=', 'exam'));
    const lessonsSnapshot = await getDocs(lessonsQuery);
    if (!lessonsSnapshot.empty) {
      throw new Error('لا يمكن حذف الوحدة لوجود دروس مرتبطة بها');
    }

    const unitsRef = collection(db, COLLECTIONS.UNITS);
    const q = query(unitsRef, where('id', '==', parsedUnitId));
    const snapshot = await getDocs(q);
    if (snapshot.empty) throw new Error('الوحدة غير موجودة');

    await deleteDoc(snapshot.docs[0].ref);
    console.log(`✅ Unit ${unitId} deleted`);
    return true;
  } catch (error) {
    console.error('❌ Failed to delete unit:', error.message);
    throw error;
  }
}

// ===== دوال إدارة الدروس (إنشاء، تعديل، حذف، تحريك) =====

/**
 * إنشاء درس جديد
 * @param {Object} lessonData - بيانات الدرس
 */
async function createLesson(lessonData) {
  await ensureApiInitialized();
  const db = getDb();

  try {
    const lessonId = generateUniqueId();
    const newLesson = {
      id: lessonId,
      type: 'lesson',
      stage: lessonData.stage,
      grade: safeParseInt(lessonData.grade),
      semester: lessonData.semester,
      unit_id: lessonData.unit_id ? safeParseInt(lessonData.unit_id) : null,
      title: lessonData.title,
      description: lessonData.description || '',
      video_url: lessonData.video_url,
      pdf_url: lessonData.pdf_url || '',
      cover_image_url: lessonData.cover_image_url || '',
      duration: safeParseInt(lessonData.duration, 0),
      comments_count: 0,
      likes: 0,
      liked_by: [],
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
      order: lessonData.order || 0,
      
      
      deleted_at: null
    };

    const lessonsRef = collection(db, COLLECTIONS.LESSONS);
    await addDoc(lessonsRef, newLesson);

    // تحديث عدد الدروس في الوحدة
    if (newLesson.unit_id) {
      await incrementUnitLessonsCount(newLesson.unit_id, 1);
    }

    console.log(`✅ Lesson created with ID: ${lessonId}`);
    return lessonId;
  } catch (error) {
    console.error('❌ Failed to create lesson:', error.message);
    throw error;
  }
}

/**
 * تحديث درس موجود
 */
async function updateLesson(lessonId, lessonData) {
  await ensureApiInitialized();
  const db = getDb();
  const parsedLessonId = safeParseInt(lessonId);

  try {
    const lessonsRef = collection(db, COLLECTIONS.LESSONS);
    const q = query(lessonsRef, where('id', '==', parsedLessonId), where('type', '==', 'lesson'));
    const snapshot = await getDocs(q);
    if (snapshot.empty) throw new Error('الدرس غير موجود');

    const docRef = snapshot.docs[0].ref;
    const oldData = snapshot.docs[0].data();
    const oldUnitId = oldData.unit_id;

    const updates = {
      stage: lessonData.stage,
      grade: safeParseInt(lessonData.grade),
      semester: lessonData.semester,
      unit_id: lessonData.unit_id ? safeParseInt(lessonData.unit_id) : null,
      title: lessonData.title,
      description: lessonData.description || '',
      video_url: lessonData.video_url,
      pdf_url: lessonData.pdf_url || '',
      cover_image_url: lessonData.cover_image_url || '',
      duration: safeParseInt(lessonData.duration, 0),
      
      updated_at: serverTimestamp()
    };

    await updateDoc(docRef, updates);

    // تحديث عدد الدروس في الوحدات إذا تغيرت الوحدة
    if (oldUnitId !== updates.unit_id) {
      if (oldUnitId) await incrementUnitLessonsCount(oldUnitId, -1);
      if (updates.unit_id) await incrementUnitLessonsCount(updates.unit_id, 1);
    }

    console.log(`✅ Lesson ${lessonId} updated`);
    return true;
  } catch (error) {
    console.error('❌ Failed to update lesson:', error.message);
    throw error;
  }
}

/**
 * حذف درس (soft delete)
 */
async function deleteLesson(lessonId, softDelete = true) {
  await ensureApiInitialized();
  const db = getDb();
  const parsedLessonId = safeParseInt(lessonId);

  try {
    const lessonsRef = collection(db, COLLECTIONS.LESSONS);
    const q = query(lessonsRef, where('id', '==', parsedLessonId), where('type', '==', 'lesson'));
    const snapshot = await getDocs(q);
    if (snapshot.empty) throw new Error('الدرس غير موجود');

    const docRef = snapshot.docs[0].ref;
    const lessonData = snapshot.docs[0].data();

    if (softDelete) {
      await updateDoc(docRef, {
        deleted_at: serverTimestamp(),
        updated_at: serverTimestamp()
      });
    } else {
      await deleteDoc(docRef);
    }

    // تقليل عدد الدروس في الوحدة
    if (lessonData.unit_id) {
      await incrementUnitLessonsCount(lessonData.unit_id, -1);
    }

    console.log(`✅ Lesson ${lessonId} ${softDelete ? 'moved to trash' : 'deleted'}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to delete lesson:', error.message);
    throw error;
  }
}

/**
 * جلب بيانات درس كاملة (للتعديل)
 */
async function getLessonFullData(lessonId) {
  await ensureApiInitialized();
  const db = getDb();
  const parsedLessonId = safeParseInt(lessonId);

  try {
    const lessonsRef = collection(db, COLLECTIONS.LESSONS);
    const q = query(lessonsRef, where('id', '==', parsedLessonId), where('type', '==', 'lesson'));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;

    const data = snapshot.docs[0].data();
    return {
      title: data.title,
      stage: data.stage,
      grade: data.grade,
      semester: data.semester,
      unit_id: data.unit_id,
      video_url: data.video_url,
      pdf_url: data.pdf_url || '',
      cover_image_url: data.cover_image_url || '',
      description: data.description || '',
      
      
      duration: data.duration || 0
    };
  } catch (error) {
    console.error('❌ Failed to get lesson full data:', error.message);
    throw error;
  }
}

/**
 * تصدير درس كامل (بيانات + أسئلة الامتحان المرتبط إن وُجد) بصيغة قابلة لإعادة الاستيراد
 */
async function exportLesson(lessonId) {
  try {
    const lesson = await getLessonFullData(lessonId);
    if (!lesson) throw new Error('الدرس غير موجود');

    let questions = [];
    try {
      const exam = await getExamByLessonId(lessonId);
      if (exam?.id) {
        const fullExam = await getExamFullData(exam.id);
        questions = fullExam?.questions || [];
      }
    } catch (_) { /* لا يوجد امتحان مرتبط بالدرس */ }

    return {
      meta: { ...lesson, exported_at: new Date().toISOString() },
      questions
    };
  } catch (error) {
    console.error('❌ Failed to export lesson:', error.message);
    throw error;
  }
}

/**
 * استيراد درس من كائن بنفس بنية exportLesson، وإنشاء امتحان مرتبط إن وُجدت أسئلة
 * @returns {Promise<number>} معرف الدرس الجديد
 */
async function importLesson(lessonData) {
  try {
    const meta = lessonData?.meta;
    if (!meta?.title) throw new Error('بيانات الدرس غير صالحة');

    const newLessonId = await createLesson({
      title: meta.title,
      description: meta.description || '',
      stage: meta.stage,
      grade: meta.grade,
      semester: meta.semester,
      unit_id: meta.unit_id || null,
      video_url: meta.video_url || '',
      pdf_url: meta.pdf_url || '',
      cover_image_url: meta.cover_image_url || '',
      duration: meta.duration || 0
    });

    const questions = Array.isArray(lessonData?.questions) ? lessonData.questions : [];
    if (questions.length > 0) {
      await createExam({
        lesson_id: newLessonId,
        title: `امتحان: ${meta.title}`,
        stage: meta.stage,
        grade: meta.grade,
        semester: meta.semester,
        duration: 10
      }, questions);
    }

    return newLessonId;
  } catch (error) {
    console.error('❌ Failed to import lesson:', error.message);
    throw error;
  }
}

/**
 * إحصائيات الدرس: عدد المكتملين، متوسط الدرجات، متوسط التقييم
 */
async function getLessonStats(lessonId) {
  await ensureApiInitialized();
  const db = getDb();
  const parsedLessonId = safeParseInt(lessonId);

  try {
    const progressRef = collection(db, COLLECTIONS.USER_PROGRESS);
    const progressQuery = query(
      progressRef,
      where('lesson_id', '==', parsedLessonId),
      where('completed', '==', true)
    );
    const progressSnapshot = await getDocs(progressQuery);
    const completedCount = progressSnapshot.size;

    let averageScore = 0;
    const exam = await getExamByLessonId(parsedLessonId);
    if (exam?.id) {
      const resultsRef = collection(db, COLLECTIONS.EXAM_RESULTS);
      const resultsQuery = query(resultsRef, where('exam_id', '==', safeParseInt(exam.id)));
      const resultsSnapshot = await getDocs(resultsQuery);
      if (!resultsSnapshot.empty) {
        let totalScore = 0;
        resultsSnapshot.forEach(doc => { totalScore += (doc.data().score || 0); });
        averageScore = Math.round(totalScore / resultsSnapshot.size);
      }
    }

    const lessonsRef = collection(db, COLLECTIONS.LESSONS);
    const lessonQuery = query(lessonsRef, where('id', '==', parsedLessonId), where('type', '==', 'lesson'));
    const lessonSnapshot = await getDocs(lessonQuery);
    let averageRating = 0;
    if (!lessonSnapshot.empty) {
      averageRating = lessonSnapshot.docs[0].data().average_rating || 0;
    }

    return { completedCount, averageScore, averageRating, totalStudents: completedCount };
  } catch (error) {
    console.error('❌ Failed to get lesson stats:', error.message);
    return { completedCount: 0, averageScore: 0, averageRating: 0, totalStudents: 0 };
  }
}

/**
 * تحريك درس (تغيير ترتيبه ضمن الوحدة)
 */
async function moveLesson(lessonId, direction) {
  await ensureApiInitialized();
  const db = getDb();
  const parsedLessonId = safeParseInt(lessonId);

  try {
    const lessonsRef = collection(db, COLLECTIONS.LESSONS);
    const currentQuery = query(lessonsRef, where('id', '==', parsedLessonId), where('type', '==', 'lesson'));
    const currentSnapshot = await getDocs(currentQuery);
    if (currentSnapshot.empty) throw new Error('الدرس غير موجود');

    const currentDoc = currentSnapshot.docs[0];
    const currentData = currentDoc.data();
const currentOrder = currentData.order !== undefined ? currentData.order : 0;
const unitId = currentData.unit_id;

// إذا لم يكن الدرس تابعاً لوحدة، لا يمكن تحريكه (لأن الترتيب يكون عاماً)
if (!unitId) {
  console.warn(`⚠️ لا يمكن تحريك درس بدون وحدة: ${lessonId}`);
  return false;
}

// جلب الدروس في نفس الوحدة
const allLessonsQuery = query(
  lessonsRef,
  where('type', '==', 'lesson'),
  where('unit_id', '==', unitId),
  where('deleted_at', '==', null),
  orderBy('order', 'asc')
);
    const allSnapshot = await getDocs(allLessonsQuery);
    const lessons = [];
    allSnapshot.forEach(doc => lessons.push({ id: doc.data().id, order: doc.data().order || 0, ref: doc.ref }));

    lessons.sort((a, b) => a.order - b.order);
    const currentIndex = lessons.findIndex(l => l.id === parsedLessonId);

    let swapLesson = null;
    if (direction === 'up' && currentIndex > 0) {
      swapLesson = lessons[currentIndex - 1];
    } else if (direction === 'down' && currentIndex < lessons.length - 1) {
      swapLesson = lessons[currentIndex + 1];
    }

    if (!swapLesson) return false;

    const batch = writeBatch(db);
    batch.update(currentDoc.ref, { order: swapLesson.order, updated_at: serverTimestamp() });
    batch.update(swapLesson.ref, { order: currentOrder, updated_at: serverTimestamp() });
    await batch.commit();

    console.log(`✅ Lesson ${lessonId} moved ${direction}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to move lesson:', error.message);
    throw error;
  }
}

// ===== دوال مساعدة داخلية =====

async function incrementUnitLessonsCount(unitId, delta) {
  const db = getDb();
  const unitsRef = collection(db, COLLECTIONS.UNITS);
  const q = query(unitsRef, where('id', '==', safeParseInt(unitId)));
  const snapshot = await getDocs(q);
  if (!snapshot.empty) {
    const docRef = snapshot.docs[0].ref;
    await updateDoc(docRef, {
      lessons_count: increment(delta),
      updated_at: serverTimestamp()
    });
  }
}

/**
 *  تحديث عدد امتحانات الوحدة (مرآة لـ incrementUnitLessonsCount أعلاه)
 * @param {number} unitId
 * @param {number} delta - +1 عند الإضافة/الاسترجاع، -1 عند الحذف
 */
async function incrementUnitExamsCount(unitId, delta) {
  const db = getDb();
  const unitsRef = collection(db, COLLECTIONS.UNITS);
  const q = query(unitsRef, where('id', '==', safeParseInt(unitId)));
  const snapshot = await getDocs(q);
  if (!snapshot.empty) {
    const docRef = snapshot.docs[0].ref;
    await updateDoc(docRef, {
      exams_count: increment(delta),
      updated_at: serverTimestamp()
    });
  }
}

// ===== دوال إحصائيات المستخدم (للطلاب) =====

/**
 * جلب إحصائيات امتحانات المستخدم
 */
async function getUserExamStats(userId) {
  await ensureApiInitialized();
  const db = getDb();
  const parsedUserId = safeParseInt(userId);

  try {
    // ==== قراءة نتائج الامتحانات الفعلية من Biologist_ExamResults ====
    const resultsRef = collection(db, COLLECTIONS.EXAM_RESULTS);
    const resultsQuery = query(resultsRef, where('user_id', '==', parsedUserId));
    const resultsSnapshot = await getDocs(resultsQuery);

    const completedExams = resultsSnapshot.size;
    let totalScore = 0;
    resultsSnapshot.forEach(doc => {
      const data = doc.data();
      totalScore += safeParseInt(data.score, 0);
    });

    const averageScore = completedExams > 0 ? Math.round(totalScore / completedExams) : 0;

    return { totalExams: completedExams, completedExams, averageScore };
  } catch (error) {
    console.error('❌ Failed to get user exam stats:', error.message);
    return { totalExams: 0, completedExams: 0, averageScore: 0 };
  }
}

/**
 *  جلب نتائج امتحانات الطالب مفهرسة بمعرف الامتحان (exam_id)
 * تُستخدم لتحديد أي الامتحانات "مكتملة" في تبويب "المكتملة" بصفحة الامتحانات،
 * تماماً كما تُستخدم getUserProgress لتحديد الدروس المكتملة.
 * @param {number} userId
 * @returns {Promise<Object>} خريطة { [exam_id]: { score, passed, time_taken, created_at } }
 */
async function getUserExamResultsMap(userId) {
  await ensureApiInitialized();
  const db = getDb();
  const parsedUserId = safeParseInt(userId);

  try {
    const resultsRef = collection(db, COLLECTIONS.EXAM_RESULTS);
    const q = query(resultsRef, where('user_id', '==', parsedUserId));
    const snapshot = await getDocs(q);

    const map = {};
    snapshot.forEach(doc => {
      const data = doc.data();
      const examId = data.exam_id;
      const existing = map[examId];
      // لو الطالب أعاد الامتحان أكثر من مرة، نحتفظ بأحدث/أفضل نتيجة (الأعلى درجة)
      if (!existing || safeParseInt(data.score, 0) > safeParseInt(existing.score, 0)) {
        map[examId] = {
          score: data.score || 0,
          passed: data.passed || false,
          time_taken: data.time_taken || 0,
          created_at: data.created_at
        };
      }
    });
    return map;
  } catch (error) {
    console.error('❌ Failed to get user exam results map:', error.message);
    return {};
  }
}

// ===== دوال إدارة كلمة المرور وحذف الحساب =====
/**
 * تحديث كلمة مرور المستخدم (مع التحقق من القديمة)
 * @param {number} userId - معرف المستخدم
 * @param {string} currentPassword - كلمة المرور الحالية (نصية)
 * @param {string} newPassword - كلمة المرور الجديدة (نصية)
 */
async function updateUserPassword(userId, currentPassword, newPassword) {
  await ensureApiInitialized();
  const db = getDb();
  const parsedUserId = safeParseInt(userId);

  // جلب المستخدم
  const usersRef = collection(db, COLLECTIONS.USERS);
  const q = query(usersRef, where('id', '==', parsedUserId));
  const snapshot = await getDocs(q);
  if (snapshot.empty) throw new Error('المستخدم غير موجود');

  const userDoc = snapshot.docs[0];
  const userData = userDoc.data();
  const storedHash = userData.password;

  // التحقق من كلمة المرور الحالية
  const hashedCurrent = await hashPassword(currentPassword);
  if (storedHash !== hashedCurrent) {
    throw new Error('كلمة المرور الحالية غير صحيحة');
  }

  // تشفير الجديدة وحفظها
  const hashedNew = await hashPassword(newPassword);
  await updateDoc(userDoc.ref, { password: hashedNew, updated_at: serverTimestamp() });
  return true;
}

/**
 * حذف حساب المستخدم بشكل نهائي (مع كل البيانات المرتبطة)
 * @param {number} userId 
 */
async function deleteUserAccount(userId) {
  await ensureApiInitialized();
  const db = getDb();
  const parsedUserId = safeParseInt(userId);

  // 1. جلب المستخدم
  const usersRef = collection(db, COLLECTIONS.USERS);
  const q = query(usersRef, where('id', '==', parsedUserId));
  const snapshot = await getDocs(q);
  if (snapshot.empty) throw new Error('المستخدم غير موجود');
  const userDocRef = snapshot.docs[0].ref;

  // 2. حذف جميع البيانات المرتبطة (يمكن تنفيذها في Batch)
  const batch = writeBatch(db);

  // حذف نتائج الامتحانات
  const resultsRef = collection(db, COLLECTIONS.EXAM_RESULTS);
  const resultsQuery = query(resultsRef, where('user_id', '==', parsedUserId));
  const resultsSnap = await getDocs(resultsQuery);
  resultsSnap.forEach(doc => batch.delete(doc.ref));

  // حذف تقدم المستخدم
  const progressRef = collection(db, COLLECTIONS.USER_PROGRESS);
  const progressQuery = query(progressRef, where('user_id', '==', parsedUserId));
  const progressSnap = await getDocs(progressQuery);
  progressSnap.forEach(doc => batch.delete(doc.ref));

  // حذف التعليقات
  const commentsRef = collection(db, COLLECTIONS.COMMENTS);
  const commentsQuery = query(commentsRef, where('user_id', '==', parsedUserId));
  const commentsSnap = await getDocs(commentsQuery);
  commentsSnap.forEach(doc => batch.delete(doc.ref));

  // حذف الإشعارات
  const notifRef = collection(db, COLLECTIONS.NOTIFICATIONS);
  const notifQuery = query(notifRef, where('user_id', '==', parsedUserId));
  const notifSnap = await getDocs(notifQuery);
  notifSnap.forEach(doc => batch.delete(doc.ref));

  // حذف المستخدم نفسه
  batch.delete(userDocRef);

  await batch.commit();
  console.log(`✅ تم حذف الحساب ${parsedUserId} وجميع بياناته`);
  return true;
}

// ========== دوال إدارة المشرفين والمهملات والطلاب (بدون parent) ==========

async function getModeratorsList() {
  await ensureApiInitialized();
  const db = getDb();
  const usersRef = collection(db, COLLECTIONS.USERS);
  const q = query(usersRef, where('user_type', 'in', ['moderator', 'teacher']));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: data.id,
      docId: doc.id,
      full_name: data.full_name,
      phone: data.phone,
      level: data.user_type === 'teacher' ? 'senior' : (data.moderator_level || 'normal'),
      avatar_url: data.avatar_url
    };
  });
}

async function updateModeratorLevel(userId, level) {
  await ensureApiInitialized();
  const db = getDb();
  const usersRef = collection(db, COLLECTIONS.USERS);
  const q = query(usersRef, where('id', '==', safeParseInt(userId)));
  const snapshot = await getDocs(q);
  if (snapshot.empty) throw new Error('المستخدم غير موجود');
  const docRef = snapshot.docs[0].ref;
  const updates = level === 'senior' ? { user_type: 'teacher', moderator_level: 'senior' } : { user_type: 'moderator', moderator_level: 'normal' };
  await updateDoc(docRef, updates);
}

async function deleteModerator(userId) {
  await ensureApiInitialized();
  const db = getDb();
  const usersRef = collection(db, COLLECTIONS.USERS);
  const q = query(usersRef, where('id', '==', safeParseInt(userId)));
  const snapshot = await getDocs(q);
  if (snapshot.empty) throw new Error('المستخدم غير موجود');
  const docRef = snapshot.docs[0].ref;
  await updateDoc(docRef, { user_type: 'student' });
}

async function getTrashItems(type) {
  await ensureApiInitialized();
  const db = getDb();
  const items = [];
  if (type === 'lessons') {
    const lessonsRef = collection(db, COLLECTIONS.LESSONS);
    const q = query(lessonsRef, where('type', '==', 'lesson'), where('deleted_at', '!=', null));
    const snapshot = await getDocs(q);
    snapshot.forEach(doc => {
      const data = doc.data();
      items.push({ id: data.id, docId: doc.id, type: 'lesson', name: data.title, deleted_at: data.deleted_at });
    });
  } else if (type === 'exams') {
    const examsRef = collection(db, COLLECTIONS.LESSONS);
    const q = query(examsRef, where('type', '==', 'exam'), where('deleted_at', '!=', null));
    const snapshot = await getDocs(q);
    snapshot.forEach(doc => {
      const data = doc.data();
      items.push({ id: data.id, docId: doc.id, type: 'exam', name: data.title, deleted_at: data.deleted_at });
    });
  } else if (type === 'comments') {
    const commentsRef = collection(db, COLLECTIONS.COMMENTS);
    const q = query(commentsRef, where('is_deleted', '==', true));
    const snapshot = await getDocs(q);
    snapshot.forEach(doc => {
      const data = doc.data();
      items.push({ id: data.id, docId: doc.id, type: 'comment', name: `تعليق من ${data.full_name}`, deleted_at: data.updated_at || data.created_at });
    });
  }
  return items;
}

async function restoreTrashItem(type, id) {
  await ensureApiInitialized();
  const db = getDb();
  const parsedId = safeParseInt(id);
  if (type === 'lesson' || type === 'exam') {
    const lessonsRef = collection(db, COLLECTIONS.LESSONS);
    const q = query(lessonsRef, where('id', '==', parsedId));
    const snapshot = await getDocs(q);
    if (snapshot.empty) throw new Error('العنصر غير موجود');
    const docRef = snapshot.docs[0].ref;
    await updateDoc(docRef, { deleted_at: null, updated_at: serverTimestamp() });

    // 🛠️ إصلاح: امتحان الوحدة اللي بيترجع من المهملات لازم يرجع يتحسب في عداد الوحدة
    // (تناظرًا مع خصمه في deleteExam وقت النقل للمهملات)
    if (type === 'exam') {
      const examUnitId = snapshot.docs[0].data().unit_id ?? null;
      if (examUnitId) {
        try { await incrementUnitExamsCount(examUnitId, 1); }
        catch (countError) { console.error('⚠️ فشل تحديث عداد امتحانات الوحدة عند الاسترجاع:', countError.message); }
      }
    }
  } else if (type === 'comment') {
    const commentsRef = collection(db, COLLECTIONS.COMMENTS);
    const q = query(commentsRef, where('id', '==', parsedId));
    const snapshot = await getDocs(q);
    if (snapshot.empty) throw new Error('التعليق غير موجود');
    const docRef = snapshot.docs[0].ref;
    await updateDoc(docRef, { is_deleted: false, updated_at: serverTimestamp() });
  }
}

async function permanentlyDeleteTrashItem(type, id) {
  await ensureApiInitialized();
  const db = getDb();
  const parsedId = safeParseInt(id);
  if (type === 'lesson' || type === 'exam') {
    const lessonsRef = collection(db, COLLECTIONS.LESSONS);
    const q = query(lessonsRef, where('id', '==', parsedId));
    const snapshot = await getDocs(q);
    if (snapshot.empty) throw new Error('العنصر غير موجود');
    const docRef = snapshot.docs[0].ref;
    await deleteDoc(docRef);
    if (type === 'exam') {
      const quizzesRef = collection(db, COLLECTIONS.QUIZZES);
      const qq = query(quizzesRef, where('exam_id', '==', parsedId));
      const quizzesSnap = await getDocs(qq);
      const batch = writeBatch(db);
      quizzesSnap.forEach(qDoc => batch.delete(qDoc.ref));
      await batch.commit();
    }
  } else if (type === 'comment') {
    const commentsRef = collection(db, COLLECTIONS.COMMENTS);
    const q = query(commentsRef, where('id', '==', parsedId));
    const snapshot = await getDocs(q);
    if (snapshot.empty) throw new Error('التعليق غير موجود');
    const docRef = snapshot.docs[0].ref;
    await deleteDoc(docRef);
  }
}

async function getAllStudents() {
  await ensureApiInitialized();
  const db = getDb();
  const usersRef = collection(db, COLLECTIONS.USERS);
  const q = query(usersRef, where('user_type', '==', 'student'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: data.id,
      docId: doc.id,
      full_name: data.full_name,
      stage: data.stage,
      grade: data.grade,
      total_score: data.total_score || 0,
      phone: data.phone,
      email: data.email,
      avatar_url: data.avatar_url
    };
  });
}

async function updateStudentAccount(studentId, data) {
  await ensureApiInitialized();
  const db = getDb();
  const usersRef = collection(db, COLLECTIONS.USERS);
  const q = query(usersRef, where('id', '==', safeParseInt(studentId)));
  const snapshot = await getDocs(q);
  if (snapshot.empty) throw new Error('الطالب غير موجود');
  const docRef = snapshot.docs[0].ref;
  const updates = { last_activity: serverTimestamp() };
  if (data.full_name !== undefined) updates.full_name = data.full_name;
  if (data.stage !== undefined) updates.stage = data.stage;
  if (data.grade !== undefined) updates.grade = safeParseInt(data.grade);
  if (data.email !== undefined) updates.email = data.email;
  if (data.phone !== undefined) updates.phone = data.phone;
  await updateDoc(docRef, updates);
}

// ===== تم حذف دالة getAllParents بالكامل =====

async function addModerator(userId) {
  await ensureApiInitialized();
  const db = getDb();
  const usersRef = collection(db, COLLECTIONS.USERS);
  const q = query(usersRef, where('id', '==', safeParseInt(userId)));
  const snapshot = await getDocs(q);
  if (snapshot.empty) throw new Error('المستخدم غير موجود');
  const docRef = snapshot.docs[0].ref;
  await updateDoc(docRef, { user_type: 'moderator', moderator_level: 'normal' });
}

// ==========  دوال الشكاوى (إكمال 1.2) ==========
// مجموعة Firestore مخصصة (COLLECTIONS.COMPLAINTS) بدل الحل المؤقت القديم
// الذي كان يفلتر التعليقات بحقل is_complaint غير موثّق في أي مكان.

/**
 * جلب قائمة الشكاوى (لمعلم فقط من dashboard.js)
 * @param {{status?: string, limitCount?: number}} options - status: 'pending'|'resolved'|'closed'، أو بدونها لكل الحالات
 */
async function getComplaints({ status = null, limitCount = 50 } = {}) {
  await ensureApiInitialized();
  const db = getDb();
  try {
    const complaintsRef = collection(db, COLLECTIONS.COMPLAINTS);
    const constraints = [];
    if (status && status !== 'all') {
      constraints.push(where('status', '==', status));
    }
    constraints.push(orderBy('date', 'desc'));
    constraints.push(firestoreLimit(limitCount));

    const q = query(complaintsRef, ...constraints);
    const snapshot = await getDocs(q);
    return snapshot.docs.map(docSnap => {
      const data = docSnap.data();
      return {
        id: data.id,
        docId: docSnap.id,
        user_id: data.user_id,
        full_name: data.full_name || '',
        comment: data.comment || '',
        status: data.status || 'pending',
        date: data.date,
        reply: data.reply || null,
        replied_at: data.replied_at || null
      };
    });
  } catch (error) {
    console.error('❌ Failed to get complaints:', error.message);
    return [];
  }
}

/**
 * عدد الشكاوى "قيد المعالجة" فقط — تُستخدم في مؤشرات لوحة المعلم (مثل home.js)
 */
async function getPendingComplaintsCount() {
  await ensureApiInitialized();
  const db = getDb();
  try {
    const complaintsRef = collection(db, COLLECTIONS.COMPLAINTS);
    const q = query(complaintsRef, where('status', '==', 'pending'));
    const snapshot = await getDocs(q);
    return snapshot.size;
  } catch (error) {
    console.error('❌ Failed to count pending complaints:', error.message);
    return 0;
  }
}

/**
 * إنشاء شكوى جديدة (الجانب المُرسِل — الطالب).
 * 🟡 ملاحظة: لا توجد حاليًا أي واجهة طالب لإرسال شكوى ضمن الملفات المتاحة لي،
 * فهذه الدالة جاهزة للاستخدام لاحقًا عند بناء تلك الواجهة (خارج نطاق هذا الإصلاح).
 */
async function createComplaint({ userId, fullName, comment }) {
  await ensureApiInitialized();
  const db = getDb();
  try {
    const complaintsRef = collection(db, COLLECTIONS.COMPLAINTS);
    const newComplaint = {
      id: generateUniqueId(),
      user_id: safeParseInt(userId),
      full_name: fullName || '',
      comment: comment || '',
      status: 'pending',
      date: serverTimestamp(),
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
      reply: null,
      replied_at: null
    };
    await addDoc(complaintsRef, newComplaint);
    console.log(`✅ Complaint created with ID: ${newComplaint.id}`);
    return newComplaint.id;
  } catch (error) {
    console.error('❌ Failed to create complaint:', error.message);
    throw error;
  }
}

/**
 * تغيير حالة شكوى (تم الرد / مغلقة) — تُستخدم من أزرار "تم الرد" و"إغلاق" في dashboard.js
 */
async function updateComplaintStatus(complaintId, status) {
  await ensureApiInitialized();
  const db = getDb();
  const parsedId = safeParseInt(complaintId);
  const complaintsRef = collection(db, COLLECTIONS.COMPLAINTS);
  const q = query(complaintsRef, where('id', '==', parsedId));
  const snapshot = await getDocs(q);
  if (snapshot.empty) throw new Error('الشكوى غير موجودة');
  const docRef = snapshot.docs[0].ref;
  await updateDoc(docRef, { status, updated_at: serverTimestamp() });
}

/**
 * حفظ رد المعلم على شكوى (يضبط الحالة تلقائيًا على 'resolved')
 */
async function replyToComplaint(complaintId, reply) {
  await ensureApiInitialized();
  const db = getDb();
  const parsedId = safeParseInt(complaintId);
  const complaintsRef = collection(db, COLLECTIONS.COMPLAINTS);
  const q = query(complaintsRef, where('id', '==', parsedId));
  const snapshot = await getDocs(q);
  if (snapshot.empty) throw new Error('الشكوى غير موجودة');
  const docRef = snapshot.docs[0].ref;
  await updateDoc(docRef, {
    reply,
    status: 'resolved',
    replied_at: serverTimestamp(),
    updated_at: serverTimestamp()
  });
}

// ==========  دوال إحصائيات رسوم لوحة التحكم (إكمال 1.4) ==========
// بديل حقيقي عن Math.random() والبيانات الثابتة القديمة في dashboard.js.

/**
 * نشاط آخر 7 أيام: عدد محاولات الامتحانات + التعليقات لكل يوم (بيانات حقيقية من Firestore)
 * @returns {Promise<Array<{key: string, label: string, count: number}>>}
 */
async function getWeeklyActivityStats() {
  await ensureApiInitialized();
  const db = getDb();
  try {
    const now = new Date();
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      days.push({ key: d.toISOString().slice(0, 10), label: WEEKDAY_LABELS_AR[d.getDay()], count: 0 });
    }
    const dayIndex = new Map(days.map(d => [d.key, d]));

    const tally = (docData) => {
      const ts = docData.date || docData.created_at;
      if (!ts || typeof ts.toDate !== 'function') return;
      const key = ts.toDate().toISOString().slice(0, 10);
      const bucket = dayIndex.get(key);
      if (bucket) bucket.count++;
    };

    // نجلب آخر 300 من كل مصدر (بنفس أسلوب الجلب-ثم-الفلترة المستخدم في بقية الملف، مثل getComments)
    const resultsQuery = query(collection(db, COLLECTIONS.EXAM_RESULTS), orderBy('date', 'desc'), firestoreLimit(300));
    const resultsSnap = await getDocs(resultsQuery);
    resultsSnap.forEach(docSnap => tally(docSnap.data()));

    const commentsQuery = query(collection(db, COLLECTIONS.COMMENTS), orderBy('date', 'desc'), firestoreLimit(300));
    const commentsSnap = await getDocs(commentsQuery);
    commentsSnap.forEach(docSnap => tally(docSnap.data()));

    return days;
  } catch (error) {
    console.error('❌ Failed to get weekly activity stats:', error.message);
    return [];
  }
}

/**
 * متوسط أداء الطلاب لأكثر الامتحانات تكرارًا (بيانات حقيقية من Exam_Results)
 * @param {number} limitCount - عدد الامتحانات المعروضة في الرسم (افتراضيًا 6)
 * @returns {Promise<Array<{examId: number, title: string, averageAccuracy: number, attempts: number}>>}
 */
async function getExamPerformanceStats(limitCount = 6) {
  await ensureApiInitialized();
  const db = getDb();
  try {
    const resultsQuery = query(collection(db, COLLECTIONS.EXAM_RESULTS), orderBy('date', 'desc'), firestoreLimit(300));
    const resultsSnap = await getDocs(resultsQuery);

    const byExam = new Map(); // exam_id -> { totalAccuracy, attempts }
    resultsSnap.forEach(docSnap => {
      const data = docSnap.data();
      const examId = data.exam_id;
      if (examId === undefined || examId === null) return;
      const total = safeParseInt(data.total_questions, 0);
      const accuracy = typeof data.accuracy === 'number'
        ? data.accuracy
        : (total > 0 ? (safeParseInt(data.correct_answers, 0) / total) * 100 : 0);
      const entry = byExam.get(examId) || { totalAccuracy: 0, attempts: 0 };
      entry.totalAccuracy += accuracy;
      entry.attempts += 1;
      byExam.set(examId, entry);
    });

    const ranked = Array.from(byExam.entries())
      .map(([examId, entry]) => ({
        examId,
        attempts: entry.attempts,
        averageAccuracy: Math.round(entry.totalAccuracy / entry.attempts)
      }))
      .sort((a, b) => b.attempts - a.attempts)
      .slice(0, limitCount);

    if (ranked.length === 0) return [];

    // جلب عناوين الامتحانات دفعة واحدة (الامتحانات مخزّنة في LESSONS بـ type='exam')
    const examIds = ranked.map(r => r.examId);
    const titlesMap = new Map();
    const titlesQuery = query(collection(db, COLLECTIONS.LESSONS), where('id', 'in', examIds));
    const titlesSnap = await getDocs(titlesQuery);
    titlesSnap.forEach(docSnap => {
      const data = docSnap.data();
      titlesMap.set(data.id, data.title);
    });

    return ranked.map(r => ({
      examId: r.examId,
      title: titlesMap.get(r.examId) || `امتحان #${r.examId}`,
      averageAccuracy: r.averageAccuracy,
      attempts: r.attempts
    }));
  } catch (error) {
    console.error('❌ Failed to get exam performance stats:', error.message);
    return [];
  }
}

// ===== دالة تحديث الـ Streak في Firestore =====
async function updateUserStreak(userId, streakCount) {
  await ensureApiInitialized();
  const db = getDb();
  const parsedUserId = safeParseInt(userId);
  const newStreak = Math.max(0, safeParseInt(streakCount, 0));

  try {
    const usersRef = collection(db, COLLECTIONS.USERS);
    const q = query(usersRef, where('id', '==', parsedUserId));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      throw new Error('المستخدم غير موجود');
    }

    const docRef = querySnapshot.docs[0].ref;
    await updateDoc(docRef, {
      streak: newStreak,
      last_activity: serverTimestamp()
    });
    console.log(`✅ Updated streak for user ${parsedUserId} to ${newStreak}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to update user streak:', error.message);
    return false;
  }
}

// ===== دالة البحث برقم الهاتف عن المستخدم =====
async function getUserByPhone(phone) {
  await ensureApiInitialized();
  const db = getDb();
  const usersRef = collection(db, COLLECTIONS.USERS);
  const q = query(usersRef, where('phone', '==', phone));
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;
  const userDoc = snapshot.docs[0];
  const userData = userDoc.data();
  return {
    id: userData.id,
    full_name: userData.full_name,
    phone: userData.phone,
    user_type: userData.user_type,
    avatar_url: userData.avatar_url || ''
  };
}
// ============================================================================
// 🔍 البحث عن المستخدمين (للمعلم والمشرف فقط) — v6.1.0
// ----------------------------------------------------------------------------
// ما يدعمه الآن:
//   • رقم الهاتف: كامل أو جزء منه (بداية الرقم عبر Firestore، ونهايته/وسطه عبر المسح الاحتياطي)،
//     بأي صيغة: 010… / +2010… / 002010… / 10…  وبالأرقام العربية (٠١٠…) أيضاً
//   • المعرّف (id) تطابق تام
//   • الاسم الكامل: بداية الاسم أولاً، وإن لم يكفِ فأي كلمة داخل الاسم (اسم الأب/العائلة) بأي ترتيب
//   • مطابقة عربية متسامحة: أحمد = احمد = أَحْمَد ، فاطمة = فاطمه ، علي = على
//   • اسم المستخدم (حساس لحالة الأحرف لذلك نجرّب الصيغتين) والأسماء اللاتينية (Ahmed / ahmed)
// المسح الاحتياطي (Fallback): يُنفَّذ فقط لو الاستعلامات المباشرة رجّعت أقل من 5 نتائج، ويُحمِّل
// قائمة خفيفة بالمستخدمين مرة واحدة ويحتفظ بها في الذاكرة فقط لمدة CACHE_TTL.LONG (بدون تخزين على القرص).
// ============================================================================
const USERS_SCAN_MAX_DOCS = 5000;

function _searchToLatinDigits(str) {
  return String(str ?? '').replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (ch) => {
    const c = ch.charCodeAt(0);
    return String(c >= 0x06F0 ? c - 0x06F0 : c - 0x0660);
  });
}

/** تطبيع عربي/لاتيني للمطابقة: همزات، ياء/ألف مقصورة، تاء مربوطة، تشكيل، تطويل، حالة الأحرف */
function _searchNormalize(str) {
  return _searchToLatinDigits(str)
    .replace(/[\u064B-\u065F\u0670\u0640\u200B-\u200F\u202A-\u202E\uFEFF]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ىئ]/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ة/g, 'ه')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** رقم الهاتف بالصيغة المحلية 01xxxxxxxxx (يفهم +20 / 0020 / بدون الصفر) */
function _searchCanonicalPhone(input) {
  let d = _searchToLatinDigits(input).replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('20') && d.length >= 12) return '0' + d.slice(2);
  if (d.length === 10 && d[0] === '1') return '0' + d;
  return d;
}

/** أرقام مكتوبة في جملة البحث (قد تكون جزءاً من رقم) → صيغة محلية */
function _searchCanonicalQueryDigits(digits, hadPlus) {
  if (digits.startsWith('0020')) return '0' + digits.slice(4);
  if (digits.startsWith('20') && (hadPlus || digits.length >= 11)) return '0' + digits.slice(2);
  return digits;
}

/** كائن مستخدم خفيف للبحث — بدون كلمة المرور أو أي بيانات حساسة */
function _searchMapUser(data) {
  return {
    id: data.id,
    full_name: data.full_name || '',
    username: data.username || '',
    phone: data.phone || '',
    user_type: data.user_type || 'student',
    avatar_url: data.avatar_url || '',
    avatar_job_index: data.avatar_job_index ?? 0,
    gender: data.gender,
    is_verified: data.is_verified || false,
    stage: data.stage || '',
    grade: data.grade || ''
  };
}

/** صيغ التخزين المحتملة لبداية الرقم (بحث البادئة في Firestore حساس للصيغة) */
function _searchPhoneVariants(digits) {
  const d = _searchCanonicalQueryDigits(digits, false);
  const variants = new Set([d]);
  if (d.startsWith('0')) {
    const noZero = d.slice(1);
    if (noZero) {
      variants.add(noZero);
      variants.add('20' + noZero);
      variants.add('+20' + noZero);
      variants.add('0020' + noZero);
    }
  } else {
    variants.add('0' + d);
    variants.add('20' + d);
    variants.add('+20' + d);
  }
  return Array.from(variants);
}

/** صيغ بادئة الاسم: (أ إ آ ا) في أول حرف، (ي ى) و(ه ة) في آخر حرف، وحالة الحرف الأول للاتيني */
function _searchNameVariants(text) {
  const ALEFS = ['ا', 'أ', 'إ', 'آ'];
  const TAILS = { 'ي': 'ى', 'ى': 'ي', 'ه': 'ة', 'ة': 'ه' };
  const heads = new Set([text]);
  if (ALEFS.includes(text[0])) ALEFS.forEach(a => heads.add(a + text.slice(1)));
  if (/^[a-z]/i.test(text)) {
    heads.add(text[0].toUpperCase() + text.slice(1));
    heads.add(text[0].toLowerCase() + text.slice(1));
  }
  const out = new Set();
  heads.forEach((v) => {
    out.add(v);
    const last = v[v.length - 1];
    if (TAILS[last]) out.add(v.slice(0, -1) + TAILS[last]);
  });
  return Array.from(out).slice(0, 8);
}

/** تحليل جملة البحث إلى كلمات (نصية/رقمية) — كل الكلمات يجب أن تتطابق (AND) */
function _searchParse(text) {
  const hadPlus = text.includes('+');
  const parts = text.split(' ').filter(Boolean).map((raw) => {
    const digits = _searchToLatinDigits(raw).replace(/[-().+]/g, '');
    return { raw, digits, numeric: /^\d+$/.test(digits) };
  });
  const allNumeric = parts.length > 0 && parts.every(p => p.numeric);
  const units = allNumeric ? [{ numeric: true, digits: parts.map(p => p.digits).join('') }] : parts;

  const tokens = [];
  units.forEach((u) => {
    if (u.numeric) {
      if (u.digits.length >= 3) tokens.push({ type: 'num', raw: u.digits, value: _searchCanonicalQueryDigits(u.digits, hadPlus) });
    } else {
      const v = _searchNormalize(u.raw.replace(/^@+/, ''));
      if (v) tokens.push({ type: 'text', value: v });
    }
  });
  return { tokens, allNumeric, digits: allNumeric ? units[0].digits : '' };
}

function _searchPrepare(user) {
  if (user._n !== undefined) return user;
  user._n = _searchNormalize(user.full_name);
  user._words = user._n ? user._n.split(' ') : [];
  user._u = _searchNormalize(user.username);
  user._p = _searchCanonicalPhone(user.phone);
  user._id = user.id === undefined || user.id === null ? '' : String(user.id);
  return user;
}

/** درجة التطابق (0 = لا يتطابق). الأعلى = أدق */
function _searchScore(user, tokens) {
  _searchPrepare(user);
  let total = 0;
  for (const tok of tokens) {
    let best = 0;
    if (tok.type === 'num') {
      const p = user._p;
      if (p) {
        if (p === tok.value) best = 120;
        else if (p.startsWith(tok.value)) best = 95;
        else if (tok.value.length >= 4 && p.endsWith(tok.value)) best = 85;
        else if (p.includes(tok.value)) best = 60;
      }
      if (user._id && user._id === tok.raw) best = Math.max(best, 110);
      if (tok.raw.length >= 4 && user._u.includes(tok.raw)) best = Math.max(best, 40);
    } else {
      const t = tok.value;
      user._words.forEach((w, i) => {
        if (w === t) best = Math.max(best, i === 0 ? 100 : 90);
        else if (w.startsWith(t)) best = Math.max(best, i === 0 ? 88 : 78);
        else if (t.length >= 3 && w.includes(t)) best = Math.max(best, 40);
      });
      if (user._u) {
        if (user._u === t) best = Math.max(best, 85);
        else if (user._u.startsWith(t)) best = Math.max(best, 70);
        else if (t.length >= 2 && user._u.includes(t)) best = Math.max(best, 42);
      }
    }
    if (best === 0) return 0;
    total += best;
  }
  const whole = tokens.filter(t => t.type === 'text').map(t => t.value).join(' ');
  if (whole.length >= 2) {
    if (user._n === whole) total += 50;
    else if (user._n.startsWith(whole)) total += 25;
  }
  return total;
}

// ذاكرة مؤقتة (RAM فقط) لقائمة المستخدمين المستخدمة في المسح الاحتياطي
let _usersScanCache = { data: null, ts: 0, promise: null };

async function _getUsersForScan() {
  const cache = _usersScanCache;
  if (cache.data && (Date.now() - cache.ts) < CACHE_TTL.LONG) return cache.data;
  if (cache.promise) return cache.promise;

  cache.promise = (async () => {
    const db = getDb();
    const usersRef = collection(db, COLLECTIONS.USERS);
    const snapshot = await getDocs(query(usersRef, firestoreLimit(USERS_SCAN_MAX_DOCS)));
    const users = [];
    snapshot.forEach((d) => {
      const data = d.data();
      if (data && data.id !== undefined) users.push(_searchMapUser(data));
    });
    if (snapshot.size >= USERS_SCAN_MAX_DOCS) {
      console.warn(`⚠️ searchUsers: تم الوصول للحد الأقصى للمسح (${USERS_SCAN_MAX_DOCS}) — قد لا تظهر بعض النتائج الوسطية`);
    }
    cache.data = users;
    cache.ts = Date.now();
    return users;
  })().finally(() => { cache.promise = null; });

  return cache.promise;
}

/**
 * البحث عن المستخدمين (للمعلم والمشرف فقط)
 * @param {string} searchQuery - نص البحث (اسم، اسم مستخدم، رقم هاتف كامل/جزئي، معرّف)
 * @param {number|Object} optionsOrLimit - رقم = الحد الأقصى (افتراضي 20)، أو { limit, throwOnError }
 *        throwOnError=true → ترمي الأخطاء الحقيقية (تستعملها الواجهة لعرض "حدث خطأ" بدل "لا نتائج")
 *        الافتراضي false → تعيد [] للتوافق مع أي استدعاء قديم
 * @returns {Promise<Array>} قائمة المستخدمين مرتبة حسب الصلة (الأدق أولاً)
 */
async function searchUsers(searchQuery, optionsOrLimit = 20) {
  // ⚠️ ممنوع تسمية أي باراميتر هنا "query" — يحجب دالة Firestore query() المستوردة (سبب عطل قديم).
  await ensureApiInitialized();

  const opts = typeof optionsOrLimit === 'number' ? { limit: optionsOrLimit } : (optionsOrLimit || {});
  const limit = Math.min(Math.max(safeParseInt(opts.limit, 20), 1), 50);
  const throwOnError = !!opts.throwOnError;

  const text = _searchToLatinDigits(searchQuery).replace(/\s+/g, ' ').trim().replace(/^@+\s*/, '');
  if (text.length < 2) return [];

  if (!(isTeacher() || isModerator())) {
    console.warn('⚠️ searchUsers: البحث متاح للمعلم والمشرف فقط');
    if (throwOnError) throw new Error('غير مصرّح بالبحث');
    return [];
  }

  const parsed = _searchParse(text);
  if (!parsed.tokens.length) return [];

  try {
    const db = getDb();
    const usersRef = collection(db, COLLECTIONS.USERS);
    const prefixQuery = (field, prefix) => query(
      usersRef,
      where(field, '>=', prefix),
      where(field, '<=', prefix + '\uf8ff'),
      firestoreLimit(limit)
    );

    // ---- 1) استعلامات Firestore المباشرة (سريعة، بادئة فقط) ----
    const queries = [];
    if (parsed.allNumeric) {
      _searchPhoneVariants(parsed.digits).forEach(v => queries.push(prefixQuery('phone', v)));
      if (parsed.digits.length >= 5 && parsed.digits.length <= 12) {
        queries.push(query(usersRef, where('id', '==', safeParseInt(parsed.digits)), firestoreLimit(5)));
      }
    } else {
      const words = text.split(' ').filter(Boolean);
      const nameKeys = new Set(_searchNameVariants(text));
      if (words.length > 1) _searchNameVariants(words[0]).forEach(v => nameKeys.add(v));
      nameKeys.forEach(v => queries.push(prefixQuery('full_name', v)));

      const uname = words[0];
      new Set([uname, uname.toLowerCase()]).forEach(v => queries.push(prefixQuery('username', v)));
    }

    const found = new Map(); // id → user (لتجنب التكرار)
    let fulfilled = 0;
    let firstError = null;

    const settled = await Promise.allSettled(queries.map(q => getDocs(q)));
    settled.forEach((r) => {
      if (r.status === 'fulfilled') {
        fulfilled++;
        r.value.forEach((d) => {
          const data = d.data();
          if (data && data.id !== undefined && !found.has(data.id)) found.set(data.id, _searchMapUser(data));
        });
      } else if (!firstError) {
        firstError = r.reason;
      }
    });

    // كل الاستعلامات فشلت (صلاحيات/شبكة/فهرس) → خطأ حقيقي وليس "لا نتائج"
    if (queries.length && fulfilled === 0 && firstError) throw firstError;

    // ---- 2) مسح احتياطي: أي كلمة داخل الاسم / آخر أو وسط الرقم ----
    const directIds = new Set(found.keys());
    if (found.size < Math.min(limit, 5)) {
      try {
        const all = await _getUsersForScan();
        for (const u of all) {
          if (!found.has(u.id) && _searchScore(u, parsed.tokens) > 0) found.set(u.id, u);
        }
      } catch (scanErr) {
        console.warn('⚠️ searchUsers: تعذّر المسح الاحتياطي:', scanErr.message);
        if (found.size === 0 && throwOnError) throw scanErr;
      }
    }

    // ---- 3) الترتيب حسب الصلة ----
    const ranked = Array.from(found.values()).map((u) => {
      const s = _searchScore(u, parsed.tokens);
      // نتيجة رجعت من Firestore مباشرة لا تُسقَط حتى لو اختلفت قواعد التطبيع (حد أدنى 1)
      return { u, s: s > 0 ? s : (directIds.has(u.id) ? 1 : 0) };
    }).filter(x => x.s > 0);

    ranked.sort((a, b) => (b.s - a.s) || (a.u._n < b.u._n ? -1 : a.u._n > b.u._n ? 1 : 0));

    return ranked.slice(0, limit).map(({ u }) => _searchMapUser(u));
  } catch (error) {
    console.error('❌ Failed to search users:', error.message);
    if (throwOnError) throw error;
    return [];
  }
}
// ===== التصدير =====
export {
  initializeApi,

  // المستخدمين
  loginUser,
  registerUser,
  checkPhoneExists,
  getUserById,
  updateUserPreferences,
  updateUserLikesGiven,
  incrementUserCommentsCount,
  updateUserProfile,
  updateLegacyUsers,
  convertUserType,
  checkDatabaseCompatibility,

  recalculateUserTotalScore,

// الدروس
  getAllLessons,
  getLessonById,
  toggleLessonLike,
  getLessonsCount,
  searchLessons,
  rateLesson,
  exportLesson,
  importLesson,
  getLessonStats,
  
  // الامتحانات
  getExamById,
  saveExamResult,
  createExam,
  updateExam,
  deleteExam,
  getExams,
  getExamFullData,
  moveExam,
  getExamByLessonId,

  // التقدم
  updateUserProgress,
  updateUserExamScore,
  getUserProgress,
  updateUserStreak,

// المفضلة
  getUserFavorites,
  syncUserFavorites,

  // التعليقات
  addComment,
  getComments,
  getCommentReplies,
  toggleCommentLike,
  toggleCommentDislike,
  softDeleteComment,
  updateComment,
  pinComment,
  canEditComment,

  // الإشعارات
  createNotification,
  getUserNotifications,
  sendNotification,
  sendBulkNotifications,
  markNotificationRead,
  deleteNotification,
  clearAllUserNotifications,

  // أخرى
  addTestimonial,
  getTopStudents,
  getPlatformStats,
  getUserByPhone,
  searchUsers,

  //الوحدات
  getUnits,
  createUnit,
  updateUnit,
  deleteUnit,

  //الفصل الدراسي الظاهر للطلاب
  getSemesterSettings,
  getActiveSemesterFor,
  setActiveSemester,

  //إدارة الدروس
  createLesson,
  updateLesson,
  deleteLesson,
  getLessonFullData,
  moveLesson,
  
  // ... التصديرات الموجودة ...
  updateUserPassword,
  deleteUserAccount,
  
  //إحصائيات المستخدم
  getUserExamStats,
  getUserExamResultsMap,
  COLLECTIONS,
  //  دوال للوحة التحكم 
  getModeratorsList,
  updateModeratorLevel,
  deleteModerator,
  getTrashItems,
  restoreTrashItem,
  permanentlyDeleteTrashItem,
  getAllStudents,
  updateStudentAccount,
  addModerator,

  //  الشكاوى (إكمال 1.2)
  getComplaints,
  getPendingComplaintsCount,
  createComplaint,
  updateComplaintStatus,
  replyToComplaint,

  //  إحصائيات رسوم لوحة التحكم (إكمال 1.4)
  getWeeklyActivityStats,
  getExamPerformanceStats
};