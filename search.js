/**
 * 🔍 js/ui/search.js - نظام البحث المتقدم عن المستخدمين v6.1.0
 * ============================================================================
 * 📝 المسؤولية: إدارة البحث عن المستخدمين (للمعلم والمشرف فقط)
 * ✅ الميزات:
 *   - البحث بالاسم، اسم المستخدم، رقم الهاتف
 *   - عرض النتائج مع الصورة والنوع والتوثيق (باستخدام avatar.js الموحد)
 *   - فتح الملف الشخصي مع صلاحية التعديل
 *   - تكامل مع EventBus، session، modals، router
 *   - دعم RTL، تصميم متجاوب، Skeleton loading أثناء البحث
 *   - إلغاء الطلبات القديمة (AbortController)
 * ============================================================================
 * 🔧 التحديثات في v6.1.0 (إصلاح "البحث لا يرجّع أي نتيجة"):
 *   - 🐛 السبب الحقيقي: searchUsersAPI كانت تنادي window.api?.searchUsers، و window.api غير معرَّف
 *     في أي ملف من المشروع (كل الملفات تستورد api.js كـ ES Module ولا أحد يعرّضه على window).
 *     النتيجة: تحذير "api.js غير متوفر" في الكونسول + إرجاع [] فورًا بدون إرسال أي استعلام
 *     إلى Firestore → شاشة "لا توجد نتائج مطابقة" دائمًا مهما كتبت.
 *   - ✅ الحل: استيراد ديناميكي كسول لـ ../core/api.js (نفس أسلوب theme.js) بدل الاعتماد على window.api.
 *   - ✅ الأخطاء الحقيقية (صلاحيات/شبكة) تظهر الآن كـ "حدث خطأ" بدل "لا توجد نتائج" (throwOnError).
 *   - ✅ تمييز الكلمات المطابقة يفهم التطبيع العربي (احمد ⇢ أحمد) والأرقام العربية و+20.
 *   - ✅ Enter ينفذ البحث فورًا، وتفريغ الحقل يلغي أي طلب جارٍ (لا تظهر نتائج بعد المسح).
 *   - ⏱️ debounce من 500ms إلى 350ms.
 *
 * 🔧 التحديثات في v6.0.0 (2026-09-21):
 *   - 🐛 السبب الجذري لتوقف كل أنواع البحث (اسم/يوزر/تليفون) كان في api.js:
 *     دالة searchUsers كان اسم الباراميتر عندها "query" فكانت تعمل shadowing
 *     لدالة query() المستوردة من Firestore. تم إصلاحه في api.js (searchQuery)،
 *     وهذا الملف الآن يفترض أن api.searchUsers يرجّع نتائج حقيقية.
 *   - 🎨 إعادة بناء كاملة للواجهة: لا يوجد Overlay منفصل بعد الآن. البحث أصبح
 *     مدمجًا داخل الشريط العلوي نفسه (navbar-search): زر البحث يتوسع مكانه
 *     بالظبط ليعرض صندوق البحث (search-panel)، وزر الإغلاق (X) يظهر تلقائيًا
 *     في أقصى يسار الصندوق (اتجاه RTL)، والإغلاق يرجّع الصندوق لنفس نقطة/حجم
 *     زر البحث الأصلي بانسيابية (كل التفاصيل البصرية في navbar.css).
 *   - 🧩 الملف الآن يعتمد فقط على عناصر موجودة مسبقًا في index.html (نفس فلسفة
 *     navbar.js) بدل إنشاء overlay ديناميكيًا بالكامل عبر JS.
 *   - ✨ إغلاق تلقائي عند: الضغط خارج الصندوق، Escape، تمرير الصفحة (scroll)،
 *     أو تغيّر الصفحة الحالية عبر الـ router (pageChanged).
 *   - 🩹 إصلاح Skeleton loading: كان يستخدم كلاسات CSS غير معرّفة إطلاقًا
 *     (search-skeleton / skeleton-item / skeleton-avatar...). تم استبدالها
 *     بإعادة استخدام كلاسات موجودة وموحدة فعليًا (search-result-item +
 *     skeleton-rect + skeleton-text من components.css) بدل تعريف CSS جديد.
 *   - 🔧 تبسيط استدعاء الـ API: إزالة تأخير setTimeout الوهمي غير الضروري،
 *     والاعتماد على AbortController حقيقي عبر سباق (Promise.race) مع الإلغاء.
 * ============================================================================
 */

import { getCurrentUser } from '../core/session.js';
import { EventBus } from '../core/event-bus.js';
import { createAvatarElement, shouldShowVerificationBadge } from '../utils/avatar.js';

// ===== 1. الثوابت والتكوين =====
const SEARCH_CONFIG = {
  debounceDelay: 350,
  minQueryLength: 2,
  maxResults: 20,
  highlightClass: 'search-highlight',
  closeAnimationMs: 260, // 🔁 يجب أن يطابق مدة var(--navbar-transition) في navbar.css
  avatarSize: 'sm'       // حجم الصورة الرمزية في نتائج البحث
};

const SELECTORS = {
  wrap: '#navbar-search',
  triggerBtn: '#global-search-btn',
  panel: '#search-panel',
  input: '#search-input',
  results: '#search-results',
  closeBtn: '#close-search',
  navbarTopRight: '.navbar-top-right',
  navbarTop: '#navbar-top',
  navbarTopContent: '.navbar-top-content'
};

// ===== 2. الحالة الداخلية =====
let searchState = {
  initialized: false,
  isOpen: false,
  currentQuery: '',
  currentResults: [],
  debounceTimer: null,
  closeTimer: null,
  armScrollCloseTimer: null, // مؤقت تفعيل إغلاق-عند-التمرير (متأخر عمدًا)
  scrollYAtOpen: 0,          // موضع التمرير وقت الفتح، لتجاهل هزّات الكيبورد
  abortController: null,  // لإلغاء طلبات fetch القديمة
  eventUnsubscribers: []
};

let dom = {
  wrap: null,
  triggerBtn: null,
  panel: null,
  input: null,
  resultsContainer: null,
  closeBtn: null,
  navbarTopRight: null,
  navbarTop: null,
  navbarTopContent: null
};

// ===== 3. دوال مساعدة =====
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
    console.log(`[Search Toast][${type}]: ${message}`);
  }
}

function isSearchAllowed() {
  const user = getCurrentUser();
  return user && (user.user_type === 'teacher' || user.user_type === 'moderator');
}

function getUserTypeArabic(type) {
  const map = {
    student: 'طالب',
    moderator: 'مشرف',
    teacher: 'معلم'
  };
  return map[type] || 'مستخدم';
}

// تطبيع للمطابقة/التمييز (نفس منطق api.js): أ/إ/آ=ا ، ى/ئ=ي ، ؤ=و ، ة=ه ، إزالة التشكيل ، أرقام لاتينية
const HL_CHAR_MAP = { 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ى': 'ي', 'ئ': 'ي', 'ؤ': 'و', 'ة': 'ه' };
const HL_IGNORABLE = /[\u064B-\u065F\u0670\u0640\u200B-\u200F\u202A-\u202E\uFEFF]/;

function normalizeWithMap(input) {
  const src = String(input ?? '');
  let out = '';
  const map = []; // موضع كل حرف مطبَّع في النص الأصلي
  for (let i = 0; i < src.length; i++) {
    let ch = src[i];
    if (HL_IGNORABLE.test(ch)) continue;
    const code = ch.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) ch = String(code - 0x0660);
    else if (code >= 0x06F0 && code <= 0x06F9) ch = String(code - 0x06F0);
    ch = HL_CHAR_MAP[ch] || ch;
    if (/\s/.test(ch)) ch = ' ';
    ch = ch.toLowerCase();
    for (let k = 0; k < ch.length; k++) { out += ch[k]; map.push(i); }
  }
  return { text: out, map };
}

function findMatchIndex(norm, needle) {
  let from = 0;
  while (from <= norm.length - needle.length) {
    const found = norm.indexOf(needle, from);
    if (found === -1) break;
    if (found === 0 || norm[found - 1] === ' ' || norm[found - 1] === '_') return found; // بداية كلمة أولاً
    from = found + 1;
  }
  return needle.length >= 3 ? norm.indexOf(needle) : -1; // ثم "يحتوي"
}

/**
 * تمييز الكلمات المطابقة داخل النص (آمن ضد XSS): يطابق على النص المطبَّع ويميّز في النص الأصلي،
 * فكتابة "احمد" تميّز "أحمد"، وكتابة "+2010…" تميّز "010…".
 */
function highlightMatch(text, query) {
  const src = String(text ?? '');
  if (!src) return '';
  const q = normalizeWithMap(query).text.trim();
  if (!q) return escapeHtml(src);

  const { text: norm, map } = normalizeWithMap(src);
  const ranges = [];

  q.split(' ').filter(Boolean).forEach((token) => {
    const candidates = [token];
    if (/^\+?\d+$/.test(token)) {
      const d = token.replace(/^\+/, '');
      candidates.push(d);
      if (d.startsWith('0020')) candidates.push('0' + d.slice(4));
      else if (d.startsWith('20') && d.length >= 11) candidates.push('0' + d.slice(2));
    }
    for (const cand of candidates) {
      const idx = findMatchIndex(norm, cand);
      if (idx === -1) continue;
      let end = map[idx + cand.length - 1] + 1;
      while (end < src.length && HL_IGNORABLE.test(src[end])) end++;
      ranges.push([map[idx], end]);
      break;
    }
  });

  if (!ranges.length) return escapeHtml(src);

  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  ranges.forEach((r) => {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  });

  let html = '';
  let cursor = 0;
  merged.forEach(([s, e]) => {
    html += escapeHtml(src.slice(cursor, s));
    html += `<mark class="${SEARCH_CONFIG.highlightClass}">${escapeHtml(src.slice(s, e))}</mark>`;
    cursor = e;
  });
  html += escapeHtml(src.slice(cursor));
  return html;
}

// ===== 3.5 هندسة صندوق البحث (Fixed-Position FLIP) =====
const MOBILE_QUERY = '(max-width: 767.98px)';

function isMobileViewport() {
  return window.matchMedia(MOBILE_QUERY).matches;
}

function setPanelFixedRect(rect) {
  if (!dom.panel) return;
  dom.panel.style.setProperty('--search-fixed-top', `${rect.top}px`);
  dom.panel.style.setProperty('--search-fixed-left', `${rect.left}px`);
  dom.panel.style.setProperty('--search-fixed-width', `${rect.width}px`);
  dom.panel.style.setProperty('--search-fixed-height', `${rect.height}px`);
}

// نقطة الهدف عند الفتح على الجوال = مستطيل الشريط بالكامل (مع هامش بسيط)
function getNavbarFullRect() {
  const ref = dom.navbarTopContent || dom.navbarTopRight || dom.wrap;
  const r = ref.getBoundingClientRect();

  const gutter = 5;
  const verticalGutter = 15;

  return {
    top: r.top + verticalGutter / 2,
    left: r.left + gutter,
    width: Math.max(0, r.width - gutter * 2),
    height: r.height - verticalGutter
  };
}

// أقصى عرض آمن على الكمبيوتر = المسافة الحقيقية من حافة الزرار لحافة الشريط
function updateDesktopSearchWidth() {
  if (!dom.panel || !dom.triggerBtn) return;
  const btnRect = dom.triggerBtn.getBoundingClientRect();
  const rowRect = getNavbarFullRect();
  const available = Math.max(240, btnRect.right - rowRect.left - 16);
  dom.panel.style.setProperty('--search-max-width', `${available}px`);
}

function handleSearchViewportChange() {
  if (!searchState.isOpen) return;
  if (isMobileViewport()) setPanelFixedRect(getNavbarFullRect());
  else updateDesktopSearchWidth();
}

// ===== 4. دوال البحث =====
/**
 * تحميل api.js عند أول بحث (Lazy Dynamic Import) — نفس أسلوب theme.js.
 * 🐛 كان الكود القديم يعتمد على window.api وهو غير معرَّف في أي مكان بالمشروع،
 *    فكانت النتيجة [] دائمًا بدون أي استعلام لـ Firestore.
 */
let apiModulePromise = null;
function getApiModule() {
  if (!apiModulePromise) {
    apiModulePromise = import('../core/api.js').catch((err) => {
      apiModulePromise = null; // نسمح بإعادة المحاولة عند البحث التالي
      throw err;
    });
  }
  return apiModulePromise;
}

/**
 * استدعاء API حقيقي مع دعم إلغاء عبر AbortController.
 * ملحوظة: Firestore SDK لا يدعم إلغاء الطلب فعليًا وقت التنفيذ، لكن السباق هنا
 * يضمن أننا لا نستخدم/نعرض نتيجة طلب قديم بعد إلغائه (لا "نتائج متأخرة" خاطئة).
 * throwOnError: true → الأخطاء الحقيقية تصل للواجهة وتظهر "حدث خطأ" بدل "لا توجد نتائج" المضلّلة.
 */
async function searchUsersAPI(searchQuery, signal) {
  const abortPromise = new Promise((_, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });

  const request = getApiModule().then((api) => {
    if (typeof api.searchUsers !== 'function') {
      throw new Error('searchUsers غير معرّفة في api.js');
    }
    return api.searchUsers(searchQuery, { limit: SEARCH_CONFIG.maxResults, throwOnError: true });
  });

  return Promise.race([request, abortPromise]);
}

async function performSearch(query) {
  if (!query || query.trim().length < SEARCH_CONFIG.minQueryLength) {
    searchState.currentResults = [];
    renderResults([]);
    return;
  }

  const trimmedQuery = query.trim();
  searchState.currentQuery = trimmedQuery;

  // إلغاء أي طلب سابق
  if (searchState.abortController) {
    searchState.abortController.abort();
  }
  searchState.abortController = new AbortController();
  const { signal } = searchState.abortController;

  renderSkeleton();

  try {
    const results = await searchUsersAPI(trimmedQuery, signal);
    if (signal.aborted) return; // تم إلغاؤه أثناء الانتظار، لا تعرض نتيجة قديمة
    searchState.currentResults = (results || []).slice(0, SEARCH_CONFIG.maxResults);
    renderResults(searchState.currentResults);
  } catch (error) {
    if (error.name === 'AbortError') return; // تم إلغاؤه، لا تفعل شيئًا
    console.error('❌ فشل البحث:', error);
    showToast('حدث خطأ أثناء البحث', 'error');
    renderError();
  }
}

/**
 * ⏳ Skeleton loading — يعيد استخدام كلاسات موجودة فعليًا (search-result-item،
 * result-avatar، skeleton-rect، skeleton-text من components.css) بدل تعريف
 * كلاسات CSS جديدة غير موجودة (كانت السبب في ظهور Skeleton بلا أي شكل مسبقًا).
 */
function renderSkeleton() {
  if (!dom.resultsContainer) return;
  dom.resultsContainer.innerHTML = Array(3).fill(0).map(() => `
    <div class="search-result-item search-result-item--skeleton" aria-hidden="true">
      <div class="result-avatar skeleton-rect" style="border-radius: 50%;"></div>
      <div class="result-info">
        <div class="skeleton-text" style="width: 65%;"></div>
        <div class="skeleton-text" style="width: 40%; margin-top: 6px;"></div>
      </div>
    </div>
  `).join('');
}

function renderError() {
  if (!dom.resultsContainer) return;
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  dom.resultsContainer.innerHTML = `
    <div class="search-error">
      <i class="fas fa-exclamation-triangle"></i>
      <p>${offline ? 'لا يوجد اتصال بالإنترنت' : 'حدث خطأ، حاول مرة أخرى'}</p>
    </div>
  `;
}

/**
 * عرض نتائج البحث باستخدام avatar.js الموحد للصور الرمزية
 */
function renderResults(users) {
  if (!dom.resultsContainer) return;

  if (!users || users.length === 0) {
    // ===== حالة "لا نتائج" تظهر فقط لو كان في نص بحث فعلي =====
    dom.resultsContainer.innerHTML = searchState.currentQuery ? `
      <div class="search-empty">
        <i class="fas fa-user-slash"></i>
        <p>لا توجد نتائج مطابقة</p>
        <small>جرب اسم أو رقم هاتف آخر</small>
      </div>
    ` : '';
    return;
  }

  // ===== بناء HTML الأساسي مع حاوية للصورة الرمزية =====
  const html = users.map(user => {
    const userTypeAr = getUserTypeArabic(user.user_type);
    let showBadge = false;
    try { showBadge = shouldShowVerificationBadge(user); } catch (_) { /* لا نُسقط القائمة كلها بسبب شارة */ }
    const highlightedName = highlightMatch(user.full_name || user.username, searchState.currentQuery);
    const highlightedUsername = highlightMatch(user.username, searchState.currentQuery);
    const highlightedPhone = highlightMatch(user.phone, searchState.currentQuery);

    return `
      <div class="search-result-item" data-user-id="${user.id}" data-user-type="${user.user_type}" role="option" tabindex="0">
        <div class="result-avatar" data-avatar-container="${user.id}"></div>
        <div class="result-info">
          <div class="result-name">
            ${highlightedName}
            ${showBadge ? '<i class="fas fa-check-circle verified-badge"></i>' : ''}
            <span class="result-badge role-badge-${user.user_type}">${userTypeAr}</span>
          </div>
          <div class="result-details">
            <span class="result-username"><i class="fas fa-at"></i> ${highlightedUsername}</span>
            <span class="result-phone"><i class="fas fa-phone"></i> ${highlightedPhone}</span>
          </div>
        </div>
        <div class="result-actions">
          <button class="result-view-btn" data-user-id="${user.id}" data-user-type="${user.user_type}" aria-label="عرض الملف الشخصي">
            <i class="fas fa-eye"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');

  dom.resultsContainer.innerHTML = html;

  // ===== استخدام avatar.js لإنشاء الصور الرمزية =====
  users.forEach(user => {
    const container = dom.resultsContainer.querySelector(`[data-avatar-container="${user.id}"]`);
    if (container) {
      try {
        const avatarEl = createAvatarElement(user, SEARCH_CONFIG.avatarSize, {
          showFrame: true,
          showBadge: true,
          clickable: false,
          showShimmer: false,
          showPulse: false
        });
        container.appendChild(avatarEl);
      } catch (err) {
        console.warn('[Search] فشل إنشاء الصورة الرمزية للمستخدم:', user.id, err);
        container.innerHTML = `<div class="avatar-fallback">${user.full_name?.[0] || '?'}</div>`;
      }
    }
  });

  // ===== ربط الأحداث =====
  dom.resultsContainer.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.result-view-btn')) return;
      const userId = item.getAttribute('data-user-id');
      const userType = item.getAttribute('data-user-type');
      openUserProfile(userId, userType);
    });
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openUserProfile(item.getAttribute('data-user-id'), item.getAttribute('data-user-type'));
      }
    });
  });

  dom.resultsContainer.querySelectorAll('.result-view-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const userId = btn.getAttribute('data-user-id');
      const userType = btn.getAttribute('data-user-type');
      openUserProfile(userId, userType);
    });
  });
}

/**
 * فتح الملف الشخصي للمستخدم مع دعم router بشكل صحيح
 */
function openUserProfile(userId, userType) {
  if (!userId) return;
  closeSearch();

  const currentUser = getCurrentUser();
  if (!currentUser) {
    showToast('يجب تسجيل الدخول أولاً', 'warning');
    return;
  }

  const canEdit = currentUser.user_type === 'teacher' || currentUser.user_type === 'moderator';

  if (window.router?.navigateTo) {
    const params = { query: { id: userId } };
    if (canEdit && String(userId) !== String(currentUser.id)) {
      params.query.edit = 'true';
    }
    window.router.navigateTo('profile', params);
  } else {
    let url = `/profile?id=${userId}`;
    if (canEdit && String(userId) !== String(currentUser.id)) {
      url += '&edit=true';
    }
    window.location.href = url;
  }
}

// ===== 5. التحكم في صندوق البحث المدمج بالشريط =====
function openSearch(prefillQuery = '') {
  if (!isSearchAllowed()) {
    showToast('البحث متاح للمعلمين والمشرفين فقط', 'warning');
    return;
  }
  if (!dom.wrap || !dom.panel || !dom.input) {
    console.error('[Search] عناصر البحث غير موجودة في index.html');
    return;
  }
  if (searchState.isOpen) return;

  if (searchState.closeTimer) {
    clearTimeout(searchState.closeTimer);
    searchState.closeTimer = null;
  }

  const mobile = isMobileViewport();

  // نثبّت الصندوق أول حاجة على مكان/حجم الزرار بالظبط، قبل ما نفتح،
  // عشان لما يتمدد بعدين يبان طالع فعليًا من مكانه مش قافز فجأة
  if (mobile && dom.triggerBtn) {
    setPanelFixedRect(dom.triggerBtn.getBoundingClientRect());
  }

  searchState.isOpen = true;
  dom.wrap.classList.add('is-open');
  dom.navbarTopRight?.classList.add('search-open');
  dom.panel.setAttribute('aria-hidden', 'false');
  dom.triggerBtn?.setAttribute('aria-expanded', 'true');
  dom.input.removeAttribute('tabindex');
  dom.closeBtn?.removeAttribute('tabindex');

  if (mobile) {
    dom.navbarTop?.classList.add('search-active');
    void dom.panel.offsetWidth; // فرض reflow عشان يلتقط نقطة البداية قبل ما نغيّرها
    requestAnimationFrame(() => setPanelFixedRect(getNavbarFullRect()));
  } else {
    updateDesktopSearchWidth();
  }

  window.addEventListener('resize', handleSearchViewportChange);

  // ===== التركيز على الإنبوت بعد اكتمال أنيميشن التوسّع =====
  setTimeout(() => {
    dom.input?.focus();
    if (prefillQuery) {
      dom.input.value = prefillQuery;
      performSearch(prefillQuery);
    }
  }, SEARCH_CONFIG.closeAnimationMs);

  document.addEventListener('keydown', handleKeydown);
  document.addEventListener('click', handleOutsideClick, true);

  // 🐛 إصلاح: كان يتم تفعيل إغلاق-عند-التمرير فورًا عند الفتح، فأي "scroll"
  // ناتج عن ظهور كيبورد الموبايل بعد focus() (أو عن أنيميشن التوسّع نفسه)
  // كان يقفل الصندوق فورًا بعد فتحه مباشرة — وهو الجلتش "يفتح ويقفل في نفس اللحظة".
  // الحل: لا نُفعّل مستمع التمرير إلا بعد اكتمال الأنيميشن + استقرار التركيز/الكيبورد،
  // ونتجاهل أي فرق تمرير بسيط لأنه غالبًا كيبورد وليس تمريرًا حقيقيًا من المستخدم.
  if (searchState.armScrollCloseTimer) clearTimeout(searchState.armScrollCloseTimer);
  searchState.armScrollCloseTimer = setTimeout(() => {
    searchState.scrollYAtOpen = window.scrollY;
    window.addEventListener('scroll', handleScrollClose, { passive: true });
  }, SEARCH_CONFIG.closeAnimationMs + 150);
}

function handleScrollClose() {
  if (Math.abs(window.scrollY - searchState.scrollYAtOpen) < 24) return;
  closeSearch();
}

function closeSearch() {
  if (!dom.wrap || !searchState.isOpen) return;

  // إلغاء الطلب الجاري
  if (searchState.abortController) {
    searchState.abortController.abort();
    searchState.abortController = null;
  }

  // نرجّع إحداثيات الصندوق لمكان/حجم الزرار الأصلي قبل ما نشيل is-open،
  // فالإغلاق يتحرك بالعكس بالظبط زي ما فتح
  if (isMobileViewport() && dom.triggerBtn) {
    setPanelFixedRect(dom.triggerBtn.getBoundingClientRect());
  }

  searchState.isOpen = false;
  dom.wrap.classList.remove('is-open');
  dom.navbarTopRight?.classList.remove('search-open');
  dom.navbarTop?.classList.remove('search-active');
  dom.panel?.setAttribute('aria-hidden', 'true');
  dom.triggerBtn?.setAttribute('aria-expanded', 'false');
  dom.input?.setAttribute('tabindex', '-1');
  dom.closeBtn?.setAttribute('tabindex', '-1');

  window.removeEventListener('resize', handleSearchViewportChange);

  document.removeEventListener('keydown', handleKeydown);
  document.removeEventListener('click', handleOutsideClick, true);
  window.removeEventListener('scroll', handleScrollClose);
  if (searchState.armScrollCloseTimer) {
    clearTimeout(searchState.armScrollCloseTimer);
    searchState.armScrollCloseTimer = null;
  }

  // ===== تفريغ المحتوى بعد اكتمال أنيميشن الانطواء عشان ملحقش نص/نتائج
  //       تختفي فجأة قبل ما الصندوق يخلّص يرجع لحجم الزر =====
  searchState.closeTimer = setTimeout(() => {
    if (dom.input) dom.input.value = '';
    if (dom.resultsContainer) dom.resultsContainer.innerHTML = '';
    searchState.currentQuery = '';
    searchState.currentResults = [];
  }, SEARCH_CONFIG.closeAnimationMs);

  dom.triggerBtn?.focus();
}

function handleKeydown(e) {
  if (e.key === 'Escape' && searchState.isOpen) {
    closeSearch();
    e.preventDefault();
  }
}

function handleOutsideClick(e) {
  if (!searchState.isOpen || !dom.wrap) return;
  if (!dom.wrap.contains(e.target)) closeSearch();
}

function handleInput(e) {
  const raw = e.target.value;
  const trimmed = raw.trim();

  if (searchState.debounceTimer) {
    clearTimeout(searchState.debounceTimer);
  }

  if (trimmed.length < SEARCH_CONFIG.minQueryLength) {
    // مسح الحقل/نص قصير → ألغِ أي طلب جارٍ حتى لا تظهر نتائجه بعد التفريغ
    if (searchState.abortController) {
      searchState.abortController.abort();
      searchState.abortController = null;
    }
    searchState.currentQuery = '';
    searchState.currentResults = [];
    if (dom.resultsContainer) renderResults([]);
    return;
  }

  searchState.debounceTimer = setTimeout(() => {
    performSearch(raw);
  }, SEARCH_CONFIG.debounceDelay);
}

// Enter (أو زر "بحث" في كيبورد الموبايل) → نفّذ البحث فورًا بدون انتظار الـ debounce
function handleInputKeydown(e) {
  if (e.key !== 'Enter' || e.isComposing) return;
  e.preventDefault();
  if (searchState.debounceTimer) clearTimeout(searchState.debounceTimer);
  performSearch(dom.input.value);
}

// ===== 6. ربط عناصر DOM الموجودة مسبقًا في index.html =====
/**
 * ⚠️ لا يُنشئ أي عناصر (نفس فلسفة navbar.js) — يعتمد فقط على هيكل .navbar-search
 * الموجود داخل index.html (navbar-top-right).
 */
function bindSearchElements() {
  dom.wrap           = document.querySelector(SELECTORS.wrap);
  dom.triggerBtn      = document.querySelector(SELECTORS.triggerBtn);
  dom.panel           = document.querySelector(SELECTORS.panel);
  dom.input           = document.querySelector(SELECTORS.input);
  dom.resultsContainer = document.querySelector(SELECTORS.results);
  dom.closeBtn        = document.querySelector(SELECTORS.closeBtn);
  dom.navbarTopRight  = document.querySelector(SELECTORS.navbarTopRight);
  dom.navbarTop        = document.querySelector(SELECTORS.navbarTop);
  dom.navbarTopContent = document.querySelector(SELECTORS.navbarTopContent);

  if (!dom.wrap || !dom.panel || !dom.input || !dom.resultsContainer || !dom.closeBtn) {
    console.error('[Search] هيكل .navbar-search الأساسي ناقص في index.html — راجع نسخة v6.0.0 من الملف');
    return false;
  }

  dom.input.removeEventListener('input', handleInput);
  dom.input.addEventListener('input', handleInput);
  dom.input.removeEventListener('keydown', handleInputKeydown);
  dom.input.addEventListener('keydown', handleInputKeydown);

  dom.closeBtn.removeEventListener('click', closeSearch);
  dom.closeBtn.addEventListener('click', closeSearch);

  return true;
}

function bindGlobalSearchButton() {
  if (!dom.triggerBtn) return;
  dom.triggerBtn.removeEventListener('click', handleTriggerClick);
  dom.triggerBtn.addEventListener('click', handleTriggerClick);
}

function handleTriggerClick() {
  openSearch();
}

// ===== 7. التكامل مع EventBus =====
function subscribeToEvents() {
  const unsub = EventBus.on('openSearch', (detail) => openSearch(detail?.query || ''));
  searchState.eventUnsubscribers.push(unsub);

  const unsubUser = EventBus.on('userStateChanged', () => {
    if (searchState.isOpen && !isSearchAllowed()) closeSearch();
  });
  searchState.eventUnsubscribers.push(unsubUser);

  // ===== إغلاق البحث تلقائيًا عند تغيّر الصفحة الحالية عبر الـ router =====
  const unsubPage = EventBus.on('pageChanged', () => {
    if (searchState.isOpen) closeSearch();
  });
  searchState.eventUnsubscribers.push(unsubPage);
}

function unsubscribeFromEvents() {
  searchState.eventUnsubscribers.forEach(fn => fn());
  searchState.eventUnsubscribers = [];
}

// ===== 8. التهيئة والتنظيف =====
export function initializeSearch() {
  if (searchState.initialized) return true;
  console.log('[Search] بدء التهيئة v6.1.0 (بحث مدمج بالشريط)...');

  try {
    const bound = bindSearchElements();
    if (!bound) return false;

    bindGlobalSearchButton();
    subscribeToEvents();

    window.searchAPI = {
      open: openSearch,
      close: closeSearch,
      isOpen: () => searchState.isOpen,
      search: performSearch
    };

    searchState.initialized = true;
    console.log('[Search] ✅ تم التهيئة — البحث الآن مدمج داخل الشريط العلوي');
    return true;
  } catch (error) {
    console.error('[Search] فشل التهيئة:', error);
    return false;
  }
}

export function destroySearch() {
  if (dom.input) {
    dom.input.removeEventListener('input', handleInput);
    dom.input.removeEventListener('keydown', handleInputKeydown);
  }
  if (dom.closeBtn) dom.closeBtn.removeEventListener('click', closeSearch);
  if (dom.triggerBtn) dom.triggerBtn.removeEventListener('click', handleTriggerClick);

  document.removeEventListener('keydown', handleKeydown);
  document.removeEventListener('click', handleOutsideClick, true);
  window.removeEventListener('scroll', handleScrollClose);
  window.removeEventListener('resize', handleSearchViewportChange);

  unsubscribeFromEvents();
  if (searchState.debounceTimer) clearTimeout(searchState.debounceTimer);
  if (searchState.closeTimer) clearTimeout(searchState.closeTimer);
  if (searchState.armScrollCloseTimer) clearTimeout(searchState.armScrollCloseTimer);
  if (searchState.abortController) searchState.abortController.abort();

  searchState.isOpen = false;
  dom.wrap?.classList.remove('is-open');
  dom.navbarTopRight?.classList.remove('search-open');

  searchState.initialized = false;
  delete window.searchAPI;
  console.log('[Search] تم التنظيف');
}

export default {
  initialize: initializeSearch,
  destroy: destroySearch,
  open: openSearch,
  close: closeSearch,
  isOpen: () => searchState.isOpen
};
