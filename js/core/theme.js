/**
 * 🎨 js/core/theme.js - نظام إدارة الثيم المركزي v5.0.0 (متوافق مع المنصة)
 * ============================================================================
 * 📝 المسؤولية: المصدر الوحيد للحقيقة للثيم في المنصة بأكملها
 * ✅ الميزات:
 *   - الوضع الليلي / النهاري (Light/Dark)
 *   - 5 ثيمات ملونة: Blue, Pink, Green, Purple, Orange
 *   - تأثير انتقال تدريجي (Crossfade) عند تغيير الثيم الملون
 *   - حفظ التفضيلات في localStorage ومزامنتها مع قاعدة المستخدم بعد تسجيل الدخول
 *   - التبديل التلقائي حسب تفضيلات النظام (System)
 *   - تكامل مع EventBus و window.toggleTheme / getCurrentTheme
 * ============================================================================
 */

import { EventBus } from './event-bus.js';

// ====== الثوابت العامة ======
export const THEME_CONSTANTS = {
  LIGHT: 'light',
  DARK: 'dark',
  SYSTEM: 'system',
  STORAGE_KEY: 'biologist_theme',
  COLOR_STORAGE_KEY: 'biologist_color_theme',
  PREFERS_DARK_MEDIA: '(prefers-color-scheme: dark)',
  AVAILABLE_COLORS: ['blue', 'pink', 'green', 'purple', 'orange'],
  DEFAULT_COLOR: 'blue',
  TRANSITION_DURATION: 300 // ميلي ثانية
};

// ====== حالة النظام ======
let $themeState = {
  current: 'light',           // light / dark
  currentColor: 'blue',       // blue, pink, green, purple, orange
  isInitialized: false,
  isSystem: false,
  isReducedMotion: false,
  listeners: [],
  colorListeners: [],
  transitionTimeout: null,
  systemListener: null,
  // ==== حالة المزامنة المعلقة (pending sync) ====
  pendingTheme: null,        // theme value to sync after login
  pendingColor: null,        // color theme value to sync after login
  syncListenerAttached: false
};

// ====== دوال النظام الأساسية ======

export function initializeTheme() {
  if ($themeState.isInitialized) {
    console.log('🎨 نظام الثيم تم تهيئته مسبقاً');
    return { theme: $themeState.current, colorTheme: $themeState.currentColor };
  }

  console.log('🎨 تهيئة نظام الثيم المركزي (مع دعم الألوان والتبديل التدريجي)...');

  try {
    const motionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
    $themeState.isReducedMotion = motionMedia.matches;
    motionMedia.addEventListener('change', handleMotionPreferenceChange);

    // استعادة الثيم (الوضع الليلي/النهاري)
    const savedTheme = localStorage.getItem(THEME_CONSTANTS.STORAGE_KEY);
    if (savedTheme === THEME_CONSTANTS.SYSTEM) {
      enableSystemTheme(false);
    } else if (savedTheme === THEME_CONSTANTS.DARK || savedTheme === THEME_CONSTANTS.LIGHT) {
      setTheme(savedTheme, false);
    } else {
      enableSystemTheme(true);
    }

    // استعادة الثيم الملون
    const savedColor = localStorage.getItem(THEME_CONSTANTS.COLOR_STORAGE_KEY);
    if (savedColor && THEME_CONSTANTS.AVAILABLE_COLORS.includes(savedColor)) {
      setColorTheme(savedColor, false);
    } else {
      setColorTheme(THEME_CONSTANTS.DEFAULT_COLOR, false);
    }

    $themeState.isInitialized = true;

    if (window.$appState) {
      window.$appState.theme = $themeState.current;
      window.$appState.colorTheme = $themeState.currentColor;
    }

    // تعريض الدوال المتوافقة مع المكونات الأخرى
    exposeGlobalFunctions();

    // ==== إضافة مستمع لتسجيل الدخول لتنفيذ المزامنة المعلقة ====
    attachSyncListener();

    document.dispatchEvent(new CustomEvent('themeSystemInitialized', {
      detail: { theme: $themeState.current, colorTheme: $themeState.currentColor }
    }));

    console.log(`✅ نظام الثيم تم تهيئته بنجاح: ${$themeState.current} / ${$themeState.currentColor}`);
    return { theme: $themeState.current, colorTheme: $themeState.currentColor };

  } catch (error) {
    console.error('❌ فشل تهيئة نظام الثيم:', error);
    $themeState.current = THEME_CONSTANTS.LIGHT;
    $themeState.currentColor = THEME_CONSTANTS.DEFAULT_COLOR;
    applyThemeToDOM();
    exposeGlobalFunctions();
    attachSyncListener(); // محاولة ربط المستمع حتى لو فشل التهيئة
    return { theme: THEME_CONSTANTS.LIGHT, colorTheme: THEME_CONSTANTS.DEFAULT_COLOR };
  }
}

// ==== ربط مستمع حدث تسجيل الدخول (مرة واحدة) ====
function attachSyncListener() {
  if ($themeState.syncListenerAttached) return;
  $themeState.syncListenerAttached = true;

  // استخدام EventBus للاستماع لتغيير حالة المستخدم
  EventBus.on('userStateChanged', async (detail) => {
    if (detail.action === 'login' && detail.user) {
      // عند تسجيل الدخول، قم بمزامنة أي تفضيلات معلقة
      await flushPendingSync();
    }
  });

  // 🛠️ إصلاح: تم حذف مستمع document.addEventListener('userStateChanged', ...)
  // الاحتياطي من هنا — session.js يُصدر الحدث حصرياً عبر EventBus (لا document.dispatchEvent
  // إطلاقاً)، فكان هذا المستمع كوداً ميتاً لا يُنفَّذ أبداً، ومخالفاً لقاعدة الاعتماد
  // الحصري على EventBus المذكورة في README.
}

// ==== تنفيذ المزامنة المعلقة مع قاعدة البيانات ====
async function flushPendingSync() {
  const user = window.$currentUser;
  if (!user || !user.id) return;

  let themeToSync = null;
  let colorToSync = null;

  // إذا كانت هناك قيم معلقة، استخدمها
  if ($themeState.pendingTheme !== null) {
    themeToSync = $themeState.pendingTheme;
    $themeState.pendingTheme = null;
  }
  if ($themeState.pendingColor !== null) {
    colorToSync = $themeState.pendingColor;
    $themeState.pendingColor = null;
  }

  // إذا لم تكن هناك قيم معلقة، قم بمزامنة القيم الحالية
  if (themeToSync === null && colorToSync === null) {
    themeToSync = $themeState.current;
    colorToSync = $themeState.currentColor;
  }

  let updated = false;
  try {
    if (themeToSync !== null) {
      await syncThemeWithUser(themeToSync);
      updated = true;
    }
    if (colorToSync !== null) {
      await syncColorThemeWithUser(colorToSync);
      updated = true;
    }
    if (updated) {
      console.log(`✅ تمت مزامنة الثيمات المعلقة مع المستخدم ${user.id}`);
    }
  } catch (error) {
    console.warn('⚠️ فشل مزامنة الثيمات المعلقة بعد تسجيل الدخول:', error);
  }
}

// ==== جدولة مزامنة مع المستخدم (تخزين القيم للتطبيق لاحقاً) ====
function scheduleSyncWithUser(theme, color) {
  if (theme !== undefined && theme !== null) {
    $themeState.pendingTheme = theme;
  }
  if (color !== undefined && color !== null) {
    $themeState.pendingColor = color;
  }

  // إذا كان المستخدم مسجلاً دخوله بالفعل، قم بالمزامنة فوراً
  if (window.$currentUser && window.$currentUser.id) {
    flushPendingSync().catch(err => console.warn('⚠️ فشل المزامنة الفورية:', err));
  }
  // وإلا سيتم المزامنة عند تسجيل الدخول عبر المستمع
}

export function setTheme(theme, saveToStorage = true) {
  if (theme !== THEME_CONSTANTS.LIGHT && theme !== THEME_CONSTANTS.DARK) {
    console.warn(`⚠️ ثيم غير صالح: ${theme}, استخدام الوضع الافتراضي`);
    theme = THEME_CONSTANTS.LIGHT;
  }

  if (theme === $themeState.current) return theme;

  if ($themeState.isSystem) {
    disableSystemTheme();
  }

  const oldTheme = $themeState.current;
  $themeState.current = theme;

  if (saveToStorage) {
    localStorage.setItem(THEME_CONSTANTS.STORAGE_KEY, theme);
    // جدولة المزامنة مع المستخدم (بدلاً من الاستدعاء المباشر)
    scheduleSyncWithUser(theme, undefined);
  }

  applyThemeToDOM();
  notifyThemeChange(oldTheme, theme);

  if (window.$appState) window.$appState.theme = theme;
  
  console.log(`🎨 تغيير الثيم: ${oldTheme} → ${theme}`);
  return theme;
}

export function setColorTheme(color, saveToStorage = true) {
  if (!THEME_CONSTANTS.AVAILABLE_COLORS.includes(color)) {
    console.warn(`⚠️ لون ثيم غير صالح: ${color}, استخدام الافتراضي`);
    color = THEME_CONSTANTS.DEFAULT_COLOR;
  }

  if (color === $themeState.currentColor) return color;

  const oldColor = $themeState.currentColor;
  $themeState.currentColor = color;

  if (saveToStorage) {
    localStorage.setItem(THEME_CONSTANTS.COLOR_STORAGE_KEY, color);
    // جدولة المزامنة مع المستخدم (بدلاً من الاستدعاء المباشر)
    scheduleSyncWithUser(undefined, color);
  }

  // تطبيق التبديل التدريجي
  applyColorThemeWithTransition(oldColor, color);

  notifyColorThemeChange(oldColor, color);

  if (window.$appState) window.$appState.colorTheme = color;
  
  console.log(`🎨 تغيير الثيم الملون: ${oldColor} → ${color}`);
  return color;
}

function applyColorThemeWithTransition(oldColor, newColor) {
  // في حال تفضيل تقليل الحركة، نطبق مباشرة
  if ($themeState.isReducedMotion) {
    applyColorThemeToDOM();
    return;
  }

  // إنشاء عنصر مؤقت للتأثير
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.backgroundColor = `var(--primary)`;
  overlay.style.opacity = '0';
  overlay.style.pointerEvents = 'none';
  overlay.style.zIndex = '99999';
  overlay.style.transition = `opacity ${THEME_CONSTANTS.TRANSITION_DURATION}ms ease`;
  document.body.appendChild(overlay);

  // تطبيق الثيم الجديد
  applyColorThemeToDOM();

  // تشغيل تأثير التلاشي
  requestAnimationFrame(() => {
    overlay.style.opacity = '0.15';
    setTimeout(() => {
      overlay.style.opacity = '0';
      setTimeout(() => {
        overlay.remove();
      }, THEME_CONSTANTS.TRANSITION_DURATION);
    }, THEME_CONSTANTS.TRANSITION_DURATION);
  });
}

async function syncThemeWithUser(theme) {
  if (window.$currentUser && window.$currentUser.id) {
    try {
      const { updateUserPreferences } = await import('../core/api.js');
      await updateUserPreferences(window.$currentUser.id, { preferred_theme: theme });
      console.log(`✅ تم حفظ الثيم ${theme} في حساب المستخدم`);
    } catch (error) {
      console.warn('⚠️ فشل حفظ الثيم في قاعدة البيانات:', error);
    }
  }
}

async function syncColorThemeWithUser(color) {
  if (window.$currentUser && window.$currentUser.id) {
    try {
      const { updateUserPreferences } = await import('../core/api.js');
      await updateUserPreferences(window.$currentUser.id, { preferred_color_theme: color });
      console.log(`✅ تم حفظ الثيم الملون ${color} في حساب المستخدم`);
    } catch (error) {
      console.warn('⚠️ فشل حفظ الثيم الملون في قاعدة البيانات:', error);
    }
  }
}

export function toggleTheme() {
  const newTheme = $themeState.current === THEME_CONSTANTS.DARK 
    ? THEME_CONSTANTS.LIGHT 
    : THEME_CONSTANTS.DARK;
  return setTheme(newTheme);
}

export function toggleColorTheme() {
  const currentIndex = THEME_CONSTANTS.AVAILABLE_COLORS.indexOf($themeState.currentColor);
  const nextIndex = (currentIndex + 1) % THEME_CONSTANTS.AVAILABLE_COLORS.length;
  return setColorTheme(THEME_CONSTANTS.AVAILABLE_COLORS[nextIndex]);
}

export function enableSystemTheme(saveToStorage = true) {
  if ($themeState.isSystem) return $themeState.current;

  const darkModeMedia = window.matchMedia(THEME_CONSTANTS.PREFERS_DARK_MEDIA);
  
  const handleSystemChange = (e) => {
    const systemTheme = e.matches ? THEME_CONSTANTS.DARK : THEME_CONSTANTS.LIGHT;
    setTheme(systemTheme, false);
  };

  $themeState.systemListener = handleSystemChange;
  darkModeMedia.addEventListener('change', handleSystemChange);
  
  $themeState.isSystem = true;
  const systemTheme = darkModeMedia.matches ? THEME_CONSTANTS.DARK : THEME_CONSTANTS.LIGHT;
  
  if (saveToStorage) {
    localStorage.setItem(THEME_CONSTANTS.STORAGE_KEY, THEME_CONSTANTS.SYSTEM);
    // لا نحتاج لمزامنة SYSTEM مع المستخدم، فقط نخزن التفضيل
  }
  
  setTheme(systemTheme, false);
  
  console.log(`🎨 تفعيل الثيم التلقائي: ${systemTheme}`);
  return systemTheme;
}

export function disableSystemTheme() {
  if (!$themeState.isSystem) return;

  const darkModeMedia = window.matchMedia(THEME_CONSTANTS.PREFERS_DARK_MEDIA);
  if ($themeState.systemListener) {
    darkModeMedia.removeEventListener('change', $themeState.systemListener);
    $themeState.systemListener = null;
  }

  $themeState.isSystem = false;
  console.log('🎨 تعطيل الثيم التلقائي');
}

// ====== تطبيق الثيم على DOM ======

function applyThemeToDOM() {
  document.body.setAttribute('data-theme', $themeState.current);
  document.documentElement.setAttribute('data-theme', $themeState.current);
  
  // تحديث meta theme-color
  const metaThemeColor = document.getElementById('theme-color-meta');
  if (metaThemeColor) {
    // 🛠️ إصلاح: كان اللون الفاتح هنا #2196F3 (أزرق قديم) بينما --primary
    // الفعلي في variables.css هو #667eea — نفس اللون المستخدم في manifest.json
    // و index.html الآن لضمان تطابق لون شريط حالة الـ PWA مع هوية المنصة.
    metaThemeColor.content = $themeState.current === THEME_CONSTANTS.DARK ? '#121212' : '#667eea';
  }
  
  updateThemeToggleButtons();
  updateThemeIcons();
}

function applyColorThemeToDOM() {
  // تعطيل جميع روابط الثيمات أولاً
  THEME_CONSTANTS.AVAILABLE_COLORS.forEach(color => {
    const link = document.querySelector(`link[href*="theme-${color}.css"]`);
    if (link) link.disabled = true;
  });

  // تفعيل الرابط المطلوب
  const activeLink = document.querySelector(`link[href*="theme-${$themeState.currentColor}.css"]`);
  if (activeLink) {
    activeLink.disabled = false;
    console.log(`🎨 تم تفعيل الثيم الملون: ${$themeState.currentColor}`);
  } else {
    console.warn(`⚠️ لم يتم العثور على رابط الثيم الملون: theme-${$themeState.currentColor}.css`);
  }

  // إضافة كلاس مساعد على body
  THEME_CONSTANTS.AVAILABLE_COLORS.forEach(color => {
    document.body.classList.remove(`theme-${color}`);
  });
  document.body.classList.add(`theme-${$themeState.currentColor}`);
}

function updateThemeToggleButtons() {
  const toggleButtons = document.querySelectorAll('.theme-toggle, .theme-toggle-sidebar');
  toggleButtons.forEach(button => {
    button.setAttribute('aria-pressed', $themeState.current === THEME_CONSTANTS.DARK);
    const textSpan = button.querySelector('span');
    if (textSpan) {
      textSpan.textContent = $themeState.current === THEME_CONSTANTS.DARK 
        ? 'الوضع النهاري' 
        : 'الوضع الليلي';
    }
  });
}

function updateThemeIcons() {
  const lightIcons = document.querySelectorAll('.light-icon, .fa-sun');
  const darkIcons = document.querySelectorAll('.dark-icon, .fa-moon');
  
  lightIcons.forEach(icon => {
    icon.style.display = $themeState.current === THEME_CONSTANTS.DARK ? 'none' : 'inline-block';
  });
  darkIcons.forEach(icon => {
    icon.style.display = $themeState.current === THEME_CONSTANTS.DARK ? 'inline-block' : 'none';
  });
}

// ====== إدارة الأحداث ======

function handleMotionPreferenceChange(e) {
  $themeState.isReducedMotion = e.matches;
  console.log(`🎨 تفضيلات الحركة: ${e.matches ? 'مخفضة' : 'عادية'}`);
}

function notifyThemeChange(oldTheme, newTheme) {
  // إرسال عبر EventBus
  if (typeof EventBus !== 'undefined' && EventBus.emit) {
    EventBus.emit('theme:toggled', { theme: newTheme, oldTheme });
  }
  
  $themeState.listeners.forEach(listener => {
    try { listener(oldTheme, newTheme); } catch (e) { console.error(e); }
  });
  
  document.dispatchEvent(new CustomEvent('themeChanged', {
    detail: { oldTheme, newTheme, isSystem: $themeState.isSystem, timestamp: Date.now() }
  }));
}

function notifyColorThemeChange(oldColor, newColor) {
  $themeState.colorListeners.forEach(listener => {
    try { listener(oldColor, newColor); } catch (e) { console.error(e); }
  });
  
  document.dispatchEvent(new CustomEvent('colorThemeChanged', {
    detail: { oldColor, newColor, timestamp: Date.now() }
  }));
}

// ====== تعريض الدوال للاستخدام العالمي ======
function exposeGlobalFunctions() {
  window.toggleTheme = toggleTheme;
  window.getCurrentTheme = getCurrentTheme;
  window.getCurrentColorTheme = getCurrentColorTheme;
  window.setTheme = setTheme;
  window.setColorTheme = setColorTheme;
  
  // للتوافق مع الكود القديم
  window.$themeManager = {
    initialize: initializeTheme,
    setTheme,
    setColorTheme,
    toggleTheme,
    toggleColorTheme,
    enableSystemTheme,
    disableSystemTheme,
    getCurrentTheme,
    getCurrentColorTheme,
    isDarkMode,
    isSystemTheme,
    addListener: addThemeListener,
    removeListener: removeThemeListener,
    getState: getThemeState,
    constants: THEME_CONSTANTS
  };
}

// ====== الواجهة العامة ======

export function getCurrentTheme() {
  return $themeState.current;
}

export function getCurrentColorTheme() {
  return $themeState.currentColor;
}

export function isDarkMode() {
  return $themeState.current === THEME_CONSTANTS.DARK;
}

export function isSystemTheme() {
  return $themeState.isSystem;
}

export function addThemeListener(callback) {
  if (typeof callback === 'function') $themeState.listeners.push(callback);
}

export function removeThemeListener(callback) {
  const index = $themeState.listeners.indexOf(callback);
  if (index !== -1) $themeState.listeners.splice(index, 1);
}

export function addColorThemeListener(callback) {
  if (typeof callback === 'function') $themeState.colorListeners.push(callback);
}

export function removeColorThemeListener(callback) {
  const index = $themeState.colorListeners.indexOf(callback);
  if (index !== -1) $themeState.colorListeners.splice(index, 1);
}

export function getThemeState() {
  return { 
    theme: $themeState.current, 
    colorTheme: $themeState.currentColor,
    isSystem: $themeState.isSystem,
    isReducedMotion: $themeState.isReducedMotion,
    initialized: $themeState.isInitialized
  };
}

export default {
  initialize: initializeTheme,
  setTheme,
  setColorTheme,
  toggleTheme,
  toggleColorTheme,
  getCurrentTheme,
  getCurrentColorTheme,
  isDarkMode,
  isSystemTheme,
  addListener: addThemeListener,
  removeListener: removeThemeListener,
  addColorListener: addColorThemeListener,
  removeColorListener: removeColorThemeListener,
  constants: THEME_CONSTANTS
};