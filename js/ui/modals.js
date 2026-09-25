/**
 * 🪟 js/ui/modals.js - نظام النوافذ والإشعارات المرئية المركزي v5.0.0 (نسخة التمركز المثالي)
 * ============================================================================
 * 📝 المسؤولية: الواجهة الموحدة لجميع التفاعلات البصرية مع المستخدم
 * 🏗️ العمارة: Module Pattern مع فصل واضح للمسؤوليات:
 *   - [Toast System]    : إشعارات مؤقتة مستقلة (تعمل في كل الظروف)
 *   - [Dialog Layer]    : طبقة تمركز موحّدة (Flex Centering) لجميع أنواع النوافذ
 *   - [Modal Core]      : محرك النوافذ مع Queue وإدارة التركيز
 *   - [Modal Types]     : confirm, alert, prompt, info, loading, imagePreview, bottomSheet, showModal
 *   - [Size System]     : مقياس أحجام موحّد (sm / md / lg / fullscreen) قابل للتخصيص لكل نوع
 *   - [Focus Manager]   : Focus Trap وإدارة التركيز (متوافق مع RTL)
 *   - [EventBus Bridge] : تكامل مع event-bus.js
 *   - [Responsive]      : تصميم متجاوب بالكامل مع تحسينات اللمس

 * ============================================================================
 */

// ====== 1. الثوابت والتكوين ======
const MODALS_CONFIG = Object.freeze({
  TOAST_DURATION: 4000,
  TOAST_MAX: 5,
  TOAST_CONTAINER_ID: 'modals-toast-container',
  LOADING_OVERLAY_ID: 'modals-loading-overlay',
  ANIMATION_DURATION: 250,
  Z_INDEX_MODAL: 9000,
  Z_INDEX_TOAST: 9500,
  Z_INDEX_LOADING: 9800,
  SWIPE_THRESHOLD: 80,
});

// أيقونات أنواع النوافذ والتوستات
const TYPE_ICONS = Object.freeze({
  success: 'fa-check-circle',
  info: 'fa-info-circle',
  warning: 'fa-exclamation-triangle',
  error: 'fa-times-circle',
  danger: 'fa-skull-crossbones',
});

// خريطة الأحجام الموحّدة لجميع أنواع النوافذ (sm / md / lg / fullscreen)
const SIZE_MAP = Object.freeze({
  small: 'sm', sm: 'sm',
  medium: 'md', md: 'md',
  large: 'lg', lg: 'lg',
  fullscreen: 'fullscreen',
});

/** تحويل أي قيمة حجم مُمرَّرة من المستخدم إلى الكلاس الموحّد المعتمد في modals.css */
function _resolveSize(size) {
  return SIZE_MAP[size] || 'md';
}

// ====== 2. الحالة الداخلية ======
const _state = {
  queue: [],
  activeModal: null,
  modalStack: [],
  toastTimers: new Map(),
  activeToasts: [],
  loadingOverlay: null,
  busUnsubscribers: [],
  returnFocusEl: null,
  _idCounter: 0,
  isInitialized: false,
};

// ====== 3. دوال الأمان ======

/** تهريب HTML لمنع XSS */
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** تنظيف HTML مع إزالة العناصر الخطرة */
function sanitizeHtml(html) {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<[^>]+\s+on\w+\s*=\s*["'][^"']*["'][^>]*>/gi, (match) =>
      match.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '')
    )
    .replace(/javascript\s*:/gi, '');
}

/** توليد ID فريد */
function _genId(prefix = 'modal') {
  return `${prefix}-${++_state._idCounter}-${Date.now()}`;
}

/** الحصول على الثيم الحالي (نهاري/ليلي) */
function _getCurrentTheme() {
  return document.body.getAttribute('data-theme') || 'light';
}

// ====== 4. Toast System ======

/** إنشاء حاوية الـ Toast إذا لم تكن موجودة */
function _ensureToastContainer() {
  let container = document.getElementById(MODALS_CONFIG.TOAST_CONTAINER_ID);
  if (!container) {
    container = document.createElement('div');
    container.id = MODALS_CONFIG.TOAST_CONTAINER_ID;
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'false');
    container.setAttribute('role', 'region');
    container.setAttribute('aria-label', 'الإشعارات');
    document.body.appendChild(container);
  }
  return container;
}

/**
 * عرض Toast مؤقت
 * @param {string} message - الرسالة
 * @param {string} type    - success | info | warning | error
 * @param {number} duration - المدة (مللي ثانية) - اختياري
 */
function toast(message, type = 'info', duration = MODALS_CONFIG.TOAST_DURATION) {
  const container = _ensureToastContainer();

  // إذا تجاوزنا الحد الأقصى، أزل الأقدم
  if (_state.activeToasts.length >= MODALS_CONFIG.TOAST_MAX) {
    const oldestId = _state.activeToasts[0];
    _removeToast(oldestId);
  }

  const id = _genId('toast');
  const icon = TYPE_ICONS[type] || TYPE_ICONS.info;

  // تحديث aria-live حسب النوع
  container.setAttribute('aria-live', type === 'error' || type === 'warning' ? 'assertive' : 'polite');

  const el = document.createElement('div');
  el.id = id;
  el.className = `modals-toast modals-toast--${type}`;
  el.setAttribute('role', 'alert');
  el.setAttribute('dir', 'rtl');
  el.innerHTML = `
    <i class="fas ${icon} modals-toast__icon" aria-hidden="true"></i>
    <span class="modals-toast__message">${escapeHtml(message)}</span>
    <button class="modals-toast__close" aria-label="إغلاق الإشعار" data-toast-id="${id}">
      <i class="fas fa-times" aria-hidden="true"></i>
    </button>
    <div class="modals-toast__progress" style="animation-duration: ${duration}ms"></div>
  `;

  // زر الإغلاق
  el.querySelector('.modals-toast__close').addEventListener('click', () => _removeToast(id));

  container.appendChild(el);
  _state.activeToasts.push(id);

  // تشغيل animation الدخول
  requestAnimationFrame(() => {
    requestAnimationFrame(() => el.classList.add('modals-toast--visible'));
  });

  // مؤقت الاختفاء التلقائي
  const timerId = setTimeout(() => _removeToast(id), duration);
  _state.toastTimers.set(id, timerId);

  // إصدار حدث
  _emitEvent('toast:shown', { message, type });

  return id;
}

/** إزالة Toast بناءً على ID */
function _removeToast(id) {
  const el = document.getElementById(id);
  if (!el) return;

  // إلغاء المؤقت
  const timerId = _state.toastTimers.get(id);
  if (timerId) {
    clearTimeout(timerId);
    _state.toastTimers.delete(id);
  }

  // إزالة من قائمة النشطة
  _state.activeToasts = _state.activeToasts.filter(t => t !== id);

  // animation الخروج
  el.classList.add('modals-toast--hiding');
  setTimeout(() => {
    if (el.parentNode) el.remove();
  }, MODALS_CONFIG.ANIMATION_DURATION);
}

// ====== 5. Focus Manager ======

/** الحصول على جميع العناصر القابلة للتركيز داخل container */
function _getFocusable(container) {
  return Array.from(container.querySelectorAll(
    'a[href], button:not([disabled]), textarea:not([disabled]), ' +
    'input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
    '[tabindex]:not([tabindex="-1"])'
  )).filter(el => !el.closest('[hidden]') && !el.closest('[aria-hidden="true"]'));
}

/** تطبيق Focus Trap داخل عنصر */
function _trapFocus(container) {
  const handler = (e) => {
    if (e.key !== 'Tab') return;
    const focusable = _getFocusable(container);
    if (!focusable.length) { e.preventDefault(); return; }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener('keydown', handler);
  return handler;
}

/** حفظ التركيز الحالي والانتقال للنافذة */
function _saveFocusAndMove(container) {
  _state.returnFocusEl = document.activeElement;
  const focusable = _getFocusable(container);
  if (focusable.length) {
    setTimeout(() => focusable[0].focus(), 50);
  }
}

/** إعادة التركيز للعنصر الأصلي */
function _restoreFocus() {
  if (_state.returnFocusEl && typeof _state.returnFocusEl.focus === 'function') {
    _state.returnFocusEl.focus();
    _state.returnFocusEl = null;
  }
}

// ====== 6. Backdrop ======

/** إنشاء أو الحصول على الـ Backdrop */
function _getOrCreateBackdrop() {
  let backdrop = document.getElementById('modals-backdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'modals-backdrop';
    backdrop.className = 'modals-backdrop';
    document.body.appendChild(backdrop);
  }
  return backdrop;
}

/** عرض الـ Backdrop */
function _showBackdrop(onClickCallback = null) {
  const backdrop = _getOrCreateBackdrop();
  backdrop.onclick = onClickCallback;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => backdrop.classList.add('modals-backdrop--visible'));
  });
}

/** إخفاء الـ Backdrop */
function _hideBackdrop() {
  const backdrop = document.getElementById('modals-backdrop');
  if (!backdrop) return;
  backdrop.classList.remove('modals-backdrop--visible');
  backdrop.onclick = null;
}

/** إنشاء أو الحصول على طبقة تمركز النوافذ (Dialog Centering Layer) */
function _ensureDialogLayer() {
  let layer = document.getElementById('modals-dialog-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'modals-dialog-layer';
    layer.className = 'modals-layer';
    document.body.appendChild(layer);
  }
  return layer;
}

// ====== 7. Modal Core Engine ======

/**
 * فتح نافذة (المحرك الرئيسي)
 */
function _openModal(config) {
  if (_state.activeModal) {
    const priorities = { urgent: 0, high: 1, normal: 2 };
    const newPriority = priorities[config.priority || 'normal'] ?? 2;
    const insertIndex = _state.queue.findIndex(item => {
      return (priorities[item.priority || 'normal'] ?? 2) > newPriority;
    });
    if (insertIndex === -1) {
      _state.queue.push(config);
    } else {
      _state.queue.splice(insertIndex, 0, config);
    }
    return;
  }
  _renderModal(config);
}

/** عرض النافذة في DOM */
function _renderModal(config) {
  _state.activeModal = config;
  document.body.classList.add('modals-body-locked');

  // تطبيق Focus Trap على body (سيكون أكثر دقة عند عرض العنصر)
  config._trapHandler = _trapFocus(document.body);

  // حفظ التركيز الحالي
  _state.returnFocusEl = document.activeElement;

  // التركيز على أول عنصر قابل للتركيز داخل النافذة
  const el = document.getElementById(config._id);
  if (el) {
    const focusable = _getFocusable(el);
    if (focusable.length) {
      setTimeout(() => focusable[0].focus(), 60);
    }
  }

  _emitEvent('modal:opened', { type: config.type, id: config._id });
}

/** إغلاق النافذة الحالية وتشغيل التالية في القائمة */
function _closeActiveModal(result = undefined) {
  if (!_state.activeModal) return;

  const config = _state.activeModal;
  const el = document.getElementById(config._id);

  // إزالة Focus Trap
  if (config._trapHandler) {
    document.removeEventListener('keydown', config._trapHandler);
  }

  // إزالة الـ Escape listener
  if (config._escHandler) {
    document.removeEventListener('keydown', config._escHandler);
  }

  // تشغيل animation الخروج
  if (el) {
    el.classList.add('modals-dialog--hiding');
    setTimeout(() => {
      if (el.parentNode) el.remove();
    }, MODALS_CONFIG.ANIMATION_DURATION);
  }

  _state.activeModal = null;
  document.body.classList.remove('modals-body-locked');
  _hideBackdrop();
  _restoreFocus();

  _emitEvent('modal:closed', { type: config.type, id: config._id, result });

  // فتح التالي في القائمة
  if (_state.queue.length > 0) {
    const next = _state.queue.shift();
    setTimeout(() => _renderModal(next), 150);
  }
}

// ====== 7.1 محرك التراكب (Modal Stack) ======
// 🆕 مستقل عن activeModal/queue: يسمح بفتح نافذة "فوق" نافذة سابقة مع بقاء
// الأخيرة حيّة في الـ DOM (معتّمة ومعطّلة التفاعل) بدل إغلاقها، إلى أن يتم
// الرجوع إليها (pop) أو إغلاق المكدّس بالكامل دفعة واحدة بعد الحفظ النهائي

function _pushStackedModal(entry) {
  const prevTop = _state.modalStack[_state.modalStack.length - 1];
  if (prevTop) {
    const prevEl = document.getElementById(prevTop._id);
    if (prevEl) {
      prevEl.classList.add('modals-dialog--stacked-behind');
      prevEl.setAttribute('inert', '');
      prevEl.setAttribute('aria-hidden', 'true');
    }
    if (prevTop._trapHandler) document.removeEventListener('keydown', prevTop._trapHandler);
  } else {
    // أول نافذة في المكدّس - قفل الـ body وحفظ نقطة التركيز الأصلية مرة واحدة فقط
    document.body.classList.add('modals-body-locked');
    _state.returnFocusEl = document.activeElement;
  }
  _state.modalStack.push(entry);
  _emitEvent('modal:opened', { type: 'stacked', id: entry._id });
}

/** إزالة أعلى نافذة في المكدّس وكشف التي تحتها، أو تنظيف كامل لو كانت الوحيدة */
function _popStackedModal(result) {
  const top = _state.modalStack.pop();
  if (!top) return;

  const el = document.getElementById(top._id);
  if (top._escHandler) document.removeEventListener('keydown', top._escHandler);
  if (top._trapHandler) document.removeEventListener('keydown', top._trapHandler);
  if (el) {
    el.classList.add('modals-dialog--hiding');
    setTimeout(() => { if (el.parentNode) el.remove(); }, MODALS_CONFIG.ANIMATION_DURATION);
  }

  const newTop = _state.modalStack[_state.modalStack.length - 1];
  if (newTop) {
    const newTopEl = document.getElementById(newTop._id);
    if (newTopEl) {
      newTopEl.classList.remove('modals-dialog--stacked-behind');
      newTopEl.removeAttribute('inert');
      newTopEl.removeAttribute('aria-hidden');
      newTop._trapHandler = _trapFocus(newTopEl);
      setTimeout(() => {
        const focusable = _getFocusable(newTopEl);
        if (focusable.length) focusable[0]?.focus();
      }, MODALS_CONFIG.ANIMATION_DURATION + 20);
    }
  } else {
    // المكدّس فاضي بالكامل الآن
    _hideBackdrop();
    document.body.classList.remove('modals-body-locked');
    _restoreFocus();
  }

  _emitEvent('modal:closed', { type: 'stacked', id: top._id, result });
}

/** إغلاق كل طبقات المكدّس دفعة واحدة (تُستخدم من closeAll وبعد نجاح الحفظ النهائي) */
function _clearModalStack() {
  if (!_state.modalStack.length) return;
  _state.modalStack.forEach(entry => {
    const el = document.getElementById(entry._id);
    if (el) el.remove();
    if (entry._escHandler) document.removeEventListener('keydown', entry._escHandler);
    if (entry._trapHandler) document.removeEventListener('keydown', entry._trapHandler);
  });
  _state.modalStack = [];
}

/** إضافة مستمع Escape لإغلاق النافذة */
function _addEscapeListener(onClose, canClose = true) {
  if (!canClose) return null;
  const handler = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };
  document.addEventListener('keydown', handler);
  return handler;
}

/** إنشاء عنصر النافذة الأساسي */
function _createDialogElement(id, className, role = 'dialog', size = 'md') {
  const el = document.createElement('div');
  el.id = id;
  el.className = `modals-dialog modals-dialog--${_resolveSize(size)} ${className}`.trim();
  el.setAttribute('role', role);
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('dir', 'rtl');
  // تطبيق الثيم الحالي
  el.setAttribute('data-theme', _getCurrentTheme());
  return el;
}

// ====== 8. نوافذ قابلة للاستخدام ======

// ---- 8.1 Confirm Modal ----
function confirm(options = {}) {
  return new Promise((resolve) => {
    const id = _genId('confirm');
    const {
      title = 'تأكيد',
      message = '',
      confirmText = 'تأكيد',
      cancelText = 'إلغاء',
      type: typeOption,
      confirmType,      // ==== [إصلاح] alias شائع الاستخدام بدلاً من type ====
      closeOnBackdrop = true,
      onConfirm,
      onCancel,
      priority = 'normal',
      size = 'sm',
    } = options;
    const type = typeOption || confirmType || 'default';

    const el = _createDialogElement(id, `modals-confirm modals-confirm--${type}`, 'dialog', size);
    el.setAttribute('aria-labelledby', `${id}-title`);
    el.setAttribute('aria-describedby', `${id}-message`);

    el.innerHTML = `
      <div class="modals-dialog__header">
        <h2 id="${id}-title" class="modals-dialog__title">${escapeHtml(title)}</h2>
        ${closeOnBackdrop ? `<button class="modals-dialog__close-x" aria-label="إغلاق" type="button"><i class="fas fa-times" aria-hidden="true"></i></button>` : ''}
      </div>
      <div class="modals-dialog__body">
        <p id="${id}-message" class="modals-dialog__message">${escapeHtml(message)}</p>
      </div>
      <div class="modals-dialog__footer">
        <button class="modals-btn modals-btn--secondary modals-btn--cancel" type="button">${escapeHtml(cancelText)}</button>
        <button class="modals-btn modals-btn--${type === 'danger' ? 'danger' : 'primary'} modals-btn--confirm" type="button">${escapeHtml(confirmText)}</button>
      </div>
    `;

    const doClose = (result) => {
      el.classList.add('modals-dialog--hiding');
      setTimeout(() => {
        if (el.parentNode) el.remove();
        _closeActiveModal(result);
        resolve(result);
        if (result && onConfirm) onConfirm();
        if (!result && onCancel) onCancel();
      }, MODALS_CONFIG.ANIMATION_DURATION);
    };

    el.querySelector('.modals-btn--confirm').addEventListener('click', () => doClose(true));
    el.querySelector('.modals-btn--cancel').addEventListener('click', () => doClose(false));
    const closeBtn = el.querySelector('.modals-dialog__close-x');
    if (closeBtn) closeBtn.addEventListener('click', () => doClose(false));

    _ensureDialogLayer().appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('modals-dialog--visible')));

    const backdropClose = closeOnBackdrop ? () => doClose(false) : null;
    _showBackdrop(backdropClose);
    const escHandler = _addEscapeListener(() => doClose(false), closeOnBackdrop);

    _openModal({
      _id: id,
      type: 'confirm',
      priority,
      _escHandler: escHandler,
      _trapHandler: _trapFocus(el),
    });

    _state.returnFocusEl = document.activeElement;
    setTimeout(() => {
      const focusable = _getFocusable(el);
      if (focusable.length) focusable[focusable.length - 1]?.focus();
    }, 60);
  });
}

// ---- 8.2 Alert Modal ----
function alert(options = {}) {
  return new Promise((resolve) => {
    const id = _genId('alert');
    const {
      title = 'تنبيه',
      message = '',
      type = 'info',
      confirmText = 'موافق',
      priority = 'normal',
      size = 'sm',
    } = options;

    const icon = TYPE_ICONS[type] || TYPE_ICONS.info;

    const el = _createDialogElement(id, `modals-alert modals-alert--${type}`, 'alertdialog', size);
    el.setAttribute('aria-labelledby', `${id}-title`);
    el.setAttribute('aria-describedby', `${id}-message`);

    el.innerHTML = `
      <div class="modals-dialog__icon-wrap">
        <i class="fas ${icon} modals-dialog__type-icon modals-dialog__type-icon--${type}" aria-hidden="true"></i>
      </div>
      <div class="modals-dialog__header">
        <h2 id="${id}-title" class="modals-dialog__title">${escapeHtml(title)}</h2>
        <button class="modals-dialog__close-x" aria-label="إغلاق" type="button"><i class="fas fa-times" aria-hidden="true"></i></button>
      </div>
      <div class="modals-dialog__body">
        <p id="${id}-message" class="modals-dialog__message">${escapeHtml(message)}</p>
      </div>
      <div class="modals-dialog__footer">
        <button class="modals-btn modals-btn--primary modals-btn--confirm" type="button">${escapeHtml(confirmText)}</button>
      </div>
    `;

    const doClose = () => {
      el.classList.add('modals-dialog--hiding');
      setTimeout(() => {
        if (el.parentNode) el.remove();
        _closeActiveModal();
        resolve();
      }, MODALS_CONFIG.ANIMATION_DURATION);
    };

    el.querySelector('.modals-btn--confirm').addEventListener('click', doClose);
    el.querySelector('.modals-dialog__close-x').addEventListener('click', doClose);

    _ensureDialogLayer().appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('modals-dialog--visible')));
    _showBackdrop(doClose);
    const escHandler = _addEscapeListener(doClose, true);

    _openModal({
      _id: id,
      type: 'alert',
      priority,
      _escHandler: escHandler,
      _trapHandler: _trapFocus(el),
    });

    _state.returnFocusEl = document.activeElement;
    setTimeout(() => {
      el.querySelector('.modals-btn--confirm')?.focus();
    }, 60);
  });
}

// ---- 8.3 Prompt Modal ----
function prompt(options = {}) {
  return new Promise((resolve) => {
    const id = _genId('prompt');
    const {
      title = 'إدخال',
      message = '',
      placeholder = '',
      defaultValue = '',
      validate = null,
      confirmText = 'تأكيد',
      cancelText = 'إلغاء',
      priority = 'normal',
      size = 'md',
    } = options;

    const inputId = `${id}-input`;
    const errorId = `${id}-error`;

    const el = _createDialogElement(id, 'modals-prompt', 'dialog', size);
    el.setAttribute('aria-labelledby', `${id}-title`);

    el.innerHTML = `
      <div class="modals-dialog__header">
        <h2 id="${id}-title" class="modals-dialog__title">${escapeHtml(title)}</h2>
        <button class="modals-dialog__close-x" aria-label="إغلاق" type="button"><i class="fas fa-times" aria-hidden="true"></i></button>
      </div>
      <div class="modals-dialog__body">
        ${message ? `<p class="modals-dialog__message">${escapeHtml(message)}</p>` : ''}
        <div class="modals-field">
          <input
            id="${inputId}"
            type="text"
            class="modals-input"
            placeholder="${escapeHtml(placeholder)}"
            value="${escapeHtml(defaultValue)}"
            aria-describedby="${errorId}"
            autocomplete="off"
            dir="rtl"
          />
          <span id="${errorId}" class="modals-field__error" role="alert" aria-live="assertive"></span>
        </div>
      </div>
      <div class="modals-dialog__footer">
        <button class="modals-btn modals-btn--secondary modals-btn--cancel" type="button">${escapeHtml(cancelText)}</button>
        <button class="modals-btn modals-btn--primary modals-btn--confirm" type="button">${escapeHtml(confirmText)}</button>
      </div>
    `;

    const inputEl = el.querySelector(`#${inputId}`);
    const errorEl = el.querySelector(`#${errorId}`);

    const doCancel = () => {
      el.classList.add('modals-dialog--hiding');
      setTimeout(() => {
        if (el.parentNode) el.remove();
        _closeActiveModal(null);
        resolve(null);
      }, MODALS_CONFIG.ANIMATION_DURATION);
    };

    const doConfirm = () => {
      const value = inputEl.value;
      if (validate) {
        const errorMsg = validate(value);
        if (errorMsg) {
          errorEl.textContent = errorMsg;
          inputEl.setAttribute('aria-invalid', 'true');
          inputEl.focus();
          return;
        }
      }
      errorEl.textContent = '';
      inputEl.removeAttribute('aria-invalid');
      el.classList.add('modals-dialog--hiding');
      setTimeout(() => {
        if (el.parentNode) el.remove();
        _closeActiveModal(value);
        resolve(value);
      }, MODALS_CONFIG.ANIMATION_DURATION);
    };

    el.querySelector('.modals-btn--confirm').addEventListener('click', doConfirm);
    el.querySelector('.modals-btn--cancel').addEventListener('click', doCancel);
    el.querySelector('.modals-dialog__close-x').addEventListener('click', doCancel);
    inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') doConfirm(); });

    _ensureDialogLayer().appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('modals-dialog--visible')));
    _showBackdrop(doCancel);
    const escHandler = _addEscapeListener(doCancel, true);

    _openModal({
      _id: id,
      type: 'prompt',
      priority,
      _escHandler: escHandler,
      _trapHandler: _trapFocus(el),
    });

    _state.returnFocusEl = document.activeElement;
    setTimeout(() => inputEl.focus(), 60);
  });
}

// ---- 8.4 Info Modal ----
function info(options = {}) {
  return new Promise((resolve) => {
    const id = _genId('info');
    const {
      title = 'معلومات',
      content = '',
      isHtml = false,
      closeText = 'إغلاق',
      priority = 'normal',
      size = 'md',
    } = options;

    const safeContent = isHtml ? sanitizeHtml(content) : escapeHtml(content);

    const el = _createDialogElement(id, 'modals-info', 'dialog', size);
    el.setAttribute('aria-labelledby', `${id}-title`);

    el.innerHTML = `
      <div class="modals-dialog__header">
        <h2 id="${id}-title" class="modals-dialog__title">${escapeHtml(title)}</h2>
        <button class="modals-dialog__close-x" aria-label="إغلاق" type="button"><i class="fas fa-times" aria-hidden="true"></i></button>
      </div>
      <div class="modals-dialog__body modals-dialog__body--scrollable">
        ${isHtml ? safeContent : `<p>${safeContent}</p>`}
      </div>
      <div class="modals-dialog__footer">
        <button class="modals-btn modals-btn--primary modals-btn--close" type="button">${escapeHtml(closeText)}</button>
      </div>
    `;

    const doClose = () => {
      el.classList.add('modals-dialog--hiding');
      setTimeout(() => {
        if (el.parentNode) el.remove();
        _closeActiveModal();
        resolve();
      }, MODALS_CONFIG.ANIMATION_DURATION);
    };

    el.querySelector('.modals-btn--close').addEventListener('click', doClose);
    el.querySelector('.modals-dialog__close-x').addEventListener('click', doClose);

    _ensureDialogLayer().appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('modals-dialog--visible')));
    _showBackdrop(doClose);
    const escHandler = _addEscapeListener(doClose, true);

    _openModal({
      _id: id,
      type: 'info',
      priority,
      _escHandler: escHandler,
      _trapHandler: _trapFocus(el),
    });

    _state.returnFocusEl = document.activeElement;
    setTimeout(() => {
      el.querySelector('.modals-btn--close')?.focus();
    }, 60);
  });
}

// ---- 8.5 Loading Overlay ----
function loading(message = 'جاري التحميل...') {
  if (_state.loadingOverlay) {
    _state.loadingOverlay.update(message);
    return _state.loadingOverlay;
  }

  const id = MODALS_CONFIG.LOADING_OVERLAY_ID;

  const el = document.createElement('div');
  el.id = id;
  el.className = 'modals-loading';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-label', escapeHtml(message));
  el.setAttribute('dir', 'rtl');

  el.innerHTML = `
    <div class="modals-loading__card">
      <div class="modals-loading__spinner" aria-hidden="true">
        <div class="modals-loading__spinner-ring"></div>
      </div>
      <p class="modals-loading__message">${escapeHtml(message)}</p>
    </div>
  `;

  document.body.appendChild(el);
  document.body.classList.add('modals-body-locked');
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('modals-loading--visible')));

  const api = {
    update(newMessage) {
      const msgEl = el.querySelector('.modals-loading__message');
      if (msgEl) msgEl.textContent = newMessage;
      el.setAttribute('aria-label', escapeHtml(newMessage));
    },
    close() {
      el.classList.add('modals-loading--hiding');
      setTimeout(() => {
        if (el.parentNode) el.remove();
        document.body.classList.remove('modals-body-locked');
        _state.loadingOverlay = null;
      }, MODALS_CONFIG.ANIMATION_DURATION);
    },
  };

  _state.loadingOverlay = api;
  return api;
}

// ---- 8.6 Image Preview Modal ----
function imagePreview(src, alt = '') {
  const id = _genId('imgpreview');

  const el = document.createElement('div');
  el.id = id;
  el.className = 'modals-imgpreview';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', `معاينة الصورة: ${escapeHtml(alt || 'صورة')}`);
  el.setAttribute('dir', 'rtl');

  el.innerHTML = `
    <button class="modals-imgpreview__close" aria-label="إغلاق" type="button">
      <i class="fas fa-times" aria-hidden="true"></i>
    </button>
    <div class="modals-imgpreview__loader" aria-hidden="true">
      <div class="modals-loading__spinner-ring"></div>
    </div>
    <div class="modals-imgpreview__container">
      <img
        class="modals-imgpreview__img"
        src="${escapeHtml(src)}"
        alt="${escapeHtml(alt)}"
        loading="lazy"
        draggable="false"
      />
    </div>
  `;

  const imgEl = el.querySelector('.modals-imgpreview__img');
  const loaderEl = el.querySelector('.modals-imgpreview__loader');

  let scale = 1;
  let lastTouchDist = null;

  imgEl.addEventListener('load', () => loaderEl.style.display = 'none');
  imgEl.addEventListener('error', () => {
    loaderEl.style.display = 'none';
    imgEl.style.display = 'none';
    const errMsg = document.createElement('p');
    errMsg.className = 'modals-imgpreview__error';
    errMsg.textContent = 'تعذّر تحميل الصورة';
    el.querySelector('.modals-imgpreview__container').appendChild(errMsg);
  });

  const doClose = () => {
    el.classList.add('modals-imgpreview--hiding');
    setTimeout(() => {
      if (el.parentNode) el.remove();
      _closeActiveModal();
    }, MODALS_CONFIG.ANIMATION_DURATION);
  };

  el.querySelector('.modals-imgpreview__close').addEventListener('click', doClose);

  el.addEventListener('click', (e) => {
    if (e.target === el || e.target.classList.contains('modals-imgpreview__container')) {
      doClose();
    }
  });

  // تكبير بالضغط المزدوج
  imgEl.addEventListener('dblclick', () => {
    scale = scale === 1 ? 2 : 1;
    imgEl.style.transform = `scale(${scale})`;
  });

  // Pinch to zoom
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      lastTouchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  }, { passive: true });

  el.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && lastTouchDist) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      scale = Math.min(Math.max(0.5, scale * (dist / lastTouchDist)), 4);
      imgEl.style.transform = `scale(${scale})`;
      lastTouchDist = dist;
    }
  }, { passive: true });

  el.addEventListener('touchend', () => { lastTouchDist = null; });

  document.body.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('modals-imgpreview--visible')));
  _showBackdrop(null);

  const escHandler = _addEscapeListener(doClose, true);

  _openModal({
    _id: id,
    type: 'imagePreview',
    priority: 'normal',
    _escHandler: escHandler,
    _trapHandler: _trapFocus(el),
  });

  _state.returnFocusEl = document.activeElement;
  setTimeout(() => {
    el.querySelector('.modals-imgpreview__close')?.focus();
  }, 60);
}

// ---- 8.7 Bottom Sheet ----
function bottomSheet(options = {}) {
  return new Promise((resolve) => {
    const id = _genId('bottomsheet');
    const {
      title = '',
      items = [],
      priority = 'normal',
    } = options;

    const el = document.createElement('div');
    el.id = id;
    el.className = 'modals-bottomsheet';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('dir', 'rtl');
    if (title) el.setAttribute('aria-labelledby', `${id}-title`);

    const itemsHtml = items.map(item => `
      <button
        class="modals-bottomsheet__item"
        type="button"
        data-item-id="${escapeHtml(String(item.id))}"
        aria-label="${escapeHtml(item.label)}"
      >
        ${item.icon ? `<i class="fas ${escapeHtml(item.icon)} modals-bottomsheet__item-icon" aria-hidden="true"></i>` : ''}
        <span class="modals-bottomsheet__item-text">
          <span class="modals-bottomsheet__item-label">${escapeHtml(item.label)}</span>
          ${item.description ? `<span class="modals-bottomsheet__item-desc">${escapeHtml(item.description)}</span>` : ''}
        </span>
      </button>
    `).join('');

    el.innerHTML = `
      <div class="modals-bottomsheet__handle" aria-hidden="true"></div>
      ${title ? `<h2 id="${id}-title" class="modals-bottomsheet__title">${escapeHtml(title)}</h2>` : ''}
      <div class="modals-bottomsheet__list" role="list">
        ${itemsHtml}
      </div>
      <button class="modals-bottomsheet__cancel" type="button">إلغاء</button>
    `;

    let startY = 0;
    let currentY = 0;
    const handle = el.querySelector('.modals-bottomsheet__handle');

    const doClose = (result = null, afterClose = null) => {
      el.classList.add('modals-dialog--hiding');
      setTimeout(() => {
        if (el.parentNode) el.remove();
        _closeActiveModal(result);
        resolve(result);
        if (onClose) onClose(result);
        if (afterClose) afterClose();
      }, MODALS_CONFIG.ANIMATION_DURATION);
    };
    // Drag للإغلاق
    handle.addEventListener('touchstart', (e) => {
      startY = e.touches[0].clientY;
    }, { passive: true });

    handle.addEventListener('touchmove', (e) => {
      currentY = e.touches[0].clientY;
      const diff = currentY - startY;
      if (diff > 0) el.style.transform = `translateY(${diff}px)`;
    }, { passive: true });

    handle.addEventListener('touchend', () => {
      const diff = currentY - startY;
      el.style.transform = '';
      if (diff > MODALS_CONFIG.SWIPE_THRESHOLD) doClose(null);
    });

    el.querySelectorAll('.modals-bottomsheet__item').forEach(btn => {
      btn.addEventListener('click', () => {
        const itemId = btn.getAttribute('data-item-id');
        const selected = items.find(i => String(i.id) === itemId) || null;
        doClose(selected);
      });
    });

    el.querySelector('.modals-bottomsheet__cancel').addEventListener('click', () => doClose(null));

    document.body.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('modals-bottomsheet--visible')));
    _showBackdrop(() => doClose(null));

    const escHandler = _addEscapeListener(() => doClose(null), true);

    _openModal({
      _id: id,
      type: 'bottomSheet',
      priority,
      _escHandler: escHandler,
      _trapHandler: _trapFocus(el),
    });

    _state.returnFocusEl = document.activeElement;
    setTimeout(() => {
      const focusable = _getFocusable(el);
      if (focusable.length) focusable[0]?.focus();
    }, 60);
  });
}

// ---- 8.8 showModal (النافذة المخصصة) - متوافقة تماماً مع core engine ----
function showModal(options = {}) {
  return new Promise((resolve) => {
    const id = _genId('custom-modal');
    const {
      title,
      content,
      html,             // إضافة دعم المحتوى النصي HTML
      size = 'medium',  // small, medium, large, fullscreen
      buttons = [],
      onOpen,
      onClose,
      onConfirm,        // ==== [إصلاح] دعم onConfirm على مستوى options ====
      onPreview,        // ==== [إصلاح] دعم onPreview على مستوى options لزر role=preview ====
      closeOnBackdrop = true,
      priority = 'normal',
      stack = false,
    } = options;

    // تحديد المحتوى: priority للـ html إن وُجد، وإلا content
    const contentToUse = html || content || '';
    let contentHtml = '';
    if (typeof contentToUse === 'string') {
      contentHtml = sanitizeHtml(contentToUse);
    } else if (contentToUse instanceof HTMLElement) {
      contentHtml = contentToUse.outerHTML;
    }

    const buttonsHtml = buttons.map(btn => `
      <button class="modals-btn modals-btn--${btn.type || 'secondary'}" data-role="${btn.role || ''}" data-index="${buttons.indexOf(btn)}">
        ${escapeHtml(btn.text)}
      </button>
    `).join('');

    const el = _createDialogElement(id, 'modals-custom', 'dialog', size);
    el.setAttribute('aria-labelledby', `${id}-title`);

    el.innerHTML = `
      <div class="modals-dialog__header">
        <h2 id="${id}-title" class="modals-dialog__title">${escapeHtml(title)}</h2>
        <button class="modals-dialog__close-x" aria-label="إغلاق" type="button">
          <i class="fas fa-times" aria-hidden="true"></i>
        </button>
      </div>
      <div class="modals-dialog__body modals-dialog__body--scrollable">
        ${contentHtml}
      </div>
      ${buttons.length ? `<div class="modals-dialog__footer">${buttonsHtml}</div>` : ''}
    `;

    const doClose = (result = null, afterClose = null) => {
      if (stack) {
        _popStackedModal(result);
        resolve(result);
        if (onClose) onClose(result);
        if (afterClose) afterClose();
        return;
      }
      el.classList.add('modals-dialog--hiding');
      setTimeout(() => {
        if (el.parentNode) el.remove();
        _closeActiveModal(result);
        resolve(result);
        if (onClose) onClose(result);
        if (afterClose) afterClose();
      }, MODALS_CONFIG.ANIMATION_DURATION);
    };
    // ==== [إصلاح] كائن الواجهة الممرَّر لـ onOpen/onConfirm/onPreview ====
    const modalInstance = {
      _id: id,
      element: el,
      close: (result = null, afterClose = null) => doClose(result, afterClose),
    };

    // ربط الأحداث
    el.querySelector('.modals-dialog__close-x').addEventListener('click', () => doClose(null));

    const modalBtns = el.querySelectorAll('.modals-btn');
    modalBtns.forEach((btn) => {
      const idx = parseInt(btn.dataset.index);
      const btnConfig = buttons[idx];
      btn.addEventListener('click', async () => {
        // ==== أولوية أولى: onClick الخاص بالزر نفسه (سلوك سابق محفوظ) ====
        if (btnConfig?.onClick) {
          const result = await btnConfig.onClick(modalInstance);
          doClose(result);
          return;
        }
        if (btnConfig?.handler) {
          if (btn.disabled) return;
          btn.disabled = true;
          doClose(null, () => btnConfig.handler(modalInstance));
          return;
        }
        // ==== [إصلاح] أولوية ثالثة: onPreview على مستوى options لزر role=preview ====
        if (btnConfig?.role === 'preview' && onPreview) {
          if (btn.disabled) return;
          btn.disabled = true;
          try {
            await onPreview(modalInstance);
          } catch (error) {
            console.error('❌ خطأ أثناء تنفيذ onPreview:', error);
          } finally {
            btn.disabled = false;
          }
          // زر المعاينة لا يُغلق النافذة أبداً
          return;
        }
        // ==== [إصلاح] أولوية رابعة: onConfirm على مستوى options لزر role=confirm ====
        if (btnConfig?.role === 'confirm' && onConfirm) {
          if (btn.disabled) return;
          btn.disabled = true;
          try {
            const result = await onConfirm(modalInstance);
            // إرجاع false من onConfirm (فشل تحقق الحقول، أو تم استدعاء
            // modalInstance.close() يدوياً بالفعل داخل onConfirm) => لا شيء إضافي هنا
            if (result === false) {
              btn.disabled = false;
              return;
            }
            doClose(result);
          } catch (error) {
            console.error('❌ خطأ أثناء تنفيذ onConfirm:', error);
            btn.disabled = false;
          }
          return;
        }
        doClose(btnConfig?.role === 'confirm' ? true : null);
      });
    });

    _ensureDialogLayer().appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('modals-dialog--visible')));

    const backdropClose = closeOnBackdrop ? () => doClose(null) : null;
    _showBackdrop(backdropClose);
    const escHandler = _addEscapeListener(() => doClose(null), true);

    if (stack) {
      _pushStackedModal({ _id: id, _escHandler: escHandler, _trapHandler: _trapFocus(el) });
    } else {
      _openModal({
        _id: id,
        type: 'custom',
        priority,
        _escHandler: escHandler,
        _trapHandler: _trapFocus(el),
      });
      _state.returnFocusEl = document.activeElement;
    }

    if (onOpen) onOpen(modalInstance);

    setTimeout(() => {
      const focusable = _getFocusable(el);
      if (focusable.length) focusable[0]?.focus();
    }, 60);
  });
}
// ====== 9. إغلاق الكل ======
function closeAll() {
  _state.queue = [];

  if (_state.modalStack.length > 0) _clearModalStack(); // 🆕 يقفل كل طبقات معالج الامتحان دفعة واحدة

  if (_state.activeModal) {
    const el = document.getElementById(_state.activeModal._id);
    if (el) {
      el.classList.add('modals-dialog--hiding');
      setTimeout(() => {
        if (el.parentNode) el.remove();
      }, MODALS_CONFIG.ANIMATION_DURATION);
    }
    _closeActiveModal(undefined);
  }

  _hideBackdrop();
  document.body.classList.remove('modals-body-locked');
  _restoreFocus();
}

// ====== 10. EventBus Bridge ======

function _emitEvent(eventName, data) {
  try {
    if (window.EventBus?.emit) {
      window.EventBus.emit(eventName, data);
    }
  } catch (_e) { /* EventBus غير متاح */ }
}

function _bindEventBus() {
  if (!window.EventBus?.on) return;

  const onRouteChanged = () => {
    // لا نغلق الـ Loading عند تغيير المسار
    if (!_state.loadingOverlay) {
      closeAll();
    }
  };
  // 🛠️ إصلاح ترابط: router.js يُصدر 'pageChanged' فعلياً عند كل تنقل ناجح،
  // الاسم القديم 'route:changed' لم يكن يُصدَر من أي مكان في التطبيق فأصبح الإغلاق التلقائي معطلاً بالكامل.
  window.EventBus.on('pageChanged', onRouteChanged);
  _state.busUnsubscribers.push(() => window.EventBus.off('pageChanged', onRouteChanged));

  const onUserState = (detail) => {
    if (detail?.action === 'logout') {
      if (!_state.loadingOverlay) {
        closeAll();
      }
    }
  };
  window.EventBus.on('userStateChanged', onUserState);
  _state.busUnsubscribers.push(() => window.EventBus.off('userStateChanged', onUserState));

  // مراقبة تغيير الثيم لتحديث النوافذ المفتوحة
  const onThemeChanged = () => {
    const theme = _getCurrentTheme();
    document.querySelectorAll('.modals-dialog, .modals-bottomsheet, .modals-imgpreview, .modals-loading__card')
      .forEach(el => el.setAttribute('data-theme', theme));
  };
  window.EventBus.on('theme:toggled', onThemeChanged);
  _state.busUnsubscribers.push(() => window.EventBus.off('theme:toggled', onThemeChanged));
}

// ====== 11. التهيئة ======

function initModals() {
  if (_state.isInitialized) return;

  _ensureToastContainer();
  _bindEventBus();

  // مراقبة تغيير الثيم عبر MutationObserver
  const observer = new MutationObserver(() => {
    const theme = _getCurrentTheme();
    document.querySelectorAll('.modals-dialog, .modals-bottomsheet, .modals-imgpreview, .modals-loading__card')
      .forEach(el => el.setAttribute('data-theme', theme));
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });

  // تخزين مرجع لإلغاء المراقبة
  _state._themeObserver = observer;

  _state.isInitialized = true;
  console.log('✅ [modals.js] تم تهيئة نظام النوافذ v5.0.0 (النسخة المتكاملة)');

  // إطلاق حدث لإعلام باقي الأنظمة (مثل PWA) بأن modals أصبح جاهزاً
  if (window.EventBus && typeof window.EventBus.emit === 'function') {
    window.EventBus.emit('modals:ready');
  }
}

// ====== 12. التنظيف ======

function destroyModals() {
  _state.toastTimers.forEach(id => clearTimeout(id));
  _state.toastTimers.clear();

  const toastContainer = document.getElementById(MODALS_CONFIG.TOAST_CONTAINER_ID);
  if (toastContainer) toastContainer.remove();

  if (_state.activeModal) {
    const el = document.getElementById(_state.activeModal._id);
    if (el) el.remove();
    if (_state.activeModal._escHandler) {
      document.removeEventListener('keydown', _state.activeModal._escHandler);
    }
    if (_state.activeModal._trapHandler) {
      document.removeEventListener('keydown', _state.activeModal._trapHandler);
    }
  }

  document.querySelectorAll('.modals-dialog, .modals-imgpreview, .modals-bottomsheet').forEach(el => el.remove());

  if (_state.loadingOverlay) {
    _state.loadingOverlay.close();
  }

  const backdrop = document.getElementById('modals-backdrop');
  if (backdrop) backdrop.remove();

  const dialogLayer = document.getElementById('modals-dialog-layer');
  if (dialogLayer) dialogLayer.remove();

  _state.busUnsubscribers.forEach(fn => { try { fn(); } catch (_e) {} });
  _state.busUnsubscribers.length = 0;

  if (_state._themeObserver) {
    _state._themeObserver.disconnect();
    delete _state._themeObserver;
  }

  _state.queue = [];
  _state.activeModal = null;
  _state.activeToasts = [];
  _state.loadingOverlay = null;
  _state.returnFocusEl = null;
  _state._idCounter = 0;
  _state.isInitialized = false;

  document.body.classList.remove('modals-body-locked');
  console.log('[modals.js] تم التنظيف الكامل');
}

// ====== 13. الواجهة العامة ======

const modals = {
  toast,
  confirm,
  alert,
  prompt,
  info,
  loading,
  imagePreview,
  bottomSheet,
  showModal,
  closeAll,
  closeAllModals: closeAll,
  init: initModals,
  destroy: destroyModals,
};

// ====== 14. التصدير ======

if (typeof window !== 'undefined') {
  window.modals = modals;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initModals);
  } else {
    initModals();
  }
}

export {
  toast,
  confirm,
  alert,
  prompt,
  info,
  loading,
  imagePreview,
  bottomSheet,
  showModal,
  closeAll,
  initModals,
  destroyModals,
};

export default modals;