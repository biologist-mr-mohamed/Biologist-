/**
 * 📋 views/exams/exams.js - نظام الامتحانات الكامل v5.0.0
 * ============================================================================
 * 📝 المسؤولية: (أ) عرض قائمة الامتحانات حسب صلاحيات المستخدم، مع إجراءات المعلم.
 *              (ب) إدارة دورة حياة أداء الامتحان بالكامل: العرض التقديمي، المؤقت،
 *                  التنقل بين الأسئلة، التصحيح، النتائج، الميداليات، والمراجعة.
 * ✅ متوافق مع router: initializePage/cleanupPage لقائمة الامتحانات،
 *    initExamViewPage/cleanupExamViewPage لصفحة الأداء (نفس الملف لكليهما - راجع router.js)
 * ✅ يستخدم api.js فقط كبوابة للتعامل مع Firestore
 * ✅ يتكامل مع exam-manager.js لعمليات الإنشاء/التعديل/الحذف عبر جسر window.examManager
 *    (بدون أي تكرار لمنطق النوافذ - كل إجراءات الإدارة مصدرها الوحيد exam-manager.js)
 * ✅ يبعث أحداث Event Bus بالأسماء القانونية المتفق عليها مع باقي المنصة:
 *    'exam:start' و 'exam:complete' (directing.js) و 'medal:earned' (animations.js + directing.js)
 * ✅ يحدّث درجة امتحان الدرس (user_progress.exam_score) عند وجود ربط lesson_id
 * ✅ يدعم RTL كامل وصلاحيات متعددة
 * 🛠️ إصلاحات هذا الإصدار: تخزين مرجع مستمع Escape/keydown وإزالته في التنظيف (منع
 *    التراكم بين دخول/خروج الصفحة)، قراءة عناصر lightbox عبر container بدل document،
 *    معالجة صور الأسئلة المكسورة بدون كسر الـ layout، وقفل تمرير الصفحة أثناء التكبير.
 * ============================================================================
 */

import { getCurrentUser, isTeacher, isModerator } from '../../js/core/session.js';
import {
    getExams,
    deleteExam,
    moveExam,
    getExamFullData,
    saveExamResult,
    updateUserExamScore,
    getUserExamStats,
    getUnits,
    getUserExamResultsMap,
    getActiveSemesterFor
} from '../../js/core/api.js';
import { EventBus } from '../../js/core/event-bus.js';

// ==== شجرة التصفح الهرمية (مرحلة ← صف ← فصل) — مطابقة تمامًا لـ HIERARCHY في lessons.js ====
const HIERARCHY = {
    stages: [
        { value: 'إعدادي', label: 'الإعدادي' },
        { value: 'ثانوي', label: 'الثانوي' }
    ],
    grades: [
        { value: 1, label: 'الأول' },
        { value: 2, label: 'الثاني' },
        { value: 3, label: 'الثالث' }
    ],
    semesters: [
        { value: 'أول', label: 'الأول' },
        { value: 'ثاني', label: 'الثاني' }
    ]
};

// ==== حد النجاح في الامتحان (بالنسبة المئوية) ====
const PASS_THRESHOLD = 50;

// ==== مستويات الأداء بعد التصحيح ====
const LEVEL_TIERS = [
    { min: 90, key: 'advanced', label: 'مستوى متقدم' },
    { min: 75, key: 'good', label: 'مستوى جيد جداً' },
    { min: 50, key: 'acceptable', label: 'مستوى مقبول' },
    { min: 0, key: 'beginner', label: 'يحتاج مراجعة' }
];

// ==== أوسمة امتحانات المتفوقين (Challenge) ====
const MEDAL_TIERS = [
    { min: 95, key: 'gold', label: 'ميدالية ذهبية' },
    { min: 90, key: 'silver', label: 'ميدالية فضية' },
    { min: 85, key: 'bronze', label: 'ميدالية برونزية' }
];

// ====== جسر الاتصال بـ exam-manager.js (مصدر وحيد، بدون تكرار منطق) ======
// 🛠️ إصلاح: سابقاً كانت openDeleteConfirmModal و openMoveExamModal تعيدان بناء نفس
// نوافذ exam-manager.js يدوياً كخطة بديلة (fallback) لو window.examManager لسه مش جاهز،
// وده كان معناه نسختين من نفس المنطق لازم تتصلحا مع بعض عند أي تعديل مستقبلي.
// الحل: انتظار حقيقي لجاهزية الوحدة (import ديناميكي مرة واحدة فقط) بدل تكرار الكود.
let examManagerPromise = null;
async function getExamManager() {
    if (window.examManager) return window.examManager;
    if (!examManagerPromise) {
        examManagerPromise = import('./exam-manager.js').then(() => window.examManager);
    }
    return examManagerPromise;
}

/* ============================================================================
 * 🅰️ القسم الأول: صفحة قائمة الامتحانات (Route: exams)
 * ========================================================================== */

function initialListState() {
    return {
        initialized: false,
        container: null,
        currentUser: null,
        exams: [],
        filteredExams: [],
        units: [], // وحدات السياق الحالي (لعرض تبويبات الوحدات في شريط التصنيفات)
        activeFilter: { type: 'all', unitId: null }, // 'all' | 'comprehensive' | 'unit' | 'completed'
        examResultsMap: {}, // نتائج امتحانات الطالب مفهرسة بمعرف الامتحان (لتحديد "المكتملة")
        isLoading: false,
        // سياق تصفح المعلم فقط (شجرة مرحلة ← صف ← فصل) — لا علاقة له بما يظهر فعليًا للطلاب
        activeStage: null,
        activeGrade: null,
        workingSemester: null,
        liveSemesterCache: {},
        lastVisible: null,
        hasMore: true,
        elements: {},
        unsubscribers: []
    };
}

let state = initialListState();

/**
 * @function initializePage
 * @description تُستدعى من router بعد تحميل HTML صفحة قائمة الامتحانات
 */
export async function initializePage(container, params = {}) {
    if (state.initialized && state.container === container) {
        console.log('⚠️ [exams] الصفحة مهيأة مسبقاً');
        return;
    }

    console.log('📋 [exams] بدء تهيئة صفحة الامتحانات...');
    if (state.initialized) cleanupPage();

    state.container = container;
    state.currentUser = getCurrentUser();

    try {
        cacheElements(container);
        setupUIBasedOnRole();
        bindEvents();
        await loadExams();

        state.initialized = true;
        console.log('✅ [exams] تم تهيئة الصفحة بنجاح');
        EventBus.emit('page:ready', { page: 'exams' });
    } catch (error) {
        console.error('❌ [exams] فشل تهيئة الصفحة:', error);
        showToast('حدث خطأ أثناء تحميل الصفحة', 'error');
        showErrorState(container, error);
    }
}

/**
 * @function cleanupPage
 * @description تُستدعى من router عند مغادرة صفحة قائمة الامتحانات
 */
export function cleanupPage() {
    console.log('🧹 [exams] تنظيف صفحة الامتحانات...');
    state.unsubscribers.forEach(unsub => {
        try { unsub(); } catch (_) { /* تجاهل */ }
    });
    state = initialListState();
    console.log('✅ [exams] تم تنظيف الصفحة');
}

// ====== دوال مساعدة DOM (القائمة) ======

function cacheElements(container) {
    // ملاحظة: container عنصر DOM وليس document، لذا يجب استخدام querySelector('#id') وليس getElementById
    state.elements = {
        loadingState: container.querySelector('.loading-state'),
        examsGrid: container.querySelector('.exams-grid'),
        filtersSection: container.querySelector('.exams-filters'),
        teacherActions: container.querySelector('.teacher-actions'),
        teacherFilters: container.querySelector('.teacher-filters'),
        addExamBtn: container.querySelector('[data-action="add-exam"]'),
        teacherTreeContainer: container.querySelector('#exam-teacher-tree-container'),
        statsSummary: container.querySelector('.stats-summary'),
        statsSummary: container.querySelector('.stats-summary'),
        totalExamsEl: container.querySelector('[data-stat="total-exams"]'),
        completedExamsEl: container.querySelector('[data-stat="completed-exams"]'),
        averageScoreEl: container.querySelector('[data-stat="average-score"]'),
        subtitleEl: container.querySelector('#exams-subtitle'),
        examCategoriesContainer: container.querySelector('#exam-categories-container'),
        unitsContainer: container.querySelector('#exam-units-container')
    };
}

function setupUIBasedOnRole() {
    const user = state.currentUser;
    const isAdmin = user && (isTeacher(user) || isModerator(user));

    if (state.elements.teacherActions) {
        state.elements.teacherActions.style.display = isAdmin ? 'flex' : 'none';
    }
    if (state.elements.teacherFilters) {
        state.elements.teacherFilters.style.display = isAdmin ? 'block' : 'none';
    }
    if (isAdmin) {
        renderTeacherCategoryTree();
    }
    if (state.elements.statsSummary) {
        state.elements.statsSummary.style.display = (!isAdmin && user?.user_type === 'student') ? 'block' : 'none';
    }

    if (state.elements.subtitleEl) {
        if (isAdmin) {
            state.elements.subtitleEl.textContent = 'جميع الامتحانات (يمكنك إدارة الامتحانات)';
        } else if (user) {
            const stageMap = { preparatory: 'الإعدادية', secondary: 'الثانوية' };
            const stage = stageMap[user.stage] || user.stage;
            const grade = user.grade ? `الصف ${user.grade}` : '';
            const semester = user.semester ? `الفصل ${user.semester === 'first' ? 'الأول' : 'الثاني'}` : '';
            state.elements.subtitleEl.textContent = `${stage || ''} ${grade} ${semester}`.trim() || 'حسب مرحلتك';
        } else {
            state.elements.subtitleEl.textContent = 'سجل الدخول لعرض الامتحانات';
        }
    }
}

// ====== جلب البيانات (القائمة) ======

async function loadExams() {
    if (state.isLoading) return;

    state.isLoading = true;
    showLoading(true);

    try {
        const user = state.currentUser;
        const isAdmin = user && (isTeacher(user) || isModerator(user));
        // المعلم/المشرف يجلب كل الامتحانات دفعة واحدة، وفلترة شجرة التصفح (مرحلة/صف/فصل)
        const options = { limit: 50 };

        // الطالب يُقيَّد تلقائياً بمرحلته وصفه وفصله الدراسي
        if (user && !isAdmin) {
            options.stage = user.stage;
            options.grade = user.grade;
            options.semester = user.semester;
        }

        const exams = await getExams(options);

        // دمج حالة "الإكمال" للطالب (لتبويب "المكتملة")
        if (user && user.user_type === 'student') {
            try {
                state.examResultsMap = await getUserExamResultsMap(user.id);
            } catch (_) {
                state.examResultsMap = {};
            }
            exams.forEach(exam => {
                exam.completed = !!state.examResultsMap[exam.id];
            });
        } else {
            exams.forEach(exam => { exam.completed = false; });
        }

        state.exams = exams;

        // جلب الوحدات لبناء شريط التصنيفات السريعة (الكل / الشامل / كل وحدة / المكتملة)
        state.units = await fetchUnitsForExams();

        state.filteredExams = applyFilters(exams);

        renderExamCategoriesBar();
        renderUnitsCarousel();
        renderExamsGrid(state.filteredExams);
        await updateStatsSummary(state.filteredExams);

        if (isAdmin) {
            renderTeacherCategoryTree();
        }
    } catch (error) {
        console.error('❌ [exams] فشل جلب الامتحانات:', error);
        showToast('تعذر تحميل الامتحانات', 'error');
        renderEmptyState(true);
    } finally {
        state.isLoading = false;
        showLoading(false);
    }
}

/**
 * فلترة إضافية على جهة العميل: سياق تصفح المعلم الهرمي (مرحلة/صف/فصل)
 * ثم التصنيف السريع النشط (الكل/الشامل/وحدة/المكتملة). لا حاجة لأي ترجمة قيم
 * لأن قيم الشجرة مطابقة تمامًا لقيم Firestore (نفس نهج lessons.js).
 */
function applyFilters(exams) {
    let filtered = exams.filter(exam => {
        if (state.activeStage && exam.stage !== state.activeStage) return false;
        if (state.activeGrade !== null && Number(exam.grade) !== state.activeGrade) return false;
        if (state.workingSemester && exam.semester !== state.workingSemester) return false;
        return true;
    });

    // تطبيق التصنيف السريع النشط (الكل / الشامل / وحدة معينة / المكتملة)
    switch (state.activeFilter.type) {
        case 'comprehensive':
            filtered = filtered.filter(exam => exam.exam_scope === 'comprehensive');
            break;
        case 'unit':
            filtered = filtered.filter(exam => exam.unit_id == state.activeFilter.unitId);
            break;
        case 'completed':
            filtered = filtered.filter(exam => exam.completed);
            break;
        // 'all' → بدون فلترة إضافية
    }

    return filtered;
}

/**
 * نفس فلترة المرحلة/الصف/الفصل في applyFilters، لكن بدون فلترة التصنيف السريع نفسه —
 * تُستخدم لحساب عدّاد كل تبويب في شريط التصنيفات دون أن يؤثر التبويب النشط على عدّاده
 */
function getScopedExamsForCounts() {
    return state.exams.filter(exam => {
        if (state.activeStage && exam.stage !== state.activeStage) return false;
        if (state.activeGrade !== null && Number(exam.grade) !== state.activeGrade) return false;
        if (state.workingSemester && exam.semester !== state.workingSemester) return false;
        return true;
    });
}

/**
 * جلب الوحدات المناسبة لسياق العرض الحالي:
 * - الطالب: وحدات مرحلته/صفه/فصله فقط (نفس منطق fetchUnits في lessons.js)
 * - المعلم/المشرف: وحدات فلاتر التصفح الحالية إن وُجدت، أو كل الوحدات
 */
async function fetchUnitsForExams() {
    const user = state.currentUser;
    const isAdmin = user && (isTeacher(user) || isModerator(user));
    const options = {};

    if (user && !isAdmin) {
        options.stage = user.stage;
        options.grade = user.grade;
        options.semester = user.semester;
    } else {
        if (state.activeStage) options.stage = state.activeStage;
        if (state.activeGrade !== null) options.grade = state.activeGrade;
        if (state.workingSemester) options.semester = state.workingSemester;
    }

    try {
        return await getUnits(options);
    } catch (error) {
        console.error('❌ [exams] فشل جلب الوحدات لشريط التصنيفات:', error);
        return [];
    }
}

/**
 * رسم شريط التصنيفات السريعة: الكل / الشامل / المكتملة
 * 🛠️ تبويب "لكل وحدة" اتنقل لقسم كاروسيل الوحدات المستقل (renderUnitsCarousel) تحت
 * عشان يبقى شكل تصفح الوحدات مطابق تمامًا لنظام الدروس بدل ما يتكرر كـ pill هنا كمان
 */
function renderExamCategoriesBar() {
    const container = state.elements.examCategoriesContainer;
    if (!container) return;

    const scoped = getScopedExamsForCounts();
    const comprehensiveCount = scoped.filter(e => e.exam_scope === 'comprehensive').length;
    const completedCount = scoped.filter(e => e.completed).length;

    const isActive = (type, unitId = null) =>
        state.activeFilter.type === type && (type !== 'unit' || state.activeFilter.unitId == unitId);

    let html = `
        <button type="button" class="category-btn ${isActive('all') ? 'active' : ''}" data-filter-type="all">
            <i class="fas fa-th-large" aria-hidden="true"></i> الكل
        </button>
        <button type="button" class="category-btn ${isActive('comprehensive') ? 'active' : ''}" data-filter-type="comprehensive">
            <i class="fas fa-globe" aria-hidden="true"></i> الشامل <span class="category-count">${comprehensiveCount}</span>
        </button>
        <button type="button" class="category-btn ${isActive('completed') ? 'active' : ''}" data-filter-type="completed">
            <i class="fas fa-check-circle" aria-hidden="true"></i> المكتملة <span class="category-count">${completedCount}</span>
        </button>`;

    container.innerHTML = html;

    container.querySelectorAll('.category-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.dataset.filterType;

            // تبديل الفلتر عند النقر على التبويب النشط بالفعل → الرجوع لـ "الكل"
            const alreadyActive = isActive(type);
            state.activeFilter = alreadyActive ? { type: 'all', unitId: null } : { type, unitId: null };

            state.filteredExams = applyFilters(state.exams);
            renderExamsGrid(state.filteredExams);
            updateStatsSummary(state.filteredExams);
            renderExamCategoriesBar();
            renderUnitsCarousel();
        });
    });
}

/**
 * 🗂️ كاروسيل الوحدات — نسخة مطابقة تمامًا لـ renderUnitsCarousel في lessons.js
 * (نفس البنية والكلاسات؛ بيعد امتحانات بدل دروس، وبيتحكم في state.activeFilter من نوع 'unit')
 */
function renderUnitsCarousel() {
    const container = state.elements.unitsContainer;
    if (!container) return;

    if (state.units.length === 0) {
        container.innerHTML = `<div class="units-empty">
            <i class="fas fa-folder-open"></i>
            <p>لا توجد وحدات متاحة</p>
        </div>`;
        return;
    }

    const scoped = getScopedExamsForCounts();
    const isUnitActive = (unitId) => state.activeFilter.type === 'unit' && state.activeFilter.unitId == unitId;

    const allBtn = `<div class="unit-card ${state.activeFilter.type === 'all' ? 'active' : ''}" data-unit-id="all">
        <div class="unit-icon"><i class="fas fa-th-large"></i></div>
        <h4 class="unit-name">الكل</h4>
        <p class="unit-count">${scoped.length} امتحان</p>
    </div>`;

    const unitsHtml = state.units.map(unit => {
        const count = scoped.filter(e => e.unit_id == unit.id).length;
        return `<div class="unit-card ${isUnitActive(unit.id) ? 'active' : ''}" data-unit-id="${unit.id}">
            <div class="unit-icon"><i class="fas fa-layer-group"></i></div>
            <h4 class="unit-name">${escapeHtml(unit.name)}</h4>
            <p class="unit-count">${count} امتحان</p>
        </div>`;
    }).join('');

    container.innerHTML = allBtn + unitsHtml;

    container.querySelectorAll('.unit-card').forEach(card => {
        card.addEventListener('click', () => {
            const val = card.dataset.unitId;
            if (val === 'all') {
                state.activeFilter = { type: 'all', unitId: null };
            } else {
                const unitId = parseInt(val, 10);
                const alreadyActive = isUnitActive(unitId);
                state.activeFilter = alreadyActive ? { type: 'all', unitId: null } : { type: 'unit', unitId };
            }

            state.filteredExams = applyFilters(state.exams);
            renderExamsGrid(state.filteredExams);
            updateStatsSummary(state.filteredExams);
            renderExamCategoriesBar();
            renderUnitsCarousel();
        });
    });
}

// ====== عرض البيانات (القائمة) ======

function renderExamsGrid(exams) {
    const grid = state.elements.examsGrid;
    if (!grid) return;

    if (!exams || exams.length === 0) {
        renderEmptyState();
        return;
    }

    const user = state.currentUser;
    const isAdmin = user && (isTeacher(user) || isModerator(user));

    grid.innerHTML = exams.map(exam => createExamCard(exam, isAdmin)).join('');

    // ربط أحداث البطاقات (الانتقال لأداء الامتحان)
    grid.querySelectorAll('.exam-card').forEach(card => {
        const examId = card.dataset.id;
        card.addEventListener('click', (e) => {
            if (e.target.closest('.admin-action')) return; // لا تفعل شيئاً عند النقر على أزرار الإدارة
            handleExamClick(examId);
        });
    });

    if (isAdmin) bindAdminActions(grid);
}

function createExamCard(exam, isAdmin) {
    const stageLabel = escapeHtml(exam.stage || '');
    const semesterLabel = escapeHtml(exam.semester || '');

    const challengeBadge = exam.is_challenge
        ? '<span class="exam-challenge-badge"><i class="fas fa-trophy"></i> المتفوقين</span>'
        : '';

    // شارة نطاق الامتحان: شامل أو اسم الوحدة
    const unit = exam.unit_id ? state.units.find(u => u.id == exam.unit_id) : null;
    const scopeBadge = exam.exam_scope === 'comprehensive'
        ? '<span class="exam-scope-badge comprehensive"><i class="fas fa-globe"></i> شامل</span>'
        : `<span class="exam-scope-badge unit-scope"><i class="fas fa-layer-group"></i> ${escapeHtml(unit?.name || 'وحدة')}</span>`;

    // شارة "مكتمل" (تظهر للطالب فقط عبر exam.completed المحسوبة في loadExams)
    const completedBadge = exam.completed
        ? '<span class="exam-completed-badge"><i class="fas fa-check-circle"></i> مكتمل</span>'
        : '';

    const thumbnail = exam.cover_image_url
        ? `<img src="${escapeHtml(exam.cover_image_url)}" alt="غلاف ${escapeHtml(exam.title)}" loading="lazy">`
        : `<div class="exam-thumbnail-placeholder"><i class="fas fa-graduation-cap"></i></div>`;

    const adminActions = isAdmin ? `
        <div class="exam-admin-actions">
            <button type="button" class="admin-action" data-action="edit" data-id="${exam.id}" title="تعديل" aria-label="تعديل الامتحان"><i class="fas fa-edit"></i></button>
            <button type="button" class="admin-action" data-action="delete" data-id="${exam.id}" title="حذف" aria-label="حذف الامتحان"><i class="fas fa-trash-alt"></i></button>
            <button type="button" class="admin-action" data-action="move" data-id="${exam.id}" title="تحريك" aria-label="تحريك الامتحان"><i class="fas fa-arrows-alt-v"></i></button>
        </div>
    ` : '';

    return `
        <div class="exam-card" data-id="${exam.id}">
            <div class="exam-thumbnail">
                ${thumbnail}
                <div class="exam-thumbnail-badges">
                    <span class="exam-duration"><i class="fas fa-clock"></i> ${safeInt(exam.duration, 30)} د</span>
                    ${challengeBadge}
                    ${completedBadge}
                </div>
            </div>
            <div class="exam-info">
                <h3 class="exam-title">${escapeHtml(exam.title)}</h3>
                ${exam.description ? `<p class="exam-description">${escapeHtml(exam.description)}</p>` : ''}
                <div class="exam-meta">
                    <span class="exam-stage">${stageLabel}</span>
                    <span class="exam-grade">الصف ${safeInt(exam.grade, '')}</span>
                    <span class="exam-semester">الفصل ${semesterLabel}</span>
                    ${scopeBadge}
                </div>
                <span class="exam-questions"><i class="fas fa-question-circle"></i> ${safeInt(exam.questions_count, 0)} سؤال</span>
            </div>
            <div class="exam-card-footer">
                <div class="exam-card-actions-row">
                    ${adminActions}
                </div>
                <button type="button" class="exam-action" data-id="${exam.id}">
                    <i class="fas fa-play"></i> بدء الامتحان
                </button>
            </div>
        </div>
    `;
}

function bindAdminActions(grid) {
    grid.querySelectorAll('[data-action="edit"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openEditExamModal(btn.dataset.id);
        });
    });

    grid.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openDeleteConfirmModal(btn.dataset.id);
        });
    });

    grid.querySelectorAll('[data-action="move"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openMoveExamModal(btn.dataset.id);
        });
    });
}

function renderEmptyState(isError = false) {
    const grid = state.elements.examsGrid;
    if (!grid) return;

    const message = isError ? 'حدث خطأ أثناء تحميل الامتحانات' : 'لا توجد امتحانات متاحة حالياً';
    grid.innerHTML = `
        <div class="${isError ? 'exams-error' : 'exams-empty'}">
            <i class="fas ${isError ? 'fa-exclamation-triangle error-icon' : 'fa-graduation-cap empty-icon'}"></i>
            <h3>${message}</h3>
            ${!isError ? '<p>يمكنك العودة لاحقاً أو التواصل مع المعلم</p>' : ''}
            ${isError ? '<button type="button" class="btn btn-outline retry-btn">إعادة المحاولة</button>' : ''}
        </div>
    `;

    if (isError) {
        grid.querySelector('.retry-btn')?.addEventListener('click', () => loadExams());
    }
}

async function updateStatsSummary(exams) {
    const el = state.elements.statsSummary;
    if (!el || el.style.display === 'none') return;

    const user = state.currentUser;
    if (!user || user.user_type !== 'student') return;

    try {
        const stats = await getUserExamStats(user.id);
        if (state.elements.totalExamsEl) state.elements.totalExamsEl.textContent = exams.length;
        if (state.elements.completedExamsEl) state.elements.completedExamsEl.textContent = stats.completedExams || 0;
        if (state.elements.averageScoreEl) state.elements.averageScoreEl.textContent = (stats.averageScore || 0) + '%';
    } catch (error) {
        console.warn('⚠️ [exams] تعذر جلب إحصائيات المستخدم:', error);
    }
}

// ====== معالجات الأحداث (القائمة) ======

function bindEvents() {
    if (state.elements.addExamBtn) {
        state.elements.addExamBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openAddExamModal();
        });
    }

    // الاستماع لأحداث تحديث الامتحانات من exam-manager (مع تتبع الإلغاء لمنع تسريب الذاكرة)
    state.unsubscribers.push(EventBus.on('exam:created', () => loadExams()));
    state.unsubscribers.push(EventBus.on('exam:updated', () => loadExams()));
    state.unsubscribers.push(EventBus.on('exam:deleted', () => loadExams()));
    state.unsubscribers.push(EventBus.on('exam:moved', () => loadExams()));
}

// ====== شجرة تنقّل المعلم الهرمية (مرحلة ← صف ← فصل كسياق تصفح فقط) ======
// نسخة مطابقة لمنطق lessons.js، بس بتعدّ امتحانات بدل دروس

function renderTeacherCategoryTree() {
    const container = state.elements.teacherTreeContainer;
    if (!container) return;

    const countForStage = (stage) => state.exams.filter(e => e.stage === stage).length;
    const countForGrade = (stage, grade) => state.exams.filter(e => e.stage === stage && Number(e.grade) === grade).length;

    const stagesHtml = HIERARCHY.stages.map(stage => {
        const isStageActive = state.activeStage === stage.value;

        const gradesHtml = HIERARCHY.grades.map(grade => {
            const isGradeActive = isStageActive && state.activeGrade === grade.value;
            const cacheKey = `${stage.value}_${grade.value}`;
            const liveSemester = state.liveSemesterCache[cacheKey];

            const showLiveHint = isGradeActive && state.workingSemester && liveSemester
                && liveSemester !== state.workingSemester;

            const semesterHtml = isGradeActive ? `
                <div class="semester-toggle" role="group" aria-label="اختيار الفصل الدراسي للتصفح">
                    <span class="semester-toggle-hint">
                        <i class="fas fa-eye" aria-hidden="true"></i>
                        أنت بتتصفح فقط — مش بتغيّر اللي شايفه الطلاب
                    </span>
                    <div class="semester-toggle-buttons">
                        ${HIERARCHY.semesters.map(sem => `
                            <button type="button" class="semester-chip ${state.workingSemester === sem.value ? 'active' : ''}"
                                data-semester="${sem.value}">
                                الفصل ${sem.label}
                            </button>`).join('')}
                    </div>
                    ${showLiveHint ? `
                        <p class="browsing-live-hint">
                            <i class="fas fa-info-circle" aria-hidden="true"></i>
                            أنت بتعرض الفصل ${state.workingSemester === 'أول' ? 'الأول' : 'الثاني'} —
                            الفصل الظاهر حاليًا للطلاب هو ${liveSemester === 'أول' ? 'الأول' : 'الثاني'}
                        </p>` : ''}
                </div>` : '';

            return `
                <button type="button" class="grade-chip ${isGradeActive ? 'active' : ''}"
                    data-stage="${escapeHtml(stage.value)}" data-grade="${grade.value}">
                    الصف ${grade.label}
                    <span class="chip-count">${countForGrade(stage.value, grade.value)} امتحان</span>
                </button>
                ${semesterHtml}`;
        }).join('');

        return `
            <div class="stage-group ${isStageActive ? 'expanded' : ''}">
                <button type="button" class="stage-chip ${isStageActive ? 'active' : ''}"
                    data-stage="${escapeHtml(stage.value)}" aria-expanded="${isStageActive}">
                    <i class="fas fa-layer-group" aria-hidden="true"></i>
                    ${stage.label}
                    <span class="chip-count">${countForStage(stage.value)} امتحان</span>
                    <i class="fas fa-chevron-down stage-chevron" aria-hidden="true"></i>
                </button>
                ${isStageActive ? `<div class="grade-chips">${gradesHtml}</div>` : ''}
            </div>`;
    }).join('');

    container.innerHTML = `<div class="teacher-category-tree">${stagesHtml}</div>`;

    container.querySelectorAll('.stage-chip').forEach(btn => {
        btn.addEventListener('click', () => toggleStageContext(btn.dataset.stage));
    });
    container.querySelectorAll('.grade-chip').forEach(btn => {
        btn.addEventListener('click', () => toggleGradeContext(btn.dataset.stage, parseInt(btn.dataset.grade, 10)));
    });
    container.querySelectorAll('.semester-chip').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            setWorkingSemester(btn.dataset.semester);
        });
    });
}

// إعادة حساب الوحدات والتصنيفات والشبكة بعد أي تغيير في سياق تصفح المعلم
async function refreshAfterTreeContextChange() {
    state.activeFilter = { type: 'all', unitId: null };
    state.units = await fetchUnitsForExams();
    state.filteredExams = applyFilters(state.exams);
    renderExamCategoriesBar();
    renderUnitsCarousel();
    renderExamsGrid(state.filteredExams);
}

async function toggleStageContext(stage) {
    state.activeStage = (state.activeStage === stage) ? null : stage;
    state.activeGrade = null;
    state.workingSemester = null;
    renderTeacherCategoryTree();
    await refreshAfterTreeContextChange();
}

async function toggleGradeContext(stage, grade) {
    const isSame = state.activeStage === stage && state.activeGrade === grade;
    state.activeStage = stage;
    state.activeGrade = isSame ? null : grade;
    state.workingSemester = null;
    renderTeacherCategoryTree();
    await refreshAfterTreeContextChange();

    if (isSame) return;

    // نجيب الفصل الحي الفعلي (لعرضه كتنبيه فقط لو المعلم اختار يتصفح فصل مختلف) — بدون تأثير على أي فلترة
    const cacheKey = `${stage}_${grade}`;
    if (state.liveSemesterCache[cacheKey] === undefined) {
        try {
            state.liveSemesterCache[cacheKey] = await getActiveSemesterFor(stage, grade);
        } catch (_) {
            state.liveSemesterCache[cacheKey] = null;
        }
        renderTeacherCategoryTree();
    }
}

async function setWorkingSemester(semester) {
    state.workingSemester = semester;
    renderTeacherCategoryTree();
    await refreshAfterTreeContextChange();
}

async function resetFilters() {
    state.filters = { stage: '', grade: '', semester: '' };
    state.activeFilter = { type: 'all', unitId: null };
    if (state.elements.filterStage) state.elements.filterStage.value = '';
    if (state.elements.filterGrade) state.elements.filterGrade.value = '';
    if (state.elements.filterSemester) state.elements.filterSemester.value = '';

    state.units = await fetchUnitsForExams();
    state.filteredExams = [...state.exams];
    renderExamCategoriesBar();
    renderUnitsCarousel();
    renderExamsGrid(state.filteredExams);
}

function handleExamClick(examId) {
    const user = state.currentUser;
    if (!user) {
        showToast('يرجى تسجيل الدخول أولاً', 'warning');
        window.router?.navigateTo('login');
        return;
    }
    window.router?.navigateTo('exam-view', { path: { id: examId } });
}

// ====== دوال التعامل مع exam-manager (تُستدعى من الأزرار) ======
// 🛠️ إصلاح: كل الدوال الأربعة بقت بترجع مباشرة لـ exam-manager.js عبر getExamManager()
// بدل تكرار منطق بناء النوافذ محلياً - أي تعديل مستقبلي على نوافذ الإدارة هيتعمل في
// مكان واحد بس (exam-manager.js) بدل الاضطرار لمزامنة نسختين

async function openAddExamModal() {
    if (!isTeacher(state.currentUser) && !isModerator(state.currentUser)) {
        showToast('ليس لديك صلاحية لإضافة امتحان', 'error');
        return;
    }
    try {
        const manager = await getExamManager();
        manager.openAddExamModal();
    } catch (err) {
        console.error('فشل تحميل exam-manager:', err);
        showToast('تعذر فتح نموذج إضافة الامتحان', 'error');
    }
}

async function openEditExamModal(examId) {
    try {
        const manager = await getExamManager();
        manager.openEditExamModal(examId);
    } catch (err) {
        console.error('فشل تحميل exam-manager:', err);
        showToast('تعذر فتح نموذج التعديل', 'error');
    }
}

async function openDeleteConfirmModal(examId) {
    try {
        const manager = await getExamManager();
        manager.confirmDeleteExam(examId);
    } catch (err) {
        console.error('فشل تحميل exam-manager:', err);
        showToast('تعذر فتح نافذة الحذف', 'error');
    }
}

async function openMoveExamModal(examId) {
    try {
        const manager = await getExamManager();
        manager.openMoveExamModal(examId);
    } catch (err) {
        console.error('فشل تحميل exam-manager:', err);
        showToast('تعذر فتح نافذة التحريك', 'error');
    }
}

// ====== دوال مساعدة عامة (مشتركة بين القسمين) ======

function showLoading(show) {
    if (state.elements.loadingState) {
        state.elements.loadingState.style.display = show ? 'flex' : 'none';
    }
    if (state.elements.examsGrid) {
        state.elements.examsGrid.style.opacity = show ? '0.5' : '1';
    }
}

function showErrorState(container, error) {
    const grid = container.querySelector('.exams-grid');
    if (grid) {
        grid.innerHTML = `
            <div class="exams-error">
                <i class="fas fa-exclamation-triangle error-icon"></i>
                <h3>عذراً، حدث خطأ</h3>
                <p>${escapeHtml(error.message || 'خطأ غير معروف')}</p>
                <button type="button" class="btn btn-primary retry-page-btn">إعادة تحميل الصفحة</button>
            </div>
        `;
        grid.querySelector('.retry-page-btn')?.addEventListener('click', () => location.reload());
    }
}

function showToast(message, type = 'info') {
    if (window.modals?.toast) {
        window.modals.toast(message, type);
    } else {
        console.log(`[${type}] ${message}`);
    }
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function safeInt(value, fallback = 0) {
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? fallback : n;
}

function formatTime(totalSeconds) {
    const s = Math.max(0, safeInt(totalSeconds, 0));
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${mm}:${ss}`;
}

function letterAr(index) {
    // تحويل رقم الخيار إلى حرف عربي (أ، ب، ج، د...)
    const letters = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];
    return letters[index] || String(index + 1);
}

/* ============================================================================
 * 🅱️ القسم الثاني: صفحة أداء الامتحان (Route: exam-view)
 * ========================================================================== */

function initialViewState() {
    return {
        initialized: false,
        container: null,
        currentUser: null,
        examId: null,
        examMeta: null,
        questions: [],
        currentIndex: 0,
        answers: {},           // index -> إجابة المستخدم (خام)
        markedForReview: new Set(),
        startedAt: null,
        durationSeconds: 0,
        remainingSeconds: 0,
        timerInterval: null,
        submitted: false,
        result: null,
        elements: {},
        unsubscribers: [],
        keydownHandler: null // 🛠️ مرجع مستمع Escape على document ليُزال بأمان عند التنظيف
    };
}

let viewState = initialViewState();

/**
 * @function initExamViewPage
 * @description تُستدعى من router عند الدخول إلى صفحة أداء امتحان محدد
 */
export async function initExamViewPage(container, params = {}) {
    if (viewState.initialized) await cleanupExamViewPage();

    const examId = params.path?.id;
    if (!examId) {
        console.error('❌ [exam-view] معرف الامتحان مفقود');
        window.router?.navigateTo('not-found');
        return;
    }

    viewState.container = container;
    viewState.currentUser = getCurrentUser();
    viewState.examId = examId;

    if (!viewState.currentUser) {
        showToast('يرجى تسجيل الدخول أولاً', 'warning');
        window.router?.navigateTo('login');
        return;
    }

    try {
        cacheViewElements(container);
        bindViewStaticEvents();
        await loadExamData(examId);

        viewState.initialized = true;
        EventBus.emit('page:ready', { page: 'exam-view' });
    } catch (error) {
        console.error('❌ [exam-view] فشل تهيئة صفحة الامتحان:', error);
        showToast('تعذر تحميل بيانات الامتحان', 'error');
        window.router?.navigateTo('exams');
    }
}

/**
 * @function cleanupExamViewPage
 * @description تُستدعى من router عند مغادرة صفحة أداء الامتحان - توقف المؤقت إجبارياً
 */
export async function cleanupExamViewPage() {
    stopTimer();
    closeImageZoom(); // يزيل قفل تمرير الصفحة إن كان مفعّلاً قبل المغادرة
    if (viewState.keydownHandler) {
        document.removeEventListener('keydown', viewState.keydownHandler);
    }
    viewState.unsubscribers.forEach(unsub => {
        try { unsub(); } catch (_) { /* تجاهل */ }
    });
    viewState = initialViewState();
}

// ====== تخزين عناصر DOM (صفحة الأداء) ======

function cacheViewElements(container) {
    viewState.elements = {
        loadingState: container.querySelector('.loading-state'),
        breadcrumbActive: container.querySelector('.breadcrumb-item.active'),

        introSection: container.querySelector('.exam-intro-section'),
        stageBadge: container.querySelector('#exam-stage-badge'),
        gradeBadge: container.querySelector('#exam-grade-badge'),
        semesterBadge: container.querySelector('#exam-semester-badge'),
        challengeBadge: container.querySelector('#exam-challenge-badge'),
        examTitle: container.querySelector('#exam-title'),
        examDescription: container.querySelector('#exam-description'),
        questionsCount: container.querySelector('#questions-count'),
        examDuration: container.querySelector('#exam-duration'),
        startBtn: container.querySelector('.exam-start-btn'),

        screenSection: container.querySelector('.exam-screen-section'),
        timerEl: container.querySelector('.status-pill-time'),
        timerValue: container.querySelector('#timer-value'),
        prevBtn: container.querySelector('.prev-btn'),
        nextBtn: container.querySelector('.next-btn'),
        questionCounter: container.querySelector('#question-counter'),
        navCounter: container.querySelector('#nav-counter'),
        answeredCount: container.querySelector('#answered-count'),
        submitBtn: container.querySelector('.submit-btn'),
        currentQuestionNumber: container.querySelector('#current-question-number'),
        markReviewBtn: container.querySelector('[data-action="mark-review"]'),
        questionText: container.querySelector('#question-text'),
        questionImageCol: container.querySelector('#question-image-col'),
        questionImageFrame: container.querySelector('#question-image-frame'),
        questionImageEl: container.querySelector('#question-image-el'),
        imageZoomBtn: container.querySelector('#image-zoom-btn'),
        questionOptions: container.querySelector('#question-options'),
        progressPercentage: container.querySelector('#progress-percentage'),
        progressBarFill: container.querySelector('#progress-bar-fill'),
        paletteGrid: container.querySelector('#palette-grid'),
        paletteArrowPrev: container.querySelector('.palette-arrow-prev'),
        paletteArrowNext: container.querySelector('.palette-arrow-next'),

        // 🛠️ إصلاح: نافذة التكبير جزء من HTML الخاص بهذه الصفحة داخل container، لذا
        // نقرأها عبر container.querySelector بدل document.getElementById لتفادي أي
        // التقاط لعنصر قديم من نسخة سابقة للصفحة عند إعادة الدخول إليها
        imageZoomOverlay: container.querySelector('#image-zoom-overlay'),
        imageZoomFull: container.querySelector('#image-zoom-full'),
        imageZoomClose: container.querySelector('#image-zoom-close'),

        resultsSection: container.querySelector('.exam-results-section'),
        // 🛠️ إضافة: مطلوبة لضبط متغيّر --score على .score-circle (حلقة تقدّم بصرية
        // بديلاً عن الخلفية المتدرّجة الثابتة سابقًا) — لا تُستخدم لأي منطق حسابي.
        scoreCircle: container.querySelector('.score-circle'),
        scoreValue: container.querySelector('#score-value'),
        correctCount: container.querySelector('#correct-count'),
        totalCount: container.querySelector('#total-count'),
        timeTaken: container.querySelector('#time-taken'),
        levelBadge: container.querySelector('#level-badge'),
        medalDisplay: container.querySelector('#medal-display'),
        medalName: container.querySelector('#medal-name'),
        resultsFeedback: container.querySelector('#results-feedback'),
        reviewExamBtn: container.querySelector('[data-action="review-exam"]'),
        backToExamsBtn: container.querySelector('[data-action="back-to-exams"]'),
        retryExamBtn: container.querySelector('[data-action="retry-exam"]'),

        reviewSection: container.querySelector('.exam-review-section'),
        backToResultsBtn: container.querySelector('.back-to-results-btn'),
        reviewQuestions: container.querySelector('#review-questions')
    };
}

function bindViewStaticEvents() {
    const el = viewState.elements;
    el.startBtn?.addEventListener('click', startExam);
    el.prevBtn?.addEventListener('click', () => goToQuestion(viewState.currentIndex - 1));
    el.nextBtn?.addEventListener('click', () => goToQuestion(viewState.currentIndex + 1));
    el.submitBtn?.addEventListener('click', () => confirmSubmitExam(false));
    el.markReviewBtn?.addEventListener('click', toggleMarkForReview);
    el.backToExamsBtn?.addEventListener('click', () => window.router?.navigateTo('exams'));
    el.retryExamBtn?.addEventListener('click', retryExam);
    el.reviewExamBtn?.addEventListener('click', openReviewScreen);
    el.backToResultsBtn?.addEventListener('click', closeReviewScreen);

    // تفويض النقر داخل خيارات السؤال لعنصر واحد ثابت
    el.questionOptions?.addEventListener('click', (e) => {
        const optionEl = e.target.closest('.question-option');
        if (!optionEl) return;
        const input = optionEl.querySelector('input');
        if (input) {
            input.checked = true;
            selectAnswer(input.value);
        }
    });

    // تكبير صورة السؤال (Lightbox)
    el.questionImageFrame?.addEventListener('click', openImageZoom);
    el.imageZoomBtn?.addEventListener('click', openImageZoom);
    el.imageZoomClose?.addEventListener('click', closeImageZoom);
    el.imageZoomOverlay?.addEventListener('click', (e) => {
        if (e.target === el.imageZoomOverlay) closeImageZoom();
    });

    // 🛠️ إصلاح: تخزين مرجع الدالة في viewState بدل دالة مجهولة، لضمان إمكانية إزالتها
    // فعلياً في cleanupExamViewPage ومنع تراكم مستمعين متعددين عند دخول/خروج الصفحة
    viewState.keydownHandler = (e) => {
        if (e.key === 'Escape') closeImageZoom();
    };
    document.addEventListener('keydown', viewState.keydownHandler);

    // أسهم تمرير قائمة الأسئلة القابلة للسحب (RTL: "التالي" يمرر نحو النهاية بصريًا لليسار)
    el.paletteArrowPrev?.addEventListener('click', () => scrollPalette('prev'));
    el.paletteArrowNext?.addEventListener('click', () => scrollPalette('next'));

    // 🛠️ إصلاح: صورة سؤال بـ URL غير صالح يجب ألا تكسر تخطيط الصفحة (معيار القبول #40‑5)
    el.questionImageEl?.addEventListener('error', handleQuestionImageError);
}

// ====== معالجة صورة سؤال لا يمكن تحميلها ======

function handleQuestionImageError() {
    const el = viewState.elements;
    if (el.questionImageCol) el.questionImageCol.classList.add('is-broken');
}

// ====== تكبير صورة السؤال ======

function openImageZoom() {
    const el = viewState.elements;
    const question = viewState.questions[viewState.currentIndex];
    if (!question?.image || !el.imageZoomOverlay || !el.imageZoomFull) return;
    el.imageZoomFull.src = question.image;
    el.imageZoomOverlay.classList.add('open');
    // قفل تمرير الصفحة خلف النافذة المكبّرة فقط أثناء فتحها (كلاس معزول بلا أثر على باقي الـ SPA)
    document.body.classList.add('exam-lightbox-open');
}

function closeImageZoom() {
    const el = viewState.elements;
    el.imageZoomOverlay?.classList.remove('open');
    document.body.classList.remove('exam-lightbox-open');
}

// ====== تمرير قائمة الأسئلة أفقياً ======

function scrollPalette(direction) {
    const grid = viewState.elements.paletteGrid;
    if (!grid) return;
    // العنصر داخل صفحة RTL، لذلك اتجاه "التالي" (نحو الأسئلة الأحدث) هو نحو اليسار بصريًا
    const amount = direction === 'next' ? 160 : -160;
    grid.scrollBy({ left: amount, behavior: 'smooth' });
}

// ====== جلب بيانات الامتحان ======

async function loadExamData(examId) {
    try {
        toggleViewLoading(true);
        const data = await getExamFullData(examId);

        if (!data || !data.questions || data.questions.length === 0) {
            showToast('الامتحان غير موجود أو لا يحتوي على أسئلة', 'error');
            window.router?.navigateTo('exams');
            return;
        }

        viewState.examMeta = data.meta;
        viewState.questions = data.questions;
        viewState.durationSeconds = safeInt(data.meta.duration, 30) * 60;

        renderIntroScreen();
    } finally {
        toggleViewLoading(false);
    }
}

function toggleViewLoading(show) {
    if (viewState.elements.loadingState) {
        viewState.elements.loadingState.style.display = show ? 'flex' : 'none';
    }
}

// ====== شاشة المقدمة ======

function renderIntroScreen() {
    const meta = viewState.examMeta;
    const el = viewState.elements;

    if (el.breadcrumbActive) el.breadcrumbActive.textContent = meta.title;
    if (el.stageBadge) el.stageBadge.textContent = meta.stage || '-';
    if (el.gradeBadge) el.gradeBadge.textContent = `الصف ${meta.grade || '-'}`;
    if (el.semesterBadge) el.semesterBadge.textContent = `الفصل ${meta.semester || '-'}`;
    if (el.challengeBadge) el.challengeBadge.style.display = meta.is_challenge ? 'inline-flex' : 'none';
    if (el.examTitle) el.examTitle.textContent = meta.title;
    if (el.examDescription) el.examDescription.textContent = meta.description || 'لا يوجد وصف لهذا الامتحان.';
    if (el.questionsCount) el.questionsCount.textContent = viewState.questions.length;
    if (el.examDuration) el.examDuration.textContent = safeInt(meta.duration, 30);

    showScreen('intro');
}

// ====== بدء الامتحان ======

function startExam() {
    viewState.currentIndex = 0;
    viewState.answers = {};
    viewState.markedForReview = new Set();
    viewState.submitted = false;
    viewState.startedAt = Date.now();
    viewState.remainingSeconds = viewState.durationSeconds;

    showScreen('screen');
    renderQuestion(0);
    renderPalette();
    startTimer();

    // 🛠️ إصلاح: هذا الحدث لم يكن يُبعث إطلاقاً رغم أن directing.js مشترك فيه
    // (case 'exam:start') لعرض رسالة تحفيزية من شخصية التوجيه عند بدء أي امتحان
    EventBus.emit('exam:start', {
        examId: viewState.examId,
        userId: viewState.currentUser?.id
    });
}

// ====== المؤقت ======

function startTimer() {
    stopTimer();
    updateTimerDisplay();
    viewState.timerInterval = setInterval(() => {
        viewState.remainingSeconds--;
        updateTimerDisplay();
        if (viewState.remainingSeconds <= 0) {
            stopTimer();
            showToast('انتهى وقت الامتحان، سيتم التسليم تلقائياً', 'warning');
            submitExam(true);
        }
    }, 1000);
}

function stopTimer() {
    if (viewState.timerInterval) {
        clearInterval(viewState.timerInterval);
        viewState.timerInterval = null;
    }
}

function updateTimerDisplay() {
    const el = viewState.elements;
    if (el.timerValue) el.timerValue.textContent = formatTime(viewState.remainingSeconds);
    if (el.timerEl) el.timerEl.classList.toggle('timer-warning', viewState.remainingSeconds <= 60);
}

// ====== عرض الأسئلة والتنقل ======

function renderQuestion(index) {
    const question = viewState.questions[index];
    if (!question) return;

    viewState.currentIndex = index;
    const el = viewState.elements;
    const total = viewState.questions.length;

    if (el.currentQuestionNumber) el.currentQuestionNumber.textContent = index + 1;
    if (el.questionCounter) el.questionCounter.textContent = `${index + 1} / ${total}`;
    if (el.navCounter) el.navCounter.textContent = `${index + 1} / ${total}`;
    if (el.questionText) el.questionText.textContent = question.text;

    // صورة السؤال: تظهر دائمًا مربعة الشكل داخل الامتحان (object-fit: cover عبر CSS)
    // بينما تُعرض الصورة الأصلية كاملة دون قص عند الضغط على "تكبير الصورة"
    if (el.questionImageCol) {
        el.questionImageCol.classList.remove('is-broken');
        if (question.image) {
            el.questionImageCol.style.display = 'flex';
            if (el.questionImageEl) {
                el.questionImageEl.src = question.image;
                el.questionImageEl.alt = `صورة السؤال ${index + 1}`;
            }
        } else {
            el.questionImageCol.style.display = 'none';
            if (el.questionImageEl) el.questionImageEl.src = '';
        }
    }

    if (el.questionOptions) {
        el.questionOptions.innerHTML = buildOptionsHTML(question, viewState.answers[index]);
    }

    if (el.markReviewBtn) {
        el.markReviewBtn.classList.toggle('marked', viewState.markedForReview.has(index));
    }

    if (el.prevBtn) el.prevBtn.disabled = index === 0;
    if (el.nextBtn) {
        el.nextBtn.disabled = false;
        el.nextBtn.innerHTML = index === total - 1
            ? 'الأخير <i class="fas fa-flag-checkered"></i>'
            : 'التالي <i class="fas fa-chevron-left"></i>';
    }

    updateProgress();
    renderPalette();
}

function buildOptionsHTML(question, selectedValue) {
    // 🛠️ ترتيب العناصر داخل كل خيار بات: النص أولاً ثم الحرف (بين قوسين) ثم دائرة الاختيار
    // في النهاية — بحيث يطابق تصميم الشاشة (radio في أقصى الطرف، الحرف بجواره، والنص يمين السطر)
    // دون أي اعتماد على خصائص CSS خاصة بترتيب العرض (order/row-reverse)
    if (question.type === 'multiple_choice') {
        return question.options.map((opt, i) => `
            <label class="question-option${String(selectedValue) === String(i) ? ' selected' : ''}">
                <span class="option-text">${escapeHtml(opt)}</span>
                <span class="option-letter">${letterAr(i)})</span>
                <input type="radio" name="exam-answer" value="${i}" ${String(selectedValue) === String(i) ? 'checked' : ''}>
            </label>
        `).join('');
    }
    // صح / خطأ
    return `
        <label class="question-option${selectedValue === 'true' ? ' selected' : ''}">
            <span class="option-text">صح</span>
            <span class="option-letter"><i class="fas fa-check"></i></span>
            <input type="radio" name="exam-answer" value="true" ${selectedValue === 'true' ? 'checked' : ''}>
        </label>
        <label class="question-option${selectedValue === 'false' ? ' selected' : ''}">
            <span class="option-text">خطأ</span>
            <span class="option-letter"><i class="fas fa-times"></i></span>
            <input type="radio" name="exam-answer" value="false" ${selectedValue === 'false' ? 'checked' : ''}>
        </label>
    `;
}

function selectAnswer(rawValue) {
    viewState.answers[viewState.currentIndex] = rawValue;
    updateProgress();
    renderPalette();
}

function goToQuestion(index) {
    if (index < 0 || index >= viewState.questions.length) return;
    renderQuestion(index);
}

function toggleMarkForReview() {
    const idx = viewState.currentIndex;
    if (viewState.markedForReview.has(idx)) {
        viewState.markedForReview.delete(idx);
    } else {
        viewState.markedForReview.add(idx);
    }
    viewState.elements.markReviewBtn?.classList.toggle('marked', viewState.markedForReview.has(idx));
    renderPalette();
}

function updateProgress() {
    const total = viewState.questions.length;
    const answered = Object.keys(viewState.answers).length;
    const percentage = total > 0 ? Math.round((answered / total) * 100) : 0;

    if (viewState.elements.progressPercentage) viewState.elements.progressPercentage.textContent = `${percentage}%`;
    if (viewState.elements.progressBarFill) viewState.elements.progressBarFill.style.width = `${percentage}%`;
    if (viewState.elements.answeredCount) viewState.elements.answeredCount.textContent = answered;
}

function renderPalette() {
    const grid = viewState.elements.paletteGrid;
    if (!grid) return;

    const total = viewState.questions.length;
    const indexes = buildPaletteIndexes(total, viewState.currentIndex, PALETTE_WINDOW_SIZE);

    grid.innerHTML = indexes.map(entry => {
        if (entry === ELLIPSIS) {
            return `<span class="palette-ellipsis" aria-hidden="true">...</span>`;
        }
        const i = entry;
        const classes = ['palette-btn'];
        if (viewState.answers[i] !== undefined) classes.push('answered');
        if (viewState.markedForReview.has(i)) classes.push('marked');
        if (i === viewState.currentIndex) classes.push('current');
        return `<button type="button" class="${classes.join(' ')}" data-index="${i}">${i + 1}</button>`;
    }).join('');

    grid.querySelectorAll('.palette-btn').forEach(btn => {
        btn.addEventListener('click', () => goToQuestion(safeInt(btn.dataset.index, 0)));
    });

    // إبقاء السؤال الحالي ظاهرًا دومًا داخل الشريط القابل للسحب
    grid.querySelector('.palette-btn.current')?.scrollIntoView({
        behavior: 'smooth', inline: 'center', block: 'nearest'
    });
}

// عدد الأزرار الظاهرة معًا في نافذة قائمة الأسئلة قبل الاختصار بنقاط "..."
const PALETTE_WINDOW_SIZE = 10;
const ELLIPSIS = '...';

/**
 * @function buildPaletteIndexes
 * @description يبني مصفوفة فهارس الأسئلة المطلوب عرضها في قائمة الأسئلة القابلة للسحب،
 * مع اختصار الأسئلة البعيدة عن السؤال الحالي بنقاط "..." وإبقاء طرفي القائمة (الأول والأخير)
 * ظاهرين دائمًا — تمامًا كما في تصميم الشاشة (مثال: 1..10 ثم "..." ثم 30).
 */
function buildPaletteIndexes(total, currentIndex, windowSize) {
    // لو عدد الأسئلة صغير بما يكفي، اعرضها كاملة بدون أي اختصار
    if (total <= windowSize + 2) {
        return Array.from({ length: total }, (_, i) => i);
    }

    const lastIndex = total - 1;
    let start;
    let end;

    if (currentIndex < windowSize) {
        // السؤال الحالي داخل النافذة الأولى
        start = 0;
        end = windowSize - 1;
    } else if (currentIndex > lastIndex - windowSize) {
        // السؤال الحالي داخل النافذة الأخيرة
        start = lastIndex - windowSize + 1;
        end = lastIndex;
    } else {
        // السؤال الحالي في المنتصف: النافذة تتمركز حوله
        start = currentIndex - Math.floor(windowSize / 2);
        end = start + windowSize - 1;
    }

    const result = [];

    // إظهار السؤال الأول دومًا إذا كانت النافذة لا تبدأ من الصفر
    if (start > 0) {
        result.push(0);
        if (start > 1) result.push(ELLIPSIS);
    }

    for (let i = start; i <= end; i++) result.push(i);

    // إظهار السؤال الأخير دومًا إذا كانت النافذة لا تصل إلى نهاية القائمة
    if (end < lastIndex) {
        if (end < lastIndex - 1) result.push(ELLIPSIS);
        result.push(lastIndex);
    }

    return result;
}

// ====== التسليم والتصحيح ======

function confirmSubmitExam(auto) {
    const total = viewState.questions.length;
    const answered = Object.keys(viewState.answers).length;

    if (!auto && answered < total) {
        window.modals?.confirm({
            title: 'أسئلة بدون إجابة',
            message: `لديك ${total - answered} سؤال لم تُجب عليه بعد. هل تريد تسليم الامتحان الآن؟`,
            confirmText: 'تسليم الآن',
            cancelText: 'متابعة الإجابة',
            onConfirm: () => submitExam(false)
        });
        return;
    }

    window.modals?.confirm({
        title: 'تأكيد التسليم',
        message: 'هل أنت متأكد من تسليم الامتحان؟ لن تتمكن من تعديل إجاباتك بعد ذلك.',
        confirmText: 'تسليم',
        cancelText: 'إلغاء',
        onConfirm: () => submitExam(false)
    });
}

async function submitExam(autoSubmitted) {
    if (viewState.submitted) return;
    viewState.submitted = true;
    stopTimer();

    const timeTakenSeconds = Math.round((Date.now() - viewState.startedAt) / 1000);
    const result = calculateResults(timeTakenSeconds);
    viewState.result = result;

    try {
        await saveExamResult(viewState.currentUser.id, {
            examId: viewState.examId,
            score: result.percentage,
            totalQuestions: result.total,
            correctAnswers: result.correctCount,
            timeTaken: timeTakenSeconds,
            passed: result.passed,
            feedback: result.levelLabel
        });

        // 🛠️ إصلاح تكامل مهم: لو الامتحان مرتبط بدرس معيّن (exam.lesson_id، مثل الامتحان
        // التلقائي اللي بينشئه lesson-manager.js مع كل درس)، لازم نحدّث درجة هذا الدرس
        // تحديداً في user_progress.exam_score (وتُعاد حساب النقاط الكلية تلقائياً داخل
        // updateUserExamScore) - بدون هذا النداء كانت صفحة الدرس تفضل تعرض إن الطالب
        // لسه ما أدّاش امتحانه حتى لو نجح فيه فعلاً، لأن saveExamResult وحدها بتحفظ في
        // مجموعة exam_results العامة ومالهاش أي علاقة بتقدّم الدرس المحدد
        if (viewState.examMeta?.lesson_id) {
            try {
                await updateUserExamScore(viewState.currentUser.id, viewState.examMeta.lesson_id, result.percentage);
            } catch (scoreError) {
                console.error('⚠️ [exam-view] فشل تحديث درجة امتحان الدرس (لن يمنع عرض النتيجة):', scoreError.message);
            }
        }

        // 🛠️ إصلاح: الاسم القانوني المتفق عليه مع نظام التوجيه هو 'exam:complete'
        // (بدون تاء) - الاسم القديم 'exam:completed' كان يمنع شخصية التوجيه من
        // الاستجابة نهائياً لأن directing.js يستمع فقط لـ 'exam:complete'
        EventBus.emit('exam:complete', {
            examId: viewState.examId,
            userId: viewState.currentUser.id,
            score: result.percentage,
            passed: result.passed,
            medal: result.medal?.key || null
        });
    } catch (error) {
        console.error('❌ [exam-view] فشل حفظ نتيجة الامتحان:', error);
        showToast('تم تصحيح الامتحان لكن تعذر حفظ النتيجة، تحقق من اتصالك', 'warning');
    } finally {
        renderResultsScreen(result, autoSubmitted);

        // 🛠️ إصلاح: الاسم القانوني المستخدم في animations.js (CONFIG.EVENTS.MEDAL_EARNED)
        // وفي directing.js هو 'medal:earned' (بدون بادئة exam:)، وليس 'exam:medal-earned'
        // القديم الذي لا يستمع له أي ملف في المنصة. كما أن أنيميشن الميدالية يحتاج مرجع
        // DOM حي للعنصر (detail.element) وليس بيانات مجردة فقط، لذا يُبعث الحدث هنا بعد
        // renderResultsScreen() مباشرة لضمان أن medalDisplay أصبح ظاهراً بالفعل في الصفحة
        if (result.medal) {
            EventBus.emit('medal:earned', {
                element: viewState.elements.medalDisplay,
                examId: viewState.examId,
                userId: viewState.currentUser.id,
                medal: result.medal.key,
                medalLabel: result.medal.label
            });
        }
    }
}

function calculateResults(timeTakenSeconds) {
    const questions = viewState.questions;
    const total = questions.length;
    let correctCount = 0;
    const perQuestion = [];

    questions.forEach((q, i) => {
        const rawAnswer = viewState.answers[i];
        let isCorrect = false;
        let userAnswerLabel = 'لم تتم الإجابة';
        let correctAnswerLabel = '';

        if (q.type === 'multiple_choice') {
            const userIndex = rawAnswer !== undefined ? safeInt(rawAnswer, -1) : -1;
            isCorrect = userIndex === q.correct;
            correctAnswerLabel = `${letterAr(q.correct)}) ${q.options[q.correct] || ''}`;
            if (userIndex >= 0 && q.options[userIndex] !== undefined) {
                userAnswerLabel = `${letterAr(userIndex)}) ${q.options[userIndex]}`;
            }
        } else {
            const userBool = rawAnswer === 'true' ? true : rawAnswer === 'false' ? false : null;
            isCorrect = userBool !== null && userBool === q.correct;
            correctAnswerLabel = q.correct ? 'صح' : 'خطأ';
            if (userBool !== null) userAnswerLabel = userBool ? 'صح' : 'خطأ';
        }

        if (isCorrect) correctCount++;
        perQuestion.push({ question: q, isCorrect, userAnswerLabel, correctAnswerLabel });
    });

    const percentage = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    const passed = percentage >= PASS_THRESHOLD;
    const level = LEVEL_TIERS.find(l => percentage >= l.min) || LEVEL_TIERS[LEVEL_TIERS.length - 1];

    let medal = null;
    if (viewState.examMeta.is_challenge) {
        medal = MEDAL_TIERS.find(m => percentage >= m.min) || null;
    }

    return {
        total,
        correctCount,
        percentage,
        passed,
        timeTakenSeconds,
        levelKey: level.key,
        levelLabel: level.label,
        medal,
        perQuestion
    };
}

// ====== شاشة النتائج ======

function renderResultsScreen(result, autoSubmitted) {
    const el = viewState.elements;

    if (el.scoreValue) el.scoreValue.textContent = `${result.percentage}%`;
    // 🛠️ إضافة: تغذية حلقة التقدّم الدائرية حول النتيجة (انظر تعليق exams.css
    // المقابل عند .score-circle) بنسبة النجاح الفعلية عبر CSS Custom Property.
    if (el.scoreCircle) el.scoreCircle.style.setProperty('--score', result.percentage);
    if (el.correctCount) el.correctCount.textContent = result.correctCount;
    if (el.totalCount) el.totalCount.textContent = result.total;
    if (el.timeTaken) el.timeTaken.textContent = formatTime(result.timeTakenSeconds);

    if (el.levelBadge) {
        el.levelBadge.textContent = result.levelLabel;
        el.levelBadge.className = `level-badge level-${result.levelKey}`;
    }

    if (el.medalDisplay) {
        if (result.medal) {
            el.medalDisplay.style.display = 'inline-flex';
            el.medalDisplay.classList.add('medal-badge');
            if (el.medalName) el.medalName.textContent = result.medal.label;
        } else {
            el.medalDisplay.style.display = 'none';
        }
    }

    if (el.resultsFeedback) {
        const feedbackType = result.passed ? 'feedback-success' : 'feedback-warning';
        const feedbackIcon = result.passed ? 'fa-circle-check' : 'fa-triangle-exclamation';
        const feedbackText = autoSubmitted
            ? 'تم تسليم الامتحان تلقائياً لانتهاء الوقت المحدد.'
            : (result.passed ? 'أحسنت! لقد اجتزت الامتحان بنجاح.' : 'لم تجتز الحد الأدنى للنجاح، ننصحك بمراجعة الدرس والمحاولة مرة أخرى.');

        el.resultsFeedback.innerHTML = `
            <div class="feedback-message ${feedbackType}">
                <i class="fas ${feedbackIcon}"></i>
                <p>${escapeHtml(feedbackText)}</p>
            </div>
        `;
    }

    if (el.retryExamBtn) el.retryExamBtn.style.display = 'inline-flex';

    showScreen('results');
}

function retryExam() {
    startExam();
}

// ====== شاشة المراجعة ======

function openReviewScreen() {
    const el = viewState.elements;
    if (!el.reviewQuestions || !viewState.result) return;

    el.reviewQuestions.innerHTML = viewState.result.perQuestion.map((item, i) => {
        const statusClass = item.isCorrect ? 'correct' : 'incorrect';
        const statusLabel = item.isCorrect
            ? '<span class="review-status status-correct"><i class="fas fa-check-circle"></i> إجابة صحيحة</span>'
            : '<span class="review-status status-incorrect"><i class="fas fa-times-circle"></i> إجابة خاطئة</span>';

        const imageHtml = item.question.image
            ? `<div class="review-question-image"><img src="${escapeHtml(item.question.image)}" alt="صورة السؤال"></div>`
            : '';

        return `
            <div class="review-question-card ${statusClass}">
                <div class="review-question-header">
                    <span class="review-question-num">السؤال ${i + 1}</span>
                    ${statusLabel}
                </div>
                <p class="review-question-text">${escapeHtml(item.question.text)}</p>
                ${imageHtml}
                <div class="review-answers">
                    <div class="review-user-answer">
                        <span>إجابتك:</span>
                        <span class="${item.isCorrect ? 'text-success' : 'text-danger'}">${escapeHtml(item.userAnswerLabel)}</span>
                    </div>
                    ${!item.isCorrect ? `
                    <div class="review-correct-answer">
                        <span>الإجابة الصحيحة:</span>
                        <span class="text-success">${escapeHtml(item.correctAnswerLabel)}</span>
                    </div>` : ''}
                </div>
            </div>
        `;
    }).join('');

    showScreen('review');
}

function closeReviewScreen() {
    showScreen('results');
}

// ====== التحكم في عرض الأقسام ======

function showScreen(name) {
    const el = viewState.elements;
    const sections = {
        intro: el.introSection,
        screen: el.screenSection,
        results: el.resultsSection,
        review: el.reviewSection
    };
    Object.entries(sections).forEach(([key, section]) => {
        if (section) section.style.display = key === name ? 'block' : 'none';
    });
}

// ====== تصدير إضافي (للاستخدام المباشر) ======
export { loadExams };
