const browserGlobals = {
  document: "readonly",
  window: "readonly",
  navigator: "readonly",
  location: "readonly",
  history: "readonly",
  console: "readonly",
  URL: "readonly",
  Blob: "readonly",
  File: "readonly",
  FileReader: "readonly",
  FormData: "readonly",
  alert: "readonly",
  confirm: "readonly",
  prompt: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  requestAnimationFrame: "readonly",
  cancelAnimationFrame: "readonly",
  getComputedStyle: "readonly",
  matchMedia: "readonly",
  scrollTo: "readonly",
  fetch: "readonly",
  Headers: "readonly",
  Request: "readonly",
  Response: "readonly",
  structuredClone: "readonly",
  crypto: "readonly",
  performance: "readonly",
  CustomEvent: "readonly",
  Event: "readonly",
  KeyboardEvent: "readonly",
  MouseEvent: "readonly",
  CSS: "readonly",
  HTMLElement: "readonly",
  indexedDB: "readonly",
  localStorage: "readonly",
  TextDecoder: "readonly",
  TextEncoder: "readonly",
  DOMException: "readonly",
  AbortController: "readonly",
  self: "readonly",
  globalThis: "readonly",
  btoa: "readonly",
  atob: "readonly",
  queueMicrotask: "readonly",
  chrome: "readonly"
};

const nodeGlobals = {
  process: "readonly",
  console: "readonly",
  Buffer: "readonly",
  URL: "readonly",
  fetch: "readonly",
  TextDecoder: "readonly",
  TextEncoder: "readonly",
  DOMException: "readonly",
  AbortController: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  globalThis: "readonly"
};

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "**/vendor/**",
      "*.min.js"
    ]
  },
  {
    files: ["tools/**"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...nodeGlobals, ...browserGlobals }
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-import-assign": "error",
      "no-undef": "error",
      "no-var": "warn",
      "prefer-const": "warn"
    }
  },
  {
    files: ["**/*.js"],
    ignores: ["tools/**", "content/content.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: browserGlobals
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-import-assign": "error",
      "no-undef": "error",
      "no-var": "warn",
      "prefer-const": "warn"
    }
  },
  {
    files: ["content/content.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: browserGlobals
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-undef": "off"
    }
  }
];
