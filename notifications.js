/**
 * 📬 js/ui/notifications.js – نظام الإشعارات المتكامل v5.0.0
 * ============================================================================
 * 📝 المسؤولية: عرض لوحة الإشعارات وإدارتها (جلب، قراءة، حذف، فلترة)
 * 🏗️ العمارة:
 *   - NotificationsData   : طبقة البيانات والتواصل مع api.js
 *   - NotificationsFilter : الفلترة والتبويبات المشروطة بالصلاحية
 *   - NotificationsView   : العرض مع Virtual Scrolling
 *   - NotificationsBadge  : شارة العداد في navbar
 *   - NotificationsPanel  : فتح/إغلاق اللوحة مع Focus Trap و Swipe
 * ============================================================================
 */

import { getCurrentUser } from '../core/session.js';
import { EventBus }        from '../core/event-bus.js';

// ====== الثوابت والتكوين ======
const CONFIG = Object.freeze({
  PANEL_ID:           'notifications-panel',
  BADGE_ID:           'notification-badge',
  TRIGGER_BTN_ID:     'notification-btn',
  CONTENT_ID:         'notifications-content',
  TABS_SELECTOR:      '.notifications-tabs',
  SEARCH_INPUT_ID:    'notifications-search-input',
  SELECT_ALL_ID:      'notifications-select-all',
  DELETE_SELECTED_ID: 'notifications-delete-selected',
  MARK_ALL_READ_ID:   'notifications-mark-all-read',
  CLOSE_BTN_ID:       'notifications-close-btn',
  VIRTUAL_PAGE_SIZE:  12,
  THREE_MONTHS_MS:    7_776_000_000,  // 90 يوم بالمللي ثانية
  SWIPE_THRESHOLD:    80,
  KEYBOARD_SHORTCUT:  'n',            // Ctrl+Shift+N
  AUDIO_SETTING_KEY:  'notif_sound_enabled',
  POLL_INTERVAL_MS:   30_000,         // تحديث دوري كل 30 ثانية
});

// ====== أنواع الإشعارات ======
const NOTIF_TYPES = Object.freeze({
  success:   { icon: 'fa-check-circle',        color: '#10b981' },
  info:      { icon: 'fa-info-circle',          color: '#3b82f6' },
  warning:   { icon: 'fa-exclamation-triangle', color: '#f59e0b' },
  alert:     { icon: 'fa-exclamation-circle',   color: '#ef4444' },
  exam:      { icon: 'fa-graduation-cap',       color: '#8b5cf6' },
  lesson:    { icon: 'fa-book-open',            color: '#06b6d4' },
  comment:   { icon: 'fa-comment',              color: '#84cc16' },
  like:      { icon: 'fa-heart',                color: '#ec4899' },
  complaint: { icon: 'fa-flag',                 color: '#f97316' },
  system:    { icon: 'fa-cog',                  color: '#6b7280' },
  default:   { icon: 'fa-bell',                 color: '#9ca3af' },
});

// ====== تعريف التبويبات بالفلاتر والأدوار ======
const TABS_CONFIG = Object.freeze({
  all:         { label: 'الكل',       roles: ['student','teacher','moderator'], filter: ()  => true },
  general:     { label: 'عامة',       roles: ['student','teacher','moderator'], filter: (n) => !n.sender || n.sender === 'system' },
  supervisors: { label: 'المشرفين',   roles: ['moderator','teacher'],           filter: (n) => n.sender === 'moderator' },
  teachers:    { label: 'المعلمين',   roles: ['teacher'],                       filter: (n) => n.sender === 'teacher' },
  complaints:  { label: 'الشكاوي',   roles: ['teacher'],                       filter: (n) => n.type === 'complaint' },
});

// ====== الحالة المركزية ======
const state = {
  initialized:   false,
  notifications: [],   // المصفوفة الكاملة (كل عنصر يحمل docId و id)
  filteredList:  [],   // بعد الفلترة والترتيب
  selectedIds:   new Set(),
  currentTab:    'all',
  searchTerm:    '',
  isLoading:     false,
  isFetching:    false,  // لمنع الطلبات المتداخلة في الـ polling
  virtualOffset: 0,
  userRole:      null,
  userId:        null,
  pollingTimer:  null,
};

// ====== مراجع عناصر DOM ======
const elems = {
  panel:         null,
  badge:         null,
  trigger:       null,
  content:       null,
  tabsContainer: null,
  searchInput:   null,
  selectAllChk:  null,
  deleteSel:     null,
  markAllRead:   null,
  closeBtn:      null,
};

// ====== مراجع المستمعين للتنظيف ======
const _listeners = {
  globalKeydown:  null,   // Ctrl+Shift+N الثابت
  panelKeydown:   null,   // Esc + Focus Trap داخل اللوحة
  outsideClick:   null,
  visibilityChange: null,
  swipeTouchStart: null,
  swipeTouchMove:  null,
  swipeTouchEnd:   null,
};

// ====== دوال إلغاء اشتراك EventBus ======
const _eventUnsubs = [];

// ====== مرجع lazy لـ api.js ======
let _apiRef = null;

// ====== متغيرات Swipe ======
let _swipeStartY = 0;
let _swipeCurrentY = 0;

// ============================================================
// 🔧 دوال مساعدة
// ============================================================

// تهريب HTML لمنع XSS
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#039;');
}

// تنسيق الوقت النسبي
function formatTime(ts) {
  if (!ts) return 'الآن';
  let date;
  if (ts?.toDate)       date = ts.toDate();
  else if (ts?.seconds) date = new Date(ts.seconds * 1000);
  else                  date = new Date(ts);
  if (isNaN(date))      return '';

  const diff  = Date.now() - date.getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);

  if (mins  <  1) return 'الآن';
  if (mins  < 60) return `منذ ${mins} د`;
  if (hours < 24) return `منذ ${hours} س`;
  if (days  <  7) return `منذ ${days} ي`;
  return date.toLocaleDateString('ar-EG');
}

// حذف الإشعارات الأقدم من 3 أشهر محلياً
function filterOldNotifications(list) {
  const cutoff = Date.now() - CONFIG.THREE_MONTHS_MS;
  return list.filter(n => {
    const ms = n.created_at?.seconds ? n.created_at.seconds * 1000 : Number(n.created_at) || 0;
    return ms >= cutoff;
  });
}

// تجميع الإشعارات المتشابهة (likes/comments للنفس الدرس)
function groupSimilarNotifications(list) {
  const likeMap    = new Map();
  const commentMap = new Map();
  const rest       = [];

  for (const n of list) {
    if (n.type === 'like' && n.related_lesson) {
      const key = `like_${n.related_lesson}`;
      if (!likeMap.has(key)) likeMap.set(key, { ...n, _groupCount: 1 });
      else likeMap.get(key)._groupCount++;
    } else if (n.type === 'comment' && n.related_lesson) {
      const key = `comment_${n.related_lesson}`;
      if (!commentMap.has(key)) commentMap.set(key, { ...n, _groupCount: 1 });
      else commentMap.get(key)._groupCount++;
    } else {
      rest.push(n);
    }
  }

  return [...rest, ...likeMap.values(), ...commentMap.values()];
}

// تشغيل صوت إشعار (Web Audio API)
function playNotificationSound() {
  try {
    if (localStorage.getItem(CONFIG.AUDIO_SETTING_KEY) !== 'true') return;
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch (_e) { /* الصوت غير متاح */ }
}

// إظهار Toast عبر modals.js
function showToast(msg, type = 'info') {
  if (window.modals?.toast) window.modals.toast(msg, type);
  else console.log(`[Notifications] ${type}: ${msg}`);
}

// نافذة تأكيد عبر modals.js
function confirmDialog(msg) {
  if (window.modals?.confirm) {
    return new Promise(res => window.modals.confirm({
      title: 'تأكيد',
      message: msg,
      onConfirm: () => res(true),
      onCancel:  () => res(false),
    }));
  }
  return Promise.resolve(window.confirm(msg));
}

// ============================================================
// 📦 NotificationsData – طبقة البيانات
// ============================================================
const NotificationsData = (() => {

  // تحميل api.js عند الحاجة (lazy) لتجنب الاعتماد الدائري
  async function _getApi() {
    if (_apiRef) return _apiRef;
    try {
      _apiRef = await import('../core/api.js');
    } catch (_e) {
      // fallback فارغ يمنع انهيار الواجهة
      _apiRef = {
        getUserNotifications:      async () => [],
        markNotificationRead:      async () => {},
        deleteNotification:        async () => {},
        clearAllUserNotifications: async () => {},
      };
    }
    return _apiRef;
  }

  // جلب الإشعارات من api.js وتطبيقها على الحالة
  async function fetch(userId) {
    if (state.isFetching) return;
    state.isFetching = true;

    try {
      const api    = await _getApi();
      const raw    = await api.getUserNotifications(userId);
      const cleaned = filterOldNotifications(raw || []);
      _applyData(cleaned);
    } catch (err) {
      console.error('[Notifications] فشل الجلب:', err);
      if (!state.notifications.length) {
        NotificationsView.renderError('تعذّر تحميل الإشعارات');
      }
    } finally {
      state.isFetching = false;
    }
  }

  // تطبيق بيانات جديدة على الحالة وتحديث الواجهة
  function _applyData(list) {
    // تحقق من وجود إشعارات جديدة لتشغيل الصوت
    const prevIds = new Set(state.notifications.map(n => n.id));
    const newOnes = list.filter(n => !n.read && !prevIds.has(n.id));
    const hasNew  = newOnes.length > 0;

    state.notifications = list;
    NotificationsFilter.buildFiltered();
    NotificationsBadge.update();

    if (NotificationsPanel.isOpen()) {
      NotificationsView.render();
    }
    if (hasNew) {
      playNotificationSound();
      // 🛠️ إصلاح ترابط: 'newNotification' كان مُستمَعاً إليه هنا وفي navbar.js لكن لا شيء
      // كان يُصدره فعلياً. نصدره الآن هنا بنفس شكل الحمولة (كائن إشعار مفرد) الذي يتوقعه
      // المستمع الموجود مسبقاً في _bindEventBus بهذا الملف، مع حارس تكرار موجود بالفعل هناك
      // يمنع أي إضافة مزدوجة للإشعار نفسه في state.notifications.
      newOnes.forEach(n => EventBus.emit('newNotification', n));
    }
  }

  // بدء الـ Polling الدوري
  function startPolling(userId) {
    stopPolling();
    // جلب فوري أول مرة
    fetch(userId);
    state.pollingTimer = setInterval(() => fetch(userId), CONFIG.POLL_INTERVAL_MS);
  }

  // إيقاف الـ Polling
  function stopPolling() {
    if (state.pollingTimer) {
      clearInterval(state.pollingTimer);
      state.pollingTimer = null;
    }
    state.isFetching = false;
  }

  // تعليم إشعار واحد كمقروء (يستخدم docId لـ Firestore)
  async function markRead(docId) {
    const api = await _getApi();
    await api.markNotificationRead(docId);
    // تحديث الحالة المحلية فوراً
    const notif = state.notifications.find(n => n.docId === docId);
    if (notif && !notif.read) {
      notif.read = true;
      NotificationsFilter.buildFiltered();
      NotificationsBadge.update();
    }
  }

  // تعليم جميع إشعارات المستخدم كمقروءة (batch محلي)
  async function markAllRead() {
    const api        = await _getApi();
    const unread     = state.notifications.filter(n => !n.read);
    if (!unread.length) return;

    // إذا كانت api.js توفر markAllNotificationsRead نستخدمها، وإلا نستخدم batch
    if (typeof api.markAllNotificationsRead === 'function') {
      await api.markAllNotificationsRead(state.userId);
    } else {
      await Promise.all(unread.map(n => api.markNotificationRead(n.docId).catch(() => {})));
    }

    state.notifications.forEach(n => { n.read = true; });
    NotificationsFilter.buildFiltered();
    NotificationsBadge.update();
    NotificationsView.render();
  }

  // حذف إشعار واحد
  async function remove(docId) {
    const api = await _getApi();
    await api.deleteNotification(docId);
    state.notifications = state.notifications.filter(n => n.docId !== docId);
    state.selectedIds.delete(docId);
    NotificationsFilter.buildFiltered();
    NotificationsBadge.update();
    NotificationsView.render();
  }

  // حذف الإشعارات المحددة
  async function removeSelected() {
    const api  = await _getApi();
    const docs = [...state.selectedIds];
    await Promise.all(docs.map(dId => api.deleteNotification(dId).catch(() => {})));
    state.notifications = state.notifications.filter(n => !state.selectedIds.has(n.docId));
    state.selectedIds.clear();
    NotificationsFilter.buildFiltered();
    NotificationsBadge.update();
    NotificationsView.render();
  }

  // حذف جميع إشعارات المستخدم
  async function clearAll(userId) {
    const api = await _getApi();
    await api.clearAllUserNotifications(userId);
    state.notifications = [];
    state.selectedIds.clear();
    NotificationsFilter.buildFiltered();
    NotificationsBadge.update();
    NotificationsView.render();
  }

  return { fetch, startPolling, stopPolling, markRead, markAllRead, remove, removeSelected, clearAll };
})();

// ============================================================
// 🔍 NotificationsFilter – الفلترة والتبويبات
// ============================================================
const NotificationsFilter = (() => {

  // التبويبات المرئية حسب دور المستخدم
  function getVisibleTabs(role) {
    return Object.entries(TABS_CONFIG).filter(([, cfg]) => cfg.roles.includes(role));
  }

  // بناء القائمة المفلترة وتخزينها في state.filteredList
  function buildFiltered() {
    const tabCfg = TABS_CONFIG[state.currentTab] || TABS_CONFIG.all;
    let list = state.notifications.filter(tabCfg.filter);

    // فلترة البحث
    const term = state.searchTerm.trim().toLowerCase();
    if (term) {
      list = list.filter(n =>
        (n.title   || '').toLowerCase().includes(term) ||
        (n.message || '').toLowerCase().includes(term)
      );
    }

    list = groupSimilarNotifications(list);

    // ترتيب: غير المقروء أولاً، ثم الأحدث
    list.sort((a, b) => {
      if (a.read !== b.read) return a.read ? 1 : -1;
      const ta = a.created_at?.seconds || 0;
      const tb = b.created_at?.seconds || 0;
      return tb - ta;
    });

    state.filteredList  = list;
    state.virtualOffset = 0;
  }

  // عدد غير المقروء في تبويب معين
  function getTabUnreadCount(tabKey) {
    const cfg = TABS_CONFIG[tabKey];
    if (!cfg) return 0;
    return state.notifications.filter(n => cfg.filter(n) && !n.read).length;
  }

  // بناء زر تبويب واحد
  function _buildTabBtn(key, cfg) {
    const unread = getTabUnreadCount(key);
    const btn    = document.createElement('button');
    btn.type                    = 'button';
    btn.dataset.notifTab        = key;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(key === state.currentTab));
    btn.className               = 'notifications-tab-btn' + (key === state.currentTab ? ' active' : '');

    const label = document.createElement('span');
    label.textContent = cfg.label;
    btn.appendChild(label);

    if (unread > 0) {
      const badge           = document.createElement('span');
      badge.className       = 'tab-unread-badge';
      badge.setAttribute('aria-label', `${unread} غير مقروء`);
      badge.textContent     = unread > 99 ? '99+' : String(unread);
      btn.appendChild(badge);
    }

    btn.addEventListener('click', () => switchTab(key));
    return btn;
  }

  // رسم جميع التبويبات
  function renderTabs() {
    if (!elems.tabsContainer || !state.userRole) return;
    const fragment = document.createDocumentFragment();
    getVisibleTabs(state.userRole).forEach(([key, cfg]) => {
      fragment.appendChild(_buildTabBtn(key, cfg));
    });
    elems.tabsContainer.innerHTML = '';
    elems.tabsContainer.appendChild(fragment);
  }

  // تحديث شارات التبويبات فقط (دون إعادة بناء كامل)
  function updateTabBadges() {
    if (!elems.tabsContainer) return;
    elems.tabsContainer.querySelectorAll('[data-notif-tab]').forEach(btn => {
      const key    = btn.dataset.notifTab;
      const unread = getTabUnreadCount(key);
      let badge    = btn.querySelector('.tab-unread-badge');
      if (unread > 0) {
        if (!badge) {
          badge           = document.createElement('span');
          badge.className = 'tab-unread-badge';
          btn.appendChild(badge);
        }
        badge.textContent = unread > 99 ? '99+' : String(unread);
        badge.setAttribute('aria-label', `${unread} غير مقروء`);
      } else if (badge) {
        badge.remove();
      }
    });
  }

  // التبديل بين التبويبات
  function switchTab(key) {
    if (!TABS_CONFIG[key]) return;
    state.currentTab = key;
    state.selectedIds.clear();

    elems.tabsContainer?.querySelectorAll('[data-notif-tab]').forEach(btn => {
      const active = btn.dataset.notifTab === key;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });

    buildFiltered();
    NotificationsView.render();
  }

  return { getVisibleTabs, buildFiltered, getTabUnreadCount, renderTabs, updateTabBadges, switchTab };
})();

// ============================================================
// 🖼️ NotificationsView – العرض مع Virtual Scrolling
// ============================================================
const NotificationsView = (() => {

  // بناء عنصر إشعار واحد
  function _buildItem(notif) {
    const { icon, color } = NOTIF_TYPES[notif.type] || NOTIF_TYPES.default;
    const isRead          = notif.read === true;
    const isSelected      = state.selectedIds.has(notif.docId);
    const count           = notif._groupCount;

    const article = document.createElement('article');
    article.className = 'notification-item' + (isRead ? '' : ' unread') + (isSelected ? ' selected' : '');
    article.dataset.docId = notif.docId;
    article.setAttribute('role', 'article');
    article.setAttribute('tabindex', '0');
    article.setAttribute('aria-label',       escapeHtml(notif.title || 'إشعار'));
    article.setAttribute('aria-description', escapeHtml(notif.message || ''));
    if (!isRead) article.setAttribute('aria-live', notif.type === 'alert' ? 'assertive' : 'polite');

    // ==== مربع التحديد ====
    const chk = document.createElement('input');
    chk.type      = 'checkbox';
    chk.className = 'notif-select-chk';
    chk.checked   = isSelected;
    chk.setAttribute('aria-label', 'تحديد الإشعار');
    article.appendChild(chk);

    // ==== الأيقونة ====
    const iconWrap           = document.createElement('div');
    iconWrap.className       = 'notification-icon';
    iconWrap.style.cssText   = `background:${color}20;color:${color};`;
    iconWrap.innerHTML       = `<i class="fas ${escapeHtml(icon)}" aria-hidden="true"></i>`;
    article.appendChild(iconWrap);

    // ==== المحتوى ====
    const body   = document.createElement('div');
    body.className = 'notification-body';

    const header = document.createElement('div');
    header.className = 'notification-header';

    const title = document.createElement('h4');
    title.className = 'notification-title';
    title.textContent = (count && count > 1) ? _groupedTitle(notif, count) : (notif.title || 'إشعار');
    header.appendChild(title);

    const timeEl = document.createElement('time');
    timeEl.className   = 'notification-time';
    timeEl.textContent = formatTime(notif.created_at);
    header.appendChild(timeEl);
    body.appendChild(header);

    if (!count || count <= 1) {
      const msg           = document.createElement('p');
      msg.className       = 'notification-message';
      msg.textContent     = notif.message || '';
      body.appendChild(msg);
    }

    // ==== أزرار الإجراءات ====
    const actions       = document.createElement('div');
    actions.className   = 'notification-actions';

    if (!isRead) {
      const markBtn = _createActionBtn('fa-check', 'تعليم كمقروء', 'mark-read-btn', notif.docId);
      actions.appendChild(markBtn);
    }

    const delBtn = _createActionBtn('fa-trash-alt', 'حذف', 'delete-btn', notif.docId);
    actions.appendChild(delBtn);

    body.appendChild(actions);
    article.appendChild(body);
    return article;
  }

  function _createActionBtn(iconClass, label, extraClass, docId) {
    const btn = document.createElement('button');
    btn.type  = 'button';
    btn.className          = `notif-action-btn ${extraClass}`;
    btn.dataset.docId      = docId;
    btn.title              = label;
    btn.setAttribute('aria-label', label);
    btn.style.minHeight    = '44px';
    btn.style.minWidth     = '44px';
    btn.innerHTML          = `<i class="fas ${escapeHtml(iconClass)}" aria-hidden="true"></i>`;
    return btn;
  }

  function _groupedTitle(notif, count) {
    if (notif.type === 'like')    return `${count} إعجاب جديد على درسك`;
    if (notif.type === 'comment') return `${count} تعليق جديد على درسك`;
    return notif.title || 'إشعارات متعددة';
  }

  // رسم نافذة Virtual Scrolling الحالية
  function render() {
    if (!elems.content) return;

    const list   = state.filteredList;
    const offset = state.virtualOffset;
    const end    = Math.min(offset + CONFIG.VIRTUAL_PAGE_SIZE, list.length);
    const slice  = list.slice(offset, end);

    if (list.length === 0) { _renderEmpty(); return; }

    const fragment = document.createDocumentFragment();

    // زر "السابق"
    if (offset > 0) {
      const prev       = document.createElement('button');
      prev.type        = 'button';
      prev.id          = 'notif-prev-page';
      prev.className   = 'notif-page-btn';
      prev.textContent = `← عرض السابق (${offset})`;
      fragment.appendChild(prev);
    }

    slice.forEach(n => fragment.appendChild(_buildItem(n)));

    // زر "المزيد"
    if (end < list.length) {
      const next       = document.createElement('button');
      next.type        = 'button';
      next.id          = 'notif-next-page';
      next.className   = 'notif-page-btn';
      next.textContent = `عرض المزيد (${list.length - end} متبقٍ)`;
      fragment.appendChild(next);
    }

    elems.content.innerHTML = '';
    elems.content.appendChild(fragment);
    _bindItemEvents();
    NotificationsFilter.updateTabBadges();
    _updateToolbar();
  }

  // تحديث جزئي لعنصر واحد (تجنب إعادة رسم كاملة)
  function partialUpdate(docId) {
    const itemEl = elems.content?.querySelector(`.notification-item[data-doc-id="${CSS.escape(docId)}"]`);
    if (!itemEl) { render(); return; }
    const notif = state.notifications.find(n => n.docId === docId);
    if (!notif) { render(); return; }
    itemEl.replaceWith(_buildItem(notif));
    _bindItemEvents();
  }

  function _renderEmpty() {
    const msg  = state.searchTerm ? 'لا توجد نتائج مطابقة' : 'لا توجد إشعارات';
    const wrap = document.createElement('div');
    wrap.className = 'notifications-empty';
    wrap.setAttribute('role', 'status');
    wrap.innerHTML = `<i class="fas fa-bell-slash" aria-hidden="true"></i><h4>${escapeHtml(msg)}</h4>`;
    elems.content.innerHTML = '';
    elems.content.appendChild(wrap);
  }

  // عرض Skeleton Loading
  function renderSkeleton() {
    if (!elems.content) return;
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 5; i++) {
      const sk = document.createElement('div');
      sk.className = 'notification-skeleton-item';
      sk.setAttribute('aria-hidden', 'true');
      sk.innerHTML = `
        <div class="sk-avatar"></div>
        <div class="sk-lines">
          <div class="sk-line"></div>
          <div class="sk-line sk-short"></div>
        </div>`;
      fragment.appendChild(sk);
    }
    elems.content.innerHTML = '';
    elems.content.appendChild(fragment);
  }

  // عرض حالة الخطأ مع زر إعادة المحاولة
  function renderError(msg) {
    if (!elems.content) return;
    const wrap = document.createElement('div');
    wrap.className = 'notifications-error';
    wrap.innerHTML = `<i class="fas fa-exclamation-triangle" aria-hidden="true"></i><p>${escapeHtml(msg)}</p>`;
    const retry       = document.createElement('button');
    retry.type        = 'button';
    retry.className   = 'retry-btn';
    retry.textContent = 'إعادة المحاولة';
    retry.addEventListener('click', () => {
      if (state.userId) {
        renderSkeleton();
        NotificationsData.fetch(state.userId);
      }
    });
    wrap.appendChild(retry);
    elems.content.innerHTML = '';
    elems.content.appendChild(wrap);
  }

  // ربط أحداث عناصر القائمة (event delegation)
  function _bindItemEvents() {
    if (!elems.content) return;

    // مربعات التحديد
    elems.content.querySelectorAll('.notif-select-chk').forEach(chk => {
      chk.addEventListener('change', e => {
        const docId = e.target.closest('.notification-item')?.dataset.docId;
        if (!docId) return;
        if (e.target.checked) state.selectedIds.add(docId);
        else state.selectedIds.delete(docId);
        e.target.closest('.notification-item')?.classList.toggle('selected', e.target.checked);
        _updateToolbar();
      });
    });

    // النقر على بطاقة الإشعار
    elems.content.querySelectorAll('.notification-item').forEach(item => {
      item.addEventListener('click', e => {
        if (e.target.closest('button') || e.target.closest('input')) return;
        const docId = item.dataset.docId;
        const notif = state.notifications.find(n => n.docId === docId);
        if (notif) _handleNotifClick(notif);
      });
      item.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); item.click(); }
      });
    });

    // أزرار تعليم كمقروء
    elems.content.querySelectorAll('.mark-read-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const docId = btn.dataset.docId;
        try {
          await NotificationsData.markRead(docId);
          partialUpdate(docId);
        } catch (_e) { showToast('فشل تعليم الإشعار', 'error'); }
      });
    });

    // أزرار الحذف
    elems.content.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        try {
          await NotificationsData.remove(btn.dataset.docId);
        } catch (_e) { showToast('فشل حذف الإشعار', 'error'); }
      });
    });

    // أزرار التنقل بين صفحات Virtual Scrolling
    document.getElementById('notif-prev-page')?.addEventListener('click', () => {
      state.virtualOffset = Math.max(0, state.virtualOffset - CONFIG.VIRTUAL_PAGE_SIZE);
      render();
    });
    document.getElementById('notif-next-page')?.addEventListener('click', () => {
      state.virtualOffset = Math.min(
        state.filteredList.length - 1,
        state.virtualOffset + CONFIG.VIRTUAL_PAGE_SIZE
      );
      render();
    });
  }

  // التنقل عند النقر على إشعار مرتبط بمحتوى
  function _handleNotifClick(notif) {
    if (!notif.read) NotificationsData.markRead(notif.docId).catch(() => {});

    // الحقول الصحيحة مطابقة لما يُعيده api.js
    let route  = null;
    let params = {};
    if (notif.related_lesson) { route = 'lesson-view'; params = { id: notif.related_lesson }; }
    else if (notif.related_exam) { route = 'exam-view'; params = { id: notif.related_exam };  }

    if (route && window.router?.navigateTo) {
      NotificationsPanel.close();
      window.router.navigateTo(route, params);
    }
  }

  // تحديث شريط أدوات التحديد
  function _updateToolbar() {
    const count = state.selectedIds.size;
    const total = state.filteredList.length;

    if (elems.deleteSel) {
      elems.deleteSel.disabled    = count === 0;
      elems.deleteSel.textContent = count > 0 ? `حذف المحدد (${count})` : 'حذف المحدد';
    }
    if (elems.selectAllChk) {
      elems.selectAllChk.indeterminate = count > 0 && count < total;
      elems.selectAllChk.checked       = total > 0 && count === total;
    }
  }

  return { render, renderSkeleton, renderError, partialUpdate };
})();

// ============================================================
// 🔔 NotificationsBadge – شارة العداد
// ============================================================
const NotificationsBadge = (() => {
  function update() {
    const count = state.notifications.filter(n => !n.read).length;

    if (elems.badge) {
      if (count > 0) {
        elems.badge.textContent  = count > 99 ? '99+' : String(count);
        elems.badge.style.display = 'inline-flex';
        elems.badge.setAttribute('aria-label', `${count} إشعار جديد`);
      } else {
        elems.badge.textContent  = '';
        elems.badge.style.display = 'none';
        elems.badge.setAttribute('aria-label', 'لا توجد إشعارات جديدة');
      }
    }

    // إعلام navbar بالعدد
    // 🛠️ إصلاح ترابط: navbar.js كان يستمع لاسم مختلف ('notifications:countUpdated')
    // ولم يكن هذا الاسم يُصدَر بنفس الصياغة؛ تم توحيد الاسم على الطراز الموحّد across المشروع.
    EventBus.emit('notifications:countChanged', { count });
  }

  return { update };
})();

// ============================================================
// 🚪 NotificationsPanel – إدارة اللوحة
// ============================================================
const NotificationsPanel = (() => {

  let _focusTrapActive = false;

  function isOpen() {
    return elems.panel?.classList.contains('open') ?? false;
  }

  function open() {
    if (!elems.panel || isOpen()) return;

    elems.panel.classList.add('open');
    elems.panel.setAttribute('aria-hidden', 'false');
    elems.trigger?.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';

    // تحديث وعرض
    NotificationsFilter.buildFiltered();
    NotificationsView.render();

    // Focus Trap
    _activateFocusTrap();

    // الإغلاق بالنقر خارج اللوحة
    _listeners.outsideClick = e => {
      if (!elems.panel.contains(e.target) && !elems.trigger?.contains(e.target)) close();
    };
    setTimeout(() => document.addEventListener('click', _listeners.outsideClick), 0);

    // Esc + Focus Trap
    _listeners.panelKeydown = e => {
      if (e.key === 'Escape') { e.preventDefault(); close(); elems.trigger?.focus(); }
      if (_focusTrapActive) _handleFocusTrap(e);
    };
    document.addEventListener('keydown', _listeners.panelKeydown);

    // Swipe لأسفل لإغلاق على الجوال
    _initSwipe();

    // نقل التركيز لأول عنصر
    requestAnimationFrame(() => { _getFocusableEls()[0]?.focus(); });
  }

  function close() {
    if (!elems.panel || !isOpen()) return;

    elems.panel.classList.remove('open');
    elems.panel.setAttribute('aria-hidden', 'true');
    elems.trigger?.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';

    _deactivateFocusTrap();
    document.removeEventListener('click',   _listeners.outsideClick);
    document.removeEventListener('keydown', _listeners.panelKeydown);
    _removeSwipe();
  }

  function toggle() { isOpen() ? close() : open(); }

  // ==== Focus Trap ====
  function _getFocusableEls() {
    return Array.from(elems.panel.querySelectorAll(
      'button:not([disabled]),input:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])'
    ));
  }

  function _activateFocusTrap()   { _focusTrapActive = true;  }
  function _deactivateFocusTrap() { _focusTrapActive = false; }

  function _handleFocusTrap(e) {
    if (e.key !== 'Tab') return;
    const focusable = _getFocusableEls();
    if (!focusable.length) { e.preventDefault(); return; }
    const first = focusable[0];
    const last  = focusable[focusable.length - 1];
    if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } }
    else             { if (document.activeElement === last)  { e.preventDefault(); first.focus(); } }
  }

  // ==== Swipe to Close ====
  function _initSwipe() {
    if (!elems.panel) return;
    _listeners.swipeTouchStart = e => { _swipeStartY   = e.touches[0].clientY; };
    _listeners.swipeTouchMove  = e => { _swipeCurrentY = e.touches[0].clientY; };
    _listeners.swipeTouchEnd   = () => {
      if (_swipeCurrentY - _swipeStartY > CONFIG.SWIPE_THRESHOLD) close();
      _swipeStartY = _swipeCurrentY = 0;
    };
    elems.panel.addEventListener('touchstart', _listeners.swipeTouchStart, { passive: true });
    elems.panel.addEventListener('touchmove',  _listeners.swipeTouchMove,  { passive: true });
    elems.panel.addEventListener('touchend',   _listeners.swipeTouchEnd);
  }

  function _removeSwipe() {
    elems.panel?.removeEventListener('touchstart', _listeners.swipeTouchStart);
    elems.panel?.removeEventListener('touchmove',  _listeners.swipeTouchMove);
    elems.panel?.removeEventListener('touchend',   _listeners.swipeTouchEnd);
  }

  return { isOpen, open, close, toggle };
})();

// ============================================================
// 🎛️ التهيئة والتنظيف
// ============================================================

// تخزين مراجع عناصر DOM
function _cacheElements() {
  elems.panel         = document.getElementById(CONFIG.PANEL_ID);
  elems.badge         = document.getElementById(CONFIG.BADGE_ID);
  elems.trigger       = document.getElementById(CONFIG.TRIGGER_BTN_ID);
  elems.content       = document.getElementById(CONFIG.CONTENT_ID);
  elems.tabsContainer = document.querySelector(CONFIG.TABS_SELECTOR);
  elems.searchInput   = document.getElementById(CONFIG.SEARCH_INPUT_ID);
  elems.selectAllChk  = document.getElementById(CONFIG.SELECT_ALL_ID);
  elems.deleteSel     = document.getElementById(CONFIG.DELETE_SELECTED_ID);
  elems.markAllRead   = document.getElementById(CONFIG.MARK_ALL_READ_ID);
  elems.closeBtn      = document.getElementById(CONFIG.CLOSE_BTN_ID);
}

// ربط أحداث الأزرار الثابتة
function _bindStaticEvents() {

  // ==== زر فتح/إغلاق اللوحة ====
  elems.trigger?.addEventListener('click', e => {
    e.stopPropagation();
    NotificationsPanel.toggle();
  });

  // ==== زر إغلاق اللوحة ====
  elems.closeBtn?.addEventListener('click', () => NotificationsPanel.close());

  // ==== البحث الفوري ====
  elems.searchInput?.addEventListener('input', e => {
    state.searchTerm = e.target.value;
    NotificationsFilter.buildFiltered();
    NotificationsView.render();
  });

  // ==== تحديد الكل ====
  elems.selectAllChk?.addEventListener('change', e => {
    if (e.target.checked) state.filteredList.forEach(n => state.selectedIds.add(n.docId));
    else state.selectedIds.clear();
    NotificationsView.render();
  });

  // ==== حذف المحدد ====
  elems.deleteSel?.addEventListener('click', async () => {
    if (!state.selectedIds.size) return;
    const ok = await confirmDialog(`حذف ${state.selectedIds.size} إشعار محدد؟`);
    if (!ok) return;
    try {
      await NotificationsData.removeSelected();
      showToast('تم حذف الإشعارات المحددة', 'success');
    } catch (_e) { showToast('فشل الحذف', 'error'); }
  });

  // ==== تعليم الكل كمقروء ====
  elems.markAllRead?.addEventListener('click', async () => {
    try {
      await NotificationsData.markAllRead();
      showToast('تم تعليم جميع الإشعارات كمقروءة', 'success');
    } catch (_e) { showToast('فشل التعليم', 'error'); }
  });

  // ==== اختصار لوحة المفاتيح Ctrl+Shift+N ====
  _listeners.globalKeydown = e => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === CONFIG.KEYBOARD_SHORTCUT) {
      e.preventDefault();
      NotificationsPanel.toggle();
    }
  };
  document.addEventListener('keydown', _listeners.globalKeydown);

  // ==== Page Visibility – جلب عند العودة للصفحة ====
  _listeners.visibilityChange = () => {
    if (document.visibilityState === 'visible' && state.userId) {
      NotificationsData.fetch(state.userId);
    }
  };
  document.addEventListener('visibilitychange', _listeners.visibilityChange);
}

// ربط أحداث EventBus (مع تخزين دوال الإلغاء)
function _bindEventBus() {

  // ==== تغيير حالة المستخدم (login/logout) ====
  const unsubUserState = EventBus.on('userStateChanged', detail => {
    if (detail?.action === 'login') {
      const user     = detail.user;
      state.userId   = user?.id        || null;
      state.userRole = user?.user_type || 'student';
      NotificationsFilter.renderTabs();
      NotificationsFilter.buildFiltered();
      if (state.userId) {
        NotificationsView.renderSkeleton();
        NotificationsData.startPolling(state.userId);
      }
    } else if (detail?.action === 'logout') {
      NotificationsData.stopPolling();
      state.userId        = null;
      state.userRole      = null;
      state.notifications = [];
      state.selectedIds.clear();
      NotificationsBadge.update();
      NotificationsFilter.renderTabs();
      if (NotificationsPanel.isOpen()) NotificationsPanel.close();
    }
  });
  _eventUnsubs.push(unsubUserState);

  // ==== إشعار جديد من api.js أو Service Worker ====
  const unsubNewNotif = EventBus.on('newNotification', notification => {
    if (!notification || !state.userId) return;
    if (state.notifications.some(n => n.id === notification.id)) return;

    // التأكد من وجود docId (يُرفق من المُرسل)
    state.notifications.unshift(notification);
    NotificationsFilter.buildFiltered();
    NotificationsBadge.update();
    if (NotificationsPanel.isOpen()) NotificationsView.render();
    if (!notification.read) playNotificationSound();
  });
  _eventUnsubs.push(unsubNewNotif);
}

// ============================================================
// 🚀 الدوال المُصدَّرة
// ============================================================

// تهيئة نظام الإشعارات (تُستدعى من main.js)
export function initializeNotifications() {
  if (state.initialized) return true;

  console.log('[Notifications] بدء التهيئة v5.0.0...');

  _cacheElements();

  if (!elems.panel || !elems.content) {
    console.warn('[Notifications] العناصر الأساسية (panel/content) غير موجودة في DOM');
    return false;
  }

  _bindStaticEvents();
  _bindEventBus();

  // إذا كان المستخدم مسجل الدخول قبل التهيئة
  const user = getCurrentUser();
  if (user?.id) {
    state.userId   = user.id;
    state.userRole = user.user_type || 'student';
    NotificationsFilter.renderTabs();
    NotificationsFilter.buildFiltered();
    NotificationsView.renderSkeleton();
    NotificationsData.startPolling(user.id);
  } else {
    NotificationsBadge.update();
  }

  state.initialized = true;
  console.log('[Notifications] ✅ تم التهيئة');
  return true;
}

// تنظيف كامل للنظام (تُستدعى عند تفكيك التطبيق)
export function destroyNotifications() {
  NotificationsData.stopPolling();

  // إلغاء اشتراكات EventBus
  _eventUnsubs.forEach(fn => fn());
  _eventUnsubs.length = 0;

  // إزالة مستمعي document
  document.removeEventListener('keydown',         _listeners.globalKeydown);
  document.removeEventListener('keydown',         _listeners.panelKeydown);
  document.removeEventListener('click',           _listeners.outsideClick);
  document.removeEventListener('visibilitychange', _listeners.visibilityChange);

  // إزالة مستمعي اللوحة
  if (elems.panel) {
    elems.panel.removeEventListener('touchstart', _listeners.swipeTouchStart);
    elems.panel.removeEventListener('touchmove',  _listeners.swipeTouchMove);
    elems.panel.removeEventListener('touchend',   _listeners.swipeTouchEnd);
  }

  // تنظيف مراجع DOM
  Object.keys(elems).forEach(k => { elems[k] = null; });

  // إعادة ضبط الحالة
  state.notifications  = [];
  state.filteredList   = [];
  state.selectedIds.clear();
  state.userId         = null;
  state.userRole       = null;
  state.initialized    = false;
  state.isFetching     = false;
  state.pollingTimer   = null;
  _apiRef              = null;

  console.log('[Notifications] تم التنظيف الكامل');
}

// ==== الواجهة العامة ====
export const notificationsAPI = {
  open:          () => NotificationsPanel.open(),
  close:         () => NotificationsPanel.close(),
  toggle:        () => NotificationsPanel.toggle(),
  refresh:       () => state.userId && NotificationsData.fetch(state.userId),
  getUnreadCount: () => state.notifications.filter(n => !n.read).length,
  clearAll: async () => {
    if (!state.userId) return;
    const ok = await confirmDialog('حذف جميع الإشعارات؟');
    if (!ok) return;
    try {
      await NotificationsData.clearAll(state.userId);
      showToast('تم حذف جميع الإشعارات', 'success');
    } catch (_e) { showToast('فشل الحذف', 'error'); }
  },
};

// تعريض الواجهة على window للوصول من ملفات أخرى
window.notificationsAPI = notificationsAPI;

export default {
  initialize: initializeNotifications,
  destroy:    destroyNotifications,
  ...notificationsAPI,
};