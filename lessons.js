/**
 * 📚 views/lessons/lessons.js - مدير صفحات الدروس (قائمة وعرض درس) v5.0.0
 * ============================================================================
 * 📝 المسؤولية: إدارة صفحة قائمة الدروس (/lessons) وصفحة عرض الدرس (/lesson/:id).
 * ✅ متوافق مع router (initializePage / cleanupPage + دوال خاصة بـ lesson-view)
 * ✅ يستخدم api.js مع pagination حقيقي (startAfterCreatedAt + lastId)
 * ✅ يتكامل مع lesson-manager.js لعمليات الإدارة (المعلم/المشرف)
 * ✅ RTL كامل، بحث فوري، فلترة بالوحدات والتصنيفات
 * ✅ EventBus للتحديثات مع تنظيف كامل عند الخروج
 * ============================================================================
 */

import { getCurrentUser, isTeacher, isModerator } from '../../js/core/session.js';
import {
    getAllLessons,
    getLessonById,
    toggleLessonLike,
    getUserProgress,
    getUnits,
    moveLesson,
    deleteLesson,
    updateUserProgress,
    getComments,
    addComment,
    getExamByLessonId,
    searchLessons,
    syncUserFavorites,
    rateLesson,
    getActiveSemesterFor
} from '../../js/core/api.js';
import { EventBus } from '../../js/core/event-bus.js';
import { createAvatarElement, updateAvatarElement } from '../../js/utils/avatar.js';

// ====== الثوابت والتكوين ======
// ⚠️ يجب أن تبقى مطابقة تمامًا لـ STAGES/GRADES/SEMESTERS في lesson-manager.js
// (لم نستوردها من هناك عمدًا حتى لا نفرض تحميل lesson-manager.js على كل مستخدم/طالب فتح الصفحة)
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

const CONFIG = {
    LESSONS_PER_PAGE: 12,
    SEARCH_DEBOUNCE_MS: 300,
    SCROLL_THRESHOLD: 250,
    PROGRESS_SAVE_INTERVAL_SEC: 10,
    PROGRESS_SAVE_STEP_PERCENT: 10,
    FAVORITES_KEY: 'biologist_favorites',
    PAGE_TYPE_LIST: 'list',
    PAGE_TYPE_VIEW: 'view',
    COMMENTS_PAGE_SIZE: 20,
    RECOMMENDATIONS_COUNT: 4
};

// ====== الحالة الداخلية الأولية ======
const INITIAL_STATE = () => ({
    initialized: false,
    container: null,
    pageType: null,
    lessonId: null,
    currentUser: null,
    // بيانات قائمة الدروس
    lessons: [],
    units: [],
    filteredLessons: [],
    isLoading: false,
    isLoadingMore: false,
    activeCategory: 'all',
    searchTerm: '',
    activeUnitId: null,
    // سياق تصفح المعلم فقط (شجرة مرحلة ← صف ← فصل) — لا علاقة له بما يظهر فعليًا للطلاب
    activeStage: null,
    activeGrade: null,
    workingSemester: null,
    liveSemesterCache: {}, // `${stage}_${grade}` -> الفصل الحي الفعلي المعروف من الخادم (لعرض تنبيه التصفح فقط)
    // Pagination
    lastCreatedAt: null,
    lastId: null,
    hasMore: true,
    // بيانات عرض الدرس
    lessonData: null,
    examData: null,
    comments: [],
    commentsLastDoc: null,
    hasMoreComments: false,
    isLoadingMoreComments: false,
    watchStartTime: null,
    watchInterval: null,
    watchProgress: 0,
    totalTimeSpent: 0,
    // التوصيات والتقييم
    recommendedLessons: [],
    userRating: 0,
    // عناصر DOM
    elements: {},
    // مؤقتات ومستمعون
    searchDebounceTimer: null,
    scrollHandler: null,
    eventUnsubscribers: []
});

let state = INITIAL_STATE();

// ====== دالة تنسيق التاريخ ======
function formatDate(timestamp) {
    if (!timestamp) return '';
    const date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
    if (isNaN(date.getTime())) return '';
    const now = new Date();
    const diffMs = now - date;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHour = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);
    if (diffMin < 1) return 'الآن';
    if (diffMin < 60) return `منذ ${diffMin} دقيقة`;
    if (diffHour < 24) return `منذ ${diffHour} ساعة`;
    if (diffDay < 7) return `منذ ${diffDay} يوم`;
    return date.toLocaleDateString('ar-EG');
}

// ====== دوال التهيئة والتنظيف (للاستخدام مع router) ======

/**
 * تهيئة صفحة قائمة الدروس (/lessons)
 */
export async function initializePage(container, params = {}) {
    if (state.initialized && state.container === container) return;
    await initCommon(container, CONFIG.PAGE_TYPE_LIST, params);
}

/**
 * تهيئة صفحة عرض الدرس (/lesson/:id)
 */
export async function initLessonViewPage(container, params = {}) {
    if (state.initialized && state.container === container) return;

    const lessonId = params.path?.id;
    if (!lessonId) {
        console.error('❌ [lessons] معرف الدرس مفقود');
        window.router?.navigateTo('not-found');
        return;
    }

    await initCommon(container, CONFIG.PAGE_TYPE_VIEW, { ...params, lessonId });
}

// تهيئة مشتركة
async function initCommon(container, pageType, params) {
    if (state.initialized) await _cleanup();

    state.container = container;
    state.pageType = pageType;
    state.currentUser = getCurrentUser();
    if (pageType === CONFIG.PAGE_TYPE_VIEW) {
        state.lessonId = params.lessonId;
    }

    try {
        cacheElements(container);

        if (pageType === CONFIG.PAGE_TYPE_LIST) {
            setupUIForList();
            bindListEvents();
            await loadInitialListData();
        } else {
            setupUIForView();
            bindViewEvents();
            await loadLessonData(state.lessonId);
        }

        state.initialized = true;
        EventBus.emit('page:ready', {
            page: pageType === CONFIG.PAGE_TYPE_LIST ? 'lessons' : 'lesson-view'
        });
    } catch (error) {
        console.error('❌ [lessons] فشل تهيئة الصفحة:', error);
        showToast('حدث خطأ أثناء تحميل الصفحة', 'error');
        showErrorState(container, error);
    }
}

/**
 * تنظيف صفحة قائمة الدروس
 */
export async function cleanupPage() {
    await _cleanup();
}

/**
 * تنظيف صفحة عرض الدرس
 */
export async function cleanupLessonViewPage() {
    // حفظ التقدم الأخير قبل المغادرة
    if (state.watchInterval && state.currentUser && state.lessonId && state.watchProgress > 0) {
        try {
            await updateUserProgress(state.currentUser.id, state.lessonId, state.watchProgress);
        } catch (_) { /* التجاهل عند الخروج */ }
    }
    await _cleanup();
}

// دالة التنظيف الداخلية
async function _cleanup() {
    // إيقاف مؤقت المشاهدة
    if (state.watchInterval) {
        clearInterval(state.watchInterval);
    }
    // إيقاف مؤقت البحث
    if (state.searchDebounceTimer) {
        clearTimeout(state.searchDebounceTimer);
    }
    // إزالة مستمع التمرير
    if (state.scrollHandler) {
        window.removeEventListener('scroll', state.scrollHandler);
    }
    // إلغاء اشتراكات EventBus
    state.eventUnsubscribers.forEach(fn => fn());

    // إعادة تعيين الحالة بالكامل
    state = INITIAL_STATE();
}

// ====== دوال مساعدة DOM ======

function cacheElements(container) {
    const isList = state.pageType === CONFIG.PAGE_TYPE_LIST;
    state.elements = {
        loadingState: container.querySelector('.loading-state'),
        ...(isList ? {
            // عناصر قائمة الدروس
            lessonsGrid: container.querySelector('#lessons-grid'),
            unitsContainer: container.querySelector('#units-container'),
            categoryBtns: container.querySelectorAll('.category-btn'),
            categoriesContainer: container.querySelector('.categories-container'),
            categoriesTitle: container.querySelector('#categories-title'),
            statsSummary: container.querySelector('.stats-summary'),
            emptyState: container.querySelector('#lessons-empty-state'),
            emptyStateMessage: container.querySelector('#empty-state-message'),
            clearFiltersBtn: container.querySelector('#clear-filters-btn'),
            loadMoreBtn: container.querySelector('#load-more-lessons'),
            loadMoreContainer: container.querySelector('.load-more-container'),
            searchInput: container.querySelector('#lessons-search-input'),
            clearSearchBtn: container.querySelector('#clear-search-btn'),
            totalLessonsEl: container.querySelector('[data-stat="total-lessons"]'),
            completedLessonsEl: container.querySelector('[data-stat="completed-lessons"]'),
            completionRateEl: container.querySelector('[data-stat="completion-rate"]'),
            favoriteLessonsEl: container.querySelector('[data-stat="favorite-lessons"]'),
            subtitleEl: container.querySelector('#lessons-subtitle'),
            addLessonBtn: container.querySelector('[data-action="add-lesson"]'),
            addUnitBtn: container.querySelector('[data-action="add-unit"]')
        } : {
            // عناصر عرض الدرس
            introSection: container.querySelector('#lesson-intro-section'),
            screenSection: container.querySelector('#lesson-screen-section'),
            resultsSection: container.querySelector('#lesson-results-section'),
            backToLessonsBtn: container.querySelector('[data-action="back-to-lessons"]'),
            breadcrumbTitle: container.querySelector('#breadcrumb-lesson-title'),
            lessonTitle: container.querySelector('#lesson-title'),
            lessonDescription: container.querySelector('#lesson-description'),
            stageBadge: container.querySelector('#lesson-stage-badge'),
            gradeBadge: container.querySelector('#lesson-grade-badge'),
            semesterBadge: container.querySelector('#lesson-semester-badge'),
            unitBadge: container.querySelector('#lesson-unit-badge'),
            durationEl: container.querySelector('#lesson-duration'),
            commentsCountEl: container.querySelector('#comments-count'),
            likesCountEl: container.querySelector('#likes-count'),
            videoContainer: container.querySelector('#video-container'),
            pdfBtn: container.querySelector('[data-action="download-pdf"]'),
            likeBtn: container.querySelector('#lesson-like-btn'),
            startBtn: container.querySelector('[data-action="start-lesson"]'),
            completeBtn: container.querySelector('[data-action="complete-lesson"]'),
            favoriteBtn: container.querySelector('[data-action="toggle-favorite"]'),
            editLessonBtn: container.querySelector('[data-action="edit-lesson"]'),
            deleteLessonBtn: container.querySelector('[data-action="delete-lesson"]'),
            examCardContainer: container.querySelector('#exam-card-container'),
            startExamBtn: container.querySelector('#start-lesson-exam-btn'),
            commentsList: container.querySelector('#comments-list'),
            commentInput: container.querySelector('#comment-input'),
            submitCommentBtn: container.querySelector('[data-action="submit-comment"]'),
            commentUserAvatar: container.querySelector('#comment-user-avatar'),
            timerValue: container.querySelector('#timer-value'),
            progressPercentage: container.querySelector('#lesson-progress-percentage'),
            progressBarFill: container.querySelector('#lesson-progress-bar'),
            timeSpent: container.querySelector('#time-spent'),
            lastWatched: container.querySelector('#last-watched'),
            teacherWidget: container.querySelector('.teacher-only'),
          
            loadMoreCommentsBtn: container.querySelector('[data-action="load-more-comments"]'),
            recommendationsContainer: container.querySelector('#recommendations-container'),
            ratingContainer: container.querySelector('#rating-container'),
            starsDisplay: container.querySelector('#stars-display'),
            averageRatingEl: container.querySelector('#average-rating'),
            ratingCountEl: container.querySelector('#rating-count'),
            commentsCountBadgeEl: container.querySelector('#comments-count-badge'),
coverImage: container.querySelector('#lesson-cover-image'),
coverWrapper: container.querySelector('#lesson-cover-wrapper')
        })
    };
}

// ====== إعداد واجهة القائمة حسب الصلاحيات ======
function setupUIForList() {
    const user = state.currentUser;
    const isAdmin = user && (isTeacher(user) || isModerator(user));

    // إظهار/إخفاء أزرار الإضافة
    if (state.elements.addLessonBtn) {
        state.elements.addLessonBtn.style.display = isAdmin ? 'inline-flex' : 'none';
    }
    if (state.elements.addUnitBtn) {
        state.elements.addUnitBtn.style.display = isAdmin ? 'inline-flex' : 'none';
    }

    // إحصائيات الطالب فقط
    if (state.elements.statsSummary) {
        state.elements.statsSummary.style.display =
            (user?.user_type === 'student') ? 'block' : 'none';
    }

    // النص الفرعي
    if (state.elements.subtitleEl) {
        if (isAdmin) {
            state.elements.subtitleEl.textContent = 'إدارة جميع الدروس والوحدات';
        } else if (user) {
            const stageMap = { 'إعدادي': 'المرحلة الإعدادية', 'ثانوي': 'المرحلة الثانوية' };
            const stage = stageMap[user.stage] || user.stage || '';
            const grade = user.grade ? `الصف ${user.grade}` : '';
            const semester = user.semester
                ? `الفصل ${user.semester === 'أول' ? 'الأول' : 'الثاني'}`
                : '';
            state.elements.subtitleEl.textContent =
                [stage, grade, semester].filter(Boolean).join(' – ') || 'حسب مرحلتك';
        } else {
            state.elements.subtitleEl.textContent = 'سجّل الدخول لعرض دروسك';
        }
    }

    // للمعلم/المشرف: شجرة تنقّل هرمية (مرحلة ← صف ← فصل كسياق تصفح فقط) بدل الشريط المسطّح
    if (isAdmin) {
        if (state.elements.categoriesTitle) {
            state.elements.categoriesTitle.textContent = 'تصفح حسب المرحلة والصف';
        }
        renderTeacherCategoryTree();
    }
}

// ====== إعداد واجهة عرض الدرس حسب الصلاحيات ======
function setupUIForView() {
    const user = state.currentUser;
    const isAdmin = user && (isTeacher(user) || isModerator(user));

    if (state.elements.teacherWidget) {
        state.elements.teacherWidget.style.display = isAdmin ? 'flex' : 'none';
    }
    if (state.elements.editLessonBtn) {
        state.elements.editLessonBtn.style.display = isAdmin ? 'inline-flex' : 'none';
    }
    if (state.elements.deleteLessonBtn) {
        state.elements.deleteLessonBtn.style.display = isAdmin ? 'inline-flex' : 'none';
    }
    // زر تحميل PDF يظهر فقط إن وجد الرابط (يُعاد ضبطه في renderLessonView)
    if (state.elements.pdfBtn) {
        state.elements.pdfBtn.style.display = 'none';
    }
}

// ====== جلب البيانات (قائمة الدروس) ======

async function loadInitialListData() {
    await loadListData(true);
}

async function loadListData(resetPagination = false) {
    if (state.isLoading) return;
    state.isLoading = true;
    showLoading(true);

    if (resetPagination) {
        state.lastCreatedAt = null;
        state.lastId = null;
        state.hasMore = true;
        state.lessons = [];
        // نعرض التحميل الهيكلي فوراً قبل انتظار الشبكة، لتفادي شاشة فارغة
        showSkeletonGrid(CONFIG.LESSONS_PER_PAGE);
    }

    try {
        // جلب الوحدات مرة واحدة فقط عند البداية
        if (resetPagination) {
            state.units = await fetchUnits();
            renderUnitsCarousel();
        }

        const newLessons = await fetchLessons(
            resetPagination ? null : { created_at: state.lastCreatedAt, id: state.lastId }
        );

        state.lessons = resetPagination
            ? newLessons
            : [...state.lessons, ...newLessons];

        // تحديث pagination
        if (newLessons.length < CONFIG.LESSONS_PER_PAGE) {
            state.hasMore = false;
        } else {
            const last = newLessons[newLessons.length - 1];
            state.lastCreatedAt = last.created_at;
            state.lastId = last.id;
        }

        // تطبيق الفلاتر وعرض النتيجة
        applyFiltersAndRender();
        updateStatsSummary();
        updateLoadMoreButton();

        // تحديث عدادات شجرة تصفح المعلم بعد وصول الدروس الفعلية (كانت صفرًا وقت أول رسم للشجرة)
        const treeUser = state.currentUser;
        if (treeUser && (isTeacher(treeUser) || isModerator(treeUser))) {
            renderTeacherCategoryTree();
        }

    } catch (error) {
        console.error('❌ [lessons] فشل جلب البيانات:', error);
        showToast('تعذر تحميل الدروس', 'error');
        if (resetPagination) renderEmptyState(true);
    } finally {
        state.isLoading = false;
        state.isLoadingMore = false;
        showLoading(false);
    }
}

async function loadMoreLessons() {
    if (state.isLoadingMore || !state.hasMore || state.isLoading) return;
    state.isLoadingMore = true;
    await loadListData(false);
}

async function fetchLessons(startAfter = null, filters = {}) {
    const user = state.currentUser;
    const searchTerm = filters.searchTerm !== undefined ? filters.searchTerm : state.searchTerm;
    const options = {
        limit: CONFIG.LESSONS_PER_PAGE,
        stage: user?.stage,
        grade: user?.grade,
        semester: user?.semester,
        unitId: filters.unitId !== undefined ? filters.unitId : state.activeUnitId,
        category: filters.category || state.activeCategory
    };

    if (startAfter?.created_at) {
        options.startAfterCreatedAt = startAfter.created_at;
        options.lastId = startAfter.id;
    }

    // الطالب يرى دروس مرحلته فقط — الفصل الدراسي هنا "حي" وليس قيمة مجمّدة في بروفايله،
    // يتحدد لحظيًا حسب قرار المعلم من لوحة "التحكم بالفصل الدراسي"
    if (user && !isTeacher(user) && !isModerator(user)) {
        options.stage = user.stage;
        options.grade = user.grade;
        options.semester = await getActiveSemesterFor(user.stage, user.grade);
    }

    // بحث نصي على الخادم عند وجود searchTerm، وإلا الجلب العادي
    let lessons;
    if (searchTerm) {
        try {
            lessons = await searchLessons(searchTerm, options);
        } catch (error) {
            console.error('❌ [lessons] فشل البحث على الخادم:', error);
            showToast('تعذر إتمام البحث، جرّب لاحقاً', 'error');
            lessons = [];
        }
    } else {
        lessons = await getAllLessons(options);
    }

    // تقدم الطالب
    if (user?.user_type === 'student') {
        const progressList = await getUserProgress(user.id);
        lessons.forEach(lesson => {
            const prog = progressList.find(p => p.lesson_id == lesson.id);
            lesson.completed = prog?.completed || false;
            lesson.progress = prog?.progress || 0;
        });
    }

    // المفضلة (يجب جلبها من قاعدة البيانات، مؤقتاً نستخدم localStorage)
    const favorites = getFavorites();
    lessons.forEach(lesson => {
        lesson.is_favorite = favorites.includes(String(lesson.id));
    });

    return lessons;
}

async function fetchUnits() {
    const user = state.currentUser;
    const options = {};
    if (user && !isTeacher(user) && !isModerator(user)) {
        options.stage = user.stage;
        options.grade = user.grade;
        options.semester = await getActiveSemesterFor(user.stage, user.grade);
    }
    return await getUnits(options);
}

// ====== فلترة وعرض (قائمة الدروس) ======

function applyFiltersAndRender() {
    let filtered = [...state.lessons];

    // فلترة بالوحدة
    if (state.activeUnitId !== null) {
        filtered = filtered.filter(l => l.unit_id == state.activeUnitId);
    }

    // فلترة سياق تصفح المعلم (مرحلة/صف/فصل) — تخص المعلم/المشرف فقط، ولا تُغيّر أي شيء فعلي للطلاب
    if (state.activeStage) {
        filtered = filtered.filter(l => l.stage === state.activeStage);
    }
    if (state.activeGrade !== null) {
        filtered = filtered.filter(l => Number(l.grade) === state.activeGrade);
    }
    if (state.workingSemester) {
        filtered = filtered.filter(l => l.semester === state.workingSemester);
    }

    // فلترة بالتصنيف
    switch (state.activeCategory) {
        case 'first':
            filtered = filtered.filter(l => l.semester === 'أول');
            break;
        case 'second':
            filtered = filtered.filter(l => l.semester === 'ثاني');
            break;
        case 'favorites':
            filtered = filtered.filter(l => l.is_favorite);
            break;
        case 'completed':
            filtered = filtered.filter(l => l.completed);
            break;
    }

    // فلترة بالبحث
    if (state.searchTerm) {
        const term = state.searchTerm.toLowerCase().trim();
        filtered = filtered.filter(l =>
            l.title?.toLowerCase().includes(term) ||
            l.description?.toLowerCase().includes(term)
        );
    }

    // ترتيب: حسب الوحدة ثم order
    filtered.sort((a, b) => {
        const unitA = state.units.find(u => u.id == a.unit_id);
        const unitB = state.units.find(u => u.id == b.unit_id);
        const unitOrderDiff = (unitA?.order || 0) - (unitB?.order || 0);
        if (unitOrderDiff !== 0) return unitOrderDiff;
        return (a.order || 0) - (b.order || 0);
    });

    state.filteredLessons = filtered;

    renderLessonsGrid(filtered);
    updateEmptyStateVisibility();
    updateClearFiltersButton();
}

function renderUnitsCarousel() {
    const container = state.elements.unitsContainer;
    if (!container) return;

    const user = state.currentUser;
    const isAdmin = user && (isTeacher(user) || isModerator(user));

    // للمعلم: الكاروسيل يتفلتر حسب سياق التصفح الحالي (مرحلة/صف/فصل) بدل خلط كل وحدات المنصة
    const visibleUnits = isAdmin
        ? state.units.filter(u =>
            (!state.activeStage || u.stage === state.activeStage) &&
            (state.activeGrade === null || Number(u.grade) === state.activeGrade) &&
            (!state.workingSemester || u.semester === state.workingSemester))
        : state.units;

    const scopedLessons = isAdmin
        ? state.lessons.filter(l =>
            (!state.activeStage || l.stage === state.activeStage) &&
            (state.activeGrade === null || Number(l.grade) === state.activeGrade) &&
            (!state.workingSemester || l.semester === state.workingSemester))
        : state.lessons;

    if (visibleUnits.length === 0) {
        container.innerHTML = `<div class="units-empty">
            <i class="fas fa-folder-open"></i>
            <p>لا توجد وحدات متاحة</p>
        </div>`;
        return;
    }

    const allBtn = `<div class="unit-card ${state.activeUnitId === null ? 'active' : ''}" data-unit-id="all">
        <div class="unit-icon"><i class="fas fa-th-large"></i></div>
        <h4 class="unit-name">الكل</h4>
        <p class="unit-count">${scopedLessons.length} درس</p>
    </div>`;

    const unitsHtml = visibleUnits.map(unit => {
        const count = scopedLessons.filter(l => l.unit_id == unit.id).length;
        return `<div class="unit-card ${state.activeUnitId == unit.id ? 'active' : ''}" data-unit-id="${unit.id}">
            <div class="unit-icon"><i class="fas fa-layer-group"></i></div>
            <h4 class="unit-name">${escapeHtml(unit.name)}</h4>
            <p class="unit-count">${count} درس</p>
        </div>`;
    }).join('');

    container.innerHTML = allBtn + unitsHtml;

    container.querySelectorAll('.unit-card').forEach(card => {
        card.addEventListener('click', () => {
            const val = card.dataset.unitId;
            const newId = val === 'all' ? null : parseInt(val);
            // تبديل الفلتر عند النقر على الوحدة النشطة
            state.activeUnitId = (state.activeUnitId === newId) ? null : newId;
            // تحديث الكلاس النشط
            container.querySelectorAll('.unit-card').forEach(c => {
                const cVal = c.dataset.unitId;
                const cId = cVal === 'all' ? null : parseInt(cVal);
                c.classList.toggle('active', cId === state.activeUnitId);
            });
            applyFiltersAndRender();
            updateClearFiltersButton();
        });
    });
}

function renderLessonsGrid(lessons) {
    const grid = state.elements.lessonsGrid;
    if (!grid) return;

    if (!lessons || lessons.length === 0) {
        grid.innerHTML = '';
        return;
    }

    const user = state.currentUser;
    const isAdmin = user && (isTeacher(user) || isModerator(user));

    grid.innerHTML = lessons.map(lesson => createLessonCard(lesson, isAdmin)).join('');

    // ربط أحداث البطاقات
    grid.querySelectorAll('.lesson-card').forEach(card => {
        const id = card.dataset.id;

        // النقر على البطاقة للانتقال للدرس
        card.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            navigateToLesson(id);
        });

        // زر الدرس الصريح
        const startBtn = card.querySelector('.start-lesson-btn');
        startBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            navigateToLesson(id);
        });

        // زر المفضلة
        const likeBtn = card.querySelector('.like-btn');
        likeBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            handleToggleFavorite(id);
        });

        // نجوم التقييم
        card.querySelectorAll('.rate-star').forEach(star => {
            const rate = (e) => {
                e.stopPropagation();
                handleRateLesson(id, parseInt(star.dataset.value, 10));
            };
            star.addEventListener('click', rate);
            star.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); rate(e); }
            });
        });
    });

    if (isAdmin) {
        bindAdminActions(grid);
    }
}

function createLessonCard(lesson, isAdmin) {
    // نسبة التقدم: نتحقق من الحد الأدنى والأقصى ولا نغيّر القيمة الفعلية القادمة من النظام
    const rawProgress = Number(lesson.progress) || 0;
    const progress = Math.min(100, Math.max(0, rawProgress));
    const completed = lesson.completed || false;
    const inProgress = !completed && progress > 0;
    const isFavorite = lesson.is_favorite || false;
    const avgRating = lesson.average_rating || 0;

    // ==== طبقة 5: التقييم (نظام النجوم الحالي، دون إعادة بناء) ====
    const ratingHtml = `
        <div class="lesson-rating" data-id="${lesson.id}" title="التقييم: ${avgRating ? avgRating.toFixed(1) : 0} من 5">
            ${[1, 2, 3, 4, 5].map(n => `<span class="rate-star" data-value="${n}" role="button" tabindex="0" aria-label="تقييم ${n} نجوم"><i class="${n <= Math.round(avgRating) ? 'fas' : 'far'} fa-star"></i></span>`).join('')}
            <span class="rating-avg-text">${avgRating ? avgRating.toFixed(1) : '—'}</span>
        </div>`;

    // ==== طبقة 1: الغلاف ====
    const coverHtml = lesson.cover_image_url
        ? `<img src="${escapeHtml(lesson.cover_image_url)}" alt="${escapeHtml(lesson.title)}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=cover-placeholder-inner><i class=fas fa-book-open></i></div>'">`
        : `<div class="cover-placeholder-inner"><i class="fas fa-book-open"></i></div>`;

    // ==== طبقة 2: شارات الحالة والمدة (حالة "لم يبدأ" لا تُعرض كشارة تفادياً للازدحام البصري) ====
    const statusBadgeHtml = completed
        ? `<span class="lesson-status-badge status-completed completed-badge" aria-label="مكتمل"><i class="fas fa-check-circle" aria-hidden="true"></i> مكتمل</span>`
        : inProgress
            ? `<span class="lesson-status-badge status-inprogress" aria-label="قيد التقدم"><i class="fas fa-spinner" aria-hidden="true"></i> قيد التقدم</span>`
            : '<span></span>';
    const durationBadgeHtml = `<span class="lesson-duration-badge"><i class="fas fa-clock" aria-hidden="true"></i> ${lesson.duration || 0} دقيقة</span>`;

    // ==== طبقة 5: التصنيفات (صف / فصل دراسي) — بإعادة استخدام مكوّن .lesson-tag الموجود ====
    // ملاحظة: تم حذف وسم الوحدة من هذا الصف بناءً على التصميم الجديد للبطاقة
    // الذي يخصص هذا الصف حصرياً للتقييم (يسار) والفصل/الصف الدراسي (يمين).
    const tagsParts = [];
    if (lesson.grade) tagsParts.push(`<span class="lesson-tag lesson-tag-secondary">الصف ${escapeHtml(String(lesson.grade))}</span>`);
if (lesson.semester) tagsParts.push(`<span class="lesson-tag lesson-tag-success">${lesson.semester === 'أول' ? 'الفصل الأول' : lesson.semester === 'ثاني' ? 'الفصل الثاني' : escapeHtml(lesson.semester)}</span>`);
    const tagsHtml = tagsParts.length ? `<div class="lesson-card-tags">${tagsParts.join('')}</div>` : '';

    // ==== طبقة 7: التقدم (لا تُعرض إن لم تتوفر قيمة فعلية) ====
    const progressHtml = progress > 0 ? `
        <div class="lesson-progress">
            <div class="progress-bar-container">
                <div class="progress-bar-fill" style="width:${progress}%"></div>
            </div>
            <span class="progress-text">${progress}%</span>
        </div>` : '';

    // ==== طبقة 8: أزرار إدارة المحتوى (تعديل / حذف / تحريك) — تربط فقط بالدوال الموجودة فعلياً ====
    const adminActionsHtml = isAdmin ? `
        <div class="lesson-card-admin-actions teacher-only">
            <button class="action-btn edit-btn" data-action="edit" data-id="${lesson.id}" title="تعديل الدرس" aria-label="تعديل الدرس">
                <i class="fas fa-edit" aria-hidden="true"></i>
            </button>
            <button class="action-btn delete-btn" data-action="delete" data-id="${lesson.id}" title="حذف الدرس" aria-label="حذف الدرس">
                <i class="fas fa-trash-alt" aria-hidden="true"></i>
            </button>
            <button class="action-btn move-btn" data-action="move" data-id="${lesson.id}" title="تحريك الدرس" aria-label="تحريك الدرس">
                <i class="fas fa-arrows-alt-v" aria-hidden="true"></i>
            </button>
        </div>` : '';

    return `
        <div class="lesson-card ${completed ? 'completed' : ''} ${inProgress ? 'in-progress' : ''} ${isFavorite ? 'favorited' : ''}" data-id="${lesson.id}" role="article" aria-label="${escapeHtml(lesson.title)}">
            <div class="lesson-card-cover">
                ${coverHtml}
                <div class="lesson-card-badges">
                    ${statusBadgeHtml}
                    ${durationBadgeHtml}
                </div>
                <div class="lesson-play-overlay" aria-hidden="true"><i class="fas fa-play"></i></div>
            </div>
            <div class="lesson-card-body">
                <div class="lesson-card-header">
                    <h3 class="lesson-title">${escapeHtml(lesson.title)}</h3>
                    ${lesson.description ? `<p class="lesson-description">${escapeHtml(lesson.description)}</p>` : ''}
                </div>
                <div class="lesson-card-meta">
                    ${tagsHtml}
                    ${ratingHtml}
                </div>
                ${progressHtml}
            </div>
            <div class="lesson-card-footer">
                <div class="lesson-card-actions-row">
                    ${adminActionsHtml}
                    <button class="like-btn ${isFavorite ? 'active' : ''}" data-id="${lesson.id}" title="${isFavorite ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}" aria-pressed="${isFavorite}">
                        <i class="${isFavorite ? 'fas fa-star' : 'far fa-star'}" aria-hidden="true"></i>
                    </button>
                </div>
                <button class="btn btn-primary btn-sm start-lesson-btn" data-id="${lesson.id}">
                    <i class="fas fa-play" aria-hidden="true"></i>
                    ${completed ? 'مراجعة' : 'ابدأ الدرس'}
                </button>
            </div>
        </div>`;
}

// ====== التحميل الهيكلي (Skeleton Loading) لشبكة الدروس ======

function renderSkeletonCards(count = CONFIG.LESSONS_PER_PAGE) {
    const safeCount = Math.max(1, Math.min(count, CONFIG.LESSONS_PER_PAGE));
    const singleCard = `
        <div class="lesson-card-skeleton" aria-hidden="true">
            <div class="skeleton-block skeleton-cover"></div>
            <div class="skeleton-body">
                <div class="skeleton-block skeleton-line skeleton-title-line"></div>
                <div class="skeleton-block skeleton-line skeleton-title-line-short"></div>
                <div class="skeleton-block skeleton-line skeleton-desc-line"></div>
                <div class="skeleton-block skeleton-line skeleton-desc-line-short"></div>
                <div class="skeleton-tags">
                    <div class="skeleton-block skeleton-tag"></div>
                    <div class="skeleton-block skeleton-tag"></div>
                </div>
                <div class="skeleton-block skeleton-meta"></div>
            </div>
            <div class="skeleton-footer">
                <div class="skeleton-block"></div>
                <div class="skeleton-block"></div>
            </div>
        </div>`;
    return Array.from({ length: safeCount }, () => singleCard).join('');
}

// يعرض بطاقات هيكلية داخل شبكة الدروس أثناء التحميل الأولي فقط
// (لا يُستخدم أثناء "تحميل المزيد" لأن الشبكة تحتوي بالفعل على بطاقات حقيقية)
function showSkeletonGrid(count) {
    const grid = state.elements.lessonsGrid;
    if (!grid) return;
    if (state.elements.emptyState) state.elements.emptyState.style.display = 'none';
    grid.style.display = 'grid';
    grid.setAttribute('aria-busy', 'true');
    grid.innerHTML = renderSkeletonCards(count);
}

function bindAdminActions(grid) {
    grid.querySelectorAll('[data-action="edit"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openEditLessonModal(btn.dataset.id);
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
            openMoveLessonModal(btn.dataset.id);
        });
    });
}

function renderEmptyState(isError = false) {
    const grid = state.elements.lessonsGrid;
    const emptyState = state.elements.emptyState;
    if (!grid || !emptyState) return;

    grid.innerHTML = '';
    emptyState.style.display = 'flex';

    if (state.elements.emptyStateMessage) {
        if (isError) {
            state.elements.emptyStateMessage.textContent = 'حدث خطأ أثناء تحميل الدروس';
        } else if (state.searchTerm) {
            state.elements.emptyStateMessage.textContent = `لا توجد نتائج لـ "${state.searchTerm}"`;
        } else if (state.activeCategory !== 'all') {
            state.elements.emptyStateMessage.textContent = 'لا توجد دروس في هذا التصنيف';
        } else {
            state.elements.emptyStateMessage.textContent = 'لا توجد دروس متاحة حالياً';
        }
    }

    // إزالة أي زر إعادة محاولة قديم
    const oldRetry = emptyState.querySelector('.retry-btn');
    if (oldRetry) oldRetry.remove();

    if (isError) {
        const retryBtn = document.createElement('button');
        retryBtn.className = 'btn btn-outline retry-btn';
        retryBtn.textContent = 'إعادة المحاولة';
        retryBtn.addEventListener('click', () => loadListData(true));
        emptyState.appendChild(retryBtn);
    }
}

function updateEmptyStateVisibility() {
    const emptyState = state.elements.emptyState;
    const grid = state.elements.lessonsGrid;
    if (!emptyState || !grid) return;

    const isEmpty = state.filteredLessons.length === 0 && !state.isLoading;
    emptyState.style.display = isEmpty ? 'flex' : 'none';
    grid.style.display = isEmpty ? 'none' : 'grid';

    // رسالة حالة الفراغ ديناميكية
    if (isEmpty && state.elements.emptyStateMessage) {
        if (state.searchTerm) {
            state.elements.emptyStateMessage.textContent = `لا توجد نتائج لـ "${state.searchTerm}"`;
        } else if (state.activeCategory === 'favorites') {
            state.elements.emptyStateMessage.textContent = 'لم تُضف أي دروس للمفضلة بعد';
        } else if (state.activeCategory === 'completed') {
            state.elements.emptyStateMessage.textContent = 'لم تُكمل أي دروس بعد';
        }
    }
}

function updateLoadMoreButton() {
    const container = state.elements.loadMoreContainer;
    const btn = state.elements.loadMoreBtn;
    if (!container || !btn) return;

    if (state.hasMore && state.filteredLessons.length > 0) {
        container.style.display = 'block';
        btn.disabled = state.isLoadingMore;
        btn.innerHTML = state.isLoadingMore
            ? '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> جاري التحميل...'
            : '<i class="fas fa-arrow-down" aria-hidden="true"></i> تحميل المزيد';
    } else {
        container.style.display = 'none';
    }
}

function updateClearFiltersButton() {
    const btn = state.elements.clearFiltersBtn;
    if (!btn) return;
    const hasActive = state.searchTerm || state.activeCategory !== 'all' || state.activeUnitId !== null
        || !!state.activeStage || state.activeGrade !== null || !!state.workingSemester;
    btn.style.display = hasActive ? 'inline-flex' : 'none';
}

function updateStatsSummary() {
    if (!state.elements.statsSummary ||
        state.elements.statsSummary.style.display === 'none') return;
    if (state.currentUser?.user_type !== 'student') return;

    const lessons = state.lessons;
    const total = lessons.length;
    const completed = lessons.filter(l => l.completed).length;
    const favorites = lessons.filter(l => l.is_favorite).length;
    const rate = total > 0 ? Math.round((completed / total) * 100) : 0;

    if (state.elements.totalLessonsEl)
        state.elements.totalLessonsEl.textContent = total;
    if (state.elements.completedLessonsEl)
        state.elements.completedLessonsEl.textContent = completed;
    if (state.elements.completionRateEl)
        state.elements.completionRateEl.textContent = rate + '%';
    if (state.elements.favoriteLessonsEl)
        state.elements.favoriteLessonsEl.textContent = favorites;
}

// ====== معالجات أحداث قائمة الدروس ======

function bindListEvents() {
    // أزرار التصنيف
    state.elements.categoryBtns?.forEach(btn => {
        btn.addEventListener('click', () => setActiveCategory(btn.dataset.category));
    });

    // البحث
    if (state.elements.searchInput) {
        state.elements.searchInput.addEventListener('input', handleSearchInput);
    }
    if (state.elements.clearSearchBtn) {
        state.elements.clearSearchBtn.addEventListener('click', clearSearch);
    }
    if (state.elements.clearFiltersBtn) {
        state.elements.clearFiltersBtn.addEventListener('click', clearAllFilters);
    }

    // تحميل المزيد
    if (state.elements.loadMoreBtn) {
        state.elements.loadMoreBtn.addEventListener('click', loadMoreLessons);
    }

    // أزرار الإضافة (معلم/مشرف)
    if (state.elements.addLessonBtn) {
        state.elements.addLessonBtn.addEventListener('click', openAddLessonModal);
    }
    if (state.elements.addUnitBtn) {
        state.elements.addUnitBtn.addEventListener('click', openAddUnitModal);
    }

    // التمرير للتحميل التلقائي
    state.scrollHandler = () => {
        if (state.isLoading || state.isLoadingMore || !state.hasMore) return;
        const scrollPos = window.innerHeight + window.scrollY;
        const threshold = document.body.offsetHeight - CONFIG.SCROLL_THRESHOLD;
        if (scrollPos >= threshold) loadMoreLessons();
    };
    window.addEventListener('scroll', state.scrollHandler, { passive: true });

    // اشتراكات EventBus
    const unsubCreated = EventBus.on('lesson:created', () => refreshListData());
    const unsubUpdated = EventBus.on('lesson:updated', () => refreshListData());
    const unsubDeleted = EventBus.on('lesson:deleted', () => refreshListData());
    const unsubUnit = EventBus.on('unit:created', () => refreshListData());
    // لو المعلم غيّر الفصل الدراسي الظاهر لصف الطالب الحالي، حدّث القائمة فورًا بدل ما ينتظر تحديث الصفحة
    const unsubSemester = EventBus.on('semester:active-changed', ({ stage, grade } = {}) => {
        const user = state.currentUser;
        if (!user || isTeacher(user) || isModerator(user)) return;
        if (user.stage === stage && String(user.grade) === String(grade)) {
            refreshListData();
        }
    });
    state.eventUnsubscribers.push(unsubCreated, unsubUpdated, unsubDeleted, unsubUnit, unsubSemester);
}

function handleSearchInput(e) {
    const query = e.target.value;
    if (state.elements.clearSearchBtn) {
        state.elements.clearSearchBtn.style.display = query ? 'block' : 'none';
    }
    if (state.searchDebounceTimer) clearTimeout(state.searchDebounceTimer);
    state.searchDebounceTimer = setTimeout(() => {
        state.searchTerm = query.trim();
        // إعادة تحميل من الخادم عبر searchLessons لضمان تغطية كل الدروس لا المُحمَّل محلياً فقط
        loadListData(true);
    }, CONFIG.SEARCH_DEBOUNCE_MS);
}

function clearSearch() {
    if (state.elements.searchInput) state.elements.searchInput.value = '';
    if (state.elements.clearSearchBtn) state.elements.clearSearchBtn.style.display = 'none';
    if (!state.searchTerm) return;
    state.searchTerm = '';
    loadListData(true);
}

function clearAllFilters() {
    const hadSearchTerm = !!state.searchTerm;

    state.activeCategory = 'all';
    state.activeUnitId = null;
    state.searchTerm = '';
    state.activeStage = null;
    state.activeGrade = null;
    state.workingSemester = null;

    if (state.elements.searchInput) state.elements.searchInput.value = '';
    if (state.elements.clearSearchBtn) state.elements.clearSearchBtn.style.display = 'none';

    state.elements.categoryBtns?.forEach(btn => {
        const isAll = btn.dataset.category === 'all';
        btn.classList.toggle('active', isAll);
        btn.setAttribute('aria-pressed', String(isAll));
    });

    // إعادة رسم شجرة تصفح المعلم (لو كانت مفعّلة) والكاروسيل بالسياق الافتراضي (بدون فلترة)
    const clearUser = state.currentUser;
    if (clearUser && (isTeacher(clearUser) || isModerator(clearUser))) {
        renderTeacherCategoryTree();
    }
    renderUnitsCarousel();

    // إذا كان هناك بحث نشط، يجب إعادة التحميل من الخادم لاستعادة القائمة الكاملة
    if (hadSearchTerm) {
        loadListData(true);
        return;
    }

    applyFiltersAndRender();
    updateEmptyStateVisibility();
    updateClearFiltersButton();
}

// ====== شجرة تنقّل المعلم الهرمية (مرحلة ← صف ← فصل كسياق تصفح فقط) ======

function renderTeacherCategoryTree() {
    const container = state.elements.categoriesContainer;
    if (!container) return;

    const countForStage = (stage) => state.lessons.filter(l => l.stage === stage).length;
    const countForGrade = (stage, grade) => state.lessons.filter(l => l.stage === stage && Number(l.grade) === grade).length;

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
                    <span class="chip-count">${countForGrade(stage.value, grade.value)} درس</span>
                </button>
                ${semesterHtml}`;
        }).join('');

        return `
            <div class="stage-group ${isStageActive ? 'expanded' : ''}">
                <button type="button" class="stage-chip ${isStageActive ? 'active' : ''}"
                    data-stage="${escapeHtml(stage.value)}" aria-expanded="${isStageActive}">
                    <i class="fas fa-layer-group" aria-hidden="true"></i>
                    ${stage.label}
                    <span class="chip-count">${countForStage(stage.value)} درس</span>
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

function toggleStageContext(stage) {
    state.activeStage = (state.activeStage === stage) ? null : stage;
    state.activeGrade = null;
    state.workingSemester = null;
    applyFiltersAndRender();
    renderUnitsCarousel();
    renderTeacherCategoryTree();
    updateClearFiltersButton();
}

async function toggleGradeContext(stage, grade) {
    const isSame = state.activeStage === stage && state.activeGrade === grade;
    state.activeStage = stage;
    state.activeGrade = isSame ? null : grade;
    state.workingSemester = null;
    applyFiltersAndRender();
    renderUnitsCarousel();
    renderTeacherCategoryTree();
    updateClearFiltersButton();

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

function setWorkingSemester(semester) {
    state.workingSemester = semester;
    applyFiltersAndRender();
    renderUnitsCarousel();
    renderTeacherCategoryTree();
    updateClearFiltersButton();
}

function setActiveCategory(category) {
    state.activeCategory = category;
    state.elements.categoryBtns?.forEach(btn => {
        const isActive = btn.dataset.category === category;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', String(isActive));
    });
    applyFiltersAndRender();
    updateClearFiltersButton();
}

async function refreshListData() {
    // إعادة تحميل كاملة من قاعدة البيانات (بعد CRUD)
    await loadListData(true);
}

// ====== معالجة دخول الدرس ======
async function logLessonAccess(userId, lessonId) {
    if (!userId || !lessonId) return;
    try {
        const progressList = await getUserProgress(userId);
        const existing = progressList.find(p => p.lesson_id == lessonId);
        await updateUserProgress(userId, lessonId, existing?.progress || 0);
    } catch (_) { /* لا نعيق تحميل الصفحة */ }
}

// ====== جلب وعرض بيانات الدرس الفردي ======

async function loadLessonData(lessonId) {
    showLoading(true);
    try {
        // جلب بيانات الدرس
        state.lessonData = await getLessonById(lessonId);
        if (!state.lessonData) {
            showToast('الدرس غير موجود', 'error');
            window.router?.navigateTo('not-found');
            return;
        }

        // استخراج تقييم المستخدم الحالي (إن وُجد) من مصفوفة التقييمات
        if (state.currentUser?.id && Array.isArray(state.lessonData.ratings)) {
            const myRating = state.lessonData.ratings.find(r => String(r.userId) === String(state.currentUser.id));
            state.userRating = myRating?.rating || 0;
        }

        // جلب الوحدات لعرض اسم الوحدة
        state.units = await fetchUnits();

        // جلب الامتحان المرتبط
        try {
            state.examData = await getExamByLessonId(lessonId);
        } catch (_) {
            state.examData = null;
        }

        // تقدم الطالب المحفوظ
        if (state.currentUser?.user_type === 'student') {
            try {
                const progressList = await getUserProgress(state.currentUser.id);
                const thisProgress = progressList.find(p => p.lesson_id == lessonId);
                if (thisProgress) {
                    state.watchProgress = thisProgress.progress || 0;
                    state.totalTimeSpent = thisProgress.total_time_spent || 0;
                }
            } catch (_) { /* لا نعيق التحميل */ }
        }

        // تسجيل الوصول (يجب انتظارها لتفادي تعارضها مع أي تحديث لاحق للتقدم أثناء المشاهدة)
        if (state.currentUser) {
            await logLessonAccess(state.currentUser.id, lessonId);
        }

        // جلب التعليقات (الصفحة الأولى)
        const commentsResult = await getComments(CONFIG.COMMENTS_PAGE_SIZE, lessonId);
        state.comments = commentsResult.comments || [];
        state.commentsLastDoc = commentsResult.lastDoc || null;
        state.hasMoreComments = commentsResult.hasMore || false;

        renderLessonView();

        // 📢 إذاعة اكتمال تحميل بيانات الدرس (يستمع إليه directing.js لعرض رسالة توجيهية)
        EventBus.emit('lesson:loaded', state.lessonData);

        // 📢 تسجيل مشاهدة الدرس لأغراض الإحصائيات (أولوية منخفضة، غير حرج)
        if (state.currentUser?.id) {
            EventBus.emit('lesson:viewed', {
                userId: state.currentUser.id,
                lessonId: state.lessonId,
                viewedAt: new Date().toISOString()
            });
        }

        // تحميل التوصيات دون إعاقة عرض الدرس (غير حرج)
        loadRecommendations();
    } catch (error) {
        console.error('❌ فشل تحميل الدرس:', error);
        showToast('تعذر تحميل الدرس', 'error');
        showErrorState(state.container, error);
    } finally {
        showLoading(false);
    }
}

function renderLessonView() {
    const lesson = state.lessonData;
    if (!lesson) return;

    const unit = state.units.find(u => u.id == lesson.unit_id);

    // العناوين والمعلومات الأساسية
    if (state.elements.breadcrumbTitle)
        state.elements.breadcrumbTitle.textContent = lesson.title;
    if (state.elements.lessonTitle)
        state.elements.lessonTitle.textContent = lesson.title;
    if (state.elements.lessonDescription)
        state.elements.lessonDescription.textContent = lesson.description || '';
    if (state.elements.stageBadge)
        state.elements.stageBadge.textContent = lesson.stage || '';
    if (state.elements.gradeBadge)
        state.elements.gradeBadge.textContent = `الصف ${lesson.grade}`;
    if (state.elements.semesterBadge)
        state.elements.semesterBadge.textContent =
            lesson.semester === 'أول' ? 'الفصل الأول' :
            lesson.semester === 'ثاني' ? 'الفصل الثاني' : (lesson.semester || '');
    if (state.elements.unitBadge && unit) {
        state.elements.unitBadge.textContent = unit.name;
        state.elements.unitBadge.style.display = 'inline-block';
    }
    if (state.elements.durationEl)
        state.elements.durationEl.textContent = lesson.duration || 0;
    if (state.elements.commentsCountEl)
        state.elements.commentsCountEl.textContent = state.comments.length;
    if (state.elements.commentsCountBadgeEl)
        state.elements.commentsCountBadgeEl.textContent = state.comments.length;
    if (state.elements.likesCountEl)
        state.elements.likesCountEl.textContent = lesson.likes || 0;

    // فيديو يوتيوب
    if (lesson.video_url && state.elements.videoContainer) {
        const videoId = extractYouTubeId(lesson.video_url);
        if (videoId) {
            state.elements.videoContainer.innerHTML = `
                <iframe
                    width="100%"
                    height="400"
                    src="https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1"
                    title="${escapeHtml(lesson.title)}"
                    frameborder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowfullscreen
                    loading="lazy"
                ></iframe>`;
        }
    }

    // زر PDF
    if (state.elements.pdfBtn) {
        if (lesson.pdf_url) {
            state.elements.pdfBtn.style.display = 'inline-flex';
            state.elements.pdfBtn.setAttribute('href', lesson.pdf_url);
            state.elements.pdfBtn.setAttribute('target', '_blank');
            state.elements.pdfBtn.setAttribute('rel', 'noopener noreferrer');
        } else {
            state.elements.pdfBtn.style.display = 'none';
        }
    }
// عرض صورة الغلاف
if (state.elements.coverImage && state.elements.coverWrapper) {
    if (lesson.cover_image_url) {
        state.elements.coverImage.src = lesson.cover_image_url;
        state.elements.coverImage.alt = `غلاف الدرس: ${lesson.title}`;
        state.elements.coverWrapper.style.display = 'block';
        state.elements.coverImage.onerror = () => {
            state.elements.coverWrapper.style.display = 'none';
        };
    } else {
        state.elements.coverWrapper.style.display = 'none';
    }
}
    // حالة الإعجاب
    updateLikeButtonState();

    // حالة المفضلة
    updateFavoriteButtonState();

    // عرض التقييم (متوسط التقييم + تقييم المستخدم الحالي)
    updateRatingDisplay();

    // التقدم المحفوظ
    if (state.watchProgress > 0) {
        updateProgressUI(state.watchProgress);
    }

    // بطاقة الامتحان في صفحة المقدمة
    renderExamCard();

    // التعليقات
    renderComments();

    // avatar المستخدم في خانة التعليق
    renderCommentUserAvatar();
}

function renderExamCard() {
    if (!state.examData || !state.elements.examCardContainer) return;
    state.elements.examCardContainer.style.display = 'block';

    const durationEl = state.elements.examCardContainer.querySelector('#exam-duration-value');
    const questionsEl = state.elements.examCardContainer.querySelector('#exam-questions-value');
    if (durationEl) durationEl.textContent = state.examData.duration || 10;
    if (questionsEl) questionsEl.textContent = state.examData.questions_count || 0;

    // إذا أكمل الطالب الدرس من قبل - نعرض زر عرض الامتحان فقط
    if (state.watchProgress >= 100 && state.elements.startExamBtn) {
        state.elements.startExamBtn.style.display = 'inline-flex';
    }
}

function renderCommentUserAvatar() {
    if (!state.elements.commentUserAvatar || !state.currentUser) return;
    const user = state.currentUser;

    // إنشاء avatar-wrapper باستخدام النظام الموحد
    const avatarEl = createAvatarElement(user, 'sm', {
        showFrame: true,
        showBadge: true,
        clickable: false
    });

    // تنظيف الحاوية وإضافة العنصر الجديد
    state.elements.commentUserAvatar.innerHTML = '';
    state.elements.commentUserAvatar.appendChild(avatarEl);
}

function extractYouTubeId(url) {
    if (!url) return null;
    const regExp = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([^#&?]{11})/;
    const match = url.match(regExp);
    return match ? match[1] : null;
}

function updateLikeButtonState() {
    if (!state.elements.likeBtn || !state.lessonData) return;
    const liked = state.lessonData.liked_by?.includes(state.currentUser?.id);
    state.elements.likeBtn.classList.toggle('active', !!liked);
    const icon = state.elements.likeBtn.querySelector('i');
    if (icon) icon.className = liked ? 'fas fa-heart' : 'far fa-heart';
    state.elements.likeBtn.setAttribute('aria-pressed', String(!!liked));
}

function updateFavoriteButtonState() {
    if (!state.elements.favoriteBtn || !state.lessonData) return;
    const favorites = getFavorites();
    const isFav = favorites.includes(String(state.lessonData.id));
    const icon = state.elements.favoriteBtn.querySelector('i');
    if (icon) icon.className = isFav ? 'fas fa-star' : 'far fa-star';
    state.elements.favoriteBtn.setAttribute('aria-pressed', String(isFav));
    state.elements.favoriteBtn.title = isFav ? 'إزالة من المفضلة' : 'إضافة للمفضلة';
}

function updateProgressUI(percent) {
    if (state.elements.progressBarFill)
        state.elements.progressBarFill.style.width = percent + '%';
    if (state.elements.progressPercentage)
        state.elements.progressPercentage.textContent = percent + '%';
}

function renderComments() {
    if (!state.elements.commentsList) return;

    if (!state.comments.length) {
        state.elements.commentsList.innerHTML =
            '<p class="comments-empty text-muted">لا توجد تعليقات بعد. كن أول من يعلّق!</p>';
        return;
    }

    const html = state.comments.map(c => {
        // بناء كائن المستخدم من بيانات التعليق (لـ avatar.js)
        const commentUser = {
            id: c.user_id,
            full_name: c.full_name || 'مستخدم',
            gender: c.gender || 'male',
            user_type: c.commenter_user_type || c.user_type || 'student', // English preferred
            total_score: c.commenter_total_score || 0,
            avatar_job_index: c.commenter_avatar_job_index ?? 0,
            is_verified: c.commenter_is_verified || false,
        };

        // إنشاء avatar-wrapper
        const avatarWrapper = createAvatarElement(commentUser, 'sm', {
            showFrame: true,
            showBadge: true,
            clickable: false
        });

        // نوع المستخدم (للشارة النصية)
        const userTypeLabelMap = {
            teacher: 'معلم',
            moderator: 'مشرف',
            student: 'طالب'
        };
        const typeLabel = userTypeLabelMap[commentUser.user_type] || commentUser.user_type || '';
        const typeClass = commentUser.user_type === 'teacher'
            ? 'badge-teacher'
            : commentUser.user_type === 'moderator'
                ? 'badge-moderator'
                : 'badge-student';

        return `
            <div class="comment-item ${c.is_pinned ? 'pinned' : ''}" data-comment-id="${c.id}">
                <div class="comment-avatar">
                    ${avatarWrapper.outerHTML}
                </div>
                <div class="comment-content">
                    <div class="comment-header">
                        <strong class="comment-author">${escapeHtml(c.full_name || 'مستخدم')}</strong>
                        <span class="comment-badge ${typeClass}">${typeLabel}</span>
                        ${c.is_pinned ? '<span class="pin-badge" title="تعليق مثبت"><i class="fas fa-thumbtack" aria-hidden="true"></i></span>' : ''}
                        <time class="comment-date" datetime="${c.date?.toDate?.()?.toISOString() || ''}">${formatDate(c.date)}</time>
                    </div>
                    <p class="comment-text">${escapeHtml(c.comment)}</p>
                    <div class="comment-actions">
                        <button class="btn-comment-like" data-comment-id="${c.id}" aria-label="إعجاب بالتعليق">
                            <i class="far fa-heart" aria-hidden="true"></i>
                            <span>${c.likes || 0}</span>
                        </button>
                        <button class="btn-comment-reply" data-comment-id="${c.id}" data-author="${escapeHtml(c.full_name || '')}">
                            <i class="fas fa-reply" aria-hidden="true"></i> رد
                        </button>
                    </div>
                </div>
            </div>`;
    }).join('');

    state.elements.commentsList.innerHTML = html;

    // ربط أحداث التعليقات (كما هي)
    state.elements.commentsList.querySelectorAll('.btn-comment-reply').forEach(btn => {
        btn.addEventListener('click', () => {
            const author = btn.dataset.author;
            if (state.elements.commentInput) {
                state.elements.commentInput.value = `@${author} `;
                state.elements.commentInput.focus();
            }
        });
    });

    updateLoadMoreCommentsButton();
}

// ====== تحميل المزيد من التعليقات (Pagination) ======

async function loadMoreComments() {
    if (state.isLoadingMoreComments || !state.hasMoreComments || !state.lessonId) return;
    state.isLoadingMoreComments = true;
    updateLoadMoreCommentsButton();

    try {
        const result = await getComments(CONFIG.COMMENTS_PAGE_SIZE, state.lessonId, state.commentsLastDoc);
        state.comments = [...state.comments, ...(result.comments || [])];
        state.commentsLastDoc = result.lastDoc || state.commentsLastDoc;
        state.hasMoreComments = result.hasMore || false;
        renderComments();
    } catch (error) {
        console.error('❌ [lessons] فشل تحميل المزيد من التعليقات:', error);
        showToast('تعذر تحميل المزيد من التعليقات', 'error');
    } finally {
        state.isLoadingMoreComments = false;
        updateLoadMoreCommentsButton();
    }
}

function updateLoadMoreCommentsButton() {
    const btn = state.elements.loadMoreCommentsBtn;
    if (!btn) return;
    btn.style.display = state.hasMoreComments ? 'inline-block' : 'none';
    btn.disabled = state.isLoadingMoreComments;
    btn.textContent = state.isLoadingMoreComments ? 'جاري التحميل...' : 'عرض المزيد';
}

// ====== معالجات أحداث عرض الدرس ======

function bindViewEvents() {
    if (state.elements.startBtn) {
        state.elements.startBtn.addEventListener('click', startLesson);
    }
    if (state.elements.completeBtn) {
        state.elements.completeBtn.addEventListener('click', completeLesson);
    }
    if (state.elements.likeBtn) {
        state.elements.likeBtn.addEventListener('click', toggleLessonLikeHandler);
    }
    if (state.elements.favoriteBtn) {
        state.elements.favoriteBtn.addEventListener('click', toggleFavoriteInView);
    }
    if (state.elements.submitCommentBtn) {
        state.elements.submitCommentBtn.addEventListener('click', submitComment);
    }
    if (state.elements.commentInput) {
        state.elements.commentInput.addEventListener('keydown', (e) => {
            // Ctrl+Enter أو Cmd+Enter لإرسال التعليق
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                submitComment();
            }
        });
    }
    if (state.elements.editLessonBtn) {
        state.elements.editLessonBtn.addEventListener('click', () =>
            openEditLessonModal(state.lessonId));
    }
    if (state.elements.deleteLessonBtn) {
        state.elements.deleteLessonBtn.addEventListener('click', () =>
            openDeleteConfirmModal(state.lessonId));
    }
    if (state.elements.startExamBtn) {
        state.elements.startExamBtn.addEventListener('click', startExam);
    }
    if (state.elements.loadMoreCommentsBtn) {
        state.elements.loadMoreCommentsBtn.addEventListener('click', loadMoreComments);
    }
    // ==== [إصلاح] زر "العودة للدروس" لم يكن مربوطاً بأي معالج ====
    if (state.elements.backToLessonsBtn) {
        state.elements.backToLessonsBtn.addEventListener('click', () => {
            window.router?.navigateTo('lessons');
        });
    }

    initRatingSystemView();
}

function startLesson() {
    if (!state.currentUser) {
        showToast('يرجى تسجيل الدخول أولاً', 'warning');
        window.router?.navigateTo('login');
        return;
    }

    if (state.elements.introSection)
        state.elements.introSection.style.display = 'none';
    if (state.elements.screenSection)
        state.elements.screenSection.style.display = 'block';

    // بدء المؤقت
    state.watchStartTime = Date.now();
    if (state.watchInterval) clearInterval(state.watchInterval);

    state.watchInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - state.watchStartTime) / 1000) + state.totalTimeSpent;
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;

        if (state.elements.timerValue) {
            state.elements.timerValue.textContent =
                `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }

        // تحديث شريط التقدم بناءً على مدة الدرس
        const duration = state.lessonData?.duration;
        if (duration && duration > 0) {
            const totalSec = duration * 60;
            const currentElapsed = Math.floor((Date.now() - state.watchStartTime) / 1000);
            const progressPercent = Math.min(100,
                Math.floor(((currentElapsed + (state.totalTimeSpent || 0)) / totalSec) * 100)
            );

            if (progressPercent > state.watchProgress) {
                state.watchProgress = progressPercent;
                updateProgressUI(progressPercent);

                // حفظ كل 10% أو كل 10 ثوانٍ
                if (state.currentUser &&
                    (progressPercent % CONFIG.PROGRESS_SAVE_STEP_PERCENT === 0 ||
                     currentElapsed % CONFIG.PROGRESS_SAVE_INTERVAL_SEC === 0)) {
                    updateUserProgress(state.currentUser.id, state.lessonId, progressPercent)
                        .catch(() => { /* لا نعيق الواجهة */ });
                }

                // اكتمال تلقائي عند 100%
                if (progressPercent >= 100) {
                    clearInterval(state.watchInterval);
                    state.watchInterval = null;
                }
            }
        }
    }, 1000);
}

async function completeLesson() {
    if (!state.currentUser) {
        showToast('يرجى تسجيل الدخول أولاً', 'warning');
        return;
    }

    if (state.watchInterval) {
        clearInterval(state.watchInterval);
        state.watchInterval = null;
    }

    const elapsed = Math.floor((Date.now() - (state.watchStartTime || Date.now())) / 1000);
    state.totalTimeSpent += elapsed;
    state.watchProgress = 100;

    try {
        await updateUserProgress(state.currentUser.id, state.lessonId, 100);
    } catch (error) {
        console.error('فشل حفظ تقدم الدرس:', error);
        showToast('تعذر حفظ تقدمك، تحقق من اتصالك', 'warning');
    }

    if (state.elements.screenSection)
        state.elements.screenSection.style.display = 'none';
    if (state.elements.resultsSection)
        state.elements.resultsSection.style.display = 'block';

    // عرض وقت الإنهاء
    if (state.elements.timeSpent) {
        const min = Math.floor(state.totalTimeSpent / 60);
        const sec = state.totalTimeSpent % 60;
        state.elements.timeSpent.textContent =
            `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }
    if (state.elements.lastWatched) {
        state.elements.lastWatched.textContent = new Date().toLocaleString('ar-EG');
    }

    updateProgressUI(100);
    showToast('أحسنت! تم إكمال الدرس بنجاح 🎉', 'success');
    EventBus.emit('lesson:completed', {
        userId: state.currentUser.id,
        lessonId: state.lessonId,
        completedAt: new Date().toISOString(),
        progress: 100,
        totalTime: state.totalTimeSpent
    });

    // إظهار بطاقة الامتحان في شاشة النتائج
    if (state.examData && state.elements.examCardContainer) {
        state.elements.examCardContainer.style.display = 'block';
        if (state.elements.startExamBtn)
            state.elements.startExamBtn.style.display = 'inline-flex';
    }
}

async function toggleLessonLikeHandler() {
    if (!state.currentUser) {
        showToast('يرجى تسجيل الدخول', 'warning');
        return;
    }
    if (!state.lessonData) return;

    try {
        await toggleLessonLike(state.lessonId, state.currentUser.id);
        const wasLiked = state.lessonData.liked_by?.includes(state.currentUser.id);

        if (wasLiked) {
            state.lessonData.likes = Math.max(0, (state.lessonData.likes || 1) - 1);
            state.lessonData.liked_by = (state.lessonData.liked_by || [])
                .filter(id => id != state.currentUser.id);
        } else {
            state.lessonData.likes = (state.lessonData.likes || 0) + 1;
            if (!state.lessonData.liked_by) state.lessonData.liked_by = [];
            state.lessonData.liked_by.push(state.currentUser.id);
        }

        if (state.elements.likesCountEl)
            state.elements.likesCountEl.textContent = state.lessonData.likes;
        updateLikeButtonState();
    } catch (_) {
        showToast('فشل تحديث الإعجاب', 'error');
    }
}

async function toggleFavoriteInView() {
    if (!state.lessonData) return;
    const id = String(state.lessonData.id);
    const favorites = getFavorites();
    const idx = favorites.indexOf(id);
    const isNowFavorite = idx === -1;

    if (isNowFavorite) {
        favorites.push(id);
    } else {
        favorites.splice(idx, 1);
    }

    setFavorites(favorites);
    updateFavoriteButtonState();

    // 📢 إذاعة حدث المفضلة لتحديث المكوّنات الأخرى (مثل home.js)
    EventBus.emit(isNowFavorite ? 'lesson:favorited' : 'lesson:unfavorited', {
        userId: state.currentUser?.id || null,
        lessonId: id,
        date: new Date().toISOString()
    });

    if (state.currentUser?.id) {
        try {
            await syncUserFavorites(state.currentUser.id, favorites);
            state.currentUser.favorites = favorites;
            showToast(isNowFavorite ? 'تمت الإضافة للمفضلة ⭐' : 'تمت الإزالة من المفضلة', 'success');
        } catch (error) {
            console.error('❌ [lessons] فشل مزامنة المفضلة مع الخادم:', error);
            showToast('تم الحفظ محلياً، لكن تعذّرت المزامنة مع حسابك', 'warning');
        }
    } else {
        showToast(isNowFavorite ? 'تمت الإضافة للمفضلة ⭐' : 'تمت الإزالة من المفضلة', 'success');
    }
}

async function submitComment() {
    if (!state.currentUser) {
        showToast('يرجى تسجيل الدخول للتعليق', 'warning');
        return;
    }
    if (!state.lessonId) {
        showToast('تعذر تحديد الدرس المرتبط بالتعليق', 'error');
        return;
    }
    const commentText = state.elements.commentInput?.value.trim();
    if (!commentText || commentText.length < 2) {
        showToast('يرجى كتابة تعليق صالح', 'warning');
        return;
    }
    if (commentText.length > 1000) {
        showToast('التعليق طويل جداً (الحد الأقصى 1000 حرف)', 'warning');
        return;
    }

    // تعطيل الزر أثناء الإرسال
    if (state.elements.submitCommentBtn) {
        state.elements.submitCommentBtn.disabled = true;
    }

    try {
        await addComment({
            userId: state.currentUser.id,
            fullName: state.currentUser.full_name,
            userType: state.currentUser.user_type,
            gender: state.currentUser.gender,
            lessonId: state.lessonId,
            comment: commentText
        });

        if (state.elements.commentInput) state.elements.commentInput.value = '';

        // إعادة جلب التعليقات من البداية لعرض الجديد فوراً
        const commentsResult = await getComments(CONFIG.COMMENTS_PAGE_SIZE, state.lessonId);
        state.comments = commentsResult.comments || [];
        state.commentsLastDoc = commentsResult.lastDoc || null;
        state.hasMoreComments = commentsResult.hasMore || false;
        renderComments();
        updateLoadMoreCommentsButton();

        if (state.elements.commentsCountEl)
            state.elements.commentsCountEl.textContent = state.comments.length;
        if (state.elements.commentsCountBadgeEl)
            state.elements.commentsCountBadgeEl.textContent = state.comments.length;

        showToast('تم نشر تعليقك', 'success');
    } catch (_) {
        showToast('فشل إضافة التعليق', 'error');
    } finally {
        if (state.elements.submitCommentBtn) {
            state.elements.submitCommentBtn.disabled = false;
        }
    }
}

function startExam() {
    if (!state.examData) {
        showToast('لا يوجد امتحان مرتبط بهذا الدرس', 'warning');
        return;
    }
    window.router?.navigateTo('exam-view', { path: { id: state.examData.id } });
}

// ====== التوصيات ("قد يهمك أيضاً") ======

async function loadRecommendations() {
    if (!state.lessonData) return;
    try {
        const user = state.currentUser;
        let completedIds = [];
        if (user?.id) {
            try {
                const progressList = await getUserProgress(user.id);
                completedIds = progressList.filter(p => p.completed).map(p => String(p.lesson_id));
            } catch (_) { /* لا نعيق التوصيات */ }
        }

        const options = {
            limit: CONFIG.RECOMMENDATIONS_COUNT + 1,
            unitId: state.lessonData.unit_id,
            stage: state.lessonData.stage,
            grade: state.lessonData.grade,
            semester: state.lessonData.semester
        };

        const candidates = await getAllLessons(options);
        state.recommendedLessons = candidates
            .filter(l => String(l.id) !== String(state.lessonId) && !completedIds.includes(String(l.id)))
            .slice(0, CONFIG.RECOMMENDATIONS_COUNT);

        renderRecommendations();
    } catch (error) {
        console.error('❌ [lessons] فشل تحميل التوصيات:', error);
    }
}

function renderRecommendations() {
    const container = state.elements.recommendationsContainer;
    if (!container) return;

    if (!state.recommendedLessons.length) {
        container.innerHTML = '<p class="text-muted">لا توجد توصيات متاحة حالياً</p>';
        return;
    }

    container.innerHTML = state.recommendedLessons.map(lesson => `
        <div class="recommendation-item" data-id="${lesson.id}" role="button" tabindex="0" aria-label="${escapeHtml(lesson.title)}">
            <div class="recommendation-cover">
                ${lesson.cover_image_url
                    ? `<img src="${escapeHtml(lesson.cover_image_url)}" alt="${escapeHtml(lesson.title)}" loading="lazy">`
                    : `<i class="fas fa-book-open" aria-hidden="true"></i>`}
            </div>
            <div class="recommendation-info">
                <h4 class="recommendation-title">${escapeHtml(lesson.title)}</h4>
                <span class="recommendation-meta"><i class="fas fa-clock" aria-hidden="true"></i> ${lesson.duration || 0} دقيقة</span>
            </div>
        </div>`).join('');

    container.querySelectorAll('.recommendation-item').forEach(item => {
        const goToLesson = () => navigateToLesson(item.dataset.id);
        item.addEventListener('click', goToLesson);
        item.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                goToLesson();
            }
        });
    });
}

// ====== نظام التقييم بالنجوم (صفحة عرض الدرس) ======

function initRatingSystemView() {
    if (!state.elements.starsDisplay) return;

    state.elements.starsDisplay.querySelectorAll('.star').forEach(star => {
        const rate = () => handleRateLessonView(parseInt(star.dataset.rating, 10));
        star.addEventListener('click', rate);
        star.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); rate(); }
        });
        star.addEventListener('mouseenter', () => {
            previewStars(parseInt(star.dataset.rating, 10));
        });
    });

    state.elements.starsDisplay.addEventListener('mouseleave', () => {
        previewStars(state.userRating || 0);
    });
}

function previewStars(rating) {
    const stars = state.elements.starsDisplay?.querySelectorAll('.star i');
    stars?.forEach((icon, idx) => {
        icon.className = (idx + 1) <= rating ? 'fas fa-star' : 'far fa-star';
    });
}

async function handleRateLessonView(rating) {
    if (!state.currentUser) {
        showToast('يرجى تسجيل الدخول للتقييم', 'warning');
        return;
    }
    try {
        const result = await rateLesson(state.lessonId, state.currentUser.id, rating);
        state.userRating = rating;
        if (state.lessonData) {
            state.lessonData.average_rating = result?.average_rating ?? state.lessonData.average_rating;
            state.lessonData.ratings_count = result?.ratings_count ?? state.lessonData.ratings_count;
        }
        updateRatingDisplay();
        showToast('تم حفظ تقييمك، شكراً لك ⭐', 'success');
    } catch (error) {
        console.error('❌ [lessons] فشل حفظ التقييم:', error);
        showToast('تعذر حفظ التقييم', 'error');
    }
}

function updateRatingDisplay() {
    previewStars(state.userRating || 0);
    if (state.elements.averageRatingEl) {
        const avg = state.lessonData?.average_rating || 0;
        state.elements.averageRatingEl.textContent = `(${avg.toFixed(1)})`;
    }
    if (state.elements.ratingCountEl) {
        const count = state.lessonData?.ratings_count || 0;
        state.elements.ratingCountEl.textContent = `${count} تقييم`;
    }
}

// ====== نظام التقييم بالنجوم (بطاقة الدرس في القائمة) ======

async function handleRateLesson(lessonId, ratingValue) {
    if (!state.currentUser) {
        showToast('يرجى تسجيل الدخول للتقييم', 'warning');
        return;
    }
    try {
        const result = await rateLesson(lessonId, state.currentUser.id, ratingValue);
        const avg = result?.average_rating ?? ratingValue;
        const lesson = state.lessons.find(l => String(l.id) === String(lessonId));
        if (lesson) {
            lesson.average_rating = avg;
            lesson.ratings_count = result?.ratings_count ?? lesson.ratings_count;
        }
        updateCardRatingUI(lessonId, avg);
        showToast('تم حفظ تقييمك، شكراً لك ⭐', 'success');
    } catch (error) {
        console.error('❌ [lessons] فشل تقييم الدرس:', error);
        showToast('تعذر حفظ التقييم', 'error');
    }
}

function updateCardRatingUI(lessonId, avgRating) {
    const card = state.elements.lessonsGrid?.querySelector(`.lesson-card[data-id="${lessonId}"]`);
    if (!card) return;
    const stars = card.querySelectorAll('.rate-star i');
    stars.forEach((icon, idx) => {
        icon.className = (idx + 1) <= Math.round(avgRating) ? 'fas fa-star' : 'far fa-star';
    });
    const text = card.querySelector('.rating-avg-text');
    if (text) text.textContent = avgRating ? avgRating.toFixed(1) : '—';
}

// ====== دوال التعامل مع lesson-manager ======

function openAddLessonModal() {
    const user = state.currentUser;
    if (!user || (!isTeacher(user) && !isModerator(user))) {
        showToast('ليس لديك صلاحية لإضافة دروس', 'error');
        return;
    }

    // نمرّر سياق التصفح الحالي (مرحلة/صف/فصل) كقيم افتراضية لفورم الإضافة، بدل ما يدخلها المعلم يدويًا كل مرة
    const defaultContext = (state.activeStage || state.activeGrade !== null || state.workingSemester)
        ? {
            stage: state.activeStage || undefined,
            grade: state.activeGrade || undefined,
            semester: state.workingSemester || undefined
        }
        : null;

    if (window.lessonManager?.openAddLessonModal) {
        window.lessonManager.openAddLessonModal(defaultContext);
    } else {
        import('./lesson-manager.js')
            .then(m => m.openAddLessonModal(defaultContext))
            .catch(() => showToast('تعذر فتح نافذة الإضافة', 'error'));
    }
}

function openAddUnitModal() {
    const user = state.currentUser;
    if (!user || (!isTeacher(user) && !isModerator(user))) {
        showToast('ليس لديك صلاحية لإضافة وحدات', 'error');
        return;
    }

    if (window.lessonManager?.openAddUnitModal) {
        window.lessonManager.openAddUnitModal();
    } else {
        import('./lesson-manager.js')
            .then(m => m.openAddUnitModal())
            .catch(() => showToast('تعذر فتح نافذة إضافة الوحدة', 'error'));
    }
}
async function openEditLessonModal(lessonId) {
    if (window.lessonManager?.openEditLessonModal) {
        window.lessonManager.openEditLessonModal(lessonId);
        return;
    }
    try {
        const m = await import('./lesson-manager.js');
        await m.openEditLessonModal(lessonId);
    } catch (_) {
        showToast('تعذر فتح نافذة التعديل', 'error');
    }
}
async function openDeleteConfirmModal(lessonId) {
    if (window.lessonManager?.confirmDeleteLesson) {
        window.lessonManager.confirmDeleteLesson(lessonId);
        return;
    }
    const confirmed = await confirmModal('تأكيد الحذف', 'هل أنت متأكد من حذف هذا الدرس؟ سيتم نقله إلى المهملات لمدة 3 أيام.');
    if (!confirmed) return;
    try {
        await deleteLesson(lessonId, true);
        showToast('تم نقل الدرس إلى المهملات', 'success');
        EventBus.emit('lesson:deleted', { lessonId });
        refreshListData();
    } catch (_) {
        showToast('فشل حذف الدرس', 'error');
    }
}

function openMoveLessonModal(lessonId) {
    if (window.lessonManager?.openMoveLessonModal) {
        window.lessonManager.openMoveLessonModal(lessonId);
        return;
    }
    // fallback بسيط
    if (!window.modals?.showModal) return;
    window.modals.showModal({
        title: 'تحريك الدرس',
        html: `<div class="move-lesson-container">
            <p class="move-hint">اختر اتجاه التحريك بين الدروس:</p>
            <div class="move-actions">
                <button class="btn btn-outline move-up-btn">
                    <i class="fas fa-arrow-up" aria-hidden="true"></i> للأعلى
                </button>
                <button class="btn btn-outline move-down-btn">
                    <i class="fas fa-arrow-down" aria-hidden="true"></i> للأسفل
                </button>
            </div>
        </div>`,
        size: 'small',
        buttons: [{ text: 'إغلاق', role: 'cancel' }],
        onOpen: (modal) => {
            modal.element.querySelector('.move-up-btn')?.addEventListener('click', async () => {
                try {
                    await moveLesson(lessonId, 'up');
                    showToast('تم تحريك الدرس للأعلى', 'success');
                    EventBus.emit('lesson:updated', { lessonId });
                    modal.close();
                } catch (_) { showToast('فشل التحريك', 'error'); }
            });
            modal.element.querySelector('.move-down-btn')?.addEventListener('click', async () => {
                try {
                    await moveLesson(lessonId, 'down');
                    showToast('تم تحريك الدرس للأسفل', 'success');
                    EventBus.emit('lesson:updated', { lessonId });
                    modal.close();
                } catch (_) { showToast('فشل التحريك', 'error'); }
            });
        }
    });
}

// ====== دوال المفضلة (localStorage) ======

function getFavorites() {
    // إن كانت المفضلة متوفرة ضمن جلسة المستخدم (مزامنة من الخادم)، نعتمدها كمصدر رئيسي
    if (Array.isArray(state.currentUser?.favorites)) {
        return state.currentUser.favorites.map(String);
    }
    try {
        return JSON.parse(localStorage.getItem(CONFIG.FAVORITES_KEY) || '[]');
    } catch {
        return [];
    }
}

function setFavorites(favorites) {
    localStorage.setItem(CONFIG.FAVORITES_KEY, JSON.stringify(favorites));
}

// تحديث زر المفضلة داخل بطاقة درس محددة
function updateFavoriteCardUI(lessonId, isNowFavorite) {
    const card = state.elements.lessonsGrid?.querySelector(`.lesson-card[data-id="${lessonId}"]`);
    if (!card) return;
    const btn = card.querySelector('.like-btn');
    const icon = btn?.querySelector('i');
    if (btn) {
        btn.classList.toggle('active', isNowFavorite);
        btn.setAttribute('aria-pressed', String(isNowFavorite));
        btn.title = isNowFavorite ? 'إزالة من المفضلة' : 'إضافة للمفضلة';
    }
    if (icon) icon.className = isNowFavorite ? 'fas fa-star' : 'far fa-star';
    card.classList.toggle('favorited', isNowFavorite);
}

// تبديل المفضلة محلياً ثم مزامنتها مع الخادم
async function handleToggleFavorite(lessonId) {
    const id = String(lessonId);
    const favorites = getFavorites();
    const idx = favorites.indexOf(id);
    const isNowFavorite = idx === -1;

    if (isNowFavorite) {
        favorites.push(id);
    } else {
        favorites.splice(idx, 1);
    }

    // تحديث فوري (متفائل) للواجهة والتخزين المحلي كنسخة احتياطية
    setFavorites(favorites);
    const lesson = state.lessons.find(l => String(l.id) === id);
    if (lesson) lesson.is_favorite = isNowFavorite;
    updateFavoriteCardUI(lessonId, isNowFavorite);
    if (state.activeCategory === 'favorites') applyFiltersAndRender();
    updateStatsSummary();

    // 📢 إذاعة حدث المفضلة لتحديث المكوّنات الأخرى (مثل home.js)
    EventBus.emit(isNowFavorite ? 'lesson:favorited' : 'lesson:unfavorited', {
        userId: state.currentUser?.id || null,
        lessonId: id,
        date: new Date().toISOString()
    });

    // مزامنة مع الخادم لمستخدم مسجل الدخول
    if (state.currentUser?.id) {
        try {
            await syncUserFavorites(state.currentUser.id, favorites);
            state.currentUser.favorites = favorites;
            showToast(isNowFavorite ? 'تمت الإضافة للمفضلة ⭐' : 'تمت الإزالة من المفضلة', 'success');
        } catch (error) {
            console.error('❌ [lessons] فشل مزامنة المفضلة مع الخادم:', error);
            showToast('تم الحفظ محلياً، لكن تعذّرت المزامنة مع حسابك', 'warning');
        }
    } else {
        showToast(isNowFavorite ? 'تمت الإضافة للمفضلة ⭐' : 'تمت الإزالة من المفضلة', 'success');
    }
}

// ====== دوال مساعدة ======

function navigateToLesson(lessonId) {
    if (!state.currentUser) {
        showToast('يرجى تسجيل الدخول', 'warning');
        window.router?.navigateTo('login');
        return;
    }
    window.router?.navigateTo('lesson-view', { path: { id: lessonId } });
}

function confirmModal(title, message) {
    return new Promise(resolve => {
        if (window.modals?.confirm) {
            window.modals.confirm({
                title,
                message,
                confirmText: 'تأكيد',
                cancelText: 'إلغاء',
                onConfirm: () => resolve(true),
                onCancel: () => resolve(false)
            });
        } else {
            resolve(window.confirm(message));
        }
    });
}

function showLoading(show) {
    if (state.pageType === CONFIG.PAGE_TYPE_VIEW) {
        // صفحة عرض الدرس: لا تغيير - نفس مؤشر التحميل العام كما كان
        if (state.elements.loadingState) {
            state.elements.loadingState.style.display = show ? 'flex' : 'none';
        }
        return;
    }
    // صفحة قائمة الدروس: التحميل الهيكلي (Skeleton) داخل الشبكة يغني عن المؤشر النصي العام،
    // لذا نكتفي بضبط aria-busy الذي يتحكم بتعتيم الشبكة عبر lessons.css أثناء "تحميل المزيد"
    if (state.elements.lessonsGrid) {
        state.elements.lessonsGrid.setAttribute('aria-busy', String(show));
    }
}

function showErrorState(container, error) {
    const target = container?.querySelector('.lessons-grid')
        || container?.querySelector('#lesson-screen-section')
        || container;
    if (!target) return;

    const errDiv = document.createElement('div');
    errDiv.className = 'error-state';
    errDiv.innerHTML = `
        <i class="fas fa-exclamation-triangle" aria-hidden="true"></i>
        <h3>عذراً، حدث خطأ</h3>
        <p>${escapeHtml(error?.message || 'خطأ غير متوقع')}</p>`;

    const retryBtn = document.createElement('button');
    retryBtn.className = 'btn btn-primary';
    retryBtn.textContent = 'إعادة تحميل الصفحة';
    retryBtn.addEventListener('click', () => window.location.reload());
    errDiv.appendChild(retryBtn);

    target.innerHTML = '';
    target.appendChild(errDiv);
}

function showToast(message, type = 'info') {
    if (window.modals?.toast) {
        window.modals.toast(message, type);
    } else {
        console.log(`[Toast/${type}] ${message}`);
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
}

// ====== التصدير ======
export { loadListData as loadData };
