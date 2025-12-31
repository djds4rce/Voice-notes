/**
 * Prepare dist folder for GitHub Pages deployment
 * 
 * Strategy: Static Landing Page + SPA at /web.html
 * 1. index.html = Static Landing Page (served at /)
 * 2. web.html = React App (served at /web.html)
 * 3. 404.html = Redirects deep links to /web.html
 */

import { readFileSync, writeFileSync, renameSync, copyFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const distDir = join(rootDir, 'dist');
const publicDir = join(rootDir, 'public');

console.log('🔧 Preparing dist folder for GitHub Pages (Web Entry Strategy)...\n');

// 1. Rename dist/index.html → dist/web.html
const indexPath = join(distDir, 'index.html');
const appPath = join(distDir, 'web.html');

if (existsSync(indexPath)) {
  renameSync(indexPath, appPath);
  console.log('✓ Renamed index.html → web.html');
} else {
  console.error('✗ index.html not found in dist/');
  process.exit(1);
}

// 2. Copy public/landing.html → dist/index.html
const landingPath = join(publicDir, 'landing.html');

if (existsSync(landingPath)) {
  copyFileSync(landingPath, indexPath);
  console.log('✓ Copied landing.html → index.html');
} else {
  console.error('✗ landing.html not found in public/');
  process.exit(1);
}

// 3. Create .nojekyll
const nojekyllPath = join(distDir, '.nojekyll');
writeFileSync(nojekyllPath, '');
console.log('✓ Created .nojekyll');

// 4. Create 404.html for fallback
const html404 = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Redirecting...</title>
  <script>
    // SPA fallback: redirect to web.html
    const path = window.location.pathname + window.location.search + window.location.hash;
    
    // Simple redirect to web.html, preserving the hash logic if possible
    window.location.replace('/web.html#' + path);
  </script>
</head>
<body>
  <p>Redirecting to app...</p>
</body>
</html>`;

const html404Path = join(distDir, '404.html');
writeFileSync(html404Path, html404);
console.log('✓ Created 404.html (Fallback)');

console.log('\n✅ GitHub Pages preparation complete!');
console.log('   dist/index.html  → Static Landing Page');
console.log('   dist/web.html    → React SPA');
