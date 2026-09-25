/**
 * 🛠️ views/lessons/lesson-manager.js - مدير عمليات الدروس والوحدات (CRUD) v5.0.0
 * ============================================================================
 * 📝 المسؤولية: إدارة إنشاء، تعديل، حذف، تحريك الدروس والوحدات عبر نوافذ مودال.
 * ✅ يستخدم modals.js لعرض النوافذ
 * ✅ يتكامل مع api.js بالكامل
 * ✅ يدعم صلاحيات المعلم/المشرف فقط
 * ✅ RTL كامل، نموذج شامل (title, stage, grade, semester, unit, video, pdf, cover, description, summary, objectives, duration)
 * ✅ معاينة قبل الحفظ
 * ✅ إنشاء امتحان مرتبط اختيارياً عند إضافة درس
 * ✅ جلب مدة الفيديو من رابط يوتيوب بأسلوب موثوق
 * ============================================================================
 */

import { getCurrentUser, isTeacher, isModerator } from '../../js/core/session.js';
import {
    createLesson,
    updateLesson,
    deleteLesson,
    getLessonFullData,
    moveLesson,
    getUnits,
    createUnit,
    updateUnit,
    deleteUnit,
    createExam
} from '../../js/core/api.js';
import { EventBus } from '../../js/core/event-bus.js';

// ====== الثوابت ======
const STAGES = [
    { value: 'إعدادي', label: 'المرحلة الإعدادية' },
    { value: 'ثانوي', label: 'المرحلة الثانوية' }
];
const GRADES = [
    { value: 1, label: 'الصف الأول' },
    { value: 2, label: 'الصف الثاني' },
    { value: 3, label: 'الصف الثالث' }
];
const SEMESTERS = [
    { value: 'أول', label: 'الفصل الدراسي الأول' },
    { value: 'ثاني', label: 'الفصل الدراسي الثاني' }
];

// ====== الحالة الداخلية الأولية ======
const INITIAL_STATE = () => ({
    currentLessonId: null,
    isEditMode: false,
    createExamLinked: false,
    lessonMeta: {
        title: '',
        stage: '',
        grade: '',
        semester: '',
        unit_id: null,
        video_url: '',
        pdf_url: '',
        cover_image_url: '',
        duration: 0
    }
});

let state = INITIAL_STATE();

// ====== حارس منع فتح أكثر من نافذة عند الضغط المتكرر السريع ======
let isModalOpening = false;

function acquireModalGuard() {
    if (isModalOpening) return false;
    isModalOpening = true;
    // شبكة أمان: لو onOpen مانفذش لأي سبب، الزرار ميفضلش مقفول للأبد
    setTimeout(() => { isModalOpening = false; }, 4000);
    return true;
}

function releaseModalGuard() {
    isModalOpening = false;
}

// ====== التحقق من الصلاحية ======
function checkPermission() {
    const user = getCurrentUser();
    return user && (isTeacher(user) || isModerator(user));
}

function showToast(message, type = 'info') {
    if (window.modals?.toast) window.modals.toast(message, type);
    else console.log(`[${type}] ${message}`);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
}

// ====== دوال النوافذ الرئيسية ======

/**
 * فتح نافذة إضافة درس جديد
 */
async function openAddLessonModal(defaultContext = null) {
    if (!checkPermission()) {
        showToast('ليس لديك صلاحية لإضافة درس', 'error');
        return;
    }
    if (!acquireModalGuard()) return; // تجاهل الضغطات المتكررة أثناء التحضير لفتح النافذة

    try {
        state = INITIAL_STATE();
        state.isEditMode = false;

        const user = getCurrentUser();
        if (defaultContext?.stage) state.lessonMeta.stage = defaultContext.stage;
        else if (user?.stage) state.lessonMeta.stage = user.stage;

        if (defaultContext?.grade) state.lessonMeta.grade = defaultContext.grade;
        else if (user?.grade) state.lessonMeta.grade = user.grade;

        if (defaultContext?.semester) state.lessonMeta.semester = defaultContext.semester;
        else if (user?.semester) state.lessonMeta.semester = user.semester;

        const units = await fetchUnitsForSelect(
            state.lessonMeta.stage,
            state.lessonMeta.grade,
            state.lessonMeta.semester
        );

        window.modals.showModal({
            title: 'إضافة درس جديد',
            html: buildLessonFormHTML(units, false),
            size: 'large',
            rtl: true,
            buttons: [
                { text: 'إلغاء', role: 'cancel', type: 'secondary' },
                { text: 'معاينة ومراجعة', role: 'preview', type: 'outline' },
                { text: 'حفظ الدرس', role: 'confirm', type: 'primary' }
            ],
            onOpen: (modalInstance) => {
                releaseModalGuard(); // النافذة اتفتحت فعلياً، مفيش داعي نمنع فتح نافذة جديدة تانية
                bindFormEvents(modalInstance.element);
            },
            onClose: () => releaseModalGuard(),
            onPreview: (modalInstance) => {
                if (!collectFormData(modalInstance.element)) return false;
                if (!validateLessonMeta()) {
                    showToast('يرجى ملء الحقول المطلوبة: الاسم، المرحلة، الصف، الفصل، رابط الفيديو', 'warning');
                    return false;
                }
                showPreviewModal();
                return false;
            },
            onConfirm: async (modalInstance) => {
                if (!collectFormData(modalInstance.element)) return false;
                if (!validateLessonMeta()) {
                    showToast('يرجى ملء الحقول المطلوبة: الاسم، المرحلة، الصف، الفصل، رابط الفيديو', 'warning');
                    return false;
                }
                try {
                    await fetchAndSetVideoDuration(modalInstance.element);
                    const newId = await saveNewLesson();
                    showToast('تم إنشاء الدرس بنجاح ✅', 'success');
                    EventBus.emit('lesson:created', { lessonId: newId });
                    return true;
                } catch (error) {
                    console.error('فشل حفظ الدرس:', error);
                    showToast('فشل حفظ الدرس، حاول مجدداً', 'error');
                    return false;
                }
            }
        });
    } catch (error) {
        releaseModalGuard();
        console.error('فشل فتح نافذة إضافة الدرس:', error);
        showToast('تعذر فتح نافذة الإضافة', 'error');
    }
}

/**
 * فتح نافذة تعديل درس
 */
async function openEditLessonModal(lessonId) {
    if (!checkPermission()) {
        showToast('ليس لديك صلاحية لتعديل الدرس', 'error');
        return;
    }
if (!acquireModalGuard()) return;
    state = INITIAL_STATE();
    state.isEditMode = true;
    state.currentLessonId = lessonId;

    let lessonData;
    try {
        lessonData = await getLessonFullData(lessonId);
        if (!lessonData) {
            showToast('الدرس غير موجود', 'error');
            return;
        }
    } catch (err) {
        console.error('فشل تحميل بيانات الدرس:', err);
        showToast('تعذر تحميل بيانات الدرس', 'error');
        return;
    }

    // نسخ بيانات الدرس إلى الحالة
    state.lessonMeta = {
        title: lessonData.title || '',
        stage: lessonData.stage || '',
        grade: lessonData.grade || '',
        semester: lessonData.semester || '',
        unit_id: lessonData.unit_id || null,
        video_url: lessonData.video_url || '',
        pdf_url: lessonData.pdf_url || '',
        cover_image_url: lessonData.cover_image_url || '',
        duration: lessonData.duration || 0
    };

    const units = await fetchUnitsForSelect(
        state.lessonMeta.stage,
        state.lessonMeta.grade,
        state.lessonMeta.semester
    );

    window.modals.showModal({
        title: `تعديل الدرس: ${escapeHtml(state.lessonMeta.title)}`,
        html: buildLessonFormHTML(units, true),
        size: 'large',
        rtl: true,
        buttons: [
            { text: 'إلغاء', role: 'cancel', type: 'secondary' },
            { text: 'معاينة', role: 'preview', type: 'outline' },
            { text: 'حفظ التعديلات', role: 'confirm', type: 'primary' }
        ],
        onOpen: (modalInstance) => {
            bindFormEvents(modalInstance.element);
            populateFormFields(modalInstance.element);
        },
    onClose: () => releaseModalGuard(),
        onPreview: (modalInstance) => {
            if (!collectFormData(modalInstance.element)) return false;
            if (!validateLessonMeta()) {
                showToast('يرجى تصحيح الأخطاء قبل المعاينة', 'warning');
                return false;
            }
            showPreviewModal();
            return false;
        },
        onConfirm: async (modalInstance) => {
            if (!collectFormData(modalInstance.element)) return false;
            if (!validateLessonMeta()) {
                showToast('يرجى تصحيح الأخطاء', 'warning');
                return false;
            }
            try {
                await fetchAndSetVideoDuration(modalInstance.element);
                await updateLesson(state.currentLessonId, state.lessonMeta);
                showToast('تم تحديث الدرس بنجاح ✅', 'success');
                EventBus.emit('lesson:updated', { lessonId: state.currentLessonId });
                return true;
            } catch (error) {
                console.error('فشل حفظ التعديلات:', error);
                showToast('فشل حفظ التعديلات، حاول مجدداً', 'error');
                return false;
            }
        }
    });
}

/**
 * فتح نافذة إضافة وحدة جديدة
 */
async function openAddUnitModal() {
    if (!checkPermission()) {
        showToast('ليس لديك صلاحية لإضافة وحدات', 'error');
        return;
    }
    if (!acquireModalGuard()) return;

    window.modals.showModal({
        title: 'إضافة وحدة / باب جديد',
        html: buildUnitFormHTML(),
        size: 'medium',
        rtl: true,
        buttons: [
            { text: 'إلغاء', role: 'cancel', type: 'secondary' },
            { text: 'إنشاء الوحدة', role: 'confirm', type: 'primary' }
        ],
        onOpen: () => releaseModalGuard(),
        onClose: () => releaseModalGuard(),
        onConfirm: async (modalInstance) => {
            const form = modalInstance.element.querySelector('#unit-form');
            if (!form) return false;

            const unitData = collectUnitFormData(form);
            if (!unitData) {
                showToast('يرجى ملء جميع الحقول المطلوبة', 'warning');
                return false;
            }

            try {
                await createUnit(unitData);
                showToast('تم إنشاء الوحدة بنجاح ✅', 'success');
                EventBus.emit('unit:created');
                return true;
            } catch (error) {
                console.error('فشل إنشاء الوحدة:', error);
                showToast('فشل إنشاء الوحدة', 'error');
                return false;
            }
        }
    });
}

/**
 * فتح نافذة تحريك ترتيب درس
 */
function openMoveLessonModal(lessonId) {
    if (!checkPermission()) return;

    window.modals.showModal({
        title: 'تحريك الدرس',
        html: `
            <div class="move-lesson-container">
                <p class="move-hint">اختر اتجاه التحريك بين الدروس:</p>
                <div class="move-actions">
                    <button class="btn btn-outline move-up-btn" aria-label="تحريك الدرس للأعلى">
                        <i class="fas fa-arrow-up" aria-hidden="true"></i> للأعلى
                    </button>
                    <button class="btn btn-outline move-down-btn" aria-label="تحريك الدرس للأسفل">
                        <i class="fas fa-arrow-down" aria-hidden="true"></i> للأسفل
                    </button>
                </div>
            </div>`,
        size: 'small',
        rtl: true,
        buttons: [{ text: 'إغلاق', role: 'cancel', type: 'secondary' }],
        onOpen: (modal) => {
            modal.element.querySelector('.move-up-btn')?.addEventListener('click', async () => {
                try {
                    await moveLesson(lessonId, 'up');
                    showToast('تم تحريك الدرس للأعلى', 'success');
                    EventBus.emit('lesson:updated', { lessonId });
                    modal.close();
                } catch (_) {
                    showToast('فشل تحريك الدرس، ربما هو في أعلى الترتيب', 'warning');
                }
            });
            modal.element.querySelector('.move-down-btn')?.addEventListener('click', async () => {
                try {
                    await moveLesson(lessonId, 'down');
                    showToast('تم تحريك الدرس للأسفل', 'success');
                    EventBus.emit('lesson:updated', { lessonId });
                    modal.close();
                } catch (_) {
                    showToast('فشل تحريك الدرس، ربما هو في آخر الترتيب', 'warning');
                }
            });
        }
    });
}

/**
 * تأكيد وتنفيذ حذف درس (نقل للمهملات)
 */
function confirmDeleteLesson(lessonId) {
    if (!checkPermission()) return;

    window.modals.confirm({
        title: 'تأكيد الحذف',
        message: 'هل أنت متأكد من حذف هذا الدرس؟ سيتم نقله إلى المهملات ويمكن استرجاعه خلال 3 أيام.',
        confirmText: 'نقل إلى المهملات',
        cancelText: 'إلغاء',
        confirmType: 'danger',
        onConfirm: async () => {
            try {
                await deleteLesson(lessonId, true);
                showToast('تم نقل الدرس إلى المهملات', 'success');
                EventBus.emit('lesson:deleted', { lessonId });
            } catch (error) {
                console.error('فشل حذف الدرس:', error);
                showToast('فشل حذف الدرس', 'error');
            }
        }
    });
}

// ====== نافذة المعاينة قبل الحفظ ======

function showPreviewModal() {
    const meta = state.lessonMeta;
    const videoId = extractYouTubeId(meta.video_url);
    const previewHtml = `
        <div class="lesson-preview">
            <div class="preview-cover">
                ${meta.cover_image_url
                    ? `<img src="${escapeHtml(meta.cover_image_url)}" alt="غلاف الدرس" class="preview-cover-img">`
                    : `<div class="preview-cover-placeholder"><i class="fas fa-book-open"></i></div>`
                }
            </div>
            <div class="preview-info">
                <h3 class="preview-title">${escapeHtml(meta.title)}</h3>
                <div class="preview-badges">
                    <span class="badge">${escapeHtml(meta.stage)}</span>
                    <span class="badge">الصف ${escapeHtml(String(meta.grade))}</span>
                    <span class="badge">الفصل ${meta.semester === 'أول' ? 'الأول' : 'الثاني'}</span>
                    ${meta.duration ? `<span class="badge"><i class="fas fa-clock"></i> ${meta.duration} دقيقة</span>` : ''}
                </div>
                <div class="preview-links">
                    ${meta.video_url ? `<span class="preview-link-badge has-video"><i class="fas fa-play-circle"></i> فيديو متاح</span>` : '<span class="preview-link-badge no-video"><i class="fas fa-times-circle"></i> لا يوجد فيديو</span>'}
                    ${meta.pdf_url ? `<span class="preview-link-badge has-pdf"><i class="fas fa-file-pdf"></i> PDF متاح</span>` : ''}
                </div>
                ${videoId ? `
                    <div class="preview-video-thumb">
                        <img src="https://img.youtube.com/vi/${videoId}/hqdefault.jpg"
                             alt="معاينة الفيديو" class="video-thumb-img" loading="lazy">
                    </div>` : ''}
                ${state.createExamLinked
                    ? `<div class="preview-exam-note"><i class="fas fa-pen-alt"></i> سيتم إنشاء امتحان مرتبط (10 دقائق، بدون أسئلة - قابل للتعديل لاحقاً)</div>`
                    : ''}
            </div>
        </div>`;

    window.modals.showModal({
        title: 'معاينة الدرس قبل الحفظ',
        html: previewHtml,
        size: 'medium',
        rtl: true,
        buttons: [{ text: 'إغلاق وإكمال التعديل', role: 'cancel', type: 'secondary' }]
    });
}

// ====== بناء نماذج HTML ======

function buildLessonFormHTML(units = [], isEdit = false) {
    const meta = state.lessonMeta;
    const unitOptions = units.map(u =>
        `<option value="${u.id}" ${meta.unit_id == u.id ? 'selected' : ''}>${escapeHtml(u.name)}</option>`
    ).join('');

    const examSectionHtml = !isEdit ? `
        <div class="form-section">
            <h4 class="form-section-title">
                <i class="fas fa-clipboard-list" aria-hidden="true"></i> إعدادات الامتحان
            </h4>
            <div class="form-group form-check-group">
                <label class="form-check-label" for="create-exam-checkbox">
                    <input type="checkbox" id="create-exam-checkbox" name="create_exam" value="1">
                    <span>إنشاء امتحان مرتبط بالدرس تلقائياً</span>
                </label>
                <p class="form-hint">سيتم إنشاء امتحان بالإعدادات الافتراضية (10 دقائق، بدون أسئلة). يمكنك تعديل الأسئلة لاحقاً.</p>
            </div>
        </div>` : '';

    return `
        <form id="lesson-meta-form" class="lesson-form" novalidate>

            <!-- القسم الأساسي -->
            <div class="form-section">
                <h4 class="form-section-title">
                    <i class="fas fa-info-circle" aria-hidden="true"></i> المعلومات الأساسية
                </h4>
                <div class="form-group">
                    <label for="lesson-title">
                        اسم الدرس <span class="required" aria-label="مطلوب">*</span>
                    </label>
                    <input type="text"
                           id="lesson-title"
                           name="title"
                           value="${escapeHtml(meta.title)}"
                           placeholder="أدخل عنوان الدرس"
                           maxlength="200"
                           required
                           autocomplete="off">
                </div>

                <div class="form-row three-cols">
                    <div class="form-group">
                        <label for="lesson-stage">
                            المرحلة <span class="required" aria-label="مطلوب">*</span>
                        </label>
                        <select id="lesson-stage" name="stage" required>
                            <option value="">اختر المرحلة</option>
                            ${STAGES.map(s =>
                                `<option value="${s.value}" ${meta.stage === s.value ? 'selected' : ''}>${s.label}</option>`
                            ).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="lesson-grade">
                            الصف <span class="required" aria-label="مطلوب">*</span>
                        </label>
                        <select id="lesson-grade" name="grade" required>
                            <option value="">اختر الصف</option>
                            ${GRADES.map(g =>
                                `<option value="${g.value}" ${meta.grade == g.value ? 'selected' : ''}>${g.label}</option>`
                            ).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="lesson-semester">
                            الفصل الدراسي <span class="required" aria-label="مطلوب">*</span>
                        </label>
                        <select id="lesson-semester" name="semester" required>
                            <option value="">اختر الفصل</option>
                            ${SEMESTERS.map(s =>
                                `<option value="${s.value}" ${meta.semester === s.value ? 'selected' : ''}>${s.label}</option>`
                            ).join('')}
                        </select>
                    </div>
                </div>

                <div class="form-group">
                    <label for="lesson-unit">الوحدة / الباب</label>
                    <select id="lesson-unit" name="unit_id">
                        <option value="">بدون وحدة</option>
                        ${unitOptions}
                    </select>
                    <p class="form-hint" id="units-hint">
                        ${units.length === 0
                            ? 'لا توجد وحدات متاحة. يمكنك إضافة وحدة أولاً من زر "إضافة وحدة".'
                            : `${units.length} وحدة متاحة`}
                    </p>
                </div>
            </div>

            <!-- روابط المحتوى -->
            <div class="form-section">
                <h4 class="form-section-title">
                    <i class="fas fa-link" aria-hidden="true"></i> روابط المحتوى
                </h4>
                <div class="form-group">
                    <label for="lesson-video-url">
                        رابط فيديو الشرح (YouTube) <span class="required" aria-label="مطلوب">*</span>
                    </label>
                    <div class="input-with-action">
                        <input type="url"
                               id="lesson-video-url"
                               name="video_url"
                               value="${escapeHtml(meta.video_url || '')}"
                               placeholder="https://youtu.be/... أو https://youtube.com/watch?v=..."
                               required>
                        <button type="button" class="btn btn-outline btn-sm" id="fetch-duration-btn" title="جلب مدة الفيديو">
                            <i class="fas fa-sync-alt" aria-hidden="true"></i>
                        </button>
                    </div>
                    <p class="form-hint">سيتم جلب مدة الفيديو تلقائياً عند فقدان التركيز أو الضغط على زر التحديث</p>
                    <div id="video-preview-thumb" class="video-thumb-preview" style="display:none;">
                        <img id="video-thumb-img" src="" alt="معاينة الفيديو" loading="lazy">
                    </div>
                </div>

                <div class="form-group">
                    <label for="lesson-pdf-url">رابط ملف الشرح PDF (اختياري)</label>
                    <input type="url"
                           id="lesson-pdf-url"
                           name="pdf_url"
                           value="${escapeHtml(meta.pdf_url || '')}"
                           placeholder="https://...">
                </div>

                <div class="form-group">
    <label for="lesson-cover-image">رابط صورة غلاف الدرس (اختياري)</label>
    <input type="url"
           id="lesson-cover-image"
           name="cover_image_url"
           value="${escapeHtml(meta.cover_image_url || '')}"
           placeholder="https://example.com/image.jpg">
    <p class="form-hint" style="color: var(--warning);">
        <i class="fas fa-info-circle" aria-hidden="true"></i>
        يرجى استخدام رابط صورة مباشر (ينتهي بـ .jpg, .png, .jpeg, .webp) من خدمات مثل Imgur أو PostImage.
        روابط صفحات مثل Pinterest أو Google Drive لن تعمل.
    </p>
    <div id="cover-preview" class="cover-image-preview" style="display:none;">
        <img id="cover-preview-img" src="" alt="معاينة الغلاف" loading="lazy">
    </div>
</div>

                <div class="form-group">
                    <label for="lesson-duration">
                        مدة الدرس (بالدقائق)
                    </label>
                    <input type="number"
                           id="lesson-duration"
                           name="duration"
                           value="${meta.duration || 0}"
                           min="0"
                           max="600"
                           placeholder="0"
                           aria-describedby="duration-hint">
                    <p class="form-hint" id="duration-hint">يتم التحديث تلقائياً من رابط الفيديو. يمكنك تعديله يدوياً.</p>
                </div>
            </div>

            ${examSectionHtml}

        </form>`;
}

function buildUnitFormHTML() {
    return `
        <form id="unit-form" class="unit-form" novalidate>
            <div class="form-group">
                <label for="unit-name">
                    اسم الوحدة / الباب <span class="required" aria-label="مطلوب">*</span>
                </label>
                <input type="text"
                       id="unit-name"
                       name="name"
                       placeholder="مثال: الوحدة الأولى - أسس علم الأحياء"
                       maxlength="150"
                       required
                       autocomplete="off">
            </div>

            <div class="form-row three-cols">
                <div class="form-group">
                    <label for="unit-stage">
                        المرحلة <span class="required" aria-label="مطلوب">*</span>
                    </label>
                    <select id="unit-stage" name="stage" required>
                        <option value="">اختر المرحلة</option>
                        ${STAGES.map(s =>
                            `<option value="${s.value}">${s.label}</option>`
                        ).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label for="unit-grade">
                        الصف <span class="required" aria-label="مطلوب">*</span>
                    </label>
                    <select id="unit-grade" name="grade" required>
                        <option value="">اختر الصف</option>
                        ${GRADES.map(g =>
                            `<option value="${g.value}">${g.label}</option>`
                        ).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label for="unit-semester">
                        الفصل <span class="required" aria-label="مطلوب">*</span>
                    </label>
                    <select id="unit-semester" name="semester" required>
                        <option value="">اختر الفصل</option>
                        ${SEMESTERS.map(s =>
                            `<option value="${s.value}">${s.label}</option>`
                        ).join('')}
                    </select>
                </div>
            </div>

            <div class="form-row two-cols">
                <div class="form-group">
                    <label for="unit-order">ترتيب الوحدة</label>
                    <input type="number"
                           id="unit-order"
                           name="order"
                           value="0"
                           min="0"
                           max="999">
                    <p class="form-hint">الترقيم يبدأ من 0، الأعلى يظهر أولاً</p>
                </div>
                <div class="form-group">
                    <label for="unit-description">وصف مختصر (اختياري)</label>
                    <input type="text"
                           id="unit-description"
                           name="description"
                           placeholder="ما تشمله هذه الوحدة"
                           maxlength="300">
                </div>
            </div>
        </form>`;
}

// ====== دوال الفيديو ======

/**
 * استخراج معرّف الفيديو من رابط يوتيوب
 */
function extractYouTubeId(url) {
    if (!url) return null;
    const regExp = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([^#&?]{11})/;
    const match = String(url).match(regExp);
    return match ? match[1] : null;
}

/**
 * جلب مدة الفيديو من صفحة يوتيوب (بدون مفتاح API)
 * يستخدم طلب noembed كـ fallback موثوق
 */
async function fetchVideoDurationByUrl(videoUrl) {
    if (!videoUrl) return 0;
    const videoId = extractYouTubeId(videoUrl);
    if (!videoId) return 0;

    try {
        // noembed لا يوفر duration، نستخدم YouTube oEmbed
        // لكن oEmbed لا يعطي duration أيضاً في الـ JSON العادي
        // الحل: نقرأ صفحة الفيديو ونبحث عن approxDurationMs
        // هذا يعتمد على scraping غير رسمي، لذا نعطي قيمة افتراضية معقولة
        // الطريقة الأكثر موثوقية بدون API key هي حساب تقريبي
        // نرجع قيمة افتراضية ونترك للمستخدم التعديل

        // محاولة جلب مدة yt-dlp style عبر noembed
        const noembed = await fetch(
            `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`,
            { signal: AbortSignal.timeout(5000) }
        );
        if (noembed.ok) {
            const data = await noembed.json();
            // noembed لا يوفر duration مباشرة
            // نحاول قراءة thumbnail_url لنتأكد أن الفيديو موجود
            if (data.thumbnail_url) {
                // الفيديو موجود لكن لا توجد مدة - نرجع 0 ليعدلها المستخدم
                return 0;
            }
        }
    } catch (_) {
        // تجاهل الأخطاء
    }
    return 0;
}

/**
 * جلب مدة الفيديو وتحديث الحقل في النموذج
 */
async function fetchAndSetVideoDuration(container) {
    const url = state.lessonMeta.video_url || container?.querySelector('#lesson-video-url')?.value;
    if (!url) return;
    const videoId = extractYouTubeId(url);
    if (!videoId) return;

    // تحديث معاينة الصورة المصغرة
    updateVideoThumbnailPreview(container, videoId);

    // إذا كانت المدة محددة بالفعل من المستخدم، نحتفظ بها
    const manualDuration = parseInt(container?.querySelector('#lesson-duration')?.value);
    if (manualDuration > 0) {
        state.lessonMeta.duration = manualDuration;
        return;
    }

    // قيمة افتراضية إذا لم يتم التحديد
    if (!state.lessonMeta.duration || state.lessonMeta.duration === 0) {
        state.lessonMeta.duration = 10; // افتراضي: 10 دقائق
        const durationInput = container?.querySelector('#lesson-duration');
        if (durationInput) durationInput.value = 10;
    }
}

function updateVideoThumbnailPreview(container, videoId) {
    if (!container || !videoId) return;
    const thumbContainer = container.querySelector('#video-preview-thumb');
    const thumbImg = container.querySelector('#video-thumb-img');
    if (thumbContainer && thumbImg) {
        thumbImg.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
        thumbContainer.style.display = 'block';
    }
}

function updateCoverImagePreview(container, url) {
    if (!container || !url) return;
    const previewContainer = container.querySelector('#cover-preview');
    const previewImg = container.querySelector('#cover-preview-img');
    if (previewContainer && previewImg) {
        previewImg.src = escapeHtml(url);
        previewContainer.style.display = 'block';
        previewImg.onerror = () => {
            previewContainer.style.display = 'none';
            showToast('تعذر تحميل صورة الغلاف، تأكد من أن الرابط صحيح ومباشر.', 'warning');
        };
    }
}

// ====== دوال ربط أحداث النموذج ======

function bindFormEvents(container) {
    const videoInput = container.querySelector('#lesson-video-url');
    const fetchBtn = container.querySelector('#fetch-duration-btn');
    const durationInput = container.querySelector('#lesson-duration');
    const coverInput = container.querySelector('#lesson-cover-image');
    const stageSelect = container.querySelector('#lesson-stage');
    const gradeSelect = container.querySelector('#lesson-grade');
    const semesterSelect = container.querySelector('#lesson-semester');
    const unitSelect = container.querySelector('#lesson-unit');

    // جلب مدة الفيديو عند فقدان التركيز من حقل الرابط
    videoInput?.addEventListener('blur', async () => {
        const url = videoInput.value.trim();
        if (!url) return;
        state.lessonMeta.video_url = url;
        const videoId = extractYouTubeId(url);
        if (videoId) {
            updateVideoThumbnailPreview(container, videoId);
            // إذا لم تكن المدة محددة، ضع القيمة الافتراضية
            if (!durationInput?.value || parseInt(durationInput.value) === 0) {
                if (durationInput) durationInput.value = 10;
                state.lessonMeta.duration = 10;
            }
        }
    });

    // زر تحديث المدة يدوياً
    fetchBtn?.addEventListener('click', async () => {
        const url = videoInput?.value.trim();
        if (!url) { showToast('أدخل رابط الفيديو أولاً', 'warning'); return; }
        state.lessonMeta.video_url = url;
        fetchBtn.disabled = true;
        fetchBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        try {
            await fetchAndSetVideoDuration(container);
            showToast('تم تحديث معلومات الفيديو', 'success');
        } finally {
            fetchBtn.disabled = false;
            fetchBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
        }
    });

    // معاينة صورة الغلاف
    coverInput?.addEventListener('blur', () => {
        const url = coverInput.value.trim();
        if (url) updateCoverImagePreview(container, url);
    });

    // تحديث الوحدات عند تغيير المرحلة/الصف/الفصل
const updateUnitsDropdown = async () => {
    if (!unitSelect) return;
    const stage = stageSelect?.value;
    const grade = gradeSelect?.value;
    const semester = semesterSelect?.value;

    // 🛠️ إصلاح: الوحدة تعتمد فعلياً على المرحلة والصف فقط، والفصل الدراسي
    // اختياري لتضييق النتائج فقط (نفس منطق كاروسيل الوحدات في صفحة الدروس)
    if (!stage || !grade) {
        unitSelect.innerHTML = '<option value="">اختر المرحلة والصف أولاً</option>';
        const hintEl = container.querySelector('#units-hint');
        if (hintEl) hintEl.textContent = 'اختر المرحلة والصف لعرض الوحدات المتاحة';
        return;
    }

    unitSelect.disabled = true;
    unitSelect.innerHTML = '<option value="">جاري التحميل...</option>';
    try {
        const units = await fetchUnitsForSelect(stage, grade, semester);
        unitSelect.innerHTML = '<option value="">بدون وحدة</option>' +
            units.map(u => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join('');

        const hintEl = container.querySelector('#units-hint');
        if (hintEl) {
            hintEl.textContent = units.length === 0
                ? 'لا توجد وحدات لهذا الاختيار'
                : `${units.length} وحدة متاحة`;
        }
    } catch (_) {
        unitSelect.innerHTML = '<option value="">تعذر تحميل الوحدات</option>';
    } finally {
        unitSelect.disabled = false;
    }
};

    stageSelect?.addEventListener('change', updateUnitsDropdown);
    gradeSelect?.addEventListener('change', updateUnitsDropdown);
    semesterSelect?.addEventListener('change', updateUnitsDropdown);
}

// ====== دوال جمع وتعبئة بيانات النموذج ======

/**
 * جمع بيانات النموذج في state.lessonMeta
 * @returns {boolean} true إذا تم الجمع بنجاح
 */
function collectFormData(container) {
    const form = container?.querySelector('#lesson-meta-form');
    if (!form) return false;

    const title = form.querySelector('#lesson-title')?.value.trim() || '';
    const stage = form.querySelector('#lesson-stage')?.value || '';
    const grade = form.querySelector('#lesson-grade')?.value || '';
    const semester = form.querySelector('#lesson-semester')?.value || '';
    const unitIdRaw = form.querySelector('#lesson-unit')?.value;
    const videoUrl = form.querySelector('#lesson-video-url')?.value.trim() || '';
    const pdfUrl = form.querySelector('#lesson-pdf-url')?.value.trim() || '';
    const coverUrl = form.querySelector('#lesson-cover-image')?.value.trim() || '';
    const duration = parseInt(form.querySelector('#lesson-duration')?.value) || 0;

    // قراءة خيار إنشاء الامتحان (فقط في وضع الإضافة)
    const examCheckbox = form.querySelector('#create-exam-checkbox');
    state.createExamLinked = examCheckbox ? examCheckbox.checked : false;

    state.lessonMeta = {
        title,
        stage,
        grade: grade ? parseInt(grade) : '',
        semester,
        unit_id: unitIdRaw ? parseInt(unitIdRaw) : null,
        video_url: videoUrl,
        pdf_url: pdfUrl,
        cover_image_url: coverUrl,
        duration
    };

    return true;
}

/**
 * تعبئة حقول النموذج من state.lessonMeta (في وضع التعديل)
 */
function populateFormFields(container) {
    const form = container?.querySelector('#lesson-meta-form');
    if (!form) return;
    const meta = state.lessonMeta;

    const set = (id, val) => {
        const el = form.querySelector(`#${id}`);
        if (el) el.value = val ?? '';
    };

    set('lesson-title', meta.title);
    set('lesson-stage', meta.stage);
    set('lesson-grade', meta.grade);
    set('lesson-semester', meta.semester);
    set('lesson-unit', meta.unit_id || '');
    set('lesson-video-url', meta.video_url);
    set('lesson-pdf-url', meta.pdf_url);
    set('lesson-cover-image', meta.cover_image_url);
    set('lesson-duration', meta.duration);

    // معاينة الصورة المصغرة للفيديو
    const videoId = extractYouTubeId(meta.video_url);
    if (videoId) updateVideoThumbnailPreview(container, videoId);

    // معاينة صورة الغلاف
    if (meta.cover_image_url) updateCoverImagePreview(container, meta.cover_image_url);
}

// ====== التحقق من صحة البيانات ======

function validateLessonMeta() {
    const meta = state.lessonMeta;
    return (
        meta.title.trim().length >= 2 &&
        meta.stage !== '' &&
        meta.grade !== '' &&
        meta.semester !== '' &&
        meta.video_url.trim() !== '' &&
        extractYouTubeId(meta.video_url) !== null
    );
}

// ====== دوال الحفظ ======

async function saveNewLesson() {
    // إضافة type: 'lesson' دائماً
    const lessonData = { ...state.lessonMeta, type: 'lesson' };
    const newId = await createLesson(lessonData);

    // إنشاء امتحان مرتبط إذا طُلب
    if (state.createExamLinked) {
        try {
            await createExam({
                lesson_id: newId,
                title: `امتحان درس: ${state.lessonMeta.title}`,
                stage: state.lessonMeta.stage,
                grade: state.lessonMeta.grade,
                semester: state.lessonMeta.semester,
                unit_id: state.lessonMeta.unit_id,
                duration: 10,
                questions_count: 0,
                is_challenge: false,
                type: 'lesson_exam',
                description: `امتحان تلقائي للدرس "${state.lessonMeta.title}"`,
                questions: []
            }, []);
            showToast('تم إنشاء امتحان مرتبط بالدرس', 'info');
        } catch (examError) {
            console.error('فشل إنشاء الامتحان المرتبط:', examError);
            showToast('تم إنشاء الدرس ولكن فشل إنشاء الامتحان المرتبط', 'warning');
        }
    }

    return newId;
}

// ====== دوال مساعدة ======

async function fetchUnitsForSelect(stage = '', grade = '', semester = '') {
    try {
        const options = {};
        if (stage) options.stage = stage;
        if (grade) options.grade = parseInt(grade);
        if (semester) options.semester = semester;

        let units = await getUnits(options);

        // 🛠️ إصلاح: الوحدات في أي مكان تاني بالنظام (كاروسيل الوحدات في صفحة الدروس)
        // بتتفلتر بالمرحلة والصف فقط بدون الفصل الدراسي. فلو النتيجة رجعت فاضية
        // ومعانا فلتر فصل، نعيد المحاولة بدونه حتى لا تختفي وحدات موجودة فعلاً.
        if (units.length === 0 && options.semester) {
            const { semester: _drop, ...withoutSemester } = options;
            units = await getUnits(withoutSemester);
        }

        return units;
    } catch {
        return [];
    }
}

function collectUnitFormData(form) {
    const name = form.querySelector('#unit-name')?.value.trim();
    const stage = form.querySelector('#unit-stage')?.value;
    const grade = parseInt(form.querySelector('#unit-grade')?.value);
    const semester = form.querySelector('#unit-semester')?.value;
    const order = parseInt(form.querySelector('#unit-order')?.value) || 0;
    const description = form.querySelector('#unit-description')?.value.trim() || '';

    if (!name || !stage || !grade || !semester) return null;

    return { name, stage, grade, semester, order, description };
}

// ====== تصدير الدوال العامة ======
export {
    openAddLessonModal,
    openEditLessonModal,
    openAddUnitModal,
    openMoveLessonModal,
    confirmDeleteLesson
};

// تعريض للنظام العالمي (للاستخدام من lessons.js)
window.lessonManager = {
    openAddLessonModal,
    openEditLessonModal,
    openAddUnitModal,
    openMoveLessonModal,
    confirmDeleteLesson
};
