📁 نظام الملف الشخصي (Profile System) — المرجع التقني الشامل v5.0.0

تاريخ الإصدار: 2026-06-12
المنصة: بيولوجست التعليمية — Pure JavaScript SPA (بدون أي Framework)
الغرض: مرجع تقني كامل لإنشاء profile.html و profile.js و profile.css المتكاملة مع نظام المنصة، بمستوى احترافي مشابه لأنظمة Udemy / Coursera.
قاعدة البيانات: Firestore فقط — بدون Firebase Authentication.
الحالة: ✅ مرجع ذهبي — يُستخدم كمصدر الحقيقة الوحيد لبناء نظام الملف الشخصي.

---

1. نظرة عامة على نظام الملف الشخصي

الملف الشخصي في بيولوجست ليس مجرد صفحة عرض بيانات، بل هو هوية علمية تفاعلية تعكس رحلة المستخدم التعليمية وإنجازاته وتطوره. يتميز بـ:

· عرض شخصي جذاب: غلاف، صورة رمزية ديناميكية، إطار حسب التقدير، علامة توثيق.
· لوحة إنجازات سريعة: إحصائيات فورية (دروس مكتملة، امتحانات، جوائز، وقت التعلم).
· رحلة التعلم: شريط تقدم المنهج، الوحدات المنجزة، نقاط القوة والضعف.
· مركز الميداليات والجوائز: ميداليات ذهبية/فضية/برونزية تُمنح من المعلم أو تلقائياً.
· عداد الاستمرارية (Streak): عرض الأيام المتتالية مع رسائل تحفيزية.
· تحليل الأداء الدراسي: نقاط القوة والموضوعات التي تحتاج مراجعة.
· سجل النشاط (Timeline): أحدث أنشطة المستخدم على المنصة.
· المفضلة: دروس وملفات محفوظة.
· اختيار الصورة الرمزية (Avatar): واجهة لاختيار وظيفة من 10 خيارات (Sprite Sheet).
· الملف العام: عرض ملف مستخدم آخر بصلاحيات محدودة (اجتماعي تعليمي).
· لوحة احترافية للمعلم والمشرف: إحصائيات التدريس (عدد الطلاب، الدروس، الامتحانات، التقييمات).

---

2. أنواع المستخدمين وصلاحياتهم في الملف الشخصي

المستخدم صلاحيات الملف الشخصي
طالب عرض ملفه الشخصي الكامل، تعديل صورته الرمزية (اختيار وظيفة)، تغيير الثيم، عرض Streak، الإنجازات، الميداليات، سجل النشاط، المفضلة. لا يمكنه رؤية بيانات الطلاب الآخرين إلا في حدود الملف العام (عند زيارة ملف مستخدم آخر).
معلم صلاحيات الطالب + عرض إحصائيات التدريس (عدد الطلاب، الدروس، الامتحانات، التقييمات) + إمكانية تعديل أي ملف طالب (لمدة 5 أيام كحد أقصى) + منح/سحب ميداليات للطلاب.
مشرف صلاحيات المعلم ولكن بصلاحية محدودة في تعديل الطلاب (أيضاً 5 أيام) ولا يمكنه ترقية مشرفين جدد.

ملاحظة: لا يوجد دور "ولي أمر" في النظام.

---

3. تدفق البيانات (Data Flow)

```mermaid
graph LR
    A[api.js - Firestore] --> B[profile.js]
    B --> C[profile.html]
    D[avatar.js] --> B
    E[Router] --> B
    F[EventBus] --> B
    G[session.js] --> B
    H[main.js (Streak)] --> B
```

المسؤوليات:

· api.js: دوال لجلب/تحديث بيانات المستخدم (سيتم إضافتها أو التأكد منها في القسم 7.1).
· profile.js: يتحكم في عرض جميع أقسام الملف الشخصي، تفاعلات المستخدم (تعديل الصورة الرمزية، تغيير الثيم، عرض الميداليات، تحميل المزيد من النشاط)، وإدارة حالة الصفحة.
· avatar.js: مسؤول عن إنشاء وتحديث الصورة الرمزية في كل مكان (يُستخدم في profile.js لإنشاء معرض اختيار الوظائف وعرض الصورة الرمزية الكبيرة).
· router.js: يوجه إلى /profile (ملف المستخدم الحالي) و /profile/:userId (ملف عام لمستخدم آخر).
· main.js: يوفر دوال updateUserStreak و getCurrentUser و toggleTheme (ملاحظة: toggleTheme و setColorTheme موجودان فعلياً في theme.js وتم تعريضهما على window).
· event-bus.js: ينشر أحداث مثل profile:updated, avatar:changed, medal:awarded, streak:updated.
· session.js: يوفر المستخدم الحالي (getCurrentUser) والصلاحيات (isTeacher, isModerator). سنضيف دالة canEditUser.
· notifications.js: سيتم استخدامه لإظهار إشعار عند منح ميدالية أو تعديل بيانات المستخدم.
· modals.js: سيتم استخدامه لعرض نوافذ منبثقة (تأكيد الحذف، اختيار الصورة الرمزية، منح ميدالية).
· theme.js: يدير الثيم العام (فاتح/داكن والثيمات الملونة) وسيتم دمجه بسلاسة.
· animations.js: سيتم استخدامه لتحريك ظهور العناصر (الميداليات، الـ streak، البطاقات).

---

4. هيكل قاعدة البيانات (Firestore)

مجموعة Users — الحقول الخاصة بالملف الشخصي (بالإضافة إلى الحقول الأساسية)

الحقل النوع الوصف
id number معرف فريد رقمي
username string اسم المستخدم (فريد)
full_name string الاسم الكامل
user_type string 'student' / 'teacher' / 'moderator'
gender string 'male' / 'female'
phone string رقم الهاتف (تسجيل الدخول)
password string مشفر SHA‑256 + salt
stage string المرحلة الدراسية ('إعدادي' / 'ثانوي') — للطالب
grade number الصف (1-3) — للطالب
semester string الفصل ('أول' / 'ثاني') — للطالب
total_score number مجموع الدرجات (يُحسب تلقائياً من الامتحانات)
streak number عدد الأيام المتتالية
is_verified boolean توثيق الحساب (للمعلم/المشرف)
avatar_job_index number مؤشر الوظيفة (0-9) لطبقة Sprite
preferred_theme string 'light' / 'dark'
preferred_color_theme string 'blue', 'pink', 'green', 'purple', 'orange'
favorites array<number> قائمة معرفات الدروس المفضلة
badges array<string> قائمة شارات (مثل 'gold_medal', 'silver_medal')
likes_given number عدد الإعجابات التي قام بها
comments_count number عدد التعليقات
last_activity timestamp آخر نشاط (لـ Timeline)
created_at timestamp تاريخ التسجيل
last_login timestamp آخر تسجيل دخول

ملاحظة: باقي الحقول (مثل email, age) اختيارية.

مجموعة User_Progress — تقدم الطالب في الدروس (لحساب الإنجازات)

الحقل النوع الوصف
id number معرف فريد
user_id number معرف الطالب
lesson_id number معرف الدرس
progress number 0-100
completed boolean اكتمل الدرس (progress = 100)
last_accessed timestamp آخر وصول
exam_score number درجة امتحان الدرس (0-100)
total_time_spent number إجمالي الوقت بالثواني

مجموعة Exam_Results — نتائج الامتحانات (لحساب الميداليات)

الحقل النوع الوصف
id number معرف فريد
user_id number معرف الطالب
exam_id number معرف الامتحان (من Biologist_Lessons حيث type='exam')
score number الدرجة المحققة
total_questions number عدد الأسئلة
correct_answers number الإجابات الصحيحة
time_taken number الوقت المستغرق (ثواني)
accuracy number نسبة الدقة
passed boolean نجاح/فشل
date timestamp تاريخ الأداء

مجموعة Notifications — إشعارات النظام (للميداليات والرسائل التحفيزية)

الحقل النوع الوصف
id number معرف فريد
user_id number المستهدف
title string عنوان الإشعار
message string نص الإشعار
type string 'medal', 'streak', 'achievement', 'info'
read boolean حالة القراءة
created_at timestamp تاريخ الإنشاء

مجموعة User_Activity — سجل الأنشطة (Timeline)

الحقل النوع الوصف
id number معرف فريد
user_id number معرف المستخدم
type string 'lesson_completed', 'exam_passed', 'medal_earned', 'comment_added', 'like_given'
title string عنوان مختصر (مثل "أكمل درس الخلية")
description string وصف (اختياري)
related_id number معرف الدرس/الامتحان/الميدالية
timestamp timestamp وقت النشاط

ملاحظة: يمكن حساب سجل النشاط من مصادر متعددة (User_Progress, Exam_Results, Comments, Notifications) بدلاً من Collection منفصلة، لكن وجود User_Activity يسرّع العرض.

---

5. العلاقات بين الكائنات

· المستخدم لديه تقدم في كل درس (User_Progress).
· المستخدم لديه نتائج امتحانات (Exam_Results).
· المستخدم لديه إشعارات (Notifications).
· المستخدم لديه أنشطة (User_Activity).
· المستخدم يمتلك قائمة مفضلة (favorites array في Users).
· المستخدم يمتلك ميداليات (badges array).
· المعلم يمكنه منح ميدالية لطالب (تضاف إلى badges وتُحدث Notification و User_Activity).
· الملف العام لأي مستخدم يُظهر البيانات العامة فقط (الاسم، الصورة، المستوى، الميداليات، الإنجازات العامة) بدون بيانات خاصة (مثل رقم الهاتف، البريد).

---

6. مكونات واجهة المستخدم (UI Components)

6.1 صفحة الملف الشخصي (/profile)

الملفات: views/profile/profile.html, profile.css, profile.js

المسؤوليات:

· عرض بطاقة الشخصية (صورة رمزية كبيرة، اسم، اسم مستخدم، نوع الحساب، علامة التوثيق، المرحلة/الصف).
· عرض الغلاف الشخصي (يتغير حسب الثيم أو مستوى المستخدم).
· عرض مستوى المستخدم وشريط التقدم إلى المستوى التالي.
· عرض لوحة الإنجازات السريعة (دروس مكتملة، امتحانات، جوائز، وقت التعلم).
· عرض قسم "رحلة التعلم" (نسبة إكمال المنهج، الوحدات المنجزة، بحاجة مراجعة).
· عرض "مركز الميداليات والجوائز" (صور الميداليات من medals.png مع وصف لكل ميدالية).
· عرض "عداد الاستمرارية" (Streak) مع رسالة تحفيزية وأطول سلسلة.
· عرض "تحليل الأداء الدراسي" (نقاط القوة، نقاط الضعف مستخلصة من Exam_Results).
· عرض "سجل النشاط" (Timeline مع إمكانية تحميل المزيد pagination).
· عرض "المفضلة" (قائمة الدروس المحفوظة، بطاقات قابلة للنقر).
· عرض قسم "الشخصية والاختيار" (معرض لاختيار الصورة الرمزية من وظائف Sprite Sheet).
· إذا كان المستخدم معلمًا/مشرفًا: عرض إحصائيات التدريس (عدد الطلاب، الدروس، الامتحانات، التقييمات).
· زر "تعديل الملف الشخصي" (للمستخدم نفسه) يفتح مودال لتغيير الصورة الرمزية أو الثيم.

التفاعل مع router: يتم التوجيه إلى /profile لعرض ملف المستخدم الحالي، أو /profile/:userId لعرض ملف عام.

6.2 اختيار الصورة الرمزية (Avatar Picker)

المسؤوليات:

· عرض شبكة من 10 صور رمزية (مشتقة من avatars_male.png أو avatars_female.png حسب جنس المستخدم).
· كل صورة يتم عرضها باستخدام background-position (باستخدام avatar.js لحساب النسب).
· عند النقر على صورة، يتم تحديث avatar_job_index في Firestore وتحديث الصورة الرمزية في كل مكان (Navbar, Sidebar, Profile) عبر updateAvatarElement.
· إظهار تأثير بصري على الصورة المختارة حالياً.

6.3 عرض الميداليات

المسؤوليات:

· استخدام صورة medals.png (1792×592) التي تحتوي على 3 ميداليات مرتبة أفقياً (ذهب، فضة، برونز).
· حساب النسبة المئوية لعرض الميدالية المناسبة عبر background-position (كل ميدالية عرضها 1792/3 ≈ 597.33px).
· عرض كل ميدالية مع وصفها وتاريخ الحصول عليها (مخزّن في badges مع timestamp أو في User_Activity).

6.4 سجل النشاط (Timeline)

المسؤوليات:

· جلب الأنشطة من getUserActivityTimeline مع Pagination (آخر 10 أنشطة، زر تحميل المزيد).
· عرض كل نشاط بأيقونة مناسبة (✅ درس، 🏆 ميدالية، 📝 امتحان، 💬 تعليق).
· تنسيق زمني (اليوم، أمس، الأسبوع الماضي، إلخ).

6.5 المفضلة

المسؤوليات:

· جلب الدروس المفضلة من favorites array في Users.
· عرض بطاقات دروس مشابهة لـ lessons ولكن بشكل مبسط، مع إمكانية إزالة من المفضلة.
· عند النقر على بطاقة درس، التوجيه إلى /lesson/:id.

6.6 الملف العام (Public Profile)

المسؤوليات:

· عند زيارة /profile/:userId (من خلال النقر على صورة مستخدم في التعليقات أو نتائج البحث).
· عرض نفس المكونات ولكن بدون بيانات خاصة (لا تظهر المفضلة، تحليل الأداء، سجل النشاط الكامل، ولا أزرار التعديل).
· يُظهر: الصورة الرمزية، الاسم، نوع الحساب، المستوى، الميداليات العامة، عدد الإنجازات الأساسية (الدروس المكتملة، الامتحانات).
· للمعلم/المشرف: تظهر أزرار "تعديل" (إذا كان لديه صلاحية تعديل هذا المستخدم).

6.7 Lifecycle دوال التهيئة في profile.js

initializePage(container, params) — تهيئة صفحة الملف الشخصي:

1. استخراج userId من params.path.id (إن وُجد) أو استخدام المستخدم الحالي.
2. تخزين مراجع عناصر DOM (cacheElements).
3. إعداد واجهة المستخدم حسب صلاحيات المستخدم (إظهار/إخفاء أزرار التعديل، قسم المعلم).
4. ربط أحداث الصفحة (bindEvents).
5. تحميل بيانات المستخدم (loadUserData).
6. تحميل البيانات الإضافية (الإنجازات، الميداليات، النشاط، المفضلة) بالتوازي.
7. الاشتراك في أحداث EventBus (مثل profile:updated, streak:updated, avatar:changed) لتحديث الأقسام ديناميكياً.

cleanupPage() :

· إلغاء الاشتراك من EventBus.
· إزالة المستمعات (مثل infinite scroll للنشاط).
· إعادة ضبط الحالة.

---

7. التكامل مع الملفات الأخرى

7.1 api.js — الدوال المطلوبة (يجب إضافتها أو التأكد منها)

الدالة الوصف المستخدمة في
getUserProfile(userId) جلب بيانات مستخدم معين (مع حماية الحساسية للمستخدم الآخر) profile.js (loadUserData)
updateUserProfile(userId, updates) تحديث بيانات المستخدم (مثل avatar_job_index, preferred_theme) profile.js (saveAvatar, saveTheme)
getUserStats(userId) إحصائيات سريعة: دروس مكتملة، امتحانات، جوائز، وقت التعلم profile.js (loadStats)
getUserMedals(userId) جلب قائمة الميداليات مع التواريخ والوصف profile.js (loadMedals)
getUserActivityTimeline(userId, limit, lastTimestamp) جلب سجل النشاط مع pagination profile.js (loadTimeline)
getUserFavorites(userId) جلب قائمة الدروس المفضلة (يتم توسيع المعرفات إلى كائنات درس) profile.js (loadFavorites)
getUserStreakHistory(userId) جلب تاريخ Streak (لأطول سلسلة) profile.js (loadStreak)
awardMedalToUser(teacherId, studentId, medalType) منح ميدالية لطالب (تضاف إلى badges) مع إشعار ونشاط للمعلم في profile (في حالة وجود زر منح)
getTeacherStats(teacherId) إحصائيات التدريس (عدد الطلاب، الدروس، الامتحانات، متوسط التقييمات) profile.js (إذا كان المستخدم معلم)
searchUsers(query, userTypeFilter) بحث متقدم (يستخدم في الملف العام عند البحث عن مستخدم) search.js — ولكن يمكن استدعاؤه من profile لعرض روابط سريعة

7.2 router.js — المسارات المطلوبة

```js
// تم تعريفها في ROUTES_CONFIG (موجودة بالفعل)
profile: { path: '/profile', ... }          // الملف الشخصي للمستخدم الحالي
publicProfile: { path: '/profile/:id', ... } // الملف العام لأي مستخدم
```

ملاحظة: عند التوجيه إلى /profile/:id، يجب التحقق من أن المستخدم الحالي لديه صلاحية رؤية هذا الملف (أي مستخدم يمكنه رؤية الملفات العامة، ولكن البيانات الخاصة مخفية تلقائياً بواسطة api.js).

7.3 avatar.js — استخدامه في profile.js

· إنشاء الصورة الرمزية الكبيرة: createAvatarElement(user, 'xl', { showFrame: true, showBadge: true, clickable: false })
· إنشاء معرض اختيار الوظائف: لكل وظيفة index (0-9)، يتم إنشاء عنصر div بتطبيق getAvatarStyle مع avatar_job_index مؤقت.
· تحديث الصورة الرمزية بعد التغيير: استدعاء updateAvatarElement(existingAvatarElement, updatedUser).

7.4 session.js — الحصول على المستخدم الحالي وصلاحياته

· getCurrentUser(): يُستخدم لمعرفة userId الحالي.
· isTeacher(), isModerator(): للتحكم في ظهور أزرار إدارة المعلمين.
· canEditUser(targetUserId): دالة جديدة يجب إضافتها للتحقق من صلاحية تعديل مستخدم آخر (للمعلم/المشرف مع شرط 5 أيام). سيتم تفصيلها في القسم 12.

7.5 event-bus.js — الأحداث المنبعثة من نظام الملف الشخصي

الحدث المُصدر البيانات المرسلة المُستمع
profile:updated profile.js (بعد تحديث البيانات) { userId, updatedFields } navbar.js, drawer.js (لتحديث الصورة والاسم), lessons.js (لتحديث المفضلة)
avatar:changed profile.js (بعد تغيير الوظيفة) { userId, newJobIndex } navbar.js, drawer.js, أي مكون يعرض الصورة
medal:awarded api.js (عند منح ميدالية) { userId, medalType, medalName } profile.js (لتحديث قسم الميداليات), notifications.js (عرض إشعار)
streak:updated main.js (عبر updateUserStreak) { userId, streak, updated } profile.js (تحديث عداد Streak), drawer.js

7.6 main.js — دوال مستخدمة

· updateUserStreak(): يتم استدعاؤها في main.js يومياً، ويمكن لـ profile.js الاستماع لحدث streak:updated.
· toggleTheme() و setColorTheme(): يُستخدمان في صفحة الإعدادات أو من زر تبديل الثيم داخل الملف الشخصي (موجودان في theme.js ومعروضان على window).
· AppStore.getUser(): بديل عن getCurrentUser في بعض السياقات (لكننا نفضل session.js).

7.7 modals.js — لعرض نوافذ منبثقة

· استدعاء window.modals.confirm() لتأكيد حذف مفضلة أو تغيير صورة رمزية.
· استدعاء window.modals.toast() لعرض رسائل نجاح/خطأ.
· استدعاء window.modals.prompt() أو window.modals.bottomSheet() لاختيار الميدالية من قبل المعلم.

7.8 directing.js — الرسائل التوجيهية

· عند فتح الملف الشخصي، يمكن إظهار رسالة ترحيبية (لأول مرة).
· عند الوصول إلى مستوى جديد أو تحقيق Streak معين، تظهر شخصية التوجيه مع رسالة تحفيزية.

---

8. سيناريوهات المستخدم (User Stories)

8.1 الطالب يشاهد ملفه الشخصي

1. يضغط على أيقونة المستخدم في الـ Navbar أو يختار "الملف الشخصي" من القائمة الجانبية.
2. يتم توجيهه إلى /profile.
3. يظهر الغلاف، الصورة الرمزية الكبيرة، الاسم، نوع الحساب (طالب)، المرحلة والصف.
4. يرى مستوى المستخدم (مثل "عالم صغير") وشريط التقدم إلى المستوى التالي.
5. يرى لوحة الإنجازات: عدد الدروس المكتملة، الامتحانات، الجوائز، وقت التعلم.
6. يرى رحلة التعلم: نسبة إكمال المنهج، الوحدات المنجزة، والموضوعات التي تحتاج مراجعة.
7. يرى الميداليات التي حصل عليها (ذهبية/فضية/برونزية).
8. يرى عداد الاستمرارية (Streak) مع رسالة تحفيزية.
9. يرى تحليل الأداء الدراسي (نقاط القوة والضعف).
10. يرى سجل النشاط (آخر 10 أنشطة مع إمكانية تحميل المزيد).
11. يرى قائمة المفضلة (دروس حفظها).
12. يضغط على زر "تعديل الصورة الرمزية" → يفتح معرض الـ 10 وظائف، يختار وظيفة جديدة، تتغير الصورة في كل مكان.
13. يضغط على زر "تعديل الثيم" → يفتح مودال لاختيار الثيم الملون، يتغير التطبيق بالكامل.

8.2 الطالب يزور ملف طالب آخر (الملف العام)

1. يضغط على صورة مستخدم في قسم التعليقات (أو من نتائج البحث).
2. يتم توجيهه إلى /profile/123.
3. يظهر الغلاف (العام)، الصورة الرمزية، الاسم، نوع الحساب، المستوى.
4. يظهر عدد الإنجازات الأساسية (مثل الدروس المكتملة، الميداليات).
5. لا يظهر: المفضلة، تحليل الأداء، سجل النشاط الكامل، Streak الحالي، الإعدادات.
6. يستطيع فقط رؤية الميداليات التي حصل عليها الطالب الآخر.

8.3 المعلم يرى ملفه الشخصي (كمدرس)

1. نفس واجهة الطالب ولكن بالإضافة إلى:
   · قسم "إحصائيات التدريس": عدد الطلاب المسجلين في مجموعاته، عدد الدروس التي أنشأها، عدد الامتحانات، متوسط تقييم الطلاب (نجوم).
   · ظهور أزرار "منح ميدالية" بجانب أسماء الطلاب في قسم سجل النشاط (إن كان النشاط متعلقاً بطالب).
   · ظهور زر "بحث عن طالب" في الـ Navbar (موجود أصلاً في search.js).

8.4 المعلم يمنح ميدالية لطالب

1. من ملفه الشخصي، يذهب إلى قسم سجل النشاط أو يبحث عن طالب.
2. يضغط على زر "منح ميدالية" بجانب إنجاز الطالب.
3. يظهر مودال لاختيار نوع الميدالية (ذهب/فضة/برونز) وسبب المنح.
4. يتم استدعاء api.awardMedalToUser.
5. يُضاف نوع الميدالية إلى badges array للطالب، ويُضاف نشاط جديد في User_Activity، ويُرسل إشعار للطالب.
6. يتم تحديث قسم الميداليات في ملف الطالب فوراً (عبر EventBus).

8.5 المشرف يعدل ملف طالب (في غضون 5 أيام)

1. يبحث عن طالب (عبر search.js) ويفتح ملفه العام.
2. يظهر له زر "تعديل" (لأنه مشرف ولديه صلاحية التعديل).
3. يضغط على الزر، يفتح مودال يمكنه من تغيير (المرحلة، الصف، الفصل، إعادة تعيين Streak، تعديل الصورة الرمزية).
4. يتم حفظ التغييرات عبر updateUserProfile مع التحقق من صلاحية التعديل (يجب أن يكون تاريخ آخر تعديل قبل ≤ 5 أيام من اليوم).
5. يتم إرسال إشعار للطالب بتعديل بياناته.

---

9. خوارزميات مهمة (Algorithms)

9.1 حساب مستوى المستخدم وشريط التقدم

```js
// تعريف المستويات (مثال)
const LEVELS = [
  { name: '🌱 مستكشف علوم', minScore: 0, maxScore: 199 },
  { name: '🔬 باحث أحياء', minScore: 200, maxScore: 399 },
  { name: '🧬 عالم صغير', minScore: 400, maxScore: 599 },
  { name: '🏅 خبير بيولوجي', minScore: 600, maxScore: 799 },
  { name: '🧪 عبقري علوم', minScore: 800, maxScore: Infinity }
];

function getUserLevelAndProgress(user) {
  const totalScore = user.total_score || 0;
  const currentLevel = LEVELS.find(l => totalScore >= l.minScore && totalScore <= l.maxScore);
  const nextLevel = LEVELS[LEVELS.indexOf(currentLevel) + 1];
  if (!nextLevel) return { level: currentLevel.name, progress: 100 };
  const pointsNeeded = nextLevel.minScore - currentLevel.minScore;
  const pointsEarned = totalScore - currentLevel.minScore;
  const progress = Math.min(100, Math.floor((pointsEarned / pointsNeeded) * 100));
  return { level: currentLevel.name, progress, remainingPoints: pointsNeeded - pointsEarned };
}
```

9.2 حساب الإنجازات السريعة (Stats)

```js
async function computeUserStats(userId) {
  // دروس مكتملة
  const progressSnap = await db.collection('User_Progress')
    .where('user_id', '==', userId)
    .where('completed', '==', true)
    .get();
  const completedLessons = progressSnap.size;

  // امتحانات أدّاها (نتائج فريدة لكل exam_id)
  const examResultsSnap = await db.collection('Exam_Results')
    .where('user_id', '==', userId)
    .get();
  const uniqueExams = new Set(examResultsSnap.docs.map(d => d.data().exam_id));
  const examsTaken = uniqueExams.size;

  // جوائز (عدد الميداليات)
  const userDoc = await db.collection('Users').doc(String(userId)).get();
  const medalsCount = (userDoc.data().badges || []).length;

  // وقت التعلم (إجمالي time_spent من User_Progress)
  let totalTimeSpent = 0;
  progressSnap.forEach(doc => { totalTimeSpent += doc.data().total_time_spent || 0; });

  return { completedLessons, examsTaken, medalsCount, totalTimeSpent };
}
```

9.3 حساب نقاط القوة والضعف (من Exam_Results)

```js
// نحتاج إلى ربط نتائج الامتحانات بالموضوعات (مثلاً عن طريق lesson_id -> lesson -> unit -> subject)
// بافتراض وجود دالة getLessonSubjects(lessonId) تعيد قائمة بالموضوعات (مثل "الوراثة", "الخلية")
async function computeStrengthWeakness(userId) {
  const examResults = await db.collection('Exam_Results')
    .where('user_id', '==', userId)
    .where('passed', '==', true)
    .get();
  const subjectScores = {}; // subject -> { total, count }
  for (const doc of examResults.docs) {
    const result = doc.data();
    const examDoc = await db.collection('Biologist_Lessons').doc(String(result.exam_id)).get();
    const lessonId = examDoc.data().lesson_id; // إذا كان الامتحان مرتبطاً بدرس
    if (lessonId) {
      const subjects = await getLessonSubjects(lessonId);
      subjects.forEach(subject => {
        if (!subjectScores[subject]) subjectScores[subject] = { total: 0, count: 0 };
        subjectScores[subject].total += result.accuracy;
        subjectScores[subject].count++;
      });
    }
  }
  const strengths = [], weaknesses = [];
  for (const [subject, data] of Object.entries(subjectScores)) {
    const avg = data.total / data.count;
    if (avg >= 80) strengths.push(subject);
    else if (avg < 60) weaknesses.push(subject);
  }
  return { strengths, weaknesses };
}
```

9.4 حساب أطول سلسلة (Streak)

```js
function getLongestStreak(streakHistory) {
  // streakHistory: array من الأيام المتتالية (مثال: [1,2,3,1,2,3,4] -> أطول 4)
  let maxStreak = 0, currentStreak = 0;
  for (const day of streakHistory) {
    if (day === 1) currentStreak = 1;
    else if (day === currentStreak + 1) currentStreak++;
    else currentStreak = 1;
    maxStreak = Math.max(maxStreak, currentStreak);
  }
  return maxStreak;
}
```

9.5 Pagination في سجل النشاط

```js
// في profile.js
async function loadMoreActivities() {
  if (state.loadingMore) return;
  state.loadingMore = true;
  const lastTimestamp = state.lastActivityTimestamp;
  const newActivities = await api.getUserActivityTimeline(state.userId, 10, lastTimestamp);
  if (newActivities.length) {
    renderActivities(newActivities, true); // append
    state.lastActivityTimestamp = newActivities[newActivities.length-1].timestamp;
  } else {
    state.hasMoreActivities = false;
    document.getElementById('load-more-activities')?.remove();
  }
  state.loadingMore = false;
}
```

---

أ. محمد إبراهيم طه – فريق بيولوجست
الإصدار 5.0.0 – تحديث 2026-06-12

