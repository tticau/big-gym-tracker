// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Adaugă suport pentru fișierele .wasm necesare pe web pentru SQLite
config.resolver.assetExts.push('wasm');

module.exports = config;