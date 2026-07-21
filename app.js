const LANGS = ["en", "he", "de"];
// Google's detection endpoint returns the legacy code "iw" for Hebrew instead of "he".
const DETECTED_LANG_ALIASES = { iw: "he" };

const wordInput = document.getElementById("word");
const spinner = document.getElementById("spinner");
const statusEl = document.getElementById("status");
const exampleDeEl = document.getElementById("example-de");
const genderDeEl = document.getElementById("gender-de");

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
let lastQueriedText = null;

wordInput.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  const value = wordInput.value.trim();
  if (!value) {
    manualSource = null;
    lastQueriedText = null;
    resetResults();
    setStatus("");
    return;
  }
  debounceTimer = setTimeout(() => {
    // Mobile keyboards (autocorrect/predictive text) can fire extra "input"
    // events for text that hasn't actually changed — skip redundant re-runs.
    if (value === lastQueriedText) return;
    lastQueriedText = value;
    translate(value);
  }, 400);
});

document.querySelectorAll(".card-label").forEach((btn) => {
  btn.addEventListener("click", () => {
    const lang = btn.dataset.lang;
    manualSource = manualSource === lang ? null : lang;
    updateManualIndicator();
    const value = wordInput.value.trim();
    if (value) {
      lastQueriedText = value;
      translate(value);
    }
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
  genderDeEl.textContent = "";
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

async function fetchCandidateExamples(englishWord) {
  // The dictionary/example lookup is case-sensitive and often finds nothing
  // for a capitalized word (mobile keyboards auto-capitalize by default).
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=de&dt=ex&q=" +
    encodeURIComponent(englishWord.toLowerCase());
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  const examples = data && data[13] && data[13][0];
  if (!examples || !examples.length) return [];
  return examples.map((e) => e[0].replace(/<\/?b>/g, ""));
}

async function updateGermanExample(sourceLang, englishWord, germanWord, originalText) {
  exampleDeEl.textContent = "";
  if (sourceLang !== "en" && sourceLang !== "he") return;
  if (!englishWord || !germanWord) return;

  // Guard against the input value having moved on to something else by the
  // time these (slower, sequential) requests come back — but a duplicate
  // event for the *same* text should not throw away a completed lookup.
  const stillCurrent = () => wordInput.value.trim() === originalText;
  const stem = germanWord.toLowerCase();

  try {
    const candidates = await fetchCandidateExamples(englishWord);
    if (!candidates.length || !stillCurrent()) return;

    // An English word can have unrelated senses (e.g. "maiden" the noun vs.
    // "maiden" as in "maiden voyage"). Only show an example that actually
    // translates back to the same German word we're displaying. Translate
    // every candidate in parallel (not one-by-one) so checking more of them
    // doesn't cost extra time — some words only have a matching example
    // further down the list.
    const translations = await Promise.all(
      candidates.map((sentence) =>
        translateOne(sentence, "de", "en").catch(() => null)
      )
    );
    if (!stillCurrent()) return;

    const match = translations.find(
      (r) => r && r.translated.toLowerCase().includes(stem)
    );
    if (match) exampleDeEl.textContent = "z.B.: " + match.translated;
  } catch (err) {
    // Example sentences are a nice-to-have; fail silently.
  }
}

async function fetchGenderArticle(englishWord, germanWord) {
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=de&dt=bd&q=" +
    encodeURIComponent(englishWord.toLowerCase());
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const groups = data && data[1];
  if (!groups) return null;

  const target = germanWord.toLowerCase();
  for (const group of groups) {
    if (group[0] !== "noun") continue;
    for (const entry of group[2] || []) {
      const [word, , , , article] = entry;
      if (word && article && word.toLowerCase() === target) {
        return ["der", "die", "das"].includes(article) ? article : null;
      }
    }
  }
  return null;
}

async function updateGermanGender(englishWord, germanWord, originalText) {
  genderDeEl.textContent = "";
  // German nouns are always capitalized; skip phrases (translations with spaces).
  if (!englishWord || !germanWord || /\s/.test(germanWord) || !/^[A-ZÄÖÜ]/.test(germanWord)) {
    return;
  }
  const stillCurrent = () => wordInput.value.trim() === originalText;

  try {
    const article = await fetchGenderArticle(englishWord, germanWord);
    if (!article || !stillCurrent()) return;
    genderDeEl.textContent = article + " ";
  } catch (err) {
    // Gender tagging is a nice-to-have; fail silently.
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

    const englishWord = sourceLang === "en" ? text : results[LANGS.indexOf("en")].translated;
    const germanWord = sourceLang === "de" ? text : results[LANGS.indexOf("de")].translated;

    updateGermanGender(englishWord, germanWord, text);
    updateGermanExample(sourceLang, englishWord, germanWord, text);
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

  // When a newer service worker takes over (i.e. a new version was deployed),
  // reload once so the page picks up the fresh files instead of staying stale.
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}
