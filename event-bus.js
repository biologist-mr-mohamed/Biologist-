/**
 * 🚌 js/core/event-bus.js - نظام Event Bus المركزي v5.0.0 (Enterprise Edition)
 * ============================================================================
 * 📝 المسؤولية: ناقل أحداث مركزي للتواصل غير المباشر بين مكونات المنصة.
 * 🧠 الهندسة:
 *   - Pure JavaScript (بدون أي أطر عمل).
 *   - نمط Publish/Subscribe مع دعم الأولويات و Interceptors.
 *   - إدارة ذكية للمستمعين مع تحذيرات عند تجاوز الحد الأقصى.
 *   - دعم الاشتراك لمرة واحدة (once) و Wildcard (*) و Regex.
 *   - تكامل مع ErrorTracker العالمي وإصدار أحداث الخطأ.
 *   - متكامل مع main.js، router.js، وباقي وحدات المنصة.
 *   - دعم RTL كامل في التعليقات.
 * ============================================================================
 */

// ====== 1. الثوابت والتكوين ======
const EVENT_BUS_CONFIG = {
  MAX_LISTENERS_PER_EVENT: 25,       // الحد الأقصى للمستمعين لكل حدث (قابل للتعديل)
  WARN_ON_MAX_LISTENERS: true,       // إظهار تحذير عند تجاوز الحد
  THROW_ON_ERROR: false,             // هل نرمي استثناء عند حدوث خطأ في معالج الحدث؟
  DEBUG: false,                      // وضع التصحيح (يمكن تغييره من الخارج)
  DEFAULT_PRIORITY: 0,               // الأولوية الافتراضية للمستمعين (كلما زاد الرقم، نُفذ أولاً)
  EMIT_TIMEOUT_DEFAULT: 5000,        // المهلة الافتراضية لـ emitWithTimeout (مللي ثانية)
  ERROR_EVENT_NAME: 'event-bus:error', // اسم الحدث الذي يُصدر عند حدوث خطأ في مستمع
  OFFLINE_QUEUE_ENABLED: true,       // تفعيل تخزين الأحداث دون اتصال
  OFFLINE_RETRY_INTERVAL: 30000,     // إعادة محاولة الأحداث المعلقة كل 30 ثانية
  MAX_OFFLINE_QUEUE_SIZE: 100,       // الحد الأقصى لحجم طابور الأحداث دون اتصال
  EVENT_HISTORY_LIMIT: 500,          // عدد الأحداث المسجلة في التاريخ
  AUTO_CLEANUP_ON_ROUTE_CHANGE: true, // تنظيف المستمعين تلقائياً عند تغيير المسار
  MEMORY_LEAK_THRESHOLD: 50          // عدد المستمعين الإجمالي الذي يسبب تحذير تسرب الذاكرة
};

// ====== 2. الحالة الداخلية ======
const events = new Map();                // eventName -> Map (callback -> { priority, once, context })
const listenersCount = new Map();        // eventName -> number (لتحسين الأداء)
const onceWrappers = new WeakMap();      // callback -> wrapper (لإدارة `once`)
const interceptors = [];                 // مصفوفة من دوال الاعتراض (interceptors)
let offlineQueue = [];                   // طابور الأحداث أثناء عدم الاتصال
let isProcessingOfflineQueue = false;
let globalMaxListeners = EVENT_BUS_CONFIG.MAX_LISTENERS_PER_EVENT;
let debugMode = EVENT_BUS_CONFIG.DEBUG;
let eventHistory = [];                   // سجل الأحداث للتصحيح
let totalListenersCount = 0;             // إجمالي عدد المستمعين (لمراقبة التسرب)

// ====== 3. سجل الأحداث (Event History) ======
function addToHistory(event, args, duration, listenerCount, error = null) {
  if (!debugMode && !localStorage.getItem('event_bus_debug')) return;
  const historyEntry = {
    event,
    args: args.map(arg => {
      // تجنب تخزين الكائنات الضخمة
      if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.stringify(arg).slice(0, 200);
        } catch {
          return '[Complex Object]';
        }
      }
      return arg;
    }),
    duration: duration ? `${duration.toFixed(2)}ms` : 'N/A',
    listenerCount,
    timestamp: Date.now(),
    error: error ? error.message : null
  };
  eventHistory.unshift(historyEntry);
  if (eventHistory.length > EVENT_BUS_CONFIG.EVENT_HISTORY_LIMIT) {
    eventHistory.pop();
  }
}

// ====== 4. دوال مساعدة داخلية ======

/**
 * إنشاء دالة مغلفة لاستخدامها في `once`
 * @param {string} event - اسم الحدث
 * @param {Function} callback - دالة المستمع الأصلية
 * @returns {Function} دالة مغلفة تقوم بإلغاء الاشتراك تلقائياً بعد أول استدعاء
 */
function createOnceWrapper(event, callback) {
  const wrapper = (...args) => {
    EventBus.off(event, wrapper);
    callback(...args);
  };
  onceWrappers.set(callback, wrapper);
  return wrapper;
}

/**
 * التحقق من الحد الأقصى للمستمعين وإصدار تحذير إذا لزم الأمر
 * @param {string} event - اسم الحدث
 */
function checkMaxListeners(event) {
  if (!EVENT_BUS_CONFIG.WARN_ON_MAX_LISTENERS) return;
  
  const currentCount = listenersCount.get(event) || 0;
  if (currentCount >= globalMaxListeners) {
    console.warn(
      `[EventBus] ⚠️ تم تجاوز الحد الأقصى للمستمعين للحدث "${event}" ` +
      `(${currentCount}/${globalMaxListeners}). ` +
      `قد يشير ذلك إلى تسرب في الذاكرة.`
    );
    // إصدار حدث تحذيري للتصحيح
    EventBus.emit('event-bus:max-listeners-warning', { event, count: currentCount });
  }
  
  // مراقبة تسرب الذاكرة الإجمالي
  if (totalListenersCount > EVENT_BUS_CONFIG.MEMORY_LEAK_THRESHOLD) {
    console.warn(
      `[EventBus] ⚠️ إجمالي المستمعين مرتفع: ${totalListenersCount}. ` +
      `قد يكون هناك تسرب للذاكرة. استخدم getStats() للتحقق.`
    );
  }
}

/**
 * تنفيذ جميع المستمعين لحدث معين بترتيب الأولويات
 * @param {string} event - اسم الحدث
 * @param {Array} args - المعاملات
 * @returns {Promise<Array>} مصفوفة بنتائج التنفيذ (للاستخدام في emitAsync)
 */
async function executeListeners(event, args) {
  if (!events.has(event)) return [];
  
  // الحصول على خريطة المستمعين (callback -> listenerObject) وتحويلها إلى مصفوفة مرتبة حسب الأولوية
  const listenersMap = events.get(event);
  const sortedCallbacks = Array.from(listenersMap.entries())
    .sort((a, b) => b[1].priority - a[1].priority)   // ترتيب تنازلي (الأولوية الأعلى أولاً)
    .map(entry => ({ callback: entry[0], listener: entry[1] }));
  
  const results = [];
  for (const { callback, listener } of sortedCallbacks) {
    // إذا كان المستمع مرة واحدة، نزيله قبل التنفيذ (لمنع التنفيذ إذا حدث خطأ)
    if (listener.once) {
      EventBus.off(event, callback);
    }
    try {
      const result = callback(...args);
      results.push(result);
      // إذا كانت النتيجة Promise، نتعامل معها في emitAsync
    } catch (error) {
      console.error(`[EventBus] ❌ خطأ في معالج الحدث "${event}":`, error);
      
      // إرسال حدث الخطأ للنظام
      EventBus.emit(EVENT_BUS_CONFIG.ERROR_EVENT_NAME, { event, error, args });
      
      // تسجيل الخطأ في ErrorTracker العالمي إن وُجد
      if (typeof window !== 'undefined' && window.ErrorTracker && window.ErrorTracker.capture) {
        window.ErrorTracker.capture(error, { context: `event-bus:${event}`, args });
      }
      
      // إضافة الخطأ للسجل
      addToHistory(event, args, null, sortedCallbacks.length, error);
      
      if (EVENT_BUS_CONFIG.THROW_ON_ERROR) {
        throw error;
      }
      results.push(Promise.reject(error));
    }
  }
  return results;
}

/**
 * تطبيق الـ Interceptors على البيانات قبل الإرسال
 * @param {string} event - اسم الحدث
 * @param {Array} args - المعاملات
 * @returns {Array} المعاملات بعد التعديل
 */
function applyInterceptors(event, args) {
  let modifiedArgs = [...args];
  for (const interceptor of interceptors) {
    try {
      const result = interceptor(event, modifiedArgs);
      if (Array.isArray(result)) {
        modifiedArgs = result;
      } else if (result !== undefined) {
        modifiedArgs = [result];
      }
    } catch (error) {
      console.warn(`[EventBus] Interceptor فشل:`, error);
    }
  }
  return modifiedArgs;
}

/**
 * مطابقة النمط (wildcard) مع اسم الحدث
 * @param {string} pattern - النمط (مثل "auth:*" أو "*" أو "**")
 * @param {string} event - اسم الحدث الفعلي
 * @returns {boolean}
 */
function matchesPattern(pattern, event) {
  if (pattern === '*') return true;
  if (pattern.endsWith(':*')) {
    const namespace = pattern.slice(0, -2);
    return event.startsWith(namespace + ':');
  }
  if (pattern === '**') return true;
  if (pattern.includes('*')) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(event);
  }
  return pattern === event;
}

/**
 * معالجة الأحداث في طابور دون اتصال (Offline Queue)
 */
async function processOfflineQueue() {
  if (!EVENT_BUS_CONFIG.OFFLINE_QUEUE_ENABLED) return;
  if (!navigator.onLine) return;
  if (isProcessingOfflineQueue) return;
  if (offlineQueue.length === 0) return;
  
  isProcessingOfflineQueue = true;
  const queueCopy = [...offlineQueue];
  offlineQueue = [];
  
  for (const item of queueCopy) {
    try {
      await EventBus.emitWithTimeout(item.event, item.timeout || EVENT_BUS_CONFIG.EMIT_TIMEOUT_DEFAULT, ...item.args);
      if (debugMode) console.log(`[EventBus] ✅ تم إعادة إرسال حدث دون اتصال: ${item.event}`);
    } catch (error) {
      console.error(`[EventBus] ❌ فشل إعادة إرسال الحدث ${item.event} بعد الاتصال:`, error);
      // إعادة إضافة الحدث إلى الطابور إذا كان عدد المحاولات أقل من الحد الأقصى
      if (item.retries && item.retries < (item.maxRetries || 3)) {
        offlineQueue.push({ ...item, retries: (item.retries || 0) + 1 });
      } else if (!item.retries) {
        offlineQueue.push({ ...item, retries: 1, maxRetries: 3 });
      } else {
        console.warn(`[EventBus] تم التخلي عن الحدث ${item.event} بعد فشل المحاولات`);
        addToHistory(item.event, item.args, null, 0, new Error('انتهت محاولات إعادة الإرسال'));
      }
    }
  }
  isProcessingOfflineQueue = false;
  if (offlineQueue.length > 0) {
    setTimeout(processOfflineQueue, EVENT_BUS_CONFIG.OFFLINE_RETRY_INTERVAL);
  }
}

// مراقبة حالة الاتصال تلقائياً
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (debugMode) console.log('[EventBus] الاتصال عاد، معالجة طابور الأحداث...');
    processOfflineQueue();
  });
  window.addEventListener('offline', () => {
    if (debugMode) console.log('[EventBus] فقد الاتصال، سيتم تخزين الأحداث مؤقتاً');
  });
}

// ====== 5. واجهة EventBus العامة ======
const EventBus = {
  /**
   * تعيين وضع التصحيح
   * @param {boolean} enabled - تفعيل/تعطيل التصحيح
   */
  setDebug(enabled) {
    debugMode = !!enabled;
    if (enabled) {
      console.log('[EventBus] وضع التصحيح مفعل (سيتم تسجيل كل حدث ووقت التنفيذ)');
    } else {
      console.log('[EventBus] وضع التصحيح معطل');
    }
  },
  
  /**
   * تعيين الحد الأقصى للمستمعين لكل حدث
   * @param {number} limit - الحد الأقصى
   */
  setMaxListeners(limit) {
    if (typeof limit === 'number' && limit > 0) {
      globalMaxListeners = limit;
    }
  },
  
  /**
   * الاشتراك في حدث معين (يدعم الأولوية والنمط)
   * @param {string} event - اسم الحدث (يدعم Wildcard * و Regex)
   * @param {Function} callback - دالة المستمع
   * @param {Object} options - { priority, once, context }
   * @returns {Function} دالة إلغاء الاشتراك
   */
  on(event, callback, options = {}) {
    if (typeof event !== 'string') {
      throw new TypeError('[EventBus] اسم الحدث يجب أن يكون نصياً');
    }
    if (typeof callback !== 'function') {
      throw new TypeError('[EventBus] callback يجب أن يكون دالة');
    }
    
    const priority = options.priority ?? EVENT_BUS_CONFIG.DEFAULT_PRIORITY;
    const once = options.once || false;
    const context = options.context || null;
    
    // دعم الأنماط العامة: نستخدم Map منفصل للأنماط للبحث السريع
    // نقوم بتخزين المستمع في خريطة تحت اسم الحدث الأصلي (للتيسير)،
    // لكن سنقوم لاحقاً في emit بالبحث عبر جميع الأنماط
    
    if (!events.has(event)) {
      events.set(event, new Map());
      listenersCount.set(event, 0);
    }
    
    const callbacksMap = events.get(event);
    
    // تجنب إضافة نفس callback مرتين
    if (callbacksMap.has(callback)) {
      console.warn(`[EventBus] callback مسجل مسبقاً للحدث "${event}"`);
      return () => EventBus.off(event, callback);
    }
    
    callbacksMap.set(callback, { priority, once, context });
    listenersCount.set(event, callbacksMap.size);
    totalListenersCount++;
    
    checkMaxListeners(event);
    
    // إرجاع دالة إلغاء الاشتراك للراحة
    return () => EventBus.off(event, callback);
  },
  
  /**
   * الاشتراك لمرة واحدة فقط (يتم إلغاء الاشتراك تلقائياً بعد أول إرسال)
   * @param {string} event - اسم الحدث
   * @param {Function} callback - دالة المستمع
   * @param {Object} options - { priority, context }
   * @returns {Function} دالة إلغاء الاشتراك
   */
  once(event, callback, options = {}) {
    const wrapper = createOnceWrapper(event, callback);
    return EventBus.on(event, wrapper, { ...options, once: true });
  },
  
  /**
   * إلغاء الاشتراك من حدث معين
   * @param {string} event - اسم الحدث
   * @param {Function} callback - دالة المستمع المراد إزالتها
   */
  off(event, callback) {
    if (!events.has(event)) return;
    
    const callbacksMap = events.get(event);
    
    // البحث عن callback الأصلي أو المغلف (في حالة once)
    let targetCallback = callback;
    if (onceWrappers.has(callback)) {
      targetCallback = onceWrappers.get(callback);
    }
    
    if (callbacksMap.delete(targetCallback)) {
      const newCount = callbacksMap.size;
      listenersCount.set(event, newCount);
      totalListenersCount--;
      
      // تنظيف: إذا لم يعد هناك مستمعين، نحذف الحدث بالكامل
      if (newCount === 0) {
        events.delete(event);
        listenersCount.delete(event);
      }
      
      // تنظيف onceWrappers إذا كانت callback الأصلية
      if (onceWrappers.has(callback)) {
        onceWrappers.delete(callback);
      }
    }
  },
  
  /**
   * إلغاء جميع المستمعين لحدث معين أو لجميع الأحداث
   * @param {string} [event] - اسم الحدث (اختياري)
   */
  clear(event) {
    if (event) {
      if (events.has(event)) {
        const callbacksMap = events.get(event);
        totalListenersCount -= callbacksMap.size;
        events.delete(event);
        listenersCount.delete(event);
      }
    } else {
      events.clear();
      listenersCount.clear();
      totalListenersCount = 0;
      onceWrappers.clear();
    }
  },
  
  /**
   * إرسال حدث مع بيانات اختيارية (تطبق الـ Interceptors)
   * @param {string} event - اسم الحدث
   * @param {...any} args - المعاملات التي ستمرر للمستمعين
   */
  emit(event, ...args) {
    // دعم الأنماط العامة: البحث عن جميع الأحداث المسجلة التي تطابق النمط
    let matchedEvents = [event];
    if (event.includes('*')) {
      // إذا كان الإرسال بنمط (مثل "auth:*")، فهذا نادر؛ نتعامل معه بشكل طبيعي
      matchedEvents = [event];
    } else {
      // البحث عن الأنماط المسجلة التي تطابق هذا الحدث
      for (const registeredEvent of events.keys()) {
        if (registeredEvent !== event && matchesPattern(registeredEvent, event)) {
          matchedEvents.push(registeredEvent);
        }
      }
    }
    
    const startTime = debugMode ? performance.now() : null;
    let listenerCountTotal = 0;
    
    for (const ev of matchedEvents) {
      if (!events.has(ev)) continue;
      const modifiedArgs = applyInterceptors(ev, args);
      const callbacksMap = events.get(ev);
      listenerCountTotal += callbacksMap.size;
      
      // ترتيب حسب الأولوية وتنفيذ
      const sorted = Array.from(callbacksMap.entries())
        .sort((a, b) => b[1].priority - a[1].priority);
      
      for (const [cb, listener] of sorted) {
        // إذا كان once، نزيله قبل التنفيذ (لتجنب التنفيذ المتكرر في حالة وجود أنماط متعددة)
        if (listener.once) {
          EventBus.off(ev, cb);
        }
        try {
          // ربط context إذا كان موجوداً
          if (listener.context) {
            cb.apply(listener.context, modifiedArgs);
          } else {
            cb(...modifiedArgs);
          }
        } catch (error) {
          console.error(`[EventBus] ❌ خطأ في معالج الحدث "${ev}":`, error);
          EventBus.emit(EVENT_BUS_CONFIG.ERROR_EVENT_NAME, { event: ev, error, args: modifiedArgs });
          if (typeof window !== 'undefined' && window.ErrorTracker?.capture) {
            window.ErrorTracker.capture(error, { context: `event-bus:${ev}`, args: modifiedArgs });
          }
          addToHistory(ev, modifiedArgs, null, callbacksMap.size, error);
          if (EVENT_BUS_CONFIG.THROW_ON_ERROR) throw error;
        }
      }
    }
    
    if (startTime !== null) {
      const duration = performance.now() - startTime;
      addToHistory(event, args, duration, listenerCountTotal);
      if (debugMode) {
        console.log(`[EventBus] 📡 حدث: ${event} | مستمعين: ${listenerCountTotal} | الزمن: ${duration.toFixed(2)}ms`);
      }
    }
    
    // إذا كان غير متصل وخيار الطابور مفعلاً، نخزن الحدث مؤقتاً (لأحداث غير حرجة)
    if (EVENT_BUS_CONFIG.OFFLINE_QUEUE_ENABLED && !navigator.onLine && !event.startsWith('offline-')) {
      if (offlineQueue.length < EVENT_BUS_CONFIG.MAX_OFFLINE_QUEUE_SIZE) {
        offlineQueue.push({ event, args, timeout: EVENT_BUS_CONFIG.EMIT_TIMEOUT_DEFAULT, retries: 0, maxRetries: 3 });
        if (debugMode) console.log(`[EventBus] 📦 تم تخزين الحدث "${event}" في طابور دون اتصال`);
      } else {
        console.warn(`[EventBus] تم تجاوز حجم طابور الأحداث دون اتصال، تم تجاهل الحدث "${event}"`);
      }
    }
  },
  
  /**
   * إرسال حدث مع مهلة زمنية للانتظار (Promise)
   * @param {string} event - اسم الحدث
   * @param {number} timeout - المهلة بالمللي ثانية (افتراضي 5000)
   * @param {...any} args - المعاملات
   * @returns {Promise<Array>} مصفوفة بنتائج المستمعين
   */
  async emitWithTimeout(event, timeout = EVENT_BUS_CONFIG.EMIT_TIMEOUT_DEFAULT, ...args) {
    // دعم الأنماط بنفس طريقة emit
    let matchedEvents = [event];
    if (!event.includes('*')) {
      for (const registeredEvent of events.keys()) {
        if (registeredEvent !== event && matchesPattern(registeredEvent, event)) {
          matchedEvents.push(registeredEvent);
        }
      }
    }
    
    const startTime = performance.now();
    const allPromises = [];
    
    for (const ev of matchedEvents) {
      if (!events.has(ev)) continue;
      const modifiedArgs = applyInterceptors(ev, args);
      const callbacksMap = events.get(ev);
      const sorted = Array.from(callbacksMap.entries())
        .sort((a, b) => b[1].priority - a[1].priority);
      
      for (const [cb, listener] of sorted) {
        if (listener.once) EventBus.off(ev, cb);
        try {
          const result = listener.context ? cb.apply(listener.context, modifiedArgs) : cb(...modifiedArgs);
          allPromises.push(result instanceof Promise ? result : Promise.resolve(result));
        } catch (error) {
          allPromises.push(Promise.reject(error));
          EventBus.emit(EVENT_BUS_CONFIG.ERROR_EVENT_NAME, { event: ev, error, args: modifiedArgs });
        }
      }
    }
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`انتهت مهلة الحدث "${event}" بعد ${timeout} مللي ثانية`)), timeout);
    });
    
    try {
      const results = await Promise.race([Promise.all(allPromises), timeoutPromise]);
      const duration = performance.now() - startTime;
      addToHistory(event, args, duration, allPromises.length);
      return results;
    } catch (error) {
      addToHistory(event, args, performance.now() - startTime, allPromises.length, error);
      throw error;
    }
  },
  
  /**
   * إرسال حدث وانتظار الـ Promises من المستمعين (إذا عادوا بـ Promise)
   * @param {string} event - اسم الحدث
   * @param {...any} args - المعاملات
   * @returns {Promise<Array>} مصفوفة بنتائج المستمعين (حالة fulfilled/rejected)
   */
  async emitAsync(event, ...args) {
    let matchedEvents = [event];
    if (!event.includes('*')) {
      for (const registeredEvent of events.keys()) {
        if (registeredEvent !== event && matchesPattern(registeredEvent, event)) {
          matchedEvents.push(registeredEvent);
        }
      }
    }
    
    const startTime = performance.now();
    const promises = [];
    
    for (const ev of matchedEvents) {
      if (!events.has(ev)) continue;
      const modifiedArgs = applyInterceptors(ev, args);
      const callbacksMap = events.get(ev);
      const sorted = Array.from(callbacksMap.entries())
        .sort((a, b) => b[1].priority - a[1].priority);
      
      for (const [cb, listener] of sorted) {
        if (listener.once) EventBus.off(ev, cb);
        try {
          const result = listener.context ? cb.apply(listener.context, modifiedArgs) : cb(...modifiedArgs);
          promises.push(result);
        } catch (error) {
          promises.push(Promise.reject(error));
          EventBus.emit(EVENT_BUS_CONFIG.ERROR_EVENT_NAME, { event: ev, error, args: modifiedArgs });
        }
      }
    }
    
    const settled = await Promise.allSettled(promises);
    const duration = performance.now() - startTime;
    addToHistory(event, args, duration, promises.length);
    return settled;
  },
  
  /**
   * انتظار حدث معين وإرجاع Promise (للاستخدام في async/await)
   * @param {string} event - اسم الحدث
   * @param {number} timeout - المهلة بالمللي ثانية (اختياري)
   * @returns {Promise<any>} وعد يتحقق عند أول إصدار للحدث
   */
  waitFor(event, timeout = null) {
    return new Promise((resolve, reject) => {
      let timeoutId = null;
      const handler = (...args) => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve(args.length === 1 ? args[0] : args);
      };
      EventBus.once(event, handler);
      if (timeout !== null && timeout > 0) {
        timeoutId = setTimeout(() => {
          EventBus.off(event, handler);
          reject(new Error(`انتهت مهلة انتظار الحدث "${event}" بعد ${timeout} مللي ثانية`));
        }, timeout);
      }
    });
  },
  
  /**
   * الحصول على عدد المستمعين لحدث معين
   * @param {string} event - اسم الحدث
   * @returns {number} عدد المستمعين
   */
  listenerCount(event) {
    return listenersCount.get(event) || 0;
  },
  
  /**
   * الحصول على أسماء جميع الأحداث المسجلة
   * @returns {string[]} مصفوفة بأسماء الأحداث
   */
  eventNames() {
    return Array.from(events.keys());
  },
  
  /**
   * الحصول على إحصائيات النظام (لأغراض المراقبة)
   * @returns {Object} إحصائيات مفصلة
   */
  getStats() {
    const totalListeners = totalListenersCount;
    const eventsDetails = {};
    for (const [eventName, callbacksMap] of events.entries()) {
      eventsDetails[eventName] = {
        listenersCount: callbacksMap.size,
        priorities: Array.from(callbacksMap.values()).map(v => v.priority)
      };
    }
    
    return {
      totalEvents: events.size,
      totalListeners,
      interceptorsCount: interceptors.length,
      maxListenersConfig: globalMaxListeners,
      offlineQueueSize: offlineQueue.length,
      eventHistorySize: eventHistory.length,
      events: eventsDetails
    };
  },
  
  /**
   * الحصول على سجل الأحداث (للتتبع)
   * @returns {Array} سجل الأحداث
   */
  getEventHistory() {
    return [...eventHistory];
  },
  
  /**
   * مسح سجل الأحداث
   */
  clearEventHistory() {
    eventHistory = [];
  },
  
  /**
   * إضافة Interceptor (دالة تعترض الحدث قبل وصوله للمستمعين)
   * @param {Function} interceptor - دالة تأخذ (event, args) وتعيد args معدلة (أو مصفوفة)
   * @returns {Function} دالة لإزالة الـ interceptor
   */
  use(interceptor) {
    if (typeof interceptor !== 'function') {
      throw new TypeError('[EventBus] interceptor يجب أن يكون دالة');
    }
    interceptors.push(interceptor);
    return () => {
      const index = interceptors.indexOf(interceptor);
      if (index !== -1) interceptors.splice(index, 1);
    };
  },
  
  /**
   * الاشتراك في جميع الأحداث (Wildcard *)
   * @param {Function} callback - دالة المستمع (تستقبل event, ...args)
   * @param {Object} options - { priority, context }
   * @returns {Function} دالة إلغاء الاشتراك
   */
  onAny(callback, options = {}) {
    return EventBus.on('*', callback, options);
  },
  
  /**
   * تنظيف المستمعين الخاصة بنطاق معين (مثلاً عند تغيير الصفحة)
   * @param {string} namespace - النطاق (مثل "lessons:" أو "profile:")
   */
  clearNamespace(namespace) {
    if (!namespace) return;
    const toRemove = [];
    for (const eventName of events.keys()) {
      if (eventName.startsWith(namespace) || eventName === namespace) {
        toRemove.push(eventName);
      }
    }
    for (const ev of toRemove) {
      this.clear(ev);
    }
  },
  
  /**
   * معالجة طابور الأحداث دون اتصال يدوياً
   */
  processOfflineQueue,
  
  /**
   * تعطيل تخزين الأحداث دون اتصال مؤقتاً
   */
  disableOfflineQueue() {
    EVENT_BUS_CONFIG.OFFLINE_QUEUE_ENABLED = false;
  },
  
  /**
   * تفعيل تخزين الأحداث دون اتصال
   */
  enableOfflineQueue() {
    EVENT_BUS_CONFIG.OFFLINE_QUEUE_ENABLED = true;
    processOfflineQueue();
  }
};

// ====== 6. التهيئة الأولية والتكامل ======
if (typeof window !== 'undefined') {
  // تصدير EventBus على window فوراً
  window.EventBus = EventBus;
  
  // 🛠️ إصلاح: تم حذف كتلة ربط ErrorTracker هنا — كانت تُنفَّذ وقت تحميل هذا
  // الموديول (قبل أن يُعرِّف main.js قيمة window.ErrorTracker أصلاً)، فلم تكن
  // تعمل أبداً فعلياً. الالتقاط الفعلي يتم أصلاً بشكل ديناميكي وصحيح داخل
  // emit()/executeListeners() عبر `window.ErrorTracker?.capture(...)` عند كل حدث.

  // 🔴 إصلاح (1.7): تم حذف مستمع "route:changed" القديم — لم يكن يُصدره أي ملف
  // في المشروع إطلاقاً (router.js يُصدر 'pageChanged' فعلياً، اسم مختلف تماماً)،
  // وجسمه كان فارغاً بالكامل (مجرد تعليقات)، أي أنه لم يكن يفعل شيئاً حتى لو استُدعي.
  // تنظيف المستمعين عند تغيير الصفحة يتم فعلياً وبشكل صحيح عبر آلية
  // router.registerCleanup() الموجودة أصلاً في router.js (راجع التعليق عندها:
  // "EventBus.off('some:event', handler)")، فلا داعي لتكرار المنطق هنا بحدث ميت.
  // إن أردتم مستقبلاً تفعيل تنظيف تلقائي حسب "النطاق" (namespace) هنا، فيجب:
  //   1) الاستماع إلى 'pageChanged' (الاسم الصحيح الفعلي) بدل 'route:changed'.
  //   2) كتابة منطق حقيقي يستدعي EventBus.clearNamespace(...) بدل جسم فارغ،
  //      مع تعريف واضح لكيفية اشتقاق اسم النطاق من route.pageType.
  
  // تفعيل وضع التصحيح تلقائياً في بيئة التطوير
  if (window.location && window.location.hostname === 'localhost') {
    EventBus.setDebug(true);
  }
}

console.log('✅ [EventBus] تم تهيئة نظام الأحداث المركزي - الإصدار 5.0.0 (Enterprise Edition)');

// ====== 7. التصدير ======
export { EventBus };
export default EventBus;