/**
 * ⚙️ views/settings/settings.js - نظام الإعدادات المتكامل v5.0.0 (Enterprise Grade)
 * ============================================================================
 * 📝 المسؤولية: إدارة جميع إعدادات المستخدم (الملف الشخصي، الصورة الرمزية،
 *               المظهر، الأمان، الإعدادات المتقدمة للمعلم/المشرف)
 * ✅ التكامل:
 *   - api.js: updateUserProfile, updateUserPreferences, getUserById,
 *             updateUserPassword, deleteUserAccount
 *   - session.js: getCurrentUser, setSession, clearSession
 *   - theme.js: setTheme, setColorTheme, getCurrentTheme, getCurrentColorTheme
 *   - modals.js: toast, confirm, showModal
 *   - event-bus.js: إطلاق أحداث profileUpdated, avatarUpdated
 *   - router.js: التنقل بعد حذف الحساب
 * ============================================================================
 */

import {
  getCurrentUser,
  setSession,
  clearSession
} from '../../js/core/session.js';

import {
  updateUserProfile,
  updateUserPreferences,
  getUserById,
  updateUserPassword,
  deleteUserAccount
} from '../../js/core/api.js';

import {
  setTheme,
  setColorTheme,
  getCurrentTheme,
  getCurrentColorTheme
} from '../../js/core/theme.js';
import { EventBus } from '../../js/core/event-bus.js';

// ====== 1. الثوابت والتكوين ======
const SETTINGS_CONFIG = {
  STORAGE_KEYS: {
    NOTIFICATIONS: 'biologist_notifications',
    EMAIL_NOTIFICATIONS: 'biologist_email_notifications',
    SHOW_SENSITIVE: 'biologist_show_sensitive',
    AUTO_APPROVE: 'biologist_auto_approve'
  },
  JOB_NAMES_MALE: ['طبيب', 'مهندس', 'مزارع', 'عالم', 'مُعلم', 'ميكانيكي', 'ممرض', 'ضابط', 'محامٍ', 'رجل أعمال'],
  JOB_NAMES_FEMALE: ['طبيبة', 'مهندسة', 'مزارعة', 'عالِمة', 'مُعلمة', 'ميكانيكية', 'ممرضة', 'ضابطة', 'محامية', 'سيدة أعمال'],
  SPRITE_PATHS: {
    MALE: 'assets/avatars/jobs/avatars_male.png',
    FEMALE: 'assets/avatars/jobs/avatars_female.png',
    MALE_BG: 'assets/avatars/jobs/M.png',
    FEMALE_BG: 'assets/avatars/jobs/G.png'
  },
  SPRITE_DIMENSIONS: {
    WIDTH_PERCENT: '500%',
    HEIGHT_PERCENT: '200%',
    COLS: 5,
    ROWS: 2
  }
};

// ====== 2. الحالة الداخلية ======
let $settingsState = {
  container: null,
  currentUser: null,
  isInitialized: false,
  elements: {}
};

// ====== 3. دوال مساعدة ======
function safeToast(message, type = 'info') {
  if (window.modals?.toast) window.modals.toast(message, type);
  else console.log(`[${type}] ${message}`);
}

function safeNavigate(route, params = {}) {
  if (window.router?.navigateTo) window.router.navigateTo(route, params);
  else console.error('Router غير متاح');
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

function showConfirm(options) {
  return new Promise((resolve) => {
    if (window.modals?.confirm) {
      window.modals.confirm({
        title: options.title,
        message: options.message,
        confirmText: options.confirmText || 'نعم',
        cancelText: options.cancelText || 'إلغاء',
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false)
      });
    } else {
      resolve(confirm(options.message));
    }
  });
}

// ====== 4. تحديث واجهة المستخدم بالبيانات ======
async function loadAndPopulateUserData() {
  const user = $settingsState.currentUser;
  if (!user) return;

  // جلب أحدث البيانات من قاعدة البيانات
  try {
    const freshUser = await getUserById(user.id);
    if (freshUser) {
      $settingsState.currentUser = freshUser;
      await setSession(freshUser);
      window.$currentUser = freshUser;
    }
  } catch (error) {
    console.warn('⚠️ فشل جلب أحدث بيانات المستخدم:', error);
  }

  const current = $settingsState.currentUser;

  // ==== حقل الاسم ====
  if ($settingsState.elements.fullName) {
    $settingsState.elements.fullName.value = current.full_name || '';
  }

  // ==== البريد الإلكتروني ====
  if ($settingsState.elements.email) {
    $settingsState.elements.email.value = current.email || '';
  }

  // ==== رقم الهاتف (للقراءة فقط) ====
  if ($settingsState.elements.phone) {
    $settingsState.elements.phone.value = current.phone || '';
  }

  // ==== العمر ====
  if ($settingsState.elements.age) {
    $settingsState.elements.age.value = current.age || '';
  }

  // ==== الجنس ====
  if ($settingsState.elements.gender) {
    $settingsState.elements.gender.value = current.gender || 'male';
  }

  // ==== إظهار حقول الطالب إن كان طالباً ====
  const studentFields = $settingsState.container?.querySelector('.student-fields');
  if (studentFields) {
    if (current.user_type === 'student') {
      studentFields.style.display = 'flex';
      if ($settingsState.elements.stage) {
        $settingsState.elements.stage.value = current.stage || 'preparatory';
      }
      if ($settingsState.elements.grade) {
        $settingsState.elements.grade.value = current.grade || '1';
      }
    } else {
      studentFields.style.display = 'none';
    }
  }

  // ==== تحديث معاينة الصورة الرمزية ====
  updateAvatarPreview(current.gender, current.avatar_job_index ?? 0);

  // ==== عرض اسم الوظيفة الحالية ====
  const jobNameEl = $settingsState.elements.avatarJobName;
  if (jobNameEl) {
    const isMale = current.gender === 'male';
    const jobNames = isMale ? SETTINGS_CONFIG.JOB_NAMES_MALE : SETTINGS_CONFIG.JOB_NAMES_FEMALE;
    const jobIndex = current.avatar_job_index ?? 0;
    jobNameEl.textContent = jobNames[jobIndex] || 'غير محدد';
  }

  // ==== إعدادات الثيم والإشعارات ====
  const currentTheme = getCurrentTheme();
  if ($settingsState.elements.themeLightBtn && $settingsState.elements.themeDarkBtn) {
    $settingsState.elements.themeLightBtn.classList.toggle('active', currentTheme === 'light');
    $settingsState.elements.themeDarkBtn.classList.toggle('active', currentTheme === 'dark');
  }

  const currentColor = getCurrentColorTheme();
  if ($settingsState.elements.colorOptions) {
    $settingsState.elements.colorOptions.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.color === currentColor);
    });
  }

  // ==== إعدادات الإشعارات من localStorage ====
  if ($settingsState.elements.notificationsToggle) {
    const saved = localStorage.getItem(SETTINGS_CONFIG.STORAGE_KEYS.NOTIFICATIONS);
    $settingsState.elements.notificationsToggle.checked = saved !== 'disabled';
  }
  if ($settingsState.elements.emailNotifications) {
    const saved = localStorage.getItem(SETTINGS_CONFIG.STORAGE_KEYS.EMAIL_NOTIFICATIONS);
    $settingsState.elements.emailNotifications.checked = saved === 'enabled';
  }

  // ==== إعدادات متقدمة للمعلم/المشرف ====
  const isTeacherOrMod = current.user_type === 'teacher' || current.user_type === 'moderator';
  const advancedTab = $settingsState.container?.querySelector('[data-tab="advanced"]');
  if (advancedTab) {
    advancedTab.style.display = isTeacherOrMod ? 'flex' : 'none';
  }
  if (isTeacherOrMod) {
    if ($settingsState.elements.showSensitiveData) {
      const saved = localStorage.getItem(SETTINGS_CONFIG.STORAGE_KEYS.SHOW_SENSITIVE);
      $settingsState.elements.showSensitiveData.checked = saved === 'true';
    }
    if ($settingsState.elements.autoApproveComments) {
      const saved = localStorage.getItem(SETTINGS_CONFIG.STORAGE_KEYS.AUTO_APPROVE);
      $settingsState.elements.autoApproveComments.checked = saved === 'true';
    }
  }
}

// ====== 5. تحديث معاينة الصورة الرمزية (Sprite Sheet) ======
function updateAvatarPreview(gender, jobIndex) {
  const ring = $settingsState.elements.avatarRing;
  const sprite = $settingsState.elements.avatarSprite;
  if (!ring || !sprite) return;

  const isMale = gender === 'male';
  // خلفية الإطار (M.png / G.png)
  const bgPath = isMale ? SETTINGS_CONFIG.SPRITE_PATHS.MALE_BG : SETTINGS_CONFIG.SPRITE_PATHS.FEMALE_BG;
  ring.style.backgroundImage = `url('${bgPath}')`;
  ring.style.backgroundSize = 'cover';
  ring.style.backgroundPosition = 'center';

  // Sprite الوظيفة
  const spriteUrl = isMale ? SETTINGS_CONFIG.SPRITE_PATHS.MALE : SETTINGS_CONFIG.SPRITE_PATHS.FEMALE;
  sprite.style.backgroundImage = `url('${spriteUrl}')`;
  sprite.style.backgroundSize = SETTINGS_CONFIG.SPRITE_DIMENSIONS.WIDTH_PERCENT + ' ' + SETTINGS_CONFIG.SPRITE_DIMENSIONS.HEIGHT_PERCENT;
  sprite.style.backgroundRepeat = 'no-repeat';

  const col = jobIndex % SETTINGS_CONFIG.SPRITE_DIMENSIONS.COLS;
  const row = Math.floor(jobIndex / SETTINGS_CONFIG.SPRITE_DIMENSIONS.COLS);
  sprite.style.backgroundPosition = `${col * 25}% ${row * 100}%`;
}

// ====== 6. فتح محدد الوظائف (نافذة احترافية) ======
async function openJobSelector() {
  const user = $settingsState.currentUser;
  if (!user) return;

  const gender = user.gender || 'male';
  const jobNames = gender === 'male' ? SETTINGS_CONFIG.JOB_NAMES_MALE : SETTINGS_CONFIG.JOB_NAMES_FEMALE;
  const spritePath = gender === 'male' ? SETTINGS_CONFIG.SPRITE_PATHS.MALE : SETTINGS_CONFIG.SPRITE_PATHS.FEMALE;

  // بناء شبكة اختيار الوظيفة (5 أعمدة × صفين)
  let optionsHtml = '';
  for (let i = 0; i < 10; i++) {
    const col = i % SETTINGS_CONFIG.SPRITE_DIMENSIONS.COLS;
    const row = Math.floor(i / SETTINGS_CONFIG.SPRITE_DIMENSIONS.COLS);
    const xPercent = col * 25;
    const yPercent = row * 100;
    optionsHtml += `
      <div class="avatar-option" data-job-index="${i}" role="button" tabindex="0" aria-label="اختر وظيفة ${escapeHtml(jobNames[i])}">
        <div class="avatar-sprite" style="background-image: url('${spritePath}'); background-position: ${xPercent}% ${yPercent}%; background-size: 500% 200%;"></div>
        <span class="avatar-option-label">${escapeHtml(jobNames[i])}</span>
      </div>
    `;
  }

  const modalContent = `
    <div class="avatar-selector-container">
      <p class="avatar-selector-desc">اختر وظيفتك المفضلة لتظهر في ملفك الشخصي وفي التعليقات</p>
      <div class="avatar-selector-grid">
        ${optionsHtml}
      </div>
    </div>
  `;

  if (!window.modals?.showModal) {
    safeToast('نظام النوافذ غير متاح حالياً', 'error');
    return;
  }

  window.modals.showModal({
    title: 'تغيير الوظيفة',
    html: modalContent,
    size: 'medium',
    buttons: [
      { text: 'إغلاق', role: 'cancel', type: 'secondary' }
    ],
    onOpen: () => {
      const options = document.querySelectorAll('.avatar-option');
      const currentJobIndex = user.avatar_job_index ?? 0;

      // تمييز الوظيفة الحالية
      options.forEach((opt, idx) => {
        if (idx === currentJobIndex) {
          opt.classList.add('selected');
        }
        opt.addEventListener('click', async () => {
          const newIndex = parseInt(opt.dataset.jobIndex);
          if (newIndex === currentJobIndex) {
            window.modals.closeAllModals();
            return;
          }

          try {
            await updateUserProfile(user.id, { avatar_job_index: newIndex });
            // تحديث الحالة المحلية
            user.avatar_job_index = newIndex;
            $settingsState.currentUser = user;
            await setSession(user);
            window.$currentUser = user;

            // تحديث الواجهة
            updateAvatarPreview(gender, newIndex);
            const jobNameEl = $settingsState.elements.avatarJobName;
            if (jobNameEl) jobNameEl.textContent = jobNames[newIndex];

            // إطلاق حدث لتحديث المكونات الأخرى (Drawer, Navbar, Profile)
            document.dispatchEvent(new CustomEvent('avatarUpdated', { detail: { user } }));
            EventBus.emit('avatarUpdated', { user });

            safeToast(`تم تغيير الوظيفة إلى "${jobNames[newIndex]}"`, 'success');
            window.modals.closeAllModals();
          } catch (error) {
            console.error('❌ فشل تحديث الوظيفة:', error);
            safeToast('حدث خطأ أثناء تغيير الوظيفة', 'error');
          }
        });
      });
    }
  });
}

// ====== 7. حفظ الملف الشخصي ======
async function handleProfileSubmit(e) {
  e.preventDefault();
  const user = $settingsState.currentUser;
  if (!user) return;

  const fullName = $settingsState.elements.fullName?.value.trim();
  const email = $settingsState.elements.email?.value.trim();
  const age = parseInt($settingsState.elements.age?.value) || undefined;
  const stage = $settingsState.elements.stage?.value;
  const grade = $settingsState.elements.grade?.value;

  if (!fullName) {
    safeToast('الاسم الكامل مطلوب', 'warning');
    return;
  }

  const updates = { full_name: fullName, email, age };
  if (user.user_type === 'student') {
    updates.stage = stage;
    updates.grade = parseInt(grade);
  }

  try {
    await updateUserProfile(user.id, updates);
    Object.assign(user, updates);
    await setSession(user);
    window.$currentUser = user;

    // إطلاق حدث لتحديث المكونات الأخرى
    document.dispatchEvent(new CustomEvent('profileUpdated', { detail: { user } }));
    EventBus.emit('profileUpdated', { user });

    safeToast('تم تحديث الملف الشخصي بنجاح', 'success');
  } catch (error) {
    console.error(error);
    safeToast('فشل تحديث الملف الشخصي', 'error');
  }
}

// ====== 8. حفظ المظهر والإشعارات ======
async function handleAppearanceSubmit(e) {
  e.preventDefault();

  // حفظ الثيم واللون (تم التطبيق فوراً عبر الأزرار، لكن نضمن الحفظ في localStorage و user preferences)
  const currentTheme = getCurrentTheme();
  const currentColor = getCurrentColorTheme();
  try {
    await updateUserPreferences($settingsState.currentUser.id, {
      preferred_theme: currentTheme,
      preferred_color_theme: currentColor
    });
  } catch (err) {
    console.warn(err);
  }

  // حفظ الإشعارات في localStorage
  const notifEnabled = $settingsState.elements.notificationsToggle?.checked;
  localStorage.setItem(SETTINGS_CONFIG.STORAGE_KEYS.NOTIFICATIONS, notifEnabled ? 'enabled' : 'disabled');

  const emailNotif = $settingsState.elements.emailNotifications?.checked;
  localStorage.setItem(SETTINGS_CONFIG.STORAGE_KEYS.EMAIL_NOTIFICATIONS, emailNotif ? 'enabled' : 'disabled');

  safeToast('تم حفظ تفضيلات المظهر والإشعارات', 'success');
}

// ====== 9. تغيير كلمة المرور ======
async function handleSecuritySubmit(e) {
  e.preventDefault();
  const currentPass = $settingsState.elements.currentPassword?.value;
  const newPass = $settingsState.elements.newPassword?.value;
  const confirmPass = $settingsState.elements.confirmPassword?.value;

  if (!currentPass || !newPass || !confirmPass) {
    safeToast('جميع الحقول مطلوبة', 'warning');
    return;
  }
  if (newPass !== confirmPass) {
    safeToast('كلمة المرور الجديدة غير متطابقة', 'warning');
    return;
  }
  if (newPass.length < 6 || newPass.length > 10) {
    safeToast('كلمة المرور يجب أن تكون بين 6 و10 أحرف', 'warning');
    return;
  }

  try {
    await updateUserPassword($settingsState.currentUser.id, currentPass, newPass);
    safeToast('تم تغيير كلمة المرور بنجاح', 'success');
    // مسح الحقول
    $settingsState.elements.currentPassword.value = '';
    $settingsState.elements.newPassword.value = '';
    $settingsState.elements.confirmPassword.value = '';
  } catch (error) {
    safeToast(error.message || 'فشل تغيير كلمة المرور', 'error');
  }
}

// ====== 10. حذف الحساب ======
async function handleDeleteAccount() {
  const confirmed = await showConfirm({
    title: 'تأكيد حذف الحساب',
    message: 'هل أنت متأكد من حذف حسابك؟ هذا الإجراء لا يمكن التراجع عنه وستفقد جميع بياناتك.'
  });
  if (!confirmed) return;

  try {
    await deleteUserAccount($settingsState.currentUser.id);
    await clearSession();
    safeToast('تم حذف حسابك بنجاح', 'success');
    safeNavigate('home');
  } catch (error) {
    console.error(error);
    safeToast('حدث خطأ أثناء حذف الحساب', 'error');
  }
}

// ====== 11. حفظ الإعدادات المتقدمة ======
async function handleAdvancedSave() {
  const showSensitive = $settingsState.elements.showSensitiveData?.checked;
  const autoApprove = $settingsState.elements.autoApproveComments?.checked;

  localStorage.setItem(SETTINGS_CONFIG.STORAGE_KEYS.SHOW_SENSITIVE, showSensitive ? 'true' : 'false');
  localStorage.setItem(SETTINGS_CONFIG.STORAGE_KEYS.AUTO_APPROVE, autoApprove ? 'true' : 'false');

  safeToast('تم حفظ الإعدادات المتقدمة', 'success');
}

// ====== 12. ربط أحداث الثيم والألوان ======
function bindThemeEvents() {
  const lightBtn = $settingsState.elements.themeLightBtn;
  const darkBtn = $settingsState.elements.themeDarkBtn;

  if (lightBtn) {
    lightBtn.addEventListener('click', () => {
      setTheme('light', true);
      lightBtn.classList.add('active');
      darkBtn.classList.remove('active');
    });
  }
  if (darkBtn) {
    darkBtn.addEventListener('click', () => {
      setTheme('dark', true);
      darkBtn.classList.add('active');
      lightBtn.classList.remove('active');
    });
  }

  if ($settingsState.elements.colorOptions) {
    $settingsState.elements.colorOptions.forEach(btn => {
      btn.addEventListener('click', () => {
        const color = btn.dataset.color;
        setColorTheme(color, true);
        $settingsState.elements.colorOptions.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  }
}

// ====== 13. إدارة التبويبات ======
function initTabs() {
  const tabBtns = $settingsState.container?.querySelectorAll('.settings-tab-btn');
  const tabPanes = $settingsState.container?.querySelectorAll('.settings-tab-pane');

  if (!tabBtns || !tabPanes) return;

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      // تفعيل الزر
      tabBtns.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      // إظهار اللوحة المناسبة
      tabPanes.forEach(pane => {
        pane.classList.remove('active');
        if (pane.dataset.tabPane === tabId) {
          pane.classList.add('active');
        }
      });
    });
  });
}

// ====== 14. تهيئة العناصر وتخزين المراجع ======
function cacheElements(container) {
  $settingsState.elements = {
    container,
    fullName: container.querySelector('#settings-fullname'),
    email: container.querySelector('#settings-email'),
    phone: container.querySelector('#settings-phone'),
    age: container.querySelector('#settings-age'),
    gender: container.querySelector('#settings-gender'),
    stage: container.querySelector('#settings-stage'),
    grade: container.querySelector('#settings-grade'),
    avatarRing: container.querySelector('#settings-avatar-ring'),
    avatarSprite: container.querySelector('#settings-avatar-sprite'),
    avatarJobName: container.querySelector('#settings-avatar-job-name'),
    changeAvatarBtn: container.querySelector('#change-avatar-btn-settings'),
    themeLightBtn: container.querySelector('#theme-light-btn'),
    themeDarkBtn: container.querySelector('#theme-dark-btn'),
    colorOptions: container.querySelectorAll('.color-option'),
    notificationsToggle: container.querySelector('#notifications-toggle'),
    emailNotifications: container.querySelector('#email-notifications'),
    currentPassword: container.querySelector('#current-password'),
    newPassword: container.querySelector('#new-password'),
    confirmPassword: container.querySelector('#confirm-password'),
    deleteAccountBtn: container.querySelector('#delete-account-btn'),
    showSensitiveData: container.querySelector('#show-sensitive-data'),
    autoApproveComments: container.querySelector('#auto-approve-comments'),
    saveAdvancedBtn: container.querySelector('#save-advanced-settings')
  };
}

// ====== 15. التهيئة والتنظيف ======
export function initializePage(container, params = {}) {
  if ($settingsState.isInitialized && $settingsState.container === container) {
    console.log('⚙️ الإعدادات مُهيأة مسبقاً');
    return;
  }

  console.log('⚙️ تهيئة صفحة الإعدادات v5.0.0...');
  $settingsState.container = container;
  $settingsState.currentUser = getCurrentUser();

  cacheElements(container);

  if (!$settingsState.currentUser) {
    container.innerHTML = `
      <div class="error-state">
        <i class="fas fa-exclamation-triangle"></i>
        <p>يرجى تسجيل الدخول أولاً للوصول إلى الإعدادات</p>
        <button class="btn btn-primary" data-nav-target="login">تسجيل الدخول</button>
      </div>
    `;
    return;
  }

  // تحميل البيانات وعرضها
  loadAndPopulateUserData();

  // ربط الأحداث
  const profileForm = container.querySelector('#settings-profile-form');
  if (profileForm) profileForm.addEventListener('submit', handleProfileSubmit);

  const appearanceForm = container.querySelector('#settings-appearance-form');
  if (appearanceForm) appearanceForm.addEventListener('submit', handleAppearanceSubmit);

  const securityForm = container.querySelector('#settings-security-form');
  if (securityForm) securityForm.addEventListener('submit', handleSecuritySubmit);

  if ($settingsState.elements.changeAvatarBtn) {
    $settingsState.elements.changeAvatarBtn.addEventListener('click', openJobSelector);
  }

  if ($settingsState.elements.deleteAccountBtn) {
    $settingsState.elements.deleteAccountBtn.addEventListener('click', handleDeleteAccount);
  }

  if ($settingsState.elements.saveAdvancedBtn) {
    $settingsState.elements.saveAdvancedBtn.addEventListener('click', handleAdvancedSave);
  }

  bindThemeEvents();
  initTabs();

  $settingsState.isInitialized = true;
  console.log('✅ تم تهيئة الإعدادات');
}

export function cleanupPage() {
  console.log('🧹 تنظيف صفحة الإعدادات');
  $settingsState = {
    container: null,
    currentUser: null,
    isInitialized: false,
    elements: {}
  };
}