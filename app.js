const LANGS = ["en", "he", "de"];
// Google's detection endpoint returns the legacy code "iw" for Hebrew instead of "he".
const DETECTED_LANG_ALIASES = { iw: "he" };

const wordInput = document.getElementById("word");
const spinner = document.getElementById("spinner");
const statusEl = document.getElementById("status");
const exampleDeEl = document.getElementById("example-de");

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
let manualSource = null; // null = auto-detect, otherwise one of LANGS

wordInput.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  const value = wordInput.value.trim();
  if (!value) {
    manualSource = null;
    resetResults();
    setStatus("");
    return;
  }
  debounceTimer = setTimeout(() => translate(value), 400);
});

document.querySelectorAll(".card-label").forEach((btn) => {
  btn.addEventListener("click", () => {
    const lang = btn.dataset.lang;
    manualSource = manualSource === lang ? null : lang;
    updateManualIndicator();
    const value = wordInput.value.trim();
    if (value) translate(value);
  });
});

function updateManualIndicator() {
  LANGS.forEach((lang) => {
    cards[lang].classList.toggle("manual", lang === manualSource);
  });
}

function resetResults() {
  LANGS.forEach((l) => {
    textEls[l].textContent = "—";
    cards[l].classList.remove("source", "manual");
  });
  exampleDeEl.textContent = "";
}

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", isError);
}

async function translateOne(text, target, source) {
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=" +
    (source || "auto") +
    "&tl=" +
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

async function fetchExampleSentence(englishWord) {
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=de&dt=ex&q=" +
    encodeURIComponent(englishWord);
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const examples = data && data[13] && data[13][0];
  if (!examples || !examples.length) return null;
  const raw = examples[0][0];
  return raw.replace(/<\/?b>/g, "");
}

async function updateGermanExample(myRequestId, sourceLang, originalText, results) {
  exampleDeEl.textContent = "";
  if (sourceLang !== "en" && sourceLang !== "he") return;

  const englishWord =
    sourceLang === "en" ? originalText : results[LANGS.indexOf("en")].translated;

  try {
    const sentence = await fetchExampleSentence(englishWord);
    if (!sentence || myRequestId !== requestId) return;
    const { translated } = await translateOne(sentence, "de", "en");
    if (myRequestId !== requestId) return;
    exampleDeEl.textContent = "z.B.: " + translated;
  } catch (err) {
    // Example sentences are a nice-to-have; fail silently.
  }
}

async function translate(text) {
  const myRequestId = ++requestId;
  spinner.classList.remove("hidden");
  setStatus("Translating…");

  try {
    const results = await Promise.all(
      LANGS.map((target) => translateOne(text, target, manualSource))
    );

    if (myRequestId !== requestId) return; // a newer request superseded this one

    let sourceLang;
    if (manualSource) {
      sourceLang = manualSource;
    } else {
      const rawDetected = results[0].detectedSource;
      const detectedSource = DETECTED_LANG_ALIASES[rawDetected] || rawDetected;
      sourceLang = LANGS.includes(detectedSource) ? detectedSource : null;
    }

    LANGS.forEach((lang, i) => {
      const isSource = lang === sourceLang;
      cards[lang].classList.toggle("source", isSource);
      textEls[lang].textContent = isSource ? text : results[i].translated;
    });
    updateManualIndicator();

    if (manualSource) {
      setStatus(`Source: ${labelFor(sourceLang)} (manual)`);
    } else {
      setStatus(sourceLang ? `Detected: ${labelFor(sourceLang)}` : "");
    }

    updateGermanExample(myRequestId, sourceLang, text, results);
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
