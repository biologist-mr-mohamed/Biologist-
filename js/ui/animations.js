/**
 * ✨ js/ui/animations.js - نظام الحركات والانتقالات المتكامل v5.0.0
 * ============================================================================
 * 📝 المسؤولية: واجهة موحدة لإدارة جميع التأثيرات الحركية في منصة بيولوجست.
 * ✅ الميزات:
 *   - انتقالات صفحات مخصصة لكل نوع (home, lessons, exams, profile, dashboard, auth)
 *   - حركات مكونات (Modal, Drawer RTL, Notifications, Toast, Navbar, BottomNav)
 *   - تفاعلات دقيقة (Ripple, Pulse, Shake, Bounce, Flip, Glow, Counter)
 *   - تأثيرات Stagger للقوائم والبطاقات
 *   - تأثيرات Skeleton Loading للتحميل
 *   - حركات خاصة بالمنصة (Streak, Medal, Badge, Avatar)
 *   - تأثيرات التمرير (Reveal, Parallax) مع MutationObserver للعناصر الديناميكية
 *   - احترام (prefers-reduced-motion) بشكل كامل
 *   - تكامل مع EventBus، Theme، Router
 *   - دعم RTL كامل في جميع الحركات
 * ============================================================================
 */

import { EventBus } from '../core/event-bus.js';

// ====== 1. الثوابت والتكوين ======
const CONFIG = {
  DEFAULT_DURATION: 300,
  FAST_DURATION: 180,
  SLOW_DURATION: 500,
  SPRING_EASING: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  EASE_OUT: 'cubic-bezier(0.2, 0.9, 0.4, 1)',
  EASE_IN: 'cubic-bezier(0.5, 0, 0.5, 1)',
  EASE_STANDARD: 'cubic-bezier(0.4, 0.0, 0.2, 1)',
  REDUCED_MOTION_DURATION: 1,
  STAGGER_DELAY: 60,
  COUNTER_STEPS: 40,

  SELECTORS: {
    pageContainer: '#app-router-view',
    modal: '.modal',
    drawer: '.sidebar',
    notificationPanel: '#notifications-panel',
    toastContainer: '#toast-container',
    // 🛠️ إصلاح ترابط: كانت القيم .bottom-navbar/.top-navbar لا تطابق كلاسات
    // العناصر الفعلية في index.html (.bottom-navigation و .navbar-top).
    // لا يوجد حاليًا استخدام فعلي لهذين المفتاحين في الملف، لكن تم تصحيحهما
    // تحسبًا لأي استخدام مستقبلي.
    bottomNav: '.bottom-navigation',
    topNav: '.navbar-top',
    streakBadge: '.streak-badge',
    card: '.lesson-card, .exam-card, .group-card',
    skeletonItem: '.skeleton-item'
  },

  CLASSES: {
    // انتقالات الصفحات
    PAGE_ENTER: 'page-enter',
    PAGE_EXIT: 'page-exit',
    PAGE_ACTIVE: 'page-active',

    // المودال
    MODAL_VISIBLE: 'modal-visible',
    MODAL_CLOSING: 'modal-closing',

    // الدرج الجانبي
    DRAWER_OPEN: 'drawer-open',

    // الإشعارات
    NOTIF_POP: 'notification-pop',

    // التوست
    TOAST_VISIBLE: 'toast-visible',
    TOAST_HIDING: 'toast-hiding',

    // التفاعلات الدقيقة
    RIPPLE: 'ripple-effect',
    PULSE: 'pulse-animation',
    SHAKE: 'shake-animation',
    BOUNCE: 'bounce-animation',
    SPIN: 'spin-animation',
    GLOW: 'glow-animation',
    FLIP: 'flip-animation',

    // التمرير
    REVEAL: 'reveal-on-scroll',
    REVEALED: 'revealed',
    PARALLAX: 'parallax',

    // تأثيرات المنصة
    STREAK_POP: 'streak-pop',
    MEDAL_DROP: 'medal-drop',
    BADGE_UNLOCK: 'badge-unlock',
    SCORE_FLASH: 'score-flash',
    AVATAR_RING: 'avatar-ring-animate',

    // Skeleton
    SKELETON: 'skeleton',
    SKELETON_WAVE: 'skeleton-wave',
    SKELETON_READY: 'skeleton-ready'
  },

  EVENTS: {
    PAGE_CHANGED: 'pageChanged',
    // 🛠️ إصلاح ترابط: modals.js يُصدر فعلياً 'modal:opened' / 'modal:closed' (صيغة الماضي)
    // وليس 'modal:open' / 'modal:close' — الاسم القديم لم يكن يتطابق أبداً فتوقفت أنيميشن المودال.
    MODAL_OPEN: 'modal:opened',
    MODAL_CLOSE: 'modal:closed',
    DRAWER_TOGGLE: 'drawer:toggle',
    NOTIFICATION_ADD: 'notification:add',
    TOAST_SHOW: 'toast:show',
    STREAK_UPDATED: 'streak:updated',
    MEDAL_EARNED: 'medal:earned'
    // 🛠️ تمت إزالة ROUTE_CHANGED ('route:changed'): لم يكن يُصدَر من أي مكان في التطبيق،
    // وكان مكرراً وظيفياً مع PAGE_CHANGED (نفس منطق إعادة مسح Reveal). استخدم PAGE_CHANGED فقط.
  }
};

// ====== 2. الحالة الداخلية ======
let state = {
  initialized: false,
  reduceMotion: false,
  isRTL: true,
  intersectionObserver: null,
  mutationObserver: null,
  scrollHandlers: new Map(),
  eventUnsubscribers: [],
  activeAnimations: new Set(),
  parallaxElements: []
};

// ====== 3. دوال مساعدة أساسية ======

// تحقق من تفضيلات تقليل الحركة
function checkReduceMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  state.reduceMotion = mq.matches;
  mq.addEventListener('change', (e) => {
    state.reduceMotion = e.matches;
  });
  return state.reduceMotion;
}

// تحقق من اتجاه RTL
function checkRTL() {
  state.isRTL = document.documentElement.dir === 'rtl' ||
    document.body.dir === 'rtl' ||
    getComputedStyle(document.documentElement).direction === 'rtl';
  return state.isRTL;
}

// مدة الحركة مع مراعاة تقليل الحركة
function getDuration(duration = CONFIG.DEFAULT_DURATION) {
  return state.reduceMotion ? CONFIG.REDUCED_MOTION_DURATION : duration;
}

// إشارة الاتجاه للحركات الأفقية (RTL = +1، LTR = -1)
function rtlSign() {
  return state.isRTL ? 1 : -1;
}

// تطبيق حركة على عنصر مع Promise
function animateElement(element, keyframes, options = {}) {
  if (!element) return Promise.resolve();

  const duration = getDuration(options.duration ?? CONFIG.DEFAULT_DURATION);
  const easing = options.easing || CONFIG.EASE_STANDARD;

  // تطبيق الحالة النهائية فوراً عند تقليل الحركة
  if (state.reduceMotion) {
    const last = Array.isArray(keyframes) ? keyframes[keyframes.length - 1] : keyframes;
    if (last && typeof last === 'object') {
      Object.entries(last).forEach(([prop, val]) => {
        if (prop !== 'offset') element.style[prop] = val;
      });
    }
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const animId = Symbol('anim');
    state.activeAnimations.add(animId);

    const animation = element.animate(keyframes, {
      duration,
      easing,
      fill: options.fill || 'forwards',
      delay: options.delay || 0,
      iterations: options.iterations || 1,
      direction: options.direction || 'normal'
    });

    const finish = () => {
      state.activeAnimations.delete(animId);
      if (options.cleanup) options.cleanup();
      resolve();
    };

    animation.onfinish = finish;
    animation.oncancel = finish;

    // Fallback للمتصفحات التي لا تُنهي onfinish
    setTimeout(finish, duration + (options.delay || 0) + 50);
  });
}

// إضافة كلاس مؤقت
function addTempClass(element, className, duration) {
  if (!element) return;
  element.classList.add(className);
  setTimeout(() => element.classList.remove(className), getDuration(duration));
}

// Stagger: تأخير متسلسل للعناصر
async function staggerElements(elements, animateFn, delayBetween = CONFIG.STAGGER_DELAY) {
  if (!elements || !elements.length) return;
  const delay = state.reduceMotion ? 0 : delayBetween;
  const promises = Array.from(elements).map((el, i) => {
    return new Promise(resolve => {
      setTimeout(() => animateFn(el).then(resolve), i * delay);
    });
  });
  await Promise.all(promises);
}

// ====== 4. انتقالات الصفحات ======

// حركة دخول الصفحة حسب نوعها
export async function enterPage(pageType, container) {
  if (!container) container = document.querySelector(CONFIG.SELECTORS.pageContainer);
  if (!container) return;

  container.classList.remove(CONFIG.CLASSES.PAGE_EXIT);
  container.classList.add(CONFIG.CLASSES.PAGE_ENTER);

  const keyframes = _getEnterKeyframes(pageType);
  await animateElement(container, keyframes, {
    duration: 420,
    easing: CONFIG.EASE_OUT
  });

  container.classList.add(CONFIG.CLASSES.PAGE_ACTIVE);
  container.classList.remove(CONFIG.CLASSES.PAGE_ENTER);

  // تشغيل Reveal بعد دخول الصفحة
  setTimeout(() => _scanRevealElements(), 80);
}

// حركة خروج الصفحة
export async function exitPage(pageType, container) {
  if (!container) container = document.querySelector(CONFIG.SELECTORS.pageContainer);
  if (!container) return;

  container.classList.add(CONFIG.CLASSES.PAGE_EXIT);
  container.classList.remove(CONFIG.CLASSES.PAGE_ACTIVE, CONFIG.CLASSES.PAGE_ENTER);

  await animateElement(container, _getExitKeyframes(pageType), {
    duration: 220,
    easing: CONFIG.EASE_IN
  });

  container.classList.remove(CONFIG.CLASSES.PAGE_EXIT);
}

// keyframes الدخول حسب نوع الصفحة
function _getEnterKeyframes(pageType) {
  const sign = rtlSign();
  switch (pageType) {
    case 'home':
      return [
        { opacity: 0, transform: 'translateY(18px)' },
        { opacity: 1, transform: 'translateY(0)' }
      ];
    case 'lessons':
    case 'exams':
      return [
        { opacity: 0, transform: `translateX(${24 * sign}px)` },
        { opacity: 1, transform: 'translateX(0)' }
      ];
    case 'profile':
      return [
        { opacity: 0, transform: 'scale(0.97) translateY(12px)' },
        { opacity: 1, transform: 'scale(1) translateY(0)' }
      ];
    case 'dashboard':
      return [
        { opacity: 0, transform: `translateX(${-24 * sign}px)` },
        { opacity: 1, transform: 'translateX(0)' }
      ];
    case 'auth':
      return [
        { opacity: 0, transform: 'scale(0.95) translateY(20px)' },
        { opacity: 1, transform: 'scale(1) translateY(0)' }
      ];
    case 'groups':
      return [
        { opacity: 0, transform: `translateX(${20 * sign}px) scale(0.98)` },
        { opacity: 1, transform: 'translateX(0) scale(1)' }
      ];
    case 'not-found':
      return [
        { opacity: 0, transform: 'scale(0.9)' },
        { opacity: 1, transform: 'scale(1)' }
      ];
    default:
      return [
        { opacity: 0, transform: 'translateY(14px)' },
        { opacity: 1, transform: 'translateY(0)' }
      ];
  }
}

// keyframes الخروج
function _getExitKeyframes(pageType) {
  switch (pageType) {
    case 'dashboard':
      return [
        { opacity: 1, transform: 'scale(1)' },
        { opacity: 0, transform: 'scale(1.02)' }
      ];
    default:
      return [
        { opacity: 1, transform: 'scale(1)' },
        { opacity: 0, transform: 'scale(0.98)' }
      ];
  }
}

// ====== 5. حركات المكونات ======

// فتح المودال
export async function animateModalOpen(modalElement) {
  if (!modalElement) return;
  const backdrop = modalElement.previousElementSibling;

  await Promise.all([
    animateElement(modalElement, [
      { opacity: 0, transform: 'scale(0.88) translateY(24px)' },
      { opacity: 1, transform: 'scale(1) translateY(0)' }
    ], { duration: 320, easing: CONFIG.SPRING_EASING }),
    backdrop
      ? animateElement(backdrop, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 })
      : Promise.resolve()
  ]);
}

// إغلاق المودال
export async function animateModalClose(modalElement) {
  if (!modalElement) return;
  const backdrop = modalElement.previousElementSibling;

  await Promise.all([
    animateElement(modalElement, [
      { opacity: 1, transform: 'scale(1) translateY(0)' },
      { opacity: 0, transform: 'scale(0.9) translateY(18px)' }
    ], { duration: 210, easing: CONFIG.EASE_IN }),
    backdrop
      ? animateElement(backdrop, [{ opacity: 1 }, { opacity: 0 }], { duration: 180 })
      : Promise.resolve()
  ]);
}

// فتح BottomSheet
export async function animateBottomSheetOpen(element) {
  if (!element) return;
  await animateElement(element, [
    { transform: 'translateY(100%)', opacity: 0 },
    { transform: 'translateY(0)', opacity: 1 }
  ], { duration: 360, easing: CONFIG.SPRING_EASING });
}

// إغلاق BottomSheet
export async function animateBottomSheetClose(element) {
  if (!element) return;
  await animateElement(element, [
    { transform: 'translateY(0)', opacity: 1 },
    { transform: 'translateY(100%)', opacity: 0 }
  ], { duration: 260, easing: CONFIG.EASE_IN });
}

// فتح/إغلاق الدرج الجانبي (RTL-aware)
export async function animateDrawer(drawerElement, isOpen) {
  if (!drawerElement) return;

  // في RTL الدرج يأتي من اليمين
  const openFrom = state.isRTL ? 'translateX(100%)' : 'translateX(-100%)';
  const closedTo = state.isRTL ? 'translateX(100%)' : 'translateX(-100%)';

  if (isOpen) {
    await animateElement(drawerElement, [
      { transform: openFrom, opacity: 0.6 },
      { transform: 'translateX(0)', opacity: 1 }
    ], { duration: 320, easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' });
  } else {
    await animateElement(drawerElement, [
      { transform: 'translateX(0)', opacity: 1 },
      { transform: closedTo, opacity: 0.6 }
    ], { duration: 260, easing: CONFIG.EASE_IN });
  }
}

// إخفاء/إظهار الـ Bottom Navbar عند التمرير
export async function animateBottomNavbar(element, show) {
  if (!element) return;
  const yVal = show ? '0%' : '100%';
  const startY = show ? '100%' : '0%';

  await animateElement(element, [
    { transform: `translateY(${startY})` },
    { transform: `translateY(${yVal})` }
  ], { duration: 260, easing: CONFIG.EASE_OUT });
}

// إخفاء/إظهار الـ Top Navbar
export async function animateTopNavbar(element, show) {
  if (!element) return;
  await animateElement(element, [
    { transform: show ? 'translateY(-100%)' : 'translateY(0)', opacity: show ? 0 : 1 },
    { transform: show ? 'translateY(0)' : 'translateY(-100%)', opacity: show ? 1 : 0 }
  ], { duration: 240, easing: CONFIG.EASE_OUT });
}

// ظهور عنصر في قائمة الإشعارات
export function animateNotificationItem(itemElement) {
  if (!itemElement) return;
  animateElement(itemElement, [
    { opacity: 0, transform: `translateX(${16 * rtlSign()}px)` },
    { opacity: 1, transform: 'translateX(0)' }
  ], { duration: 280, easing: CONFIG.EASE_OUT });
  addTempClass(itemElement, CONFIG.CLASSES.NOTIF_POP, 350);
}

// دخول التوست
export async function animateToastEnter(toastElement) {
  if (!toastElement) return;
  const sign = rtlSign();
  await animateElement(toastElement, [
    { opacity: 0, transform: `translateX(${24 * sign}px) scale(0.93)` },
    { opacity: 1, transform: 'translateX(0) scale(1)' }
  ], { duration: 300, easing: CONFIG.SPRING_EASING });
}

// خروج التوست
export async function animateToastExit(toastElement) {
  if (!toastElement) return;
  const sign = rtlSign();
  await animateElement(toastElement, [
    { opacity: 1, transform: 'translateX(0) scale(1)' },
    { opacity: 0, transform: `translateX(${20 * sign}px) scale(0.9)` }
  ], { duration: 220, easing: CONFIG.EASE_IN });
}

// ====== 6. حركات بطاقات الدروس والامتحانات ======

// Stagger لبطاقات قائمة
export async function animateCardList(container) {
  if (!container) return;
  const cards = container.querySelectorAll('.lesson-card, .exam-card, .group-card, .card');
  await staggerElements(cards, (card) => animateElement(card, [
    { opacity: 0, transform: 'translateY(20px) scale(0.97)' },
    { opacity: 1, transform: 'translateY(0) scale(1)' }
  ], { duration: 320, easing: CONFIG.EASE_OUT }));
}

// ظهور بطاقة واحدة
export async function animateCardEnter(card) {
  if (!card) return;
  await animateElement(card, [
    { opacity: 0, transform: 'translateY(16px) scale(0.96)' },
    { opacity: 1, transform: 'translateY(0) scale(1)' }
  ], { duration: 300, easing: CONFIG.SPRING_EASING });
}

// ====== 7. حركات خاصة بالمنصة ======

// حركة ظهور الـ Streak
export function animateStreakBadge(badgeElement) {
  if (!badgeElement) return;
  animateElement(badgeElement, [
    { transform: 'scale(0.5) rotate(-15deg)', opacity: 0 },
    { transform: 'scale(1.3) rotate(5deg)', opacity: 1, offset: 0.7 },
    { transform: 'scale(1) rotate(0)', opacity: 1 }
  ], { duration: 560, easing: CONFIG.SPRING_EASING });
  addTempClass(badgeElement, CONFIG.CLASSES.STREAK_POP, 600);
}

// حركة ظهور الميدالية
export async function animateMedalEarned(medalElement) {
  if (!medalElement) return;
  await animateElement(medalElement, [
    { transform: 'translateY(-60px) scale(0.4) rotate(-20deg)', opacity: 0 },
    { transform: 'translateY(10px) scale(1.15) rotate(6deg)', opacity: 1, offset: 0.65 },
    { transform: 'translateY(-5px) scale(1.05) rotate(-2deg)', opacity: 1, offset: 0.8 },
    { transform: 'translateY(0) scale(1) rotate(0)', opacity: 1 }
  ], { duration: 800, easing: CONFIG.EASE_OUT });
  addTempClass(medalElement, CONFIG.CLASSES.MEDAL_DROP, 850);
}

// حركة فتح Badge جديد
export async function animateBadgeUnlock(badgeElement) {
  if (!badgeElement) return;
  await animateElement(badgeElement, [
    { transform: 'scale(0) rotate(-30deg)', opacity: 0, filter: 'blur(8px)' },
    { transform: 'scale(1.2) rotate(5deg)', opacity: 1, filter: 'blur(0)', offset: 0.7 },
    { transform: 'scale(1) rotate(0)', opacity: 1, filter: 'blur(0)' }
  ], { duration: 700, easing: CONFIG.SPRING_EASING });
}

// حركة دائرة الصورة الشخصية عند تغييرها
export async function animateAvatarChange(avatarElement) {
  if (!avatarElement) return;
  await animateElement(avatarElement, [
    { transform: 'scale(1)', filter: 'brightness(1)' },
    { transform: 'scale(0.8)', filter: 'brightness(1.4)', offset: 0.4 },
    { transform: 'scale(1.1)', filter: 'brightness(1)', offset: 0.75 },
    { transform: 'scale(1)', filter: 'brightness(1)' }
  ], { duration: 500, easing: CONFIG.SPRING_EASING });
  addTempClass(avatarElement, CONFIG.CLASSES.AVATAR_RING, 560);
}

// حركة نتيجة الامتحان (Score Flash)
export async function animateExamScore(scoreElement, finalValue) {
  if (!scoreElement) return;
  await animateCountUp(scoreElement, 0, finalValue, 1200);
  addTempClass(scoreElement, CONFIG.CLASSES.SCORE_FLASH, 400);
}

// عداد تصاعدي (Counter Animation)
export async function animateCountUp(element, from, to, duration = 1000) {
  if (!element) return;
  if (state.reduceMotion) {
    element.textContent = to;
    return;
  }

  const steps = CONFIG.COUNTER_STEPS;
  const stepDuration = duration / steps;
  const diff = to - from;
  let current = from;

  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  for (let i = 1; i <= steps; i++) {
    await new Promise(resolve => setTimeout(resolve, stepDuration));
    const progress = i / steps;
    current = Math.round(from + diff * easeOut(progress));
    element.textContent = current;
  }
}

// حركة إظهار رسالة توجيهية من شخصية
export async function animateDirectingCharacter(charElement, messageElement) {
  if (!charElement) return;

  const sign = rtlSign();

  await Promise.all([
    animateElement(charElement, [
      { transform: `translateX(${40 * sign}px) scale(0.85)`, opacity: 0 },
      { transform: 'translateX(0) scale(1)', opacity: 1 }
    ], { duration: 440, easing: CONFIG.SPRING_EASING }),

    messageElement
      ? animateElement(messageElement, [
          { opacity: 0, transform: 'translateY(10px)' },
          { opacity: 1, transform: 'translateY(0)' }
        ], { duration: 380, easing: CONFIG.EASE_OUT, delay: 180 })
      : Promise.resolve()
  ]);
}

// حركة ظهور نتيجة الامتحان الكاملة
export async function animateExamResult(resultContainer) {
  if (!resultContainer) return;
  await animateElement(resultContainer, [
    { opacity: 0, transform: 'scale(0.85) translateY(30px)' },
    { opacity: 1, transform: 'scale(1.02) translateY(-4px)', offset: 0.75 },
    { opacity: 1, transform: 'scale(1) translateY(0)' }
  ], { duration: 600, easing: CONFIG.SPRING_EASING });
}

// ====== 8. التفاعلات الدقيقة ======

// تأثير Ripple عند النقر
export function createRipple(event, element, color = 'rgba(255,255,255,0.25)') {
  if (state.reduceMotion || !element) return;

  const rect = element.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const size = Math.max(rect.width, rect.height) * 2;

  const ripple = document.createElement('span');
  ripple.className = CONFIG.CLASSES.RIPPLE;
  ripple.style.setProperty('--ripple-x', `${x}px`);
  ripple.style.setProperty('--ripple-y', `${y}px`);
  ripple.style.setProperty('--ripple-size', `${size}px`);
  ripple.style.setProperty('--ripple-color', color);

  element.appendChild(ripple);
  setTimeout(() => ripple.remove(), 700);
}

// تأثير نبض
export function pulseElement(element, duration = 900) {
  if (!element) return;
  addTempClass(element, CONFIG.CLASSES.PULSE, duration);
}

// تأثير اهتزاز للخطأ
export function shakeElement(element) {
  if (!element) return;
  addTempClass(element, CONFIG.CLASSES.SHAKE, 520);
}

// تأثير ارتداد
export function bounceElement(element) {
  if (!element) return;
  addTempClass(element, CONFIG.CLASSES.BOUNCE, 600);
}

// تأثير دوران
export function spinElement(element, start = true) {
  if (!element) return;
  element.classList[start ? 'add' : 'remove'](CONFIG.CLASSES.SPIN);
}

// تأثير توهج
export function glowElement(element, duration = 800) {
  if (!element) return;
  addTempClass(element, CONFIG.CLASSES.GLOW, duration);
}

// تأثير قلب (flip) للبطاقات
export async function flipElement(element) {
  if (!element) return;
  await animateElement(element, [
    { transform: 'perspective(600px) rotateY(0)' },
    { transform: 'perspective(600px) rotateY(90deg)', offset: 0.5 },
    { transform: 'perspective(600px) rotateY(0)' }
  ], { duration: 500, easing: CONFIG.EASE_STANDARD });
}

// ====== 9. Skeleton Loading ======

// تحويل عنصر إلى Skeleton
export function showSkeleton(element) {
  if (!element) return;
  element.classList.add(CONFIG.CLASSES.SKELETON, CONFIG.CLASSES.SKELETON_WAVE);
}

// إزالة Skeleton
export async function hideSkeleton(element) {
  if (!element) return;
  element.classList.add(CONFIG.CLASSES.SKELETON_READY);
  await animateElement(element, [
    { opacity: 0.5, filter: 'blur(4px)' },
    { opacity: 1, filter: 'blur(0)' }
  ], { duration: 280, easing: CONFIG.EASE_OUT });
  element.classList.remove(
    CONFIG.CLASSES.SKELETON,
    CONFIG.CLASSES.SKELETON_WAVE,
    CONFIG.CLASSES.SKELETON_READY
  );
}

// Stagger Skeleton لقائمة
export async function showSkeletonList(container, count = 5) {
  if (!container) return;
  container.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const item = document.createElement('div');
    item.className = `skeleton-item ${CONFIG.CLASSES.SKELETON} ${CONFIG.CLASSES.SKELETON_WAVE}`;
    container.appendChild(item);
  }
}

// ====== 10. تأثيرات التمرير ======

// تهيئة IntersectionObserver للـ Reveal
function _initRevealOnScroll() {
  if (state.intersectionObserver) state.intersectionObserver.disconnect();

  state.intersectionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const delay = parseInt(el.dataset.revealDelay) || 0;

        setTimeout(() => {
          el.classList.add(CONFIG.CLASSES.REVEALED);
          state.intersectionObserver.unobserve(el);
        }, state.reduceMotion ? 0 : delay);
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -8px 0px' }
  );

  _scanRevealElements();
}

// مسح وتسجيل عناصر Reveal الجديدة
function _scanRevealElements() {
  document.querySelectorAll(
    `.${CONFIG.CLASSES.REVEAL}:not(.${CONFIG.CLASSES.REVEALED})`
  ).forEach(el => {
    if (state.intersectionObserver) state.intersectionObserver.observe(el);
  });
}

// مراقبة العناصر الجديدة في DOM
function _initMutationObserver() {
  if (state.mutationObserver) state.mutationObserver.disconnect();

  state.mutationObserver = new MutationObserver((mutations) => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        if (node.classList?.contains(CONFIG.CLASSES.REVEAL)) {
          state.intersectionObserver?.observe(node);
        }
        node.querySelectorAll?.(`.${CONFIG.CLASSES.REVEAL}:not(.${CONFIG.CLASSES.REVEALED})`)
          .forEach(el => state.intersectionObserver?.observe(el));
      });
    });
  });

  state.mutationObserver.observe(document.body, { childList: true, subtree: true });
}

// Parallax
export function initParallax() {
  if (state.reduceMotion) return;

  const handler = () => {
    document.querySelectorAll(`.${CONFIG.CLASSES.PARALLAX}`).forEach(el => {
      const speed = parseFloat(el.dataset.parallaxSpeed) || 0.25;
      const rect = el.getBoundingClientRect();
      const center = window.innerHeight / 2;
      const offset = (rect.top + rect.height / 2) - center;
      el.style.transform = `translateY(${offset * speed}px)`;
    });
  };

  // إزالة المستمع القديم إن وُجد
  const oldHandler = state.scrollHandlers.get('parallax');
  if (oldHandler) window.removeEventListener('scroll', oldHandler);

  state.scrollHandlers.set('parallax', handler);
  window.addEventListener('scroll', handler, { passive: true });
  handler();
}

// ====== 11. التكامل مع EventBus ======
function _subscribeToEvents() {
  const unsubs = [];

  // تغيير الصفحة → إعادة مسح Reveal
  unsubs.push(EventBus.on(CONFIG.EVENTS.PAGE_CHANGED, () => {
    setTimeout(_scanRevealElements, 120);
  }));

  // فتح مودال
  unsubs.push(EventBus.on(CONFIG.EVENTS.MODAL_OPEN, (detail) => {
    const modal = detail?.element || document.querySelector('.modal.modal-visible');
    if (modal) animateModalOpen(modal);
  }));

  // إغلاق مودال
  unsubs.push(EventBus.on(CONFIG.EVENTS.MODAL_CLOSE, (detail) => {
    const modal = detail?.element;
    if (modal) animateModalClose(modal);
  }));

  // دخول توست
  unsubs.push(EventBus.on(CONFIG.EVENTS.TOAST_SHOW, (detail) => {
    if (detail?.element) animateToastEnter(detail.element);
  }));

  // فتح/إغلاق الدرج
  unsubs.push(EventBus.on(CONFIG.EVENTS.DRAWER_TOGGLE, (detail) => {
    const drawer = document.querySelector(CONFIG.SELECTORS.drawer);
    if (drawer) animateDrawer(drawer, detail?.open ?? true);
  }));

  // تحديث Streak
  unsubs.push(EventBus.on(CONFIG.EVENTS.STREAK_UPDATED, (detail) => {
    if (!detail?.updated) return;
    const badge = document.querySelector(CONFIG.SELECTORS.streakBadge);
    if (badge) animateStreakBadge(badge);
  }));

  // ربح ميدالية
  unsubs.push(EventBus.on(CONFIG.EVENTS.MEDAL_EARNED, (detail) => {
    if (detail?.element) animateMedalEarned(detail.element);
  }));

  // ظهور إشعار
  unsubs.push(EventBus.on(CONFIG.EVENTS.NOTIFICATION_ADD, (detail) => {
    if (detail?.element) animateNotificationItem(detail.element);
  }));

  state.eventUnsubscribers = unsubs;
}

// ====== 12. التهيئة والتنظيف ======
export function initializeAnimations() {
  if (state.initialized) return true;

  checkReduceMotion();
  checkRTL();

  const boot = () => {
    _initRevealOnScroll();
    _initMutationObserver();
    initParallax();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  _subscribeToEvents();

  // الواجهة العامة
  window.animations = {
    // انتقالات الصفحات
    enterPage,
    exitPage,
    // مكونات
    animateModalOpen,
    animateModalClose,
    animateBottomSheetOpen,
    animateBottomSheetClose,
    animateDrawer,
    animateBottomNavbar,
    animateTopNavbar,
    animateNotificationItem,
    animateToastEnter,
    animateToastExit,
    animateCardList,
    animateCardEnter,
    // منصة بيولوجست
    animateStreakBadge,
    animateMedalEarned,
    animateBadgeUnlock,
    animateAvatarChange,
    animateExamScore,
    animateExamResult,
    animateDirectingCharacter,
    animateCountUp,
    // تفاعلات
    createRipple,
    pulseElement,
    shakeElement,
    bounceElement,
    spinElement,
    glowElement,
    flipElement,
    // Skeleton
    showSkeleton,
    hideSkeleton,
    showSkeletonList,
    // مساعدات
    addTempClass,
    animateElement,
    staggerElements,
    initParallax,
    scanRevealElements: _scanRevealElements,
    isReduceMotion: () => state.reduceMotion,
    isRTL: () => state.isRTL
  };

  state.initialized = true;
  return true;
}

export function destroyAnimations() {
  // إلغاء الاشتراكات
  state.eventUnsubscribers.forEach(unsub => {
    try { unsub(); } catch (_) {}
  });
  state.eventUnsubscribers = [];

  // فصل المراقبين
  state.intersectionObserver?.disconnect();
  state.intersectionObserver = null;

  state.mutationObserver?.disconnect();
  state.mutationObserver = null;

  // إزالة مستمعي Scroll
  state.scrollHandlers.forEach((handler, key) => {
    window.removeEventListener('scroll', handler);
  });
  state.scrollHandlers.clear();

  state.activeAnimations.clear();
  state.initialized = false;
  delete window.animations;
}

// ====== 13. التصدير ======
export default {
  initialize: initializeAnimations,
  destroy: destroyAnimations,
  // انتقالات
  enterPage,
  exitPage,
  // مكونات
  animateModalOpen,
  animateModalClose,
  animateBottomSheetOpen,
  animateBottomSheetClose,
  animateDrawer,
  animateBottomNavbar,
  animateTopNavbar,
  animateNotificationItem,
  animateToastEnter,
  animateToastExit,
  animateCardList,
  animateCardEnter,
  // منصة
  animateStreakBadge,
  animateMedalEarned,
  animateBadgeUnlock,
  animateAvatarChange,
  animateExamScore,
  animateExamResult,
  animateDirectingCharacter,
  animateCountUp,
  // تفاعلات
  createRipple,
  pulse: pulseElement,
  shake: shakeElement,
  bounce: bounceElement,
  spin: spinElement,
  glow: glowElement,
  flip: flipElement,
  // Skeleton
  showSkeleton,
  hideSkeleton,
  showSkeletonList,
  // مساعدات
  addTempClass,
  animateElement,
  staggerElements,
  initParallax,
  isReduceMotion: () => state.reduceMotion,
  isRTL: () => state.isRTL
};
