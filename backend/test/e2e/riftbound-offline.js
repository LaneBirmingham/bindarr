// Preloaded by the Riftbound E2E suite. Startup may try to refresh other games;
// those requests fail immediately. Riftbound's catalogue and art must use disk.
const axios = require('axios');
axios.defaults.adapter = async (config) => {
  throw new Error(`Offline Riftbound test blocked provider request: ${config.url}`);
};
const realFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    return Promise.reject(new Error(`Offline Riftbound test blocked fetch: ${url.origin}`));
  }
  return realFetch(input, options);
};
