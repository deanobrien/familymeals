// Extends app.json (which stays the source of truth) with the Firebase config Android push needs (P1-C, D382).
// FCM: EAS builds get `google-services.json` from the EAS file environment variable GOOGLE_SERVICES_JSON (owner step,
// docs/DEPLOY-APP-SERVICE.md 3e); a local copy at apps/mobile/google-services.json (git-ignored) is used for local builds.
// Without either, the app still builds and runs: the in-app notification list works, push registration says it is unavailable.
const fs = require('node:fs');
const path = require('node:path');

module.exports = ({ config }) => {
  const local = path.join(__dirname, 'google-services.json');
  const file = process.env.GOOGLE_SERVICES_JSON || (fs.existsSync(local) ? './google-services.json' : undefined);
  if (!file) return config;
  return { ...config, android: { ...config.android, googleServicesFile: file } };
};
