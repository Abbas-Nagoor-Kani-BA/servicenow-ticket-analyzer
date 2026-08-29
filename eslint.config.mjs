import tseslint from "typescript-eslint";

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
  ResizeObserver: "readonly",
  MutationObserver: "readonly",
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

const baseRules = {
  "no-import-assign": "error",
  "no-undef": "off",
  "no-var": "warn",
  "prefer-const": "warn"
};

// Node runs .ts directly via type stripping, which cannot transform
// parameter properties, enum, or namespace. Ban them outright.
//
// no-explicit-any stays off: reflection-free DI cannot type its wiring
// without it, and the base tsconfig is still `noImplicitAny: false` while
// the migration is in progress.
const tsRules = {
  ...baseRules,
  "@typescript-eslint/no-explicit-any": "off",
  "@typescript-eslint/no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_", caughtErrors: "none" }],
  "@typescript-eslint/parameter-properties": "error",
  "no-restricted-syntax": [
    "error",
    {
      selector: "TSEnumDeclaration",
      message: "Node type-stripping cannot transform enum; use a union of string literals or a frozen const object."
    },
    {
      selector: "TSModuleDeclaration",
      message: "Node type-stripping cannot transform namespace; use ES modules."
    }
  ]
};

// Declaration files emit no JS, so they never reach Node's type stripper.
const declarationRules = {
  "no-restricted-syntax": "off"
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
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["**/*.ts"]
  })),
  {
    files: ["**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: browserGlobals
    },
    rules: tsRules
  },
  {
    files: ["tools/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...nodeGlobals, ...browserGlobals }
    },
    rules: tsRules
  },
  {
    files: ["**/*.d.ts"],
    rules: declarationRules
  },
  {
    files: ["tools/**/*.js", "tools/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...nodeGlobals, ...browserGlobals }
    },
    rules: {
      ...baseRules,
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-undef": "error"
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
      ...baseRules,
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-undef": "error"
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
      ...baseRules,
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_", caughtErrors: "none" }]
    }
  }
];
