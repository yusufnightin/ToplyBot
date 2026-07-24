const READ_ONLY_ENDPOINTS = new Set([
  '/!api/badge/all', '/!api/badge/list',
  '/!api/channel/detail', '/!api/channel/get', '/!api/channel/list', '/!api/channel/show', '/!api/channel/show/info',
  '/!api/crew/get', '/!api/crew/list',
  '/!api/favorite/list', '/!api/friend/status',
  '/!api/group/founder', '/!api/group/get', '/!api/group/joinlist', '/!api/group/list', '/!api/group/online', '/!api/group/popular',
  '/!api/market/api/get', '/!api/market/comment/list', '/!api/market/get', '/!api/market/library/list', '/!api/market/list', '/!api/market/myapps', '/!api/market/publisher/get', '/!api/market/revision/get',
  '/!api/member/get', '/!api/member/info', '/!api/member/list',
  '/!api/message/get', '/!api/message/get/user', '/!api/message/list/user',
  '/!api/notification/get/push/key', '/!api/notification/list',
  '/!api/park/list', '/!api/pass/get',
  '/!api/permission/channel', '/!api/permission/power',
  '/!api/post/get', '/!api/post/list',
  '/!api/public/search', '/!api/public/usernickavailable',
  '/!api/role/get', '/!api/role/list', '/!api/team/list',
  '/!api/test/ip', '/!api/test/time', '/!api/turbo/history/list',
  '/!api/user/blocked/users', '/!api/user/devices', '/!api/user/friends', '/!api/user/groups', '/!api/user/id', '/!api/user/info', '/!api/user/list', '/!api/user/notification/info', '/!api/user/waiting/list'
]);

const PRIORITIES = Object.freeze({ critical: 0, high: 1, normal: 2, low: 3 });

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function isRateLimitResult(value) {
  if (!value || typeof value !== 'object') return false;
  try {
    return /(?:rate[\s_-]*limit|too many requests|\b429\b|hız sınırı)/i.test(JSON.stringify(value));
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

class ApiBatchQueue {
  constructor({
    token,
    baseUrl = 'https://topluyo.com/',
    flushIntervalMs = 35,
    maxBatchSize = 40,
    maxConcurrentBatches = 1,
    timeoutMs = 15000,
    retryAttempts = 2,
    retryBaseDelayMs = 250,
    rateLimitRetryAttempts = 6,
    rateLimitBaseDelayMs = 2000,
    rateLimitMaxDelayMs = 30000,
    cacheTtlMs = 5000,
    maxCacheEntries = 1000,
    maxQueuedRequests = 2000,
    logger
  }) {
    this.token = token;
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    this.flushIntervalMs = Math.max(0, Number(flushIntervalMs) || 35);
    this.maxBatchSize = Math.max(1, Math.min(100, Number(maxBatchSize) || 40));
    this.maxConcurrentBatches = Math.max(1, Math.min(8, Number(maxConcurrentBatches) || 1));
    this.timeoutMs = Math.max(1000, Number(timeoutMs) || 15000);
    this.retryAttempts = Math.max(0, Math.min(5, Number(retryAttempts) || 0));
    this.retryBaseDelayMs = Math.max(25, Number(retryBaseDelayMs) || 250);
    this.rateLimitRetryAttempts = Math.max(1, Math.min(12, Number(rateLimitRetryAttempts) || 6));
    this.rateLimitBaseDelayMs = Math.max(25, Number(rateLimitBaseDelayMs) || 2000);
    this.rateLimitMaxDelayMs = Math.max(
      this.rateLimitBaseDelayMs,
      Math.min(120000, Number(rateLimitMaxDelayMs) || 30000)
    );
    this.cacheTtlMs = Math.max(0, Number(cacheTtlMs) || 0);
    this.maxCacheEntries = Math.max(0, Number(maxCacheEntries) || 0);
    this.maxQueuedRequests = Math.max(10, Number(maxQueuedRequests) || 2000);
    this.logger = logger;

    this.queue = [];
    this.pendingByKey = new Map();
    this.cache = new Map();
    this.inFlightBatches = 0;
    this.closed = false;
    this.flushTimer = null;
    this.sequence = 0;
    this.rateLimitedUntil = 0;
    this.metrics = {
      startedAt: new Date().toISOString(),
      totalRequests: 0,
      networkRequests: 0,
      batches: 0,
      cacheHits: 0,
      dedupeHits: 0,
      retries: 0,
      failures: 0,
      rateLimits: 0,
      rateLimitWaitMs: 0,
      lastRateLimitedAt: null,
      queueHighWaterMark: 0,
      lastBatchSize: 0,
      lastLatencyMs: 0,
      totalLatencyMs: 0,
      lastErrorAt: null
    };
  }

  isReadOnly(api) {
    return READ_ONLY_ENDPOINTS.has(api);
  }

  cacheKey(api, data) {
    return `${api}:${stableStringify(data || {})}`;
  }

  getCached(key) {
    const cached = this.cache.get(key);
    if (!cached) return undefined;
    if (cached.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return undefined;
    }
    // LRU: son kullanılan öğeyi sona taşı.
    this.cache.delete(key);
    this.cache.set(key, cached);
    return cached.value;
  }

  setCached(key, value, ttlMs) {
    if (ttlMs <= 0 || this.maxCacheEntries <= 0) return;
    this.cache.delete(key);
    this.cache.set(key, { value, expiresAt: Date.now() + ttlMs });
    while (this.cache.size > this.maxCacheEntries) {
      this.cache.delete(this.cache.keys().next().value);
    }
  }

  request(api, data = {}, options = {}) {
    if (this.closed) return Promise.reject(new Error('API kuyruğu kapalı.'));
    if (typeof api !== 'string' || !api.startsWith('/!api/')) {
      return Promise.reject(new TypeError('API yolu /!api/ ile başlamalıdır.'));
    }
    if (this.queue.length >= this.maxQueuedRequests) {
      return Promise.reject(new Error(`API kuyruğu dolu (${this.maxQueuedRequests}).`));
    }

    const readOnly = options.readOnly ?? this.isReadOnly(api);
    const cacheTtlMs = readOnly
      ? Math.max(0, Number(options.cacheTtlMs ?? this.cacheTtlMs) || 0)
      : 0;
    const key = readOnly ? this.cacheKey(api, data) : null;
    this.metrics.totalRequests += 1;

    if (key && options.bypassCache !== true) {
      const cached = this.getCached(key);
      if (cached !== undefined) {
        this.metrics.cacheHits += 1;
        return Promise.resolve(cached);
      }
      const pending = options.dedupe === false ? null : this.pendingByKey.get(key);
      if (pending) {
        this.metrics.dedupeHits += 1;
        return pending;
      }
    }

    let resolveEntry;
    let rejectEntry;
    const promise = new Promise((resolve, reject) => {
      resolveEntry = resolve;
      rejectEntry = reject;
    });

    const priorityName = String(options.priority || (readOnly ? 'normal' : 'high')).toLowerCase();
    const entry = {
      api,
      data: data && typeof data === 'object' ? data : {},
      options,
      readOnly,
      cacheTtlMs,
      key,
      priority: PRIORITIES[priorityName] ?? PRIORITIES.normal,
      sequence: this.sequence += 1,
      attempt: Number(options.attempt) || 0,
      resolve: (value) => {
        if (key && options.dedupe !== false && this.pendingByKey.get(key) === promise) this.pendingByKey.delete(key);
        if (key) this.setCached(key, value, cacheTtlMs);
        resolveEntry(value);
      },
      reject: (error) => {
        if (key && options.dedupe !== false && this.pendingByKey.get(key) === promise) this.pendingByKey.delete(key);
        rejectEntry(error);
      }
    };

    this.queue.push(entry);
    if (key && options.dedupe !== false) this.pendingByKey.set(key, promise);
    this.metrics.queueHighWaterMark = Math.max(this.metrics.queueHighWaterMark, this.queue.length);

    if (options.flushImmediately || entry.priority === PRIORITIES.critical || this.queue.length >= this.maxBatchSize) {
      queueMicrotask(() => this.flush().catch((error) => this.logger?.error('API kuyruğu anlık gönderilemedi.', error)));
    } else {
      this.scheduleFlush();
    }
    return promise;
  }

  scheduleFlush(delayMs = this.flushIntervalMs) {
    if (this.closed || this.flushTimer || this.queue.length === 0) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush().catch((error) => this.logger?.error('API kuyruğu gönderilemedi.', error));
    }, Math.max(0, delayMs));
    this.flushTimer.unref?.();
  }

  takeBatch() {
    this.queue.sort((a, b) => a.priority - b.priority || a.sequence - b.sequence);
    return this.queue.splice(0, this.maxBatchSize);
  }

  async flush() {
    const rateLimitDelayMs = Math.max(0, this.rateLimitedUntil - Date.now());
    if (!this.closed && this.queue.length > 0 && rateLimitDelayMs > 0) {
      this.scheduleFlush(rateLimitDelayMs);
      return;
    }
    if (this.closed || this.queue.length === 0 || this.inFlightBatches >= this.maxConcurrentBatches) {
      if (!this.closed && this.queue.length > 0) this.scheduleFlush(5);
      return;
    }

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    while (!this.closed && this.queue.length > 0 && this.inFlightBatches < this.maxConcurrentBatches) {
      const batch = this.takeBatch();
      this.inFlightBatches += 1;
      this.sendBatch(batch)
        .catch((error) => this.logger?.error('Topluyo API batch işlemi başarısız.', error))
        .finally(() => {
          this.inFlightBatches -= 1;
          if (!this.closed && this.queue.length > 0) {
            queueMicrotask(() => this.flush().catch((error) => this.logger?.error('API kuyruğu devam gönderimi başarısız.', error)));
          }
        });
    }
  }

  async sendBatch(batch) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = Date.now();
    this.metrics.batches += 1;
    this.metrics.networkRequests += batch.length;
    this.metrics.lastBatchSize = batch.length;

    try {
      const response = await fetch(`${this.baseUrl}!apis`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
          'User-Agent': `topluyo-professional-bot/3.6.0 Node/${process.versions.node}`
        },
        body: JSON.stringify(batch.map(({ api, data }) => ({ api, data }))),
        signal: controller.signal
      });

      const rawText = await response.text();
      let payload;
      try {
        payload = rawText ? JSON.parse(rawText) : {};
      } catch {
        const error = new Error(`Topluyo API geçersiz JSON döndürdü: ${rawText.slice(0, 300)}`);
        error.status = response.status;
        throw error;
      }

      if (!response.ok) {
        const error = new Error(`Topluyo API HTTP ${response.status}: ${rawText.slice(0, 300)}`);
        error.status = response.status;
        const retryAfterHeader = String(response.headers.get('retry-after') || '').trim();
        const retryAfterSeconds = Number(retryAfterHeader);
        const retryAfterDateMs = Date.parse(retryAfterHeader);
        error.retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
          ? retryAfterSeconds * 1000
          : Number.isFinite(retryAfterDateMs)
            ? Math.max(0, retryAfterDateMs - Date.now())
            : 0;
        throw error;
      }

      const results = this.normalizeResults(payload?.data ?? payload, batch.length);
      const rateLimitedEntries = [];
      batch.forEach((entry, index) => {
        if (isRateLimitResult(results[index])) {
          rateLimitedEntries.push(entry);
          return;
        }
        if (!entry.readOnly) this.invalidateRelated(entry.api);
        entry.resolve(results[index]);
      });
      if (rateLimitedEntries.length) {
        const error = Object.assign(new Error('Topluyo API batch sonucu hız sınırına takıldı.'), {
          status: 429,
          retryAfterMs: 0
        });
        this.metrics.failures += rateLimitedEntries.length;
        this.metrics.lastErrorAt = new Date().toISOString();
        await this.handleBatchFailure(rateLimitedEntries, error);
      }
    } catch (error) {
      const normalizedError = error.name === 'AbortError'
        ? Object.assign(new Error(`Topluyo API isteği ${this.timeoutMs} ms içinde tamamlanmadı.`), { status: 408 })
        : error;
      this.metrics.failures += batch.length;
      this.metrics.lastErrorAt = new Date().toISOString();
      await this.handleBatchFailure(batch, normalizedError);
    } finally {
      clearTimeout(timeout);
      const latency = Date.now() - startedAt;
      this.metrics.lastLatencyMs = latency;
      this.metrics.totalLatencyMs += latency;
    }
  }

  async handleBatchFailure(batch, error) {
    const retryableStatus = !error.status || error.status === 408 || error.status === 429 || error.status >= 500;
    const rateLimited = error.status === 429;
    const retries = [];
    for (const entry of batch) {
      const retryLimit = rateLimited ? this.rateLimitRetryAttempts : this.retryAttempts;
      const mayRetry = rateLimited
        ? true
        : entry.readOnly && retryableStatus;
      if (mayRetry && entry.attempt < retryLimit && !this.closed) {
        entry.attempt += 1;
        entry.sequence = this.sequence += 1;
        retries.push(entry);
        this.metrics.retries += 1;
      } else {
        entry.reject(error);
      }
    }

    if (!retries.length) return;
    const highestAttempt = Math.max(...retries.map((entry) => entry.attempt));
    const retryAfterMs = Math.max(0, Number(error.retryAfterMs) || 0);
    const backoffBase = rateLimited ? this.rateLimitBaseDelayMs : this.retryBaseDelayMs;
    const backoffCeiling = rateLimited ? this.rateLimitMaxDelayMs : 5000;
    const backoffMs = retryAfterMs || Math.min(
      backoffCeiling,
      backoffBase * (2 ** (highestAttempt - 1)) + Math.floor(Math.random() * 100)
    );
    if (rateLimited) {
      this.rateLimitedUntil = Math.max(this.rateLimitedUntil, Date.now() + backoffMs);
      this.metrics.rateLimits += 1;
      this.metrics.rateLimitWaitMs += backoffMs;
      this.metrics.lastRateLimitedAt = new Date().toISOString();
      this.logger?.warn('Topluyo API hız sınırına ulaşıldı; kuyruk bekletilip yeniden denenecek.', {
        waitMs: backoffMs,
        attempt: highestAttempt,
        requests: retries.length
      });
    }
    this.queue.push(...retries);
    this.metrics.queueHighWaterMark = Math.max(this.metrics.queueHighWaterMark, this.queue.length);
    this.scheduleFlush(backoffMs);
  }

  normalizeResults(data, expectedLength) {
    if (Array.isArray(data)) {
      return Array.from({ length: expectedLength }, (_, index) => data[index]);
    }
    if (data && typeof data === 'object') {
      const numericKeys = Object.keys(data).filter((key) => /^\d+$/.test(key)).sort((a, b) => Number(a) - Number(b));
      const values = numericKeys.length ? numericKeys.map((key) => data[key]) : Object.values(data);
      return Array.from({ length: expectedLength }, (_, index) => values[index]);
    }
    return Array.from({ length: expectedLength }, () => data);
  }

  invalidateRelated(api) {
    const scopes = [];
    if (api.includes('/channel/')) scopes.push('/!api/channel/', '/!api/permission/channel');
    if (api.includes('/role/')) scopes.push('/!api/role/', '/!api/member/', '/!api/permission/');
    if (api.includes('/member/')) scopes.push('/!api/member/', '/!api/group/online', '/!api/group/joinlist');
    if (api.includes('/group/')) scopes.push('/!api/group/', '/!api/channel/list', '/!api/role/list');
    if (api.includes('/post/')) scopes.push('/!api/post/');
    if (api.includes('/badge/')) scopes.push('/!api/badge/');
    if (api.includes('/crew/')) scopes.push('/!api/crew/');
    if (!scopes.length) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (scopes.some((scope) => key.startsWith(scope))) this.cache.delete(key);
    }
  }

  clearCache() {
    const count = this.cache.size;
    this.cache.clear();
    return count;
  }

  getMetrics() {
    const averageLatencyMs = this.metrics.batches > 0
      ? Math.round(this.metrics.totalLatencyMs / this.metrics.batches)
      : 0;
    return {
      ...this.metrics,
      averageLatencyMs,
      queued: this.queue.length,
      inFlightBatches: this.inFlightBatches,
      pendingDedupKeys: this.pendingByKey.size,
      cacheEntries: this.cache.size,
      config: {
        flushIntervalMs: this.flushIntervalMs,
        maxBatchSize: this.maxBatchSize,
        maxConcurrentBatches: this.maxConcurrentBatches,
        timeoutMs: this.timeoutMs,
        retryAttempts: this.retryAttempts,
        rateLimitRetryAttempts: this.rateLimitRetryAttempts,
        rateLimitBaseDelayMs: this.rateLimitBaseDelayMs,
        rateLimitMaxDelayMs: this.rateLimitMaxDelayMs,
        cacheTtlMs: this.cacheTtlMs
      }
    };
  }

  async drain(timeoutMs = this.timeoutMs * 2) {
    const startedAt = Date.now();
    while ((this.queue.length > 0 || this.inFlightBatches > 0) && Date.now() - startedAt < timeoutMs) {
      await this.flush();
      await sleep(10);
    }
  }

  async close({ drain = false } = {}) {
    if (drain) await this.drain();
    this.closed = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (this.queue.length > 0) {
      const error = new Error('API kuyruğu kapatıldı.');
      this.queue.splice(0).forEach((entry) => entry.reject(error));
    }
    this.cache.clear();
  }
}

ApiBatchQueue.READ_ONLY_ENDPOINTS = READ_ONLY_ENDPOINTS;
ApiBatchQueue.stableStringify = stableStringify;
ApiBatchQueue.isRateLimitResult = isRateLimitResult;
module.exports = ApiBatchQueue;
