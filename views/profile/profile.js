/**
 * 👤 views/profile/profile.js — نظام الملف الشخصي المتكامل v5.0.0 (Rebuild)
 * ============================================================================
 * 📝 المسؤولية:
 *    - عرض وتحديث الملف الشخصي للمستخدم (طالب / معلم / مشرف)
 *    - تفويض جميع عمليات الصورة الرمزية والإطار إلى avatar.js (النظام الموحد)
 *    - عرض الإنجازات والميداليات والنشاط الأخير والدروس المفضلة
 *    - إدارة الإعدادات الشخصية (الثيم الليلي/النهاري، الثيم اللوني، الإشعارات)
 *    - عرض لوحة إحصائيات مختصرة للمعلم/المشرف (بيانات منصة حقيقية فقط)
 *
 * 🔗 التكامل:
 *    - يستورد من: api.js / theme.js / session.js / avatar.js
 *    - يُستدعى من: router.js عبر initializePage / cleanupPage
 *    - يُطلق أحداث: avatarUpdated / profileUpdated (CustomEvent) — لتحديث أي
 *      مكوّن خارجي (navbar/drawer) يعرض صورة أو اسم المستخدم
 *    - يستهلك أحداث: userStateChanged (من session.js)
 *
 * 🛠️ إصلاحات هذه النسخة (راجع تقرير التغييرات المرفق):
 *    - تغيير كلمة المرور وحذف الحساب أصبحا يستدعيان دوال api.js الحقيقية
 *      مباشرة (كانا يعتمدان على `window.api` غير المُعرَّف إطلاقاً في المشروع،
 *      فيسقطان بصمت دون تنفيذ أي شيء فعلي).
 *    - إصلاح استدعاء الثيم اللوني: كان يُستدعى `setTheme(color)` بدلاً من
 *      `setColorTheme(color)` — ما كان يمنع عمل أزرار الثيم اللوني في الإعدادات
 *      فعلياً، ويمنع تعليم الزر النشط الصحيح (كان يقارن بـ getCurrentTheme
 *      الخاصة بالوضع الليلي/النهاري بدلاً من getCurrentColorTheme).
 *    - تفعيل بطاقة "إحصائيات التدريس" للمعلم/المشرف ببيانات منصة حقيقية فقط
 *      (بلا رقم تقييم وهمي، لعدم وجود نظام تقييم على مستوى المعلم في المخطط).
 *    - إزالة استيراد غير مُستخدَم (recalculateUserTotalScore).
 *
 * ⛔ المحذوف (يبقى كما هو من v5.0.0):
 *    - جميع دوال الأفاتار المكررة (createAvatarStructure / updateAvatarRingColorElement / إلخ)
 *    - أي إشارة لنوع المستخدم 'parent' (لا وجود له في README ولا في مخطط البيانات)
 *    - الـ Inline styles المباشرة على عناصر الأفاتار (مُحوَّلة لـ avatar.js)
 * ============================================================================
 */

// ==== استيراد طبقة API ====
import {
  getUserById,
  getUserProgress,
  updateUserPreferences,
  getUserNotifications,
  getLessonById,
  getPlatformStats,
  updateUserProfile,
  updateUserPassword,
  deleteUserAccount,
  getUserExamStats
} from '../../js/core/api.js';

// ==== استيراد نظام الثيم (الوضع الليلي/النهاري + الثيم اللوني منفصلان) ====
import {
  setTheme,
  getCurrentTheme,
  setColorTheme,
  getCurrentColorTheme,
  addThemeListener,
  removeThemeListener
} from '../../js/core/theme.js';

// ==== استيراد نظام الجلسة ====
import { setSession, clearSession } from '../../js/core/session.js';

// 🔴 إصلاح (1.1): استيراد EventBus — كان الملف يستمع عبر document.addEventListener
// بينما session.js يُصدر الحدث حصرياً عبر EventBus.emit الآن، فلم يكن الحدث يصل إطلاقاً.
import { EventBus } from '../../js/core/event-bus.js';

// ==== استيراد النظام الموحد للصور الرمزية والإطارات ====
import {
  createAvatarElement,
  updateAvatarElement,
  getFrameClass,
  shouldShowVerificationBadge,
  getAvatarConfig
} from '../../js/utils/avatar.js';


// ==== ثوابت التكوين ====
const PROFILE_CONFIG = {

  // ==== محددات العناصر ====
  SELECTORS: {
    LOADING_STATE:        '#profile-loading-state',
    GUEST_MESSAGE:        '#guest-message',
    LOGGED_CONTENT:       '#logged-user-content',
    AVATAR_RING_LEGACY:   '#avatar-ring',              // للتوافق مع profile.html القديم
    AVATAR_SPRITE_LEGACY: '#avatar-sprite',            // للتوافق مع profile.html القديم
    VERIFICATION_BADGE:   '#verification-badge',
    PROFILE_NAME:         '#profile-name',
    BADGE_TEXT:           '#badge-text',
    META_STAGE:           '#meta-stage',
    META_GRADE:           '#meta-grade',
    META_JOINED:          '#meta-joined',
    STREAK_BADGE:         '#streak-badge',
    STREAK_COUNT:         '#streak-count',
    STREAK_ACHIEVEMENT:   '#streak-achievement-count',
    STREAK_BAR_FILL:      '#streak-bar-fill',
    STREAK_CARD_NOTE:     '#streak-card-note',
    STREAK_CARD:          '#streak-achievement-card',
    STAT_ELEMENTS:        '[data-stat]',
    USER_DETAILS:         '[data-user]',
    PROGRESS_BAR_FILL:    '#progress-bar-fill',
    CHANGE_AVATAR_BTN:    '.change-avatar-btn',
    THEME_TOGGLE:         '#theme-toggle-profile',
    NOTIFICATIONS_TOGGLE: '#notifications-toggle',
    EDIT_PROFILE_BTN:     '[data-action="edit-profile"]',
    CHANGE_PASSWORD_BTN:  '[data-action="change-password"]',
    DELETE_ACCOUNT_BTN:   '[data-action="delete-account"]',
    LOGOUT_BTN:           '[data-action="logout"]',
    COLOR_THEME_BTNS:     '[data-color-theme]',
    TAB_BUTTONS:          '.tab-btn',
    TAB_CONTENTS:         '.tab-content',
    FAVORITES_GRID:       '#favorites-grid',
    FAVORITES_EMPTY:      '#favorites-empty',
    ACHIEVEMENTS_EMPTY:   '#achievements-empty',
    MEDALS_SECTION:       '#medals-section',
    MEDALS_GRID:          '#medals-grid',
    BADGES_SECTION:       '#badges-section',
    BADGES_GRID:          '#badges-grid',
    ACTIVITY_LIST:        '#activity-list',
    ACTIVITY_EMPTY:       '#activity-empty',
    PROFILE_CHART:        '#profile-chart',
    PROFILE_AVATAR_AREA:  '.profile-avatar-wrapper',
    EXPLORE_LESSONS_BTN:  '[data-action="explore-lessons"]',
    START_LEARNING_BTN:   '[data-action="start-learning"]',
    GO_HOME_BTN:          '[data-action="go-home"]',

    // ==== لوحة إحصائيات التدريس (معلم/مشرف فقط) ====
    TEACHER_STATS_CARD:      '#teacher-stats-card',
    TEACHER_STUDENTS_COUNT:  '#teacher-students-count',
    TEACHER_LESSONS_COUNT:   '#teacher-lessons-count',
    TEACHER_EXAMS_COUNT:     '#teacher-exams-count',
  },

  // ==== مسارات الميداليات ====
  MEDALS_SPRITE: 'assets/avatars/badges/medals.png',

  // ==== أبعاد Sprite الميداليات ====
  MEDAL_SPRITE_WIDTH:  1792,
  MEDAL_SPRITE_HEIGHT: 592,
  MEDAL_COUNT:         3,

  // ==== بيانات الميداليات ====
  MEDALS: {
    gold_medal:   { name: 'ذهبية',  position: 0, label: 'الميدالية الذهبية'   },
    silver_medal: { name: 'فضية',   position: 1, label: 'الميدالية الفضية'    },
    bronze_medal: { name: 'برونزية', position: 2, label: 'الميدالية البرونزية' },
  },

  // ==== أيقونات الشارات ====
  BADGE_ICONS: {
    new_user:       'fa-seedling',
    top_student:    'fa-crown',
    active_learner: 'fa-bolt',
    exam_champion:  'fa-star',
    consistent:     'fa-calendar-check',
    helper:         'fa-hands-helping',
    default:        'fa-award',
  },

  // ==== أسماء الشارات ====
  BADGE_NAMES: {
    new_user:       'طالب جديد',
    top_student:    'طالب متفوق',
    active_learner: 'متعلّم نشط',
    exam_champion:  'بطل الامتحانات',
    consistent:     'منتظم',
    helper:         'مساعد',
  },

  // ==== أنواع المستخدمين (3 أنواع فقط) ====
  USER_TYPES: {
    teacher:   'معلم',
    moderator: 'مشرف',
    student:   'طالب',
  },

  // ==== أسماء الوظائف حسب الجنس ====
  JOB_NAMES_MALE: [
    'طبيب', 'مهندس', 'مزارع', 'عالم', 'مُعلم',
    'ميكانيكي', 'ممرض', 'ضابط', 'محامٍ', 'رجل أعمال',
  ],
  JOB_NAMES_FEMALE: [
    'طبيبة', 'مهندسة', 'مزارعة', 'عالِمة', 'مُعلمة',
    'ميكانيكية', 'ممرضة', 'ضابطة', 'محامية', 'سيدة أعمال',
  ],

  // ==== حدود التقدير للطالب (متزامنة مع avatar.js) ====
  SCORE_THRESHOLDS: {
    GOLD:   400,
    SILVER: 200,
  },

  // ==== المراحل الدراسية ====
  STAGES: {
    preparatory: 'الإعدادية',
    secondary:   'الثانوية',
    إعدادي:      'الإعدادية',
    ثانوي:       'الثانوية',
  },

  // ==== الصفوف الدراسية ====
  GRADES: {
    '1': 'الأول', '2': 'الثاني', '3': 'الثالث',
    1: 'الأول',   2: 'الثاني',   3: 'الثالث',
  },

  // ==== رسائل الخطأ ====
  ERROR_MESSAGES: {
    LOAD_USER:        'تعذر تحميل بيانات الملف الشخصي',
    LOAD_STATS:       'تعذر تحميل الإحصائيات',
    LOAD_FAVORITES:   'تعذر تحميل الدروس المفضلة',
    LOAD_ACHIEVEMENTS:'تعذر تحميل الإنجازات',
    LOAD_ACTIVITY:    'تعذر تحميل النشاط الأخير',
    UPDATE_THEME:     'تعذر تحديث الثيم',
    DELETE_ACCOUNT:   'حدث خطأ أثناء حذف الحساب',
    CHANGE_PASSWORD:  'حدث خطأ أثناء تغيير كلمة المرور',
  },

  // ==== حدود العرض ====
  MAX_FAVORITES_DISPLAY: 12,
  MAX_ACTIVITY_DISPLAY:  10,
  STREAK_GOLD_THRESHOLD: 30,

  // ==== ألوان الرسم البياني (تتبع متغيرات CSS) ====
  CHART_COLORS: ['var(--primary)', 'var(--border-color-light)'],
};


// ==== الحالة الداخلية للصفحة ====
let $profileState = {
  isInitialized:    false,
  container:        null,
  currentTab:       'profile',
  userData:         null,
  userProgress:     null,
  examStats:        null,
  totalLessonsCount: 0,
  platformStats:    null,
  themeListener:    null,
  avatarElement:    null,   // مرجع لعنصر الأفاتار الموحد (من avatar.js)
  isLoading: {
    profile:      false,
    favorites:    false,
    achievements: false,
    activity:     false,
  },
};

// ==== كاش عناصر DOM ====
let $elements = {};


// ==== دوال مساعدة عامة ====

function safeToast(message, type = 'info') {
  if (window.modals?.toast) window.modals.toast(message, type);
  else console.log(`[Toast:${type}] ${message}`);
}

function safeNavigate(route, params = {}) {
  if (window.router?.navigateTo) window.router.navigateTo(route, params);
  else console.error('❌ Router غير متاح');
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(dateInput) {
  if (!dateInput) return '--';
  try {
    const date = dateInput?.toDate ? dateInput.toDate() : new Date(dateInput);
    if (isNaN(date.getTime())) return '--';
    return date.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch { return '--'; }
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return 'غير معروف';
  const timeMs = timestamp?.seconds
    ? timestamp.seconds * 1000
    : new Date(timestamp).getTime();
  if (isNaN(timeMs)) return 'غير معروف';
  const diffMins = Math.floor((Date.now() - timeMs) / 60000);
  if (diffMins < 1)  return 'الآن';
  if (diffMins < 60) return `منذ ${diffMins} دقيقة`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `منذ ${diffHours} ساعة`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7)  return `منذ ${diffDays} يوم`;
  return formatDate(new Date(timeMs));
}

// ==== تحديد نص شارة المستخدم (بدون parent) ====
function getUserBadgeText(user) {
  if (!user) return 'زائر';
  if (user.user_type === 'teacher')   return 'معلم';
  if (user.user_type === 'moderator') return 'مشرف';
  // ==== للطالب: شارة أعلى ميدالية أو لقب ====
  if (user.badges && user.badges.length > 0) {
    if (user.badges.includes('gold_medal'))   return '🥇 بطل الذهب';
    if (user.badges.includes('silver_medal')) return '🥈 بطل الفضة';
    if (user.badges.includes('bronze_medal')) return '🥉 بطل البرونز';
    return PROFILE_CONFIG.BADGE_NAMES[user.badges[0]] || 'طالب';
  }
  return 'طالب جديد';
}

// ==== تحديد التقدير العلمي للطالب ====
function getStudentGradeLevel(totalScore) {
  if (totalScore >= PROFILE_CONFIG.SCORE_THRESHOLDS.GOLD)   return 'ممتاز';
  if (totalScore >= PROFILE_CONFIG.SCORE_THRESHOLDS.SILVER) return 'جيد جداً';
  return 'جيد';
}

// ==== تحديث إحصاء معين في DOM ====
function updateStatElement(statName, value) {
  if (!$elements.statElements) return;
  const elements = $elements.statElements[statName];
  if (elements) elements.forEach(el => { el.textContent = value; });
}


// ==== نظام الصورة الرمزية الموحد (مُدار بالكامل عبر avatar.js) ====

/**
 * تهيئة عنصر الأفاتار الموحد وإدراجه في منطقة الصورة
 * يحل محل: avatar-ring + avatar-sprite القديمَين
 * @param {Object} user
 */
function initAvatarArea(user) {
  const avatarArea = $elements.container.querySelector(
    PROFILE_CONFIG.SELECTORS.PROFILE_AVATAR_AREA
  );
  if (!avatarArea) return;

  // ==== إزالة عناصر الأفاتار القديمة ====
  const legacyRing = avatarArea.querySelector(PROFILE_CONFIG.SELECTORS.AVATAR_RING_LEGACY);
  if (legacyRing) legacyRing.remove();

  // ==== إنشاء عنصر الأفاتار الموحد ====
  const avatarEl = createAvatarElement(user, 'xl', {
    showFrame:  true,
    showBadge:  true,
    clickable:  false,
    showShimmer: false,
    showPulse:   user?.user_type === 'teacher',
  });

  // ==== حقن زر تغيير الوظيفة داخل الأفاتار (للمستخدمين غير المعلمين) ====
  if (user?.user_type !== 'teacher') {
    const changeBtn = document.createElement('button');
    changeBtn.className    = 'change-avatar-btn';
    changeBtn.dataset.action = 'change-avatar';
    changeBtn.setAttribute('aria-label', 'تغيير الوظيفة');
    changeBtn.innerHTML    = '<i class="fas fa-briefcase" aria-hidden="true"></i>';
    avatarEl.appendChild(changeBtn);
  }

  // ==== تخزين المرجع ====
  $profileState.avatarElement = avatarEl;

  // ==== الإدراج في أول الحاوية (قبل علامة التوثيق القديمة إن وجدت) ====
  avatarArea.insertBefore(avatarEl, avatarArea.firstChild);

  // ==== إخفاء علامة التوثيق القديمة (يتولاها avatar.js الآن) ====
  const legacyBadge = avatarArea.querySelector(PROFILE_CONFIG.SELECTORS.VERIFICATION_BADGE);
  if (legacyBadge) legacyBadge.hidden = true;
}

/**
 * تحديث الأفاتار بعد تغيير بيانات المستخدم
 * @param {Object} user
 */
function refreshAvatarElement(user) {
  if ($profileState.avatarElement) {
    updateAvatarElement($profileState.avatarElement, user);
    // ==== تحديث زر تغيير الوظيفة ====
    const changeBtn = $profileState.avatarElement.querySelector('.change-avatar-btn');
    if (changeBtn) {
      changeBtn.style.display = user?.user_type === 'teacher' ? 'none' : '';
    }
  } else {
    // ==== إنشاء الأفاتار إذا لم يكن موجوداً ====
    initAvatarArea(user);
  }
}


// ==== عرض واجهة الضيف ====
function showGuestView() {
  if ($elements.loggedContent) $elements.loggedContent.hidden = true;
  if ($elements.guestMessage)  $elements.guestMessage.hidden  = false;
  if ($elements.loadingState)  $elements.loadingState.hidden  = true;

  // ==== إخفاء الأفاتار تماماً في وضع الضيف ====
  const avatarArea = $elements.container?.querySelector(
    PROFILE_CONFIG.SELECTORS.PROFILE_AVATAR_AREA
  );
  if (avatarArea) avatarArea.style.visibility = 'hidden';

  // ==== إعداد محتوى التبويبات للضيف ====
  const guestTabs = ['favorites', 'achievements', 'activity'];
  guestTabs.forEach(tab => {
    const tabContent = $elements.container?.querySelector(`[data-tab-content="${tab}"]`);
    if (!tabContent) return;
    tabContent.innerHTML = `
      <div class="${tab}-empty">
        <div class="empty-icon" aria-hidden="true">
          <i class="fas fa-${_getTabIcon(tab)}"></i>
        </div>
        <h3>يرجى تسجيل الدخول</h3>
        <p>يجب تسجيل الدخول للوصول إلى ${_getTabName(tab)}</p>
        <button class="btn btn-primary" data-nav-target="login">
          <i class="fas fa-sign-in-alt" aria-hidden="true"></i>
          تسجيل الدخول
        </button>
      </div>
    `;
  });
}

function _getTabIcon(tab) {
  return { profile: 'user', favorites: 'star', achievements: 'trophy', activity: 'history' }[tab] || 'circle';
}
function _getTabName(tab) {
  return {
    profile: 'الملف الشخصي',
    favorites: 'الدروس المفضلة',
    achievements: 'الإنجازات',
    activity: 'النشاط الأخير',
  }[tab] || '';
}


// ==== تحميل وعرض بيانات المستخدم ====
async function loadUserProfile() {
  if (!$profileState.container || !window.$currentUser?.id) return;

  $profileState.isLoading.profile = true;
  if ($elements.loadingState) $elements.loadingState.hidden = false;

  try {
    // ==== جلب بيانات المستخدم والتقدم ====
    [$profileState.userData, $profileState.userProgress] = await Promise.all([
      getUserById(window.$currentUser.id),
      getUserProgress(window.$currentUser.id),
    ]);

    if (!$profileState.userData) throw new Error('لم يتم العثور على بيانات المستخدم');

    // ==== جلب الإحصائيات المنصة وإحصائيات الامتحانات ====
    try {
      const [stats, examStats] = await Promise.all([
        getPlatformStats(),
        getUserExamStats ? getUserExamStats(window.$currentUser.id) : Promise.resolve(null),
      ]);
      $profileState.totalLessonsCount = stats?.lessons || 1;
      $profileState.platformStats = stats || null;
      $profileState.examStats = examStats;
    } catch (e) {
      $profileState.totalLessonsCount = 1;
      $profileState.platformStats = null;
      $profileState.examStats = null;
    }

    // ==== تحديث الواجهة ====
    _showLoggedContent();
    updateProfileUI();
    await loadProfileStats();

  } catch (error) {
    console.error('❌ فشل تحميل الملف الشخصي:', error);
    safeToast(PROFILE_CONFIG.ERROR_MESSAGES.LOAD_USER, 'error');
    if ($elements.loggedContent) {
      $elements.loggedContent.innerHTML = `
        <div class="error-state">
          <i class="fas fa-exclamation-triangle" aria-hidden="true"></i>
          <h3>حدث خطأ في تحميل الملف الشخصي</h3>
          <p>${escapeHTML(error.message)}</p>
          <button class="btn btn-primary" data-action="reload-page">
            <i class="fas fa-redo" aria-hidden="true"></i>
            إعادة المحاولة
          </button>
        </div>
      `;
      $elements.loggedContent.hidden = false;
    }
  } finally {
    $profileState.isLoading.profile = false;
    if ($elements.loadingState) $elements.loadingState.hidden = true;
  }
}

function _showLoggedContent() {
  if ($elements.guestMessage)  $elements.guestMessage.hidden  = true;
  if ($elements.loggedContent) $elements.loggedContent.hidden = false;

  // ==== إظهار منطقة الأفاتار ====
  const avatarArea = $elements.container?.querySelector(
    PROFILE_CONFIG.SELECTORS.PROFILE_AVATAR_AREA
  );
  if (avatarArea) avatarArea.style.visibility = '';
}


// ==== تحديث واجهة المستخدم الكاملة ====
function updateProfileUI() {
  const user = $profileState.userData;
  if (!user) return;

  // ==== تهيئة / تحديث الأفاتار الموحد ====
  if ($profileState.avatarElement) {
    refreshAvatarElement(user);
  } else {
    initAvatarArea(user);
  }

  // ==== الاسم والشارة ====
  if ($elements.profileName) $elements.profileName.textContent = user.full_name || 'مستخدم';
  if ($elements.badgeText)   $elements.badgeText.textContent   = getUserBadgeText(user);

  // ==== المرحلة الدراسية ====
  if ($elements.metaStage) {
    const stageName = PROFILE_CONFIG.STAGES[user.stage] || '';
    const gradeName = PROFILE_CONFIG.GRADES[user.grade] || '';
    $elements.metaStage.textContent =
      (stageName && gradeName)
        ? `${gradeName} ${stageName}`
        : PROFILE_CONFIG.USER_TYPES[user.user_type] || 'طالب';
  }

  // ==== الصف ====
  if ($elements.metaGrade) {
    $elements.metaGrade.textContent =
      user.grade
        ? `الصف ${PROFILE_CONFIG.GRADES[user.grade] || user.grade}`
        : '--';
  }

  // ==== تاريخ الانضمام ====
  if ($elements.metaJoined) {
    $elements.metaJoined.textContent = user.created_at
      ? `عضو منذ: ${formatDate(user.created_at)}`
      : 'عضو منذ: --';
  }

  // ==== نظام Streak ====
  _updateStreakDisplay(user);

  // ==== تفاصيل المستخدم ====
  _updateProfileDetails(user);

  // ==== الميداليات والشارات ====
  renderMedalsAndBadges(user);

  // ==== لوحة إحصائيات التدريس (معلم/مشرف فقط) ====
  _renderTeacherStats(user);

  // ==== الرسم البياني ====
  updateProfileChart();
}

// ==== تحديث تفاصيل المستخدم في بطاقة المعلومات ====
function _updateProfileDetails(user) {
  if (!$elements.userDetailElements) return;
  const totalScore = user.total_score || 0;
  const gradeLevel = user.user_type === 'student'
    ? getStudentGradeLevel(totalScore)
    : '--';

  const detailsMap = {
    'full-name':   escapeHTML(user.full_name || '--'),
    'username':    escapeHTML(user.username || '--'),
    'email':       escapeHTML(user.email || '--'),
    'phone':       escapeHTML(user.phone || '--'),
    'age':         user.age ? `${user.age} سنة` : '--',
    'gender':      user.gender === 'male' ? 'ذكر' : user.gender === 'female' ? 'أنثى' : '--',
    'stage':       PROFILE_CONFIG.STAGES[user.stage] || '--',
    'grade':       PROFILE_CONFIG.GRADES[user.grade] || '--',
    'grade-level': gradeLevel,
    'user-type':   PROFILE_CONFIG.USER_TYPES[user.user_type] || '--',
  };

  Object.entries(detailsMap).forEach(([key, value]) => {
    const el = $elements.userDetailElements[key];
    if (el) el.textContent = value;
  });
}

// ==== تحديث عرض الـ Streak ====
function _updateStreakDisplay(user) {
  const streak = user.streak || 0;

  // ==== شارة Streak في الهيدر ====
  if ($elements.streakBadge) {
    $elements.streakBadge.hidden = streak === 0;
    const countEl = $elements.streakBadge.querySelector('#streak-count');
    if (countEl) countEl.textContent = streak;
  }

  // ==== إحصاء Streak في Grid ====
  updateStatElement('streak-header', streak);

  // ==== بطاقة الـ Streak في الإنجازات ====
  if ($elements.streakCard) {
    $elements.streakCard.hidden = streak === 0;
    if ($elements.streakAchievementCount) $elements.streakAchievementCount.textContent = streak;
    if ($elements.streakBarFill) {
      const percent = Math.min(100, (streak / PROFILE_CONFIG.STREAK_GOLD_THRESHOLD) * 100);
      $elements.streakBarFill.style.width = `${percent}%`;
    }
    if ($elements.streakCardNote) {
      if (streak >= PROFILE_CONFIG.STREAK_GOLD_THRESHOLD) {
        $elements.streakCardNote.textContent = '🏆 مبروك! وصلت إلى 30 يوم متتالٍ!';
      } else {
        const remaining = PROFILE_CONFIG.STREAK_GOLD_THRESHOLD - streak;
        $elements.streakCardNote.textContent = `${remaining} يوم متبقٍ للوصول إلى المستوى الذهبي 🎯`;
      }
    }
  }
}


// ==== تحميل إحصائيات الملف الشخصي ====
async function loadProfileStats() {
  if (!$profileState.userProgress || !$profileState.userData) return;
  try {
    const progress = $profileState.userProgress;
    const user     = $profileState.userData;
    const examStats = $profileState.examStats;

    const completedLessons = progress.filter(p => p.completed === true).length;
    const achievementsCount = user.badges?.length || 0;
    const examScores = progress.filter(p => p.exam_score > 0).map(p => p.exam_score);
    const avgScore   = examScores.length
      ? Math.round(examScores.reduce((a, b) => a + b, 0) / examScores.length)
      : 0;
    const totalSeconds   = progress.reduce((sum, p) => sum + (p.total_time_spent || 0), 0);
    const studyHours     = Math.round(totalSeconds / 3600);
    const totalLessons   = $profileState.totalLessonsCount || 1;
    const overallProgress = Math.min(100, Math.round((completedLessons / totalLessons) * 100));
    const favoritesCount  = user.favorites?.length || 0;
    const totalExams      = examStats?.total || 0;
    const examsCompleted  = examStats?.completed || examScores.length;
    const bestScore       = examStats?.best || (examScores.length ? Math.max(...examScores) : 0);

    // ==== تحديث عناصر الإحصاء ====
    updateStatElement('completed-lessons',       completedLessons);
    updateStatElement('achievements',            achievementsCount);
    updateStatElement('achievements-count',      achievementsCount);
    updateStatElement('average-score',           `${avgScore}%`);
    updateStatElement('study-time',              `${studyHours} ساعة`);
    updateStatElement('overall-progress',        `${overallProgress}%`);
    updateStatElement('favorites-count',         favoritesCount);
    updateStatElement('exams-completed',         examsCompleted);
    updateStatElement('total-exams',             totalExams);
    updateStatElement('exams-completed-detail',  examsCompleted);
    updateStatElement('best-exam-score',         bestScore ? `${bestScore}%` : '--');
    updateStatElement('total-score',             user.total_score || 0);

    // ==== شريط التقدم ====
    if ($elements.progressBarFill) {
      $elements.progressBarFill.style.width = `${overallProgress}%`;
      const progressContainer = $elements.container?.querySelector('#progress-bar-container');
      if (progressContainer) progressContainer.setAttribute('aria-valuenow', overallProgress);
    }

  } catch (error) {
    console.error('❌ فشل تحميل الإحصائيات:', error);
    safeToast(PROFILE_CONFIG.ERROR_MESSAGES.LOAD_STATS, 'error');
  }
}

// ==== الرسم البياني الدائري (Canvas) ====
function updateProfileChart() {
  const canvas = $elements.profileChart;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const completed = $profileState.userProgress?.filter(p => p.completed)?.length || 0;
  const total     = $profileState.totalLessonsCount || 1;
  const completedPercent = Math.min(100, Math.round((completed / total) * 100));

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width  = rect.width  * dpr || 220;
  canvas.height = rect.height * dpr || 220;
  ctx.scale(dpr, dpr);

  const displayWidth  = canvas.width  / dpr;
  const displayHeight = canvas.height / dpr;
  const centerX = displayWidth / 2;
  const centerY = displayHeight / 2;
  const radius  = Math.min(centerX, centerY) - 15;

  ctx.clearRect(0, 0, displayWidth, displayHeight);

  // ==== قوس الخلفية (المتبقي) ====
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fillStyle = getComputedStyle(document.documentElement)
    .getPropertyValue('--border-color-light').trim() || '#E0E0E0';
  ctx.fill();

  // ==== قوس المكتمل ====
  if (completedPercent > 0) {
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(
      centerX, centerY, radius,
      -Math.PI / 2,
      -Math.PI / 2 + (completedPercent / 100) * (Math.PI * 2)
    );
    ctx.closePath();
    ctx.fillStyle = getComputedStyle(document.documentElement)
      .getPropertyValue('--primary').trim() || '#1976D2';
    ctx.fill();
  }

  // ==== دائرة داخلية (Donut) ====
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 0.6, 0, Math.PI * 2);
  ctx.fillStyle = getComputedStyle(document.documentElement)
    .getPropertyValue('--bg-card').trim() || '#FFFFFF';
  ctx.fill();

  // ==== نص النسبة ====
  ctx.fillStyle = getComputedStyle(document.documentElement)
    .getPropertyValue('--text-primary').trim() || '#212121';
  ctx.font = `bold ${Math.round(radius * 0.35)}px Cairo, sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${completedPercent}%`, centerX, centerY);
}


// ==== نظام الميداليات والشارات ====
function renderMedalsAndBadges(user) {
  _renderMedals(user);
  _renderBadges(user);
}

function _renderMedals(user) {
  const medalsSection = $elements.medalsSection;
  const medalsGrid    = $elements.medalsGrid;
  if (!medalsSection || !medalsGrid) return;

  // ==== الميداليات فقط للطلاب ====
  const medalKeys = Object.keys(PROFILE_CONFIG.MEDALS);
  const userMedals = (user.badges || []).filter(b => medalKeys.includes(b));

  if (user.user_type !== 'student' || userMedals.length === 0) {
    medalsSection.hidden = true;
    return;
  }

  medalsSection.hidden = false;
  medalsGrid.innerHTML = '';

  const spriteUrl    = PROFILE_CONFIG.MEDALS_SPRITE;
  const medalWidth   = Math.round(PROFILE_CONFIG.MEDAL_SPRITE_WIDTH  / PROFILE_CONFIG.MEDAL_COUNT);
  const medalHeight  = PROFILE_CONFIG.MEDAL_SPRITE_HEIGHT;
  const spriteTotal  = PROFILE_CONFIG.MEDAL_SPRITE_WIDTH;

  userMedals.forEach(medalKey => {
    const medalInfo = PROFILE_CONFIG.MEDALS[medalKey];
    if (!medalInfo) return;

    const xPos = medalInfo.position * medalWidth;

    const medalDiv  = document.createElement('div');
    medalDiv.className = 'medal-item';
    medalDiv.setAttribute('aria-label', medalInfo.label);

    const spriteDiv = document.createElement('div');
    spriteDiv.className = 'medal-sprite';
    spriteDiv.style.backgroundImage    = `url('${spriteUrl}')`;
    spriteDiv.style.backgroundPosition = `-${xPos}px 0`;
    spriteDiv.style.backgroundSize     = `${spriteTotal}px ${medalHeight}px`;
    spriteDiv.style.backgroundRepeat   = 'no-repeat';
    spriteDiv.style.width  = `${medalWidth}px`;
    spriteDiv.style.height = `${medalHeight}px`;
    spriteDiv.setAttribute('aria-hidden', 'true');

    const nameSpan = document.createElement('span');
    nameSpan.className   = 'medal-name';
    nameSpan.textContent = medalInfo.name;

    medalDiv.appendChild(spriteDiv);
    medalDiv.appendChild(nameSpan);
    medalsGrid.appendChild(medalDiv);
  });
}

function _renderBadges(user) {
  const badgesGrid = $elements.badgesGrid;
  if (!badgesGrid) return;

  const medalKeys = Object.keys(PROFILE_CONFIG.MEDALS);
  const badges = (user.badges || []).filter(b => !medalKeys.includes(b));

  if (badges.length === 0) {
    badgesGrid.innerHTML = '<p class="text-muted">لا توجد شارات حتى الآن.</p>';
    return;
  }

  badgesGrid.innerHTML = '';
  badges.forEach(badgeCode => {
    const badgeName = PROFILE_CONFIG.BADGE_NAMES[badgeCode] || badgeCode;
    const icon      = PROFILE_CONFIG.BADGE_ICONS[badgeCode]  || PROFILE_CONFIG.BADGE_ICONS.default;

    const badgeDiv = document.createElement('div');
    badgeDiv.className = 'badge-item';

    const iconDiv = document.createElement('div');
    iconDiv.className   = 'badge-icon';
    iconDiv.innerHTML   = `<i class="fas ${icon}" aria-hidden="true"></i>`;

    const nameSpan = document.createElement('span');
    nameSpan.className   = 'badge-name';
    nameSpan.textContent = badgeName;

    badgeDiv.appendChild(iconDiv);
    badgeDiv.appendChild(nameSpan);
    badgesGrid.appendChild(badgeDiv);
  });
}


// ==== لوحة إحصائيات التدريس (معلم/مشرف فقط) ====

/**
 * تعرض/تُخفي بطاقة "إحصائيات التدريس" وتملؤها ببيانات حقيقية فقط.
 * ⚠️ ملاحظة معمارية مهمة: لا يربط مخطط البيانات الحالي أي درس أو امتحان
 * بمعرّف المعلم الذي أنشأه (لا يوجد حقل teacher_id/created_by على أي منهما)،
 * ولا يوجد نظام تقييم على مستوى المعلم (التقييمات في api.js على مستوى الدرس
 * الواحد فقط). لذلك تُعرض هنا أرقام المنصة الإجمالية الحقيقية (من
 * getPlatformStats) بدل اختلاق أرقام "خاصة بهذا المعلم" لا تدعمها البيانات.
 * أي عرض لاحق لإحصائيات خاصة بمعلم واحد يتطلب إضافة معمارية صريحة
 * (حقل ربط + دالة تجميع في api.js) خارج نطاق هذا الملف.
 * @param {Object} user
 */
function _renderTeacherStats(user) {
  const card = $elements.teacherStatsCard;
  if (!card) return;

  const isStaff = user?.user_type === 'teacher' || user?.user_type === 'moderator';
  if (!isStaff) {
    card.hidden = true;
    return;
  }

  const stats = $profileState.platformStats;
  if ($elements.teacherStudentsCount) {
    $elements.teacherStudentsCount.textContent = stats ? stats.students : '--';
  }
  if ($elements.teacherLessonsCount) {
    $elements.teacherLessonsCount.textContent = stats ? stats.lessons : '--';
  }
  if ($elements.teacherExamsCount) {
    $elements.teacherExamsCount.textContent = stats ? stats.exams : '--';
  }

  card.hidden = false;
}


// ==== تحميل الدروس المفضلة ====
async function loadFavorites() {
  if (!$elements.favoritesGrid || !$elements.favoritesEmpty) return;

  const favorites = $profileState.userData?.favorites;
  if (!favorites || favorites.length === 0) {
    $elements.favoritesGrid.hidden = true;
    $elements.favoritesEmpty.hidden = false;
    return;
  }

  $profileState.isLoading.favorites = true;
  $elements.favoritesEmpty.hidden = true;
  $elements.favoritesGrid.hidden  = false;
  $elements.favoritesGrid.innerHTML = `
    <div class="favorites-placeholder">
      <div class="placeholder-spinner"><div class="spinner-circle"></div></div>
      <p>جاري تحميل الدروس المفضلة...</p>
    </div>
  `;

  try {
    const ids      = favorites.slice(0, PROFILE_CONFIG.MAX_FAVORITES_DISPLAY);
    const promises = ids.map(id => getLessonById(id).catch(() => null));
    const lessons  = (await Promise.all(promises)).filter(Boolean);

    if (lessons.length === 0) {
      $elements.favoritesGrid.hidden  = true;
      $elements.favoritesEmpty.hidden = false;
      return;
    }

    $elements.favoritesGrid.innerHTML = '';
    lessons.forEach(lesson => {
      const item = document.createElement('div');
      item.className = 'favorite-item';
      item.dataset.lessonId = lesson.id;
      item.innerHTML = `
        <div class="favorite-card">
          <div class="favorite-header">
            <h4 class="favorite-title">${escapeHTML(lesson.title || 'درس بدون عنوان')}</h4>
            <button class="favorite-remove-btn" data-action="remove-favorite" data-lesson-id="${escapeHTML(String(lesson.id))}" aria-label="إزالة من المفضلة">
              <i class="fas fa-times" aria-hidden="true"></i>
            </button>
          </div>
          <p class="favorite-desc">${escapeHTML(lesson.description || '')}</p>
          <div class="favorite-actions">
            <button class="btn btn-sm btn-primary" data-action="view-lesson" data-lesson-id="${escapeHTML(String(lesson.id))}">
              <i class="fas fa-play" aria-hidden="true"></i>
              متابعة
            </button>
          </div>
        </div>
      `;
      $elements.favoritesGrid.appendChild(item);
    });

    _bindFavoriteEvents();

  } catch (error) {
    console.error('❌ فشل تحميل المفضلة:', error);
    $elements.favoritesGrid.innerHTML = `
      <div class="error-state">
        <i class="fas fa-exclamation-triangle" aria-hidden="true"></i>
        <p>${PROFILE_CONFIG.ERROR_MESSAGES.LOAD_FAVORITES}</p>
        <button class="btn btn-secondary" data-action="retry-favorites">إعادة المحاولة</button>
      </div>
    `;
  } finally {
    $profileState.isLoading.favorites = false;
  }
}

function _bindFavoriteEvents() {
  if (!$elements.favoritesGrid) return;

  // ==== إزالة من المفضلة ====
  $elements.favoritesGrid.querySelectorAll('[data-action="remove-favorite"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const lessonId = btn.dataset.lessonId;
      if (!lessonId) return;
      try {
        const current  = $profileState.userData.favorites || [];
        const updated  = current.filter(id => String(id) !== String(lessonId));
        await updateUserPreferences(window.$currentUser.id, { favorites: updated });
        $profileState.userData.favorites = updated;
        updateStatElement('favorites-count', updated.length);
        await loadFavorites();
        safeToast('تمت إزالة الدرس من المفضلة', 'success');
      } catch (error) {
        safeToast('حدث خطأ أثناء الإزالة', 'error');
      }
    });
  });

  // ==== فتح الدرس ====
  $elements.favoritesGrid.querySelectorAll('[data-action="view-lesson"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const lessonId = btn.dataset.lessonId;
      if (lessonId) safeNavigate('lesson-view', { id: lessonId });
    });
  });
}


// ==== تحميل النشاط الأخير ====
async function loadActivity() {
  if (!$elements.activityList || !$elements.activityEmpty) return;

  $profileState.isLoading.activity = true;
  $elements.activityEmpty.hidden = true;
  $elements.activityList.hidden  = false;
  $elements.activityList.innerHTML = `
    <div class="activity-placeholder">
      <div class="placeholder-spinner"></div>
      <p>جاري تحميل النشاط...</p>
    </div>
  `;

  try {
    const activities = [];

    // ==== آخر تسجيل دخول ====
    if ($profileState.userData?.last_login) {
      activities.push({
        id:    'last_login',
        icon:  'fa-sign-in-alt',
        title: 'تسجيل دخول',
        time:  formatRelativeTime($profileState.userData.last_login),
        color: 'info',
        timeMs: $profileState.userData.last_login?.seconds
          ? $profileState.userData.last_login.seconds * 1000
          : Date.now(),
      });
    }

    // ==== آخر 5 دروس مدروسة ====
    const recentLessons = ($profileState.userProgress || [])
      .filter(p => p.last_accessed)
      .sort((a, b) => (b.last_accessed?.seconds || 0) - (a.last_accessed?.seconds || 0))
      .slice(0, 5);

    for (const progress of recentLessons) {
      let lessonTitle = `درس رقم ${progress.lesson_id}`;
      try {
        const lesson = await getLessonById(progress.lesson_id);
        if (lesson) lessonTitle = lesson.title;
      } catch (e) { /* نتجاهل */ }
      activities.push({
        id:    `lesson_${progress.lesson_id}`,
        icon:  progress.completed ? 'fa-check-circle' : 'fa-book-open',
        title: `درست: ${lessonTitle}`,
        time:  formatRelativeTime(progress.last_accessed),
        color: progress.completed ? 'success' : 'info',
        timeMs: progress.last_accessed?.seconds
          ? progress.last_accessed.seconds * 1000
          : 0,
      });
    }

    // ==== آخر 3 إشعارات ====
    try {
      const notifications = await getUserNotifications(window.$currentUser.id);
      if (notifications?.length > 0) {
        notifications.slice(0, 3).forEach(n => {
          activities.push({
            id:    n.id,
            icon:  'fa-bell',
            title: n.title || 'إشعار',
            time:  formatRelativeTime(n.created_at),
            color: 'warning',
            timeMs: n.created_at?.seconds ? n.created_at.seconds * 1000 : 0,
          });
        });
      }
    } catch (e) { console.warn('⚠️ فشل جلب الإشعارات للنشاط'); }

    if (activities.length === 0) {
      $elements.activityList.hidden  = true;
      $elements.activityEmpty.hidden = false;
      return;
    }

    // ==== ترتيب حسب الأحدث ====
    activities.sort((a, b) => (b.timeMs || 0) - (a.timeMs || 0));

    $elements.activityList.innerHTML = '';
    activities.slice(0, PROFILE_CONFIG.MAX_ACTIVITY_DISPLAY).forEach(act => {
      const item = document.createElement('div');
      item.className = 'activity-item';
      item.innerHTML = `
        <div class="activity-card">
          <div class="activity-icon bg-${act.color}" aria-hidden="true">
            <i class="fas ${act.icon}"></i>
          </div>
          <div class="activity-content">
            <h4 class="activity-title">${escapeHTML(act.title)}</h4>
            <div class="activity-time">
              <i class="fas fa-clock" aria-hidden="true"></i>
              <span>${escapeHTML(act.time)}</span>
            </div>
          </div>
        </div>
      `;
      $elements.activityList.appendChild(item);
    });

  } catch (error) {
    console.error('❌ فشل تحميل النشاط:', error);
    $elements.activityList.innerHTML = `
      <div class="error-state">
        <p>${PROFILE_CONFIG.ERROR_MESSAGES.LOAD_ACTIVITY}</p>
      </div>
    `;
  } finally {
    $profileState.isLoading.activity = false;
  }
}


// ==== إدارة التبويبات ====
function initializeTabs() {
  if (!$elements.tabButtons) return;

  // ==== إزالة مستمعات الأحداث القديمة (عبر clone) ====
  $elements.tabButtons.forEach(button => {
    const newBtn = button.cloneNode(true);
    button.parentNode?.replaceChild(newBtn, button);
  });
  $elements.tabButtons = $elements.container?.querySelectorAll(
    PROFILE_CONFIG.SELECTORS.TAB_BUTTONS
  );

  $elements.tabButtons?.forEach(button => {
    button.addEventListener('click', (e) => {
      e.preventDefault();
      const tabName = button.dataset.tab;
      if (tabName) switchTab(tabName);
    });
  });

  switchTab('profile');
}

function switchTab(tabName) {
  if (!$elements.tabButtons || !$elements.tabContents) return;
  $profileState.currentTab = tabName;

  $elements.tabButtons.forEach(btn => {
    const isActive = btn.dataset.tab === tabName;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  $elements.tabContents.forEach(content => {
    const isActive = content.dataset.tabContent === tabName;
    content.classList.toggle('active', isActive);
    content.hidden = !isActive;
  });

  // ==== تحميل محتوى التبويب عند الطلب ====
  if (window.$currentUser) {
    if (tabName === 'favorites')    loadFavorites();
    if (tabName === 'activity')     loadActivity();
  }
}


// ==== معالجات الأحداث ====

// ==== تغيير الثيم ====
function handleThemeToggle(e) {
  const newTheme = e.target.checked ? 'dark' : 'light';
  try {
    setTheme(newTheme, true);
    safeToast(`تم التبديل إلى الوضع ${newTheme === 'dark' ? 'الليلي 🌙' : 'النهاري ☀️'}`, 'success');
  } catch (error) {
    safeToast(PROFILE_CONFIG.ERROR_MESSAGES.UPDATE_THEME, 'error');
    e.target.checked = getCurrentTheme() === 'dark';
  }
}

// ==== تغيير الثيم اللوني ====
// ⚠️ إصلاح: كانت تستدعي setTheme (الخاصة بالوضع الليلي/النهاري فقط) بدلاً من
// setColorTheme، ما كان يمنع تطبيق الثيم اللوني فعلياً عند الضغط على الأزرار.
function handleColorThemeChange(e) {
  const btn   = e.currentTarget;
  const color = btn.dataset.colorTheme;
  if (!color) return;
  try {
    setColorTheme(color, true);
    // ==== تعليم الزر النشط ====
    $elements.container?.querySelectorAll(PROFILE_CONFIG.SELECTORS.COLOR_THEME_BTNS)
      .forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    safeToast(`تم تغيير الثيم اللوني`, 'success');
  } catch (error) {
    safeToast(PROFILE_CONFIG.ERROR_MESSAGES.UPDATE_THEME, 'error');
  }
}

// ==== الإشعارات ====
function handleNotificationsToggle(e) {
  localStorage.setItem('biologist_notifications', e.target.checked ? 'enabled' : 'disabled');
  safeToast(`تم ${e.target.checked ? 'تفعيل' : 'تعطيل'} الإشعارات`, 'info');
}

// ==== تغيير الوظيفة (الأفاتار) ====
function handleChangeAvatar() {
  if (!window.$currentUser || !$profileState.userData) {
    safeToast('يجب تسجيل الدخول أولاً', 'warning');
    return;
  }

  const user     = $profileState.userData;
  const gender   = user.gender || 'male';
  const jobNames = gender === 'male'
    ? PROFILE_CONFIG.JOB_NAMES_MALE
    : PROFILE_CONFIG.JOB_NAMES_FEMALE;

  // ==== جلب إعدادات Sprite من avatar.js ====
  const avatarConfig = getAvatarConfig();
  const spritePath   = gender === 'female'
    ? avatarConfig.SPRITE.FEMALE
    : avatarConfig.SPRITE.MALE;

  // ==== بناء شبكة اختيار الوظيفة ====
  const currentJobIndex = user.avatar_job_index ?? 0;
  const optionsContainer = document.createElement('div');
  optionsContainer.className = 'avatar-selector-grid';

  for (let i = 0; i < 10; i++) {
    const col = i % 5;
    const row = Math.floor(i / 5);

    // ==== حساب موقع Sprite (متوافق مع avatar.js) ====
    const maxCols    = avatarConfig.SPRITE.TOTAL_COLS - 1;
    const maxRows    = avatarConfig.SPRITE.TOTAL_ROWS - 1;
    const percentX   = maxCols > 0 ? (col / maxCols) * 100 : 0;
    const percentY   = maxRows > 0 ? (row / maxRows) * 100 : 0;
    const spriteCols = avatarConfig.SPRITE.TOTAL_COLS * 100;
    const spriteRows = avatarConfig.SPRITE.TOTAL_ROWS * 100;

    const optionDiv = document.createElement('div');
    optionDiv.className    = `avatar-option${i === currentJobIndex ? ' selected' : ''}`;
    optionDiv.dataset.jobIndex = i;
    optionDiv.setAttribute('role',    'button');
    optionDiv.setAttribute('tabindex', '0');
    optionDiv.setAttribute('aria-label', `اختر وظيفة ${jobNames[i]}${i === currentJobIndex ? ' (الحالية)' : ''}`);

    const spriteDiv = document.createElement('div');
    spriteDiv.className = 'avatar-sprite-preview';
    spriteDiv.style.backgroundImage    = `url('${spritePath}')`;
    spriteDiv.style.backgroundSize     = `${spriteCols}% ${spriteRows}%`;
    spriteDiv.style.backgroundPosition = `${percentX}% ${percentY}%`;
    spriteDiv.style.backgroundRepeat   = 'no-repeat';
    spriteDiv.setAttribute('aria-hidden', 'true');

    const labelSpan = document.createElement('span');
    labelSpan.className   = 'avatar-option-label';
    labelSpan.textContent = jobNames[i];

    optionDiv.appendChild(spriteDiv);
    optionDiv.appendChild(labelSpan);
    optionsContainer.appendChild(optionDiv);
  }

  const modalContent = document.createElement('div');
  modalContent.className = 'avatar-selector-container';

  const descP = document.createElement('p');
  descP.className   = 'avatar-selector-desc';
  descP.textContent = 'اختر وظيفتك المفضلة لتظهر في ملفك الشخصي';
  modalContent.appendChild(descP);
  modalContent.appendChild(optionsContainer);

  if (!window.modals?.showModal) {
    safeToast('نظام النوافذ غير متاح حالياً', 'error');
    return;
  }

  window.modals.showModal({
    title: 'تغيير الوظيفة',
    element: modalContent,
    size:  'medium',
    buttons: [
      { text: 'إغلاق', role: 'cancel', type: 'secondary' }
    ],
    onOpen: () => {
      const options = document.querySelectorAll('.avatar-option');
      options.forEach(opt => {
        const handleSelect = async () => {
          const newIndex = parseInt(opt.dataset.jobIndex);
          if (newIndex === currentJobIndex) {
            window.modals.closeAllModals();
            return;
          }
          try {
            await updateUserProfile(user.id, { avatar_job_index: newIndex });

            // ==== تحديث الحالة المحلية ====
            user.avatar_job_index = newIndex;
            $profileState.userData.avatar_job_index = newIndex;

            // ==== تحديث الجلسة ====
            if (window.$currentUser) {
              window.$currentUser.avatar_job_index = newIndex;
            }
            await setSession({ ...user });

            // ==== تحديث الأفاتار الموحد ====
            refreshAvatarElement(user);

            // ==== إطلاق حدث التحديث ====
            document.dispatchEvent(
              new CustomEvent('avatarUpdated', { detail: { user }, bubbles: true })
            );

            safeToast(`تم تعيين وظيفة "${jobNames[newIndex]}" بنجاح 🎉`, 'success');
            window.modals.closeAllModals();

          } catch (error) {
            console.error('❌ فشل تحديث الوظيفة:', error);
            safeToast('حدث خطأ أثناء حفظ الوظيفة', 'error');
          }
        };

        opt.addEventListener('click',   handleSelect);
        opt.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleSelect();
          }
        });
      });
    },
  });
}

// ==== تعديل الملف الشخصي ====
async function handleEditProfile() {
  if (!window.$currentUser) return;
  const user = $profileState.userData;
  if (!user) return;

  const formEl = document.createElement('div');
  formEl.className = 'edit-profile-form';
  formEl.innerHTML = `
    <div class="form-group">
      <label class="form-label" for="edit-full-name">الاسم الكامل</label>
      <input type="text" id="edit-full-name" class="form-control" value="${escapeHTML(user.full_name || '')}" maxlength="80">
    </div>
    <div class="form-group">
      <label class="form-label" for="edit-age">العمر</label>
      <input type="number" id="edit-age" class="form-control" value="${user.age || ''}" min="10" max="80">
    </div>
    <div class="form-group">
      <label class="form-label" for="edit-email">البريد الإلكتروني (اختياري)</label>
      <input type="email" id="edit-email" class="form-control" value="${escapeHTML(user.email || '')}">
    </div>
  `;

  if (!window.modals?.showModal) {
    safeToast('نظام النوافذ غير متاح', 'error');
    return;
  }

  window.modals.showModal({
    title: 'تعديل الملف الشخصي',
    element: formEl,
    size: 'medium',
    buttons: [
      { text: 'إلغاء', role: 'cancel', type: 'secondary' },
      { text: 'حفظ',   role: 'confirm', type: 'primary'   },
    ],
    onConfirm: async () => {
      const fullName = formEl.querySelector('#edit-full-name')?.value?.trim();
      const age      = parseInt(formEl.querySelector('#edit-age')?.value)   || undefined;
      const email    = formEl.querySelector('#edit-email')?.value?.trim()   || undefined;

      if (!fullName) {
        safeToast('الاسم الكامل مطلوب', 'warning');
        return false;
      }

      const updates = { full_name: fullName, age, email };

      try {
        await updateUserProfile(user.id, updates);
        Object.assign(user, updates);

        // ==== تحديث الجلسة ====
        await setSession({ ...user });
        if (window.$currentUser) Object.assign(window.$currentUser, updates);

        // ==== تحديث الواجهة ====
        _updateProfileDetails(user);
        if ($elements.profileName) $elements.profileName.textContent = user.full_name;

        document.dispatchEvent(
          new CustomEvent('profileUpdated', { detail: { user }, bubbles: true })
        );

        safeToast('تم تحديث الملف الشخصي بنجاح ✅', 'success');
        return true;
      } catch (error) {
        console.error('❌ فشل تحديث الملف الشخصي:', error);
        safeToast('فشل تحديث الملف الشخصي', 'error');
        return false;
      }
    },
  });
}

// ==== تغيير كلمة المرور ====
async function handleChangePassword() {
  if (!window.$currentUser) return;

  const formEl = document.createElement('div');
  formEl.className = 'change-password-form';
  formEl.innerHTML = `
    <div class="form-group">
      <label class="form-label" for="current-password">كلمة المرور الحالية</label>
      <input type="password" id="current-password" class="form-control" maxlength="6" placeholder="6 أرقام">
    </div>
    <div class="form-group">
      <label class="form-label" for="new-password">كلمة المرور الجديدة</label>
      <input type="password" id="new-password" class="form-control" maxlength="6" placeholder="6 أرقام">
    </div>
    <div class="form-group">
      <label class="form-label" for="confirm-password">تأكيد كلمة المرور الجديدة</label>
      <input type="password" id="confirm-password" class="form-control" maxlength="6" placeholder="6 أرقام">
    </div>
  `;

  if (!window.modals?.showModal) return;

  window.modals.showModal({
    title: 'تغيير كلمة المرور',
    element: formEl,
    size: 'medium',
    buttons: [
      { text: 'إلغاء', role: 'cancel',  type: 'secondary' },
      { text: 'تغيير', role: 'confirm', type: 'primary'   },
    ],
    onConfirm: async () => {
      const currentPw = formEl.querySelector('#current-password')?.value;
      const newPw     = formEl.querySelector('#new-password')?.value;
      const confirmPw = formEl.querySelector('#confirm-password')?.value;

      if (!currentPw || !newPw || !confirmPw) {
        safeToast('جميع الحقول مطلوبة', 'warning');
        return false;
      }
      if (newPw.length !== 6 || !/^\d{6}$/.test(newPw)) {
        safeToast('كلمة المرور يجب أن تكون 6 أرقام', 'warning');
        return false;
      }
      if (newPw !== confirmPw) {
        safeToast('كلمة المرور الجديدة غير متطابقة', 'warning');
        return false;
      }

      try {
        // ==== إصلاح: استدعاء مباشر لدالة api.js الحقيقية ====
        // (كانت تعتمد على `window.api` غير المُعرَّف في أي مكان بالمشروع،
        //  فتسقط دائماً إلى fallback لا يُغيّر كلمة المرور فعلياً)
        await updateUserPassword(window.$currentUser.id, currentPw, newPw);
        safeToast('تم تغيير كلمة المرور بنجاح 🔒', 'success');
        return true;
      } catch (error) {
        console.error('❌ فشل تغيير كلمة المرور:', error);
        // ==== عرض رسالة الخطأ الحقيقية (مثل: كلمة المرور الحالية غير صحيحة) ====
        safeToast(error?.message || PROFILE_CONFIG.ERROR_MESSAGES.CHANGE_PASSWORD, 'error');
        return false;
      }
    },
  });
}

// ==== تسجيل الخروج ====
async function handleLogout() {
  if (!window.modals?.confirm) {
    await clearSession();
    safeNavigate('login');
    return;
  }

  const confirmed = await new Promise(resolve => {
    window.modals.confirm({
      title:       'تسجيل الخروج',
      message:     'هل تريد تسجيل الخروج من حسابك؟',
      confirmText: 'نعم، اخرج',
      cancelText:  'إلغاء',
      onConfirm:   () => resolve(true),
      onCancel:    () => resolve(false),
    });
  });

  if (!confirmed) return;

  try {
    await clearSession();
    safeNavigate('home');
  } catch (error) {
    console.error('❌ فشل تسجيل الخروج:', error);
    safeToast('حدث خطأ أثناء تسجيل الخروج', 'error');
  }
}

// ==== حذف الحساب ====
async function handleDeleteAccount() {
  if (!window.$currentUser) return;

  // ==== حماية دفاعية: عدم الانهيار إذا لم يتوفر نظام النوافذ ====
  if (!window.modals?.confirm) {
    safeToast('نظام النوافذ غير متاح، لا يمكن تأكيد الحذف', 'error');
    return;
  }

  const confirmed = await new Promise(resolve => {
    window.modals.confirm({
      title:       'تأكيد حذف الحساب',
      message:     'هل أنت متأكد تماماً؟ هذا الإجراء لا يمكن التراجع عنه وستُفقد جميع بياناتك.',
      confirmText: 'نعم، احذف حسابي',
      cancelText:  'إلغاء',
      isDanger:    true,
      onConfirm:   () => resolve(true),
      onCancel:    () => resolve(false),
    });
  });

  if (!confirmed) return;

  try {
    safeToast('جاري حذف الحساب...', 'info');
    // ==== إصلاح: استدعاء مباشر لدالة api.js الحقيقية ====
    // (كانت تعتمد على `window.api` غير المُعرَّف، فلا يُحذف الحساب فعلياً من
    //  Firestore رغم عرض رسالة نجاح مضلِّلة — البيانات كانت تبقى كما هي)
    await deleteUserAccount(window.$currentUser.id);
    await clearSession();
    safeToast('تم حذف الحساب بنجاح', 'success');
    safeNavigate('home');
  } catch (error) {
    console.error('❌ فشل حذف الحساب:', error);
    safeToast(PROFILE_CONFIG.ERROR_MESSAGES.DELETE_ACCOUNT, 'error');
  }
}


// ==== ربط أحداث الصفحة ====
function bindProfileEvents() {

  // ==== زر تغيير الوظيفة (يُربط على الحاوية لأنه يُضاف ديناميكياً) ====
  const avatarArea = $elements.container?.querySelector(
    PROFILE_CONFIG.SELECTORS.PROFILE_AVATAR_AREA
  );
  if (avatarArea) {
    avatarArea.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="change-avatar"]')) handleChangeAvatar();
    });
  }

  // ==== مفتاح الوضع الليلي ====
  if ($elements.themeToggle) {
    const cloned = $elements.themeToggle.cloneNode(true);
    $elements.themeToggle.parentNode?.replaceChild(cloned, $elements.themeToggle);
    $elements.themeToggle = cloned;
    $elements.themeToggle.checked = getCurrentTheme() === 'dark';
    $elements.themeToggle.addEventListener('change', handleThemeToggle);
  }

  // ==== مفتاح الإشعارات ====
  if ($elements.notificationsToggle) {
    const cloned = $elements.notificationsToggle.cloneNode(true);
    $elements.notificationsToggle.parentNode?.replaceChild(cloned, $elements.notificationsToggle);
    $elements.notificationsToggle = cloned;
    $elements.notificationsToggle.checked =
      localStorage.getItem('biologist_notifications') !== 'disabled';
    $elements.notificationsToggle.addEventListener('change', handleNotificationsToggle);
  }

  // ==== أزرار الثيم اللوني ====
  $elements.container?.querySelectorAll(PROFILE_CONFIG.SELECTORS.COLOR_THEME_BTNS)
    .forEach(btn => btn.addEventListener('click', handleColorThemeChange));

  // ==== تعليم الثيم اللوني الحالي (إصلاح: كانت تقارن بالوضع الليلي/النهاري) ====
  const currentColorTheme = getCurrentColorTheme();
  const activeColorBtn = $elements.container?.querySelector(
    `[data-color-theme="${currentColorTheme}"]`
  );
  if (activeColorBtn) activeColorBtn.classList.add('active');

  // ==== أزرار الإجراءات ====
  if ($elements.editProfileBtn)    $elements.editProfileBtn.addEventListener('click',    handleEditProfile);
  if ($elements.changePasswordBtn) $elements.changePasswordBtn.addEventListener('click', handleChangePassword);
  if ($elements.logoutBtn)         $elements.logoutBtn.addEventListener('click',         handleLogout);
  if ($elements.deleteAccountBtn)  $elements.deleteAccountBtn.addEventListener('click',  handleDeleteAccount);

  // ==== أزرار التنقل للضيف ====
  $elements.container?.querySelectorAll('[data-nav-target]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = btn.dataset.navTarget;
      if (target) safeNavigate(target);
    });
  });

  // ==== أزرار التنقل العامة ====
  $elements.container?.querySelectorAll('[data-action="explore-lessons"]').forEach(btn => {
    btn.addEventListener('click', () => safeNavigate('lessons'));
  });
  $elements.container?.querySelectorAll('[data-action="start-learning"]').forEach(btn => {
    btn.addEventListener('click', () => safeNavigate('lessons'));
  });
  $elements.container?.querySelectorAll('[data-action="go-home"]').forEach(btn => {
    btn.addEventListener('click', () => safeNavigate('home'));
  });
  $elements.container?.querySelectorAll('[data-action="reload-page"]').forEach(btn => {
    btn.addEventListener('click', () => window.location.reload());
  });

  // ==== الاستماع لأحداث تغيير الجلسة (من session.js عبر EventBus) ====
  EventBus.on('userStateChanged', _onUserStateChanged);
}

// ==== معالج تغيير حالة الجلسة ====
function _onUserStateChanged(detail) {
  if (detail?.action === 'logout') {
    cleanupPage();
    showGuestView();
  }
}


// ==== كاش العناصر ====
function cacheElements(container) {
  $elements = {
    container,
    loadingState:        container.querySelector(PROFILE_CONFIG.SELECTORS.LOADING_STATE),
    guestMessage:        container.querySelector(PROFILE_CONFIG.SELECTORS.GUEST_MESSAGE),
    loggedContent:       container.querySelector(PROFILE_CONFIG.SELECTORS.LOGGED_CONTENT),
    profileName:         container.querySelector(PROFILE_CONFIG.SELECTORS.PROFILE_NAME),
    badgeText:           container.querySelector(PROFILE_CONFIG.SELECTORS.BADGE_TEXT),
    metaStage:           container.querySelector(PROFILE_CONFIG.SELECTORS.META_STAGE),
    metaGrade:           container.querySelector(PROFILE_CONFIG.SELECTORS.META_GRADE),
    metaJoined:          container.querySelector(PROFILE_CONFIG.SELECTORS.META_JOINED),
    streakBadge:         container.querySelector(PROFILE_CONFIG.SELECTORS.STREAK_BADGE),
    streakCard:          container.querySelector(PROFILE_CONFIG.SELECTORS.STREAK_CARD),
    streakAchievementCount: container.querySelector(PROFILE_CONFIG.SELECTORS.STREAK_ACHIEVEMENT),
    streakBarFill:       container.querySelector(PROFILE_CONFIG.SELECTORS.STREAK_BAR_FILL),
    streakCardNote:      container.querySelector(PROFILE_CONFIG.SELECTORS.STREAK_CARD_NOTE),
    progressBarFill:     container.querySelector(PROFILE_CONFIG.SELECTORS.PROGRESS_BAR_FILL),
    themeToggle:         container.querySelector(PROFILE_CONFIG.SELECTORS.THEME_TOGGLE),
    notificationsToggle: container.querySelector(PROFILE_CONFIG.SELECTORS.NOTIFICATIONS_TOGGLE),
    editProfileBtn:      container.querySelector(PROFILE_CONFIG.SELECTORS.EDIT_PROFILE_BTN),
    changePasswordBtn:   container.querySelector(PROFILE_CONFIG.SELECTORS.CHANGE_PASSWORD_BTN),
    deleteAccountBtn:    container.querySelector(PROFILE_CONFIG.SELECTORS.DELETE_ACCOUNT_BTN),
    logoutBtn:           container.querySelector(PROFILE_CONFIG.SELECTORS.LOGOUT_BTN),
    tabButtons:          container.querySelectorAll(PROFILE_CONFIG.SELECTORS.TAB_BUTTONS),
    tabContents:         container.querySelectorAll(PROFILE_CONFIG.SELECTORS.TAB_CONTENTS),
    favoritesGrid:       container.querySelector(PROFILE_CONFIG.SELECTORS.FAVORITES_GRID),
    favoritesEmpty:      container.querySelector(PROFILE_CONFIG.SELECTORS.FAVORITES_EMPTY),
    achievementsEmpty:   container.querySelector(PROFILE_CONFIG.SELECTORS.ACHIEVEMENTS_EMPTY),
    medalsSection:       container.querySelector(PROFILE_CONFIG.SELECTORS.MEDALS_SECTION),
    medalsGrid:          container.querySelector(PROFILE_CONFIG.SELECTORS.MEDALS_GRID),
    badgesSection:       container.querySelector(PROFILE_CONFIG.SELECTORS.BADGES_SECTION),
    badgesGrid:          container.querySelector(PROFILE_CONFIG.SELECTORS.BADGES_GRID),
    activityList:        container.querySelector(PROFILE_CONFIG.SELECTORS.ACTIVITY_LIST),
    activityEmpty:       container.querySelector(PROFILE_CONFIG.SELECTORS.ACTIVITY_EMPTY),
    profileChart:        container.querySelector(PROFILE_CONFIG.SELECTORS.PROFILE_CHART),
    teacherStatsCard:       container.querySelector(PROFILE_CONFIG.SELECTORS.TEACHER_STATS_CARD),
    teacherStudentsCount:   container.querySelector(PROFILE_CONFIG.SELECTORS.TEACHER_STUDENTS_COUNT),
    teacherLessonsCount:    container.querySelector(PROFILE_CONFIG.SELECTORS.TEACHER_LESSONS_COUNT),
    teacherExamsCount:      container.querySelector(PROFILE_CONFIG.SELECTORS.TEACHER_EXAMS_COUNT),
  };

  // ==== كاش عناصر الإحصاء (data-stat) ====
  $elements.statElements = {};
  container.querySelectorAll(PROFILE_CONFIG.SELECTORS.STAT_ELEMENTS).forEach(el => {
    const stat = el.dataset.stat;
    if (!stat) return;
    if (!$elements.statElements[stat]) $elements.statElements[stat] = [];
    $elements.statElements[stat].push(el);
  });

  // ==== كاش عناصر تفاصيل المستخدم (data-user) ====
  $elements.userDetailElements = {};
  container.querySelectorAll(PROFILE_CONFIG.SELECTORS.USER_DETAILS).forEach(el => {
    const key = el.dataset.user;
    if (key) $elements.userDetailElements[key] = el;
  });
}


// ==== التهيئة الرئيسية للصفحة (تُستدعى من router.js) ====
export function initializePage(container, params = {}) {
  if ($profileState.isInitialized && $profileState.container === container) {
    console.log('👤 الملف الشخصي مُهيأ مسبقاً');
    return;
  }

  console.log('👤 تهيئة صفحة الملف الشخصي v5.0.0...');

  try {
    if ($profileState.isInitialized) cleanupPage();

    $profileState.container     = container;
    $profileState.isInitialized = false;

    cacheElements(container);

    // ==== إضافة مستمع تغيير الثيم ====
    $profileState.themeListener = () => updateProfileChart();
    addThemeListener($profileState.themeListener);

    if (!window.$currentUser) {
      showGuestView();
      initializeTabs();
      $profileState.isInitialized = true;
      return;
    }

    loadUserProfile();
    initializeTabs();
    bindProfileEvents();
    $profileState.isInitialized = true;

    console.log('✅ تم تهيئة الملف الشخصي v5.0.0');
  } catch (error) {
    console.error('❌ فشل تهيئة الملف الشخصي:', error);
    safeToast('حدث خطأ أثناء تحميل الصفحة', 'error');
  }
}

// ==== تنظيف الصفحة (تُستدعى من router.js عند مغادرة الصفحة) ====
export function cleanupPage() {
  console.log('🧹 تنظيف صفحة الملف الشخصي...');

  // ==== إزالة مستمع الثيم ====
  if ($profileState.themeListener) {
    removeThemeListener($profileState.themeListener);
  }

  // ==== إزالة مستمع تغيير الجلسة ====
  EventBus.off('userStateChanged', _onUserStateChanged);

  // ==== تنظيف مرجع الأفاتار ====
  if ($profileState.avatarElement?._clickHandler) {
    $profileState.avatarElement.removeEventListener(
      'click', $profileState.avatarElement._clickHandler
    );
  }

  // ==== إعادة تعيين الحالة ====
  $elements = {};
  $profileState = {
    isInitialized:    false,
    container:        null,
    currentTab:       'profile',
    userData:         null,
    userProgress:     null,
    examStats:        null,
    totalLessonsCount: 0,
    platformStats:    null,
    themeListener:    null,
    avatarElement:    null,
    isLoading: {
      profile:      false,
      favorites:    false,
      achievements: false,
      activity:     false,
    },
  };

  console.log('✅ تم تنظيف الملف الشخصي');
}


// ==== صادرات إضافية للتوافق مع router.js وأجزاء أخرى ====
export { switchTab, loadUserProfile };