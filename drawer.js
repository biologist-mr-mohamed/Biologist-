/**
 * القائمة الجانبية - js/ui/drawer.js
 * الإصدار: v5.0.0
 * المسؤولية: إدارة القائمة الجانبية بجميع ميزاتها المتكاملة
 */

// ==== الاستيرادات ====
import { clearSession, getCurrentUser } from '../core/session.js';
import { createAvatarElement, shouldShowVerificationBadge } from '../utils/avatar.js';
import { EventBus } from '../core/event-bus.js';

// ==== ثوابت النظام ====
const DRAWER_CONSTANTS = {
  OPEN_CLASS: 'drawer-open',
  OVERLAY_VISIBLE_CLASS: 'overlay-visible',
  SWIPE_THRESHOLD: 50,
  SWIPE_SENSITIVITY: 30,
  ANIMATION_DURATION: 300,
  PLATFORM_URL: 'https://biologist-mr-mohamed.netlify.app/',
};

// ==== سجل عناصر DOM ====
let $drawerElements = {
  sidebar:               null,
  overlay:               null,
  openBtn:               null,
  closeBtn:              null,
  userAvatarWrap:        null,
  userAvatarContainer:   null,
  userName:              null,
  userRole:              null,
  userStreakEl:          null,
  streakCount:           null,
  loggedSection:         null,
  guestSection:          null,
  logoutBtn:             null,
  teacherItems:          null,
  moderatorItems:        null,
  addButton:             null,
  // ==== [FIX-1] المرجع الوحيد لزر المشاركة هو الزر الموجود في HTML ====
  sharePlatformBtn:      null,
  copyLinkBtn:           null,
  verificationBadge:     null,
  userStats:             null,
  progressBarContainer:  null,
  progressBarFill:       null,
  lastActivity:          null,
  greeting:              null,
  notifPreview:          null,
  leaderboardContainer:  null,
  favoritesContainer:    null,
  roleBanner:            null,
  themeIndicator:        null,
  quickActions:          null,
  settingsShortcuts:     null,
  devInfo:               null
};

// ==== حالة القائمة ====
let $drawerState = {
  isOpen:             false,
  isInitialized:      false,
  touchStartX:        0,
  touchStartY:        0,
  isSwiping:          false,
  eventUnsubscribers: [],
  isDrawerActive:     false,
  _domListeners:      {}   // ==== [إصلاح] تخزين دوال مستمعي document لإزالتها لاحقاً ====
};


// ==== دوال مساعدة عامة ====


function getUserRoleArabic(userType) {
  const roles = { student: 'طالب', moderator: 'مشرف', teacher: 'معلم' };
  return roles[userType] || 'مستخدم';
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'صباح الخير ☀️';
  if (hour < 18) return 'مساء الخير 🌤️';
  return 'مساء النور 🌙';
}

function getRoleMessage(user) {
  if (!user) return '';
  const messages = {
    student:   'استمر يا بطل 💪',
    teacher:   'أنت تقود الجيل 🚀',
    moderator: 'تحكم كامل 🔥'
  };
  return messages[user.user_type] || 'مرحباً بك 🌟';
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

function safeToast(message, type = 'info') {
  if (window.modals?.toast) window.modals.toast(message, type);
}

function formatLastActivity(lastActivity) {
  if (!lastActivity) return 'لا يوجد نشاط حديث';

  let date;
  if (lastActivity?.toDate)        date = lastActivity.toDate();
  else if (lastActivity?.seconds)  date = new Date(lastActivity.seconds * 1000);
  else                             date = new Date(lastActivity);

  if (isNaN(date.getTime())) return 'لا يوجد نشاط حديث';

  const now       = new Date();
  const diffMs    = now - date;
  const diffMins  = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays  = Math.floor(diffHours / 24);

  if (diffMins < 1)    return 'الآن';
  if (diffMins < 60)   return `منذ ${diffMins} دقيقة`;
  if (diffHours < 24)  return `منذ ${diffHours} ساعة`;
  return `منذ ${diffDays} يوم`;
}


// ==== تحديث عناصر القائمة حسب الصلاحيات ====


function updateRoleBasedElements(user) {
  const isTeacher   = user?.user_type === 'teacher';
  const isModerator = user?.user_type === 'moderator';
  const canAdd      = isTeacher || isModerator;

// ==== لوحة التحكم — للمعلم فقط ====
  if ($drawerElements.teacherItems) {
    $drawerElements.teacherItems.forEach(item => {
      item.style.display = isTeacher ? 'flex' : 'none';
    });
  }

  // ==== لوحة المشرف — للمشرف فقط (وليس المعلم) ====
  if ($drawerElements.moderatorItems) {
    $drawerElements.moderatorItems.forEach(item => {
      item.style.display = isModerator ? 'flex' : 'none';
    });
  }

  if ($drawerElements.addButton) {
    $drawerElements.addButton.style.display = canAdd ? 'flex' : 'none';
    const addParent = $drawerElements.addButton.closest('.teacher-or-supervisor-only');
    if (addParent) addParent.style.display = canAdd ? 'flex' : 'none';
  }
}


// ==== تهيئة عناصر DOM ====

function initDrawerElements() {
  try {
    $drawerElements.sidebar              = document.getElementById('sidebar');
    $drawerElements.overlay              = document.getElementById('sidebar-overlay');
    $drawerElements.openBtn              = document.getElementById('open-drawer-btn');
    $drawerElements.closeBtn             = document.getElementById('close-sidebar');
    $drawerElements.userAvatarWrap       = document.querySelector('.user-avatar-large');
    $drawerElements.userAvatarContainer  = document.getElementById('sidebar-avatar-container');
    $drawerElements.userName             = document.getElementById('sidebar-user-name');
    $drawerElements.userRole             = document.getElementById('sidebar-user-role');
    $drawerElements.userStreakEl         = document.getElementById('sidebar-streak');
    $drawerElements.streakCount          = document.getElementById('streak-count');
    $drawerElements.loggedSection        = document.querySelector('.sidebar-logged');
    $drawerElements.guestSection         = document.querySelector('.sidebar-guest');
    $drawerElements.logoutBtn            = document.getElementById('logout-btn');
    $drawerElements.teacherItems         = document.querySelectorAll('.teacher-only');
    $drawerElements.moderatorItems       = document.querySelectorAll('.moderator-only');
    $drawerElements.addButton            = document.getElementById('add-button');
    $drawerElements.sharePlatformBtn     = document.getElementById('share-app-btn');
    $drawerElements.copyLinkBtn          = document.getElementById('copy-link-btn');
    $drawerElements.verificationBadge    = document.getElementById('sidebar-verification');
    $drawerElements.userStats            = document.getElementById('sidebar-user-stats');
    $drawerElements.progressBarContainer = document.getElementById('sidebar-progress-container');
    $drawerElements.progressBarFill      = document.getElementById('sidebar-progress-bar');
    $drawerElements.lastActivity         = document.getElementById('sidebar-last-activity-text');
    $drawerElements.greeting             = document.getElementById('sidebar-greeting');
    $drawerElements.notifPreview         = document.getElementById('sidebar-notif-preview');
    $drawerElements.leaderboardContainer = document.getElementById('sidebar-leaderboard');
    $drawerElements.favoritesContainer   = document.getElementById('sidebar-favorites');
    $drawerElements.roleBanner           = document.getElementById('role-banner');
    $drawerElements.themeIndicator       = document.getElementById('theme-indicator');
    $drawerElements.quickActions         = document.getElementById('sidebar-quick-actions');
    $drawerElements.settingsShortcuts    = document.getElementById('sidebar-settings-shortcuts');
    $drawerElements.devInfo              = document.getElementById('dev-info');

    const essentialElements = ['sidebar', 'openBtn', 'closeBtn', 'overlay'];
    const missing = essentialElements.filter(el => !$drawerElements[el]);

    if (missing.length > 0) {
      console.warn('⚠️ عناصر القائمة المفقودة:', missing);
      return false;
    }
    return true;
  } catch (error) {
    console.error('❌ فشل تهيئة عناصر القائمة:', error);
    return false;
  }
}

// ==== إنشاء العناصر الديناميكية المفقودة ====


function createMissingElements() {
  const sidebarUser   = document.querySelector('.sidebar-user');
  const loggedSection = document.querySelector('.sidebar-logged');
  if (!sidebarUser && !loggedSection) return;

// ==== إنشاء حاوية الأفاتار الموحدة (باستخدام avatar.js) ====
const avatarWrap = document.querySelector('.user-avatar-large');
if (avatarWrap && !avatarWrap.querySelector('.avatar-wrapper')) {
  avatarWrap.innerHTML = '';
  // لا ننشئ أي عناصر هنا، سيتم إنشاؤها ديناميكياً بواسطة updateDrawerContent
  // نضيف فقط حاوية مرنة
  const container = document.createElement('div');
  container.id = 'sidebar-avatar-container';
  container.className = 'sidebar-avatar-container';
  avatarWrap.appendChild(container);
  $drawerElements.userAvatarContainer = container;
}

  // ==== الإحصائيات السريعة ====
  if (!document.getElementById('sidebar-user-stats')) {
    const div = document.createElement('div');
    div.id        = 'sidebar-user-stats';
    div.className = 'user-stats';
    sidebarUser?.appendChild(div);
    $drawerElements.userStats = div;
  }

  // ==== شريط التقدم ====
  if (!document.getElementById('sidebar-progress-container')) {
    const div = document.createElement('div');
    div.id        = 'sidebar-progress-container';
    div.className = 'progress-container';
    div.innerHTML = `
      <div class="progress-bar-bg" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <div class="progress-bar-fill" id="sidebar-progress-bar"></div>
      </div>
      <span class="progress-percent" id="sidebar-progress-percent">0%</span>
    `;
    sidebarUser?.appendChild(div);
    $drawerElements.progressBarContainer = div;
    $drawerElements.progressBarFill = document.getElementById('sidebar-progress-bar');
  }

  // ==== آخر نشاط ====
  if (!document.getElementById('sidebar-last-activity')) {
    const div = document.createElement('div');
    div.id        = 'sidebar-last-activity';
    div.className = 'last-activity';
    div.innerHTML = '<i class="fas fa-clock" aria-hidden="true"></i><span id="sidebar-last-activity-text"></span>';
    sidebarUser?.appendChild(div);
    $drawerElements.lastActivity = div.querySelector('#sidebar-last-activity-text');
  }

  // ==== تحية ذكية ====
  if (!document.getElementById('sidebar-greeting')) {
    const div = document.createElement('div');
    div.id        = 'sidebar-greeting';
    div.className = 'greeting';
    sidebarUser?.appendChild(div);
    $drawerElements.greeting = div;
  }

  // ==== معاينة الإشعارات ====
  if (!document.getElementById('sidebar-notif-preview')) {
    const div = document.createElement('div');
    div.id        = 'sidebar-notif-preview';
    div.className = 'notif-preview';
    loggedSection?.appendChild(div);
    $drawerElements.notifPreview = div;
  }

  // ==== بانر الدور ====
  if (!document.getElementById('role-banner')) {
    const div = document.createElement('div');
    div.id        = 'role-banner';
    div.className = 'role-banner';
    loggedSection?.appendChild(div);
    $drawerElements.roleBanner = div;
  }

  // ==== مؤشر الثيم ====
  if (!document.getElementById('theme-indicator')) {
    const div = document.createElement('div');
    div.id        = 'theme-indicator';
    div.className = 'theme-indicator';
    div.title     = 'لون الثيم الحالي';
    sidebarUser?.appendChild(div);
    $drawerElements.themeIndicator = div;
  }

  // ==== معلومات المطور (للمعلم فقط) ====
  if (!document.getElementById('dev-info')) {
    const div = document.createElement('div');
    div.id        = 'dev-info';
    div.className = 'dev-info';
    loggedSection?.appendChild(div);
    $drawerElements.devInfo = div;
  }

  // ==== ملاحظة: لا يُنشأ زر share-platform-btn هنا بعد الآن ====
  // الزر الموجود في index.html (share-app-btn) هو المرجع الوحيد
}


// ==== التحكم الأساسي بالقائمة ====


function openDrawer() {
  if (!$drawerElements.sidebar || $drawerState.isOpen) return;

  try {
    $drawerElements.sidebar.classList.add(DRAWER_CONSTANTS.OPEN_CLASS);
    $drawerElements.sidebar.setAttribute('aria-hidden', 'false');

    if ($drawerElements.overlay) {
      $drawerElements.overlay.classList.add(DRAWER_CONSTANTS.OVERLAY_VISIBLE_CLASS);
      $drawerElements.overlay.setAttribute('aria-hidden', 'false');
    }

    document.body.classList.add(DRAWER_CONSTANTS.OPEN_CLASS);
    $drawerState.isOpen        = true;
    $drawerState.isDrawerActive = true;

    requestAnimationFrame(() => {
      document.addEventListener('click', handleOutsideDrawerClick);
      document.addEventListener('keydown', handleDrawerKeydown);
    });

    document.body.style.overflow = 'hidden';

    setTimeout(() => {
      const firstFocusable = $drawerElements.sidebar.querySelector(
        'button, [href], input, [tabindex]:not([tabindex="-1"])'
      );
      if (firstFocusable) firstFocusable.focus();
    }, 100);

    document.dispatchEvent(new CustomEvent('drawerOpened'));
  } catch (error) {
    console.error('❌ خطأ في فتح القائمة:', error);
  }
}

function closeDrawer(force = false) {
  if (!$drawerElements.sidebar || (!$drawerState.isOpen && !force)) return;

  try {
    $drawerState.isDrawerActive = false;

    $drawerElements.sidebar.classList.remove(DRAWER_CONSTANTS.OPEN_CLASS);
    $drawerElements.sidebar.setAttribute('aria-hidden', 'true');

    if ($drawerElements.overlay) {
      $drawerElements.overlay.classList.remove(DRAWER_CONSTANTS.OVERLAY_VISIBLE_CLASS);
      $drawerElements.overlay.setAttribute('aria-hidden', 'true');
    }

    document.body.classList.remove(DRAWER_CONSTANTS.OPEN_CLASS);
    document.body.style.overflow = '';

    document.removeEventListener('click', handleOutsideDrawerClick);
    document.removeEventListener('keydown', handleDrawerKeydown);

    $drawerState.isOpen = false;

    if ($drawerElements.openBtn && document.body.contains($drawerElements.openBtn)) {
      setTimeout(() => { try { $drawerElements.openBtn.focus(); } catch (_) {} }, 100);
    }

    document.dispatchEvent(new CustomEvent('drawerClosed'));

    if (force) {
      $drawerElements.sidebar.style.cssText = '';
      if ($drawerElements.overlay) $drawerElements.overlay.style.cssText = '';
    }
  } catch (error) {
    console.error('❌ خطأ في إغلاق القائمة:', error);
    if (force) {
      $drawerState.isOpen        = false;
      $drawerState.isDrawerActive = false;
      document.body.style.overflow = '';
    }
  }
}

function toggleDrawer() {
  $drawerState.isOpen ? closeDrawer() : openDrawer();
}


// ==== مستمعات الأحداث الجانبية ====


function handleOutsideDrawerClick(event) {
  if (!$drawerElements.sidebar || !$drawerState.isOpen) return;
  const isClickOutside  = !$drawerElements.sidebar.contains(event.target);
  const isNotOpenButton = $drawerElements.openBtn
    ? !$drawerElements.openBtn.contains(event.target) : true;
  if (isClickOutside && isNotOpenButton) closeDrawer();
}

function handleDrawerKeydown(event) {
  if (!$drawerState.isOpen) return;

  if (event.key === 'Escape') {
    closeDrawer();
    event.preventDefault();
    return;
  }

  if (event.key === 'Tab' && $drawerElements.sidebar) {
    const focusable = $drawerElements.sidebar.querySelectorAll(
      'button, [href], input, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last  = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      last.focus();
      event.preventDefault();
    } else if (!event.shiftKey && document.activeElement === last) {
      first.focus();
      event.preventDefault();
    }
  }
}


// ==== إيماءات السحب (Swipe Gestures) ====


function initSwipeGestures() {
  if (!$drawerElements.sidebar || !('ontouchstart' in window)) return;
  $drawerElements.sidebar.addEventListener('touchstart', handleTouchStart, { passive: true });
  $drawerElements.sidebar.addEventListener('touchmove', handleTouchMove, { passive: false });
  $drawerElements.sidebar.addEventListener('touchend', handleTouchEnd, { passive: true });

  // ==== دعم السحب من حافة الشاشة لفتح القائمة ====
  document.addEventListener('touchstart', handleEdgeSwipeStart, { passive: true });
  document.addEventListener('touchend', handleEdgeSwipeEnd, { passive: true });
}

let _edgeSwipeStartX = 0;
function handleEdgeSwipeStart(e) {
  if (e.touches.length !== 1) return;
  _edgeSwipeStartX = e.touches[0].clientX;
}
function handleEdgeSwipeEnd(e) {
  if (e.changedTouches.length !== 1 || $drawerState.isOpen) return;
  const deltaX = e.changedTouches[0].clientX - _edgeSwipeStartX;
  // إذا بدأ السحب من أقصى اليسار (أول 20px)
  if (_edgeSwipeStartX < 20 && deltaX > DRAWER_CONSTANTS.SWIPE_THRESHOLD) {
    openDrawer();
  }
}

function handleTouchStart(e) {
  if (e.touches.length !== 1) return;
  $drawerState.touchStartX = e.touches[0].clientX;
  $drawerState.touchStartY = e.touches[0].clientY;
  $drawerState.isSwiping   = true;
}

function handleTouchMove(e) {
  if (!$drawerState.isSwiping || e.touches.length !== 1) return;
  const deltaX = e.touches[0].clientX - $drawerState.touchStartX;
  const deltaY = Math.abs(e.touches[0].clientY - $drawerState.touchStartY);
  if (deltaY < DRAWER_CONSTANTS.SWIPE_SENSITIVITY && Math.abs(deltaX) > DRAWER_CONSTANTS.SWIPE_THRESHOLD) {
    e.preventDefault();
  }
}

function handleTouchEnd(e) {
  if (!$drawerState.isSwiping || e.changedTouches.length !== 1) return;
  const deltaX = e.changedTouches[0].clientX - $drawerState.touchStartX;
  const deltaY = Math.abs(e.changedTouches[0].clientY - $drawerState.touchStartY);
  if (deltaY < DRAWER_CONSTANTS.SWIPE_SENSITIVITY && Math.abs(deltaX) > DRAWER_CONSTANTS.SWIPE_THRESHOLD) {
    if (deltaX > 0 && !$drawerState.isOpen) openDrawer();
    else if (deltaX < 0 && $drawerState.isOpen) closeDrawer();
  }
  $drawerState.isSwiping = false;
}


// ==== تسجيل الخروج ====


async function handleLogout(event) {
  if (event) event.stopPropagation();
  try {
    safeToast('جاري تسجيل الخروج...', 'info');
    await clearSession();
    updateDrawerContent(null);
    if (window.navbar?.updateAfterLogout) window.navbar.updateAfterLogout();
    closeDrawer();
    setTimeout(() => { if (window.router?.navigateTo) window.router.navigateTo('home'); }, 300);
    setTimeout(() => safeToast('تم تسجيل الخروج بنجاح', 'success'), 400);
  } catch (error) {
    console.error('❌ خطأ في تسجيل الخروج:', error);
    safeToast('حدث خطأ أثناء تسجيل الخروج', 'error');
  }
}


// ==== تبديل الثيم من القائمة ====


function handleSidebarThemeToggle(event) {
  event.stopPropagation();
  const newTheme = window.toggleTheme ? window.toggleTheme() : 'light';
  updateThemeIndicator();
  closeDrawer();
  safeToast(`تم التبديل للوضع ${newTheme === 'dark' ? 'الليلي' : 'النهاري'}`, 'success');
}


// ==== مشاركة المنصة ====


function handleSharePlatform(event) {
  if (event) event.stopPropagation();

  const shareData = {
    title: 'منصة بيولوجست التعليمية',
    text: 'انضم إلى منصة بيولوجست — تجربة تعليمية متكاملة لمادة الأحياء والعلوم 🌿',
    url: DRAWER_CONSTANTS.PLATFORM_URL
  };

  if (navigator.share) {
    navigator.share(shareData)
      .then(() => safeToast('تمت المشاركة بنجاح ✅', 'success'))
      .catch(err => {
        if (err.name !== 'AbortError') copyPlatformUrl();
      });
  } else {
    copyPlatformUrl();
  }
}

function copyPlatformUrl() {
  navigator.clipboard.writeText(DRAWER_CONSTANTS.PLATFORM_URL)
    .then(() => safeToast('تم نسخ رابط المنصة 📋', 'success'))
    .catch(() => safeToast(`رابط المنصة: ${DRAWER_CONSTANTS.PLATFORM_URL}`, 'info'));
}

// ==== نسخ رابط الصفحة الحالية ====
function handleCopyCurrentLink(event) {
  if (event) event.stopPropagation();
  const url = window.location.href;
  navigator.clipboard.writeText(url)
    .then(() => safeToast('تم نسخ رابط الصفحة 📋', 'success'))
    .catch(() => safeToast(`رابط الصفحة: ${url}`, 'info'));
}


// ==== قائمة الإضافة (Add Menu) ====


function showAddMenu() {
  if (!window.modals?.showModal) {
    safeToast('هذه الميزة غير متاحة حالياً', 'warning');
    return;
  }

  const user = getCurrentUser();
  if (!user) {
    safeToast('يجب تسجيل الدخول أولاً', 'error');
    return;
  }

  const isTeacher   = user.user_type === 'teacher';
  const isModerator = user.user_type === 'moderator';

  const menuItems = [];
  if (isTeacher || isModerator) {
    menuItems.push({ type: 'lesson',    icon: 'fa-book',          label: 'درس جديد',    color: 'var(--color-success)' });
    menuItems.push({ type: 'exam',      icon: 'fa-file-alt',      label: 'امتحان جديد', color: 'var(--color-info)' });
    menuItems.push({ type: 'event',     icon: 'fa-calendar-plus', label: 'حدث / إعلان', color: 'var(--color-warning)' });
  }
  if (isTeacher) {
    menuItems.push({ type: 'unit',      icon: 'fa-layer-group',   label: 'وحدة / باب',  color: 'var(--primary)' });
    menuItems.push({ type: 'moderator', icon: 'fa-user-shield',   label: 'مشرف جديد',   color: 'var(--color-error)' });
  }

  if (!menuItems.length) {
    safeToast('ليس لديك صلاحية لإضافة محتوى', 'error');
    return;
  }

  const menuHTML = `
    <div class="add-menu-container" role="menu" aria-label="قائمة الإضافة">
      <div class="add-menu-grid">
        ${menuItems.map(item => `
          <button
            class="add-menu-item"
            type="button"
            data-add-type="${item.type}"
            role="menuitem"
            aria-label="${item.label}"
          >
            <div class="add-menu-icon add-menu-icon--${item.type}">
              <i class="fas ${item.icon}" aria-hidden="true"></i>
            </div>
            <div class="add-menu-label">${item.label}</div>
            <div class="add-menu-arrow">
              <i class="fas fa-chevron-left" aria-hidden="true"></i>
            </div>
          </button>
        `).join('')}
      </div>
      <div class="add-menu-footer">
        <p class="add-menu-note">
          <i class="fas fa-info-circle" aria-hidden="true"></i>
          أضف محتوى تعليمي جديد للمنصة
        </p>
      </div>
    </div>
  `;

  window.modals.showModal({
    title: 'إضافة محتوى جديد',
    html: menuHTML,
    size: 'medium',
    buttons: [{ text: 'إلغاء', role: 'cancel', type: 'secondary' }],
    onOpen: () => {
      const container = document.querySelector('.add-menu-container');
      if (!container) return;

      container.addEventListener('click', async (e) => {
        const btn = e.target.closest('.add-menu-item');
        if (!btn) return;

        const type = btn.dataset.addType;
        window.modals.closeAllModals?.();

        switch (type) {
          case 'lesson':
            if (window.lessonManager?.openAddLessonModal) {
              window.lessonManager.openAddLessonModal();
            } else {
              safeToast('جاري تحميل نموذج إضافة درس...', 'info');
              try {
                const mod = await import('../../views/lessons/lesson-manager.js');
                if (mod.openAddLessonModal) mod.openAddLessonModal();
              } catch (_) { safeToast('تعذّر تحميل نموذج الدرس', 'error'); }
            }
            break;

          case 'exam':
            if (window.examManager?.openAddExamModal) {
              window.examManager.openAddExamModal();
            } else {
              safeToast('جاري تحميل نموذج إضافة امتحان...', 'info');
              try {
                const mod = await import('../../views/exams/exam-manager.js');
                if (mod.openAddExamModal) mod.openAddExamModal();
              } catch (_) { safeToast('تعذّر تحميل نموذج الامتحان', 'error'); }
            }
            break;

          case 'event':     openAddEventModal(); break;
          case 'unit':
            if (window.lessonManager?.openAddUnitModal) {
              window.lessonManager.openAddUnitModal();
            } else {
              safeToast('جاري تحميل نموذج إضافة وحدة...', 'info');
              try {
                const mod = await import('../../views/lessons/lesson-manager.js');
                if (mod.openAddUnitModal) mod.openAddUnitModal();
              } catch (_) { safeToast('تعذّر تحميل نموذج الوحدة', 'error'); }
            }
            break;

          case 'moderator':
            if (window.router?.navigateTo) {
              window.router.navigateTo('dashboard');
              closeDrawer();
            } else {
              safeToast('توجه إلى لوحة التحكم لإضافة مشرف', 'info');
            }
            break;
        }
      });
    }
  });
}

function handleAddButtonClick(event) {
  event.stopPropagation();
  closeDrawer(true);
  requestAnimationFrame(() => showAddMenu());
}

// ==== [محذوف] نموذج إضافة وحدة نُقل إلى lesson-manager.js — انظر case 'unit' في showAddMenu ====

// ==== نموذج إضافة حدث / إعلان ====
function openAddEventModal() {
  if (!window.modals?.showModal) return;

  window.modals.showModal({
    title: 'إضافة حدث أو إعلان',
    html: `
      <div class="add-event-form" role="form" aria-label="نموذج إضافة حدث">
        <div class="form-group">
          <label for="event-type">
            <i class="fas fa-tag" aria-hidden="true"></i> نوع المحتوى
            <span class="required-mark" aria-hidden="true">*</span>
          </label>
          <select id="event-type" class="form-input" required aria-required="true">
            <option value="event">حدث</option>
            <option value="announcement">إعلان</option>
            <option value="offer">عرض</option>
            <option value="feature">ميزة للطلاب</option>
          </select>
        </div>
        <div class="form-group">
          <label for="event-title">
            <i class="fas fa-heading" aria-hidden="true"></i> العنوان
            <span class="required-mark" aria-hidden="true">*</span>
          </label>
          <input type="text" id="event-title" class="form-input"
            placeholder="عنوان الحدث أو الإعلان"
            required aria-required="true" maxlength="200">
        </div>
        <div class="form-group">
          <label for="event-body">
            <i class="fas fa-align-left" aria-hidden="true"></i> التفاصيل
          </label>
          <textarea id="event-body" class="form-input" rows="4"
            placeholder="اكتب تفاصيل الحدث أو الإعلان هنا..." maxlength="1000"></textarea>
        </div>
      </div>
    `,
    buttons: [
      { text: 'إلغاء', role: 'cancel',  type: 'secondary' },
      { text: 'نشر',   role: 'confirm', type: 'primary' }
    ],
    onConfirm: async () => {
      const type  = document.getElementById('event-type')?.value;
      const title = document.getElementById('event-title')?.value?.trim();
      const body  = document.getElementById('event-body')?.value?.trim() || '';

      if (!type || !title) {
        safeToast('يرجى ملء الحقول المطلوبة', 'warning');
        return false;
      }

      EventBus.emit('platformEventCreated', { type, title, body, createdAt: Date.now() });
      safeToast('تم نشر الحدث بنجاح ✅', 'success');
      return true;
    }
  });
}

// ==== [إصلاح] لم يعد drawer.js يملك تنفيذه الخاص لإضافة الوحدات — التعريض أصبح في lesson-manager.js ====


// ==== دوال الميزات المتقدمة ====


function updateQuickStats(user) {
  if (!$drawerElements.userStats) return;

  if (user?.user_type === 'student') {
    $drawerElements.userStats.innerHTML = `
      <span class="stat-item" title="الدروس المكتملة">
        <i class="fas fa-book" aria-hidden="true"></i>
        ${escapeHtml(String(user.completed_lessons || 0))}
      </span>
      <span class="stat-item" title="الامتحانات المؤداة">
        <i class="fas fa-file-alt" aria-hidden="true"></i>
        ${escapeHtml(String(user.exams_taken || 0))}
      </span>
      <span class="stat-item" title="مجموع النقاط">
        <i class="fas fa-star" aria-hidden="true"></i>
        ${escapeHtml(String(user.total_score || 0))}
      </span>
    `;
    $drawerElements.userStats.style.display = 'flex';
  } else {
    $drawerElements.userStats.style.display = 'none';
  }
}

function updateProgressBar(user) {
  if (!$drawerElements.progressBarFill || !$drawerElements.progressBarContainer) return;

  if (user?.user_type === 'student') {
    const progress = Math.min(100, Math.max(0, user.progress || 0));
    $drawerElements.progressBarFill.style.width = `${progress}%`;
    $drawerElements.progressBarFill.setAttribute('aria-valuenow', progress);
    const bgEl = $drawerElements.progressBarFill.parentElement;
    if (bgEl) bgEl.setAttribute('aria-valuenow', progress);
    $drawerElements.progressBarContainer.style.display = 'block';

    const percentEl = document.getElementById('sidebar-progress-percent');
    if (percentEl) percentEl.textContent = `${progress}%`;
  } else {
    $drawerElements.progressBarContainer.style.display = 'none';
  }
}

function updateLastActivityDisplay(user) {
  const el        = $drawerElements.lastActivity;
  const container = document.getElementById('sidebar-last-activity');
  if (!el || !container) return;

  el.textContent       = user?.last_activity
    ? formatLastActivity(user.last_activity)
    : 'لا يوجد نشاط حديث';
  container.style.display = 'flex';
}

function updateGreeting() {
  if ($drawerElements.greeting) {
    $drawerElements.greeting.textContent = getGreeting();
  }
}

function updateRoleBanner(user) {
  if (!$drawerElements.roleBanner) return;
  const message = getRoleMessage(user);
  if (message) {
    $drawerElements.roleBanner.textContent = message;
    $drawerElements.roleBanner.style.display = 'block';
  } else {
    $drawerElements.roleBanner.style.display = 'none';
  }
}

function updateThemeIndicator() {
  if (!$drawerElements.themeIndicator) return;
  const primaryColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--primary').trim();
  $drawerElements.themeIndicator.setAttribute('data-theme-color', primaryColor || '#667eea');
}

// ==== تحديث Streak (الاستمرارية) ====
function updateStreakDisplay(user) {
  const streakEl = $drawerElements.userStreakEl
    || document.getElementById('sidebar-streak');
  if (!streakEl) return;

  if (user?.user_type === 'student') {
    streakEl.style.display = 'flex';
    const countEl = $drawerElements.streakCount || document.getElementById('streak-count');
    if (countEl) {
      const streak = user.streak || 0;
      countEl.textContent = streak;
      streakEl.classList.remove('streak--low', 'streak--medium', 'streak--high', 'streak--legend');
      if      (streak === 0)      streakEl.classList.add('streak--low');
      else if (streak < 7)        streakEl.classList.add('streak--low');
      else if (streak < 30)       streakEl.classList.add('streak--medium');
      else if (streak < 100)      streakEl.classList.add('streak--high');
      else                        streakEl.classList.add('streak--legend');

      streakEl.setAttribute('title', `${streak} يوم متواصل 🔥`);
      streakEl.setAttribute('aria-label', `الـ streak: ${streak} يوم`);
    }
  } else {
    streakEl.style.display = 'none';
  }
}

// ==== تحديث الدروس المفضلة ====
function updateFavorites(user) {
  const container = document.getElementById('sidebar-favorites');
  if (!container) return;
  if (!$drawerElements.favoritesContainer) $drawerElements.favoritesContainer = container;

  if (user?.favorites?.length > 0) {
    const favorites = user.favorites.slice(0, 3);
    $drawerElements.favoritesContainer.innerHTML = favorites.map(id => `
      <button class="fav-item" type="button" data-lesson-id="${escapeHtml(String(id))}">
        <i class="fas fa-bookmark" aria-hidden="true"></i>
        <span>درس رقم ${escapeHtml(String(id))}</span>
      </button>
    `).join('');
    container.style.display = 'block';

    if (!$drawerElements.favoritesContainer._hasDelegation) {
      $drawerElements.favoritesContainer.addEventListener('click', handleFavoriteContainerClick);
      $drawerElements.favoritesContainer._hasDelegation = true;
    }
  } else {
    $drawerElements.favoritesContainer.innerHTML =
      '<p class="fav-empty">لا توجد دروس محفوظة بعد</p>';
    container.style.display = 'block';
  }
}

function handleFavoriteContainerClick(e) {
  const favItem = e.target.closest('.fav-item');
  if (!favItem) return;
  const lessonId = favItem.getAttribute('data-lesson-id');
  if (lessonId && window.router?.navigateTo) {
    window.router.navigateTo('lesson-view', { path: { id: lessonId } });
    closeDrawer();
  }
}

// ==== معلومات المطور (للمعلم فقط) ====
function updateDevInfo(user) {
  if (!$drawerElements.devInfo) return;
  if (user?.user_type === 'teacher') {
    $drawerElements.devInfo.innerHTML = `
      <div class="dev-info-row">
        <i class="fas fa-id-badge" aria-hidden="true"></i>
        <span>ID: ${escapeHtml(String(user.id || '—'))}</span>
      </div>
      <div class="dev-info-row">
        <i class="fas fa-user-tie" aria-hidden="true"></i>
        <span>الدور: معلم / مدير</span>
      </div>
    `;
    $drawerElements.devInfo.style.display = 'block';
  } else {
    $drawerElements.devInfo.style.display = 'none';
  }
}

// ==== [FIX-3] اختصارات الإعدادات — إضافة notifBtn المفقود ====
function bindSettingsShortcuts() {
  if (!$drawerElements.settingsShortcuts) return;

  const darkModeBtn = $drawerElements.settingsShortcuts.querySelector('[data-setting="dark-mode"]');
  const notifBtn    = $drawerElements.settingsShortcuts.querySelector('[data-setting="notifications"]');
  const settingsBtn = $drawerElements.settingsShortcuts.querySelector('[data-setting="settings"]');

  if (darkModeBtn) {
    darkModeBtn.removeEventListener('click', handleDarkModeClick);
    darkModeBtn.addEventListener('click', handleDarkModeClick);
  }
  if (notifBtn) {
    notifBtn.removeEventListener('click', handleNotifSettingsClick);
    notifBtn.addEventListener('click', handleNotifSettingsClick);
  }
  if (settingsBtn) {
    settingsBtn.removeEventListener('click', handleSettingsClick);
    settingsBtn.addEventListener('click', handleSettingsClick);
  }
}

function handleDarkModeClick() {
  if (window.toggleTheme) window.toggleTheme();
  updateThemeIndicator();
  closeDrawer();
}

function handleNotifSettingsClick() {
  if (window.router?.navigateTo) window.router.navigateTo('notifications');
  closeDrawer();
}

function handleSettingsClick() {
  if (window.router?.navigateTo) window.router.navigateTo('settings');
  closeDrawer();
}

// ==== الإجراءات السريعة ====
function bindQuickActions() {
  if (!$drawerElements.quickActions) return;

  const resumeLessonBtn = $drawerElements.quickActions.querySelector('[data-action="resume-lesson"]');
  const resumeExamBtn   = $drawerElements.quickActions.querySelector('[data-action="resume-exam"]');

  if (resumeLessonBtn) {
    resumeLessonBtn.removeEventListener('click', handleResumeLesson);
    resumeLessonBtn.addEventListener('click', handleResumeLesson);
  }
  if (resumeExamBtn) {
    resumeExamBtn.removeEventListener('click', handleResumeExam);
    resumeExamBtn.addEventListener('click', handleResumeExam);
  }
}

function handleResumeLesson() {
  const lastLessonId = localStorage.getItem('last_lesson_id');
  if (lastLessonId && window.router?.navigateTo) {
    window.router.navigateTo('lesson-view', { path: { id: lastLessonId } });
    closeDrawer();
  } else {
    safeToast('لا يوجد درس سابق للمتابعة', 'info');
  }
}

function handleResumeExam() {
  const lastExamId = localStorage.getItem('last_exam_id');
  if (lastExamId && window.router?.navigateTo) {
    window.router.navigateTo('exam-view', { path: { id: lastExamId } });
    closeDrawer();
  } else {
    safeToast('لا يوجد امتحان سابق للمتابعة', 'info');
  }
}


// ==== تحديث محتوى القائمة الكامل ====


function updateDrawerContent(user = null) {
  try {
    if (!$drawerElements.guestSection || !$drawerElements.loggedSection) {
      console.warn('⚠️ عناصر المحتوى الرئيسية غير موجودة');
      return;
    }

    if (!user) {
      // ==== وضع الزائر ====
      $drawerElements.guestSection.style.display  = 'block';
      $drawerElements.guestSection.setAttribute('aria-hidden', 'false');
      $drawerElements.loggedSection.style.display = 'none';
      $drawerElements.loggedSection.setAttribute('aria-hidden', 'true');

      if ($drawerElements.userName) $drawerElements.userName.textContent = 'الضيف';
      if ($drawerElements.userRole) $drawerElements.userRole.textContent = 'يرجى تسجيل الدخول';

      const avatarContainer = $drawerElements.userAvatarContainer || document.getElementById('sidebar-avatar-container');
if (avatarContainer) {
  avatarContainer.innerHTML = '';
  const guestAvatar = createAvatarElement(null, 'lg', { 
    showFrame:   true, 
    showBadge:   false, 
    clickable:   false,
    showShimmer: true
  });
  avatarContainer.appendChild(guestAvatar);
}

      updateRoleBasedElements(null);

      [$drawerElements.userStats, $drawerElements.progressBarContainer,
       $drawerElements.roleBanner, $drawerElements.devInfo,
       document.getElementById('sidebar-last-activity'),
       document.getElementById('sidebar-leaderboard'),
       document.getElementById('sidebar-favorites')
      ].forEach(el => { if (el) el.style.display = 'none'; });

      return;
    }

    // ==== وضع المستخدم المسجل ====
    $drawerElements.guestSection.style.display  = 'none';
    $drawerElements.guestSection.setAttribute('aria-hidden', 'true');
    $drawerElements.loggedSection.style.display = 'block';
    $drawerElements.loggedSection.setAttribute('aria-hidden', 'false');

    // ==== الاسم والدور ====
    if ($drawerElements.userName) {
      $drawerElements.userName.textContent = user.full_name || user.username || 'المستخدم';
    }
    if ($drawerElements.userRole) {
      $drawerElements.userRole.textContent = getUserRoleArabic(user.user_type);
    }

// ==== الأفاتار الموحد (باستخدام avatar.js) ====
const avatarContainer = $drawerElements.userAvatarContainer || document.getElementById('sidebar-avatar-container');
if (avatarContainer) {
  const existingAvatar = avatarContainer.querySelector('.avatar-wrapper');
  // ==== [إصلاح] العنصر الحالي، إن وُجد، قد يكون أفاتار "ضيف" غير قابل للنقر ====
  // (أُنشئ بـ clickable:false عند التحميل الأولي قبل تسجيل الدخول). تحديثه بـ
  // updateAvatarElement لا يضيف مستمع نقر إطلاقاً، لذا نُعيد إنشاءه دائماً هنا
  // بدل تحديثه، لضمان أن onClick يُربط كل مرة يظهر فيها قسم المستخدم المسجَّل.
  const avatarElement = createAvatarElement(user, 'lg', {
    showFrame:   true,
    showBadge:   true,
    clickable:   true,
    showPulse:   true,
    showShimmer: true,
    onClick: (userId) => {
      if (window.router?.navigateTo) window.router.navigateTo('profile', { path: { id: userId } });
    }
  });
  avatarContainer.innerHTML = '';
  avatarContainer.appendChild(avatarElement);
  void existingAvatar; // (كان يُستخدم للتفريق بين إنشاء/تحديث؛ لم يعد لازماً)
}

// علامة التوثيق المنفصلة (إذا كانت موجودة) – يمكن إزالتها لأن createAvatarElement يضيفها داخلياً
const verBadge = $drawerElements.verificationBadge
  || document.getElementById('sidebar-verification');
if (verBadge) {
  // نعتمد على shouldShowVerificationBadge من avatar.js
  const show = shouldShowVerificationBadge(user);
  verBadge.style.display = show ? 'inline-flex' : 'none';
}

    // ==== الـ Streak ====
    updateStreakDisplay(user);

    // ==== عناصر الصلاحيات ====
    updateRoleBasedElements(user);

    // ==== الميزات المتقدمة ====
    updateGreeting();
    updateQuickStats(user);
    updateProgressBar(user);
    updateLastActivityDisplay(user);
    updateFavorites(user);
    updateRoleBanner(user);
    updateThemeIndicator();
    updateDevInfo(user);
    bindQuickActions();
    bindSettingsShortcuts();

  } catch (error) {
    console.error('❌ خطأ في تحديث محتوى القائمة:', error);
  }
}


// ==== ربط الأحداث الأساسية ====


function bindDrawerEvents() {
  // ==== فتح / إغلاق ====
  if ($drawerElements.openBtn) {
    $drawerElements.openBtn.addEventListener('click', e => {
      e.stopPropagation();
      openDrawer();
    });
  }

  if ($drawerElements.closeBtn) {
    $drawerElements.closeBtn.addEventListener('click', e => {
      e.stopPropagation();
      closeDrawer(true);
    });
  }

  if ($drawerElements.overlay) {
    $drawerElements.overlay.addEventListener('click', () => closeDrawer(true));
  }

  // ==== تسجيل الخروج ====
  if ($drawerElements.logoutBtn) {
    $drawerElements.logoutBtn.addEventListener('click', handleLogout);
  }

  // ==== تبديل الثيم ====
  const themeToggleSidebar = document.querySelector('.theme-toggle-sidebar');
  if (themeToggleSidebar) {
    themeToggleSidebar.addEventListener('click', handleSidebarThemeToggle);
  }

  // ==== زر الإضافة ====
  if ($drawerElements.addButton) {
    $drawerElements.addButton.addEventListener('click', handleAddButtonClick);
  }

  // ==== [FIX-1] مشاركة المنصة — الزر الموجود في HTML (share-app-btn) ====
  if ($drawerElements.sharePlatformBtn) {
    $drawerElements.sharePlatformBtn.addEventListener('click', handleSharePlatform);
  }

  // ==== نسخ رابط الصفحة ====
  if ($drawerElements.copyLinkBtn) {
    $drawerElements.copyLinkBtn.addEventListener('click', handleCopyCurrentLink);
  }

  // ==== التفويض المركزي لأزرار التنقل داخل القائمة ====
  const sidebar = $drawerElements.sidebar;
  if (sidebar) {
    sidebar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-nav-target]');
      if (!btn) return;
      const target = btn.dataset.navTarget;
      if (target && window.router?.navigateTo) {
        window.router.navigateTo(target);
        closeDrawer();
      }
    });
  }
}


// ==== التهيئة الرئيسية ====


function initializeDrawer() {
  if ($drawerState.isInitialized) {
    console.log('⚠️ نظام القائمة تم تهيئته مسبقاً');
    return true;
  }

  try {
    if (!initDrawerElements()) {
      console.error('❌ فشل تهيئة عناصر القائمة الجانبية');
      return false;
    }

    // إنشاء العناصر الديناميكية المفقودة
    createMissingElements();

    // إعادة ربط المراجع بعد الإنشاء
    initDrawerElements();

    // ربط الأحداث
    bindDrawerEvents();

    // إيماءات اللمس
    initSwipeGestures();

    // ==== الاشتراك في EventBus لإغلاق القائمة عند التنقل ====
    const unsubPageChanged = EventBus.on('pageChanged', () => closeDrawer(true));
    $drawerState.eventUnsubscribers.push(unsubPageChanged);

    const unsubNavStart = EventBus.on('navigationStart', () => closeDrawer(true));
    $drawerState.eventUnsubscribers.push(unsubNavStart);

    // ==== [إصلاح] تزامن مؤشر الثيم مع تغييرات الثيم من خارج الدراور ====
    const unsubThemeToggled = EventBus.on('theme:toggled', updateThemeIndicator);
    $drawerState.eventUnsubscribers.push(unsubThemeToggled);

    // ==== [إصلاح حرج] الاشتراك في تغيّر حالة المستخدم عبر EventBus وليس document ====
    // session.js (بعد توحيده على EventBus) يُصدر 'userStateChanged' عبر EventBus.emit فقط
    // ولم يعد يستخدم document.dispatchEvent إطلاقاً. كان هذا الملف يعتمد حصرياً على
    // document.addEventListener('userStateChanged', ...) بالأسفل، فلا يصله الحدث أبداً
    // عند تسجيل الدخول/الخروج داخل الـSPA بدون إعادة تحميل الصفحة — وهذا هو السبب المباشر
    // لعدم تحديث القائمة الجانبية بعد تسجيل الدخول أحياناً. تم توحيده هنا على EventBus
    // مع الإبقاء على مستمع document كطبقة أمان إضافية فقط (لا يضر إن بقي غير مُفعَّل).
    const unsubUserState = EventBus.on('userStateChanged', ({ action, user } = {}) => {
      if (action === 'login' || action === 'logout') {
        updateDrawerContent(user || null);
      }
    });
    $drawerState.eventUnsubscribers.push(unsubUserState);

    // ==== تحديث القائمة بمستخدم الجلسة الحالية ====
    const currentUser = getCurrentUser();
    updateDrawerContent(currentUser);

    // ==== [إصلاح] دوال مسمّاة بدل closures مجهولة، لإمكانية إزالتها في destroyDrawer ====
    $drawerState._domListeners.avatarUpdated = e => {
      const updated = e.detail?.user;
      const current = getCurrentUser();
      if (updated && current && updated.id === current.id) updateDrawerContent(updated);
    };
    document.addEventListener('avatarUpdated', $drawerState._domListeners.avatarUpdated);

    $drawerState._domListeners.profileUpdated = e => {
      const updated = e.detail?.user;
      const current = getCurrentUser();
      if (updated && current && updated.id === current.id) updateDrawerContent(updated);
    };
    document.addEventListener('profileUpdated', $drawerState._domListeners.profileUpdated);

    $drawerState._domListeners.streakUpdated = e => {
      const updated = e.detail?.user;
      if (updated) updateStreakDisplay(updated);
    };
    document.addEventListener('streakUpdated', $drawerState._domListeners.streakUpdated);

    // ==== الواجهة العامة (window.drawer) ====
    window.drawer = Object.assign(window.drawer || {}, {
      open:          openDrawer,
      close:         closeDrawer,
      toggle:        toggleDrawer,
      updateContent: updateDrawerContent,
      isOpen:        () => $drawerState.isOpen,
      initialized:   true,
      refreshStats:  () => updateDrawerContent(getCurrentUser()),
      sharePlatform: handleSharePlatform
    });

    console.log('✅ القائمة الجانبية v5.0.0 جاهزة');
    return true;
  } catch (error) {
    console.error('❌ فشل تهيئة نظام القائمة:', error);
    return false;
  }
}


// ==== تنظيف الموارد ====


function destroyDrawer() {
  // ==== إزالة اشتراكات EventBus ====
  $drawerState.eventUnsubscribers.forEach(unsub => {
    if (typeof unsub === 'function') unsub();
  });
  $drawerState.eventUnsubscribers = [];

  // ==== [إصلاح] إزالة مستمعي document المسمّاة ====
  const dl = $drawerState._domListeners;
  if (dl.avatarUpdated)  document.removeEventListener('avatarUpdated', dl.avatarUpdated);
  if (dl.profileUpdated) document.removeEventListener('profileUpdated', dl.profileUpdated);
  if (dl.streakUpdated)  document.removeEventListener('streakUpdated', dl.streakUpdated);
  $drawerState._domListeners = {};

  $drawerState.isInitialized  = false;
  $drawerState.isOpen         = false;
  $drawerState.isDrawerActive = false;
}

// ==== مستمع احتياطي لتغيير حالة المستخدم (Login / Logout) ====
// ملاحظة: المسار الأساسي الآن هو EventBus.on('userStateChanged', ...) داخل initializeDrawer
// (راجع التعليق هناك). session.js الحالي لا يُصدر هذا الحدث عبر document.dispatchEvent،
// لذا هذا المستمع لن يُستدعى عملياً اليوم، وتُرك فقط كطبقة أمان إن أضاف كود مستقبلي
// document.dispatchEvent('userStateChanged') مجدداً.
document.addEventListener('userStateChanged', e => {
  const { action, user } = e.detail || {};
  if (action === 'login' || action === 'logout') {
    updateDrawerContent(user || null);
  }
});


// ==== [إصلاح] التهيئة حصرياً عبر ComponentsManager في main.js ====
// (توحيداً مع نمط navbar.js — إزالة التهيئة الذاتية عند DOMContentLoaded التي كانت
// تُنفَّذ قبل انتهاء initializeSession() غير المتزامنة، فتُسبّب ظهور الدراور كضيف
// للحظة قبل تصحيحه عبر حدث userStateChanged)


// ==== التصدير ====

export {
  initializeDrawer,
  destroyDrawer,
  openDrawer,
  closeDrawer,
  toggleDrawer,
  updateDrawerContent,
  updateStreakDisplay
};
