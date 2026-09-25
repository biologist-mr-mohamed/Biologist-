/**
 * 🏠 views/home/home.js - الصفحة الرئيسية المتكاملة v6.0.0
 * ============================================================================
 * 📝 المسؤولية: تحميل وعرض مكونات الصفحة الرئيسية الديناميكية، وتكييف الصفحة
 *   بالكامل حسب نوع المستخدم الحالي (زائر / طالب / مشرف / معلم)
 * ✅ الميزات:
 *   - 🚪 نظام "بوابات الأدوار" (Role Gates): كل قسم/عنصر يُظهر أو يُخفى تلقائياً
 *     حسب نوع المستخدم عبر خاصية data-role-gate (راجع home.html و home.css)
 *   - ترحيب مخصّص لكل نوع مستخدم: هيدر شخصي بالأفاتار والاسم والدور
 *   - لوحة طالب: بطاقة "استكمل من حيث توقفت" + إحصائيات شخصية (تقدّم/امتحانات/معدل/استمرارية)
 *   - لوحة طاقم عمل (مشرف/معلم): مؤشرات سريعة + اختصارات للوحة التحكم،
 *     مع مراعاة أن الشكاوى وإدارة المشرفين صلاحية المعلم حصرياً
 *   - دروس مقترحة مخصّصة لمرحلة/صف الطالب، وعامة للزائر، ومخفية عن طاقم العمل
 *   - استراتيجية Cache-first مع تحديث خلفي لجميع البيانات العامة
 *   - تأثيرات عدّاد (Counter) للإحصائيات
 *   - كاروسيل تلقائي لقسم "من نحن" (للزائر فقط)
 *   - نظام آراء الطلاب المتكامل: أفاتار Sprite + إطار ملون + توثيق
 *   - تعليقات مع إعجاب / ردود / تثبيت / حذف / تعديل
 *   - صلاحيات متمايزة (طالب / مشرف / معلم)
 *   - حماية من السبام وفلترة الكلمات السيئة
 *   - Pagination لتحميل المزيد من التعليقات والردود
 *   - تكامل مع نظام الإشعارات والتوجيه (Directing)
 *   - دعم التحديث الفوري عند تسجيل الدخول/الخروج (إعادة تقييم الأدوار فوراً)
 *   - إدارة الذاكرة والتسريبات عبر cleanupPage
 *   - الأفاتار يُنشأ حصرياً عبر avatar.js (النظام الموحد)
 * ============================================================================
 */

// ====== 1. استيراد التبعيات ======
import {
  getPlatformStats,
  getTopStudents,
  getComments,
  getCommentReplies,
  addComment,
  updateComment,
  softDeleteComment,
  pinComment,
  toggleCommentLike,
  canEditComment,
  getLessonById,
  getUserNotifications,
  updateUserPreferences,
  getAllLessons,
  getUserProgress,
  getUserExamStats,
  getModeratorsList,
  // 🆕 إكمال 1.2: عدّاد الشكاوى المعلّقة الحقيقي (بدل فلترة التعليقات القديمة)
  getPendingComplaintsCount,
  // 🛠️ إصلاح ترابط: كانت الدروس المقترحة تُجلب بدون فلترة الفصل الدراسي النشط
  getActiveSemesterFor
} from '../../js/core/api.js';
import { EventBus } from '../../js/core/event-bus.js';
import { getCurrentUser, isAuthenticated, isTeacher, isModerator } from '../../js/core/session.js';
import { showDirectingMessage } from '../../js/ui/directing.js';
// 🛠️ إصلاح ترابط: لمعرفة هل الصفحة الحالية فُتحت عبر /favorites أو /notifications
import { getCurrentRoute } from '../../js/core/router.js';
// ==== نظام الأفاتار الموحد (المصدر الوحيد للحقيقة) ====
import {
  createAvatarElement,
  updateAvatarElement,
  getFrameClass,
  shouldShowVerificationBadge
} from '../../js/utils/avatar.js';

// ====== 2. الثوابت والتكوين ======

// ==== مفاتيح الأدوار المدعومة ====
const ROLE_KEYS = {
  GUEST: 'guest',
  STUDENT: 'student',
  MODERATOR: 'moderator',
  TEACHER: 'teacher'
};

// ==== خريطة "بوابات" كل دور: أي data-role-gate يظهر لكل نوع مستخدم ====
const ROLE_GATE_VISIBILITY = {
  [ROLE_KEYS.GUEST]: ['guest'],
  [ROLE_KEYS.STUDENT]: ['student', 'member'],
  [ROLE_KEYS.MODERATOR]: ['moderator', 'member', 'staff'],
  [ROLE_KEYS.TEACHER]: ['teacher', 'member', 'staff']
};

const HOME_CONFIG = {
  SELECTORS: {
    STATS: '[data-stat]',
    STAFF_STATS: '[data-staff-stat]',
    STUDENT_STATS: '[data-student-stat]',
    CHAMPIONS_GRID: '.champions-grid',
    TESTIMONIALS_SECTION: '.testimonials-section',
    TESTIMONIALS_CONTAINER: '.testimonials-container',
    ANNOUNCEMENTS_CONTAINER: '#home-announcements',
    RECOMMENDED_GRID: '#home-recommended',
    RECOMMENDED_TITLE_TEXT: '#recommended-title-text',
    USER_STREAK_BADGE: '#user-streak-badge',
    MEMBER_AVATAR: '#home-member-avatar',
    MEMBER_NAME: '#home-member-name',
    MEMBER_ROLE_PILL: '#home-member-role-pill',
    MEMBER_SUBTITLE: '#home-member-subtitle',
    CONTINUE_LEARNING: '#home-continue-learning',
    WELCOME_BTN_START: '[data-action="start-learning"]',
    WELCOME_BTN_EXPLORE: '[data-action="explore-lessons"]',
    WELCOME_BTN_EXAMS: '[data-action="explore-exams"]',
    WELCOME_BTN_DASHBOARD: '[data-action="goto-dashboard"]',
    WELCOME_BTN_GROUPS: '[data-action="goto-groups"]',
    ADD_TESTIMONIAL_BTN: '[data-action="add-testimonial"]',
    VIEW_ALL_CHAMPIONS_BTN: '[data-action="view-all-champions"]',
    CAROUSEL_PREV: '.carousel-prev',
    CAROUSEL_NEXT: '.carousel-next',
    ABOUT_CAROUSEL: '#about-carousel',
    FEATURES_CAROUSEL: '#featuresCarousel',
    FEATURES_SECTION: '.features-section'
  },
  DEFAULTS: {
    STATS: { students: 0, lessons: 0, exams: 0 },
    CHAMPIONS_LIMIT: 6,
    TESTIMONIALS_LIMIT: 10,
    RECOMMENDED_LIMIT: 4,
    CAROUSEL_INTERVAL: 5000,
    CACHE_TTL: 5 * 60 * 1000,
    STREAK_CACHE_KEY: 'biologist_streak_data',
    MAX_MODERATORS: 5
  },
  // ==== إعدادات كاروسيل مزايا المنصة (البطاقة المركزية الكبيرة) ====
  FEATURES_CAROUSEL: {
    HOLD_MS: 3400,           // مدة بقاء البطاقة في المنتصف قبل الانتقال
    TRANSITION_MS: 900,      // مدة الانتقال — مطابقة لقيمة --fc-duration في home.css
    SWIPE_THRESHOLD_PX: 50,  // أقل مسافة سحب لاعتبارها تنقّل يدوي
    SWIPE_VELOCITY: 0.5      // px/ms — سحب سريع قصير المسافة يُحتسب كتنقّل أيضاً (إحساس أكثر طبيعية)
  },
  CACHE_KEYS: {
    STATS: 'home_stats_cache',
    CHAMPIONS: 'home_champions_cache',
    TESTIMONIALS: 'home_testimonials_cache',
    ANNOUNCEMENTS: 'home_announcements_cache',
    RECOMMENDED: 'home_recommended_cache'
  },
  // ==== إعدادات نظام التعليقات ====
  COMMENTS: {
    PER_PAGE: 10,
    REPLIES_PER_PAGE: 5,
    EDIT_TIMEOUT_MINUTES: 5,
    // قائمة الكلمات المحجوبة (سبام)
    BANNED_WORDS: ['سباب', 'شتيمة', 'بذيء']
  }
};

// ====== 3. الحالة الداخلية ======
let $homeState = {
  isInitialized: false,
  container: null,
  // ==== الدور الحالي المعتمد لعرض الصفحة (guest/student/moderator/teacher) ====
  roleKey: ROLE_KEYS.GUEST,
  isLoading: {
    stats: false,
    champions: false,
    testimonials: false,
    announcements: false,
    recommended: false,
    studentPanel: false,
    staffPanel: false
  },
  cache: {
    stats: null,
    champions: null,
    testimonials: null,
    announcements: null,
    recommended: null
  },
  carousels: {
    about: null,
    features: null
  },
  intervals: {
    about: null,
    features: null
  },
  // ==== دوال تنظيف حرة لأجزاء بحاجة تفكيك مخصص عند مغادرة الصفحة (مثل نسخ الكاروسيل المُستنسخة) ====
  cleanupFns: [],
  eventUnsubscribers: [],
  currentUser: null,
  // ==== حالة نظام التعليقات ====
  comments: {
    list: [],
    lastDoc: null,
    hasMore: false,
    isLoading: false,
    repliesCache: new Map(),   // commentId -> { replies, lastDoc, hasMore, isLoading }
    elements: {
      section: null,
      list: null,
      textarea: null,
      submitBtn: null,
      cancelReplyBtn: null,
      loadMoreBtn: null,
      replyParentId: null
    },
    boundHandlers: new Map()
  }
};

// ====== 4. دوال مساعدة عامة ======
function formatNumber(num) {
  if (num === undefined || num === null) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(message, type = 'info') {
  if (window.modals?.toast) {
    window.modals.toast(message, type);
  } else {
    console.log(`[Home Toast - ${type}] ${message}`);
  }
}

function getCachedData(key, ttl = HOME_CONFIG.DEFAULTS.CACHE_TTL) {
  try {
    const cached = localStorage.getItem(key);
    if (!cached) return null;
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp > ttl) {
      localStorage.removeItem(key);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function setCachedData(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
  } catch (e) {
    console.warn('⚠️ فشل تخزين البيانات في cache', e);
  }
}

// ======================================================================
// ====== 4.أ نظام بوابات الأدوار (Role Gates) — جوهر إصدار v6.0.0 ======
// ======================================================================

// ==== تحديد نوع المستخدم الحالي كمفتاح دور موحّد ====
function resolveUserRole(user) {
  if (!user) return ROLE_KEYS.GUEST;
  if (isTeacher(user)) return ROLE_KEYS.TEACHER;
  if (isModerator(user)) return ROLE_KEYS.MODERATOR;
  return ROLE_KEYS.STUDENT;
}

// ==== تطبيق الإظهار/الإخفاء على كل عناصر data-role-gate داخل الحاوية ====
function applyRoleGates(container, roleKey) {
  if (!container) return;
  const activeKeys = new Set(ROLE_GATE_VISIBILITY[roleKey] || ROLE_GATE_VISIBILITY[ROLE_KEYS.GUEST]);
  container.querySelectorAll('[data-role-gate]').forEach(el => {
    const keys = el.getAttribute('data-role-gate').split(/\s+/).filter(Boolean);
    const shouldShow = keys.some(k => activeKeys.has(k));
    el.classList.toggle('is-visible', shouldShow);
  });
}

// ==== تسمية الدور للعرض في الشارة (role-pill) ====
function getRolePillLabel(roleKey) {
  const labels = {
    [ROLE_KEYS.STUDENT]: 'طالب',
    [ROLE_KEYS.MODERATOR]: 'مشرف',
    [ROLE_KEYS.TEACHER]: 'معلم'
  };
  return labels[roleKey] || '';
}

// ==== رسالة ترحيبية فرعية تناسب كل دور ====
function getMemberSubtitle(roleKey) {
  const subtitles = {
    [ROLE_KEYS.STUDENT]: 'استمر في رحلتك التعليمية اليوم 🌱',
    [ROLE_KEYS.MODERATOR]: 'نتمنى لك يوم إشراف موفّق',
    [ROLE_KEYS.TEACHER]: 'نظرة سريعة على منصتك قبل البدء'
  };
  return subtitles[roleKey] || '';
}

// ==== بناء هيدر ترحيب الأعضاء (أفاتار + اسم + شارة الدور) ====
function renderMemberHeader(container, user, roleKey) {
  if (roleKey === ROLE_KEYS.GUEST || !user) return;

  const avatarContainer = container.querySelector(HOME_CONFIG.SELECTORS.MEMBER_AVATAR);
  if (avatarContainer) {
    const avatarEl = createAvatarElement(user, 'lg', {
      showFrame: true,
      showBadge: shouldShowVerificationBadge(user),
      clickable: false,
      showPulse: false,
      showShimmer: false
    });
    avatarContainer.innerHTML = '';
    avatarContainer.appendChild(avatarEl);
  }

  const nameEl = container.querySelector(HOME_CONFIG.SELECTORS.MEMBER_NAME);
  if (nameEl) nameEl.textContent = user.full_name || user.username || 'مستخدم بيولوجست';

  const pillEl = container.querySelector(HOME_CONFIG.SELECTORS.MEMBER_ROLE_PILL);
  if (pillEl) {
    pillEl.textContent = getRolePillLabel(roleKey);
    pillEl.className = `role-pill role-pill--${roleKey}`;
  }

  const subtitleEl = container.querySelector(HOME_CONFIG.SELECTORS.MEMBER_SUBTITLE);
  if (subtitleEl) subtitleEl.textContent = getMemberSubtitle(roleKey);
}

// ====== 5. دوال مساعدة للتعليقات ======

// ==== تنسيق التاريخ النسبي ====
function formatCommentDate(timestamp) {
  if (!timestamp) return '';
  let date;
  if (timestamp?.toDate) date = timestamp.toDate();
  else if (timestamp?.seconds) date = new Date(timestamp.seconds * 1000);
  else date = new Date(timestamp);
  if (isNaN(date)) return '';
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return 'الآن';
  if (diffMins < 60) return `منذ ${diffMins} دقيقة`;
  if (diffHours < 24) return `منذ ${diffHours} ساعة`;
  if (diffDays < 7) return `منذ ${diffDays} يوم`;
  return date.toLocaleDateString('ar-EG');
}

// ==== ترجمة نوع الحساب ====
function getUserTypeLabel(type) {
  // دعم القيم العربية مباشرة
  const reverseMap = { 'طالب': 'طالب', 'معلم': 'معلم', 'مشرف': 'مشرف' };
  if (reverseMap[type]) return reverseMap[type];
  
  const map = { student: 'طالب', teacher: 'معلم', moderator: 'مشرف' };
  return map[type] || 'مستخدم';
}

// ==== فحص السبام والكلمات المحظورة ====
function containsBannedContent(text) {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  return HOME_CONFIG.COMMENTS.BANNED_WORDS.some(w => lower.includes(w));
}

// ==== تحديث عداد التعليقات ====
function updateCommentsCountDisplay() {
  const countEl = $homeState.comments.elements.section?.querySelector('.testimonials-count');
  if (countEl) {
    countEl.textContent = $homeState.comments.list.length;
  }
}

// ====== 6. دوال تحديث واجهة المستخدم (الأجزاء غير التعليقات) ======

// ==== إحصائيات المنصة ====
function updateStats(stats) {
  const statElements = $homeState.container.querySelectorAll(HOME_CONFIG.SELECTORS.STATS);
  if (!statElements.length) return;

  const targets = {
    students: stats.students || 0,
    lessons: stats.lessons || 0,
    exams: stats.exams || 0
  };

  statElements.forEach(el => {
    const statName = el.getAttribute('data-stat');
    if (statName && targets[statName] !== undefined) {
      const target = targets[statName];
      const duration = 800;
      const stepTime = 20;
      const steps = duration / stepTime;
      const increment = target / steps;
      let current = 0;
      const timer = setInterval(() => {
        current += increment;
        if (current >= target) {
          el.textContent = formatNumber(target);
          clearInterval(timer);
        } else {
          el.textContent = formatNumber(Math.floor(current));
        }
      }, stepTime);
    }
  });
}

// ==== مؤشرات لوحة طاقم العمل السريعة (مشرف/معلم) — تحديث مباشر بدون Counter ====
function updateStaffKpis(stats) {
  const kpiElements = $homeState.container.querySelectorAll(HOME_CONFIG.SELECTORS.STAFF_STATS);
  if (!kpiElements.length) return;

  const targets = {
    students: stats.students || 0,
    lessons: stats.lessons || 0,
    exams: stats.exams || 0,
    comments: stats.comments || 0
  };

  kpiElements.forEach(el => {
    const statName = el.getAttribute('data-staff-stat');
    if (statName && targets[statName] !== undefined) {
      el.textContent = formatNumber(targets[statName]);
    }
  });
}

// ==== شبكة أبطال الأسبوع ====
function updateChampionsGrid(students) {
  const grid = $homeState.container.querySelector(HOME_CONFIG.SELECTORS.CHAMPIONS_GRID);
  if (!grid) return;

  if (!students || students.length === 0) {
    grid.innerHTML = `<div class="empty-state"><i class="fas fa-trophy empty-icon"></i><h3>لا يوجد أبطال بعد</h3><p>كن أول من يحقق إنجازاً!</p></div>`;
    return;
  }

  const championsHtml = students.map((student, index) => {
    const rank = index + 1;
    let rankClass = '';
    if (rank === 1) rankClass = 'first-place';
    else if (rank === 2) rankClass = 'second-place';
    else if (rank === 3) rankClass = 'third-place';

    const avatarUrl = student.avatar_url || (student.gender === 'female' ? 'assets/images/G.png' : 'assets/images/M.png');
    const badgesHtml = (student.badges || []).slice(0, 2).map(badge => `<span class="badge-item">${escapeHtml(badge)}</span>`).join('');

    return `
      <div class="champion-card ${rankClass}" data-user-id="${student.id}">
        <div class="champion-rank">
          <span class="rank-icon">${rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank}</span>
        </div>
        <div class="champion-avatar">
          <img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(student.full_name)}" class="avatar-image" loading="lazy">
        </div>
        <div class="champion-info">
          <h3 class="champion-name">${escapeHtml(student.full_name)}</h3>
          <div class="champion-score">
            <i class="fas fa-star score-icon"></i>
            <span>${student.total_score || 0} نقطة</span>
          </div>
          <div class="champion-badges">${badgesHtml}</div>
        </div>
      </div>
    `;
  }).join('');

  grid.innerHTML = championsHtml;

  grid.querySelectorAll('.champion-card').forEach(card => {
    card.addEventListener('click', () => {
      const userId = card.dataset.userId;
      if (userId && window.router?.navigateTo) {
        window.router.navigateTo('profile', { path: { id: userId } });
      }
    });
  });
}

// ==== التاريخ العام (للإعلانات والدروس) ====
function formatDate(timestamp) {
  if (!timestamp) return 'تاريخ غير معروف';
  let date;
  if (timestamp?.toDate) date = timestamp.toDate();
  else if (timestamp?.seconds) date = new Date(timestamp.seconds * 1000);
  else date = new Date(timestamp);
  if (isNaN(date)) return 'تاريخ غير معروف';
  return date.toLocaleDateString('ar-EG');
}

// ==== الإعلانات ====
function updateAnnouncements(announcements) {
  const container = $homeState.container.querySelector(HOME_CONFIG.SELECTORS.ANNOUNCEMENTS_CONTAINER);
  if (!container) return;

  if (!announcements || announcements.length === 0) {
    container.innerHTML = `<div class="announcements-empty"><i class="fas fa-bullhorn"></i><p>لا توجد إعلانات حالياً</p></div>`;
    return;
  }

  const announcementsHtml = announcements.map(ann => `
    <div class="announcement-item">
      <div class="announcement-icon"><i class="fas ${ann.icon || 'fa-bullhorn'}"></i></div>
      <div class="announcement-content">
        <h4 class="announcement-title">${escapeHtml(ann.title)}</h4>
        <p class="announcement-description">${escapeHtml(ann.message)}</p>
        <span class="announcement-date">${formatDate(ann.date)}</span>
      </div>
    </div>
  `).join('');

  container.innerHTML = announcementsHtml;
}

// ==== الدروس المقترحة (تستقبل كائنات الدروس كاملة مباشرة — بلا إعادة جلب لكل درس) ====
function updateRecommendedLessons(lessons) {
  const grid = $homeState.container.querySelector(HOME_CONFIG.SELECTORS.RECOMMENDED_GRID);
  if (!grid) return;

  if (!lessons || lessons.length === 0) {
    grid.innerHTML = `<div class="empty-state"><i class="fas fa-book-open empty-icon"></i><h3>لا توجد دروس مقترحة</h3><p>قم بزيارة قسم الدروس لبدء التعلم</p></div>`;
    return;
  }

  const lessonsHtml = lessons.map(lesson => `
    <div class="recommended-card" data-lesson-id="${lesson.id}">
      <div class="recommended-image">
        <img src="${escapeHtml(lesson.cover_image_url || 'assets/images/default-lesson.jpg')}" alt="${escapeHtml(lesson.title)}" loading="lazy">
      </div>
      <div class="recommended-info">
        <h3 class="recommended-title">${escapeHtml(lesson.title)}</h3>
        <p class="recommended-description">${escapeHtml(lesson.description || '')}</p>
        <button class="btn btn-sm btn-primary view-lesson-btn" data-lesson-id="${lesson.id}"><i class="fas fa-play"></i> مشاهدة</button>
      </div>
    </div>
  `).join('');

  grid.innerHTML = lessonsHtml;

  grid.querySelectorAll('.view-lesson-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const lessonId = btn.dataset.lessonId;
      if (lessonId && window.router?.navigateTo) {
        window.router.navigateTo('lesson-view', { path: { id: lessonId } });
      }
    });
  });
}

// ==== شارة Streak (الإظهار عبر كلاس is-active فقط، بلا أي Inline Style) ====
function updateUserStreak(user) {
  const badge = $homeState.container.querySelector(HOME_CONFIG.SELECTORS.USER_STREAK_BADGE);
  if (!badge) return;

  const hasStreak = !!(user && user.user_type === 'student' && user.streak && user.streak > 0);
  badge.classList.toggle('is-active', hasStreak);
  if (hasStreak) {
    badge.innerHTML = `<i class="fas fa-fire" aria-hidden="true"></i> ${user.streak} يوم متواصل 🔥`;
  }
}

// ======================================================================
// ====== 7. نظام التعليقات / آراء الطلاب المتكامل ======
// ======================================================================

// ==== بناء هيكل واجهة التعليقات ====
function buildTestimonialsUI() {
  const section = $homeState.container.querySelector(HOME_CONFIG.SELECTORS.TESTIMONIALS_SECTION);
  if (!section) return;

  const user = getCurrentUser();
  const isAuth = isAuthenticated();
  const canModerate = isTeacher() || isModerator();

  // ==== حقل الإضافة يظهر فقط للمسجلين ====
  const addFormHtml = isAuth
    ? `
      <div class="testimonials-add-form">
        <div class="add-form-avatar" id="home-comment-author-avatar"></div>
        <div class="add-form-input-wrap">
          <textarea id="home-comment-textarea" rows="2" placeholder="شاركنا رأيك في منصة بيولوجست..."></textarea>
          <div class="add-form-actions">
            <button class="cancel-reply-btn" id="home-cancel-reply-btn" style="display:none;">
              <i class="fas fa-times"></i> إلغاء الرد
            </button>
            <button class="comment-submit-btn" id="home-comment-submit-btn">
              <i class="fas fa-paper-plane"></i> إرسال
            </button>
          </div>
        </div>
      </div>
    `
    : `
      <div class="testimonials-login-prompt">
        <i class="fas fa-comment-dots"></i>
        <p>سجّل دخولك لمشاركة رأيك مع المجتمع</p>
        <button class="btn btn-primary btn-sm" data-nav-target="login">
          <i class="fas fa-sign-in-alt"></i> تسجيل الدخول
        </button>
      </div>
    `;

  // ==== إعادة بناء محتوى القسم ====
  const container = section.querySelector(HOME_CONFIG.SELECTORS.TESTIMONIALS_CONTAINER)
    || section.querySelector('.testimonials-inner')
    || section;

  container.innerHTML = `
    <div class="testimonials-header">
      <div class="testimonials-header-info">
        <h2><i class="fas fa-comments"></i> آراء الطلاب</h2>
        <span class="testimonials-count-wrap">
          <span class="testimonials-count">0</span> تعليق
        </span>
      </div>
      ${canModerate ? '<span class="mod-badge"><i class="fas fa-shield-alt"></i> وضع الإشراف</span>' : ''}
    </div>

    ${addFormHtml}

    <div class="testimonials-list" id="home-testimonials-list">
      <div class="testimonials-loading">
        <div class="spinner"></div>
        <p>جاري تحميل الآراء...</p>
      </div>
    </div>

    <div class="testimonials-load-more" id="home-testimonials-load-more" style="display:none;">
      <button class="btn btn-outline load-more-testimonials">
        <i class="fas fa-chevron-down"></i> تحميل المزيد
      </button>
    </div>
  `;

  // ==== حفظ مراجع العناصر ====
  const cs = $homeState.comments.elements;
  cs.section    = container;
  cs.list       = container.querySelector('#home-testimonials-list');
  cs.textarea   = container.querySelector('#home-comment-textarea');
  cs.submitBtn  = container.querySelector('#home-comment-submit-btn');
  cs.cancelReplyBtn = container.querySelector('#home-cancel-reply-btn');
  cs.loadMoreBtn = container.querySelector('.load-more-testimonials');

  // ==== أفاتار صاحب الرأي في حقل الإضافة ====
  if (isAuth && user) {
    const authorAvatarContainer = container.querySelector('#home-comment-author-avatar');
    if (authorAvatarContainer) {
      // ==== إنشاء الأفاتار عبر النظام الموحد (avatar.js) ====
      const avatarEl = createAvatarElement(user, 'sm', {
        showFrame:   true,
        showBadge:   false,
        clickable:   false,
        showPulse:   false,
        showShimmer: false
      });
      authorAvatarContainer.innerHTML = '';
      authorAvatarContainer.appendChild(avatarEl);
    }
  }

  // ==== ربط أحداث حقل الإضافة ====
  if (cs.submitBtn) {
    const boundSubmit = handleAddTestimonialComment.bind(null);
    cs.submitBtn.addEventListener('click', boundSubmit);
    $homeState.comments.boundHandlers.set('submit', boundSubmit);
  }

  if (cs.cancelReplyBtn) {
    const boundCancel = cancelTestimonialReply.bind(null);
    cs.cancelReplyBtn.addEventListener('click', boundCancel);
    $homeState.comments.boundHandlers.set('cancelReply', boundCancel);
  }

  if (cs.loadMoreBtn) {
    const boundLoadMore = () => loadTestimonialsComments(true);
    cs.loadMoreBtn.addEventListener('click', boundLoadMore);
    $homeState.comments.boundHandlers.set('loadMore', boundLoadMore);
  }

  // ==== ربط زر تسجيل الدخول للضيوف ====
  const loginPromptBtn = container.querySelector('[data-nav-target="login"]');
  if (loginPromptBtn) {
    loginPromptBtn.addEventListener('click', () => {
      if (window.router?.navigateTo) window.router.navigateTo('login');
    });
  }
}

// ==== جلب وتحميل التعليقات من API ====
async function loadTestimonialsComments(append = false) {
  const cs = $homeState.comments;
  if (cs.isLoading) return;

  const listEl = cs.elements.list;
  if (!listEl) return;

  cs.isLoading = true;

  if (!append) {
    listEl.innerHTML = `
      <div class="testimonials-loading">
        <div class="spinner"></div>
        <p>جاري تحميل الآراء...</p>
      </div>`;
  }

  try {
    const result = await getComments(
      HOME_CONFIG.COMMENTS.PER_PAGE + 1,
      null,     // lesson_id = null (تعليقات الصفحة الرئيسية)
      append ? cs.lastDoc : null
    );

    let newComments, newLastDoc, hasMore;
    if (Array.isArray(result)) {
      newComments = result;
      hasMore = newComments.length > HOME_CONFIG.COMMENTS.PER_PAGE;
      newComments = newComments.slice(0, HOME_CONFIG.COMMENTS.PER_PAGE);
      newLastDoc = null;
    } else {
      newComments = result.comments || [];
      newLastDoc = result.lastDoc;
      hasMore = result.hasMore || false;
    }

    if (append) {
      cs.list = [...cs.list, ...newComments];
      cs.lastDoc = newLastDoc;
      cs.hasMore = hasMore;
    } else {
      cs.list = newComments;
      cs.lastDoc = newLastDoc;
      cs.hasMore = hasMore;
      cs.repliesCache.clear();
    }

    // ==== فرز: المثبتة أولاً ثم الأحدث ====
    cs.list = [...cs.list].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      const dateA = a.date?.toDate ? a.date.toDate() : new Date(a.date || 0);
      const dateB = b.date?.toDate ? b.date.toDate() : new Date(b.date || 0);
      return dateB - dateA;
    });

    renderTestimonialsComments();
    updateCommentsCountDisplay();

    if (cs.elements.loadMoreBtn) {
      cs.elements.loadMoreBtn.parentElement.style.display = cs.hasMore ? 'flex' : 'none';
    }

  } catch (error) {
    console.error('❌ فشل تحميل آراء الطلاب:', error);
    if (listEl) {
      listEl.innerHTML = `
        <div class="testimonials-empty">
          <i class="fas fa-exclamation-triangle"></i>
          <p>حدث خطأ في تحميل الآراء</p>
          <button class="btn btn-sm btn-outline retry-testimonials">إعادة المحاولة</button>
        </div>`;
      listEl.querySelector('.retry-testimonials')
        ?.addEventListener('click', () => loadTestimonialsComments(false));
    }
  } finally {
    cs.isLoading = false;
  }
}

// ==== رسم قائمة التعليقات ====
function renderTestimonialsComments() {
  const listEl = $homeState.comments.elements.list;
  if (!listEl) return;

  const cs = $homeState.comments;

  if (!cs.list || cs.list.length === 0) {
    listEl.innerHTML = `
      <div class="testimonials-empty">
        <i class="fas fa-comment-slash"></i>
        <p>لا توجد آراء بعد. كن أول من يشارك!</p>
      </div>`;
    return;
  }

  listEl.innerHTML = cs.list.map(comment => renderSingleCommentCard(comment, false)).join('');

  // ==== ربط الأفاتار والأحداث لكل البطاقات ====
  attachTestimonialsCardEvents(listEl);

  // ==== عرض الردود المحفوظة في الكاش ====
  cs.list.forEach(comment => {
    const cached = cs.repliesCache.get(comment.id);
    if (cached && cached.replies.length > 0) {
      renderTestimonialReplies(comment.id, cached.replies, cached.hasMore);
    }
  });
}

// ==== بناء HTML لبطاقة تعليق واحد ====
function renderSingleCommentCard(comment, isReply = false) {
  const user = getCurrentUser();
  const isOwner = user && String(user.id) === String(comment.user_id);
  const canEdit = isOwner ? canEditComment(comment, user?.id) : (isTeacher() || isModerator());
  const canPin = (isTeacher() || isModerator()) && !isReply;
  const canDelete = isOwner || isTeacher() || isModerator();
  const isPinned = comment.pinned === true;
  const isLiked = user && comment.liked_by?.includes(user.id);

  // ==== ردود من الكاش ====
  const cs = $homeState.comments;
  const cached = cs.repliesCache.get(comment.id);
  const replies = cached?.replies || [];
  const hasMoreReplies = cached?.hasMore || false;

  let repliesHtml = '';
  if (!isReply) {
    if (replies.length > 0) {
      repliesHtml = `
        <div class="testimonial-replies" data-comment-id="${comment.id}">
          ${replies.map(r => renderSingleCommentCard(r, true)).join('')}
          ${hasMoreReplies ? `
            <div class="load-more-replies-wrap">
              <button class="load-replies-btn" data-comment-id="${comment.id}">
                <i class="fas fa-arrow-down"></i> عرض المزيد من الردود
              </button>
            </div>` : ''}
        </div>`;
    } else if (cached?.isLoading) {
      repliesHtml = `
        <div class="testimonial-replies">
          <div class="testimonials-loading" style="padding: var(--space-2);">
            <div class="spinner" style="width:20px;height:20px;"></div>
          </div>
        </div>`;
    }
  }

  // ==== بيانات الأفاتار ====
  const avatarUser = {
    id: comment.user_id,
    gender: comment.gender,
    user_type: comment.commenter_user_type || comment.user_type,
    total_score: comment.commenter_total_score,
    avatar_job_index: comment.commenter_avatar_job_index,
    is_verified: comment.commenter_is_verified,
  };

  // ==== التسمية المميزة ====
  const userTypeLabel = getUserTypeLabel(comment.commenter_user_type || comment.user_type);
  const isFeatured = ['teacher', 'moderator'].includes(comment.commenter_user_type || comment.user_type);
  const verifiedIcon = comment.commenter_is_verified
    ? `<i class="fas fa-check-circle comment-verified-icon" title="حساب موثق"></i>`
    : '';
  const pinnedBadge = isPinned
    ? `<span class="comment-pin-badge"><i class="fas fa-thumbtack"></i> مثبت</span>`
    : '';

  return `
    <div class="testimonial-comment-card ${isPinned ? 'pinned' : ''} ${isReply ? 'is-reply' : ''} ${isFeatured ? 'featured-comment' : ''}"
         data-comment-id="${comment.id}"
         data-parent-id="${comment.parent_id || ''}">

      <!-- ==== رأس البطاقة ==== -->
      <div class="tcard-header">
        <div class="tcard-avatar"
             data-user-id="${comment.user_id}"
             data-avatar-data='${escapeHtml(JSON.stringify(avatarUser))}'></div>
        <div class="tcard-meta">
          <div class="tcard-author-row">
            <span class="tcard-author-name">${escapeHtml(comment.full_name)}</span>
            <span class="tcard-type-badge ${comment.commenter_user_type || comment.user_type}">${userTypeLabel}</span>
            ${verifiedIcon}
            ${pinnedBadge}
          </div>
          <div class="tcard-date">
            <i class="fas fa-clock"></i> ${formatCommentDate(comment.date)}
          </div>
        </div>
      </div>

      <!-- ==== نص التعليق ==== -->
      <div class="tcard-body">
        <p class="tcard-text">${escapeHtml(comment.comment)}</p>
      </div>

      <!-- ==== أدوات التفاعل ==== -->
      <div class="tcard-actions">
        <button class="taction-btn like-btn ${isLiked ? 'active-like' : ''}"
                data-action="like"
                data-comment-id="${comment.id}"
                title="إعجاب">
          <i class="fas fa-heart"></i>
          <span class="taction-count">${comment.likes || 0}</span>
        </button>

        ${isAuthenticated() && !isReply ? `
        <button class="taction-btn reply-btn"
                data-action="reply"
                data-comment-id="${comment.id}"
                title="رد">
          <i class="fas fa-reply"></i>
          <span>رد</span>
          ${comment.replies_count > 0 ? `<span class="replies-count-badge">${comment.replies_count}</span>` : ''}
        </button>` : ''}

        ${canEdit ? `
        <button class="taction-btn edit-btn"
                data-action="edit"
                data-comment-id="${comment.id}"
                title="تعديل">
          <i class="fas fa-edit"></i>
        </button>` : ''}

        ${canPin ? `
        <button class="taction-btn pin-btn ${isPinned ? 'pin-active' : ''}"
                data-action="pin"
                data-comment-id="${comment.id}"
                title="${isPinned ? 'إلغاء التثبيت' : 'تثبيت'}">
          <i class="fas fa-thumbtack"></i>
        </button>` : ''}

        ${canDelete ? `
        <button class="taction-btn delete-btn"
                data-action="delete"
                data-comment-id="${comment.id}"
                title="حذف">
          <i class="fas fa-trash-alt"></i>
        </button>` : ''}
      </div>

      <!-- ==== نموذج الرد المضمّن ==== -->
      ${!isReply ? `
      <div class="tcard-reply-form" data-parent-id="${comment.id}" style="display:none;">
        <textarea rows="2" placeholder="اكتب ردك..."></textarea>
        <div class="tcard-reply-actions">
          <button class="btn-sm cancel-reply-inner">إلغاء</button>
          <button class="btn-sm btn-primary submit-reply-inner">إرسال الرد</button>
        </div>
      </div>` : ''}

      <!-- ==== قسم الردود ==== -->
      ${repliesHtml}
    </div>
  `;
}

// ==== ربط الأحداث لبطاقات التعليق (Event Delegation) ====
function attachTestimonialsCardEvents(root) {
  if (!root) return;

  // ==== إنشاء أفاتار لكل بطاقة عبر النظام الموحد ====
  root.querySelectorAll('.tcard-avatar[data-user-id]').forEach(avatarDiv => {
    if (avatarDiv.hasAttribute('data-avatar-initialized')) return;
    try {
      const userData = JSON.parse(avatarDiv.dataset.avatarData);

      // ==== بناء الأفاتار عبر avatar.js مع الإطار الملون الصحيح ====
      const avatarEl = createAvatarElement(userData, 'sm', {
        showFrame:   true,
        showBadge:   shouldShowVerificationBadge(userData),
        clickable:   false,
        showPulse:   false,
        showShimmer: false
      });

      avatarDiv.innerHTML = '';
      avatarDiv.appendChild(avatarEl);
      avatarDiv.style.cursor = 'pointer';

      // ==== الانتقال إلى صفحة المستخدم عند النقر ====
      avatarDiv.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.router?.navigateTo) {
          window.router.navigateTo('profile', { path: { id: userData.id } });
        }
      });

      avatarDiv.setAttribute('data-avatar-initialized', 'true');
    } catch (err) {
      console.warn('⚠️ فشل إنشاء الأفاتار:', err);
    }
  });

  // ==== مستمع واحد للأحداث (delegation) ====
  if (!root._testimonialDelegationAttached) {

    root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const commentId = parseInt(btn.dataset.commentId);
      if (!commentId) return;

      switch (action) {
        case 'like':    handleTestimonialLike(commentId);       break;
        case 'reply':   handleTestimonialReplyClick(commentId, btn); break;
        case 'edit':    handleTestimonialEdit(commentId);       break;
        case 'delete':  handleTestimonialDelete(commentId);     break;
        case 'pin':     handleTestimonialPin(commentId, btn);   break;
      }
    });

    // ==== تحميل المزيد من الردود ====
    root.addEventListener('click', (e) => {
      const loadBtn = e.target.closest('.load-replies-btn');
      if (loadBtn) {
        e.preventDefault();
        const commentId = parseInt(loadBtn.dataset.commentId);
        if (commentId) loadTestimonialReplies(commentId, false);
      }
    });

    // ==== إرسال رد مضمّن ====
    root.addEventListener('click', (e) => {
      const submitBtn = e.target.closest('.submit-reply-inner');
      if (submitBtn) {
        e.preventDefault();
        const form = submitBtn.closest('.tcard-reply-form');
        if (form) handleSubmitTestimonialReply(form);
      }
    });

    // ==== إلغاء رد مضمّن ====
    root.addEventListener('click', (e) => {
      const cancelBtn = e.target.closest('.cancel-reply-inner');
      if (cancelBtn) {
        e.preventDefault();
        const form = cancelBtn.closest('.tcard-reply-form');
        if (form) form.style.display = 'none';
      }
    });

    root._testimonialDelegationAttached = true;
  }
}

// ==== رسم الردود لتعليق محدد ====
function renderTestimonialReplies(commentId, replies, hasMore) {
  const listEl = $homeState.comments.elements.list;
  if (!listEl) return;

  const commentCard = listEl.querySelector(`.testimonial-comment-card[data-comment-id="${commentId}"]`);
  if (!commentCard) return;

  let repliesContainer = commentCard.querySelector('.testimonial-replies');
  if (!repliesContainer) {
    repliesContainer = document.createElement('div');
    repliesContainer.className = 'testimonial-replies';
    repliesContainer.dataset.commentId = commentId;
    commentCard.appendChild(repliesContainer);
  }

  const loadMoreHtml = hasMore
    ? `<div class="load-more-replies-wrap">
         <button class="load-replies-btn" data-comment-id="${commentId}">
           <i class="fas fa-arrow-down"></i> عرض المزيد من الردود
         </button>
       </div>`
    : '';

  repliesContainer.innerHTML = replies.map(r => renderSingleCommentCard(r, true)).join('') + loadMoreHtml;
  attachTestimonialsCardEvents(repliesContainer);
}

// ==== جلب ردود تعليق ====
async function loadTestimonialReplies(commentId, refresh = false) {
  const cs = $homeState.comments;
  const cached = cs.repliesCache.get(commentId);
  if (!refresh && cached && !cached.hasMore && cached.replies.length > 0) return;

  const currentReplies = refresh ? [] : (cached?.replies || []);
  const lastDoc = refresh ? null : (cached?.lastDoc || null);

  cs.repliesCache.set(commentId, { replies: currentReplies, lastDoc, hasMore: false, isLoading: true });

  const listEl = cs.elements.list;
  const commentCard = listEl?.querySelector(`.testimonial-comment-card[data-comment-id="${commentId}"]`);
  let repliesContainer = commentCard?.querySelector('.testimonial-replies');
  if (!repliesContainer) {
    repliesContainer = document.createElement('div');
    repliesContainer.className = 'testimonial-replies';
    repliesContainer.dataset.commentId = commentId;
    commentCard?.appendChild(repliesContainer);
  }
  if (!refresh) {
    repliesContainer.innerHTML = `
      <div class="testimonials-loading" style="padding:var(--space-2);">
        <div class="spinner" style="width:20px;height:20px;"></div>
      </div>`;
  }

  try {
    const result = await getCommentReplies(
      commentId,
      HOME_CONFIG.COMMENTS.REPLIES_PER_PAGE,
      lastDoc
    );
    const newReplies = result.replies || [];
    const allReplies = refresh ? newReplies : [...currentReplies, ...newReplies];
    cs.repliesCache.set(commentId, {
      replies: allReplies,
      lastDoc: result.lastDoc,
      hasMore: result.hasMore || false,
      isLoading: false
    });
    renderTestimonialReplies(commentId, allReplies, result.hasMore || false);
  } catch (err) {
    console.error('❌ فشل تحميل الردود:', err);
    repliesContainer.innerHTML = `<div class="testimonials-error">حدث خطأ في تحميل الردود</div>`;
    cs.repliesCache.set(commentId, { ...(cached || {}), isLoading: false });
  }
}

// ==== البحث عن تعليق في القائمة أو الكاش ====
function findCommentById(commentId) {
  const cs = $homeState.comments;
  for (const c of cs.list) {
    if (c.id === commentId) return c;
    const cached = cs.repliesCache.get(c.id);
    if (cached) {
      const reply = cached.replies.find(r => r.id === commentId);
      if (reply) return reply;
    }
  }
  return null;
}

// ======================================================================
// ====== 8. معالجات أحداث التعليقات ======
// ======================================================================

// ==== إضافة تعليق/رأي جديد ====
async function handleAddTestimonialComment() {
  const cs = $homeState.comments.elements;
  if (!cs.textarea) return;

  const content = cs.textarea.value.trim();
  if (!content) {
    showToast('يرجى كتابة رأيك أولاً', 'warning');
    return;
  }
  if (containsBannedContent(content)) {
    showToast('يحتوي النص على محتوى غير لائق', 'warning');
    return;
  }

  const user = getCurrentUser();
  if (!user) {
    showToast('يجب تسجيل الدخول أولاً', 'warning');
    if (window.router?.navigateTo) window.router.navigateTo('login');
    return;
  }

  if (cs.submitBtn) cs.submitBtn.disabled = true;

  try {
    await addComment({
      userId: user.id,
      lessonId: null,    // تعليق على الصفحة الرئيسية
      parentId: null,
      comment: content,
      fullName: user.full_name,
      userType: user.user_type
    });
    cs.textarea.value = '';
    cancelTestimonialReply();
    showToast('شكراً! تم إضافة رأيك بنجاح', 'success');
    await loadTestimonialsComments(false);
    EventBus.emit('comment:added', { lessonId: null });
  } catch (err) {
    console.error('❌ فشل إضافة الرأي:', err);
    showToast('حدث خطأ أثناء إضافة رأيك', 'error');
  } finally {
    if (cs.submitBtn) cs.submitBtn.disabled = false;
  }
}

// ==== إلغاء وضع الرد ====
function cancelTestimonialReply() {
  document.querySelectorAll('.tcard-reply-form').forEach(f => f.style.display = 'none');
  const cs = $homeState.comments.elements;
  cs.replyParentId = null;
  if (cs.cancelReplyBtn) cs.cancelReplyBtn.style.display = 'none';
}

// ==== فتح نموذج الرد ====
function handleTestimonialReplyClick(commentId, btn) {
  if (!isAuthenticated()) {
    showToast('يجب تسجيل الدخول للرد', 'warning');
    return;
  }
  const card = btn.closest('.testimonial-comment-card');
  if (!card) return;

  document.querySelectorAll('.tcard-reply-form').forEach(f => f.style.display = 'none');

  const replyForm = card.querySelector('.tcard-reply-form');
  if (replyForm) {
    replyForm.style.display = 'block';
    replyForm.querySelector('textarea')?.focus();
    $homeState.comments.elements.replyParentId = commentId;
    const cancelBtn = $homeState.comments.elements.cancelReplyBtn;
    if (cancelBtn) cancelBtn.style.display = 'inline-flex';
  }
}

// ==== إرسال رد ====
async function handleSubmitTestimonialReply(form) {
  const parentId = parseInt(form.dataset.parentId);
  const textarea = form.querySelector('textarea');
  const content = textarea?.value.trim();

  if (!content) {
    showToast('يرجى كتابة الرد', 'warning');
    return;
  }
  if (containsBannedContent(content)) {
    showToast('يحتوي الرد على محتوى غير لائق', 'warning');
    return;
  }

  const user = getCurrentUser();
  if (!user) {
    showToast('يجب تسجيل الدخول أولاً', 'warning');
    return;
  }

  const submitBtn = form.querySelector('.submit-reply-inner');
  if (submitBtn) submitBtn.disabled = true;

  try {
    await addComment({
      userId: user.id,
      lessonId: null,
      parentId: parentId,
      comment: content,
      fullName: user.full_name,
      userType: user.user_type
    });
    if (textarea) textarea.value = '';
    form.style.display = 'none';
    await loadTestimonialReplies(parentId, true);
    showToast('تم إضافة ردك', 'success');
    EventBus.emit('comment:added', { lessonId: null, parentId });
  } catch (err) {
    console.error('❌ فشل إضافة الرد:', err);
    showToast('حدث خطأ أثناء إضافة الرد', 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

// ==== الإعجاب بتعليق ====
async function handleTestimonialLike(commentId) {
  const user = getCurrentUser();
  if (!user) {
    showToast('يجب تسجيل الدخول', 'warning');
    return;
  }

  try {
    await toggleCommentLike(commentId, user.id);

    // ==== تحديث محلي فوري للواجهة ====
    const updateLocally = (commentsArray) => {
      for (const c of commentsArray) {
        if (c.id === commentId) {
          const wasLiked = c.liked_by?.includes(user.id);
          if (wasLiked) {
            c.likes = Math.max(0, (c.likes || 0) - 1);
            c.liked_by = (c.liked_by || []).filter(id => id !== user.id);
          } else {
            c.likes = (c.likes || 0) + 1;
            c.liked_by = [...(c.liked_by || []), user.id];
          }
          const card = document.querySelector(`.testimonial-comment-card[data-comment-id="${commentId}"]`);
          if (card) {
            const likeBtn = card.querySelector('.like-btn');
            likeBtn?.querySelector('.taction-count') && (likeBtn.querySelector('.taction-count').textContent = c.likes);
            likeBtn?.classList.toggle('active-like', !wasLiked);
          }
          return true;
        }
        const cs = $homeState.comments;
        const cached = cs.repliesCache.get(c.id);
        if (cached?.replies?.length && updateLocally(cached.replies)) return true;
      }
      return false;
    };
    updateLocally($homeState.comments.list);
    EventBus.emit('comment:liked', { commentId, userId: user.id });
  } catch (err) {
    showToast('فشل تسجيل الإعجاب', 'error');
  }
}

// ==== تعديل تعليق ====
async function handleTestimonialEdit(commentId) {
  const comment = findCommentById(commentId);
  if (!comment) return;

  if (!window.modals?.prompt) {
    showToast('نظام التعديل غير متاح', 'error');
    return;
  }

  const newText = await window.modals.prompt({
    title: 'تعديل الرأي',
    message: 'قم بتعديل نص رأيك',
    defaultValue: comment.comment,
    confirmText: 'حفظ',
    cancelText: 'إلغاء'
  });

  if (!newText || newText.trim() === comment.comment) return;
  if (containsBannedContent(newText)) {
    showToast('يحتوي النص على محتوى غير لائق', 'warning');
    return;
  }

  try {
    await updateComment(commentId, newText.trim());
    comment.comment = newText.trim();
    const textEl = document.querySelector(`.testimonial-comment-card[data-comment-id="${commentId}"] .tcard-text`);
    if (textEl) textEl.textContent = newText.trim();
    showToast('تم تعديل الرأي', 'success');
    EventBus.emit('comment:updated', { commentId });
  } catch (err) {
    showToast('فشل التعديل', 'error');
  }
}

// ==== حذف تعليق ====
async function handleTestimonialDelete(commentId) {
  const confirmed = await new Promise(resolve => {
    if (window.modals?.confirm) {
      window.modals.confirm({
        title: 'تأكيد الحذف',
        message: 'هل أنت متأكد من حذف هذا الرأي؟',
        confirmText: 'حذف',
        cancelText: 'إلغاء',
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false)
      });
    } else {
      resolve(confirm('هل تريد حذف هذا الرأي؟'));
    }
  });

  if (!confirmed) return;

  try {
    await softDeleteComment(commentId);
    showToast('تم حذف الرأي', 'success');

    // ==== إزالة محلية من القائمة ====
    const cs = $homeState.comments;
    const idx = cs.list.findIndex(c => c.id === commentId);
    if (idx !== -1) {
      cs.list.splice(idx, 1);
    } else {
      for (const c of cs.list) {
        const cached = cs.repliesCache.get(c.id);
        if (cached) {
          const rIdx = cached.replies.findIndex(r => r.id === commentId);
          if (rIdx !== -1) cached.replies.splice(rIdx, 1);
        }
      }
    }
    renderTestimonialsComments();
    updateCommentsCountDisplay();
    EventBus.emit('comment:deleted', { commentId });
  } catch (err) {
    showToast('فشل الحذف', 'error');
  }
}

// ==== تثبيت / إلغاء تثبيت تعليق (للمشرف والمعلم فقط) ====
async function handleTestimonialPin(commentId, btn) {
  const card = btn.closest('.testimonial-comment-card');
  const currentlyPinned = card?.classList.contains('pinned');

  try {
    await pinComment(commentId, !currentlyPinned);
    showToast(currentlyPinned ? 'تم إلغاء التثبيت' : 'تم تثبيت الرأي', 'success');
    await loadTestimonialsComments(false);
  } catch (err) {
    showToast('فشل تغيير حالة التثبيت', 'error');
  }
}

// ======================================================================
// ====== 9. دوال جلب البيانات (Cache-first) ======
// ======================================================================

async function loadPlatformStats(forceRefresh = false) {
  if ($homeState.isLoading.stats) return;
  $homeState.isLoading.stats = true;
  try {
    let stats = forceRefresh ? null : getCachedData(HOME_CONFIG.CACHE_KEYS.STATS);
    if (!stats) {
      stats = await getPlatformStats();
      setCachedData(HOME_CONFIG.CACHE_KEYS.STATS, stats);
    }
    // ==== تُستخدم نفس الإحصائيات في هيدر الزائر وفي مؤشرات طاقم العمل ====
    updateStats(stats);
    if ($homeState.roleKey === ROLE_KEYS.MODERATOR || $homeState.roleKey === ROLE_KEYS.TEACHER) {
      updateStaffKpis(stats);
    }
  } catch (error) {
    console.error('❌ فشل تحميل الإحصائيات:', error);
    showToast('تعذر تحميل إحصائيات المنصة', 'error');
  } finally {
    $homeState.isLoading.stats = false;
  }
}

async function loadTopChampions(forceRefresh = false) {
  if ($homeState.isLoading.champions) return;
  $homeState.isLoading.champions = true;
  try {
    let champions = forceRefresh ? null : getCachedData(HOME_CONFIG.CACHE_KEYS.CHAMPIONS);
    if (!champions) {
      champions = await getTopStudents(HOME_CONFIG.DEFAULTS.CHAMPIONS_LIMIT);
      setCachedData(HOME_CONFIG.CACHE_KEYS.CHAMPIONS, champions);
    }
    updateChampionsGrid(champions);
  } catch (error) {
    console.error('❌ فشل تحميل أبطال الأسبوع:', error);
    showToast('تعذر تحميل قائمة الأبطال', 'error');
  } finally {
    $homeState.isLoading.champions = false;
  }
}

async function loadAnnouncements(forceRefresh = false) {
  if ($homeState.isLoading.announcements) return;
  $homeState.isLoading.announcements = true;
  try {
    let announcements = forceRefresh ? null : getCachedData(HOME_CONFIG.CACHE_KEYS.ANNOUNCEMENTS);
    if (!announcements) {
      const user = getCurrentUser();
      if (user && user.id) {
        const notifs = await getUserNotifications(user.id);
        announcements = notifs.filter(n => n.type === 'announcement' || n.sender === 'system').slice(0, 5);
      } else {
        announcements = [
          { title: '🎉 منصة بيولوجست في نسختها الجديدة', message: 'اكتشف الدروس التفاعلية والامتحانات الذكية', icon: 'fa-rocket', date: new Date() },
          { title: '📢 امتحان المتفوقين', message: 'سجل الآن في امتحان المتفوقين واحصل على ميدالية', icon: 'fa-trophy', date: new Date() }
        ];
      }
      setCachedData(HOME_CONFIG.CACHE_KEYS.ANNOUNCEMENTS, announcements);
    }
    updateAnnouncements(announcements);
  } catch (error) {
    console.error('❌ فشل تحميل الإعلانات:', error);
  } finally {
    $homeState.isLoading.announcements = false;
  }
}

async function loadRecommendedLessons(forceRefresh = false) {
  // ==== طاقم العمل (مشرف/معلم) لا يحتاج قسم "دروس مقترحة" أصلاً — القسم مخفي بالكامل (role-gate) ====
  if ($homeState.roleKey === ROLE_KEYS.MODERATOR || $homeState.roleKey === ROLE_KEYS.TEACHER) return;
  if ($homeState.isLoading.recommended) return;
  $homeState.isLoading.recommended = true;

  const isStudent = $homeState.roleKey === ROLE_KEYS.STUDENT;
  const user = isStudent ? $homeState.currentUser : null;
  // ==== مفتاح Cache مخصّص حسب المرحلة/الصف لتفادي خلط دروس مرحلة بأخرى ====
  const cacheKey = isStudent
    ? `${HOME_CONFIG.CACHE_KEYS.RECOMMENDED}_${user?.stage || 'na'}_${user?.grade || 'na'}`
    : HOME_CONFIG.CACHE_KEYS.RECOMMENDED;

  try {
    let lessons = forceRefresh ? null : getCachedData(cacheKey);
    if (!lessons) {
      const options = { limit: HOME_CONFIG.DEFAULTS.RECOMMENDED_LIMIT };
      // ==== تخصيص الدروس المقترحة لمرحلة وصف الطالب نفسه ====
      if (isStudent && user?.stage) options.stage = user.stage;
      if (isStudent && user?.grade !== undefined) options.grade = user.grade;
      // 🛠️ إصلاح ترابط: بدون هذا الفلتر كان الطالب يرى دروس كل الفصول الدراسية مجتمعة،
      // رغم وجود نظام كامل في لوحة التحكم (Semester_Settings) للتحكم في الفصل الظاهر له
      if (isStudent && user?.stage && user?.grade !== undefined) {
        try {
          options.semester = await getActiveSemesterFor(user.stage, user.grade);
        } catch (err) {
          console.warn('⚠️ تعذّر جلب الفصل الدراسي النشط، سيتم عرض كل الدروس:', err);
        }
      }
      lessons = await getAllLessons(options);
      setCachedData(cacheKey, lessons);
    }

    // ==== تحديث عنوان القسم ليعكس التخصيص ====
    const titleEl = $homeState.container.querySelector(HOME_CONFIG.SELECTORS.RECOMMENDED_TITLE_TEXT);
    if (titleEl) titleEl.textContent = isStudent ? 'دروس مقترحة لمرحلتك' : 'دروس مقترحة لك';

    updateRecommendedLessons(lessons);
  } catch (error) {
    console.error('❌ فشل تحميل الدروس المقترحة:', error);
    showToast('تعذر تحميل الدروس المقترحة', 'error');
  } finally {
    $homeState.isLoading.recommended = false;
  }
}

// ======================================================================
// ====== 9.أ لوحة الطالب: استكمال التعلم + إحصائيات شخصية ======
// ======================================================================

// ==== تحويل أي شكل Timestamp (Firestore/Date/رقم) إلى Milliseconds للمقارنة ====
function toMillis(timestamp) {
  if (!timestamp) return 0;
  if (timestamp?.toDate) return timestamp.toDate().getTime();
  if (timestamp?.seconds) return timestamp.seconds * 1000;
  const d = new Date(timestamp);
  return isNaN(d) ? 0 : d.getTime();
}

// ==== ربط أزرار التنقّل داخل حالات بطاقة "استكمل التعلم" الفارغة ====
function bindContinueLearningEmptyActions(card) {
  card.querySelectorAll('[data-action]').forEach(btn => {
    const target = btn.dataset.action === 'explore-exams' ? 'exams' : 'lessons';
    btn.addEventListener('click', () => handleNavigation(target));
  });
}

// ==== بناء بطاقة "استكمل من حيث توقفت" حسب آخر تقدّم للطالب ====
async function renderContinueLearningCard(progressList) {
  const card = $homeState.container.querySelector(HOME_CONFIG.SELECTORS.CONTINUE_LEARNING);
  if (!card) return;

  // ==== حالة: طالب جديد بلا أي تقدّم مسجّل بعد ====
  if (!progressList || progressList.length === 0) {
    card.innerHTML = `
      <div class="clc-empty">
        <i class="fas fa-rocket" aria-hidden="true"></i>
        <h3>لم تبدأ رحلتك بعد!</h3>
        <p>اختر أول درس لك وابدأ التعلم الآن</p>
        <button class="btn btn-primary" data-action="explore-lessons" type="button">
          <i class="fas fa-book-open" aria-hidden="true"></i> تصفح الدروس
        </button>
      </div>
    `;
    bindContinueLearningEmptyActions(card);
    return;
  }

  const inProgress = progressList
    .filter(p => !p.completed && (p.progress || 0) < 100)
    .sort((a, b) => toMillis(b.last_accessed) - toMillis(a.last_accessed));

  // ==== حالة: أكمل كل الدروس المتاحة له حالياً ====
  if (inProgress.length === 0) {
    card.innerHTML = `
      <div class="clc-empty">
        <i class="fas fa-medal" aria-hidden="true"></i>
        <h3>أحسنت! أكملت كل دروسك المتاحة 🎉</h3>
        <p>جرّب الآن امتحاناً جديداً لاختبار مستواك</p>
        <button class="btn btn-primary" data-action="explore-exams" type="button">
          <i class="fas fa-pen-to-square" aria-hidden="true"></i> الامتحانات
        </button>
      </div>
    `;
    bindContinueLearningEmptyActions(card);
    return;
  }

  const latest = inProgress[0];
  let lesson = null;
  try {
    lesson = await getLessonById(latest.lesson_id);
  } catch (e) {
    console.warn('⚠️ فشل جلب بيانات الدرس الحالي', e);
  }

  // ==== الدرس قد يكون حُذف أو أصبح غير متاح — تراجع آمن ====
  if (!lesson) {
    card.innerHTML = `
      <div class="clc-empty">
        <i class="fas fa-book-open" aria-hidden="true"></i>
        <h3>تابع دروسك</h3>
        <button class="btn btn-primary" data-action="explore-lessons" type="button">تصفح الدروس</button>
      </div>
    `;
    bindContinueLearningEmptyActions(card);
    return;
  }

  const progressPercent = Math.max(0, Math.min(100, Math.round(latest.progress || 0)));
  card.innerHTML = `
    <span class="clc-eyebrow"><i class="fas fa-play-circle" aria-hidden="true"></i> استكمل من حيث توقفت</span>
    <div class="clc-body">
      <div class="clc-ring" role="img" aria-label="نسبة إكمال الدرس ${progressPercent}%">
        <span class="clc-ring-value">${progressPercent}%</span>
      </div>
      <div class="clc-info">
        <h3 class="clc-title">${escapeHtml(lesson.title)}</h3>
        <p class="clc-desc">تابع دراستك في آخر درس كنت تدرسه واستكمل نحو أهدافك</p>
        <div class="clc-actions">
          <button class="btn btn-primary btn-sm clc-cta" data-action="continue-lesson" type="button">
            <i class="fas fa-play" aria-hidden="true"></i> متابعة التعلم
          </button>
        </div>
      </div>
    </div>
  `;

  // ==== ضبط نسبة حلقة التقدّم الدائرية عبر متغيّر CSS مخصص (وليس Inline Style موسّع) ====
  const ringEl = card.querySelector('.clc-ring');
  if (ringEl) ringEl.style.setProperty('--clc-progress', progressPercent);

  const continueBtn = card.querySelector('[data-action="continue-lesson"]');
  if (continueBtn) {
    continueBtn.addEventListener('click', () => {
      handleNavigation('lesson-view', { path: { id: lesson.id } });
    });
  }
}

// ==== تحديث الإحصائيات الشخصية السريعة (تقدم عام / امتحانات / معدل / استمرارية) ====
function renderStudentStats(progressList, examStats, user) {
  const overallProgress = progressList.length
    ? Math.round(progressList.reduce((sum, p) => sum + (p.progress || 0), 0) / progressList.length)
    : 0;

  const values = {
    progress: `${overallProgress}%`,
    exams: formatNumber(examStats.completedExams || 0),
    average: `${Math.round(examStats.averageScore || 0)}%`,
    streak: formatNumber(user.streak || 0)
  };

  $homeState.container.querySelectorAll(HOME_CONFIG.SELECTORS.STUDENT_STATS).forEach(el => {
    const key = el.getAttribute('data-student-stat');
    if (values[key] !== undefined) el.textContent = values[key];
  });
}

// ==== نقطة الدخول: تحميل لوحة الطالب بالكامل (طلبان فقط، خفيفان على القراءات) ====
async function loadStudentPanel(user) {
  if (!user || $homeState.isLoading.studentPanel) return;
  $homeState.isLoading.studentPanel = true;
  try {
    const [progressList, examStats] = await Promise.all([
      getUserProgress(user.id).catch(() => []),
      getUserExamStats(user.id).catch(() => ({ completedExams: 0, averageScore: 0 }))
    ]);

    await renderContinueLearningCard(progressList);
    renderStudentStats(progressList, examStats, user);
  } catch (error) {
    console.error('❌ فشل تحميل لوحة الطالب:', error);
  } finally {
    $homeState.isLoading.studentPanel = false;
  }
}

// ======================================================================
// ====== 9.ب لوحة طاقم العمل: مؤشرات إضافية حصرية على المعلم ======
// ======================================================================

// ==== الشكاوى وإدارة المشرفين صلاحية المعلم حصراً (راجع dashboard.js/html) ====
async function loadStaffPanel(roleKey) {
  if (roleKey !== ROLE_KEYS.TEACHER) return;
  if ($homeState.isLoading.staffPanel) return;
  $homeState.isLoading.staffPanel = true;

  try {
    // 🆕 إكمال 1.2: بعد إضافة مجموعة Complaints حقيقية في api.js/dashboard.js،
    // كان هذا الملف لسه بيستخدم نفس المنطق القديم غير الصحيح (فلترة تعليقات بحقل
    // is_complaint غير موجود أصلاً في أي مستند)، فكان العداد هنا سيبقى صفراً دائماً
    // حتى لو ظهرت شكاوى حقيقية في لوحة التحكم — استبدلناه بالعدّاد الحقيقي مباشرة.
    const [pendingComplaints, moderators] = await Promise.all([
      getPendingComplaintsCount().catch(() => 0),
      getModeratorsList().catch(() => [])
    ]);

    // ==== استبعاد المعلم نفسه من عداد "المشرفين" ====
    // ==== getModeratorsList لا تُرجع user_type، بل level: 'senior' للمعلم و'normal'/غيرها للمشرف ====
    const moderatorsCount = moderators.filter(m => m.level !== 'senior').length;

    const values = {
      pendingComplaints: formatNumber(pendingComplaints),
      moderators: `${moderatorsCount}/${HOME_CONFIG.DEFAULTS.MAX_MODERATORS}`
    };

    $homeState.container.querySelectorAll(HOME_CONFIG.SELECTORS.STAFF_STATS).forEach(el => {
      const key = el.getAttribute('data-staff-stat');
      if (values[key] !== undefined) el.textContent = values[key];
    });
  } catch (error) {
    console.error('❌ فشل تحميل مؤشرات طاقم العمل الإضافية:', error);
  } finally {
    $homeState.isLoading.staffPanel = false;
  }
}

// ======================================================================
// ====== 10. معالجات الأحداث العامة ======
// ======================================================================

function handleNavigation(target, params = {}) {
  if (window.router?.navigateTo) {
    window.router.navigateTo(target, params);
  } else {
    console.warn('Router غير متاح');
  }
}

function handleViewAllChampions() {
  showAllChampionsModal();
}

// ==== عرض جميع الأبطال في موديل ====
async function showAllChampionsModal() {
  try {
    const allChampions = await getTopStudents(20);

    if (!allChampions || allChampions.length === 0) {
      window.modals?.toast('لا يوجد أبطال حالياً', 'info');
      return;
    }

    let championsHtml = `
  <div class="champions-modal-list">
    <div class="champions-modal-grid">
`;

allChampions.forEach((student, index) => {
  const rank = index + 1;
  let rankIcon = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
  const avatarUrl = student.avatar_url || (student.gender === 'female' ? 'assets/images/G.png' : 'assets/images/M.png');
  championsHtml += `
    <div class="champion-modal-card">
      <div class="champion-modal-rank">${rankIcon}</div>
      <div class="champion-modal-avatar">
        <img src="${avatarUrl}" alt="${escapeHtml(student.full_name)}">
      </div>
      <div class="champion-modal-info">
        <div class="champion-modal-name">${escapeHtml(student.full_name)}</div>
        <div class="champion-modal-score">⭐ ${student.total_score || 0} نقطة</div>
      </div>
    </div>
  `;
});

    championsHtml += `</div></div>`;

    if (window.modals?.showModal) {
      window.modals.showModal({
        title: '🏆 أبطال هذا الأسبوع',
        html: championsHtml,
        size: 'large',
        buttons: [{ text: 'إغلاق', role: 'cancel', type: 'secondary' }]
      });
    } else {
      alert('عذراً، نظام النوافذ غير متاح');
    }
  } catch (error) {
    console.error('فشل تحميل الأبطال:', error);
    window.modals?.toast('حدث خطأ أثناء تحميل قائمة الأبطال', 'error');
  }
}

// ======================================================================
// ====== 11. الكاروسيل ======
// ======================================================================

function initAboutCarousel() {
  // ==== الكاروسيل جزء من قسم "من نحن" التسويقي — يظهر للزائر فقط، فلا داعي لتشغيله لغيره ====
  if ($homeState.roleKey !== ROLE_KEYS.GUEST) return;

  const container = $homeState.container.querySelector(HOME_CONFIG.SELECTORS.ABOUT_CAROUSEL);
  if (!container) return;

  const slides = container.querySelectorAll('.carousel-slide');
  const prevBtn = container.querySelector(HOME_CONFIG.SELECTORS.CAROUSEL_PREV);
  const nextBtn = container.querySelector(HOME_CONFIG.SELECTORS.CAROUSEL_NEXT);
  if (!slides.length) return;

  let currentIndex = 0;
  let autoInterval = null;

  function showSlide(index) {
    slides.forEach((slide, i) => slide.classList.toggle('active', i === index));
    if (prevBtn) prevBtn.disabled = index === 0;
    if (nextBtn) nextBtn.disabled = index === slides.length - 1;
    currentIndex = index;
  }

  function nextSlide() {
    if (currentIndex < slides.length - 1) showSlide(currentIndex + 1);
  }

  function prevSlide() {
    if (currentIndex > 0) showSlide(currentIndex - 1);
  }

  function startAuto() {
    if (autoInterval) clearInterval(autoInterval);
    autoInterval = setInterval(() => {
      if (currentIndex === slides.length - 1) showSlide(0);
      else nextSlide();
    }, HOME_CONFIG.DEFAULTS.CAROUSEL_INTERVAL);
  }

  function stopAuto() {
    if (autoInterval) clearInterval(autoInterval);
    autoInterval = null;
  }

  if (prevBtn) prevBtn.addEventListener('click', () => { stopAuto(); prevSlide(); startAuto(); });
  if (nextBtn) nextBtn.addEventListener('click', () => { stopAuto(); nextSlide(); startAuto(); });

  container.addEventListener('mouseenter', stopAuto);
  container.addEventListener('mouseleave', startAuto);

  showSlide(0);
  startAuto();

  $homeState.intervals.about = autoInterval;
  $homeState.carousels.about = { showSlide, nextSlide, prevSlide, startAuto, stopAuto };
}

// ==== إيقاف كاروسيل "من نحن" (يُستخدم عند تبدّل نوع المستخدم) ====
function stopAboutCarousel() {
  if ($homeState.intervals.about) {
    clearInterval($homeState.intervals.about);
    $homeState.intervals.about = null;
  }
  $homeState.carousels.about = null;
}

// ======================================================================
// ====== 11.ب كاروسيل "مزايا المنصة" — بطاقة مركزية كبيرة + حلقة لا نهائية ======
// ======================================================================
//
// الفكرة: الشريط (fc-track) يحوي نسخة "قبل" كاملة من البطاقات + البطاقات
// الأصلية + نسخة "بعد" كاملة، فتكون هناك دائمًا شريحتان احتياطيتان جاهزتان
// على كل جانب. عند وصول التموضع لأحد الطرفين، تتم "قفزة صامتة" فور انتهاء
// الحركة (transitionend، مع مؤقّت أمان احتياطي) بتعطيل الـtransition للحظة
// واحدة فقط، بحيث لا يلاحظ المستخدم أي وميض لأن كل الشرائح المشتركة في نفس
// realIndex (الأصلية + نسختاها) تحمل is-active معًا دائمًا بصرف النظر عن
// position، فتبديل position أثناء القفزة لا يغيّر أي كلاس فعليًا.
// كل الأحجام تُقرأ من CSS/DOM وقت التشغيل، فالكود لا يفترض أبعادًا ثابتة.
//
// ملاحظة اتجاه: الشريط direction:ltr لأسباب حسابية بحتة، لكن position يزيد
// مع next() ويُطابق زيادة realIndex بنفس الاتجاه — القياس مبني على ذلك في
// كل الدوال (goToPosition / goToRealIndex / السحب)، فلا داعي لعكس ترتيب
// العناصر في الـDOM ولا لعكس اتجاه السحب بشكل منفصل.
//
// التشغيل التلقائي يتوقف تلقائياً عند: تمرير الماوس فوقه (سطح مكتب فقط)،
// دخول التركيز (focus) لأي عنصر بداخله، خروج القسم من نطاق الرؤية، أو
// إخفاء التبويب (visibilitychange) — إضافة لزر إيقاف/تشغيل يدوي صريح
// (متطلب وصولية WCAG 2.2.2 لأي محتوى متحرك تلقائياً).

// ==== كشف دخول قسم المزايا لنطاق الرؤية وتفعيل ظهوره التدريجي (عنوان ثم الكاروسيل) —
// يُفعَّل مرة واحدة فقط ثم يُفصل نفسه. كلاس is-revealed مستقل تماماً عن is-visible
// (الذي تتحكم فيه بوابة الأدوار applyRoleGates) لتفادي تعارضهما ====
function initFeaturesReveal(sectionEl) {
  if (!sectionEl) return null;
  if (sectionEl.classList.contains('is-revealed')) return null;

  if (!('IntersectionObserver' in window)) {
    sectionEl.classList.add('is-revealed');
    return null;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      sectionEl.classList.add('is-revealed');
      observer.disconnect();
    });
  }, { threshold: 0.2, rootMargin: '0px 0px -80px 0px' });

  observer.observe(sectionEl);
  return observer;
}

function initFeaturesCarousel() {
  // ==== قسم المزايا تسويقي للزائر فقط — لا داعي لتشغيل الكاروسيل لغيره ====
  if ($homeState.roleKey !== ROLE_KEYS.GUEST) return;

  const root = $homeState.container.querySelector(HOME_CONFIG.SELECTORS.FEATURES_CAROUSEL);
  if (!root) return;

  const sectionEl = $homeState.container.querySelector(HOME_CONFIG.SELECTORS.FEATURES_SECTION);
  const revealObserver = initFeaturesReveal(sectionEl);

  const viewport = root.querySelector('.fc-viewport');
  const track = root.querySelector('.fc-track');
  const prevBtn = root.querySelector('.fc-arrow-prev');
  const nextBtn = root.querySelector('.fc-arrow-next');
  const dotsWrap = root.querySelector('.fc-dots');
  const toggleBtn = root.querySelector('.fc-toggle-auto');
  if (!viewport || !track || !dotsWrap) {
    if (revealObserver) revealObserver.disconnect();
    return;
  }

  const originalSlides = Array.from(track.querySelectorAll('.fc-slide'));
  const count = originalSlides.length;
  // ==== كاروسيل بمنطق "3 بطاقات + حلقة لا نهائية" غير مجدٍ بأقل من 3 بطاقات حقيقية ====
  if (count < 3) {
    if (revealObserver) revealObserver.disconnect();
    return;
  }

  const cfg = HOME_CONFIG.FEATURES_CAROUSEL;
  // ==== كل مستمعي الأحداث المضافة هنا مربوطة بهذا الـcontroller — إلغاء واحد
  // يفكّ الجميع دفعة واحدة، فلا تتراكم نسخ مكررة عند إعادة التهيئة (تبدّل دور) ====
  const ac = new AbortController();
  const { signal } = ac;

  function cloneSlideSet() {
    return originalSlides.map(slide => {
      const clone = slide.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      // ==== منع تكرار أي id داخل النسخ المستنسخة (لا حاجة لها أصلاً هنا) ====
      clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
      clone.querySelectorAll('a[href], button').forEach(el => el.setAttribute('tabindex', '-1'));
      return clone;
    });
  }

  const beforeClones = cloneSlideSet();
  const afterClones = cloneSlideSet();
  const fragBefore = document.createDocumentFragment();
  beforeClones.forEach(c => fragBefore.appendChild(c));
  track.insertBefore(fragBefore, track.firstChild);
  const fragAfter = document.createDocumentFragment();
  afterClones.forEach(c => fragAfter.appendChild(c));
  track.appendChild(fragAfter);

  const allSlides = Array.from(track.querySelectorAll('.fc-slide'));
  allSlides.forEach((s, i) => {
    s.setAttribute('role', 'group');
    s.setAttribute('aria-roledescription', 'slide');
    s.setAttribute('aria-label', `${(i % count) + 1} من ${count}`);
  });

  // ==== موضع الشريحة النشطة داخل الشريط الممتد؛ تبدأ من منتصف النسخة الأصلية ====
  let position = count;
  let realIndex = 0;
  let autoTimer = null;
  let transitionSafetyTimer = null;
  let resizeObserver = null;
  let lastViewportWidth = 0;
  let isTransitioning = false;
  let isDragging = false;
  let dragStartX = 0;
  let dragDeltaX = 0;
  let dragStartTime = 0;
  // ==== حالات توقف التشغيل التلقائي: تحويم الماوس / التركيز الداخلي / خروج القسم
  // من نطاق الرؤية / إخفاء التبويب / إيقاف يدوي صريح عبر الزر ====
  let isHovering = false;
  let hasFocusInside = false;
  let sectionInView = true;
  let isManuallyPaused = false;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ==== بناء مؤشرات التنقل (نقطة واحدة لكل بطاقة حقيقية) ====
  dotsWrap.innerHTML = '';
  const dots = originalSlides.map((_, i) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'fc-dot';
    dot.setAttribute('role', 'tab');
    dot.setAttribute('aria-label', `عرض الميزة رقم ${i + 1}`);
    dot.addEventListener('click', () => { goToRealIndex(i); restartAutoIfIdle(); }, { signal });
    dotsWrap.appendChild(dot);
    return dot;
  });

  function updateDots() {
    dots.forEach((d, i) => {
      const active = i === realIndex;
      d.classList.toggle('is-active', active);
      d.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  // ==== is-active يُحسب من realIndex فقط (وليس position)، فالنسخ الثلاث
  // (قبل/أصلي/بعد) المطابقة لنفس الميزة تحمل الكلاس معاً دائماً — بالتالي
  // "القفزة الصامتة" (position ± count) لا تُحدث أي تغيير في الكلاسات ====
  function updateActiveClasses() {
    allSlides.forEach((s, i) => {
      const active = ((i % count) + count) % count === realIndex;
      s.classList.toggle('is-active', active);
      s.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
  }

  // ==== قياس عرض "الخانة" (البطاقة + الفراغ بينها وبين جارتها) وقت التشغيل ====
  // ==== padding-inline على fc-slide هو نفسه مصدر الفجوة بين الكروت (مش margin)،
  // وهو بالتالي محسوب أصلاً داخل rect.width (border-box). إضافته مرة تانية كانت
  // بتُضخّم قياس الخانة، فيتراكم الفرق مع كل خطوة position ويزيح الشريط كله
  // يساراً — الإصلاح: نعتمد على rect.width وحده كما هو ====
  function slotStep() {
    const sample = allSlides[position] || allSlides[0];
    return sample.getBoundingClientRect().width;
  }

  function baseOffset(step) {
    const viewportWidth = viewport.getBoundingClientRect().width;
    return (viewportWidth - step) / 2 - position * step;
  }

  function render(withTransition) {
    const step = slotStep();
    if (!step) return;
    track.classList.toggle('fc-no-transition', !withTransition || prefersReducedMotion);
    track.style.transform = `translate3d(${baseOffset(step)}px, 0, 0)`;
    updateActiveClasses();
  }

  function goToPosition(newPosition) {
    if (isTransitioning) return;
    isTransitioning = true;
    position = newPosition;
    realIndex = ((position % count) + count) % count;
    render(true);
    updateDots();
    if (prefersReducedMotion) {
      // ==== بدون transitionend فعلي حين تكون الحركة معطّلة — نُنهي الانتقال فورًا ====
      isTransitioning = false;
      snapIfNeeded();
      return;
    }
    // ==== مؤقّت أمان احتياطي: لو transitionend لم يصل لأي سبب (مثال: إلغاء
    // الحركة بفعل تغيّر مقاس متزامن)، نُنهي الانتقال يدوياً بدل التجمّد ====
    clearTimeout(transitionSafetyTimer);
    transitionSafetyTimer = setTimeout(() => {
      if (!isTransitioning) return;
      isTransitioning = false;
      snapIfNeeded();
    }, cfg.TRANSITION_MS + 150);
  }

  // ==== "القفزة الصامتة" إلى الموضع المكافئ داخل النطاق الآمن (بدون أي أثر مرئي،
  // لأن is-active يعتمد على realIndex الثابت أثناء القفزة) ====
  function snapIfNeeded() {
    if (position >= count * 2) {
      position -= count;
      render(false);
    } else if (position < count) {
      position += count;
      render(false);
    } else {
      return;
    }
    if (!prefersReducedMotion) {
      requestAnimationFrame(() => requestAnimationFrame(() => track.classList.remove('fc-no-transition')));
    }
  }

  function handleTransitionEnd(e) {
    if (e.target !== track) return;
    clearTimeout(transitionSafetyTimer);
    isTransitioning = false;
    snapIfNeeded();
  }

  // ==== position يزيد مع next() ويُنقص مع prev()، ويُطابق ذلك زيادة/نقصان
  // realIndex بنفس الاتجاه (لأن realIndex = position mod count) — كل حسابات
  // الاتجاه (النقاط، السحب) مبنية على هذه القاعدة الموحّدة ====
  function next() { goToPosition(position + 1); }
  function prev() { goToPosition(position - 1); }

  function goToRealIndex(targetRealIndex) {
    const delta = ((targetRealIndex - realIndex) % count + count) % count;
    if (delta === 0) return;
    // ==== أقصر مسار نحو الهدف — بنفس اتجاه next() (زيادة position) أو prev() (نقصانه) ====
    if (delta <= count - delta) goToPosition(position + delta);
    else goToPosition(position - (count - delta));
  }

  // ==== يشغّل التلقائي فقط لو محدش أوقفه يدوياً/بالتحويم/بالتركيز، والقسم
  // ظاهر فعلاً، والتبويب مرئي، ومفيش تفضيل لتقليل الحركة ====
  function startAuto() {
    stopAutoTimerOnly();
    if (prefersReducedMotion || isManuallyPaused || isHovering || hasFocusInside) return;
    if (!sectionInView || document.hidden) return;
    autoTimer = setInterval(next, cfg.HOLD_MS);
    $homeState.intervals.features = autoTimer;
  }

  function stopAutoTimerOnly() {
    if (autoTimer) clearInterval(autoTimer);
    autoTimer = null;
    $homeState.intervals.features = null;
  }

  // ==== يُستخدم بعد تفاعل يدوي (سهم/نقطة/سحب) ليعاود التشغيل التلقائي
  // فقط لو لم يكن المستخدم قد أوقفه يدوياً عبر زر الإيقاف ====
  function restartAutoIfIdle() {
    if (isManuallyPaused) return;
    startAuto();
  }

  function updateToggleBtnUI() {
    if (!toggleBtn) return;
    const playing = !!autoTimer;
    toggleBtn.classList.toggle('is-paused', !playing);
    toggleBtn.setAttribute('aria-label', playing ? 'إيقاف التبديل التلقائي للمزايا' : 'تشغيل التبديل التلقائي للمزايا');
    const icon = toggleBtn.querySelector('i');
    if (icon) icon.className = playing ? 'fas fa-pause' : 'fas fa-play';
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      isManuallyPaused = !isManuallyPaused;
      if (isManuallyPaused) stopAutoTimerOnly();
      else startAuto();
      updateToggleBtnUI();
    }, { signal });
  }

  // ==== الأسهم ====
  if (prevBtn) prevBtn.addEventListener('click', () => { prev(); restartAutoIfIdle(); }, { signal });
  if (nextBtn) nextBtn.addEventListener('click', () => { next(); restartAutoIfIdle(); }, { signal });

  // ==== تنقّل بلوحة المفاتيح داخل الكاروسيل (يمين/يسار) ====
  root.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); prev(); restartAutoIfIdle(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); next(); restartAutoIfIdle(); }
  }, { signal });

  // ==== السحب باللمس/الفأرة (يعمل فوق الحركة التلقائية دون تعارض) ====
  function pointerX(e) { return e.touches ? e.touches[0].clientX : e.clientX; }

  function onPointerDown(e) {
    // ==== تجاهل غير زر الفأرة الأيسر (يمين/أوسط ممكن ما يوصلوش mouseup) ====
    if (e.type === 'mousedown' && e.button !== 0) return;
    if (isTransitioning) return;
    isDragging = true;
    dragStartX = pointerX(e);
    dragDeltaX = 0;
    dragStartTime = performance.now();
    stopAutoTimerOnly();
    track.classList.add('fc-no-transition');
    viewport.classList.add('is-grabbing');
  }

  function onPointerMove(e) {
    if (!isDragging) return;
    const x = pointerX(e);
    dragDeltaX = x - dragStartX;
    const step = slotStep();
    track.style.transform = `translate3d(${baseOffset(step) + dragDeltaX}px, 0, 0)`;
  }

  function onPointerUp() {
    if (!isDragging) return;
    isDragging = false;
    track.classList.remove('fc-no-transition');
    viewport.classList.remove('is-grabbing');
    // ==== السرعة المتوسطة الفعلية للسحب كله (وليس آخر لحظة فقط) — تفادياً
    // لاحتساب رعشة الفأرة البسيطة كـ"فليك" سريع ====
    const elapsed = Math.max(performance.now() - dragStartTime, 1);
    const avgVelocity = dragDeltaX / elapsed;
    const distancePastThreshold = Math.abs(dragDeltaX) > cfg.SWIPE_THRESHOLD_PX;
    const fastFlick = Math.abs(dragDeltaX) > 12 && Math.abs(avgVelocity) > cfg.SWIPE_VELOCITY;
    if (distancePastThreshold || fastFlick) {
      // ==== dragDeltaX سالب = المحتوى تحرّك يساراً مع الإصبع/الفأرة = next()
      // (next تزيد position فتحرّك الشريط يساراً بنفس المنطق) ====
      if (dragDeltaX < 0) next(); else prev();
    } else {
      render(true);
    }
    restartAutoIfIdle();
  }

  viewport.addEventListener('touchstart', onPointerDown, { passive: true, signal });
  viewport.addEventListener('touchmove', onPointerMove, { passive: true, signal });
  viewport.addEventListener('touchend', onPointerUp, { signal });
  viewport.addEventListener('touchcancel', onPointerUp, { signal });
  viewport.addEventListener('mousedown', onPointerDown, { signal });
  window.addEventListener('mousemove', onPointerMove, { signal });
  window.addEventListener('mouseup', onPointerUp, { signal });

  // ==== إيقاف مؤقت عند مرور الفأرة فوق الكاروسيل على سطح المكتب فقط —
  // على الهاتف بعض المتصفحات تطلق mouseenter وهمي بعد اللمس بدون mouseleave يقابله،
  // فكان بيوقف التشغيل التلقائي نهائيًا؛ لذلك نربط هذا السلوك بأجهزة الماوس الحقيقية فقط ====
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    root.addEventListener('mouseenter', () => { isHovering = true; stopAutoTimerOnly(); }, { signal });
    root.addEventListener('mouseleave', () => { isHovering = false; restartAutoIfIdle(); }, { signal });
  }

  // ==== إيقاف مؤقت عند دخول التركيز (تصفّح بلوحة المفاتيح) داخل الكاروسيل ====
  root.addEventListener('focusin', () => { hasFocusInside = true; stopAutoTimerOnly(); }, { signal });
  root.addEventListener('focusout', () => {
    // ==== نتأكد إن التركيز خرج فعلاً من كل الكاروسيل مش انتقل لعنصر جواه ====
    requestAnimationFrame(() => {
      if (!root.contains(document.activeElement)) {
        hasFocusInside = false;
        restartAutoIfIdle();
      }
    });
  }, { signal });

  // ==== إيقاف عند إخفاء التبويب، وإعادة تشغيل عند العودة (لو القسم ما زال ظاهراً) ====
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopAutoTimerOnly();
    else restartAutoIfIdle();
  }, { signal });

  // ==== إيقاف عند خروج القسم من نطاق الرؤية (تمرير بعيد) وإعادة التشغيل عند عودته ====
  const playObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      sectionInView = entry.isIntersecting;
      if (sectionInView) restartAutoIfIdle();
      else stopAutoTimerOnly();
    });
  }, { threshold: 0.15 });
  if (sectionEl) playObserver.observe(sectionEl);

  track.addEventListener('transitionend', handleTransitionEnd, { signal });

  // ==== إعادة القياس عند تغيّر حجم الشاشة دون أي حركة مفاجئة — نتجاهل أي تغيير
  // لا يمس العرض فعلياً (مثال: تغيّر ارتفاع نتيجة تبديل is-active) حتى لا نُلغي
  // ترانزيشن جارٍ بلا داعٍ ====
  function handleResize(width) {
    if (Math.abs(width - lastViewportWidth) < 1) return;
    lastViewportWidth = width;
    render(false);
  }
  if (window.ResizeObserver) {
    resizeObserver = new ResizeObserver((entries) => handleResize(entries[0].contentRect.width));
    resizeObserver.observe(viewport);
  } else {
    window.addEventListener('resize', () => handleResize(viewport.getBoundingClientRect().width), { signal });
  }

  render(false);
  lastViewportWidth = viewport.getBoundingClientRect().width;
  updateDots();
  updateToggleBtnUI();
  startAuto();

  function destroy() {
    stopAutoTimerOnly();
    clearTimeout(transitionSafetyTimer);
    ac.abort();
    if (resizeObserver) resizeObserver.disconnect();
    if (revealObserver) revealObserver.disconnect();
    playObserver.disconnect();
    beforeClones.forEach(c => c.remove());
    afterClones.forEach(c => c.remove());
  }

  $homeState.carousels.features = { next, prev, goToRealIndex, startAuto, stopAuto: stopAutoTimerOnly, destroy };
}

// ==== إيقاف كاروسيل المزايا وتفكيك ما أُنشئ من نسخ (يُستخدم عند تبدّل الدور أو مغادرة الصفحة) ====
function stopFeaturesCarousel() {
  if ($homeState.carousels.features && typeof $homeState.carousels.features.destroy === 'function') {
    $homeState.carousels.features.destroy();
  }
  if ($homeState.intervals.features) {
    clearInterval($homeState.intervals.features);
    $homeState.intervals.features = null;
  }
  $homeState.carousels.features = null;
}


// ======================================================================
// ====== 12. التهيئة الرئيسية ======
// ======================================================================

// ==== تحميل كل الأقسام التي يعتمد محتواها على نوع المستخدم الحالي ====
function loadRoleDependentSections(forceRefresh = false) {
  loadPlatformStats(forceRefresh);
  loadAnnouncements(forceRefresh);
  loadRecommendedLessons(forceRefresh);

  if ($homeState.roleKey === ROLE_KEYS.STUDENT) {
    loadStudentPanel($homeState.currentUser);
  } else if ($homeState.roleKey === ROLE_KEYS.TEACHER) {
    loadStaffPanel($homeState.roleKey);
  }
}

export function initializePage(container, params = {}) {
  if ($homeState.isInitialized && $homeState.container === container) {
    console.log('🏠 الصفحة الرئيسية مُهيأة مسبقاً');
    return;
  }

  console.log('🏠 تهيئة الصفحة الرئيسية v6.0.0...');
  $homeState.container = container;
  $homeState.currentUser = getCurrentUser();
  $homeState.roleKey = resolveUserRole($homeState.currentUser);

  // ==== 🚪 تطبيق بوابات الأدوار فوراً قبل أي شيء آخر (لا وميض/Flash) ====
  applyRoleGates(container, $homeState.roleKey);
  renderMemberHeader(container, $homeState.currentUser, $homeState.roleKey);

  // ==== تحديث شارة Streak ====
  updateUserStreak($homeState.currentUser);

  // ==== تحميل الأقسام المشتركة بين كل الأدوار (لا تعتمد على الدور) ====
  loadTopChampions();

  // ==== تحميل الأقسام المعتمدة على نوع المستخدم (تشمل الإعلانات) ====
  loadRoleDependentSections();

  // ==== تهيئة كاروسيل "من نحن" (يعمل فقط عندما يكون ظاهراً للزائر) ====
  initAboutCarousel();

  // ==== تهيئة كاروسيل مزايا المنصة (يعمل فقط عندما يكون ظاهراً للزائر) ====
  initFeaturesCarousel();

  // 🛠️ إصلاح ترابط: مساري /favorites و/notifications في router.js كانا يعرضان
  // بالضبط نفس الصفحة الرئيسية العادية بدون أي تمييز (initializePage لم يكن يقرأ
  // params ولا اسم المسار الحالي إطلاقاً).
  const currentRouteName = getCurrentRoute()?.name;
  if (currentRouteName === 'notifications') {
    // نظام الإشعارات (notifications.js) يعرّض واجهة برمجية جاهزة على window تحديدًا لهذا الغرض
    window.notificationsAPI?.open?.();
  } else if (currentRouteName === 'favorites') {
    // ⚠️ لا يوجد حاليًا أي قسم/عنصر واجهة مخصص لعرض "الدروس المحفوظة" في home.html أو home.js
    // (لا توجد ولا إشارة واحدة لكلمة favorite في الملف بأكمله رغم وجود getUserFavorites/
    // syncUserFavorites جاهزتين في api.js). هذا يحتاج قرار تصميم + إضافة واجهة كاملة،
    // وليس مجرد إصلاح حدث — لم نفترض شكلها تفاديًا لأي افتراض غير موثّق.
    console.warn('⚠️ مسار /favorites لا يملك واجهة مخصصة بعد داخل home.js — يحتاج تصميم وتنفيذ منفصلين.');
  }

  // ==== بناء وتحميل قسم آراء الطلاب ====
  buildTestimonialsUI();
  loadTestimonialsComments(false);

  // ==== ربط أزرار الترحيب والاختصارات (Array.from لأن بعض data-action تتكرر أكثر من مرة) ====
  const startBtns = container.querySelectorAll(HOME_CONFIG.SELECTORS.WELCOME_BTN_START);
  const exploreBtns = container.querySelectorAll(HOME_CONFIG.SELECTORS.WELCOME_BTN_EXPLORE);
  const viewAllChampionsBtn = container.querySelector(HOME_CONFIG.SELECTORS.VIEW_ALL_CHAMPIONS_BTN);

  startBtns.forEach(btn => btn.addEventListener('click', () => handleNavigation('lessons')));
  exploreBtns.forEach(btn => btn.addEventListener('click', () => handleNavigation('lessons')));
  const registerBtns = container.querySelectorAll('[data-action="register-now"]');
  const watchIntroBtn = container.querySelector('[data-action="watch-intro"]');
  registerBtns.forEach(btn => btn.addEventListener('click', () => handleNavigation('register')));
  if (watchIntroBtn) watchIntroBtn.addEventListener('click', () => handleNavigation('home'));
  if (viewAllChampionsBtn) viewAllChampionsBtn.addEventListener('click', handleViewAllChampions);

  // ==== أزرار لوحتي الطالب وطاقم العمل ====
  container.querySelectorAll(HOME_CONFIG.SELECTORS.WELCOME_BTN_EXAMS).forEach(btn =>
    btn.addEventListener('click', () => handleNavigation('exams'))
  );
  container.querySelectorAll(HOME_CONFIG.SELECTORS.WELCOME_BTN_DASHBOARD).forEach(btn =>
    btn.addEventListener('click', () => handleNavigation('dashboard'))
  );
  container.querySelectorAll(HOME_CONFIG.SELECTORS.WELCOME_BTN_GROUPS).forEach(btn =>
    btn.addEventListener('click', () => handleNavigation('groups'))
  );

  // ==== الاشتراك في أحداث EventBus ====
  const unsubUser = EventBus.on('userStateChanged', (detail) => {
    if (detail.action === 'login' || detail.action === 'logout') {
      $homeState.currentUser = getCurrentUser();
      $homeState.roleKey = resolveUserRole($homeState.currentUser);

      // ==== 🚪 إعادة تطبيق بوابات الأدوار فوراً عند تغيّر حالة الدخول ====
      applyRoleGates($homeState.container, $homeState.roleKey);
      renderMemberHeader($homeState.container, $homeState.currentUser, $homeState.roleKey);
      updateUserStreak($homeState.currentUser);

      // ==== كاروسيل "من نحن" ومزايا المنصة يظهران للزائر فقط — يُعاد تقييمهما مع كل تبدّل دور ====
      stopAboutCarousel();
      initAboutCarousel();
      stopFeaturesCarousel();
      initFeaturesCarousel();

      loadRoleDependentSections(true);

      // ==== إعادة بناء قسم التعليقات ليعكس حالة المستخدم ====
      $homeState.comments.list = [];
      $homeState.comments.repliesCache.clear();
      buildTestimonialsUI();
      loadTestimonialsComments(false);
    }
  });
  $homeState.eventUnsubscribers.push(unsubUser);

  const unsubExamComplete = EventBus.on('exam:complete', () => {
    loadTopChampions(true);
    // ==== احتمال تغيّر إحصائيات الطالب الشخصية بعد إنهاء امتحان ====
    if ($homeState.roleKey === ROLE_KEYS.STUDENT) {
      loadStudentPanel($homeState.currentUser);
    }
  });
  $homeState.eventUnsubscribers.push(unsubExamComplete);

  const unsubCommentAdded = EventBus.on('comment:added', ({ lessonId }) => {
    // ==== تحديث التعليقات فقط إذا كان الحدث للصفحة الرئيسية (lessonId = null) ====
    if (!lessonId) loadTestimonialsComments(false);
  });
  $homeState.eventUnsubscribers.push(unsubCommentAdded);

  const unsubCommentDeleted = EventBus.on('comment:deleted', () => {
    updateCommentsCountDisplay();
  });
  $homeState.eventUnsubscribers.push(unsubCommentDeleted);

  // 🛠️ إصلاح ترابط: إعادة تحميل الدروس المقترحة فوراً لو الأدمن غيّر الفصل الدراسي
  // النشط وهو الطالب فاتح الصفحة الرئيسية بالفعل
  const unsubSemesterChanged = EventBus.on('semester:active-changed', () => {
    if ($homeState.roleKey === ROLE_KEYS.STUDENT) {
      loadRecommendedLessons(true);
    }
  });
  $homeState.eventUnsubscribers.push(unsubSemesterChanged);

  $homeState.isInitialized = true;
  console.log('✅ الصفحة الرئيسية جاهزة v6.0.0 — الدور الحالي:', $homeState.roleKey);
}

// ======================================================================
// ====== 13. التنظيف ======
// ======================================================================

export function cleanupPage() {
  console.log('🧹 تنظيف الصفحة الرئيسية...');

  // ==== إلغاء الاشتراكات ====
  $homeState.eventUnsubscribers.forEach(unsub => unsub());
  $homeState.eventUnsubscribers = [];

  // ==== إيقاف الكاروسيلات ====
  if ($homeState.intervals.about) clearInterval($homeState.intervals.about);
  stopFeaturesCarousel();

  // ==== إزالة مستمعي التعليقات ====
  const cs = $homeState.comments;
  const handlers = cs.boundHandlers;
  const els = cs.elements;

  if (els.submitBtn && handlers.has('submit')) {
    els.submitBtn.removeEventListener('click', handlers.get('submit'));
  }
  if (els.cancelReplyBtn && handlers.has('cancelReply')) {
    els.cancelReplyBtn.removeEventListener('click', handlers.get('cancelReply'));
  }
  if (els.loadMoreBtn && handlers.has('loadMore')) {
    els.loadMoreBtn.removeEventListener('click', handlers.get('loadMore'));
  }
  handlers.clear();

  // ==== إعادة ضبط الحالة ====
  $homeState.isInitialized = false;
  $homeState.container = null;
  $homeState.currentUser = null;
  $homeState.roleKey = ROLE_KEYS.GUEST;
  $homeState.cache = {
    stats: null, champions: null, testimonials: null,
    announcements: null, recommended: null
  };
  $homeState.carousels = { about: null, features: null };
  $homeState.intervals = { about: null, features: null };
  $homeState.cleanupFns = [];
  $homeState.isLoading = {
    stats: false, champions: false, testimonials: false,
    announcements: false, recommended: false,
    studentPanel: false, staffPanel: false
  };
  $homeState.comments = {
    list: [],
    lastDoc: null,
    hasMore: false,
    isLoading: false,
    repliesCache: new Map(),
    elements: {
      section: null, list: null, textarea: null,
      submitBtn: null, cancelReplyBtn: null,
      loadMoreBtn: null, replyParentId: null
    },
    boundHandlers: new Map()
  };

  console.log('✅ تم تنظيف الصفحة الرئيسية');
}

// ====== 14. تصدير الواجهة العامة ======
export default {
  initializePage,
  cleanupPage
};
