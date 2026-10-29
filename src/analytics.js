// Track the public production site; local/offline use and preview checks stay uncounted.
if (location.protocol === 'https:' && location.hostname === 'proofline-technocore.vercel.app') {
  inject({ mode: 'production' });
}
