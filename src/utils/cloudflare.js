function isCloudflareManagedChallenge(rejection = {}) {
  const server = String(rejection.server || '').toLowerCase();
  const body = String(rejection.body || '').toLowerCase();
  return Number(rejection.statusCode) === 403
    && server.includes('cloudflare')
    && (body.includes('just a moment')
      || body.includes('enable javascript and cookies')
      || body.includes("ctype: 'managed'")
      || body.includes('challenges.cloudflare.com'));
}

module.exports = { isCloudflareManagedChallenge };
