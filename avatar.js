/**
 * 🖼️ js/utils/avatar.js — نظام موحد للصور الرمزية والإطارات v5.0.0
 * ============================================================================
 * 📝 المسؤولية:
 *    - حساب أنماط الخلفية والـ Sprite لكل نوع مستخدم وجنس
 *    - إنشاء عناصر HTML كاملة قابلة للاستخدام في أي مكان
 *    - تحديث عناصر موجودة بشكل ديناميكي بدون إعادة بناء كاملة
 *    - تحديد كلاسات الإطارات وعلامات التوثيق بشكل موحد
 *    - حماية كاملة من القسمة على صفر وقيم مفقودة
 *
 * 🔗 التكامل:
 *    - يُستدعى من: navbar.js / drawer.js / profile.js / comments.js
 *    - لا يعتمد على أي ملف آخر (مستقل تاماً)
 *    - جاهز للربط مع api.js بدون تعديل جذري
 * ============================================================================
 */

// ==== ثوابت المسارات والأبعاد ====
// 🛠️ إصلاح ترابط: كانت المسارات نسبية (assets/...) فتُحسب بالنسبة لمسار الصفحة الحالي
// وليس جذر الموقع — أي صورة أفاتار كانت تفشل (404) في أي مسار غير "/" (لوحة تحكم، بروفايل، دروس...)
// بسبب استخدام history.pushState لمسارات حقيقية. تم تحويلها لمسارات مطلقة تبدأ بـ "/".
const AVATAR_CONFIG = {
  SPRITE: {
    MALE:       '/assets/avatars/jobs/avatars_male.png',
    FEMALE:     '/assets/avatars/jobs/avatars_female.png',
    MALE_BG:    '/assets/images/M.png',
    FEMALE_BG:  '/assets/images/G.png',
    TEACHER:    '/assets/images/biologist.png',
    TOTAL_COLS: 5,
    TOTAL_ROWS: 2,
  },

  // ==== كلاسات الإطارات (تُطبَّق على .avatar-frame) ====
  FRAME_CLASSES: {
    teacher:        'avatar-frame--teacher',
    moderator:      'avatar-frame--moderator',
    student_bronze: 'avatar-frame--bronze',
    student_silver: 'avatar-frame--silver',
    student_gold:   'avatar-frame--gold',
    guest:          'avatar-frame--guest',
  },

  // ==== حدود التقدير للطالب (تُحدَّد بـ total_score أو gpa) ====
  SCORE_THRESHOLDS: {
    GOLD:   400,
    SILVER: 200,
  },

  VERIFICATION_BADGE_CLASS: 'verification-badge',

  // ==== أحجام مدعومة للأفاتار ====
  SIZES: ['sm', 'md', 'lg', 'xl'],
};


// ==== حساب موقع الـ Sprite بالنسب المئوية ====

/**
 * يحسب نسبة الـ X وY للـ background-position من Sprite Sheet
 * مع حماية كاملة من القسمة على صفر
 * @param {number} col  رقم العمود (0-indexed)
 * @param {number} row  رقم الصف  (0-indexed)
 * @returns {{ percentX: number, percentY: number }}
 */
function _calcSpritePercent(col, row) {
  const maxCols = AVATAR_CONFIG.SPRITE.TOTAL_COLS - 1;
  const maxRows = AVATAR_CONFIG.SPRITE.TOTAL_ROWS - 1;

  // ==== حماية من القسمة على صفر ====
  const percentX = maxCols > 0 ? (col / maxCols) * 100 : 0;
  const percentY = maxRows > 0 ? (row / maxRows) * 100 : 0;

  return { percentX, percentY };
}


// ==== حساب نمط الخلفية للصورة الرمزية ====

/**
 * يُرجع كائن يصف أنماط CSS اللازمة لعرض الأفاتار
 * @param {Object|null} user  بيانات المستخدم من session.js
 * @returns {AvatarStyleObject}
 *
 * @typedef {Object} AvatarStyleObject
 * @property {string}  backgroundImage    - صورة الخلفية الملونة (M.png أو G.png أو biologist.png)
 * @property {string}  backgroundSize
 * @property {string}  backgroundPosition
 * @property {string}  backgroundRepeat
 * @property {string}  [spriteImage]      - صورة الـ Sprite (الوظيفة) — غير موجودة للمعلم
 * @property {string}  [spriteSize]       - حجم الـ Sprite
 * @property {string}  [spritePosition]   - موقع الـ Sprite
 * @property {boolean} isTeacher          - هل المستخدم معلم؟
 */
export function getAvatarStyle(user) {

  // ==== حالة المعلم: صورة ثابتة مخصصة ====
  if (user?.user_type === 'teacher') {
    return {
      backgroundImage:    `url('${AVATAR_CONFIG.SPRITE.TEACHER}')`,
      backgroundSize:     'cover',
      backgroundPosition: 'center top',
      backgroundRepeat:   'no-repeat',
      isTeacher:          true,
    };
  }

  // ==== حالة بقية المستخدمين: Sprite Sheet ====
  const gender   = user?.gender === 'female' ? 'female' : 'male';
  const jobIndex = (typeof user?.avatar_job_index === 'number' && user.avatar_job_index >= 0)
    ? user.avatar_job_index
    : 0;

  const totalSprites = AVATAR_CONFIG.SPRITE.TOTAL_COLS * AVATAR_CONFIG.SPRITE.TOTAL_ROWS;
  const safeIndex    = jobIndex % totalSprites; // حماية من تجاوز الحد

  const col = safeIndex % AVATAR_CONFIG.SPRITE.TOTAL_COLS;
  const row = Math.floor(safeIndex / AVATAR_CONFIG.SPRITE.TOTAL_COLS);

  const { percentX, percentY } = _calcSpritePercent(col, row);

  const spriteFile = gender === 'female'
    ? AVATAR_CONFIG.SPRITE.FEMALE
    : AVATAR_CONFIG.SPRITE.MALE;

  const bgFile = gender === 'female'
    ? AVATAR_CONFIG.SPRITE.FEMALE_BG
    : AVATAR_CONFIG.SPRITE.MALE_BG;

  // ==== حساب backgroundSize الصحيح للـ Sprite ====
  // 5 أعمدة × 2 صفوف → 500% × 200%
  const spriteColsPercent = AVATAR_CONFIG.SPRITE.TOTAL_COLS * 100;
  const spriteRowsPercent = AVATAR_CONFIG.SPRITE.TOTAL_ROWS * 100;

  return {
    // طبقة الخلفية الملونة (M.png أو G.png)
    backgroundImage:    `url('${bgFile}')`,
    backgroundSize:     'cover',
    backgroundPosition: 'center',
    backgroundRepeat:   'no-repeat',
    // بيانات الـ Sprite (تُطبَّق على .avatar-sprite-layer)
    spriteImage:    `url('${spriteFile}')`,
    spriteSize:     `${spriteColsPercent}% ${spriteRowsPercent}%`,
    spritePosition: `${percentX}% ${percentY}%`,
    isTeacher:      false,
  };
}


// ==== إنشاء عنصر HTML كامل للصورة الرمزية ====

/**
 * ينشئ حاوية .avatar-wrapper جاهزة للإدراج في DOM
 * @param {Object|null} user     بيانات المستخدم (أو null للضيف)
 * @param {string}      size     حجم الأفاتار: 'sm' | 'md' | 'lg' | 'xl'
 * @param {Object}      options  خيارات إضافية
 * @param {boolean}     options.showFrame  - إظهار الإطار (افتراضي: true)
 * @param {boolean}     options.showBadge  - إظهار علامة التوثيق (افتراضي: true)
 * @param {boolean}     options.clickable  - قابل للنقر (افتراضي: true)
 * @param {Function}    options.onClick    - دالة النقر (تستقبل userId)
 * @param {boolean}     options.showShimmer - إظهار تأثير اللمعان (افتراضي: false)
 * @param {boolean}     options.showPulse  - إظهار حلقة النبض (افتراضي: false)
 * @returns {HTMLElement}
 */
export function createAvatarElement(user, size = 'md', options = {}) {
  const {
    showFrame   = true,
    showBadge   = true,
    clickable   = true,
    onClick     = null,
    showShimmer = false,
    showPulse   = false,
  } = options;

  // ==== التحقق من صحة الحجم ====
  const safeSize = AVATAR_CONFIG.SIZES.includes(size) ? size : 'md';

  // ==== الحاوية الأساسية ====
  const wrapper = document.createElement('div');
  wrapper.className = `avatar-wrapper avatar-wrapper--${safeSize}`;
  if (user?.id) wrapper.setAttribute('data-user-id', user.id);
  wrapper.setAttribute('data-user-type', user?.user_type || 'guest');

  // ==== حلقة النبض (اختيارية، تُضاف أولاً لتكون خلف الإطار) ====
  if (showPulse && user) {
    const pulse = document.createElement('div');
    pulse.className = 'avatar-pulse-ring';
    pulse.setAttribute('aria-hidden', 'true');
    wrapper.appendChild(pulse);
  }

  // ==== الإطار الدائري ====
  const frame = document.createElement('div');
  const frameClass = getFrameClass(user);
  frame.className = showFrame
    ? `avatar-frame ${frameClass}`
    : 'avatar-frame avatar-frame--guest';
  frame.setAttribute('aria-hidden', 'true');

  // ==== الصورة الأساسية (الخلفية الملونة) ====
  const style    = getAvatarStyle(user);
  const imageDiv = document.createElement('div');
  imageDiv.className = 'avatar-image';
  imageDiv.style.backgroundImage    = style.backgroundImage;
  imageDiv.style.backgroundSize     = style.backgroundSize;
  imageDiv.style.backgroundPosition = style.backgroundPosition;
  imageDiv.style.backgroundRepeat   = style.backgroundRepeat;

  // ==== طبقة الـ Sprite (الوظيفة) — للمستخدمين غير المعلمين ====
  if (!style.isTeacher && style.spriteImage) {
    const spriteDiv = document.createElement('div');
    spriteDiv.className                = 'avatar-sprite-layer';
    spriteDiv.style.backgroundImage    = style.spriteImage;
    spriteDiv.style.backgroundSize     = style.spriteSize;
    spriteDiv.style.backgroundPosition = style.spritePosition;
    spriteDiv.style.backgroundRepeat   = 'no-repeat';
    spriteDiv.setAttribute('aria-hidden', 'true');
    imageDiv.appendChild(spriteDiv);
  }

  // ==== تأثير اللمعان (Shimmer، اختياري) ====
  if (showShimmer) {
    const shimmer = document.createElement('div');
    shimmer.className = 'avatar-shimmer';
    shimmer.setAttribute('aria-hidden', 'true');
    imageDiv.appendChild(shimmer);
  }

  frame.appendChild(imageDiv);
  wrapper.appendChild(frame);

  // ==== علامة التوثيق ====
  if (showBadge && shouldShowVerificationBadge(user)) {
    const badge = _createVerificationBadge(user);
    wrapper.appendChild(badge);
  }

  // ==== جعل العنصر قابل للنقر ====
  if (clickable && onClick && user?.id) {
    wrapper.style.cursor = 'pointer';
    wrapper.setAttribute('role', 'button');
    wrapper.setAttribute('tabindex', '0');
    wrapper.setAttribute('aria-label', `عرض ملف ${user.full_name || user.username || 'المستخدم'}`);

    const handleClick = (e) => {
      e.stopPropagation();
      onClick(user.id);
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick(user.id);
      }
    };

    wrapper.addEventListener('click', handleClick);
    wrapper.addEventListener('keydown', handleKeyDown);

    // ==== تخزين مراجع الدوال للتنظيف لاحقاً ====
    wrapper._clickHandler   = handleClick;
    wrapper._keydownHandler = handleKeyDown;
  }

  return wrapper;
}


// ==== تحديث عنصر موجود بدون إعادة بناء كاملة ====

/**
 * يُحدِّث .avatar-wrapper موجود بيانات مستخدم جديدة
 * (أكفأ من إنشاء عنصر جديد)
 * @param {HTMLElement} element  العنصر المُراد تحديثه
 * @param {Object|null} user     بيانات المستخدم الجديدة
 */
export function updateAvatarElement(element, user) {
  if (!element) return;

  // ==== تحديث بيانات data ====
  element.setAttribute('data-user-id',   user?.id         || '');
  element.setAttribute('data-user-type', user?.user_type  || 'guest');

  // ==== تحديث الإطار ====
  const frame = element.querySelector('.avatar-frame');
  if (frame) {
    const allFrameClasses = Object.values(AVATAR_CONFIG.FRAME_CLASSES);
    allFrameClasses.forEach(cls => frame.classList.remove(cls));
    frame.classList.add(getFrameClass(user));
  }

  // ==== تحديث الصورة وطبقة الـ Sprite ====
  const style    = getAvatarStyle(user);
  const imageDiv = element.querySelector('.avatar-image');
  if (imageDiv) {
    imageDiv.style.backgroundImage    = style.backgroundImage;
    imageDiv.style.backgroundSize     = style.backgroundSize;
    imageDiv.style.backgroundPosition = style.backgroundPosition;
    imageDiv.style.backgroundRepeat   = style.backgroundRepeat;

    let spriteDiv = imageDiv.querySelector('.avatar-sprite-layer');

    if (!style.isTeacher && style.spriteImage) {
      // ==== إنشاء طبقة Sprite إن لم تكن موجودة ====
      if (!spriteDiv) {
        spriteDiv = document.createElement('div');
        spriteDiv.className = 'avatar-sprite-layer';
        spriteDiv.setAttribute('aria-hidden', 'true');
        imageDiv.appendChild(spriteDiv);
      }
      spriteDiv.style.backgroundImage    = style.spriteImage;
      spriteDiv.style.backgroundSize     = style.spriteSize;
      spriteDiv.style.backgroundPosition = style.spritePosition;
      spriteDiv.style.backgroundRepeat   = 'no-repeat';
    } else if (spriteDiv) {
      // ==== إزالة طبقة Sprite للمعلم ====
      spriteDiv.remove();
    }
  }

  // ==== تحديث علامة التوثيق ====
  const existingBadge = element.querySelector(`.${AVATAR_CONFIG.VERIFICATION_BADGE_CLASS}`);
  const shouldShow    = shouldShowVerificationBadge(user);

  if (shouldShow && !existingBadge) {
    const badge = _createVerificationBadge(user);
    element.appendChild(badge);
  } else if (shouldShow && existingBadge) {
    // ==== تحديث لون الـ badge إن تغيّر الدور ====
    _updateBadgeColor(existingBadge, user);
  } else if (!shouldShow && existingBadge) {
    existingBadge.remove();
  }
}


// ==== تحديد كلاس الإطار حسب نوع المستخدم وتقديره ====

/**
 * @param {Object|null} user  بيانات المستخدم
 * @returns {string}          كلاس CSS للإطار
 */
export function getFrameClass(user) {
  if (!user) return AVATAR_CONFIG.FRAME_CLASSES.guest;

  switch (user.user_type) {
    case 'teacher':
      return AVATAR_CONFIG.FRAME_CLASSES.teacher;

    case 'moderator':
      return AVATAR_CONFIG.FRAME_CLASSES.moderator;

    case 'student': {
      const score = _resolveStudentScore(user);
      if (score >= AVATAR_CONFIG.SCORE_THRESHOLDS.GOLD)   return AVATAR_CONFIG.FRAME_CLASSES.student_gold;
      if (score >= AVATAR_CONFIG.SCORE_THRESHOLDS.SILVER) return AVATAR_CONFIG.FRAME_CLASSES.student_silver;
      return AVATAR_CONFIG.FRAME_CLASSES.student_bronze;
    }

    default:
      return AVATAR_CONFIG.FRAME_CLASSES.guest;
  }
}


// ==== التحقق من عرض علامة التوثيق ====

/**
 * يُرجع true إذا كان المستخدم موثَّقاً ودوره معلم أو مشرف
 * @param {Object|null} user
 * @returns {boolean}
 */
export function shouldShowVerificationBadge(user) {
  if (!user) return false;
  const isStaff = user.user_type === 'teacher' || user.user_type === 'moderator';
  // ==== نعرض الـ badge إذا كان is_verified صحيحاً أو كان المستخدم معلماً/مشرفاً بطبيعته ====
  return isStaff && (user.is_verified !== false);
}


// ==== الصورة الاحتياطية عند فشل التحميل ====

/**
 * @param {Object|null} user
 * @returns {string} مسار صورة الخلفية
 */
export function getAvatarFallbackImage(user) {
  const gender = user?.gender === 'female' ? 'female' : 'male';
  return gender === 'female'
    ? AVATAR_CONFIG.SPRITE.FEMALE_BG
    : AVATAR_CONFIG.SPRITE.MALE_BG;
}


// ==== تطبيق سريع على عنصر img أو div موجود (للتوافق) ====

/**
 * يُطبِّق نمط الأفاتار مباشرة على عنصر DOM واحد
 * (يُستخدم في الحالات التي لا تحتاج إلى الهيكل الكامل)
 * @param {HTMLElement} element  العنصر المستهدف
 * @param {Object|null} user     بيانات المستخدم
 */
export function applyAvatarToElement(element, user) {
  if (!element) return;
  const style = getAvatarStyle(user);
  element.style.backgroundImage    = style.backgroundImage;
  element.style.backgroundSize     = style.backgroundSize;
  element.style.backgroundPosition = style.backgroundPosition;
  element.style.backgroundRepeat   = style.backgroundRepeat;
}


// ==== الحصول على كامل إعدادات الأفاتار (للاستخدام الخارجي) ====
export function getAvatarConfig() {
  return Object.freeze({ ...AVATAR_CONFIG });
}


// ==== دوال مساعدة داخلية (Private) ====

/**
 * يُنشئ عنصر علامة التوثيق
 * @param {Object} user
 * @returns {HTMLElement}
 */
function _createVerificationBadge(user) {
  const badge = document.createElement('div');
  badge.className = AVATAR_CONFIG.VERIFICATION_BADGE_CLASS;
  badge.setAttribute('aria-label', _getBadgeLabel(user));
  badge.setAttribute('title',      _getBadgeLabel(user));
  badge.innerHTML = '<i class="fas fa-check-circle" aria-hidden="true"></i>';
  _updateBadgeColor(badge, user);
  return badge;
}

/**
 * يُحدِّث لون علامة التوثيق حسب دور المستخدم
 * @param {HTMLElement} badge
 * @param {Object|null} user
 */
function _updateBadgeColor(badge, user) {
  badge.classList.remove('badge--teacher', 'badge--moderator');
  if (user?.user_type === 'teacher')   badge.classList.add('badge--teacher');
  if (user?.user_type === 'moderator') badge.classList.add('badge--moderator');
}

/**
 * يُرجع نص aria-label لعلامة التوثيق
 * @param {Object|null} user
 * @returns {string}
 */
function _getBadgeLabel(user) {
  if (user?.user_type === 'teacher')   return 'حساب معلم موثَّق';
  if (user?.user_type === 'moderator') return 'حساب مشرف موثَّق';
  return 'حساب موثَّق';
}

/**
 * يُحدِّد درجة الطالب — المصدر الوحيد الفعلي في مخطط البيانات هو total_score
 * (تحقّقتُ من api.js بالكامل: لا وجود لـ gpa أو grade_number في أي مكان)
 * @param {Object} user
 * @returns {number}
 */
function _resolveStudentScore(user) {
  if (typeof user.total_score === 'number' && user.total_score >= 0) return user.total_score;
  return 0;
}
