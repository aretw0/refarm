#!/usr/bin/env node

/**
 * Check that all locale files have the same keys
 * Usage: npm run i18n:check
 */

import fs from 'fs';
import path from 'path';

const LOCALES_DIR = path.join(process.cwd(), 'locales');
const SUPPORTED_LOCALES = ['pt-BR', 'en', 'es'];

function flattenKeys(obj, prefix = '') {
  let keys = [];
  
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      keys = keys.concat(flattenKeys(value, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  
  return keys;
}

function main() {
  console.log('🌍 Checking i18n locale files...\n');
  
  // Load all locales
  const locales = {};
  const localeKeys = {};
  
  for (const locale of SUPPORTED_LOCALES) {
    const filePath = path.join(LOCALES_DIR, `${locale}.json`);
    
    if (!fs.existsSync(filePath)) {
      console.error(`❌ Missing locale file: ${locale}.json`);
      process.exit(1);
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    locales[locale] = JSON.parse(content);
    localeKeys[locale] = new Set(flattenKeys(locales[locale]));
  }
  
  // Check for differences
  const baseLocale = SUPPORTED_LOCALES[0];
  const baseKeys = localeKeys[baseLocale];
  let hasErrors = false;
  
  for (const locale of SUPPORTED_LOCALES.slice(1)) {
    const currentKeys = localeKeys[locale];
    
    // Check for missing keys
    const missingKeys = [...baseKeys].filter(k => !currentKeys.has(k));
    if (missingKeys.length > 0) {
      console.error(`⚠️  ${locale} missing keys from ${baseLocale}:`);
      missingKeys.forEach(k => console.error(`   - ${k}`));
      hasErrors = true;
    }
    
    // Check for extra keys
    const extraKeys = [...currentKeys].filter(k => !baseKeys.has(k));
    if (extraKeys.length > 0) {
      console.error(`⚠️  ${locale} has extra keys not in ${baseLocale}:`);
      extraKeys.forEach(k => console.error(`   - ${k}`));
      hasErrors = true;
    }
  }
  
  if (hasErrors) {
    console.error('\n❌ Locale files are out of sync');
    process.exit(1);
  } else {
    console.log(`✅ All locale files synchronized`);
    console.log(`📊 Total keys: ${baseKeys.size}`);
    console.log(`🗣️  Locales: ${SUPPORTED_LOCALES.join(', ')}`);
  }
}

main();
