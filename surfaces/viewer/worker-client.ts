/**
 * Prepares the classifier worker for the data view. The worker is a packaged
 * module file (not a Blob), so it is allowed under the MV3 `script-src 'self'`
 * CSP.
 */
export function spawnClassifierWorker(): Worker | null {
  try {
    const url = chrome.runtime.getURL("worker/classifier-worker.js");
    return new Worker(url, { type: "module" });
  } catch (err) {
    console.warn("[classifier] could not start worker", err);
    return null;
  }
}
