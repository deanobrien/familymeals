// Expo auto-configures pnpm/Turborepo monorepos (watchFolders, nodeModulesPaths, symlinks,
// package exports). Only the server-only guard is added here. See DECISIONS.md (D32).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Guard: the server-only AI package must not be bundled into the app.
const prevResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@fr/ai' || moduleName.startsWith('@fr/ai/')) {
    throw new Error('@fr/ai is server-only and cannot be imported from apps/mobile.');
  }
  const resolve = prevResolve || context.resolveRequest;
  // @fr/recipe-import imports './x.js' for './x.ts' (NodeNext style): try the literal request, then without the extension.
  if (/^\.{1,2}\/.+\.js$/.test(moduleName)) {
    try {
      return resolve(context, moduleName, platform);
    } catch {
      return resolve(context, moduleName.slice(0, -3), platform);
    }
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
