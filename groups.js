/**
 * 👥 views/groups/groups.js - نظام المجموعات المتكامل (الإصدار 5.0.0)
 * ============================================================================
 * 📝 المسؤولية: إدارة قائمة المجموعات وصفحة عرض المجموعة الفردية.
 * ✅ يتكامل مع API و Router و Modals.
 * ✅ يدعم صلاحيات متعددة (معلم، مشرف، طالب، ولي أمر).
 * ✅ محادثة جماعية، إدارة الأعضاء، إضافة دروس وامتحانات مخصصة.
 * ✅ RTL بالكامل.
 * ============================================================================
 */

import { getCurrentUser, isAuthenticated, isTeacher, isModerator } from '../../js/core/session.js';
import {
  // ==== دوال المجموعات (ستضاف إلى api.js) ====
  getUserGroups,
  getGroupById,
  createGroup,
  updateGroup,
  deleteGroup,
  getGroupMessages,
  sendGroupMessage,
  addGroupMembers,
  removeGroupMember,
  addContentToGroup,
  removeContentFromGroup,
  // ==== دوال البحث عن المستخدمين والمحتوى ====
  searchUsers,
  getAllLessons,
  getExams,
  getUserById
} from '../../js/core/api.js';
import { EventBus } from '../../js/core/event-bus.js';

// ====== 1. الثوابت والتكوين ======
const GROUPS_CONFIG = {
  MAX_MEMBERS_PER_GROUP: 50,
  MESSAGE_FETCH_LIMIT: 50,
  REFRESH_INTERVAL: 5000, // 5 ثواني لتحديث الرسائل
  DEBOUNCE_DELAY: 300
};

// ====== 2. الحالة العامة ======
const state = {
  // صفحة القائمة
  list: {
    initialized: false,
    container: null,
    groups: [],
    isLoading: false
  },
  // صفحة العرض
  view: {
    initialized: false,
    container: null,
    groupId: null,
    groupData: null,
    members: [],
    membersDetails: [],
    messages: [],
    lessons: [],
    lessonsData: [],
    exams: [],
    examsData: [],
    currentTab: 'chat',
    messagesInterval: null,
    selectedNewMembers: [],      // للإضافة
    selectedContent: []          // للدروس/الامتحانات
  },
  currentUser: null
};

// ====== 3. دوال مساعدة ======
function showToast(message, type = 'info') {
  window.modals?.toast?.(message, type) || console.log(`[${type}] ${message}`);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[m]);
}

function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
}

function isAdmin(user = state.currentUser) {
  return user && (isTeacher(user) || isModerator(user));
}

function safeNavigate(route, params = {}) {
  if (window.router?.navigateTo) window.router.navigateTo(route, params);
  else console.error('❌ Router غير متاح');
}

// ====== 4. صفحة قائمة المجموعات (groups) ======

/**
 * تهيئة صفحة قائمة المجموعات
 */
export async function initGroupsPage(container) {
  if (state.list.initialized && state.list.container === container) {
    await refreshGroupsList();
    return;
  }

  console.log('👥 [groups] تهيئة صفحة المجموعات...');
  state.list.container = container;
  state.currentUser = getCurrentUser();

  if (!state.currentUser) {
    safeNavigate('login');
    return;
  }

  try {
    cacheListElements(container);
    setupListUI();
    bindListEvents();
    await loadGroupsList();

    state.list.initialized = true;
    EventBus.emit('page:ready', { page: 'groups' });
  } catch (error) {
    console.error('❌ [groups] فشل التهيئة:', error);
    showToast('حدث خطأ أثناء تحميل الصفحة', 'error');
  }
}

export function cleanupGroupsPage() {
  console.log('🧹 [groups] تنظيف صفحة المجموعات');
  state.list = { initialized: false, container: null, groups: [], isLoading: false };
}

function cacheListElements(container) {
  state.list.elements = {
    loading: container.querySelector('.loading-state'),
    grid: container.querySelector('.groups-grid'),
    empty: container.querySelector('.groups-empty'),
    createBtn: container.getElementById('create-group-btn'),
    emptyCreateBtn: container.getElementById('empty-create-btn'),
    subtitle: document.getElementById('groups-subtitle')
  };
}

function setupListUI() {
  const isUserAdmin = isAdmin(state.currentUser);
  if (state.list.elements.createBtn) {
    state.list.elements.createBtn.style.display = isUserAdmin ? 'flex' : 'none';
  }
  if (state.list.elements.emptyCreateBtn) {
    state.list.elements.emptyCreateBtn.style.display = isUserAdmin ? 'block' : 'none';
  }
  if (state.list.elements.subtitle) {
    state.list.elements.subtitle.textContent = isUserAdmin
      ? 'إدارة مجموعاتك التعليمية وإضافة محتوى مخصص'
      : 'المجموعات التي تنتمي إليها';
  }
}

function bindListEvents() {
  state.list.elements.createBtn?.addEventListener('click', () => openGroupModal());
  state.list.elements.emptyCreateBtn?.addEventListener('click', () => openGroupModal());
}

async function loadGroupsList() {
  if (state.list.isLoading) return;
  state.list.isLoading = true;
  showListLoading(true);

  try {
    const groups = await getUserGroups(state.currentUser.id);
    state.list.groups = groups || [];
    renderGroupsGrid();
  } catch (error) {
    console.error('❌ فشل جلب المجموعات:', error);
    showToast('تعذر تحميل المجموعات', 'error');
    renderListError();
  } finally {
    state.list.isLoading = false;
    showListLoading(false);
  }
}

async function refreshGroupsList() {
  if (!state.list.initialized) return;
  await loadGroupsList();
}

function showListLoading(show) {
  const els = state.list.elements;
  if (!els) return;
  if (els.loading) els.loading.style.display = show ? 'flex' : 'none';
  if (els.grid) els.grid.style.opacity = show ? '0.5' : '1';
}

function renderGroupsGrid() {
  const { grid, empty } = state.list.elements;
  const groups = state.list.groups;

  if (!groups.length) {
    grid.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  grid.style.display = 'grid';
  empty.style.display = 'none';

  const html = groups.map(group => `
    <div class="group-card" data-group-id="${group.id}">
      <div class="group-card-header">
        <h3>${escapeHtml(group.name)}</h3>
        ${group.created_by === state.currentUser.id ? '<span class="group-owner-badge">المالك</span>' : ''}
      </div>
      <div class="group-card-body">
        <p class="group-description">${escapeHtml(group.description || 'لا يوجد وصف')}</p>
        <div class="group-stats">
          <span><i class="fas fa-users"></i> ${group.members?.length || 1} عضو</span>
          <span><i class="fas fa-book"></i> ${group.lessons?.length || 0} درس</span>
          <span><i class="fas fa-graduation-cap"></i> ${group.exams?.length || 0} امتحان</span>
        </div>
      </div>
      <div class="group-card-footer">
        <button class="btn btn-primary btn-sm view-group-btn" data-group-id="${group.id}">
          <i class="fas fa-eye"></i> عرض
        </button>
      </div>
    </div>
  `).join('');

  grid.innerHTML = html;

  grid.querySelectorAll('.view-group-btn, .group-card').forEach(el => {
    el.addEventListener('click', (e) => {
      const card = e.target.closest('.group-card');
      if (!card) return;
      const groupId = card.dataset.groupId;
      safeNavigate('group-view', { path: { id: groupId } });
    });
  });
}

function renderListError() {
  const { grid, empty } = state.list.elements;
  grid.style.display = 'block';
  empty.style.display = 'none';
  grid.innerHTML = `<div class="error-state"><i class="fas fa-exclamation-triangle"></i><p>فشل تحميل المجموعات</p><button class="btn btn-outline retry-btn">إعادة المحاولة</button></div>`;
  grid.querySelector('.retry-btn')?.addEventListener('click', () => loadGroupsList());
}

// ====== 5. مودال إنشاء / تعديل مجموعة ======
let selectedMembersForCreate = [];

function openGroupModal(group = null) {
  const modal = document.getElementById('group-modal');
  if (!modal) return;

  const title = document.getElementById('modal-title');
  const nameInput = document.getElementById('group-name');
  const descInput = document.getElementById('group-description');
  const selectedContainer = document.getElementById('selected-members');

  title.textContent = group ? 'تعديل المجموعة' : 'إنشاء مجموعة جديدة';
  nameInput.value = group?.name || '';
  descInput.value = group?.description || '';
  selectedMembersForCreate = group?.members || [];
  renderSelectedMembers(selectedContainer, selectedMembersForCreate);

  modal.style.display = 'flex';

  // ربط البحث
  bindMemberSearch(modal, selectedMembersForCreate, selectedContainer);

  // حفظ
  const saveBtn = document.getElementById('save-group-btn');
  const newSaveBtn = saveBtn.cloneNode(true);
  saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
  newSaveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) {
      showToast('اسم المجموعة مطلوب', 'warning');
      return;
    }
    const data = {
      name,
      description: descInput.value.trim(),
      created_by: group?.created_by || state.currentUser.id,
      members: [...new Set([state.currentUser.id, ...selectedMembersForCreate.map(m => m.id)])],
      lessons: group?.lessons || [],
      exams: group?.exams || []
    };
    try {
      if (group) {
        await updateGroup(group.id, data);
        showToast('تم تحديث المجموعة', 'success');
      } else {
        await createGroup(data);
        showToast('تم إنشاء المجموعة', 'success');
      }
      modal.style.display = 'none';
      await loadGroupsList();
    } catch (err) {
      showToast('فشل حفظ المجموعة', 'error');
    }
  });

  // إغلاق
  modal.querySelector('.modal-close')?.addEventListener('click', () => modal.style.display = 'none');
  modal.querySelector('.modal-cancel')?.addEventListener('click', () => modal.style.display = 'none');
}

function bindMemberSearch(modal, selectedMembers, container) {
  const searchInput = document.getElementById('member-search');
  const suggestionsDiv = document.getElementById('member-suggestions');
  let timeout;

  searchInput.addEventListener('input', (e) => {
    clearTimeout(timeout);
    const query = e.target.value.trim();
    if (query.length < 2) {
      suggestionsDiv.classList.remove('active');
      return;
    }
    timeout = setTimeout(async () => {
      const users = await searchUsers(query);
      renderSuggestions(users, suggestionsDiv, (user) => {
        if (!selectedMembers.some(m => m.id === user.id)) {
          selectedMembers.push(user);
          renderSelectedMembers(container, selectedMembers);
        }
        suggestionsDiv.classList.remove('active');
        searchInput.value = '';
      });
    }, GROUPS_CONFIG.DEBOUNCE_DELAY);
  });
}

function renderSuggestions(users, container, onSelect) {
  if (!users?.length) {
    container.classList.remove('active');
    return;
  }
  container.innerHTML = users.map(user => `
    <div class="suggestion-item" data-user-id="${user.id}">
      <img src="${user.avatar_url || 'assets/images/M.png'}" class="suggestion-avatar">
      <div><strong>${escapeHtml(user.full_name)}</strong><br><small>${user.phone} - ${user.user_type}</small></div>
    </div>
  `).join('');
  container.classList.add('active');
  container.querySelectorAll('.suggestion-item').forEach(item => {
    item.addEventListener('click', () => {
      const user = users.find(u => u.id == item.dataset.userId);
      if (user) onSelect(user);
    });
  });
}

function renderSelectedMembers(container, members) {
  container.innerHTML = members.map(m => `
    <div class="member-tag">
      ${escapeHtml(m.full_name)}
      <button class="remove-member" data-user-id="${m.id}"><i class="fas fa-times"></i></button>
    </div>
  `).join('');
  container.querySelectorAll('.remove-member').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.userId);
      const idx = members.findIndex(m => m.id === id);
      if (idx > -1) members.splice(idx, 1);
      renderSelectedMembers(container, members);
    });
  });
}

// ====== 6. صفحة عرض المجموعة (group-view) ======

export async function initGroupViewPage(container, params) {
  const groupId = params?.path?.id;
  if (!groupId) {
    container.innerHTML = '<div class="error-state">معرف المجموعة غير صالح</div>';
    return;
  }

  if (state.view.initialized && state.view.container === container && state.view.groupId === groupId) {
    await refreshGroupData();
    return;
  }

  console.log(`👥 [group-view] تهيئة صفحة المجموعة ${groupId}`);
  state.view.container = container;
  state.view.groupId = groupId;
  state.currentUser = getCurrentUser();

  if (!state.currentUser) {
    safeNavigate('login');
    return;
  }

  try {
    cacheViewElements(container);
    showViewLoading(true);
    await loadGroupData();
    setupViewUI();
    bindViewEvents();
    startMessagesPolling();

    state.view.initialized = true;
    EventBus.emit('page:ready', { page: 'group-view', groupId });
  } catch (error) {
    console.error('❌ [group-view] فشل التهيئة:', error);
    showToast('تعذر تحميل بيانات المجموعة', 'error');
    container.innerHTML = `<div class="error-state"><i class="fas fa-exclamation-triangle"></i><p>المجموعة غير موجودة أو ليس لديك صلاحية الوصول</p></div>`;
  } finally {
    showViewLoading(false);
  }
}

export function cleanupGroupViewPage() {
  console.log('🧹 [group-view] تنظيف صفحة المجموعة');
  stopMessagesPolling();
  state.view = {
    initialized: false, container: null, groupId: null, groupData: null,
    members: [], membersDetails: [], messages: [], lessons: [], lessonsData: [],
    exams: [], examsData: [], currentTab: 'chat', messagesInterval: null,
    selectedNewMembers: [], selectedContent: []
  };
}

function cacheViewElements(container) {
  state.view.elements = {
    loading: container.querySelector('.loading-state'),
    groupContainer: container.querySelector('.group-container'),
    breadcrumb: document.getElementById('group-breadcrumb'),
    groupName: document.getElementById('group-name'),
    groupDesc: document.getElementById('group-description'),
    groupCreator: document.getElementById('group-creator'),
    membersCount: document.getElementById('members-count'),
    addMembersBtn: document.getElementById('add-members-btn'),
    leaveGroupBtn: document.getElementById('leave-group-btn'),
    deleteGroupBtn: document.getElementById('delete-group-btn'),
    tabBtns: container.querySelectorAll('.tab-btn'),
    tabContents: container.querySelectorAll('.tab-content'),
    chatMessages: document.getElementById('chat-messages'),
    chatInput: document.getElementById('chat-input'),
    sendBtn: document.getElementById('send-message-btn'),
    lessonsGrid: document.getElementById('group-lessons-grid'),
    examsGrid: document.getElementById('group-exams-grid'),
    membersList: document.getElementById('members-list'),
    addLessonBtn: container.querySelector('.add-lesson-to-group-btn'),
    addExamBtn: container.querySelector('.add-exam-to-group-btn')
  };
}

async function loadGroupData() {
  const group = await getGroupById(state.view.groupId);
  if (!group) throw new Error('المجموعة غير موجودة');

  // التحقق من العضوية أو الصلاحية
  const isMember = group.members.includes(state.currentUser.id);
  const isAdminUser = isAdmin(state.currentUser);
  if (!isMember && !isAdminUser) {
    throw new Error('ليس لديك صلاحية الوصول لهذه المجموعة');
  }

  state.view.groupData = group;
  state.view.members = group.members || [];
  state.view.lessons = group.lessons || [];
  state.view.exams = group.exams || [];

  await enrichGroupData();
}

async function enrichGroupData() {
  // جلب تفاصيل الأعضاء
  const memberPromises = state.view.members.map(id => getUserById(id).catch(() => null));
  state.view.membersDetails = (await Promise.all(memberPromises)).filter(Boolean);

  // جلب الدروس والامتحانات
  if (state.view.lessons.length) {
    const lessonPromises = state.view.lessons.map(id => getLessonById(id).catch(() => null));
    state.view.lessonsData = (await Promise.all(lessonPromises)).filter(Boolean);
  }
  if (state.view.exams.length) {
    const examPromises = state.view.exams.map(id => getExamById(id).catch(() => null));
    state.view.examsData = (await Promise.all(examPromises)).filter(Boolean);
  }
}

async function refreshGroupData() {
  if (!state.view.initialized) return;
  await loadGroupData();
  setupViewUI();
  if (state.view.currentTab === 'chat') await loadMessages();
  else if (state.view.currentTab === 'lessons') renderLessonsGrid();
  else if (state.view.currentTab === 'exams') renderExamsGrid();
  else if (state.view.currentTab === 'members') renderMembersList();
}

function setupViewUI() {
  const group = state.view.groupData;
  const els = state.view.elements;

  if (els.breadcrumb) els.breadcrumb.textContent = group.name;
  if (els.groupName) els.groupName.textContent = group.name;
  if (els.groupDesc) els.groupDesc.textContent = group.description || '';
  if (els.groupCreator) {
    const creator = state.view.membersDetails.find(m => m.id === group.created_by);
    els.groupCreator.textContent = creator?.full_name || 'غير معروف';
  }
  if (els.membersCount) els.membersCount.textContent = state.view.members.length;

  // صلاحيات الأزرار
  const isOwner = group.created_by === state.currentUser.id;
  const isAdminUser = isAdmin(state.currentUser);
  const canManage = isOwner || isAdminUser;

  if (els.addMembersBtn) els.addMembersBtn.style.display = canManage ? 'flex' : 'none';
  if (els.deleteGroupBtn) els.deleteGroupBtn.style.display = canManage ? 'flex' : 'none';
  if (els.leaveGroupBtn) els.leaveGroupBtn.style.display = !canManage ? 'flex' : 'none';
  if (els.addLessonBtn) els.addLessonBtn.style.display = canManage ? 'inline-flex' : 'none';
  if (els.addExamBtn) els.addExamBtn.style.display = canManage ? 'inline-flex' : 'none';

  // عرض التبويب الافتراضي
  switchTab('chat');
}

function bindViewEvents() {
  const els = state.view.elements;

  els.tabBtns?.forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  els.sendBtn?.addEventListener('click', sendMessage);
  els.chatInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  els.addMembersBtn?.addEventListener('click', () => openAddMembersModal());
  els.leaveGroupBtn?.addEventListener('click', confirmLeaveGroup);
  els.deleteGroupBtn?.addEventListener('click', confirmDeleteGroup);
  els.addLessonBtn?.addEventListener('click', () => openAddContentModal('lesson'));
  els.addExamBtn?.addEventListener('click', () => openAddContentModal('exam'));
}

function switchTab(tabId) {
  state.view.currentTab = tabId;
  const els = state.view.elements;

  els.tabBtns?.forEach(btn => {
    const active = btn.dataset.tab === tabId;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active);
  });
  els.tabContents?.forEach(content => {
    const active = content.dataset.tabContent === tabId;
    content.style.display = active ? 'block' : 'none';
  });

  if (tabId === 'chat') loadMessages();
  else if (tabId === 'lessons') renderLessonsGrid();
  else if (tabId === 'exams') renderExamsGrid();
  else if (tabId === 'members') renderMembersList();
}

// ====== 7. المحادثة ======
async function loadMessages() {
  const container = state.view.elements.chatMessages;
  if (!container) return;
  try {
    const messages = await getGroupMessages(state.view.groupId, GROUPS_CONFIG.MESSAGE_FETCH_LIMIT);
    state.view.messages = messages || [];
    renderMessages();
    scrollChatToBottom();
  } catch (error) {
    container.innerHTML = '<p class="error-text">تعذر تحميل الرسائل</p>';
  }
}

function renderMessages() {
  const container = state.view.elements.chatMessages;
  const messages = state.view.messages;
  if (!messages.length) {
    container.innerHTML = '<p class="empty-chat">لا توجد رسائل بعد. ابدأ المحادثة!</p>';
    return;
  }
  container.innerHTML = messages.map(msg => {
    const isOwn = msg.user_id === state.currentUser.id;
    const sender = state.view.membersDetails.find(m => m.id === msg.user_id);
    const senderName = sender?.full_name || 'مستخدم';
    return `
      <div class="message-item ${isOwn ? 'message-own' : ''}">
        <img class="message-avatar" src="${sender?.avatar_url || 'assets/images/M.png'}" alt="${senderName}">
        <div class="message-bubble">
          <span class="message-sender">${escapeHtml(senderName)}</span>
          <span class="message-text">${escapeHtml(msg.message)}</span>
          <span class="message-time">${formatTime(msg.timestamp)}</span>
        </div>
      </div>
    `;
  }).join('');
}

function scrollChatToBottom() {
  const container = state.view.elements.chatMessages;
  if (container) container.scrollTop = container.scrollHeight;
}

async function sendMessage() {
  const input = state.view.elements.chatInput;
  const message = input.value.trim();
  if (!message) return;

  try {
    await sendGroupMessage(state.view.groupId, state.currentUser.id, message);
    input.value = '';
    await loadMessages();
  } catch (error) {
    showToast('فشل إرسال الرسالة', 'error');
  }
}

function startMessagesPolling() {
  stopMessagesPolling();
  state.view.messagesInterval = setInterval(() => {
    if (state.view.currentTab === 'chat' && document.visibilityState === 'visible') {
      loadMessages();
    }
  }, GROUPS_CONFIG.REFRESH_INTERVAL);
}

function stopMessagesPolling() {
  if (state.view.messagesInterval) {
    clearInterval(state.view.messagesInterval);
    state.view.messagesInterval = null;
  }
}

// ====== 8. الدروس والامتحانات ======
function renderLessonsGrid() {
  const grid = state.view.elements.lessonsGrid;
  const lessons = state.view.lessonsData || [];
  const canManage = isOwnerOrAdmin();

  if (!lessons.length) {
    grid.innerHTML = '<p class="empty-text">لا توجد دروس مخصصة</p>';
    return;
  }
  grid.innerHTML = lessons.map(lesson => `
    <div class="custom-card">
      <h4>${escapeHtml(lesson.title)}</h4>
      <p>${escapeHtml(lesson.description || '')}</p>
      <div class="card-actions">
        <button class="btn btn-sm btn-outline view-lesson-btn" data-id="${lesson.id}">عرض</button>
        ${canManage ? `<button class="btn btn-sm btn-danger remove-content-btn" data-type="lesson" data-id="${lesson.id}"><i class="fas fa-times"></i></button>` : ''}
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('.view-lesson-btn').forEach(btn => {
    btn.addEventListener('click', () => safeNavigate('lesson-view', { path: { id: btn.dataset.id } }));
  });
  bindRemoveContentButtons(grid);
}

function renderExamsGrid() {
  const grid = state.view.elements.examsGrid;
  const exams = state.view.examsData || [];
  const canManage = isOwnerOrAdmin();

  if (!exams.length) {
    grid.innerHTML = '<p class="empty-text">لا توجد امتحانات مخصصة</p>';
    return;
  }
  grid.innerHTML = exams.map(exam => `
    <div class="custom-card">
      <h4>${escapeHtml(exam.title)}</h4>
      <p>${exam.questions_count || 0} سؤال - ${exam.duration || 30} دقيقة</p>
      <div class="card-actions">
        <button class="btn btn-sm btn-outline view-exam-btn" data-id="${exam.id}">بدء</button>
        ${canManage ? `<button class="btn btn-sm btn-danger remove-content-btn" data-type="exam" data-id="${exam.id}"><i class="fas fa-times"></i></button>` : ''}
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('.view-exam-btn').forEach(btn => {
    btn.addEventListener('click', () => safeNavigate('exam-view', { path: { id: btn.dataset.id } }));
  });
  bindRemoveContentButtons(grid);
}

function bindRemoveContentButtons(container) {
  container.querySelectorAll('.remove-content-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const type = btn.dataset.type;
      const id = Number(btn.dataset.id);
      if (confirm(`هل أنت متأكد من إزالة هذا ${type === 'lesson' ? 'الدرس' : 'الامتحان'} من المجموعة؟`)) {
        try {
          await removeContentFromGroup(state.view.groupId, type, id);
          showToast('تمت الإزالة', 'success');
          await loadGroupData();
          if (type === 'lesson') renderLessonsGrid();
          else renderExamsGrid();
        } catch (err) {
          showToast('فشلت الإزالة', 'error');
        }
      }
    });
  });
}

function isOwnerOrAdmin() {
  const group = state.view.groupData;
  return group?.created_by === state.currentUser.id || isAdmin(state.currentUser);
}

// ====== 9. الأعضاء ======
function renderMembersList() {
  const container = state.view.elements.membersList;
  const members = state.view.membersDetails || [];
  const canManage = isOwnerOrAdmin();

  container.innerHTML = members.map(member => `
    <div class="member-item">
      <img src="${member.avatar_url || 'assets/images/M.png'}" class="member-avatar">
      <div class="member-info">
        <span class="member-name">
          ${escapeHtml(member.full_name)}
          ${member.id === state.view.groupData.created_by ? ' <span class="owner-badge">المالك</span>' : ''}
          ${member.is_verified ? '<i class="fas fa-check-circle verification-badge-sm"></i>' : ''}
        </span>
        <span class="member-role">${getUserRoleArabic(member.user_type)}</span>
      </div>
      ${canManage && member.id !== state.currentUser.id ? `
        <button class="btn btn-sm btn-danger remove-member-btn" data-user-id="${member.id}"><i class="fas fa-user-minus"></i></button>
      ` : ''}
    </div>
  `).join('');

  container.querySelectorAll('.remove-member-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const userId = Number(btn.dataset.userId);
      if (confirm('هل أنت متأكد من إزالة هذا العضو؟')) {
        try {
          await removeGroupMember(state.view.groupId, userId);
          showToast('تمت إزالة العضو', 'success');
          await loadGroupData();
          renderMembersList();
        } catch (err) {
          showToast('فشلت الإزالة', 'error');
        }
      }
    });
  });
}

function getUserRoleArabic(type) {
  const roles = { student: 'طالب', parent: 'ولي أمر', moderator: 'مشرف', teacher: 'معلم' };
  return roles[type] || 'مستخدم';
}

// ====== 10. مودالات الإضافة ======
function openAddMembersModal() {
  const modal = document.getElementById('add-members-modal');
  if (!modal) return;

  state.view.selectedNewMembers = [];
  const container = document.getElementById('new-members-list');
  const searchInput = document.getElementById('add-member-search');
  const suggestionsDiv = document.getElementById('add-member-suggestions');

  modal.style.display = 'flex';
  renderSelectedMembers(container, state.view.selectedNewMembers);

  let timeout;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(timeout);
    const query = e.target.value.trim();
    if (query.length < 2) {
      suggestionsDiv.classList.remove('active');
      return;
    }
    timeout = setTimeout(async () => {
      const users = await searchUsers(query);
      // استبعاد الأعضاء الحاليين
      const filtered = users.filter(u => !state.view.members.includes(u.id));
      renderSuggestions(filtered, suggestionsDiv, (user) => {
        if (!state.view.selectedNewMembers.some(m => m.id === user.id)) {
          state.view.selectedNewMembers.push(user);
          renderSelectedMembers(container, state.view.selectedNewMembers);
        }
        suggestionsDiv.classList.remove('active');
        searchInput.value = '';
      });
    }, GROUPS_CONFIG.DEBOUNCE_DELAY);
  });

  document.getElementById('confirm-add-members').onclick = async () => {
    if (!state.view.selectedNewMembers.length) {
      showToast('لم تختر أي أعضاء', 'warning');
      return;
    }
    try {
      const ids = state.view.selectedNewMembers.map(m => m.id);
      await addGroupMembers(state.view.groupId, ids);
      showToast('تمت إضافة الأعضاء', 'success');
      modal.style.display = 'none';
      await loadGroupData();
      renderMembersList();
    } catch (err) {
      showToast('فشلت الإضافة', 'error');
    }
  };

  modal.querySelector('.modal-close, .modal-cancel')?.addEventListener('click', () => modal.style.display = 'none');
}

function openAddContentModal(type) {
  const modal = document.getElementById('add-content-modal');
  if (!modal) return;

  state.view.selectedContent = [];
  const title = document.getElementById('add-content-title');
  const searchInput = document.getElementById('content-search');
  const suggestionsDiv = document.getElementById('content-suggestions');
  const selectedContainer = document.getElementById('selected-content-list');

  title.textContent = type === 'lesson' ? 'إضافة درس للمجموعة' : 'إضافة امتحان للمجموعة';
  modal.style.display = 'flex';
  renderSelectedContent(selectedContainer, state.view.selectedContent, type);

  let timeout;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(timeout);
    const query = e.target.value.trim();
    if (query.length < 2) {
      suggestionsDiv.classList.remove('active');
      return;
    }
    timeout = setTimeout(async () => {
      const items = type === 'lesson' ? await getAllLessons({}) : await getExams({});
      const filtered = items.filter(item => 
        item.title.toLowerCase().includes(query.toLowerCase()) &&
        !state.view[type === 'lesson' ? 'lessons' : 'exams'].includes(item.id)
      );
      renderContentSuggestions(filtered, suggestionsDiv, (item) => {
        if (!state.view.selectedContent.some(c => c.id === item.id)) {
          state.view.selectedContent.push(item);
          renderSelectedContent(selectedContainer, state.view.selectedContent, type);
        }
        suggestionsDiv.classList.remove('active');
        searchInput.value = '';
      });
    }, GROUPS_CONFIG.DEBOUNCE_DELAY);
  });

  document.getElementById('confirm-add-content').onclick = async () => {
    if (!state.view.selectedContent.length) {
      showToast('لم تختر أي محتوى', 'warning');
      return;
    }
    try {
      const ids = state.view.selectedContent.map(c => c.id);
      await addContentToGroup(state.view.groupId, type, ids);
      showToast('تمت الإضافة', 'success');
      modal.style.display = 'none';
      await loadGroupData();
      if (type === 'lesson') renderLessonsGrid();
      else renderExamsGrid();
    } catch (err) {
      showToast('فشلت الإضافة', 'error');
    }
  };

  modal.querySelector('.modal-close, .modal-cancel')?.addEventListener('click', () => modal.style.display = 'none');
}

function renderContentSuggestions(items, container, onSelect) {
  if (!items?.length) {
    container.classList.remove('active');
    return;
  }
  container.innerHTML = items.map(item => `
    <div class="suggestion-item" data-id="${item.id}">
      <strong>${escapeHtml(item.title)}</strong>
      <small>${item.stage || ''} - الصف ${item.grade || ''}</small>
    </div>
  `).join('');
  container.classList.add('active');
  container.querySelectorAll('.suggestion-item').forEach(el => {
    el.addEventListener('click', () => {
      const item = items.find(i => i.id == el.dataset.id);
      if (item) onSelect(item);
    });
  });
}

function renderSelectedContent(container, items, type) {
  container.innerHTML = items.map(item => `
    <div class="selected-item">
      ${escapeHtml(item.title)}
      <button class="remove-selected" data-id="${item.id}"><i class="fas fa-times"></i></button>
    </div>
  `).join('');
  container.querySelectorAll('.remove-selected').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id);
      const idx = items.findIndex(i => i.id === id);
      if (idx > -1) items.splice(idx, 1);
      renderSelectedContent(container, items, type);
    });
  });
}

// ====== 11. تأكيدات المغادرة والحذف ======
function confirmLeaveGroup() {
  window.modals?.confirm({
    title: 'مغادرة المجموعة',
    message: 'هل أنت متأكد من مغادرة المجموعة؟ لن تتمكن من العودة إلا بدعوة.',
    confirmText: 'مغادرة',
    onConfirm: async () => {
      try {
        await removeGroupMember(state.view.groupId, state.currentUser.id);
        showToast('تمت مغادرة المجموعة', 'success');
        safeNavigate('groups');
      } catch (err) {
        showToast('فشلت المغادرة', 'error');
      }
    }
  });
}

function confirmDeleteGroup() {
  window.modals?.confirm({
    title: 'حذف المجموعة',
    message: 'هل أنت متأكد من حذف المجموعة نهائياً؟ لا يمكن التراجع عن هذا الإجراء.',
    confirmText: 'حذف',
    confirmType: 'danger',
    onConfirm: async () => {
      try {
        await deleteGroup(state.view.groupId);
        showToast('تم حذف المجموعة', 'success');
        safeNavigate('groups');
      } catch (err) {
        showToast('فشل الحذف', 'error');
      }
    }
  });
}

// ====== 12. دوال مساعدة للعرض ======
function showViewLoading(show) {
  const els = state.view.elements;
  if (els.loading) els.loading.style.display = show ? 'flex' : 'none';
  if (els.groupContainer) els.groupContainer.style.display = show ? 'none' : 'block';
}

// ====== 13. تصدير إضافي ======
export { refreshGroupsList };

// تعريض الدوال للـ window للتوافق مع router
window.initGroupsPage = initGroupsPage;
window.initGroupViewPage = initGroupViewPage;
window.cleanupGroupsPage = cleanupGroupsPage;
window.cleanupGroupViewPage = cleanupGroupViewPage;