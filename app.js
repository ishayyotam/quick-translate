const LANGS = ["en", "he", "de"];
// Google's detection endpoint returns the legacy code "iw" for Hebrew instead of "he".
const DETECTED_LANG_ALIASES = { iw: "he" };

const wordInput = document.getElementById("word");
const spinner = document.getElementById("spinner");
const statusEl = document.getElementById("status");

const cards = {
  en: document.getElementById("card-en"),
  he: document.getElementById("card-he"),
  de: document.getElementById("card-de"),
};
const textEls = {
  en: document.getElementById("text-en"),
  he: document.getElementById("text-he"),
  de: document.getElementById("text-de"),
};

let debounceTimer = null;
let requestId = 0;

wordInput.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  const value = wordInput.value.trim();
  if (!value) {
    resetResults();
    setStatus("");
    return;
  }
  debounceTimer = setTimeout(() => translate(value), 400);
});

function resetResults() {
  LANGS.forEach((l) => {
    textEls[l].textContent = "—";
    cards[l].classList.remove("source");
  });
}

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", isError);
}

async function translateOne(text, target) {
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=" +
    target +
    "&dt=t&q=" +
    encodeURIComponent(text);
  const res = await fetch(url);
  if (!res.ok) throw new Error("Translation request failed");
  const data = await res.json();
  const translated = data[0].map((chunk) => chunk[0]).join("");
  const detectedSource = data[2];
  return { translated, detectedSource };
}

async function translate(text) {
  const myRequestId = ++requestId;
  spinner.classList.remove("hidden");
  setStatus("Translating…");

  try {
    const results = await Promise.all(
      LANGS.map((target) => translateOne(text, target))
    );

    if (myRequestId !== requestId) return; // a newer request superseded this one

    const rawDetected = results[0].detectedSource;
    const detectedSource = DETECTED_LANG_ALIASES[rawDetected] || rawDetected;
    const sourceLang = LANGS.includes(detectedSource) ? detectedSource : null;

    LANGS.forEach((lang, i) => {
      const isSource = lang === sourceLang;
      cards[lang].classList.toggle("source", isSource);
      textEls[lang].textContent = isSource ? text : results[i].translated;
    });

    setStatus(sourceLang ? `Detected: ${labelFor(sourceLang)}` : "");
  } catch (err) {
    if (myRequestId !== requestId) return;
    setStatus("Couldn't reach the translation service. Check your connection.", true);
  } finally {
    if (myRequestId === requestId) spinner.classList.add("hidden");
  }
}

function labelFor(lang) {
  return { en: "English", he: "עברית", de: "Deutsch" }[lang] || lang;
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
