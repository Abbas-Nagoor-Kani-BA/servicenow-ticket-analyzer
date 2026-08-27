// Ambient declarations for browser/runtime globals that have no bundled
// type package in this repo. Replace with @types/chrome once installed.
export {};

declare global {
  const chrome: any;
  const fflate: any;
  const g_ck: any;
  let Analysis: any;
}

export {};
