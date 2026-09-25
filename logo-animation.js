/**
 * 🧬 js/ui/logo-animation.js – دورة حركة اللوجو الديناميكي (B/DNA + iologist) v2.0.0
 * ============================================================================
 * 📝 المسؤولية: التحكم في توقيت دورة حركة اللوجو الديناميكي داخل الـNavbar فقط
 *    (المواصفة الكاملة والقرارات التصميمية في docs/LOGO_IDENTITY.md — القسم 6).
 *    منطق الدورة والتوقيت هنا منقول حرفيًا من مختبر الاختبار (Logo Identity Lab)
 *    عشان يدّي نفس النتيجة البصرية بالظبط.
 *
 * 🧩 التكامل:
 *   - الحركة البصرية نفسها (transform / clip-path) بالكامل CSS transitions معرّفة
 *     في navbar.css، مربوطة بخاصيتين على .dynamic-logo:
 *       [data-state="compact|full"]  → حالة الكلمة (مختفية/مكشوفة) وحجم B
 *       [data-phase="closing"]       → إزاحة B الإضافية وقت الإغلاق فقط
 *   - هذا الملف مسؤوليته الوحيدة: تبديل data-state / data-phase بالتوقيت الصحيح —
 *     لا يلمس أي تنسيق أو تحريك بصري مباشرة، ولا علاقة له بلون اللوجو (بيتغيّر
 *     تلقائيًا عبر متغيرات CSS مع الثيم، بدون أي تدخل من هنا).
 *   - يُستدعى حصريًا من js/ui/navbar.js (startLogoAnimation / stopLogoAnimation)
 *     ضمن دورة حياة الـNavbar (init → destroy).
 *
 * ♿ إمكانية الوصول والأداء:
 *   - يحترم prefers-reduced-motion فورًا عند البدء، ويستجيب لتغييره حيًا
 *     (تجميد على الحالة المختصرة بدون أي حركة).
 *   - يوقف الدورة تلقائيًا عند إخفاء التبويب (Page Visibility) ويستأنفها فورًا
 *     عند العودة، توفيرًا للموارد والبطارية.
 *   - تنظيف كامل للمؤقتات والمستمعين عند stopLogoAnimation() — بدون Memory Leaks.
 * ============================================================================
 */

// ==== 1. الثوابت (مطابقة لمختبر الاختبار — LOGO_IDENTITY_LAB) ====
const STATE_COMPACT = 'compact';
const STATE_FULL = 'full';
const PHASE_CLOSING = 'closing';
const MOTION_STEP_MS = 900;
const HOLD_DURATION_MS = 3000;
const LOOP_GAP_MS = 1;
const RETRY_DELAY_MS = 1000;

// ==== 2. حالة الوحدة الداخلية ====
let $logo = null;
let motionQuery = null;
let timerId = null;
let isRunning = false;

// ==== 3. أدوات مساعدة ====

/** 3.1 إلغاء أي مؤقت معلّق قبل جدولة واحد جديد */
function clearPendingTimer() {
  if (timerId) {
    clearTimeout(timerId);
    timerId = null;
  }
}

/** 3.2 هل تفضيل تقليل الحركة مفعّل حاليًا؟ */
function prefersReducedMotion() {
  return !!(motionQuery && motionQuery.matches);
}

/** 3.3 جدولة خطوة تالية في الدورة، مسجّلة للتنظيف عند stopLogoAnimation() */
function after(ms, fn) {
  timerId = setTimeout(fn, ms);
}

/** 3.4 ضبط data-state / data-phase على عنصر اللوجو دفعة واحدة */
function setPhase(state, phase) {
  if (!$logo) return;
  $logo.dataset.state = state;
  if (phase) {
    $logo.dataset.phase = phase;
  } else {
    delete $logo.dataset.phase;
  }
}

// ==== 4. دورة الحركة الأساسية ====
// ① compact (البداية) → ② opening (فتح) → ③ hold (ثبات 3 ثوانٍ)
// → ④ closing (إغلاق: B يكمل لليمين حتى يلامس آخر حرف)
// → ⑤ homing (B يرجع فورًا لموضعه الأصلي) → ① compact → تكرار
function runCycle() {
  if (!isRunning || !$logo) return;

  // تفضيل تقليل الحركة أو التبويب مخفي → تجميد على الحالة المختصرة وإعادة المحاولة لاحقًا
  if (prefersReducedMotion() || document.hidden) {
    setPhase(STATE_COMPACT);
    after(RETRY_DELAY_MS, runCycle);
    return;
  }

  // ② الفتح: B يصغر وينزلق بجانب الكلمة، والكلمة تنكشف بـclip-path في نفس اللحظة
  setPhase(STATE_FULL);

  // ③ الثبات الكامل لمدة HOLD_DURATION_MS بعد اكتمال حركة الفتح
  after(MOTION_STEP_MS + HOLD_DURATION_MS, () => {
    if (!isRunning || !$logo) return;

    // ④ الإغلاق: الكلمة تبدأ تنغلق فورًا، وB يكبر ويكمل مساره لليمين حتى نهايتها
    setPhase(STATE_COMPACT, PHASE_CLOSING);

    after(MOTION_STEP_MS, () => {
      if (!isRunning || !$logo) return;

      // ⑤ الرجوع للأصل: إزالة data-phase ترجع B فورًا لموضعه وحجمه الأصليين
      setPhase(STATE_COMPACT);

      after(MOTION_STEP_MS, () => {
        if (!isRunning || !$logo) return;

        // ① استقرار على الحالة المختصرة قبل بدء دورة جديدة
        setPhase(STATE_COMPACT);

        after(LOOP_GAP_MS, () => {
          if (!isRunning || !$logo) return;
          runCycle();
        });
      });
    });
  });
}

// ==== 5. مستمعو الأحداث الخارجية ====

/** 5.1 تغيير تفضيل تقليل الحركة حيًا أثناء عمل الدورة */
function handleMotionPreferenceChange() {
  if (prefersReducedMotion() && $logo) {
    clearPendingTimer();
    setPhase(STATE_COMPACT);
    after(RETRY_DELAY_MS, runCycle);
  }
}

/** 5.2 العودة للتبويب أثناء التجميد → استئناف الدورة فورًا بدل انتظار الفاصل */
function handleVisibilityChange() {
  if (!document.hidden && isRunning) {
    clearPendingTimer();
    runCycle();
  }
}

// ==== 6. الواجهة العامة (تُستدعى حصريًا من navbar.js) ====

export function startLogoAnimation(logoEl) {
  if (!logoEl) {
    console.warn('[LogoAnimation] عنصر اللوجو غير موجود — تم إلغاء بدء الحركة');
    return;
  }

  // تنظيف أي دورة سابقة قبل البدء من جديد (يمنع تراكم المؤقتات والمستمعين)
  stopLogoAnimation();

  $logo = logoEl;
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  motionQuery.addEventListener('change', handleMotionPreferenceChange);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  isRunning = true;
  setPhase(STATE_COMPACT);
  runCycle();
}

/**
 * 6.2 إيقاف الدورة وتنظيف كل المؤقتات والمستمعين بالكامل (يُستدعى من destroyNavbar)
 */
export function stopLogoAnimation() {
  isRunning = false;
  clearPendingTimer();

  if (motionQuery) {
    motionQuery.removeEventListener('change', handleMotionPreferenceChange);
    motionQuery = null;
  }
  document.removeEventListener('visibilitychange', handleVisibilityChange);

  if ($logo) {
    setPhase(STATE_COMPACT);
  }
  $logo = null;
}

export default { startLogoAnimation, stopLogoAnimation };
