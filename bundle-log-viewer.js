#!/usr/bin/env node

/**
 * Bundle script for neuf-log-viewer-ssr.js
 * Creates a standalone executable with all dependencies bundled
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔨 Building standalone neuf-log-viewer...');
console.log('');

// Check if node_modules exists
if (!fs.existsSync('node_modules')) {
  console.log('📦 Installing dependencies first...');
  execSync('npm install', { stdio: 'inherit' });
  console.log('');
}

// Bundle with esbuild
console.log('📦 Bundling with esbuild...');

try {
  execSync(
    'npx esbuild neuf-log-viewer-ssr.js --bundle --platform=node --target=node14 --outfile=neuf-log-viewer-standalone.js --external:sql.js',
    { stdio: 'inherit' }
  );
  
  console.log('');
  console.log('✅ Bundle created: neuf-log-viewer-standalone.js');
  console.log('');
  console.log('⚠️  Note: sql.js needs special handling due to WASM files');
  console.log('   Creating a complete standalone version...');
  console.log('');
  
  // Read the bundled file
  let bundledCode = fs.readFileSync('neuf-log-viewer-standalone.js', 'utf8');
  
  // Read sql.js module
  const sqlJsPath = path.join('node_modules', 'sql.js', 'dist', 'sql-wasm.js');
  const sqlJsCode = fs.readFileSync(sqlJsPath, 'utf8');
  
  // Read WASM file and convert to base64
  const wasmPath = path.join('node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  const wasmBuffer = fs.readFileSync(wasmPath);
  const wasmBase64 = wasmBuffer.toString('base64');
  
  // Create standalone version with embedded WASM
  const standaloneCode = `#!/usr/bin/env node

// ============================================================================
// EMBEDDED SQL.JS WITH WASM
// ============================================================================

// Embedded WASM as base64
const WASM_BASE64 = '${wasmBase64}';

// sql.js module code
${sqlJsCode.replace('require(', '// require(')}

// Override locateFile to use embedded WASM
const originalInitSqlJs = initSqlJs;
const initSqlJs = function(config) {
  config = config || {};
  config.wasmBinary = Buffer.from(WASM_BASE64, 'base64');
  return originalInitSqlJs(config);
};

// ============================================================================
// BUNDLED APPLICATION CODE
// ============================================================================

${bundledCode.replace("require('sql.js')", "{ default: initSqlJs }")}
`;
  
  // Write standalone file
  fs.writeFileSync('neuf-log-viewer-standalone.js', standaloneCode, 'utf8');
  
  // Make executable on Unix systems
  if (process.platform !== 'win32') {
    fs.chmodSync('neuf-log-viewer-standalone.js', '755');
  }
  
  console.log('✅ Complete standalone version created!');
  console.log('');
  console.log('📊 File size:', (fs.statSync('neuf-log-viewer-standalone.js').size / 1024 / 1024).toFixed(2), 'MB');
  console.log('');
  console.log('🚀 Usage:');
  console.log('   node neuf-log-viewer-standalone.js <log-folder-path>');
  console.log('');
  console.log('💡 This file can be distributed without node_modules!');
  
} catch (error) {
  console.error('❌ Build failed:', error.message);
  process.exit(1);
}
