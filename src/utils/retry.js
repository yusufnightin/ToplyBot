function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function isLikelyTransientError(error) {
  const text = String(error?.message || error || '').toLocaleLowerCase('tr-TR');
  return /(?:timeout|timed out|econnreset|econnrefused|socket|network|fetch failed|rate|too many|429|502|503|504|geçici|tekrar|bağlantı)/i.test(text);
}

async function withRetry(operation, {
  attempts = 4,
  minDelayMs = 350,
  maxDelayMs = 3000,
  factor = 1.8,
  jitterMs = 180,
  shouldRetry = isLikelyTransientError,
  onRetry = null
} = {}) {
  const total = Math.max(1, Number(attempts) || 1);
  let lastError;
  for (let attempt = 1; attempt <= total; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= total || !shouldRetry(error, attempt)) throw error;
      const exponential = Math.min(maxDelayMs, minDelayMs * (factor ** (attempt - 1)));
      const delayMs = Math.round(exponential + Math.random() * jitterMs);
      await onRetry?.({ attempt, nextAttempt: attempt + 1, delayMs, error });
      await sleep(delayMs);
    }
  }
  throw lastError;
}

async function poll(operation, predicate, {
  attempts = 8,
  intervalMs = 450,
  factor = 1.25,
  maxIntervalMs = 1800,
  onMiss = null
} = {}) {
  let delay = Math.max(0, Number(intervalMs) || 0);
  let lastValue;
  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt += 1) {
    lastValue = await operation(attempt);
    if (await predicate(lastValue, attempt)) return lastValue;
    if (attempt < attempts) {
      await onMiss?.({ attempt, nextAttempt: attempt + 1, delayMs: delay, value: lastValue });
      await sleep(delay);
      delay = Math.min(maxIntervalMs, Math.max(delay + 1, Math.round(delay * factor)));
    }
  }
  return lastValue;
}

module.exports = { sleep, withRetry, poll, isLikelyTransientError };
