/**
 * 🔐 views/auth/auth.js - نظام المصادقة المركزي v5.0.0 (نسخة متكاملة - معدلة)
 * ============================================================================
 * 📝 المسؤولية: إدارة نماذج تسجيل الدخول وإنشاء الحساب بشكل آمن ومتكامل.
 * ✅ التعديلات النهائية (تم تطبيقها):
 *   - إزالة دعم 'parent' بالكامل (يُسمح فقط student/teacher/moderator).
 *   - تسجيل الدخول الذاتي يُنشئ حسابات من نوع 'student' فقط.
 *   - حذف حقل user_type من النموذج (ثابت student).
 *   - إزالة الاستدعاءات المباشرة لـ navbar/drawer (الاعتماد على userStateChanged).
 *   - إصلاح تكرار الأحداث (إزالة المستمعات المباشرة للأزرار، الاعتماد على تفويض الأحداث).
 *   - تحديث التحقق من كلمة المرور: أرقام فقط (6-10 أرقام).
 *   - تعطيل زر إنشاء الحساب حتى الموافقة على شروط الاستخدام.
 *   - إصلاح رسالة "يجب الموافقة على شروط الاستخدام" بحيث تظهر فقط عند محاولة الإرسال.
 *   - إضافة عنصر error للـ terms في HTML وعرض رسالة ثابتة.
 *   - إضافة حفظ مراجع المستمعات لإزالتها في `cleanupPage` (منع تسرب الذاكرة).
 *   - توحيد التوجيه بعد التسجيل باستخدام `window.router?.redirectAfterLogin()`.
 *   - تحسين `setSubmitButtonLoading` لحفظ النص الأصلي بشكل موثوق.
 *   - إضافة `inputmode="numeric"` لحقل كلمة المرور في login (تم في HTML).
 *   - إضافة دالة `ensureModals` لتحميل `modals.js` عند الحاجة.
 * ============================================================================
 */

import {
  setSession,
  clearSession,
  getRememberedPhone,
  setRememberedPhone
} from '../../js/core/session.js';

import {
  loginUser,
  registerUser,
  checkPhoneExists
} from '../../js/core/api.js';

// ====== 1. الثوابت والتكوين ======
const AUTH_CONSTANTS = {
  VALIDATION_MESSAGES: {
    phoneRequired: 'رقم الهاتف مطلوب',
    phoneInvalid: 'رقم الهاتف يجب أن يكون 11 رقمًا ويبدأ بـ 01',
    phoneExists: 'رقم الهاتف مسجل بالفعل',
    phoneNotFound: 'رقم الهاتف غير مسجل',
    passwordRequired: 'كلمة المرور مطلوبة',
    passwordLength: 'كلمة المرور يجب أن تكون 6-10 أرقام فقط',
    passwordMismatch: 'كلمة المرور غير متطابقة',
    termsRequired: 'يجب الموافقة على شروط الاستخدام',
    ageInvalid: 'العمر يجب أن يكون بين 10 و80 سنة',
    genderRequired: 'يرجى اختيار الجنس',
    firstNameRequired: 'الاسم الأول مطلوب',
    lastNameRequired: 'اسم العائلة مطلوب',
    stageRequired: 'يرجى اختيار المرحلة الدراسية',
    gradeRequired: 'يرجى اختيار الصف الدراسي'
  },
  PASSWORD_MIN_LENGTH: 6,
  PASSWORD_MAX_LENGTH: 10,
  AGE_MIN: 10,
  AGE_MAX: 80,
  SUPPORT_PHONE: '01208388529'
};

// ====== 2. الحالة الداخلية ======
let $authState = {
  currentPage: 'login',          // 'login' أو 'register'
  isSubmitting: false,
  isInitialized: false,
  redirectAfterLogin: null,
  container: null,
  validationState: {},            // تتبع حالة التحقق لكل حقل
  // ==== إضافة حفظ مراجع المستمعات لإزالتها لاحقًا ====
  eventHandlers: {
    containerClick: null,
    loginFormSubmit: null,
    registerFormSubmit: null
  }
};

// ====== 3. دوال مساعدة للتفاعل مع مكونات UI ======
function safeToast(message, type = 'info') {
  if (window.modals?.toast) {
    window.modals.toast(message, type);
  } else {
    console.log(`[${type}] ${message}`);
  }
}

function safeNavigate(route, params = {}) {
  if (window.router?.navigateTo) {
    Promise.resolve().then(() => window.router.navigateTo(route, params));
  } else {
    console.error('❌ [Auth] Router غير متاح');
  }
}

// ==== دالة مساعدة لتحميل نظام النوافذ المنبثقة عند الحاجة ====
let modalsLoadingPromise = null;
async function ensureModals() {
  if (window.modals && typeof window.modals.showModal === 'function') return true;
  if (!modalsLoadingPromise) {
    modalsLoadingPromise = import('../../js/ui/modals.js')
      .then(() => {
        // نفترض أن modals.js يعرض دالة تهيئة (اختياري)
        if (window.initializeModals) return window.initializeModals();
        return true;
      })
      .catch(err => {
        console.error('فشل تحميل modals.js:', err);
        return false;
      });
  }
  return modalsLoadingPromise;
}

// ====== 4. دوال التحقق الأساسية ======
function validatePhone(phone) {
  return /^01[0125][0-9]{8}$/.test(phone);
}

// تعديل: كلمة المرور أرقام فقط (6-10 أرقام)
function validatePassword(password) {
  if (!password) return false;
  return /^\d{6,10}$/.test(password);
}

function validateAge(age) {
  const ageNum = parseInt(age, 10);
  return !isNaN(ageNum) && 
         ageNum >= AUTH_CONSTANTS.AGE_MIN && 
         ageNum <= AUTH_CONSTANTS.AGE_MAX;
}

// ==== عرض رسالة خطأ لحقل معين وتحديث حالة المجموعة والأيقونات (علامة واحدة فقط) ====
function showFieldError(container, fieldName, message) {
  const errorElement = container?.querySelector(`[data-error="${fieldName}"]`);
  if (errorElement) {
    errorElement.textContent = message || '';
    errorElement.style.display = message ? 'block' : 'none';
  }
  
  // 🛠️ إصلاح: كانت الدالة تبحث فقط بصيغة #register-<field>، فلا تجد أبداً
  // حقول صفحة تسجيل الدخول (login-phone / login-password التي لا تملك name)
  // فتبقى أيقونات الصح/الخطأ وتلوين .form-group معطّلة تماماً في صفحة الدخول.
  const field = container?.querySelector(`#${fieldName}`) ||
                container?.querySelector(`[name="${fieldName}"]`) ||
                container?.querySelector(`#login-${fieldName}`) ||
                container?.querySelector(`#register-${fieldName}`);
  if (field) {
    const formGroup = field.closest('.form-group, .form-checkbox');
    if (formGroup) {
      formGroup.classList.toggle('has-error', !!message);
      formGroup.classList.toggle('has-success', !message && field.value?.trim() !== '');
    }
    
// ===== إدارة أيقونات التحقق (تظهر علامة واحدة فقط لكلا الصفحتين) =====
const inputContainer = field.closest('.input-wrapper, .input-with-icon');
const validationIcon = inputContainer?.querySelector('.input-validation-icon');
if (validationIcon) {
  const successIcon = validationIcon.querySelector('.success-icon');
  const errorIcon = validationIcon.querySelector('.error-icon');
  
  if (message) {
    // حقل غير صالح: إظهار علامة الخطأ فقط
    validationIcon.classList.add('show');
    if (successIcon) successIcon.style.display = 'none';
    if (errorIcon) errorIcon.style.display = 'inline-block';
  } else if (field.value?.trim() !== '') {
    // حقل صالح وفيه قيمة: إظهار علامة الصواب فقط
    validationIcon.classList.add('show');
    if (successIcon) successIcon.style.display = 'inline-block';
    if (errorIcon) errorIcon.style.display = 'none';
  } else {
    // حقل فارغ: إخفاء الأيقونات تماماً
    validationIcon.classList.remove('show');
    if (successIcon) successIcon.style.display = 'none';
    if (errorIcon) errorIcon.style.display = 'none';
  }
}
}
  
  if (fieldName && message) {
    $authState.validationState[fieldName] = false;
  } else if (fieldName) {
    $authState.validationState[fieldName] = true;
  }
}

function clearAllErrors(container) {
  container.querySelectorAll('[data-error]').forEach(el => {
    el.textContent = '';
    el.style.display = 'none';
  });
  container.querySelectorAll('.form-group, .form-checkbox').forEach(el => {
    el.classList.remove('has-error', 'has-success');
  });
  $authState.validationState = {};
}

// ====== 5. التحقق الفوري (Real-time Validation) ======

/**
 * التحقق من رقم الهاتف مع فحص التوفر عبر API (مع debouncing بسيط)
 */
let phoneCheckTimer = null;
async function validatePhoneField(container, phoneValue, checkExists = false) {
  const phone = phoneValue?.trim() || '';
  let error = '';
  
  if (!phone) {
    error = AUTH_CONSTANTS.VALIDATION_MESSAGES.phoneRequired;
  } else if (!validatePhone(phone)) {
    error = AUTH_CONSTANTS.VALIDATION_MESSAGES.phoneInvalid;
  } else if (checkExists && $authState.currentPage === 'register') {
    // إظهار حالة تحميل مؤقتة
    const phoneInput = container?.querySelector('#register-phone');
    const wrapper = phoneInput?.closest('.input-wrapper');
    if (wrapper) {
      wrapper.classList.add('is-checking');
    }
    try {
      const exists = await checkPhoneExists(phone);
      if (exists) {
        error = AUTH_CONSTANTS.VALIDATION_MESSAGES.phoneExists;
      }
    } catch (e) {
      console.warn('⚠️ فشل التحقق من وجود الرقم');
    } finally {
      if (wrapper) wrapper.classList.remove('is-checking');
    }
  }
  
  showFieldError(container, 'phone', error);
  return !error;
}

/**
 * التحقق من كلمة المرور وتأكيدها
 */
function validatePasswordFields(container, password, confirmPassword) {
  let passError = '';
  let confirmError = '';
  
  if (!password) {
    passError = AUTH_CONSTANTS.VALIDATION_MESSAGES.passwordRequired;
  } else if (!validatePassword(password)) {
    passError = AUTH_CONSTANTS.VALIDATION_MESSAGES.passwordLength;
  }
  
  showFieldError(container, 'password', passError);
  
  if ($authState.currentPage === 'register') {
    if (!confirmPassword && confirmPassword !== '') {
      confirmError = AUTH_CONSTANTS.VALIDATION_MESSAGES.passwordRequired;
    } else if (password !== confirmPassword) {
      confirmError = AUTH_CONSTANTS.VALIDATION_MESSAGES.passwordMismatch;
    }
    showFieldError(container, 'confirm-password', confirmError);
  }
  
  return !passError && !confirmError;
}

/**
 * التحقق من الاسم الأول واسم العائلة
 */
function validateNameFields(container, firstName, lastName) {
  let firstNameError = '', lastNameError = '';
  
  if (!firstName?.trim()) {
    firstNameError = AUTH_CONSTANTS.VALIDATION_MESSAGES.firstNameRequired;
  }
  if (!lastName?.trim()) {
    lastNameError = AUTH_CONSTANTS.VALIDATION_MESSAGES.lastNameRequired;
  }
  
  showFieldError(container, 'first-name', firstNameError);
  showFieldError(container, 'last-name', lastNameError);
  
  return !firstNameError && !lastNameError;
}

/**
 * التحقق من العمر
 */
function validateAgeField(container, age) {
  let error = '';
  
  if (!age) {
    error = 'العمر مطلوب';
  } else if (!validateAge(age)) {
    error = AUTH_CONSTANTS.VALIDATION_MESSAGES.ageInvalid;
  }
  
  showFieldError(container, 'age', error);
  return !error;
}

/**
 * التحقق من المرحلة والصف (للطلاب فقط – وهو الحال دائماً في التسجيل الذاتي)
 */
function validateStageGradeFields(container, stage, grade) {
  let stageError = '', gradeError = '';
  
  if (!stage) {
    stageError = AUTH_CONSTANTS.VALIDATION_MESSAGES.stageRequired;
  }
  if (!grade) {
    gradeError = AUTH_CONSTANTS.VALIDATION_MESSAGES.gradeRequired;
  }
  
  showFieldError(container, 'stage', stageError);
  showFieldError(container, 'grade', gradeError);
  
  return !stageError && !gradeError;
}

/**
 * التحقق الشامل من نموذج التسجيل وتحديث حالة زر الإرسال
 * 🔹 تم تعديل: إزالة safeToast للشروط واستخدام showFieldError
 */
async function validateRegisterForm(form, container) {
  const firstName = form.querySelector('#register-first-name')?.value.trim();
  const lastName = form.querySelector('#register-last-name')?.value.trim();
  const gender = form.querySelector('#register-gender')?.value;
  const age = form.querySelector('#register-age')?.value;
  const phone = form.querySelector('#register-phone')?.value.trim();
  const password = form.querySelector('#register-password')?.value;
  const confirmPassword = form.querySelector('#register-confirm-password')?.value;
  const stage = form.querySelector('#register-stage')?.value;
  const grade = form.querySelector('#register-grade')?.value;
  const termsAgree = form.querySelector('#terms-agree')?.checked;
  
  let isValid = true;
  
  isValid = validateNameFields(container, firstName, lastName) && isValid;
  
  if (!gender) {
    showFieldError(container, 'gender', AUTH_CONSTANTS.VALIDATION_MESSAGES.genderRequired);
    isValid = false;
  } else {
    showFieldError(container, 'gender', '');
  }
  
  isValid = validateAgeField(container, age) && isValid;
  isValid = await validatePhoneField(container, phone, true) && isValid;
  isValid = validatePasswordFields(container, password, confirmPassword) && isValid;
  isValid = validateStageGradeFields(container, stage, grade) && isValid;
  
  // 🔹 إظهار خطأ الشروط في العنصر المخصص فقط (بدون toast)
  if (!termsAgree) {
    showFieldError(container, 'terms', AUTH_CONSTANTS.VALIDATION_MESSAGES.termsRequired);
    isValid = false;
  } else {
    showFieldError(container, 'terms', '');
  }
  
  const submitBtn = form.querySelector('[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = !isValid || $authState.isSubmitting;
  }
  
  return isValid;
}

/**
 * التحقق الشامل من نموذج تسجيل الدخول
 */
function validateLoginForm(form, container) {
  const phone = form.querySelector('#login-phone')?.value.trim();
  const password = form.querySelector('#login-password')?.value;
  
  let isValid = true;
  
  if (!phone) {
    showFieldError(container, 'phone', AUTH_CONSTANTS.VALIDATION_MESSAGES.phoneRequired);
    isValid = false;
  } else if (!validatePhone(phone)) {
    showFieldError(container, 'phone', AUTH_CONSTANTS.VALIDATION_MESSAGES.phoneInvalid);
    isValid = false;
  } else {
    showFieldError(container, 'phone', '');
  }
  
  if (!password) {
    showFieldError(container, 'password', AUTH_CONSTANTS.VALIDATION_MESSAGES.passwordRequired);
    isValid = false;
  } else if (!validatePassword(password)) {
    showFieldError(container, 'password', AUTH_CONSTANTS.VALIDATION_MESSAGES.passwordLength);
    isValid = false;
  } else {
    showFieldError(container, 'password', '');
  }
  
  const submitBtn = form.querySelector('[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = !isValid || $authState.isSubmitting;
  }
  
  return isValid;
}

// ====== 6. معالجة تقديم النماذج ======

async function handleLoginSubmit(event) {
  event.preventDefault();

  if ($authState.isSubmitting) return;

  const form = event.currentTarget;
  const container = $authState.container;

  // ✅ تحقق سريع: إذا لم يتم إدخال جميع البيانات المطلوبة
  const phone = form.querySelector('#login-phone')?.value.trim();
  const password = form.querySelector('#login-password')?.value;

  if (!phone || !password) {
    if (window.modals?.toast) {
      window.modals.toast('⚠️ يجب إدخال رقم الهاتف وكلمة المرور قبل تسجيل الدخول', 'warning');
    } else {
      alert('⚠️ يجب إدخال رقم الهاتف وكلمة المرور قبل تسجيل الدخول');
    }
    return;
  }

  if (!validateLoginForm(form, container)) {
    return;
  }

  const rememberMe = form.querySelector('#remember-me')?.checked || false;

  // 🛠️ إصلاح: كانت 'loading' تُضاف على الفورم قبل أي تحقق، فإذا توقف التنفيذ
  // مبكراً (حقل ناقص أو تحقق فاشل) كانت تبقى عالقة للأبد لأن لا شيء يزيلها
  // في هذا المسار. أصبحت تُضاف فقط بعد اجتياز كل التحقق، أي قبل الإرسال الفعلي.
  form.classList.add('loading');
  $authState.isSubmitting = true;
  setSubmitButtonLoading(form, true);
  safeToast('جاري تسجيل الدخول...', 'info');

  try {
    const userData = await loginUser(phone, password);
    await setSession(userData, rememberMe);

    if (rememberMe) {
      setRememberedPhone(phone);
    } else {
      setRememberedPhone(null);
    }

    safeToast(`مرحباً ${userData.full_name || 'بك'}! تم تسجيل الدخول بنجاح`, 'success');
    window.router?.redirectAfterLogin();

  } catch (error) {
    console.error('❌ فشل تسجيل الدخول:', error);

    // ✅ رسائل أوضح عند الخطأ
    if (error.message.includes('غير مسجل')) {
      showFieldError(container, 'phone', '⚠️ رقم الهاتف غير مسجل');
      safeToast('رقم الهاتف غير صحيح أو غير مسجل', 'error');
    } else if (error.message.includes('غير صحيحة')) {
      showFieldError(container, 'password', '⚠️ كلمة المرور غير صحيحة');
      safeToast('كلمة المرور غير صحيحة، حاول مرة أخرى', 'error');
    } else {
      safeToast(error.message || 'حدث خطأ أثناء تسجيل الدخول', 'error');
    }
  } finally {
    form.classList.remove('loading');
    $authState.isSubmitting = false;
    setSubmitButtonLoading(form, false);
    validateLoginForm(form, container);
  }
}


async function handleRegisterSubmit(event) {
  event.preventDefault();

  if ($authState.isSubmitting) return;

  const form = event.currentTarget;
  const container = $authState.container;

  // ✅ تحقق سريع: إذا لم يتم إكمال جميع الحقول
  const requiredFields = [
    '#register-first-name',
    '#register-last-name',
    '#register-gender',
    '#register-age',
    '#register-phone',
    '#register-password',
    '#register-confirm-password',
    '#register-stage',
    '#register-grade'
  ];

  let allFilled = requiredFields.every(sel => {
    const el = form.querySelector(sel);
    return el && el.value && el.value.trim() !== '';
  });

  if (!allFilled) {
    if (window.modals?.toast) {
      window.modals.toast('️ يجب إكمال جميع الحقول قبل الضغط على زر إنشاء الحساب', 'warning');
    } else {
      alert('️ يجب إكمال جميع الحقول قبل الضغط على زر إنشاء الحساب');
    }
    return;
  }

  const termsAgree = form.querySelector('#terms-agree')?.checked;
  if (!termsAgree) {
    safeToast(AUTH_CONSTANTS.VALIDATION_MESSAGES.termsRequired, 'warning');
    showFieldError(container, 'terms', AUTH_CONSTANTS.VALIDATION_MESSAGES.termsRequired);
    return;
  }

  if (!await validateRegisterForm(form, container)) {
    return;
  }

  const firstName = form.querySelector('#register-first-name')?.value.trim();
  const lastName = form.querySelector('#register-last-name')?.value.trim();
  const gender = form.querySelector('#register-gender')?.value;
  const age = form.querySelector('#register-age')?.value;
  const phone = form.querySelector('#register-phone')?.value.trim();
  const password = form.querySelector('#register-password')?.value;
  const stage = form.querySelector('#register-stage')?.value;
  const grade = form.querySelector('#register-grade')?.value;
  const notificationsAgree = form.querySelector('#notifications-agree')?.checked || false;

  // 🛠️ إصلاح: نفس مشكلة handleLoginSubmit — 'loading' كانت تُضاف قبل كل
  // تحقق فتبقى عالقة على الفورم عند أي توقف مبكر. تُضاف الآن فقط بعد
  // نجاح كل عمليات التحقق، مباشرة قبل إرسال الطلب الفعلي.
  form.classList.add('loading');
  $authState.isSubmitting = true;
  setSubmitButtonLoading(form, true);
  safeToast('جاري إنشاء الحساب...', 'info');

  try {
    const userData = {
      firstName,
      lastName,
      gender,
      age: parseInt(age, 10),
      phone,
      password,
      user_type: 'student',          // 👈 التسجيل الذاتي ينتج حساب طالب فقط
      stage,
      grade: parseInt(grade, 10),
      notifications: notificationsAgree
    };

    await registerUser(userData);

    // تسجيل الدخول التلقائي
    const loggedInUser = await loginUser(phone, password);
    await setSession(loggedInUser, true);

    safeToast('تم إنشاء الحساب بنجاح! مرحباً بك في بيولوجست', 'success');
    window.router?.redirectAfterLogin();

  } catch (error) {
    console.error('❌ فشل إنشاء الحساب:', error);

    if (error.message.includes('مسجل بالفعل')) {
      showFieldError(container, 'phone', AUTH_CONSTANTS.VALIDATION_MESSAGES.phoneExists);
    } else {
      safeToast(error.message || 'حدث خطأ أثناء إنشاء الحساب', 'error');
    }
  } finally {
    form.classList.remove('loading');
    $authState.isSubmitting = false;
    setSubmitButtonLoading(form, false);
    validateRegisterForm(form, container);
  }
}


// ====== 7. وظائف النوافذ المنبثقة (Modals) ======
// 🔹 تم تعديل: استخدام ensureModals لضمان توفر window.modals

async function showTermsModal() {
  const ready = await ensureModals();
  if (!ready) {
    safeToast('عذراً، لا يمكن عرض شروط الاستخدام حالياً. حاول مجدداً.', 'error');
    return;
  }

  const termsHtml = `
    <div class="terms-content" style="max-height: 60vh; overflow-y: auto; padding: 1rem;">
      <h3 style="color: var(--primary); margin-bottom: 1rem;">📜 شروط استخدام منصة بيولوجست</h3>
      <p>مرحبًا بك في منصة بيولوجست التعليمية. باستخدامك للمنصة، فإنك توافق على الشروط التالية:</p>
      <ol style="margin-right: 1.5rem; line-height: 1.8;">
        <li><strong>الاستخدام التعليمي:</strong> المنصة مخصصة للأغراض التعليمية فقط. يمنع استخدامها لأي أغراض تجارية أو غير قانونية.</li>
        <li><strong>المحتوى:</strong> جميع الدروس والامتحانات والمحتوى المرئي والمكتوب هو ملك للمنصة والأستاذ محمد إبراهيم طه. يمنع نسخه أو توزيعه دون إذن.</li>
        <li><strong>الحسابات:</strong> أنت مسؤول عن الحفاظ على سرية بيانات حسابك. أي نشاط يتم من خلال حسابك يعتبر مسؤوليتك.</li>
        <li><strong>السلوك:</strong> يمنع نشر أي محتوى مسيء أو غير لائق في التعليقات أو المجموعات. نحتفظ بحق حذف أي محتوى مخالف.</li>
        <li><strong>الخصوصية:</strong> نتعامل مع بياناتك وفقًا لسياسة الخصوصية الخاصة بنا.</li>
        <li><strong>التعديلات:</strong> قد نُجري تعديلات على هذه الشروط من وقت لآخر، وسيتم إعلامك بها.</li>
      </ol>
      <p>إذا كان لديك أي استفسار، تواصل مع الدعم الفني.</p>
    </div>
  `;
  
  window.modals.showModal({
    title: 'شروط الاستخدام',
    html: termsHtml,
    size: 'medium',
    buttons: [{ text: 'موافق', role: 'confirm', type: 'primary' }]
  });
}

async function showPrivacyModal() {
  const ready = await ensureModals();
  if (!ready) {
    safeToast('عذراً، لا يمكن عرض سياسة الخصوصية حالياً. حاول مجدداً.', 'error');
    return;
  }

  const privacyHtml = `
    <div class="privacy-content" style="max-height: 60vh; overflow-y: auto; padding: 1rem;">
      <h3 style="color: var(--primary); margin-bottom: 1rem;">🔒 سياسة خصوصية منصة بيولوجست</h3>
      <p>خصوصيتك تهمنا. توضح هذه السياسة كيفية جمعنا واستخدامنا لمعلوماتك الشخصية.</p>
      <ul style="margin-right: 1.5rem; line-height: 1.8;">
        <li><strong>المعلومات التي نجمعها:</strong> الاسم، رقم الهاتف، العمر، المرحلة الدراسية، وتقدمك التعليمي.</li>
        <li><strong>كيفية الاستخدام:</strong> نستخدم البيانات لتقديم تجربة تعليمية مخصصة، وتحسين أدائك، وإرسال إشعارات مهمة.</li>
        <li><strong>المشاركة:</strong> لا نشارك بياناتك مع أطراف خارجية إلا بموافقتك أو لأغراض تشغيلية أساسية (مثل Firebase).</li>
        <li><strong>الأمان:</strong> نستخدم تشفيرًا قويًا (AES-GCM) لحماية بيانات الجلسة وكلمات المرور.</li>
        <li><strong>حقوقك:</strong> يمكنك طلب تعديل بياناتك أو حذف حسابك في أي وقت من خلال إعدادات الملف الشخصي.</li>
      </ul>
      <p>باستمرارك في استخدام المنصة، أنت توافق على هذه السياسة.</p>
    </div>
  `;
  
  window.modals.showModal({
    title: 'سياسة الخصوصية',
    html: privacyHtml,
    size: 'medium',
    buttons: [{ text: 'موافق', role: 'confirm', type: 'primary' }]
  });
}

function showForgotPasswordModal() {
  const supportNumber = AUTH_CONSTANTS.SUPPORT_PHONE;
  const messageHtml = `
    <div style="text-align: center; padding: 1.5rem 0;">
      <i class="fas fa-lock" style="font-size: 3rem; color: var(--primary); margin-bottom: 1rem;"></i>
      <h3 style="margin-bottom: 1rem;">🔐 نسيت كلمة المرور؟</h3>
      <p style="margin-bottom: 1.5rem;">عذراً، لا يمكن استعادة كلمة المرور تلقائياً في هذا الإصدار.</p>
      <p style="margin-bottom: 1.5rem; background: var(--surface-light); padding: 1rem; border-radius: 12px;">
        <i class="fas fa-headset"></i> 
        <strong>يرجى التواصل مباشرة مع المشرف أو الدعم الفني لحل المشكلة:</strong>
        <br>
        <a href="tel:+2${supportNumber}" dir="ltr" style="font-size: 1.5rem; font-weight: bold; color: var(--primary);">${supportNumber}</a>
        <br>
        <span style="font-size: 0.9rem;">(اضغط على الرقم للاتصال)</span>
      </p>
      <p>أو يمكنك التواصل عبر واتساب على نفس الرقم.</p>
    </div>
  `;
  // لا نحتاج ensureModals هنا لأن showModal قد يكون موجوداً بالفعل، وندعم window.modals?.showModal
  if (window.modals?.showModal) {
    window.modals.showModal({
      title: 'استعادة كلمة المرور',
      html: messageHtml,
      size: 'small',
      buttons: [{ text: 'حسنًا', role: 'confirm', type: 'primary' }]
    });
  } else {
    safeToast('عذراً، لا يمكن عرض نافذة استعادة كلمة المرور حالياً.', 'error');
  }
}

function handleSocialLogin(provider) {
  const message = `🚀 ميزة تسجيل الدخول عبر ${provider} ستُتاح قريبًا جدًا!`;
  safeToast(message, 'info', 4000);
}

// ====== 8. دوال مساعدة للأزرار ======
// 🔹 تم تحسين: حفظ النص الأصلي في data-original-text بشكل موثوق
function setSubmitButtonLoading(form, isLoading) {
  const btn = form?.querySelector('[type="submit"]');
  if (!btn) return;
  
  if (isLoading) {
    btn.disabled = true;
    // حفظ النص الأصلي (من .btn-text أو النص الكامل)
    const textSpan = btn.querySelector('.btn-text');
    const originalText = textSpan ? textSpan.innerHTML : btn.innerHTML;
    btn.setAttribute('data-original-text', originalText);
    
    if (textSpan) {
      textSpan.innerHTML = 'جاري التحميل...';
    } else {
      btn.innerHTML = 'جاري التحميل...';
    }
    let spinner = btn.querySelector('.fa-spinner');
    if (!spinner) {
      spinner = document.createElement('i');
      spinner.className = 'fas fa-spinner fa-spin btn-icon';
      btn.appendChild(spinner);
    }
  } else {
    btn.disabled = false;
    const originalText = btn.getAttribute('data-original-text');
    if (originalText) {
      const textSpan = btn.querySelector('.btn-text');
      if (textSpan) {
        textSpan.innerHTML = originalText;
      } else {
        btn.innerHTML = originalText;
      }
      btn.removeAttribute('data-original-text');
    }
    btn.querySelectorAll('.fa-spinner').forEach(el => el.remove());
  }
}

// 🛠️ إصلاح جوهري: كانت الدالة تُستدعى من مستمع مفوَّض على الحاوية بالكامل،
// و event.currentTarget كان يشير دائماً إلى عنصر الحاوية نفسها (لأنه العنصر
// الذي رُبط عليه المستمع)، وليس زر العين الذي ضغط عليه المستخدم فعلياً —
// فتفشل .closest('.input-with-icon') دائماً ولا يعمل إظهار/إخفاء كلمة المرور إطلاقاً.
function handlePasswordToggle(button) {
  if (!button) return;
  const input = button.closest('.input-with-icon')?.querySelector('input[type="password"], input[type="text"]');
  if (!input) return;
  
  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  
  const eyeIcon = button.querySelector('.fa-eye');
  const eyeSlashIcon = button.querySelector('.fa-eye-slash');
  if (eyeIcon && eyeSlashIcon) {
    eyeIcon.style.display = isPassword ? 'none' : 'inline-block';
    eyeSlashIcon.style.display = isPassword ? 'inline-block' : 'none';
  }
}

function handleStageChange(event) {
  const stage = event.target.value;
  const gradeSelect = $authState.container?.querySelector('#register-grade');
  if (!gradeSelect) return;
  
  gradeSelect.innerHTML = '';
  gradeSelect.disabled = !stage;
  
  if (!stage) {
    gradeSelect.innerHTML = '<option value="">اختر الصف بعد اختيار المرحلة الدراسية</option>';
    return;
  }
  
  const grades = stage === 'preparatory' 
    ? ['1', '2', '3'].map(v => ({ value: v, label: `الصف ${v} الإعدادي` }))
    : ['1', '2', '3'].map(v => ({ value: v, label: `الصف ${v} الثانوي` }));
  
  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = 'اختر الصف الدراسي';
  defaultOption.disabled = true;
  defaultOption.selected = true;
  gradeSelect.appendChild(defaultOption);
  
  grades.forEach(g => {
    const option = document.createElement('option');
    option.value = g.value;
    option.textContent = g.label;
    gradeSelect.appendChild(option);
  });
  
  gradeSelect.disabled = false;
}

// ====== 9. ربط الأحداث (مع حفظ المراجع) ======
function bindLoginEvents(container) {
  const form = container.querySelector('#login-form');
  if (form) {
    const submitHandler = handleLoginSubmit;
    form.addEventListener('submit', submitHandler);
    $authState.eventHandlers.loginFormSubmit = submitHandler;
    
    // التحقق الفوري
    const phoneInput = form.querySelector('#login-phone');
    const passwordInput = form.querySelector('#login-password');
    
    phoneInput?.addEventListener('input', (e) => {
      validatePhoneField(container, e.target.value, false);
      validateLoginForm(form, container);
    });
    passwordInput?.addEventListener('input', () => {
      validateLoginForm(form, container);
    });
  }
  
  // تفويض الأحداث للحاوية (مع حفظ المرجع)
  const clickHandler = (e) => {
    // زر تبديل كلمة المرور
    const toggleBtn = e.target.closest('.toggle-password');
    if (toggleBtn) {
      handlePasswordToggle(toggleBtn);
      return;
    }
    
    // زر نسيت كلمة المرور
    const forgotBtn = e.target.closest('[data-action="forgot-password"]');
    if (forgotBtn) {
      e.preventDefault();
      showForgotPasswordModal();
      return;
    }
    
    // أزرار الشبكات الاجتماعية
    const socialBtn = e.target.closest('[data-social]');
    if (socialBtn) {
      e.preventDefault();
      handleSocialLogin(socialBtn.dataset.social === 'facebook' ? 'فيسبوك' : 'جوجل');
      return;
    }
  };
  container.addEventListener('click', clickHandler);
  $authState.eventHandlers.containerClick = clickHandler;
}

function bindRegisterEvents(container) {
  const form = container.querySelector('#register-form');
  if (form) {
    const submitHandler = handleRegisterSubmit;
    form.addEventListener('submit', submitHandler);
    $authState.eventHandlers.registerFormSubmit = submitHandler;
    
    // ربط أحداث التحقق الفوري
    const firstName = form.querySelector('#register-first-name');
    const lastName = form.querySelector('#register-last-name');
    const gender = form.querySelector('#register-gender');
    const age = form.querySelector('#register-age');
    const phone = form.querySelector('#register-phone');
    const password = form.querySelector('#register-password');
    const confirmPassword = form.querySelector('#register-confirm-password');
    const stage = form.querySelector('#register-stage');
    const grade = form.querySelector('#register-grade');
    const terms = form.querySelector('#terms-agree');
    
    firstName?.addEventListener('input', () => validateRegisterForm(form, container));
    lastName?.addEventListener('input', () => validateRegisterForm(form, container));
    gender?.addEventListener('change', () => validateRegisterForm(form, container));
    age?.addEventListener('input', () => validateRegisterForm(form, container));
    
    phone?.addEventListener('input', (e) => {
      validatePhoneField(container, e.target.value, false);
      validateRegisterForm(form, container);
    });
    phone?.addEventListener('blur', async (e) => {
      await validatePhoneField(container, e.target.value, true);
      validateRegisterForm(form, container);
    });
    
    password?.addEventListener('input', () => validateRegisterForm(form, container));
    confirmPassword?.addEventListener('input', () => validateRegisterForm(form, container));
    
    stage?.addEventListener('change', handleStageChange);
    grade?.addEventListener('change', () => validateRegisterForm(form, container));
    terms?.addEventListener('change', () => {
      const submitBtn = form.querySelector('[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = !terms.checked;
      }
      validateRegisterForm(form, container);
    });
  }
  
  // تفويض الأحداث للحاوية (مع حفظ المرجع)
  const clickHandler = (e) => {
    // زر عرض شروط الاستخدام
    const termsBtn = e.target.closest('[data-action="show-terms"]');
    if (termsBtn) {
      e.preventDefault();
      showTermsModal();
      return;
    }
    
    // زر عرض سياسة الخصوصية
    const privacyBtn = e.target.closest('[data-action="show-privacy"]');
    if (privacyBtn) {
      e.preventDefault();
      showPrivacyModal();
      return;
    }
    
    // زر تبديل كلمة المرور
    const toggleBtn = e.target.closest('.toggle-password');
    if (toggleBtn) {
      handlePasswordToggle(toggleBtn);
      return;
    }
  };
  // إذا كان هناك مستمع سابق، قم بإزالته أولاً (لتجنب التكرار في حالة إعادة التهيئة)
  if ($authState.eventHandlers.containerClick) {
    container.removeEventListener('click', $authState.eventHandlers.containerClick);
  }
  container.addEventListener('click', clickHandler);
  $authState.eventHandlers.containerClick = clickHandler;
}

function prefillRememberedPhone(container) {
  const rememberedPhone = getRememberedPhone();
  if (rememberedPhone) {
    const phoneInput = container.querySelector('#login-phone');
    if (phoneInput) {
      phoneInput.value = rememberedPhone;
      const wrapper = phoneInput.closest('.input-wrapper');
      if (wrapper && validatePhone(rememberedPhone)) {
        wrapper.classList.add('has-success');
      }
    }
  }
}

// ====== 10. التهيئة والتنظيف (لـ Router) ======
export function initializePage(container, params = {}) {
  if ($authState.isInitialized && $authState.container === container) {
    return;
  }
  
  console.log('🔐 [Auth] تهيئة صفحة المصادقة...');
  
  try {
    $authState.container = container;
    $authState.validationState = {};
    
    const pageElement = container.querySelector('[data-page]');
    $authState.currentPage = pageElement?.dataset.page || 'login';
    
    // إذا كان المستخدم مسجلاً بالفعل، نعيد التوجيه
    if (window.$currentUser) {
      safeNavigate('home');
      return;
    }
    
    clearAllErrors(container);
    
    if ($authState.currentPage === 'login') {
      bindLoginEvents(container);
      prefillRememberedPhone(container);
    } else {
      bindRegisterEvents(container);
    }
    
    $authState.isInitialized = true;
    console.log(`✅ [Auth] تم تهيئة صفحة ${$authState.currentPage}`);
    
  } catch (error) {
    console.error('❌ [Auth] فشل تهيئة الصفحة:', error);
    safeToast('حدث خطأ أثناء تحميل الصفحة', 'error');
  }
}

export function cleanupPage() {
  console.log('🧹 [Auth] تنظيف صفحة المصادقة...');
  
  if ($authState.container) {
    // إزالة مستمعات submit
    const loginForm = $authState.container.querySelector('#login-form');
    if (loginForm && $authState.eventHandlers.loginFormSubmit) {
      loginForm.removeEventListener('submit', $authState.eventHandlers.loginFormSubmit);
    }
    const registerForm = $authState.container.querySelector('#register-form');
    if (registerForm && $authState.eventHandlers.registerFormSubmit) {
      registerForm.removeEventListener('submit', $authState.eventHandlers.registerFormSubmit);
    }
    
    // إزالة مستمع الحاوية العام
    if ($authState.eventHandlers.containerClick) {
      $authState.container.removeEventListener('click', $authState.eventHandlers.containerClick);
    }
  }
  
  // إعادة تعيين الحالة بالكامل
  $authState = {
    currentPage: 'login',
    isSubmitting: false,
    isInitialized: false,
    redirectAfterLogin: null,
    container: null,
    validationState: {},
    eventHandlers: {
      containerClick: null,
      loginFormSubmit: null,
      registerFormSubmit: null
    }
  };
  
  console.log('✅ [Auth] تم تنظيف الصفحة');
}

// ====== 11. تصدير الدوال العامة ======
export { handleLoginSubmit, handleRegisterSubmit };