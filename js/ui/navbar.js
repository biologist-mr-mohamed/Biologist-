/**
 * 🧭 js/ui/navbar.js – شريط التنقل المتكامل v5.0.0
 * ============================================================================
 * 📝 المسؤولية: إدارة الشريط العلوي الثابت وشريط التنقل السفلي بجميع أنظمتهما.
 * 🧠 الهندسة:
 *   - Pure JavaScript SPA (بدون أي أطر عمل).
 *   - RTL First – الدعم الكامل لاتجاه من اليمين لليسار.
 *   - متكامل مع: session.js / event-bus.js / drawer.js / router.js / theme.js.
 *   - إدارة دورة حياة كاملة: init → bind → monitor → destroy.
 *   - نظام Sprite Sheet للأفاتار مطابق تماماً لـ drawer.js.
 *   - إخفاء/إظهار الشريط السفلي على الجوال عبر Scroll + ResizeObserver.
 *   - زر الثيم متكامل مع window.toggleTheme / getCurrentTheme من main.js.
 * ============================================================================
 */

import { getCurrentUser } from '../core/session.js';
import { EventBus }        from '../core/event-bus.js';
import { toggleTheme, getCurrentTheme } from '../core/theme.js';
import { createAvatarElement, updateAvatarElement, shouldShowVerificationBadge, getFrameClass } from '../utils/avatar.js';
import { startLogoAnimation, stopLogoAnimation } from './logo-animation.js';
// ==== 1. الثوابت والمحددات ====

const SELECTORS = {
  // الشريط العلوي
  navbarTop:           '#navbar-top',
  onlineIndicator:     '#navbar-online-indicator',
  themeToggle:         '.theme-toggle',
  searchBtn:           '#global-search-btn',
  notificationBtn:     '#notification-btn',
  notificationBadge:   '#notification-badge',
  avatarContainer:     '#user-avatar-container',
  userAvatar:          '#user-avatar',
  avatarFrame:         '#avatar-frame',
  verificationBadge:   '#user-verification-badge',
  dynamicLogo:         '#navbar-dynamic-logo',

  // الشريط السفلي
  bottomNav:           '#bottom-navigation',
  bottomNavBtns:       '.bottom-nav-btn[data-nav-target]',
};

// ==== خريطة ربط مسارات الـ Router بأزرار الشريط السفلي ====
const PAGE_TO_NAV_MAP = {
  home:       'home',
  lessons:    'lessons',
  exams:      'exams',
  // أي صفحة أخرى لا تنشّط أي زر
};

// ==== 2. حالة الـ Navbar (Local State Tracker) ====
let navbarState = {
  isInitialized:     false,
  currentPage:       'home',
  isOnline:          navigator.onLine,
  notificationsCount: 0,
  currentUser:       null,
  // إلغاء الاشتراكات في EventBus
  eventUnsubscribers: [],
  // معرّفات مستمعي DOM لإمكانية إلغائها
  _domListeners:     [],
  // نظام الـ Scroll مع دعم الجوال
  isMobile:          window.innerWidth < 768,
  lastScrollY:       window.scrollY,
  _scrollState: {
    lastY:     0,
    ticking:   false,
    rafId:     null,
    isHidden:  false
  }
};

// ==== 3. مرجع عناصر DOM ====
let $el = {
  navbarTop:         null,
  onlineIndicator:   null,
  themeToggle:       null,
  searchBtn:         null,
  notificationBtn:   null,
  notificationBadge: null,
  avatarContainer:   null,
  verificationBadge: null,
  bottomNav:         null,
  bottomNavBtns:     [],
  dynamicLogo:       null,
};


// ==== 4. دوال مساعدة داخلية ====

/** تأمين النصوص من XSS */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


/** تحديث سمة data-auth و data-role على body */
function updateBodyMeta(user) {
  if (user) {
    document.body.dataset.auth = 'logged';
    document.body.dataset.role = user.user_type || '';
  } else {
    document.body.dataset.auth = 'guest';
    document.body.dataset.role = '';
  }
}

/** حساب التحية الزمنية المناسبة */
function getTimeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'صباح الخير ☀️';
  if (h < 18) return 'مساء الخير 🌤️';
  return 'مساء النور 🌙';
}

/** بناء اللقب المناسب حسب النوع */
function buildUserTitle(user) {
  if (!user) return '';
  const nameRaw  = user.full_name || user.username || 'مستخدم';
  const name     = escapeHtml(nameRaw.split(' ')[0]); // الاسم الأول فقط
  if (user.user_type === 'teacher')   return `أستاذ ${name}`;
  if (user.user_type === 'moderator') return `المشرف ${name}`;
  return name;
}


// ==== 5. بناء الواجهة (UI Rendering) ====

/**
 * 5.1 ربط مراجع DOM بعناصر index.html
 * (لا يُنشئ أي عناصر – يعتمد فقط على هيكل index.html الموجود)
 */
function bindDomRefs() {
  $el.navbarTop         = document.querySelector(SELECTORS.navbarTop);
  $el.onlineIndicator   = document.querySelector(SELECTORS.onlineIndicator);
  $el.themeToggle       = document.querySelector(SELECTORS.themeToggle);
  $el.searchBtn         = document.querySelector(SELECTORS.searchBtn);
  $el.notificationBtn   = document.querySelector(SELECTORS.notificationBtn);
  $el.notificationBadge = document.querySelector(SELECTORS.notificationBadge);
  $el.avatarContainer   = document.querySelector(SELECTORS.avatarContainer);
  $el.verificationBadge = document.querySelector(SELECTORS.verificationBadge);
  $el.dynamicLogo       = document.querySelector(SELECTORS.dynamicLogo);
  $el.bottomNav         = document.querySelector(SELECTORS.bottomNav);
  $el.bottomNavBtns     = Array.from(
    document.querySelectorAll(SELECTORS.bottomNavBtns)
  );
}

/**
 * 5.2 الموزع المركزي لتحديث واجهة الـ Navbar بناءً على حالة المستخدم
 */
function updateNavbarUI(user) {
  navbarState.currentUser = user;
  updateBodyMeta(user);

  if (user) {
    _applyLoggedInState(user);
  } else {
    _applyGuestState();
  }
}

/**
 * تطبيق حالة المستخدم المسجل على الـ Navbar
 */
function _applyLoggedInState(user) {
  // الأفاتار والإطار
  updateUserAvatarAndFrame(user);

  // علامة التوثيق (للمعلم والمشرف)
  const isVerified = user.user_type === 'teacher' || user.user_type === 'moderator';
  if ($el.verificationBadge) {
    $el.verificationBadge.style.display = isVerified ? 'flex' : 'none';
    $el.verificationBadge.setAttribute('title',
      isVerified ? `حساب ${user.user_type === 'teacher' ? 'معلم' : 'مشرف'} موثّق` : ''
    );
  }

  // زر البحث يظهر فقط للمعلم والمشرف
  if ($el.searchBtn) {
    const canSearch = user.user_type === 'teacher' || user.user_type === 'moderator';
    $el.searchBtn.style.display = canSearch ? 'flex' : 'none';
  }

  // تحديث Tooltip الأفاتار
  if ($el.avatarContainer) {
    const greeting = getTimeGreeting();
    const title    = buildUserTitle(user);
    const streak   = user.streak ? ` 🔥 ${user.streak}` : '';
    $el.avatarContainer.setAttribute('aria-label', `${greeting} ${title}${streak} – فتح القائمة`);
  }
}

/**
 * تطبيق حالة الضيف على الـ Navbar
 */
function _applyGuestState() {
  resetAvatarToDefault();

  if ($el.verificationBadge) $el.verificationBadge.style.display = 'none';
  if ($el.searchBtn)         $el.searchBtn.style.display         = 'none';

  if ($el.avatarContainer) {
    $el.avatarContainer.setAttribute('aria-label', 'فتح القائمة – الضيف');
  }
}


// ==== 6. نظام الأفاتار والإطار ====

/**
 * 6.1 المحرك الرئيسي للأفاتار + الإطار
 * يطابق تماماً منطق drawer.js لضمان الاتساق البصري في كل مكان
 */
function updateUserAvatarAndFrame(user) {
  const container = $el.avatarContainer; // #user-avatar-container
  if (!container) return;

  if (!user) {
    resetAvatarToDefault();
    return;
  }

  let avatarElement = container.querySelector('.avatar-wrapper');
  if (!avatarElement) {
    avatarElement = createAvatarElement(user, 'sm', {
      showFrame: true,
      showBadge: false,        // العلامة تدار بواسطة $el.verificationBadge المنفصل
      clickable: true,
      onClick: () => window.drawer?.open()
    });
    container.innerHTML = '';
    container.appendChild(avatarElement);
  } else {
    updateAvatarElement(avatarElement, user);
  }

  // تحديث علامة التوثيق المنفصلة (إذا كانت موجودة)
  if ($el.verificationBadge) {
    $el.verificationBadge.style.display = shouldShowVerificationBadge(user) ? 'flex' : 'none';
  }
}

/**
 * 6.2 إعادة الأفاتار والإطار للحالة الافتراضية (ضيف)
 */
function resetAvatarToDefault() {
  const container = $el.avatarContainer;
  if (!container) return;

  const guestAvatar = createAvatarElement(null, 'sm', {
    showFrame: true,
    showBadge: false,
    clickable: false
  });
  container.innerHTML = '';
  container.appendChild(guestAvatar);

  if ($el.verificationBadge) $el.verificationBadge.style.display = 'none';
}

// ==== 7. إدارة عداد الإشعارات ====

/**
 * 7.1 تحديث عداد الإشعارات مع تأثير الحيوية
 * @param {number} count عدد الإشعارات غير المقروءة
 */
function setNotificationsCount(count) {
  const num = Math.max(0, parseInt(count) || 0);
  navbarState.notificationsCount = num;

  if (!$el.notificationBadge) return;

  if (num > 0) {
    const displayNum = num > 99 ? '99+' : String(num);
    $el.notificationBadge.textContent = displayNum;
    $el.notificationBadge.dataset.count = String(num);
    $el.notificationBadge.style.display = 'flex';

    // تأثير الانتباه (badge-bounce) عند وصول إشعار جديد
    $el.notificationBadge.classList.remove('badge-bounce');
    // نضطر لإعادة reflow لإعادة تشغيل الأنيميشن
    void $el.notificationBadge.offsetWidth;
    $el.notificationBadge.classList.add('badge-bounce');
  } else {
    $el.notificationBadge.textContent = '0';
    $el.notificationBadge.dataset.count = '0';
    $el.notificationBadge.style.display = 'none';
    $el.notificationBadge.classList.remove('badge-bounce');
  }

  // تحديث aria-label للوصول
  if ($el.notificationBtn) {
    $el.notificationBtn.setAttribute(
      'aria-label',
      num > 0 ? `الإشعارات (${num} جديد)` : 'الإشعارات'
    );
  }

  // بث التحديث عبر EventBus
  EventBus.emit('navbar:notificationsUpdated', { count: num });
}


// ==== 8. مزامنة الصفحة النشطة ====

/**
 * 8.1 تحديث الصفحة الحالية (يستدعيه Router عبر EventBus)
 * @param {string} page اسم المسار (من ROUTES_CONFIG)
 */
function updateCurrentPage(page) {
  navbarState.currentPage = page;
  updateActiveNavButton(page);
}

/**
 * 8.2 تحديث الزر النشط في الشريط السفلي
 * @param {string} page اسم الصفحة الحالية
 */
function updateActiveNavButton(page) {
  if (!$el.bottomNavBtns.length) return;

  // المسار المقابل في خريطة التنقل
  const activeTarget = PAGE_TO_NAV_MAP[page] || null;

  $el.bottomNavBtns.forEach(btn => {
    const target   = btn.dataset.navTarget;
    const isActive = activeTarget && target === activeTarget;

    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
}


// ==== 9. مراقبة حالة الاتصال بالإنترنت ====

let _onlineHandler  = null;
let _offlineHandler = null;

/**
 * 9.1 بدء مراقبة حالة الشبكة
 */
function startOnlineStatusMonitoring() {
  // تنظيف مستمعات سابقة إن وجدت
  stopOnlineStatusMonitoring();

  _onlineHandler = () => _handleConnectionChange(true);
  _offlineHandler = () => _handleConnectionChange(false);

  window.addEventListener('online',  _onlineHandler);
  window.addEventListener('offline', _offlineHandler);

  // تطبيق الحالة الحالية فور التشغيل
  _applyConnectionStatus(navigator.onLine);
}

/**
 * 9.2 إيقاف مراقبة الشبكة
 */
function stopOnlineStatusMonitoring() {
  if (_onlineHandler)  window.removeEventListener('online',  _onlineHandler);
  if (_offlineHandler) window.removeEventListener('offline', _offlineHandler);
  _onlineHandler  = null;
  _offlineHandler = null;
}

/** معالجة تغيير حالة الاتصال */
function _handleConnectionChange(isOnline) {
  navbarState.isOnline = isOnline;
  _applyConnectionStatus(isOnline);
  EventBus.emit('navbar:connectionChanged', { online: isOnline });
}

/** تطبيق حالة الاتصال على مؤشر الشريط العلوي */
function _applyConnectionStatus(isOnline) {
  const navbar = $el.navbarTop;
  if (!navbar) return;

  navbar.classList.toggle('navbar--offline', !isOnline);
  navbar.classList.toggle('navbar--online',   isOnline);

  // تحديث Tooltip
  if ($el.notificationBtn) {
    $el.notificationBtn.title = isOnline
      ? 'متصل بالإنترنت'
      : 'غير متصل – تعمل بوضع Offline';
  }
}


// ==== 10. إخفاء الشريط السفلي عند التمرير ====

let scrollHandlerRef = null;
let resizeObserver   = null;

/**
 * 10.1 تفعيل الإخفاء الذكي للشريط السفلي على الجوال فقط
 * يعتمد على ResizeObserver للتفاعل مع تغيّر حجم الشاشة
 */
function initializeAutoHideBottomNav() {
  destroyAutoHideBottomNav();

  if (!$el.bottomNav) return;

  // ==== معالج التمرير المرتبط بحالة الجوال ====
  scrollHandlerRef = () => {
    if (!navbarState.isMobile) return;
    const currentScrollY = window.scrollY;
    const bottomNav      = $el.bottomNav;
    if (!bottomNav) return;

    const THRESHOLD = 10;
    if (Math.abs(currentScrollY - navbarState.lastScrollY) < THRESHOLD) return;

    if (currentScrollY > navbarState.lastScrollY && currentScrollY > 50) {
      // تمرير للأسفل → إخفاء
      bottomNav.classList.add('hide');
      navbarState._scrollState.isHidden = true;
    } else if (currentScrollY < navbarState.lastScrollY) {
      // تمرير للأعلى → إظهار
      bottomNav.classList.remove('hide');
      navbarState._scrollState.isHidden = false;
    }
    navbarState.lastScrollY = currentScrollY;
  };

  // ==== مراقبة تغيير حجم الشاشة لتحديد حالة الجوال ====
  const checkIsMobile = () => {
    navbarState.isMobile = window.innerWidth < 768;

    if (!navbarState.isMobile) {
      // شاشات كبيرة: إظهار الشريط دائماً وإيقاف مستمع التمرير
      $el.bottomNav?.classList.remove('hide');
      navbarState._scrollState.isHidden = false;
      window.removeEventListener('scroll', scrollHandlerRef);
    } else {
      // جوال: إعادة تسجيل مستمع التمرير
      navbarState.lastScrollY = window.scrollY;
      window.removeEventListener('scroll', scrollHandlerRef);
      window.addEventListener('scroll', scrollHandlerRef, { passive: true });
    }
  };

  // ==== استخدام ResizeObserver إن كان مدعوماً ====
  if (window.ResizeObserver) {
    resizeObserver = new ResizeObserver(checkIsMobile);
    resizeObserver.observe(document.body);
  } else {
    // fallback للمتصفحات القديمة
    window.addEventListener('resize', checkIsMobile);
    _trackListener(window, 'resize', checkIsMobile);
  }

  checkIsMobile();
}

/**
 * 10.2 إيقاف نظام الإخفاء الذكي وتنظيف الموارد
 */
function destroyAutoHideBottomNav() {
  if (scrollHandlerRef) {
    window.removeEventListener('scroll', scrollHandlerRef);
    scrollHandlerRef = null;
  }
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  navbarState._scrollState.isHidden = false;
}

/** إخفاء الشريط السفلي بسلاسة (داخلي) */
function _hideBottomNav() {
  if (!$el.bottomNav || navbarState._scrollState.isHidden) return;
  $el.bottomNav.classList.add('hide');
  navbarState._scrollState.isHidden = true;
}

/** إظهار الشريط السفلي بسلاسة (داخلي) */
function _showBottomNav() {
  if (!$el.bottomNav || !navbarState._scrollState.isHidden) return;
  $el.bottomNav.classList.remove('hide');
  navbarState._scrollState.isHidden = false;
}


// ==== 11. ربط الأحداث (Event Binding) ====

/**
 * 11.1 ربط أحداث DOM المباشرة داخل الـ Navbar
 */
function bindEvents() {
  // فتح الـ Drawer عند الضغط على حاوية الأفاتار (keyboard + mouse)
  if ($el.avatarContainer) {
    const openDrawer = (e) => {
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      if (window.drawer?.open) window.drawer.open();
    };
    $el.avatarContainer.addEventListener('click',   openDrawer);
    $el.avatarContainer.addEventListener('keydown', openDrawer);
    _trackListener($el.avatarContainer, 'click',   openDrawer);
    _trackListener($el.avatarContainer, 'keydown', openDrawer);
  }

  // ربط أزرار التنقل السفلية
  $el.bottomNavBtns.forEach(btn => {
    const handler = (e) => {
      e.preventDefault();
      const target = btn.dataset.navTarget;
      const action = btn.dataset.action;

// زر القائمة الجانبية
if (action === 'open-sidebar' || btn.id === 'open-drawer-btn') {
  // محاولة فتح الدراور مباشرة، وإذا لم يكن متاحاً بعد (لسه بيتحمّل ديناميكياً
  // عبر main.js) ننتظره بمحاولات قصيرة بدل إرسال حدث 'drawer:open' كان بلا
  // أي مستمع في المشروع بالكامل (drawer.js لا يشترك فيه إطلاقاً)، فكانت
  // النافذة الجانبية لا تُفتح أبداً في حالة الضغط المبكر قبل اكتمال تحميلها.
  if (window.drawer?.open) {
    window.drawer.open();
  } else {
    if (window.modals?.toast) {
      window.modals.toast('جاري تحميل القائمة الجانبية...', 'info');
    }
    let attempts = 0;
    const maxAttempts = 20; // ~2 ثانية (20 × 100ms)
    const waitForDrawer = setInterval(() => {
      attempts++;
      if (window.drawer?.open) {
        clearInterval(waitForDrawer);
        window.drawer.open();
      } else if (attempts >= maxAttempts) {
        clearInterval(waitForDrawer);
        console.warn('[Navbar] تعذّر فتح القائمة الجانبية — لم يتم تحميل drawer.js في الوقت المناسب');
      }
    }, 100);
  }
  return;
}

      // 🛠️ إصلاح: window.router لا يملك دالة navigate إطلاقاً (router.js يُصدّر
      // navigateTo فقط)، فكان هذا الاستدعاء لا يفعل شيئاً أبداً هنا. التنقل كان
      // يعمل فقط بالصدفة عبر المستمع العام المنفصل [data-nav-target] المسجَّل
      // في router.js على مستوى document.
      if (target && window.router?.navigateTo) {
        window.router.navigateTo(target);
      }
    };
    btn.addEventListener('click', handler);
    _trackListener(btn, 'click', handler);
  });

  // زر البحث في الـ Navbar العلوي
  // 🛠️ إصلاح: search.js يُصدّر نفسه فعلياً على window.searchAPI وليس
  // window.search (كان دائماً undefined)، والعنصر الاحتياطي '#search-overlay'
  // غير موجود في index.html أصلاً (العنصر الحقيقي هو '#search-panel'). كان هذا
  // المعالج لا يعمل أبداً، وكان يعمل فقط بالصدفة لأن search.js نفسه يربط
  // مستمعاً منفصلاً بنفس الزر (#global-search-btn) داخل bindGlobalSearchButton().
  if ($el.searchBtn) {
    const openSearch = () => {
      if (window.searchAPI?.open) window.searchAPI.open();
      // لا يوجد فتح احتياطي آمن بدون searchAPI: منطق الفتح الحقيقي في search.js
      // يعتمد على قياس مكان الزر وإضافة كلاس is-open، ولا يمكن تقليده هنا بأمان.
    };
    $el.searchBtn.addEventListener('click', openSearch);
    _trackListener($el.searchBtn, 'click', openSearch);
  }

  // ==== ربط زر تبديل الثيم مع نظام theme.js ====
  if ($el.themeToggle) {
  const toggleThemeHandler = () => {
    // استدعاء دالة تبديل الثيم من theme.js (تعيد الثيم الجديد)
    const newTheme = toggleTheme();
    // تحديث الأيقونة بناءً على الثيم الجديد
    _updateThemeToggleIcon(newTheme);
    // إغلاق القائمة الجانبية إن كانت مفتوحة
    if (window.drawer?.isOpen?.()) window.drawer.close();
  };
  $el.themeToggle.addEventListener('click', toggleThemeHandler);
  _trackListener($el.themeToggle, 'click', toggleThemeHandler);
}
}

/**
 * 11.2 الاشتراك في أحداث EventBus العامة
 */
function subscribeToGlobalEvents() {
  // تغيير حالة المستخدم (دخول / خروج)
  const onUserStateChanged = (data) => {
    const user = data?.user || null;
    updateNavbarUI(user);
  };

  // تحديث الملف الشخصي أو الصورة
  const onProfileUpdated = (data) => {
    const user = data?.user || getCurrentUser();
    if (user) {
      updateUserAvatarAndFrame(user);
      navbarState.currentUser = user;
    }
  };

  // تحديث الـ Streak في الوقت الفعلي
  const onStreakUpdated = (data) => {
    if (!navbarState.currentUser) return;
    const streak = data?.streak || 0;
    navbarState.currentUser.streak = streak;

    // تحديث Tooltip الأفاتار إن وجد
    if ($el.avatarContainer && navbarState.currentUser) {
      const greeting = getTimeGreeting();
      const title    = buildUserTitle(navbarState.currentUser);
      const streakTxt = streak >= 5 ? ` 🔥 ${streak}` : '';
      $el.avatarContainer.setAttribute('aria-label',
        `${greeting} ${title}${streakTxt} – فتح القائمة`
      );
    }
  };

  // تنقل الـ Router → تحديث الزر النشط
  // 🛠️ إصلاح ترابط: router.js يُصدر 'pageChanged' فقط (وليس 'router:navigated' ولا 'route:changed'،
  // اللذين لم يكونا يُصدَران من أي مكان في التطبيق فتوقف تحديث الزر النشط بالكامل).
  const onRouterNavigated = (data) => {
    const page = data?.page || data?.route || 'home';
    updateCurrentPage(page);
  };

  // تحديث عداد الإشعارات
  // 🛠️ إصلاح ترابط: الحقل الفعلي القادم من notifications.js اسمه 'count' وليس 'unreadCount'
  const onNotificationsUpdated = (data) => {
    if (typeof data?.count === 'number') {
      setNotificationsCount(data.count);
    }
  };

  // تحديث حالة الثيم (dark/light icon) – يستمع لكلا الحدثين
  const onThemeChanged = (data) => {
    // data قد يأتي من theme.js مباشرة أو من main.js
    const theme = data?.theme || data?.mode || window.getCurrentTheme?.() || 'light';
    _updateThemeToggleIcon(theme);
  };

  // الاشتراك وحفظ دوال الإلغاء
  const unsubs = [
    EventBus.on('userStateChanged',           onUserStateChanged),
    EventBus.on('profileUpdated',             onProfileUpdated),
    EventBus.on('avatarUpdated',              onProfileUpdated),
    EventBus.on('streak:updated',             onStreakUpdated),
    EventBus.on('pageChanged',                onRouterNavigated),
    EventBus.on('notifications:countChanged', onNotificationsUpdated),
    EventBus.on('newNotification',            onNotificationsUpdated),
    EventBus.on('theme:changed',              onThemeChanged),
    EventBus.on('theme:toggled',              onThemeChanged),
  ];

  // دعم session.js الذي يرسل الحدث عبر document.dispatchEvent
  const docUserStateHandler = (e) => onUserStateChanged(e.detail);
  document.addEventListener('userStateChanged', docUserStateHandler);

  navbarState.eventUnsubscribers = unsubs;
  navbarState._domListeners.push({
    el: document, type: 'userStateChanged', fn: docUserStateHandler
  });
}

/**
 * 11.3 فك الاشتراكات من EventBus وإلغاء مستمعي DOM
 */
function unbindEvents() {
  // فك اشتراكات EventBus
  navbarState.eventUnsubscribers.forEach(unsub => {
    if (typeof unsub === 'function') unsub();
  });
  navbarState.eventUnsubscribers = [];

  // إلغاء مستمعي DOM المتتبعة
  navbarState._domListeners.forEach(({ el, type, fn }) => {
    if (el && typeof el.removeEventListener === 'function') {
      el.removeEventListener(type, fn);
    }
  });
  navbarState._domListeners = [];
}

/** تتبع مستمعي DOM لإمكانية الإلغاء الآمن */
function _trackListener(el, type, fn) {
  navbarState._domListeners.push({ el, type, fn });
}

/** تحديث أيقونة زر الثيم حسب الوضع الحالي */
function _updateThemeToggleIcon(theme) {
  if (!$el.themeToggle) return;
  const isDark = theme === 'dark';
  $el.themeToggle.setAttribute('aria-pressed', String(isDark));
  $el.themeToggle.setAttribute('aria-label', isDark ? 'تفعيل الوضع النهاري' : 'تفعيل الوضع الليلي');
  $el.themeToggle.setAttribute('title',      isDark ? 'الوضع النهاري'       : 'الوضع الليلي');

  const lightIcon = $el.themeToggle.querySelector('.light-icon');
  const darkIcon  = $el.themeToggle.querySelector('.dark-icon');
  if (lightIcon) lightIcon.style.display = isDark  ? 'none'   : 'inline';
  if (darkIcon)  darkIcon.style.display  = !isDark ? 'none'   : 'inline';
}


// ==== 12. دورة الحياة (Lifecycle) ====

/**
 * 12.1 التهيئة الرئيسية للـ Navbar (يُستدعى من main.js)
 */
async function initializeNavbar() {
  // منع التهيئة المتكررة
  if (navbarState.isInitialized) {
    console.warn('[Navbar] تم تهيئة الـ Navbar مسبقاً');
    return;
  }

  console.log('[Navbar] 🚀 بدء تهيئة شريط التنقل v5.0.0...');

  try {
    // ربط عناصر DOM
    bindDomRefs();

    // قراءة حالة المستخدم الحالية من session.js
    const user = getCurrentUser();

    // بناء الواجهة
    updateNavbarUI(user);

    // تفعيل مراقبة الشبكة
    startOnlineStatusMonitoring();

    // تفعيل الإخفاء الذكي للشريط السفلي
    initializeAutoHideBottomNav();

    // ربط أحداث DOM
    bindEvents();

    // بدء دورة حركة اللوجو الديناميكي (B/DNA + iologist) — راجع LOGO_IDENTITY.md
    startLogoAnimation($el.dynamicLogo);

    // الاشتراك في أحداث EventBus
    subscribeToGlobalEvents();

    // مزامنة الصفحة الحالية مع Router إن كان متاحاً
    const currentRoute = window.router?.getCurrentRoute?.() || 'home';
    updateCurrentPage(currentRoute);

    // تطبيق أيقونة الثيم الحالية من theme.js أو data-theme
    const currentTheme = getCurrentTheme();
_updateThemeToggleIcon(currentTheme);

    navbarState.isInitialized = true;

    // إشعار بقية النظام بأن الـ Navbar جاهز
    EventBus.emit('navbar:ready', { user });

    // تعريض الواجهة على window للتكامل الخارجي
    window.navbar = _publicAPI;

    console.log('[Navbar] ✅ شريط التنقل جاهز');
  } catch (error) {
    console.error('[Navbar] ❌ فشل التهيئة:', error);
    throw error;
  }
}

/**
 * 12.2 تدمير الـ Navbar وتنظيف الموارد (Memory Cleanup)
 */
function destroyNavbar() {
  if (!navbarState.isInitialized) return;

  // إيقاف مراقبة الشبكة
  stopOnlineStatusMonitoring();

  // إيقاف نظام الـ Scroll
  destroyAutoHideBottomNav();

  // إيقاف دورة حركة اللوجو
  stopLogoAnimation();

  // فك جميع الاشتراكات
  unbindEvents();

  navbarState.isInitialized = false;
  console.log('[Navbar] 🧹 تم تنظيف شريط التنقل');
}

/**
 * 12.3 إعادة التهيئة بشكل آمن (Destroy → Init)
 */
async function reinitializeNavbar() {
  destroyNavbar();
  await initializeNavbar();
}


// ==== 13. بوابات التحكم الخارجي (Authentication Gateways) ====

/**
 * 13.1 تحديث فوري عند نجاح تسجيل الدخول
 * @param {Object} userData بيانات المستخدم من session.js
 */
function updateAfterLogin(userData) {
  updateNavbarUI(userData);
  EventBus.emit('navbar:userLoggedIn', { user: userData });
}

/**
 * 13.2 تصفير الواجهة عند تسجيل الخروج
 */
function updateAfterLogout() {
  updateNavbarUI(null);
  setNotificationsCount(0);
  EventBus.emit('navbar:userLoggedOut');
}

/**
 * 13.3 استرجاع الحالة الداخلية للـ Navbar (للفحص والـ Debugging)
 * @returns {Object} نسخة من navbarState
 */
function getState() {
  return {
    isInitialized:     navbarState.isInitialized,
    currentPage:       navbarState.currentPage,
    isOnline:          navbarState.isOnline,
    notificationsCount: navbarState.notificationsCount,
    currentUser:       navbarState.currentUser
      ? { id: navbarState.currentUser.id, user_type: navbarState.currentUser.user_type }
      : null
  };
}


// ==== 14. الواجهة العامة (Public API) ====

const _publicAPI = {
  initialize:           initializeNavbar,
  destroy:              destroyNavbar,
  reinitialize:         reinitializeNavbar,
  updateNavbarUI,
  updateUserAvatarAndFrame,
  resetAvatarToDefault,
  setNotificationsCount,
  updateCurrentPage,
  updateActiveNavButton,
  updateAfterLogin,
  updateAfterLogout,
  getState,
  startOnlineStatusMonitoring,
  stopOnlineStatusMonitoring,
  initializeAutoHideBottomNav,
  destroyAutoHideBottomNav
};

// تعريض الـ API على window مبكراً (قبل initializeNavbar) لإتاحة window.navbar
window.navbar = _publicAPI;

// ==== 15. التصدير ====
export {
  initializeNavbar,
  destroyNavbar,
  reinitializeNavbar,
  updateNavbarUI,
  updateUserAvatarAndFrame,
  resetAvatarToDefault,
  setNotificationsCount,
  updateCurrentPage,
  updateActiveNavButton,
  updateAfterLogin,
  updateAfterLogout,
  getState
};

export default _publicAPI;

console.log('✅ [navbar.js] شريط التنقل v5.0.0 – جاهز للتهيئة');
