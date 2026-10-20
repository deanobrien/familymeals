// @fr/recipe-import (like many NodeNext-style TS packages) imports './x.js' for files that are './x.ts'. Metro and jest do not
// map that; fall back to the extensionless path only when the literal request cannot be resolved.
module.exports = (request, options) => {
  try {
    return options.defaultResolver(request, options);
  } catch (err) {
    if (/^\.{1,2}\/.+\.js$/.test(request)) return options.defaultResolver(request.slice(0, -3), options);
    throw err;
  }
};
