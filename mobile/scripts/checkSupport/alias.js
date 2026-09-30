// Path-alias shim: lets the compiled CommonJS output resolve the "@/..." imports
// that tsx/esbuild would normally handle. Copied into the output directory by
// scripts/run-checks.sh, which recreates it after each compile.
const Module = require('module');
const path = require('path');
const fs = require('fs');

const ROOT = '/tmp/chk';
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request.startsWith('@/')) {
    let target = path.join(ROOT, request.slice(2));
    if (!fs.existsSync(target + '.js')) target += '/index';
    request = target;
  }
  return orig.call(this, request, ...args);
};
