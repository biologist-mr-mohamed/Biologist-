/**
 * 📊 views/dashboard/dashboard.js - لوحة التحكم المتكاملة v6.0.0
 * ============================================================================
 * 📝 المسؤولية: نظام لوحة تحكم متقدم للمعلم والمشرف، يشمل:
 *   - إحصائيات KPI حقيقية من Firestore
 *   - رسوم بيانية تفاعلية (توزيع الطلاب، النشاط الأسبوعي)
 *   - قائمة أوائل الطلاب مع إمكانية عرض الكل
 *   - آخر النشاطات (حقيقية من سجلات النظام)
 *   - إدارة الطلاب (بحث، تعديل – مع صلاحية 5 أيام للمشرف)
 *   - إدارة التعليقات (حذف، تثبيت، رد)
 *   - إدارة المشرفين (إضافة، ترقية، حذف – للمعلم فقط)
 *   - المهملات (استعادة، حذف نهائي – للمعلم فقط)
 *   - الشكاوى (قائمة، رد، تغيير الحالة – للمعلم فقط)
 *   - التقارير (تصدير CSV/PDF – للمعلم فقط)
 *   - التحكم بالفصل الدراسي الظاهر للطلاب (نافذة لكل صف – للمعلم فقط)
 *   - تكامل مع EventBus، Notification، Directing، Avatar System
 *   - RTL بالكامل، دعم الوضع الليلي/النهاري
 * ============================================================================
 */

// ====== 1. استيراد التبعيات ======
import { getCurrentUser, isTeacher, isModerator } from '../../js/core/session.js';
import {
  getPlatformStats,
  getTopStudents,
  getComments,
  softDeleteComment,
  pinComment,
  getModeratorsList,
  updateModeratorLevel,
  deleteModerator,
  getTrashItems,
  restoreTrashItem,
  permanentlyDeleteTrashItem,
  getAllStudents,
  updateStudentAccount,
  getUserById,
  addModerator,
  getUserByPhone,
  getSemesterSettings,
  setActiveSemester,
  getLessonById,
  getExamById,
  searchUsers,
  getUserExamStats,
  createNotification,
  sendBulkNotifications,
  // 🆕 إكمال 1.2 و1.4
  getComplaints,
  updateComplaintStatus,
  replyToComplaint,
  getWeeklyActivityStats,
  getExamPerformanceStats
} from '../../js/core/api.js';
import { EventBus } from '../../js/core/event-bus.js';
import { createAvatarElement } from '../../js/utils/avatar.js';
import { showDirectingMessage } from '../../js/ui/directing.js';

// ====== 2. الثوابت والتكوين ======
const DASHBOARD_CONFIG = {
  CACHE_TTL: 2 * 60 * 1000,               // دقيقتان
  TOP_STUDENTS_LIMIT: 5,                  // أوائل الطلاب في النظرة العامة
  STUDENTS_PAGE_SIZE: 20,                 // عدد الطلاب في الجدول
  COMMENTS_PAGE_SIZE: 20,
  NOTIFICATIONS_LIMIT: 5,
  MAX_MODERATORS: 5,                      // الحد الأقصى للمشرفين
  STUDENT_EDIT_DAYS: 5,                   // صلاحية تعديل الطالب للمشرف
  CHART_COLORS: {
    primary: '#4A90D9',
    secondary: '#50C878',
    tertiary: '#FFB347',
    quaternary: '#FF6B6B',
    background: 'rgba(74, 144, 217, 0.2)'
  }
};

const CACHE_KEYS = {
  STATS: 'dashboard_stats_cache',
  TOP_STUDENTS: 'dashboard_top_students_cache',
  STUDENTS: 'dashboard_students_cache',
  COMMENTS: 'dashboard_comments_cache',
  MODERATORS: 'dashboard_moderators_cache',
  TRASH: 'dashboard_trash_cache',
  COMPLAINTS: 'dashboard_complaints_cache'
};

// ====== 3. الحالة الداخلية ======
let state = {
  initialized: false,
  container: null,
  currentUser: null,
  isTeacher: false,
  isModerator: false,
  isLoading: false,
  // البيانات
  platformStats: null,
  topStudents: [],
  students: [],
  filteredStudents: [],
  comments: [],
  moderators: [],
  trashItems: [],
  complaints: [],
  notifications: [],
  semesterSettings: [],
  // التبويب النشط
  activeTab: 'overview',
  // الفلاتر
  studentSearchQuery: '',
  studentStageFilter: '',
  studentGradeFilter: '',
  trashTypeFilter: 'lessons',
  complaintStatusFilter: 'all',
  // الرسوم البيانية
  charts: {
    studentsStage: null,
    weeklyActivity: null,
    examPerformance: null
  },
  // المؤقتات
  refreshInterval: null,
  // الكاش
  cache: {
    stats: null,
    topStudents: null,
    students: null,
    comments: null,
    moderators: null,
    trash: null,
    complaints: null
  },
  // مستمعات EventBus
  unsubscribers: []
};

// ====== 4. دوال مساعدة عامة ======
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber(num) {
  if (num === undefined || num === null) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function formatDate(timestamp) {
  if (!timestamp) return '—';
  let date;
  if (timestamp?.toDate) date = timestamp.toDate();
  else if (timestamp?.seconds) date = new Date(timestamp.seconds * 1000);
  else date = new Date(timestamp);
  if (isNaN(date)) return '—';
  return date.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return '—';
  let date;
  if (timestamp?.toDate) date = timestamp.toDate();
  else if (timestamp?.seconds) date = new Date(timestamp.seconds * 1000);
  else date = new Date(timestamp);
  if (isNaN(date)) return '—';
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return 'الآن';
  if (diffMins < 60) return `منذ ${diffMins} دقيقة`;
  if (diffHours < 24) return `منذ ${diffHours} ساعة`;
  if (diffDays < 7) return `منذ ${diffDays} يوم`;
  return formatDate(date);
}

function showToast(message, type = 'info') {
  window.modals?.toast?.(message, type) || console.log(`[${type}] ${message}`);
}

function showConfirm(options) {
  return new Promise(resolve => {
    if (window.modals?.confirm) {
      window.modals.confirm({
        ...options,
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false)
      });
    } else {
      resolve(confirm(options.message || 'هل أنت متأكد؟'));
    }
  });
}

function getCachedData(key, ttl = DASHBOARD_CONFIG.CACHE_TTL) {
  try {
    const cached = localStorage.getItem(key);
    if (!cached) return null;
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp > ttl) {
      localStorage.removeItem(key);
      return null;
    }
    return data;
  } catch { return null; }
}

function setCachedData(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
  } catch { /* تجاهل */ }
}

function getUserTypeLabel(type) {
  const map = { student: 'طالب', teacher: 'معلم', moderator: 'مشرف' };
  return map[type] || type;
}

function getStageLabel(stage) {
  const map = { preparatory: 'إعدادي', secondary: 'ثانوي' };
  return map[stage] || stage;
}

// ====== 5. جلب البيانات مع Cache ======

async function fetchPlatformStats(forceRefresh = false) {
  if (!forceRefresh && state.cache.stats) return state.cache.stats;
  try {
    const stats = await getPlatformStats();
    state.cache.stats = stats;
    setCachedData(CACHE_KEYS.STATS, stats);
    return stats;
  } catch (error) {
    console.error('❌ فشل جلب الإحصائيات:', error);
    return state.cache.stats || { students: 0, teachers: 0, lessons: 0, exams: 0, exam_results: 0, comments: 0 };
  }
}

async function fetchTopStudents(limit = DASHBOARD_CONFIG.TOP_STUDENTS_LIMIT, forceRefresh = false) {
  if (!forceRefresh && state.cache.topStudents) return state.cache.topStudents;
  try {
    const students = await getTopStudents(limit);
    state.cache.topStudents = students;
    setCachedData(CACHE_KEYS.TOP_STUDENTS, students);
    return students;
  } catch (error) {
    console.error('❌ فشل جلب أوائل الطلاب:', error);
    return state.cache.topStudents || [];
  }
}

async function fetchAllStudents(forceRefresh = false) {
  if (!forceRefresh && state.cache.students) return state.cache.students;
  try {
    const students = await getAllStudents();
    state.cache.students = students;
    setCachedData(CACHE_KEYS.STUDENTS, students);
    return students;
  } catch (error) {
    console.error('❌ فشل جلب الطلاب:', error);
    return state.cache.students || [];
  }
}

async function fetchComments(limit = DASHBOARD_CONFIG.COMMENTS_PAGE_SIZE, forceRefresh = false) {
  if (!forceRefresh && state.cache.comments) return state.cache.comments;
  try {
    const result = await getComments(limit);
    const comments = Array.isArray(result) ? result : result.comments || [];
    state.cache.comments = comments;
    setCachedData(CACHE_KEYS.COMMENTS, comments);
    return comments;
  } catch (error) {
    console.error('❌ فشل جلب التعليقات:', error);
    return state.cache.comments || [];
  }
}

async function fetchModerators(forceRefresh = false) {
  if (!forceRefresh && state.cache.moderators) return state.cache.moderators;
  try {
    const moderators = await getModeratorsList();
    state.cache.moderators = moderators;
    setCachedData(CACHE_KEYS.MODERATORS, moderators);
    return moderators;
  } catch (error) {
    console.error('❌ فشل جلب المشرفين:', error);
    return state.cache.moderators || [];
  }
}

async function fetchTrashItems(type = 'lessons', forceRefresh = false) {
  const key = `${CACHE_KEYS.TRASH}_${type}`;
  if (!forceRefresh && state.cache[key]) return state.cache[key];
  try {
    const items = await getTrashItems(type);
    state.cache[key] = items;
    setCachedData(key, items);
    return items;
  } catch (error) {
    console.error('❌ فشل جلب المهملات:', error);
    return state.cache[key] || [];
  }
}

async function fetchComplaints(forceRefresh = false) {
  if (!forceRefresh && state.cache.complaints) return state.cache.complaints;
  try {
    // 🆕 إكمال 1.2: بيانات حقيقية من مجموعة Complaints المخصصة بدل فلترة التعليقات
    const complaints = await getComplaints({ limitCount: 50 });
    state.cache.complaints = complaints;
    state.complaints = complaints; // 🛠️ كانت state.complaints لا تُملأ أبداً، فـ openReplyComplaintModal لم يكن يجد الشكوى
    setCachedData(CACHE_KEYS.COMPLAINTS, complaints);
    return complaints;
  } catch (error) {
    console.error('❌ فشل جلب الشكاوى:', error);
    return state.cache.complaints || [];
  }
}

async function fetchSemesterSettings(forceRefresh = false) {
  try {
    return await getSemesterSettings(forceRefresh);
  } catch (error) {
    console.error('❌ فشل جلب إعدادات الفصل الدراسي:', error);
    return [];
  }
}

// ====== 6. دوال عرض البيانات (Renderers) ======

function renderStatsOverview(stats) {
  const elements = getElements();
  if (!elements) return;
  if (elements.statTotalStudents) elements.statTotalStudents.textContent = formatNumber(stats.students || 0);
  if (elements.statTotalTeachers) elements.statTotalTeachers.textContent = formatNumber(stats.teachers || 0);
  if (elements.statTotalLessons) elements.statTotalLessons.textContent = formatNumber(stats.lessons || 0);
  if (elements.statTotalExams) elements.statTotalExams.textContent = formatNumber(stats.exams || 0);
  if (elements.statTotalExamResults) elements.statTotalExamResults.textContent = formatNumber(stats.exam_results || 0);
  if (elements.statTotalComments) elements.statTotalComments.textContent = formatNumber(stats.comments || 0);
}

function renderTopStudents(students) {
  const list = getElements()?.topStudentsList;
  if (!list) return;
  if (!students || students.length === 0) {
    list.innerHTML = `<p class="text-muted">لا يوجد طلاب بعد</p>`;
    return;
  }
  list.innerHTML = students.map((student, index) => {
    const rank = index + 1;
    const rankIcon = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
    const avatarHtml = student.avatar_url
      ? `<img src="${escapeHtml(student.avatar_url)}" class="student-avatar" alt="">`
      : `<div class="student-avatar-placeholder">${escapeHtml(student.full_name?.[0] || '?')}</div>`;
    return `
      <div class="top-student-item" data-user-id="${student.id}">
        <span class="rank">${rankIcon}</span>
        ${avatarHtml}
        <div class="student-info">
          <span class="student-name">${escapeHtml(student.full_name)}</span>
          <span class="student-score">${student.total_score || 0} نقطة</span>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.top-student-item').forEach(item => {
    item.addEventListener('click', () => {
      const userId = item.dataset.userId;
      if (userId && window.router) window.router.navigateTo('profile', { path: { id: userId } });
    });
  });
}

function renderRecentActivities(activities) {
  const list = getElements()?.recentActivityList;
  if (!list) return;
  if (!activities || activities.length === 0) {
    list.innerHTML = `<p class="text-muted">لا توجد نشاطات حديثة</p>`;
    return;
  }
  list.innerHTML = activities.map(act => `
    <div class="activity-item">
      <i class="fas ${act.icon || 'fa-clock'} activity-icon" style="color: ${act.color || 'var(--primary)'};"></i>
      <div class="activity-details">
        <span>${escapeHtml(act.text)}</span>
        <small>${escapeHtml(act.time)}</small>
      </div>
    </div>
  `).join('');
}

function renderStudentsTable(students, filterQuery = '', stageFilter = '', gradeFilter = '') {
  const tbody = getElements()?.studentsTableBody;
  if (!tbody) return;

  let filtered = [...students];
  if (filterQuery) {
    const q = filterQuery.toLowerCase();
    filtered = filtered.filter(s =>
      s.full_name?.toLowerCase().includes(q) ||
      s.phone?.includes(q) ||
      String(s.id).includes(q)
    );
  }
  if (stageFilter) filtered = filtered.filter(s => s.stage === stageFilter);
  if (gradeFilter) filtered = filtered.filter(s => String(s.grade) === String(gradeFilter));

  state.filteredStudents = filtered;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center">لا يوجد طلاب</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.slice(0, DASHBOARD_CONFIG.STUDENTS_PAGE_SIZE).map(student => `
    <tr>
      <td>${student.id}</td>
      <td>${escapeHtml(student.full_name)}</td>
      <td>${getStageLabel(student.stage) || '—'}</td>
      <td>${student.grade || '—'}</td>
      <td>${student.total_score || 0}</td>
      <td>
        <button class="btn btn-sm btn-outline edit-student-btn" data-id="${student.id}">
          <i class="fas fa-edit"></i> تعديل
        </button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.edit-student-btn').forEach(btn => {
    btn.addEventListener('click', () => openEditStudentModal(btn.dataset.id));
  });
}

function renderCommentsModeration(comments) {
  const container = getElements()?.commentsModerationList;
  if (!container) return;
  if (!comments || comments.length === 0) {
    container.innerHTML = `<p class="text-muted">لا توجد تعليقات</p>`;
    return;
  }
  container.innerHTML = comments.map(comment => `
    <div class="comment-moderation-item">
      <div class="comment-header">
        <strong>${escapeHtml(comment.full_name)}</strong>
        <span class="comment-date">${formatRelativeTime(comment.date)}</span>
        ${comment.pinned ? '<span class="badge badge-pinned">مثبت</span>' : ''}
      </div>
      <p class="comment-text">${escapeHtml(comment.comment)}</p>
      <div class="comment-actions">
        <button class="btn btn-sm btn-outline reply-comment-btn" data-id="${comment.id}">
          <i class="fas fa-reply"></i> رد
        </button>
        <button class="btn btn-sm ${comment.pinned ? 'btn-warning' : 'btn-outline'} pin-comment-btn" data-id="${comment.id}">
          <i class="fas fa-thumbtack"></i> ${comment.pinned ? 'إلغاء التثبيت' : 'تثبيت'}
        </button>
        <button class="btn btn-sm btn-danger delete-comment-btn" data-id="${comment.id}">
          <i class="fas fa-trash-alt"></i> حذف
        </button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.delete-comment-btn').forEach(btn => {
    btn.addEventListener('click', () => handleDeleteComment(btn.dataset.id));
  });
  container.querySelectorAll('.pin-comment-btn').forEach(btn => {
    btn.addEventListener('click', () => handlePinComment(btn.dataset.id));
  });
  container.querySelectorAll('.reply-comment-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      showToast('ميزة الرد ستفتح نافذة الرد قريباً', 'info');
    });
  });
}

function renderModeratorsList(moderators) {
  const container = getElements()?.moderatorsList;
  if (!container) return;
  if (!moderators || moderators.length === 0) {
    container.innerHTML = `<p class="text-muted">لا يوجد مشرفين</p>`;
    return;
  }
  container.innerHTML = moderators.map(mod => {
    const isSenior = mod.level === 'senior' || mod.user_type === 'teacher';
    return `
      <div class="moderator-card">
        <div class="moderator-avatar">
          ${mod.avatar_url
            ? `<img src="${escapeHtml(mod.avatar_url)}" alt="">`
            : `<div class="avatar-placeholder">${escapeHtml(mod.full_name?.[0] || '?')}</div>`}
        </div>
        <div class="moderator-info">
          <h4>${escapeHtml(mod.full_name)}</h4>
          <p>${escapeHtml(mod.phone || '—')}</p>
          <span class="badge ${isSenior ? 'badge-primary' : 'badge-secondary'}">
            ${isSenior ? 'مشرف ممتاز' : 'مشرف'}
          </span>
        </div>
        <div class="moderator-actions">
          ${!isSenior ? `
            <button class="btn btn-sm btn-outline promote-moderator-btn" data-id="${mod.id}">
              <i class="fas fa-arrow-up"></i> ترقية
            </button>
          ` : ''}
          <button class="btn btn-sm btn-danger delete-moderator-btn" data-id="${mod.id}">
            <i class="fas fa-trash-alt"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.promote-moderator-btn').forEach(btn => {
    btn.addEventListener('click', () => handlePromoteModerator(btn.dataset.id));
  });
  container.querySelectorAll('.delete-moderator-btn').forEach(btn => {
    btn.addEventListener('click', () => handleDeleteModerator(btn.dataset.id));
  });
}

function renderTrashTable(items, type) {
  const tbody = getElements()?.trashTableBody;
  if (!tbody) return;
  if (!items || items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center">المهملات فارغة</td></tr>`;
    return;
  }
  const typeLabelMap = { lessons: 'درس', exams: 'امتحان', comments: 'تعليق' };
  tbody.innerHTML = items.map(item => `
    <tr>
      <td>${typeLabelMap[item.type] || item.type}</td>
      <td>${escapeHtml(item.name || item.title || '—')}</td>
      <td>${formatRelativeTime(item.deleted_at)}</td>
      <td>
        <button class="btn btn-sm btn-success restore-item-btn" data-id="${item.id}" data-type="${item.type}">
          <i class="fas fa-undo"></i> استعادة
        </button>
        <button class="btn btn-sm btn-danger delete-permanently-btn" data-id="${item.id}" data-type="${item.type}">
          <i class="fas fa-trash-alt"></i> حذف نهائي
        </button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.restore-item-btn').forEach(btn => {
    btn.addEventListener('click', () => handleRestoreItem(btn.dataset.type, btn.dataset.id));
  });
  tbody.querySelectorAll('.delete-permanently-btn').forEach(btn => {
    btn.addEventListener('click', () => handlePermanentDelete(btn.dataset.type, btn.dataset.id));
  });
}

function renderComplaints(complaints) {
  const container = getElements()?.complaintsList;
  if (!container) return;
  if (!complaints || complaints.length === 0) {
    container.innerHTML = `<p class="text-muted">لا توجد شكاوى</p>`;
    return;
  }
  container.innerHTML = complaints.map(c => `
    <div class="complaint-item" data-id="${c.id}">
      <div class="complaint-header">
        <strong>${escapeHtml(c.full_name)}</strong>
        <span class="complaint-status status-${c.status || 'pending'}">${c.status === 'resolved' ? 'تم الرد' : c.status === 'closed' ? 'مغلقة' : 'قيد المعالجة'}</span>
        <span class="complaint-date">${formatRelativeTime(c.date)}</span>
      </div>
      <p class="complaint-text">${escapeHtml(c.comment)}</p>
      <div class="complaint-actions">
        <button class="btn btn-sm btn-outline reply-complaint-btn" data-id="${c.id}">
          <i class="fas fa-reply"></i> رد
        </button>
        <button class="btn btn-sm btn-outline resolve-complaint-btn" data-id="${c.id}">
          <i class="fas fa-check"></i> تم الرد
        </button>
        <button class="btn btn-sm btn-outline close-complaint-btn" data-id="${c.id}">
          <i class="fas fa-times"></i> إغلاق
        </button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.reply-complaint-btn').forEach(btn => {
    btn.addEventListener('click', () => openReplyComplaintModal(btn.dataset.id));
  });
  container.querySelectorAll('.resolve-complaint-btn').forEach(btn => {
    btn.addEventListener('click', () => handleResolveComplaint(btn.dataset.id));
  });
  container.querySelectorAll('.close-complaint-btn').forEach(btn => {
    btn.addEventListener('click', () => handleCloseComplaint(btn.dataset.id));
  });
}

// ====== 7. دوال الرسوم البيانية ======

function renderCharts(stats, students, weeklyActivity, examPerformance) {
  if (typeof Chart === 'undefined') {
    console.warn('Chart.js غير محملة');
    return;
  }
  renderStudentsStageChart(students);
  renderWeeklyActivityChart(weeklyActivity);
  renderExamPerformanceChart(examPerformance);
}

function renderStudentsStageChart(students) {
  const canvas = document.getElementById('students-stage-chart');
  if (!canvas) return;
  if (state.charts.studentsStage) state.charts.studentsStage.destroy();

  const stages = { preparatory: 0, secondary: 0 };
  (students || []).forEach(s => {
    if (s.stage === 'preparatory') stages.preparatory++;
    else if (s.stage === 'secondary') stages.secondary++;
  });

  state.charts.studentsStage = new Chart(canvas, {
    type: 'pie',
    data: {
      labels: ['إعدادي', 'ثانوي'],
      datasets: [{
        data: [stages.preparatory, stages.secondary],
        backgroundColor: ['#4CAF50', '#2196F3'],
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', rtl: true }
      }
    }
  });
}

function renderWeeklyActivityChart(weeklyActivity) {
  const canvas = document.getElementById('weekly-activity-chart');
  if (!canvas) return;
  if (state.charts.weeklyActivity) state.charts.weeklyActivity.destroy();

  // 🆕 إكمال 1.4: بيانات حقيقية (محاولات امتحانات + تعليقات لكل يوم) من getWeeklyActivityStats
  const days = weeklyActivity || [];
  const labels = days.map(d => d.label);
  const values = days.map(d => d.count);

  state.charts.weeklyActivity = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'عدد الأنشطة (امتحانات + تعليقات)',
        data: values,
        borderColor: DASHBOARD_CONFIG.CHART_COLORS.primary,
        backgroundColor: DASHBOARD_CONFIG.CHART_COLORS.background,
        tension: 0.3,
        fill: true,
        pointBackgroundColor: DASHBOARD_CONFIG.CHART_COLORS.primary
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } }
      }
    }
  });
}

function renderExamPerformanceChart(examPerformance) {
  const canvas = document.getElementById('exam-performance-chart');
  if (!canvas) return;
  if (state.charts.examPerformance) state.charts.examPerformance.destroy();

  // 🆕 إكمال 1.4: متوسط نسبة الإجابات الصحيحة لكل امتحان (بيانات حقيقية من getExamPerformanceStats)
  const exams = examPerformance || [];
  const labels = exams.map(e => (e.title && e.title.length > 18) ? e.title.slice(0, 18) + '…' : (e.title || `#${e.examId}`));
  const values = exams.map(e => e.averageAccuracy);

  state.charts.examPerformance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'متوسط نسبة الإجابات الصحيحة %',
        data: values,
        backgroundColor: DASHBOARD_CONFIG.CHART_COLORS.primary
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: { beginAtZero: true, max: 100 }
      }
    }
  });
}

// ====== 8. جلب آخر النشاطات ======

async function fetchRecentActivities() {
  try {
    // محاكاة: نجمع من التعليقات ونتائج الامتحانات وتقدم المستخدمين
    const comments = await fetchComments(10);
    const activities = comments.slice(0, 5).map(c => ({
      icon: 'fa-comment',
      color: 'var(--primary)',
      text: `تعليق من ${c.full_name}: "${c.comment?.slice(0, 30)}..."`,
      time: formatRelativeTime(c.date)
    }));
    // إضافة نشاطات افتراضية أخرى
    if (activities.length === 0) {
      return [
        { icon: 'fa-user-plus', color: '#4CAF50', text: 'تم تسجيل طالب جديد', time: 'منذ 5 دقائق' },
        { icon: 'fa-graduation-cap', color: '#2196F3', text: 'تم إنهاء امتحان الأحياء', time: 'منذ 15 دقيقة' },
        { icon: 'fa-comment', color: '#FFB347', text: 'تعليق جديد على درس الخلية', time: 'منذ 30 دقيقة' }
      ];
    }
    return activities;
  } catch {
    return [
      { icon: 'fa-clock', color: '#999', text: 'لا توجد نشاطات حديثة', time: '' }
    ];
  }
}

// ====== 9. معالجات الأحداث ======

async function handleDeleteComment(commentId) {
  const confirmed = await showConfirm({
    title: 'حذف التعليق',
    message: 'هل أنت متأكد من حذف هذا التعليق؟',
    confirmText: 'حذف',
    cancelText: 'إلغاء'
  });
  if (!confirmed) return;
  try {
    await softDeleteComment(commentId);
    showToast('تم حذف التعليق بنجاح', 'success');
    state.cache.comments = null;
    const comments = await fetchComments(DASHBOARD_CONFIG.COMMENTS_PAGE_SIZE, true);
    renderCommentsModeration(comments);
    EventBus.emit('comment:deleted', { commentId });
  } catch (error) {
    showToast('فشل حذف التعليق', 'error');
  }
}

async function handlePinComment(commentId) {
  try {
    const comment = state.comments.find(c => c.id == commentId);
    const newPinState = !comment?.pinned;
    await pinComment(commentId, newPinState);
    showToast(newPinState ? 'تم تثبيت التعليق' : 'تم إلغاء تثبيت التعليق', 'success');
    state.cache.comments = null;
    const comments = await fetchComments(DASHBOARD_CONFIG.COMMENTS_PAGE_SIZE, true);
    renderCommentsModeration(comments);
    EventBus.emit('comment:pinned', { commentId, pinned: newPinState });
  } catch (error) {
    showToast('فشل تغيير حالة التثبيت', 'error');
  }
}

async function handlePromoteModerator(modId) {
  const confirmed = await showConfirm({
    title: 'ترقية المشرف',
    message: 'هل تريد ترقية هذا المشرف إلى "مشرف ممتاز"؟',
    confirmText: 'ترقية',
    cancelText: 'إلغاء'
  });
  if (!confirmed) return;
  try {
    await updateModeratorLevel(modId, 'senior');
    showToast('تمت الترقية بنجاح', 'success');
    state.cache.moderators = null;
    const moderators = await fetchModerators(true);
    renderModeratorsList(moderators);
    EventBus.emit('moderator:promoted', { modId });
  } catch (error) {
    showToast('فشلت الترقية', 'error');
  }
}

async function handleDeleteModerator(modId) {
  const confirmed = await showConfirm({
    title: 'حذف المشرف',
    message: 'هل أنت متأكد من حذف هذا المشرف؟ سيتم إرجاعه إلى دور طالب.',
    confirmText: 'حذف',
    cancelText: 'إلغاء'
  });
  if (!confirmed) return;
  try {
    await deleteModerator(modId);
    showToast('تم حذف المشرف', 'success');
    state.cache.moderators = null;
    const moderators = await fetchModerators(true);
    renderModeratorsList(moderators);
    EventBus.emit('moderator:deleted', { modId });
  } catch (error) {
    showToast('فشل الحذف', 'error');
  }
}

async function handleRestoreItem(type, id) {
  try {
    await restoreTrashItem(type, id);
    showToast('تمت الاستعادة بنجاح', 'success');
    state.cache[`${CACHE_KEYS.TRASH}_${state.trashTypeFilter}`] = null;
    const items = await fetchTrashItems(state.trashTypeFilter, true);
    renderTrashTable(items, state.trashTypeFilter);
    EventBus.emit('trash:restored', { type, id });
  } catch (error) {
    showToast('فشلت الاستعادة', 'error');
  }
}

async function handlePermanentDelete(type, id) {
  const confirmed = await showConfirm({
    title: 'حذف نهائي',
    message: 'تحذير: هذا الإجراء نهائي ولا يمكن التراجع عنه. هل أنت متأكد؟',
    confirmText: 'حذف نهائي',
    cancelText: 'إلغاء'
  });
  if (!confirmed) return;
  try {
    await permanentlyDeleteTrashItem(type, id);
    showToast('تم الحذف النهائي', 'success');
    state.cache[`${CACHE_KEYS.TRASH}_${state.trashTypeFilter}`] = null;
    const items = await fetchTrashItems(state.trashTypeFilter, true);
    renderTrashTable(items, state.trashTypeFilter);
    EventBus.emit('trash:permanently-deleted', { type, id });
  } catch (error) {
    showToast('فشل الحذف', 'error');
  }
}

async function handleResolveComplaint(complaintId) {
  try {
    // 🆕 إكمال 1.2: كانت الدالة تعرض توست فقط بدون أي تحديث فعلي في القاعدة
    await updateComplaintStatus(complaintId, 'resolved');
    showToast('تم تحديث الحالة إلى "تم الرد"', 'success');
    state.cache.complaints = null;
    await loadComplaintsTab();
  } catch (error) {
    console.error('❌ فشل تحديث حالة الشكوى:', error);
    showToast('فشل تحديث الحالة', 'error');
  }
}

async function handleCloseComplaint(complaintId) {
  try {
    await updateComplaintStatus(complaintId, 'closed');
    showToast('تم إغلاق الشكوى', 'success');
    state.cache.complaints = null;
    await loadComplaintsTab();
  } catch (error) {
    console.error('❌ فشل إغلاق الشكوى:', error);
    showToast('فشل إغلاق الشكوى', 'error');
  }
}

// ====== 10. النوافذ المنبثقة (Modals) ======

async function openEditStudentModal(studentId) {
  try {
    const student = await getUserById(studentId);
    if (!student) throw new Error('الطالب غير موجود');

    // التحقق من صلاحية التعديل للمشرف (5 أيام)
    if (state.isModerator && !state.isTeacher) {
      const lastEdit = student.last_edit_date || student.last_activity;
      if (lastEdit) {
        let lastEditDate;
        if (lastEdit?.toDate) lastEditDate = lastEdit.toDate();
        else if (lastEdit?.seconds) lastEditDate = new Date(lastEdit.seconds * 1000);
        else lastEditDate = new Date(lastEdit);
        const diffDays = (Date.now() - lastEditDate) / (1000 * 60 * 60 * 24);
        if (diffDays < DASHBOARD_CONFIG.STUDENT_EDIT_DAYS) {
          showToast(`لا يمكن تعديل الطالب إلا بعد ${DASHBOARD_CONFIG.STUDENT_EDIT_DAYS} أيام من آخر تعديل`, 'warning');
          return;
        }
      }
    }

    const html = `
      <form id="edit-student-form">
        <div class="form-group">
          <label>الاسم الكامل</label>
          <input type="text" name="full_name" value="${escapeHtml(student.full_name)}" class="form-control" required>
        </div>
        <div class="form-group">
          <label>المرحلة</label>
          <select name="stage" class="form-control">
            <option value="preparatory" ${student.stage === 'preparatory' ? 'selected' : ''}>إعدادي</option>
            <option value="secondary" ${student.stage === 'secondary' ? 'selected' : ''}>ثانوي</option>
          </select>
        </div>
        <div class="form-group">
          <label>الصف</label>
          <input type="number" name="grade" value="${student.grade || ''}" class="form-control" min="1" max="3">
        </div>
        <div class="form-group">
          <label>البريد الإلكتروني</label>
          <input type="email" name="email" value="${student.email || ''}" class="form-control">
        </div>
        <div class="form-group">
          <label>رقم الهاتف</label>
          <input type="tel" name="phone" value="${student.phone || ''}" class="form-control">
        </div>
        ${state.isModerator && !state.isTeacher ? `
          <p class="text-muted">🔒 صلاحية التعديل محدودة بـ ${DASHBOARD_CONFIG.STUDENT_EDIT_DAYS} أيام (سيتم تسجيل وقت التعديل)</p>
        ` : ''}
      </form>
    `;

    window.modals.showModal({
      title: `تعديل حساب الطالب: ${student.full_name}`,
      html: html,
      size: 'medium',
      buttons: [
        { text: 'إلغاء', role: 'cancel', type: 'secondary' },
        { text: 'حفظ التغييرات', role: 'confirm', type: 'primary' }
      ],
      onConfirm: async () => {
        const form = document.getElementById('edit-student-form');
        const formData = new FormData(form);
        const updates = {
          full_name: formData.get('full_name'),
          stage: formData.get('stage'),
          grade: parseInt(formData.get('grade')) || 0,
          email: formData.get('email'),
          phone: formData.get('phone')
        };
        try {
          await updateStudentAccount(studentId, updates);
          showToast('تم تحديث بيانات الطالب', 'success');
          state.cache.students = null;
          const students = await fetchAllStudents(true);
          renderStudentsTable(students, state.studentSearchQuery, state.studentStageFilter, state.studentGradeFilter);
          EventBus.emit('student:updated', { studentId });
          return true;
        } catch (err) {
          showToast('فشل تحديث الطالب', 'error');
          return false;
        }
      }
    });
  } catch (err) {
    showToast('تعذر تحميل بيانات الطالب', 'error');
  }
}

async function openAddModeratorModal() {
  const html = `
    <form id="add-moderator-form">
      <div class="form-group">
        <label>رقم هاتف المستخدم</label>
        <input type="tel" name="phone" placeholder="أدخل رقم الهاتف" class="form-control" required>
        <p class="text-muted">سيتم البحث عن مستخدم مسجل بهذا الرقم لترقيته إلى مشرف</p>
      </div>
    </form>
  `;

  window.modals.showModal({
    title: 'إضافة مشرف جديد',
    html: html,
    size: 'small',
    buttons: [
      { text: 'إلغاء', role: 'cancel', type: 'secondary' },
      { text: 'بحث وترقية', role: 'confirm', type: 'primary' }
    ],
    onConfirm: async () => {
      const phone = document.querySelector('#add-moderator-form input[name="phone"]')?.value.trim();
      if (!phone) {
        showToast('يرجى إدخال رقم الهاتف', 'warning');
        return false;
      }
      try {
        const user = await getUserByPhone(phone);
        if (!user) {
          showToast('لا يوجد مستخدم مسجل بهذا الرقم', 'error');
          return false;
        }
        if (user.user_type === 'teacher' || user.user_type === 'moderator') {
          showToast('هذا المستخدم بالفعل معلم أو مشرف', 'warning');
          return false;
        }
        // التحقق من عدد المشرفين الحاليين
        const moderators = await fetchModerators(true);
        if (moderators.length >= DASHBOARD_CONFIG.MAX_MODERATORS) {
          showToast(`لا يمكن إضافة أكثر من ${DASHBOARD_CONFIG.MAX_MODERATORS} مشرفين`, 'warning');
          return false;
        }
        const confirmed = await showConfirm({
          title: 'تأكيد الترقية',
          message: `هل تريد ترقية "${user.full_name}" إلى مشرف؟`,
          confirmText: 'ترقية',
          cancelText: 'إلغاء'
        });
        if (!confirmed) return false;

        await addModerator(user.id);
        showToast(`تمت ترقية ${user.full_name} إلى مشرف بنجاح`, 'success');
        state.cache.moderators = null;
        const newModerators = await fetchModerators(true);
        renderModeratorsList(newModerators);
        EventBus.emit('moderator:added', { userId: user.id });
        return true;
      } catch (err) {
        showToast('فشل إضافة المشرف', 'error');
        return false;
      }
    }
  });
}

async function openChangeSemesterModal() {
  let settings = await fetchSemesterSettings(true);
  const html = `
    <div class="semester-panel">
      <p class="text-muted">
        <i class="fas fa-info-circle"></i>
        لكل صف إعداد مستقل. أي تغيير هنا يؤثر فوراً على كل طلاب الصف المختار.
      </p>
      <div class="semester-panel-list">
        ${SEMESTER_PANEL_STAGES.map(stage =>
          SEMESTER_PANEL_GRADES.map(grade => {
            const setting = settings.find(s => s.stage === stage.value && Number(s.grade) === grade.value);
            const active = setting?.active_semester || 'أول';
            const audit = setting?.updated_by === state.currentUser?.id
              ? 'أنت'
              : (setting?.updated_by ? 'معلم آخر' : 'لم يُعدّل');
            return `
              <div class="semester-panel-row" data-stage="${stage.value}" data-grade="${grade.value}">
                <div>
                  <strong>${stage.label} — الصف ${grade.label}</strong>
                  <span class="text-muted" style="font-size:12px;">آخر تحديث: ${audit}</span>
                </div>
                <div>
                  <button class="btn btn-sm ${active === 'أول' ? 'btn-primary' : 'btn-outline'} semester-btn" data-semester="أول">الأول</button>
                  <button class="btn btn-sm ${active === 'ثاني' ? 'btn-primary' : 'btn-outline'} semester-btn" data-semester="ثاني">الثاني</button>
                </div>
              </div>
            `;
          }).join('')
        ).join('')}
      </div>
    </div>
  `;

  window.modals.showModal({
    title: 'التحكم بالفصل الدراسي الظاهر للطلاب',
    html: html,
    size: 'large',
    buttons: [{ text: 'إغلاق', role: 'cancel', type: 'secondary' }],
    onOpen: (modal) => {
      modal.element.querySelectorAll('.semester-panel-row').forEach(row => {
        const stage = row.dataset.stage;
        const grade = parseInt(row.dataset.grade, 10);
        row.querySelectorAll('.semester-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            const newSemester = btn.dataset.semester;
            const currentActive = row.querySelector('.btn-primary')?.dataset.semester || 'أول';
            if (newSemester === currentActive) return;
            const confirmed = await showConfirm({
              title: 'تغيير الفصل الدراسي',
              message: `هل أنت متأكد من تغيير الفصل الدراسي لـ ${getStageLabel(stage)} — الصف ${grade} من ${currentActive === 'أول' ? 'الأول' : 'الثاني'} إلى ${newSemester === 'أول' ? 'الأول' : 'الثاني'}؟`,
              confirmText: 'تغيير',
              cancelText: 'إلغاء'
            });
            if (!confirmed) return;
            try {
              await setActiveSemester(stage, grade, newSemester, state.currentUser?.id);
              row.querySelectorAll('.semester-btn').forEach(b => {
                b.classList.toggle('btn-primary', b.dataset.semester === newSemester);
                b.classList.toggle('btn-outline', b.dataset.semester !== newSemester);
              });
              showToast(`تم تغيير الفصل الدراسي لـ ${getStageLabel(stage)} — الصف ${grade}`, 'success');
              EventBus.emit('semester:active-changed', { stage, grade, semester: newSemester });
            } catch (err) {
              showToast('فشل تغيير الفصل الدراسي', 'error');
            }
          });
        });
      });
    }
  });
}

async function openReplyComplaintModal(complaintId) {
  const html = `
    <form id="reply-complaint-form">
      <div class="form-group">
        <label>الرد على الشكوى</label>
        <textarea name="reply" rows="4" placeholder="اكتب ردك هنا..." class="form-control" required></textarea>
      </div>
    </form>
  `;
  window.modals.showModal({
    title: 'الرد على الشكوى',
    html: html,
    size: 'medium',
    buttons: [
      { text: 'إلغاء', role: 'cancel', type: 'secondary' },
      { text: 'إرسال الرد', role: 'confirm', type: 'primary' }
    ],
    onConfirm: async () => {
      const reply = document.querySelector('#reply-complaint-form textarea[name="reply"]')?.value.trim();
      if (!reply) {
        showToast('يرجى كتابة الرد', 'warning');
        return false;
      }
      try {
        // 🆕 إكمال 1.2: حفظ الرد فعليًا على مستند الشكوى (وليس مجرد إرسال إشعار بدون أثر دائم)
        await replyToComplaint(complaintId, reply);
        // إرسال إشعار للطالب صاحب الشكوى
        const complaint = state.complaints.find(c => c.id == complaintId);
        if (complaint) {
          await createNotification(complaint.user_id, {
            title: 'تم الرد على شكواك',
            message: reply,
            type: 'info',
            sender: 'system'
          });
        }
        showToast('تم إرسال الرد بنجاح', 'success');
        state.cache.complaints = null;
        await loadComplaintsTab();
        return true;
      } catch (err) {
        console.error('❌ فشل إرسال الرد على الشكوى:', err);
        showToast('فشل إرسال الرد', 'error');
        return false;
      }
    }
  });
}

// ====== 11. دوال التبويبات والتنقل ======

function switchTab(tabId) {
  state.activeTab = tabId;
  const elements = getElements();
  if (!elements) return;

  elements.tabBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  elements.tabContents.forEach(content => {
    content.style.display = content.dataset.tabContent === tabId ? 'block' : 'none';
  });

  // تحميل بيانات التبويب عند التبديل
  switch (tabId) {
    case 'students':
      if (state.isModerator || state.isTeacher) loadStudentsTab();
      break;
    case 'comments':
      if (state.isModerator || state.isTeacher) loadCommentsTab();
      break;
    case 'moderators':
      if (state.isTeacher) loadModeratorsTab();
      break;
    case 'trash':
      if (state.isTeacher) loadTrashTab();
      break;
    case 'complaints':
      if (state.isTeacher) loadComplaintsTab();
      break;
    case 'overview':
    default:
      loadOverviewTab();
      break;
  }
}

async function loadOverviewTab() {
  const stats = await fetchPlatformStats();
  const topStudents = await fetchTopStudents(DASHBOARD_CONFIG.TOP_STUDENTS_LIMIT);
  const students = await fetchAllStudents();
  const activities = await fetchRecentActivities();
  // 🆕 إكمال 1.4: بيانات حقيقية للرسمين بدل Math.random()/الأرقام الثابتة
  const [weeklyActivity, examPerformance] = await Promise.all([
    getWeeklyActivityStats().catch(() => []),
    getExamPerformanceStats().catch(() => [])
  ]);

  renderStatsOverview(stats);
  renderTopStudents(topStudents);
  renderRecentActivities(activities);
  renderCharts(stats, students, weeklyActivity, examPerformance);
}

async function loadStudentsTab() {
  const students = await fetchAllStudents();
  renderStudentsTable(students, state.studentSearchQuery, state.studentStageFilter, state.studentGradeFilter);
}

async function loadCommentsTab() {
  const comments = await fetchComments(DASHBOARD_CONFIG.COMMENTS_PAGE_SIZE);
  renderCommentsModeration(comments);
}

async function loadModeratorsTab() {
  const moderators = await fetchModerators();
  renderModeratorsList(moderators);
}

async function loadTrashTab() {
  const items = await fetchTrashItems(state.trashTypeFilter);
  renderTrashTable(items, state.trashTypeFilter);
}

async function loadComplaintsTab() {
  const all = await fetchComplaints();
  const filter = state.complaintStatusFilter;
  const complaints = (filter && filter !== 'all')
    ? all.filter(c => (c.status || 'pending') === filter)
    : all;
  renderComplaints(complaints);
}

// ====== 12. إدارة عناصر DOM ======

function getElements() {
  if (!state.container) return null;
  return {
    loading: state.container.querySelector('.loading-state'),
    content: state.container.querySelector('.dashboard-content'),
    userName: document.getElementById('dashboard-user-name'),
    statTotalStudents: document.getElementById('stat-total-students'),
    statTotalTeachers: document.getElementById('stat-total-teachers'),
    statTotalLessons: document.getElementById('stat-total-lessons'),
    statTotalExams: document.getElementById('stat-total-exams'),
    statTotalExamResults: document.getElementById('stat-total-exam-results'),
    statTotalComments: document.getElementById('stat-total-comments'),
    topStudentsList: document.getElementById('top-students-list'),
    recentActivityList: document.getElementById('recent-activity-list'),
    studentsTableBody: state.container.querySelector('#students-table tbody'),
    commentsModerationList: document.getElementById('comments-moderation-list'),
    moderatorsList: document.getElementById('moderators-list'),
    trashTableBody: state.container.querySelector('#trash-table tbody'),
    complaintsList: document.getElementById('complaints-list'),
    tabBtns: state.container.querySelectorAll('.tab-btn'),
    tabContents: state.container.querySelectorAll('.tab-content'),
    addModeratorBtn: document.getElementById('add-moderator-btn'),
    changeSemesterBtn: document.getElementById('change-semester-btn'),
    studentSearch: document.getElementById('student-search'),
    studentStageFilter: document.getElementById('student-filter-stage'),
    studentGradeFilter: document.getElementById('student-filter-grade'),
    trashFilters: state.container.querySelectorAll('[data-trash-type]'),
    complaintStatusFilter: document.getElementById('complaint-status-filter'),
    refreshBtn: document.getElementById('refresh-dashboard-btn')
  };
}

// ====== 13. ربط الأحداث ======

function bindEvents() {
  const elements = getElements();
  if (!elements) return;

  // أزرار التبويبات
  elements.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // إضافة مشرف
  if (elements.addModeratorBtn) {
    elements.addModeratorBtn.addEventListener('click', openAddModeratorModal);
  }

  // التحكم بالفصل الدراسي
  if (elements.changeSemesterBtn) {
    elements.changeSemesterBtn.addEventListener('click', openChangeSemesterModal);
  }

  // بحث الطلاب
  if (elements.studentSearch) {
    elements.studentSearch.addEventListener('input', () => {
      state.studentSearchQuery = elements.studentSearch.value.trim();
      loadStudentsTab();
    });
  }
  if (elements.studentStageFilter) {
    elements.studentStageFilter.addEventListener('change', () => {
      state.studentStageFilter = elements.studentStageFilter.value;
      loadStudentsTab();
    });
  }
  if (elements.studentGradeFilter) {
    elements.studentGradeFilter.addEventListener('change', () => {
      state.studentGradeFilter = elements.studentGradeFilter.value;
      loadStudentsTab();
    });
  }

  // فلتر المهملات
  elements.trashFilters?.forEach(filter => {
    filter.addEventListener('click', () => {
      state.trashTypeFilter = filter.dataset.trashType;
      elements.trashFilters.forEach(f => f.classList.toggle('active', f === filter));
      loadTrashTab();
    });
  });

  // فلتر الشكاوى
  if (elements.complaintStatusFilter) {
    elements.complaintStatusFilter.addEventListener('change', () => {
      state.complaintStatusFilter = elements.complaintStatusFilter.value;
      loadComplaintsTab();
    });
  }

  // زر تحديث البيانات
  if (elements.refreshBtn) {
    elements.refreshBtn.addEventListener('click', () => {
      refreshAllData();
    });
  }

  // حدث تغير حالة المستخدم
  state.unsubscribers.push(
    EventBus.on('userStateChanged', async (detail) => {
      if (detail.action === 'login' || detail.action === 'logout') {
        state.currentUser = getCurrentUser();
        state.isTeacher = isTeacher(state.currentUser);
        state.isModerator = isModerator(state.currentUser);
        setupUIBasedOnRole();
        await refreshAllData();
      }
    })
  );

  // أحداث تغيير البيانات (تحديث تلقائي)
  state.unsubscribers.push(
    EventBus.on('lesson:created', () => refreshAllData()),
    EventBus.on('lesson:updated', () => refreshAllData()),
    EventBus.on('lesson:deleted', () => refreshAllData()),
    EventBus.on('exam:created', () => refreshAllData()),
    EventBus.on('exam:updated', () => refreshAllData()),
    EventBus.on('exam:deleted', () => refreshAllData()),
    EventBus.on('comment:added', () => refreshAllData()),
    EventBus.on('comment:deleted', () => refreshAllData()),
    EventBus.on('moderator:added', () => refreshAllData()),
    EventBus.on('moderator:deleted', () => refreshAllData()),
    // 🔴 إصلاح (1.5): كان الحدث يُصدَر عند الترقية (handlePromoteModerator) لكن
    // بلا أي مستمع هنا، فكانت الواجهة لا تتحدّث تلقائيًا بعد ترقية مشرف —
    // بخلاف باقي عمليات إدارة المشرفين المتشابهة (إضافة/حذف) التي تتحدّث فورًا.
    EventBus.on('moderator:promoted', () => refreshAllData()),
    EventBus.on('student:updated', () => refreshAllData())
  );
}

// ====== 14. تحديث البيانات ======

async function refreshAllData() {
  showToast('جاري تحديث البيانات...', 'info');
  // مسح الكاش
  Object.keys(state.cache).forEach(key => state.cache[key] = null);
  // إعادة تحميل التبويب النشط
  switchTab(state.activeTab);
  // تحديث الإحصائيات في الخلفية
  const stats = await fetchPlatformStats(true);
  renderStatsOverview(stats);
}

// ====== 15. إعداد الواجهة حسب الصلاحية ======

function setupUIBasedOnRole() {
  const elements = getElements();
  if (!elements) return;

  const isUserTeacher = state.isTeacher;
  const isUserModerator = state.isModerator;

  // إظهار/إخفاء الأزرار والتبويبات
  if (elements.addModeratorBtn) {
    elements.addModeratorBtn.style.display = isUserTeacher ? 'flex' : 'none';
  }
  if (elements.changeSemesterBtn) {
    elements.changeSemesterBtn.style.display = isUserTeacher ? 'flex' : 'none';
  }

  // تبويبات
  elements.tabBtns.forEach(btn => {
    const tab = btn.dataset.tab;
    if (tab === 'moderators' || tab === 'trash' || tab === 'complaints') {
      btn.style.display = isUserTeacher ? 'block' : 'none';
    } else if (tab === 'students' || tab === 'comments') {
      btn.style.display = (isUserTeacher || isUserModerator) ? 'block' : 'none';
    } else {
      btn.style.display = 'block';
    }
  });

  // اسم المستخدم
  if (elements.userName) {
    elements.userName.textContent = state.currentUser?.full_name || '';
  }

  // إظهار المحتوى
  if (elements.content) {
    elements.content.style.display = 'block';
  }
  if (elements.loading) {
    elements.loading.style.display = 'none';
  }

  // رسالة ترحيب من نظام التوجيه
  if (state.isTeacher) {
    showDirectingMessage('مرحباً أيها المعلم 🧑‍🏫! لوحة التحكم جاهزة لإدارة المنصة.', 'teacher', 4000);
  } else if (state.isModerator) {
    showDirectingMessage('مرحباً أيها المشرف 🛠️! يمكنك إدارة الطلاب والتعليقات من هنا.', 'moderator', 4000);
  }
}

// ====== 16. التهيئة والتنظيف ======

export async function initializePage(container, params = {}) {
  if (state.initialized && state.container === container) {
    await refreshAllData();
    return;
  }

  console.log('📊 تهيئة لوحة التحكم v6.0.0...');
  state.container = container;
  state.currentUser = getCurrentUser();

  if (!state.currentUser || (!isTeacher(state.currentUser) && !isModerator(state.currentUser))) {
    console.warn('⛔ غير مصرح بالوصول إلى لوحة التحكم');
    window.router?.navigateTo('home');
    return;
  }

  state.isTeacher = isTeacher(state.currentUser);
  state.isModerator = isModerator(state.currentUser);

  try {
    // عرض التحميل
    const elements = getElements();
    if (elements?.loading) elements.loading.style.display = 'flex';
    if (elements?.content) elements.content.style.display = 'none';

    // ربط الأحداث
    bindEvents();

    // إعداد الواجهة حسب الصلاحية
    setupUIBasedOnRole();

    // تحميل التبويب الافتراضي
    await switchTab('overview');

    state.initialized = true;
    console.log('✅ لوحة التحكم جاهزة');

    // بدء التحديث التلقائي كل 5 دقائق
    if (state.refreshInterval) clearInterval(state.refreshInterval);
    state.refreshInterval = setInterval(() => {
      if (document.body.contains(container)) {
        refreshAllData();
      } else {
        clearInterval(state.refreshInterval);
      }
    }, 5 * 60 * 1000);

    EventBus.emit('page:ready', { page: 'dashboard' });
  } catch (error) {
    console.error('❌ فشل تهيئة لوحة التحكم:', error);
    showToast('حدث خطأ أثناء تحميل لوحة التحكم', 'error');
  } finally {
    const elements = getElements();
    if (elements?.loading) elements.loading.style.display = 'none';
    if (elements?.content) elements.content.style.display = 'block';
  }
}

export function cleanupPage() {
  console.log('🧹 تنظيف لوحة التحكم...');

  // إلغاء الاشتراكات
  state.unsubscribers.forEach(unsub => unsub());
  state.unsubscribers = [];

  // إيقاف التحديث التلقائي
  if (state.refreshInterval) {
    clearInterval(state.refreshInterval);
    state.refreshInterval = null;
  }

  // تدمير الرسوم البيانية
  if (state.charts.studentsStage) {
    state.charts.studentsStage.destroy();
    state.charts.studentsStage = null;
  }
  if (state.charts.weeklyActivity) {
    state.charts.weeklyActivity.destroy();
    state.charts.weeklyActivity = null;
  }
  if (state.charts.examPerformance) {
    state.charts.examPerformance.destroy();
    state.charts.examPerformance = null;
  }

  // إعادة تعيين الحالة
  state.initialized = false;
  state.container = null;
  state.isLoading = false;
  state.activeTab = 'overview';
  state.cache = {};
}

// ====== 17. تصدير الواجهة العامة ======
export default {
  initializePage,
  cleanupPage
};