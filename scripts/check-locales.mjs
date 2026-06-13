#!/usr/bin/env node

/**
 * Check that all locale files have the same keys
 * Usage: run the i18n:check package script with the configured package manager.
 */

import fs from 'fs';
import path from 'path';

import {
  checkLocales,
  DEFAULT_SUPPORTED_LOCALES,
} from './check-locales-lib.mjs';

const LOCALES_DIR = path.join(process.cwd(), 'locales');
const SUPPORTED_LOCALES = DEFAULT_SUPPORTED_LOCALES;

function main() {
  console.log('🌍 Checking i18n locale files...\n');

  if (!fs.existsSync(LOCALES_DIR)) {
    console.error(`❌ Missing locales directory: ${LOCALES_DIR}`);
    process.exit(1);
  }

  let result;
  try {
    result = checkLocales(LOCALES_DIR, SUPPORTED_LOCALES);
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }

  for (const { locale, missingKeys, extraKeys } of result.differences) {
    if (missingKeys.length > 0) {
      console.error(`⚠️  ${locale} missing keys from ${result.baseLocale}:`);
      missingKeys.forEach(k => console.error(`   - ${k}`));
    }

    if (extraKeys.length > 0) {
      console.error(`⚠️  ${locale} has extra keys not in ${result.baseLocale}:`);
      extraKeys.forEach(k => console.error(`   - ${k}`));
    }
  }

  if (result.differences.length > 0) {
    console.error('\n❌ Locale files are out of sync');
    process.exit(1);
  } else {
    console.log(`✅ All locale files synchronized`);
    console.log(`📊 Total keys: ${result.baseKeyCount}`);
    console.log(`🗣️  Locales: ${result.supportedLocales.join(', ')}`);
  }
}

main();
