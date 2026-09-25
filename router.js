/**
 * 🧭 js/core/router.js - نظام التوجيه المتكامل النهائي v5.0.0 (Smart Merge)
 * ============================================================================
 * 📝 المسؤولية: إدارة التنقل بين صفحات SPA، تحميل HTML/CSS/JS، إدارة الحالة،
 *               ومعالجة الأخطاء بشكل ذكي. الإصدار المدمج من أفضل ما في النسختين.
 */

// ===== 1. استيراد الأنظمة المركزية =====
import { getCurrentUser, isTeacher, isModerator } from './session.js';
import { EventBus } from './event-bus.js';

// ===== 2. تكوين المسارات (exact + dynamic) =====
export const ROUTES_CONFIG = {
  home: {
    path: '/',
    file: '/views/home/home.html',
    script: '/views/home/home.js',
    css: '/views/home/home.css',
    requiresAuth: false,
    redirectIfLoggedIn: false,
    title: 'الرئيسية',
    initFunction: 'initializePage',
    cleanupFunction: 'cleanupPage',
    pageType: 'home',
    swipeEnabled: true,
    exact: true,
    prefetch: true
  },
  login: {
    path: '/login',
    file: '/views/auth/login.html',
    script: '/views/auth/auth.js',
    css: '/views/auth/auth.css',
    requiresAuth: false,
    redirectIfLoggedIn: true,
    title: 'تسجيل الدخول',
    initFunction: 'initializePage',
    cleanupFunction: 'cleanupPage',
    pageType: 'auth',
    swipeEnabled: false,
    exact: true,
    prefetch: false
  },
  register: {
    path: '/register',
    file: '/views/auth/register.html',
    script: '/views/auth/auth.js',
    css: '/views/auth/auth.css',
    requiresAuth: false,
    redirectIfLoggedIn: true,
    title: 'إنشاء حساب',
    initFunction: 'initializePage',
    cleanupFunction: 'cleanupPage',
    pageType: 'auth',
    swipeEnabled: false,
    exact: true,
    prefetch: false
  },
  'not-found': {
    path: '/404',
    file: '/views/error/404.html',
    script: '/views/error/404.js',
    css: '/views/error/404.css',
    requiresAuth: false,
    redirectIfLoggedIn: false,
    title: 'الصفحة غير موجودة',
    initFunction: 'initializePage',
    cleanupFunction: 'cleanupPage',
    pageType: 'not-found',
    swipeEnabled: false,
    exact: true,
    prefetch: false
  },
  profile: {
    path: '/profile',
    file: '/views/profile/profile.html',
    script: '/views/profile/profile.js',
    css: '/views/profile/profile.css',
    // 🛠️ إصلاح ترابط: كانت false رغم أن /profile صفحة شخصية بلا معرّف مستخدم في الرابط —
    // أي زائر غير مسجّل كان يقدر يفتحها مباشرة. كل الصفحات الشخصية المشابهة (settings, lessons...) محمية.
    requiresAuth: true,
    redirectIfLoggedIn: false,
    title: 'الملف الشخصي',
    initFunction: 'initializePage',
    cleanupFunction: 'cleanupPage',
    pageType: 'profile',
    swipeEnabled: true,
    exact: true,
    prefetch: true
  },
  settings: {
    path: '/settings',
    file: '/views/settings/settings.html',
    script: '/views/settings/settings.js',
    css: '/views/settings/settings.css',
    requiresAuth: true,
    redirectIfLoggedIn: false,
    title: 'الإعدادات',
    initFunction: 'initializePage',
    cleanupFunction: 'cleanupPage',
    pageType: 'settings',
    swipeEnabled: false,
    exact: true,
    prefetch: false
  },
  lessons: {
    path: '/lessons',
    file: '/views/lessons/lessons.html',
    script: '/views/lessons/lessons.js',
    css: '/views/lessons/lessons.css',
    requiresAuth: true,
    redirectIfLoggedIn: false,
    title: 'الدروس',
    initFunction: 'initializePage',
    cleanupFunction: 'cleanupPage',
    pageType: 'lessons',
    swipeEnabled: true,
    exact: true,
    prefetch: true
  },
  'lesson-view': {
    path: '/lesson/:id',
    file: '/views/lessons/lesson-view.html',
    script: '/views/lessons/lessons.js',
    css: '/views/lessons/lessons.css',
    requiresAuth: true,
    redirectIfLoggedIn: false,
    title: 'عرض الدرس',
    initFunction: 'initLessonViewPage',
    cleanupFunction: 'cleanupLessonViewPage',
    pageType: 'lessons',
    swipeEnabled: false,
    exact: false,
    prefetch: true
  },
  exams: {
    path: '/exams',
    file: '/views/exams/exams.html',
    script: '/views/exams/exams.js',
    css: '/views/exams/exams.css',
    requiresAuth: true,
    redirectIfLoggedIn: false,
    title: 'الامتحانات',
    initFunction: 'initializePage',
    cleanupFunction: 'cleanupPage',
    pageType: 'exams',
    swipeEnabled: true,
    exact: true,
    prefetch: true
  },
  'exam-view': {
    path: '/exam/:id',
    file: '/views/exams/exam-view.html',
    script: '/views/exams/exams.js',
    css: '/views/exams/exams.css',
    requiresAuth: true,
    redirectIfLoggedIn: false,
    title: 'أداء الامتحان',
    initFunction: 'initExamViewPage',
    cleanupFunction: 'cleanupExamViewPage',
    pageType: 'exams',
    swipeEnabled: false,
    exact: false,
    prefetch: true
  },
  dashboard: {
    path: '/dashboard',
    file: '/views/dashboard/dashboard.html',
    script: '/views/dashboard/dashboard.js',
    css: '/views/dashboard/dashboard.css',
    requiresAuth: true,
    requiresAdmin: true,
    restrictToModerator: true, // 🛠️ حصر /dashboard على المشرف فقط، بخلاف /mod-dashboard المتاح للمعلم أيضاً
    redirectIfLoggedIn: false,
    title: 'لوحة التحكم',
    initFunction: 'initializePage',
    cleanupFunction: 'cleanupPage',
    pageType: 'dashboard',
    swipeEnabled: false,
    exact: true,
    prefetch: true
  },
  modDashboard: {
  path: '/mod-dashboard',
  file: '/views/dashboard/dashboard.html',
  script: '/views/dashboard/dashboard.js',
  css: '/views/dashboard/dashboard.css',
  requiresAuth: true,
  requiresAdmin: true,   // يسمح للمشرف والمعلم
  title: 'لوحة المشرف',
  initFunction: 'initializePage',
  cleanupFunction: 'cleanupPage',
  pageType: 'dashboard',
  exact: true,
  prefetch: true
},
  groups: {
    path: '/groups',
    file: '/views/groups/groups.html',
    script: '/views/groups/groups.js',
    css: '/views/groups/groups.css',
    requiresAuth: true,
    redirectIfLoggedIn: false,
    title: 'المجموعات',
    initFunction: 'initGroupsPage',
    cleanupFunction: 'cleanupGroupsPage',
    pageType: 'groups',
    swipeEnabled: true,
    exact: true,
    prefetch: true
  },
  'group-view': {
    path: '/group/:id',
    file: '/views/groups/group-view.html',
    script: '/views/groups/groups.js',
    css: '/views/groups/groups.css',
    requiresAuth: true,
    redirectIfLoggedIn: false,
    title: 'عرض المجموعة',
    initFunction: 'initGroupViewPage',
    cleanupFunction: 'cleanupGroupViewPage',
    pageType: 'groups',
    swipeEnabled: false,
    exact: false,
    prefetch: true
  },
 favorites: {
    path: '/favorites',
    file: '/views/home/home.html',
    script: '/views/home/home.js',
    css: '/views/home/home.css', requiresAuth: true,
    title: 'الدروس المحفوظة', initFunction: 'initializePage',
    cleanupFunction: 'cleanupPage',
    pageType: 'home',
    swipeEnabled: true,
    exact: true,
    prefetch: false 
  },
 notifications: {
  path: '/notifications',
  file: '/views/home/home.html',
  script: '/views/home/home.js',
  css: '/views/home/home.css',
  requiresAuth: true,
  title: 'الإشعارات', 
  initFunction: 'initializePage',
  cleanupFunction: 'cleanupPage',
  pageType: 'home',
  swipeEnabled: false,
  exact: true,
  prefetch: false 
}
};

// ===== 4. الحالة الداخلية =====
const routerState = {
  initialized: false,
  currentRoute: null,
  currentParams: { path: {}, query: {} },
  isNavigating: false,
  previousRoute: null,
  navigationHistory: [],
  lastError: null,
  scrollPositions: new Map(),
  prefetchControllers: [],
  hooks: { beforeNavigate: [], afterNavigate: [] },
  // ==== نظام CSS الذكي (من النسخة القديمة) ====
  currentStylePath: null,           // المسار الحالي للـ CSS المحمّل
  loadedStyles: new Map(),          // cssPath -> { link, timestamp }
  
  // ==== أنظمة التخزين المؤقت ====
  htmlCache: new Map(),             // filePath -> html string
  loadedModules: new Map(),         // scriptPath -> module object
  
  // ==== نظام Prefetch Registry (لمنع التحميل المزدوج) ====
  prefetchedAssets: new Set(),      // عناوين تم تحميلها مسبقاً
  
  // ==== Navigation Token System (لمنع race conditions) ====
  currentNavToken: 0,
  
  // ==== دوال التنظيف ====
  currentCleanup: null,
  currentViewContainer: null,
  cleanupFns: [],       
  debugMode: (typeof window !== 'undefined' && window.location && window.location.hostname === 'localhost')
};

// ===== تسجيل دالة تنظيف للصفحة الحالية =====
function registerCleanup(fn) {
  if (typeof fn === 'function') {
    routerState.cleanupFns.push(fn);
  }
}

// ===== تنفيذ جميع دوال التنظيف =====
async function runCleanupFns() {
  const fns = routerState.cleanupFns;
  routerState.cleanupFns = [];
  for (const fn of fns) {
    try { await fn(); } catch (e) { console.warn('⚠️ فشل تنفيذ دالة تنظيف:', e); }
  }
}
// ===== 5. دوال مساعدة =====
function resolveUrl(path) {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  const base = window.location.origin.replace(/\/$/, '');
  const cleanPath = path.startsWith('/') ? path : '/' + path;
  return base + cleanPath;
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

function log(...args) {
  if (routerState.debugMode) {
    console.log(...args);
  }
}

function logGroup(label, fn) {
  if (routerState.debugMode) {
    console.group(label);
    fn();
    console.groupEnd();
  } else {
    fn();
  }
}

// ===== 6. مطابقة المسار (محسنة مع exact) =====
function extractParams(pattern, path) {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) return null;
  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i];
    const pathPart = pathParts[i];
    if (patternPart.startsWith(':')) {
      params[patternPart.slice(1)] = decodeURIComponent(pathPart);
    } else if (patternPart !== pathPart) {
      return null;
    }
  }
  return params;
}

function matchRoute(path) {
  let cleanPath = path.split('?')[0].split('#')[0];
  if (cleanPath === '' || cleanPath === '/') {
    cleanPath = '/';
  }
  for (const [name, route] of Object.entries(ROUTES_CONFIG)) {
    if (route.exact && route.path === cleanPath) {
      return { route: { ...route, name }, params: {} };
    }
  }
  for (const [name, route] of Object.entries(ROUTES_CONFIG)) {
    if (!route.exact) {
      const params = extractParams(route.path, cleanPath);
      if (params !== null) {
        return { route: { ...route, name }, params };
      }
    }
  }
  return null;
}

// ===== 7. التحقق من الصلاحيات =====
function checkAccess(route, user) {
  if (user && (route.name === 'login' || route.name === 'register')) return false;
  if (route.requiresAuth && !user) return false;
  if (route.requiresAdmin && user) {
    if (!isTeacher(user) && !isModerator(user)) return false;
  }
  // 🛠️ إصلاح ترابط: كان مسارا dashboard وmodDashboard يستخدمان نفس requiresAdmin
  // فيسمحان بنفس الصلاحيات بالضبط (معلم أو مشرف) رغم أن التعليق على modDashboard
  // ينص صراحةً على أنه "يسمح للمشرف والمعلم" في مقابل dashboard المخصص للمشرف فقط.
  if (route.restrictToModerator && user && !isModerator(user)) return false;
  if (route.redirectIfLoggedIn && user) return false;
  return true;
}

// ===== 8. نظام CSS الذكي (مع مهلة ورسالة) =====
async function loadPageStyle(cssPath, routeName) {
  if (!cssPath) return;
  const resolvedPath = resolveUrl(cssPath);
  
  if (routerState.currentStylePath === resolvedPath) return;
  
  const existingStyle = routerState.loadedStyles.get(resolvedPath);
  if (existingStyle && existingStyle.link && document.head.contains(existingStyle.link)) {
    if (routerState.currentStylePath && routerState.loadedStyles.get(routerState.currentStylePath)?.link) {
      routerState.loadedStyles.get(routerState.currentStylePath).link.disabled = true;
    }
    existingStyle.link.disabled = false;
    routerState.currentStylePath = resolvedPath;
    return;
  }
  
  // إزالة القديم
  if (routerState.currentStylePath && routerState.loadedStyles.get(routerState.currentStylePath)?.link) {
    const old = routerState.loadedStyles.get(routerState.currentStylePath);
    old.link.remove();
    routerState.loadedStyles.delete(routerState.currentStylePath);
    routerState.currentStylePath = null;
  }
  
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = resolvedPath;
    link.setAttribute('data-route', routeName);
    
    let timeoutId = null;
    let resolved = false;
    
    const done = () => {
      if (resolved) return;
      resolved = true;
      if (timeoutId) clearTimeout(timeoutId);
      resolve();
    };
    
    // مهلة 5 ثوانٍ
    timeoutId = setTimeout(() => {
      console.warn(`⚠️ Router: انتهت مهلة تحميل CSS "${resolvedPath}"، متابعة بدون CSS`);
      // إظهار رسالة للمستخدم (إذا كان النظام يدعم Toast)
      if (window.modals?.toast) {
        window.modals.toast('⚠️ تأخر تحميل تنسيق الصفحة، سيتم العرض بشكل مبسط', 'warning', 4000);
      }
      done();
    }, 5000);
    
    link.onload = () => {
      clearTimeout(timeoutId);
      routerState.loadedStyles.set(resolvedPath, { link, timestamp: Date.now() });
      routerState.currentStylePath = resolvedPath;
      done();
    };
    link.onerror = () => {
      clearTimeout(timeoutId);
      console.warn(`⚠️ Router: فشل تحميل CSS "${resolvedPath}"`);
      link.remove();
      routerState.loadedStyles.delete(resolvedPath);
      // إظهار رسالة فشل
      if (window.modals?.toast) {
        window.modals.toast('⚠️ فشل تحميل تنسيق الصفحة، قد تظهر بشكل غير مكتمل', 'error', 4000);
      }
      done();
    };
    
    document.head.appendChild(link);
  });
}

// ===== 9. تحميل HTML مع تخزين مؤقت =====
async function loadHTML(url) {
  const resolved = resolveUrl(url);
  if (routerState.htmlCache.has(resolved)) {
    return routerState.htmlCache.get(resolved);
  }
  const response = await fetch(resolved, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const html = await response.text();
  // إدارة حجم cache (حد أقصى 30)
  if (routerState.htmlCache.size > 30) {
    const firstKey = routerState.htmlCache.keys().next().value;
    routerState.htmlCache.delete(firstKey);
  }
  routerState.htmlCache.set(resolved, html);
  return html;
}

// ===== 10. تحميل الوحدات (مع إعادة محاولة) =====
async function loadScript(url, retries = 3, delay = 500) {
  const resolved = resolveUrl(url);
  if (routerState.loadedModules.has(resolved)) {
    return routerState.loadedModules.get(resolved);
  }
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // إضافة timestamp فقط في بيئة التطوير لمنع التخزين المؤقت
      let fetchUrl = resolved;
      if (routerState.debugMode) {
        fetchUrl += (fetchUrl.includes('?') ? '&' : '?') + `t=${Date.now()}`;
      }
      const module = await import(fetchUrl);
      routerState.loadedModules.set(resolved, module);
      log(`📦 Router: تم تحميل "${url}" (محاولة ${attempt}/${retries})`);
      return module;
    } catch (err) {
      lastError = err;
      log(`⚠️ فشل تحميل "${url}" (${attempt}/${retries})`, err.message);
      if (attempt < retries) await new Promise(r => setTimeout(r, delay * attempt));
    }
  }
  throw new Error(`فشل تحميل "${url}" بعد ${retries} محاولات: ${lastError.message}`);
}

// ===== 11. عرض حالات التحميل والخطأ =====
function showLoadingState(container, title = '') {
  if (!container) return;
  let loader = container.querySelector('.router-loader');
  if (!loader) {
    loader = document.createElement('div');
    loader.className = 'router-loader';
    loader.innerHTML = `
      <div class="loader-spinner"><div class="spinner-circle"></div></div>
      <p class="loader-text">جاري تحميل ${escapeHtml(title)}...</p>
      <div class="loader-progress-container"><div class="loader-progress-bar"></div></div>
    `;
    container.appendChild(loader);
  } else {
    const textEl = loader.querySelector('.loader-text');
    if (textEl) textEl.textContent = title ? `جاري تحميل ${title}...` : 'جاري تحميل المحتوى...';
    loader.style.display = 'flex';
  }
  const progressBar = loader.querySelector('.loader-progress-bar');
  if (progressBar) {
    let width = 0;
    const interval = setInterval(() => {
      if (width >= 90) clearInterval(interval);
      else { width += 5; progressBar.style.width = width + '%'; }
    }, 200);
    loader.dataset.progressInterval = interval;
  }
}

function hideLoadingState(container) {
  if (!container) return;
  const loader = container.querySelector('.router-loader');
  if (loader) {
    if (loader.dataset.progressInterval) clearInterval(parseInt(loader.dataset.progressInterval));
    loader.style.display = 'none';
  }
}

function showErrorState(container, error, routeName, params) {
  if (!container) return;
  const msg = error.message || 'حدث خطأ غير متوقع';
  const details = error.stack ? error.stack.split('\n')[0] : '';
  container.innerHTML = `
    <div class="router-error-page" role="alert">
      <div class="error-content">
        <i class="fas fa-exclamation-triangle error-icon"></i>
        <h2>عذراً، حدث خطأ في تحميل الصفحة</h2>
        <p class="error-message">${escapeHtml(msg)}</p>
        ${details ? `<p class="error-details"><small>${escapeHtml(details)}</small></p>` : ''}
        <div class="error-actions">
          <button class="btn btn-primary retry-btn"><i class="fas fa-redo"></i> إعادة المحاولة</button>
          <button class="btn btn-secondary home-btn"><i class="fas fa-home"></i> الرئيسية</button>
          <button class="btn btn-outline reload-btn"><i class="fas fa-sync-alt"></i> تحديث كامل</button>
        </div>
      </div>
    </div>
  `;
  container.querySelector('.retry-btn')?.addEventListener('click', () => {
    navigateTo(routeName, params, { replace: true, force: true });
  });
  container.querySelector('.home-btn')?.addEventListener('click', () => navigateTo('home', {}, { replace: true }));
  container.querySelector('.reload-btn')?.addEventListener('click', () => location.reload());
}


// ===== 12. نظام الانتقالات المحسن (متسامح مع عدم تحميل animations بعد) =====
async function performPageTransition(container, html, pageType, direction = 'enter') {
  if (!container) return;
  
  const hasAnimations = window.animations && typeof window.animations.exitPage === 'function' && typeof window.animations.enterPage === 'function';
  
  if (direction === 'exit') {
    EventBus.emit('pageTransitionStart', { pageType, direction: 'exit' });
    if (hasAnimations) {
      try {
        await window.animations.exitPage(pageType, container);
      } catch (e) {
        log('⚠️ فشل حركة الخروج', e);
      }
    }
    EventBus.emit('pageTransitionEnd', { pageType, direction: 'exit' });
  }
  
  if (direction === 'enter') {
    EventBus.emit('pageTransitionStart', { pageType, direction: 'enter' });
    container.innerHTML = html;
    if (hasAnimations) {
      try {
        await window.animations.enterPage(pageType, container);
      } catch (e) {
        log('⚠️ فشل حركة الدخول', e);
      }
    }
    EventBus.emit('pageTransitionEnd', { pageType, direction: 'enter' });
  }
}

// ===== 13. تنظيف الصفحة الحالية =====
async function cleanupCurrentView() {
  // تنفيذ دوال التنظيف المسجلة عبر EventBus
  await runCleanupFns();

  if (routerState.currentCleanup && typeof routerState.currentCleanup === 'function') {
    try { await routerState.currentCleanup(); } catch (err) { console.error('تنظيف فاشل:', err); }
    routerState.currentCleanup = null;
  }
}

// ===== 14. بناء المسار الكامل =====
function buildPath(routeName, params) {
  const route = ROUTES_CONFIG[routeName];
  if (!route) return '/';
  let path = route.path;
  const pathParams = params.path || {};
  Object.entries(pathParams).forEach(([key, value]) => {
    if (path.includes(`:${key}`)) {
      path = path.replace(`:${key}`, encodeURIComponent(String(value)));
    }
  });
  const queryParams = params.query || {};
  if (Object.keys(queryParams).length) {
    const search = new URLSearchParams();
    Object.entries(queryParams).forEach(([k, v]) => search.append(k, v));
    path += '?' + search.toString();
  }
  return path;
}

// ===== 15. دالة تحميل الصفحة الأساسية (مع Token System) =====

async function loadView(routeName, params, options = {}) {
  const route = ROUTES_CONFIG[routeName];
  if (!route) return navigateTo('not-found', {}, { replace: true });
  
  const mainContainer = document.getElementById('app-router-view');
  if (routerState.prefetchControllers.length) {
  routerState.prefetchControllers.forEach(controller => controller.abort());
  routerState.prefetchControllers = [];
}
  if (!mainContainer) throw new Error('العنصر #app-router-view غير موجود');
  
  // ==== Navigation Token System: منع race conditions ====
  const navToken = ++routerState.currentNavToken;
  
  if (routerState.isNavigating && !options.force) {
    log('⏳ تنقل جاري، انتظر...');
    return;
  }
  routerState.isNavigating = true;
  routerState.currentViewContainer = mainContainer;
  routerState.previousRoute = routerState.currentRoute;
  routerState.currentRoute = routeName;
  routerState.currentParams = params;
  
  // حفظ موضع التمرير للصفحة الحالية قبل مغادرتها
  if (routerState.currentRoute) {
    const oldKey = `${routerState.currentRoute}_${JSON.stringify(routerState.currentParams)}`;
    routerState.scrollPositions.set(oldKey, window.scrollY);
  }
  
  for (const hook of routerState.hooks.beforeNavigate) {
    try { await hook({ route: routeName, params, options }); } catch(e) { console.log(e); }
  }
  
  EventBus.emit('navigationStart', { route: routeName, params, token: navToken });
  
  try {
    // 1) تنظيف الصفحة السابقة
    // 🛠️ إصلاح: كانت دالة cleanupFunction الخاصة بالصفحة السابقة تُستدعى هنا
    // مباشرة عبر prevModule[...]، ثم تُستدعى مرة ثانية بالضبط داخل cleanupCurrentView()
    // عبر routerState.currentCleanup (نفس الدالة حرفياً، لأنها تُخزَّن كـ
    // () => module[route.cleanupFunction]() في نهاية كل تحميل صفحة سابق) — أي أن
    // cleanup الصفحة كان يُنفَّذ مرتين في كل تنقل. الاعتماد على cleanupCurrentView()
    // وحدها كافٍ ومتوافق مع مسار router.registerCleanup() الموثّق أدناه.
    await cleanupCurrentView();
    
    // 2) حركة الخروج (exit animation)
    const previousPageType = routerState.previousRoute ? ROUTES_CONFIG[routerState.previousRoute]?.pageType : 'default';
    await performPageTransition(mainContainer, '', previousPageType, 'exit');
    
    // التحقق من صحة الـ token بعد الحركة (إذا تم تنقل جديد أثناء الحركة، نتوقف)
    if (navToken !== routerState.currentNavToken) {
      log(`🛑 Navigation cancelled (token ${navToken} vs ${routerState.currentNavToken})`);
      routerState.isNavigating = false;
      return;
    }
    
    // 3) عرض شاشة التحميل
    showLoadingState(mainContainer, route.title);
    
    // 4) تحميل CSS (نظام ذكي)
    if (route.css) await loadPageStyle(route.css, routeName).catch(e => log(e));
    
    // 5) جلب HTML
    const html = await loadHTML(route.file);
    
    // 6) حركة الدخول (enter animation)
    await performPageTransition(mainContainer, html, route.pageType, 'enter');
    
    // 7) تحديث عنوان الصفحة
    let title = route.title;
    if (params.path?.id && (routeName === 'lesson-view' || routeName === 'exam-view' || routeName === 'group-view')) {
      title += ` - ${params.path.id}`;
    }
    document.title = `بيولوجست | ${title}`;
    
    // 8) تحميل الوحدة وتنفيذ التهيئة
    if (route.script) {
      const module = await loadScript(route.script);
      if (module[route.cleanupFunction]) {
        routerState.currentCleanup = () => module[route.cleanupFunction]();
      }
      const initFn = module[route.initFunction] || (() => {});
      await initFn(mainContainer, params);
    }
    
    // 9) تحديث history (مع منع loop)
    const newPath = buildPath(routeName, params);
    const state = { route: routeName, params, timestamp: Date.now() };
    if (options.replace) {
      history.replaceState(state, '', newPath);
    } else if (!options.skipHistory) {
      history.pushState(state, '', newPath);
    }
    
    // 10) إخفاء التحميل
    hideLoadingState(mainContainer);
    
    // 11) تمرير الصفحة إلى الأعلى أو استعادة الموضع المحفوظ
    if (options.skipHistory === true) {
      const newKey = `${routeName}_${JSON.stringify(params)}`;
      const savedY = routerState.scrollPositions.get(newKey);
      if (savedY) window.scrollTo({ top: savedY });
      else window.scrollTo({ top: 0 });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    
    // 12) أحداث جانبية
    EventBus.emit('pageChanged', { page: routeName, params, previous: routerState.previousRoute, pageType: route.pageType });
    
    for (const hook of routerState.hooks.afterNavigate) {
      try { await hook({ route: routeName, params, options }); } catch(e) { console.log(e); }
    }
    if (window.navbar?.updateCurrentPage) window.navbar.updateCurrentPage(routeName);
    if (window.drawer?.close) window.drawer.close(true);
    
    // التحميل المسبق للصفحات المجاورة والروابط داخل الصفحة
    setTimeout(() => prefetchInternalLinks(mainContainer), 1500);
    
    log(`✅ Router: تم تحميل "${routeName}" بنجاح (token ${navToken})`);
  } catch (error) {
    console.error(`❌ فشل تحميل "${routeName}"`, error);
    routerState.lastError = { route: routeName, error: error.message, timestamp: Date.now() };
    EventBus.emit('router:error', { route: routeName, error: error.message });
    EventBus.emit('app:error', { message: `خطأ في تحميل الصفحة: ${error.message}`, silent: false, context: { route: routeName } });
    showErrorState(mainContainer, error, routeName, params);
  } finally {
    routerState.isNavigating = false;
  }
}

// ===== 16. التنقل الرئيسي (مع skipHistory لمنع loop) =====
export async function navigateTo(routeName, params = {}, options = {}) {
  if (routerState.isNavigating && !options.force) {
    log('⏳ Router: انتظر اكتمال التنقل الجاري');
    return;
  }
  if (!ROUTES_CONFIG[routeName] && routeName !== 'not-found') {
    log(`⚠️ مسار غير معروف "${routeName}"، توجيه إلى 404`);
    return navigateTo('not-found', {}, { replace: true });
  }
  
  // 🛠️ إصلاح ترابط: كان يُبنى بدون خاصية name، فيصبح فحص route.name في checkAccess
  // (وأي منطق مستقبلي يعتمد عليها) معطّلاً تماماً في مسار التنقل الأساسي هذا —
  // على عكس matchRoute() اللي بترجع { ...route, name } بشكل صحيح
  const route = { ...(ROUTES_CONFIG[routeName] || ROUTES_CONFIG['not-found']), name: routeName };
  const user = getCurrentUser();
  
  if (!checkAccess(route, user)) {
    if (route.requiresAuth && !user) {
      sessionStorage.setItem('biologist_intended_route', JSON.stringify({ name: routeName, params }));
      return navigateTo('login', {}, { replace: true });
    }
    if (route.redirectIfLoggedIn && user) return navigateTo('home', {}, { replace: true });
    if (route.requiresAdmin) return navigateTo('home', {}, { replace: true });
    return;
  }
  
  const newPath = buildPath(routeName, params);
  const currentPath = window.location.pathname + window.location.search;
  if (currentPath === newPath && !options.force) {
    log('ℹ️ نفس الصفحة، تجاهل التنقل');
    return;
  }
  
  routerState.navigationHistory.unshift({ route: routeName, params, timestamp: Date.now() });
  if (routerState.navigationHistory.length > 10) routerState.navigationHistory.pop();
  
  await loadView(routeName, params, options);
}

// ===== 17. معالجة أحداث التنقل =====
function handlePopState(event) {
  log('↩️ popstate', event.state);
  if (event.state?.route) {
    // منع إنشاء history جديدة أثناء popstate
    navigateTo(event.state.route, event.state.params || {}, { replace: true, skipHistory: true });
  } else {
    const match = matchRoute(window.location.pathname);
    if (match) navigateTo(match.route.name, { path: match.params }, { replace: true, skipHistory: true });
    else navigateTo('not-found', {}, { replace: true });
  }
}

// 🔴 إصلاح (1.1): كان المستمع مسجلاً عبر document.addEventListener بينما
// session.js أصبح يُصدر الحدث عبر EventBus.emit فقط — توحيد على EventBus،
// والمعامل الآن detail مباشرة (وليس event مع event.detail).
function handleUserStateChange(detail) {
  const { action } = detail || {};
  log(`👤 تغير حالة المستخدم: ${action}`);
  if (action === 'logout') {
    const current = routerState.currentRoute;
    if (ROUTES_CONFIG[current]?.requiresAuth) navigateTo('login', {}, { replace: true });
  }
  if (action === 'login') {
    const currentRouteName = routerState.currentRoute;
    const currentRoute = ROUTES_CONFIG[currentRouteName];
    if (currentRoute && currentRoute.requiresAuth && !currentRoute.redirectIfLoggedIn) {
      log(`ℹ️ المستخدم مسجل بالفعل ونحن في صفحة محمية (${currentRouteName})، لن نعيد التوجيه`);
      return;
    }
    redirectAfterLogin();
  }
}

function handleDocumentClick(e) {
  // عنصر data-nav-target
  let target = e.target.closest('[data-nav-target]');
  if (target && !target.hasAttribute('disabled')) {
    e.preventDefault();
    const routeName = target.getAttribute('data-nav-target');
    let params = { path: {}, query: {} };
    const idAttr = target.getAttribute('data-id');
    if (idAttr) params.path.id = idAttr;
    navigateTo(routeName, params);
    return;
  }
  // روابط a عادية
  let anchor = e.target.closest('a');
  if (anchor && anchor.getAttribute('href')) {
    const href = anchor.getAttribute('href');
    if (anchor.target === '_blank') return;
    if (href.startsWith('http') && !href.startsWith(window.location.origin)) return;
    if (href === '#' || href.startsWith('javascript:')) return;
    if (/\.[a-zA-Z0-9]+$/.test(href) && !href.includes('?')) return;
    e.preventDefault();
    let path = href;
    if (href.startsWith(window.location.origin)) path = href.slice(window.location.origin.length);
    const match = matchRoute(path);
    if (match) navigateTo(match.route.name, { path: match.params });
    else navigateTo('not-found');
  }
}


// ===== 19. التحميل المسبق المحسن (مع registry لمنع التكرار) =====
function prefetchAsset(url) {
  if (!url) return;
  const resolved = resolveUrl(url);
  if (routerState.prefetchedAssets.has(resolved)) return;
  routerState.prefetchedAssets.add(resolved);
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.href = resolved;
  document.head.appendChild(link);
}


function prefetchInternalLinks(container) {
  const links = container.querySelectorAll('[data-nav-target]');
  links.forEach(link => {
    const routeName = link.getAttribute('data-nav-target');
    const route = ROUTES_CONFIG[routeName];
    if (route && route.prefetch) {
      if (route.file && !routerState.htmlCache.has(resolveUrl(route.file))) {
        const controller = new AbortController();
routerState.prefetchControllers.push(controller);
fetch(resolveUrl(route.file), { cache: 'force-cache', signal: controller.signal })
  .catch(() => {});
      }
      if (route.css) prefetchAsset(route.css);
      if (route.script) prefetchAsset(route.script);
    }
  });
}

// ===== 20. دوال مساعدة خارجية =====
export function getCurrentRoute() {
  const name = routerState.currentRoute || 'home';
  const params = routerState.currentParams || { path: {}, query: {} };
  return {
    name,
    params: { ...params }
  };
}

export function getCurrentPage() {
  return routerState.currentRoute;
}

export function redirectAfterLogin() {
  const intended = sessionStorage.getItem('biologist_intended_route');
  if (intended) {
    try {
      const { name, params } = JSON.parse(intended);
      sessionStorage.removeItem('biologist_intended_route');
      navigateTo(name, params, { replace: true });
      return;
    } catch (e) {}
  }
  const user = getCurrentUser();
  if (user && (isTeacher(user) || isModerator(user))) navigateTo('dashboard', {}, { replace: true });
  else navigateTo('home', {}, { replace: true });
}

export function destroyRouter() {
  window.removeEventListener('popstate', handlePopState);
  EventBus.off('userStateChanged', handleUserStateChange);
  document.removeEventListener('click', handleDocumentClick);
  if (routerState.prefetchControllers) {
  routerState.prefetchControllers.forEach(controller => controller.abort());
  routerState.prefetchControllers = [];
}
  routerState.initialized = false;
  routerState.loadedStyles.clear();
  routerState.htmlCache.clear();
  routerState.loadedModules.clear();
  routerState.prefetchedAssets.clear();
  routerState.currentStylePath = null;
  routerState.currentRoute = null;
  routerState.currentParams = { path: {}, query: {} };
  routerState.currentCleanup = null;
  log('🧹 Router: تم التنظيف الكامل');
}

// ===== 21. التهيئة الرئيسية (مع تحسين استقرار بدء التشغيل) =====
export async function initializeRouter() {
  if (routerState.initialized) {
    log('⚠️ Router سبق تهيئته');
    return true;
  }
  
  logGroup('🚀 Router v5.0.0: بدء التهيئة...', () => {
    log('بيئة التطوير:', routerState.debugMode ? 'نشطة' : 'غير نشطة');
  });
  
  try {
    window.addEventListener('popstate', handlePopState);
    EventBus.on('userStateChanged', handleUserStateChange);
    document.addEventListener('click', handleDocumentClick);
    
    const user = getCurrentUser();
    const intended = sessionStorage.getItem('biologist_intended_route');
    let currentMatch = matchRoute(window.location.pathname);
    if (!currentMatch) {
  log('⚠️ لم يتم التعرف على المسار الحالي، التوجيه إلى home');
  currentMatch = matchRoute('/');
  if (!currentMatch) {
    await loadView('not-found', {}, { replace: true });
    return;
  }
}
    // ==== تحسين استقرار بدء التشغيل (من النسخة القديمة) ====
    // 1. إذا كان هناك مسار مخزن ولم يتم تسجيل الدخول بعد
    if (intended && !user) {
      const { name, params } = JSON.parse(intended);
      await loadView(name, params, { replace: true });
    }
    // 2. إذا كان المسار الحالي صالحاً ويمكن الوصول إليه
    else if (currentMatch && checkAccess(currentMatch.route, user)) {
      await loadView(currentMatch.route.name, { path: currentMatch.params }, { replace: true });
    }
    // 3. التعامل مع الحالات الأخرى: مسار محمي أو إعادة توجيه
    else {
      if (currentMatch?.route.requiresAuth && !user) {
        // حفظ المسار المقصود لتسجيل الدخول
        sessionStorage.setItem('biologist_intended_route', JSON.stringify({ 
          name: currentMatch.route.name, 
          params: currentMatch.params 
        }));
        await loadView('login', {}, { replace: true });
      } 
      else if (currentMatch?.route.redirectIfLoggedIn && user) {
        await loadView('home', {}, { replace: true });
      } 
      else {
        await loadView('not-found', {}, { replace: true });
      }
    }
    
    // تعريض الواجهة العامة
    
window.router = {
  navigateTo,
  getCurrentRoute,
  getCurrentPage,
  redirectAfterLogin,
  goBack: () => history.back(),
  goForward: () => history.forward(),
  refresh: () => {
    if (routerState.currentRoute) {
      loadView(routerState.currentRoute, routerState.currentParams, { replace: true, force: true });
    }
  },
  getHistory: () => [...routerState.navigationHistory],
  clearCache: () => {
    routerState.htmlCache.clear();
    routerState.loadedStyles.clear();
    routerState.prefetchedAssets.clear();
    routerState.currentStylePath = null;
    log('🧹 Cache cleared');
  },
  destroy: destroyRouter,
  preloadRoute: async (routeName) => {
    const route = ROUTES_CONFIG[routeName];
    if (!route) return;
    if (route.css && !routerState.loadedStyles.has(resolveUrl(route.css))) {
      await loadPageStyle(route.css, routeName).catch(e => log(e));
    }
    if (route.file && !routerState.htmlCache.has(resolveUrl(route.file))) {
      try {
        await fetch(resolveUrl(route.file), { cache: 'force-cache' });
      } catch {}
    }
    if (route.script && !routerState.loadedModules.has(resolveUrl(route.script))) {
      try {
        let scriptUrl = resolveUrl(route.script);
        if (routerState.debugMode) {
          scriptUrl += (scriptUrl.includes('?') ? '&' : '?') + `t=${Date.now()}`;
        }
        await import(scriptUrl);
      } catch (e) {
        log('⚠️ فشل preload للـ script:', e);
      }
    }
  },
    /**
   * تسجيل دالة تنظيف للصفحة الحالية.
   * يجب استدعاؤها من داخل `initializePage` الخاصة بالصفحة لتسجيل أي
   * مستمعين (EventBus, DOM events, timers) تحتاج إلى تنظيف عند مغادرة الصفحة.
   * مثال: router.registerCleanup(() => { EventBus.off('some:event', handler); });
   */
  registerCleanup: registerCleanup   // ← تم إضافة الخاصية بشكل صحيح
};
    
    routerState.initialized = true;
    EventBus.emit('routerInitialized', { timestamp: Date.now() });
    log('✅ Router v5.0.0 جاهز (Smart Merge)');
    return true;
  } catch (error) {
    console.error('❌ فشل تهيئة Router', error);
    return false;
  }
}

// ===== 22. تصدير الواجهة العامة =====
export default {
  initialize: initializeRouter,
  navigateTo,
  getCurrentRoute,
  getCurrentPage,
  redirectAfterLogin,
  destroy: destroyRouter
};