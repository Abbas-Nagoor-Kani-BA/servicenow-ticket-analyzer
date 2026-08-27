
function xmlEscape(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"
  })[ch]);
}
function decodeText(bytes) {
  return new TextDecoder().decode(bytes);
}
function encodeText(str) {
  return new TextEncoder().encode(str);
}
function colLetter(n) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
function letterToColNum(s) {
  let n = 0;
  for (const ch of String(s).trim().toUpperCase()) {
    const v = ch.charCodeAt(0) - 64;
    if (v < 1 || v > 26) return 0;
    n = n * 26 + v;
  }
  return n;
}

export {
  xmlEscape,
  decodeText,
  encodeText,
  colLetter,
  letterToColNum
};
