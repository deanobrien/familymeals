// Expo auto-configures pnpm/Turborepo monorepos (watchFolders, nodeModulesPaths, symlinks,
// package exports). Only the server-only guard is added here. See DECISIONS.md (D27).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Guard: the server-only AI package must not be bundled into the app.
const prevResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@fr/ai' || moduleName.startsWith('@fr/ai/')) {
    throw new Error('@fr/ai is server-only and cannot be imported from apps/mobile.');
  }
  return (prevResolve || context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
