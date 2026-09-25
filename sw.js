/**
 * 🚀 Service Worker لمنصة بيولوجست v5.0.0 (النسخة المتكاملة النهائية)
 * ============================================================================
 * 📝 المسؤولية: إدارة التخزين المؤقت، دعم العمل دون اتصال (Offline-First)،
 *               وإشعارات Push المتقدمة.
 * 📁 الموقع: الجذر (/) – حسب الهيكل المعماري
 * 🧠 الهندسة:
 *   - استراتيجيات ذكية للتخزين المؤقت (Cache First, Network First, Stale-While-Revalidate).
 *   - إدارة إصدارات المخابئ وتنظيف القديم.
 *   - تكامل مع PWA وإشعارات Push (أزرار تفاعلية).
 *   - دعم RTL واللغة العربية بالكامل.
 *   - متسامح مع فشل بعض الملفات أثناء التثبيت (Promise.allSettled).
 *   - إرجاع استجابة 503 لواجهات الـ API عند عدم الاتصال.
 *   - تحسينات إضافية: تضمين ملفات الـ Views الأساسية، والتحقق من صلاحية الإشعارات.
 * ============================================================================
 */

// ====== الإصدار والثوابت ======
const CACHE_VERSION = 'v5.0.1'; // تم تحديث الإصدار لتطبيق التغييرات
const STATIC_CACHE = `biologist-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `biologist-dynamic-${CACHE_VERSION}`;
const IMAGES_CACHE = `biologist-images-${CACHE_VERSION}`;
const OFFLINE_URL = '/offline.html';
const MAX_CACHE_AGE = 30 * 24 * 60 * 60 * 1000; // 30 يومًا للمخابئ الديناميكية

// ====== الملفات الثابتة التي يتم تخزينها عند التثبيت ======
// تم توسيع القائمة لتشمل ملفات الـ Views الأساسية لتحسين التجربة دون اتصال
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  // ملفات CSS الأساسية
  '/css/variables.css',
  '/css/main.css',
  '/css/layout.css',
  '/css/components.css',
  '/css/animations.css',
  '/css/notifications.css',
  // ملفات CSS الخاصة بالتخطيطات
  '/css/layout/preloader.css',
  '/css/layout/drawer.css',
  '/css/layout/navbar.css',
  '/css/layout/directing.css',
  '/css/layout/modals.css',
  // الثيمات الخمسة
  '/css/themes/theme-blue.css',
  '/css/themes/theme-pink.css',
  '/css/themes/theme-green.css',
  '/css/themes/theme-purple.css',
  '/css/themes/theme-orange.css',
  // ملفات JavaScript الأساسية
  '/js/main.js',
  '/js/core/api.js',
  '/js/core/firebase.js',
  '/js/core/theme.js',
  '/js/core/router.js',
  '/js/core/session.js',
  '/js/core/event-bus.js',
  '/js/ui/animations.js',
  '/js/utils/avatar.js',
  '/js/ui/drawer.js',
  '/js/ui/modals.js',
  '/js/ui/notifications.js',
  '/js/ui/navbar.js',
  '/js/ui/search.js',
  '/js/ui/directing.js',
  // ملفات الـ Views الأساسية (لتحسين الأداء دون اتصال)
  '/views/home/home.html',
  '/views/home/home.css',
  '/views/home/home.js',
  '/views/auth/login.html',
  '/views/auth/register.html',
  '/views/auth/auth.css',
  '/views/auth/auth.js',
  '/views/error/404.html',
  '/views/error/404.css',
  '/views/error/404.js',
  '/views/profile/profile.html',
  '/views/profile/profile.css',
  '/views/profile/profile.js',
  // صور وأصول ثابتة رئيسية
  '/assets/images/biologist.png',
  '/assets/images/biologist1.png',
  '/assets/images/biologist2.png',
  '/assets/images/biologist3.png',
  '/assets/images/biologist4.png',
  '/assets/images/M.png',
  '/assets/images/G.png',
  '/assets/avatars/directing/avatars_directing.png',
  '/assets/avatars/badges/medals.png',
  '/assets/avatars/jobs/avatars_male.png',
  '/assets/avatars/jobs/avatars_female.png'
];

// ====== مسارات يجب تجاهلها من التخزين المؤقت (Firebase, Google APIs) ======
const IGNORE_PATTERNS = [
  /firestore\.googleapis\.com/,
  /firebase\.googleapis\.com/,
  /googleapis\.com/,
  /gstatic\.com/,
  /localhost.*\/__\/firebase/
];

// ====== دوال مساعدة ======
function shouldIgnoreRequest(url) {
  return IGNORE_PATTERNS.some(pattern => pattern.test(url));
}

function isHtmlRequest(request) {
  return request.mode === 'navigate' ||
         request.destination === 'document' ||
         (request.headers.get('accept') && request.headers.get('accept').includes('text/html'));
}

function isApiRequest(url) {
  // الاحتفاظ بها للتوافق، لكن Firestore لا يستخدم /api/
  return url.pathname.startsWith('/api/') || url.pathname.includes('/api/');
}

// ====== تثبيت Service Worker ======
self.addEventListener('install', (event) => {
  console.log('[SW] تثبيت الإصدار', CACHE_VERSION);
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(STATIC_CACHE);
        await Promise.allSettled(
          STATIC_ASSETS.map(async (asset) => {
            try {
              await cache.add(asset);
            } catch (err) {
              console.warn(`[SW] فشل إضافة ${asset}:`, err);
            }
          })
        );
        await self.skipWaiting();
        console.log('[SW] تم التثبيت بنجاح');
      } catch (error) {
        console.error('[SW] فشل التثبيت:', error);
      }
    })()
  );
});

// ====== تنشيط Service Worker وتنظيف المخابئ القديمة ======
self.addEventListener('activate', (event) => {
  console.log('[SW] تنشيط الإصدار', CACHE_VERSION);
  event.waitUntil(
    (async () => {
      // حذف المخابئ القديمة
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== STATIC_CACHE && cacheName !== DYNAMIC_CACHE && cacheName !== IMAGES_CACHE) {
            console.log('[SW] حذف المخبأ القديم:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
      // تنظيف الإدخالات القديمة في المخبأ الديناميكي
      await cleanExpiredCache(DYNAMIC_CACHE);
      await self.clients.claim();
      console.log('[SW] تم التنشيط والسيطرة على الصفحات');
    })()
  );
});

/**
 * تنظيف الإدخالات القديمة من مخبأ معين
 */
async function cleanExpiredCache(cacheName) {
  try {
    const cache = await caches.open(cacheName);
    const requests = await cache.keys();
    const now = Date.now();
    let deletedCount = 0;
    for (const request of requests) {
      const response = await cache.match(request);
      if (response) {
        const dateHeader = response.headers.get('date');
        if (dateHeader) {
          const cachedDate = new Date(dateHeader).getTime();
          if (now - cachedDate > MAX_CACHE_AGE) {
            await cache.delete(request);
            deletedCount++;
          }
        }
      }
    }
    if (deletedCount > 0) {
      console.log(`[SW] تم حذف ${deletedCount} مدخلة قديمة من ${cacheName}`);
    }
  } catch (error) {
    console.warn('[SW] فشل تنظيف المخبأ القديم:', error);
  }
}

// ====== 1. استراتيجية: Cache First مع تحديث في الخلفية (للموارد الثابتة) ======
const cacheFirstWithRefresh = async (request) => {
  const cachedResponse = await caches.match(request);
  const fetchPromise = fetch(request).then(async (networkResponse) => {
    if (networkResponse && networkResponse.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  }).catch(() => undefined);
  return cachedResponse || fetchPromise;
};

// ====== 2. استراتيجية: Network First مع تخزين احتياطي (للصفحات و API) ======
const networkFirst = async (request) => {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) return cachedResponse;

    // إذا كان الطلب لصفحة HTML، نعرض offline.html
    if (isHtmlRequest(request)) {
      return caches.match(OFFLINE_URL);
    }
    // إذا كان الطلب لـ API، نرجع استجابة 503
    if (isApiRequest(new URL(request.url))) {
      return new Response(JSON.stringify({ error: 'غير متصل بالإنترنت' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response('غير متصل بالإنترنت', { status: 503, statusText: 'Service Unavailable' });
  }
};

// ====== 3. استراتيجية: Stale-While-Revalidate (للصور) ======
const staleWhileRevalidate = async (request) => {
  const cachedResponse = await caches.match(request);
  const fetchPromise = fetch(request).then(async (networkResponse) => {
    if (networkResponse && networkResponse.ok) {
      const cache = await caches.open(IMAGES_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  }).catch(() => undefined);
  return cachedResponse || fetchPromise;
};

// ====== معالجة الطلبات ======
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const request = event.request;

  // تجاهل الطلبات التي لا نريد تخزينها (مثل Firebase)
  if (shouldIgnoreRequest(url)) {
    return;
  }

  // استراتيجية للصور (Stale-While-Revalidate)
  if (request.destination === 'image') {
    event.respondWith(staleWhileRevalidate(request));
  }
  // استراتيجية للموارد الثابتة المذكورة في القائمة أو ذات destination style/script/font
  else if (
    STATIC_ASSETS.some(asset => url.pathname === asset) ||
    request.destination === 'style' ||
    request.destination === 'script' ||
    request.destination === 'font'
  ) {
    event.respondWith(cacheFirstWithRefresh(request));
  }
  // استراتيجية لصفحات HTML والـ API (Network First)
  else if (isHtmlRequest(request) || isApiRequest(url)) {
    event.respondWith(networkFirst(request));
  }
  // افتراضي: Cache First مع تحديث (للملفات الأخرى)
  else {
    event.respondWith(cacheFirstWithRefresh(request));
  }
});

// ====== إدارة الإشعارات Push (متطورة) ======
self.addEventListener('push', (event) => {
  if (!event.data) return;

  // التحقق من صلاحية الإشعارات (اختياري)
  if (self.Notification.permission !== 'granted') {
    console.warn('[SW] صلاحية الإشعارات غير مفعلة');
    return;
  }

  let data;
  try {
    data = event.data.json();
  } catch (e) {
    data = { title: 'بيولوجست', body: event.data.text() };
  }

  const options = {
    body: data.body || 'لديك إشعار جديد من منصة بيولوجست',
    icon: '/assets/images/biologist.png',
    badge: '/assets/images/biologist.png',
    vibrate: [200, 100, 200],
    dir: 'rtl',
    lang: 'ar',
    data: {
      url: data.url || '/',
      notificationId: data.notificationId || Date.now()
    },
    actions: [
      { action: 'open', title: 'فتح' },
      { action: 'dismiss', title: 'تجاهل' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'بيولوجست', options)
  );
});

// ====== التعامل مع النقر على الإشعار (مع دعم الأزرار) ======
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const urlToOpen = event.notification.data?.url || '/';

  // التعامل مع أزرار الإشعار
  if (event.action === 'dismiss') {
    return; // إغلاق فقط
  }

  // إذا كان الزر 'open' أو نقر عادي
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url === urlToOpen && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

// ====== التواصل مع الصفحة الرئيسية (مثل SKIP_WAITING و CLEANUP) ======
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEANUP') {
    // تنظيف المخابئ القديمة (بخلاف الحالي) بشكل آمن
    caches.keys().then((cacheNames) => {
      cacheNames.forEach(cacheName => {
        if (cacheName !== STATIC_CACHE && cacheName !== DYNAMIC_CACHE && cacheName !== IMAGES_CACHE) {
          caches.delete(cacheName);
        }
      });
    });
  }
});