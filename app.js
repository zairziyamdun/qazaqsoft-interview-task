const STORAGE_KEYS = {
  STATE: "quiz.state.v1",
};
const DATA_URL = "./data/questions.json";

/**
 * @typedef {{ id: string; text: string; options: string[]; correctIndex: number; topic?: string }} QuestionDTO
 * @typedef {{ title: string; timeLimitSec: number; passThreshold: number; questions: QuestionDTO[] }} QuizDTO
 */

class Question {
  /** @param {QuestionDTO} dto */
  constructor(dto) {
    this.id = dto.id;
    this.text = dto.text;
    this.options = dto.options;
    this.correctIndex = dto.correctIndex;
    this.topic = dto.topic ?? null;
  }
}

class StorageService {
  static saveState(state) {
    localStorage.setItem(STORAGE_KEYS.STATE, JSON.stringify(state));
  }

  static loadState() {
    const raw = localStorage.getItem(STORAGE_KEYS.STATE);
    if (!raw) return null;

    try {
      return JSON.parse(raw);
    } catch {
      localStorage.removeItem(STORAGE_KEYS.STATE);
      return null;
    }
  }

  static clear() {
    localStorage.removeItem(STORAGE_KEYS.STATE);
  }
}

class QuizEngine {
  /** @param {QuizDTO} quiz */
  constructor(quiz) {
    this.title = quiz.title;
    this.timeLimitSec = quiz.timeLimitSec;
    this.passThreshold = quiz.passThreshold;
    this.questions = quiz.questions.map((q) => new Question(q));

    this.currentIndex = 0;
    /** @type {Record<string, number|undefined>} */
    this.answers = {};
    this.remainingSec = quiz.timeLimitSec;
    this.isFinished = false;
  }

  get length() {
    return this.questions.length;
  }

  get currentQuestion() {
    return this.questions[this.currentIndex];
  }

  /** @param {number} index */
  goTo(index) {
    if (index < 0 || index >= this.questions.length) return;
    this.currentIndex = index;
  }

  next() {
    this.goTo(this.currentIndex + 1);
  }

  prev() {
    this.goTo(this.currentIndex - 1);
  }

  /** @param {number} optionIndex */
  select(optionIndex) {
    if (this.isFinished) return;
    const question = this.currentQuestion;
    this.answers[question.id] = optionIndex;
  }

  getSelectedIndex() {
    const question = this.currentQuestion;
    return this.answers[question.id];
  }

  tick() {
    if (this.isFinished) return false;

    this.remainingSec = Math.max(0, this.remainingSec - 1);

    if (this.remainingSec === 0) {
      this.finish();
      return true;
    }

    return false;
  }

  finish() {
    this.isFinished = true;

    let correct = 0;

    this.questions.forEach((question) => {
      const selectedIndex = this.answers[question.id];
      if (selectedIndex === question.correctIndex) {
        correct++;
      }
    });

    const total = this.questions.length;
    const ratio = total > 0 ? correct / total : 0;
    const percent = Math.round(ratio * 100);
    const passed = ratio >= this.passThreshold;

    return { correct, total, percent, passed };
  }

  toState() {
    return {
      currentIndex: this.currentIndex,
      answers: this.answers,
      remainingSec: this.remainingSec,
      isFinished: this.isFinished,
    };
  }

  /** @param {any} state */
  static fromState(quiz, state) {
    const engine = new QuizEngine(quiz);
    if (!state) return engine;

    engine.currentIndex = Number.isInteger(state.currentIndex)
      ? state.currentIndex
      : 0;

    engine.answers =
      state.answers && typeof state.answers === "object" ? state.answers : {};

    engine.remainingSec = Number.isFinite(state.remainingSec)
      ? state.remainingSec
      : quiz.timeLimitSec;

    engine.isFinished = Boolean(state.isFinished);

    return engine;
  }
}

const $ = (sel) => /** @type {HTMLElement} */ (document.querySelector(sel));
const els = {
  title: $("#quiz-title"),
  progress: $("#progress"),
  timer: $("#timer"),
  qSection: $("#question-section"),
  qText: $("#question-text"),
  form: $("#options-form"),
  btnPrev: $("#btn-prev"),
  btnNext: $("#btn-next"),
  btnFinish: $("#btn-finish"),
  result: $("#result-section"),
  resultSummary: $("#result-summary"),
  btnReview: $("#btn-review"),
  btnRestart: $("#btn-restart"),
  actions: document.querySelector(".actions"),
};

let engine = /** @type {QuizEngine|null} */ (null);
let timerId = /** @type {number|undefined} */ (undefined);
let reviewMode = false;

document.addEventListener("DOMContentLoaded", async () => {
  const quiz = await loadQuiz();
  els.title.textContent = quiz.title;

  const saved = StorageService.loadState();
  engine = saved ? QuizEngine.fromState(quiz, saved) : new QuizEngine(quiz);

  bindEvents();

  if (engine.isFinished) {
    const summary = engine.finish();
    renderResult(summary);
  } else {
    renderAll();
    startTimer();
  }
});

async function loadQuiz() {
  const res = await fetch(DATA_URL);
  /** @type {QuizDTO} */
  const data = await res.json();

  if (!data?.questions?.length) {
    throw new Error("Некорректные данные теста");
  }

  return data;
}

function startTimer() {
  stopTimer();

  timerId = window.setInterval(() => {
    const finishedByTimer = engine.tick();

    persist();
    renderTimer();

    if (finishedByTimer) {
      stopTimer();

      const summary = engine.finish();
      renderResult(summary);
      renderNav();
    }
  }, 1000);
}

function stopTimer() {
  if (timerId) {
    clearInterval(timerId);
    timerId = undefined;
  }
}

function bindEvents() {
  els.btnPrev.addEventListener("click", () => {
    engine.prev();
    persist();
    renderAll();
  });

  els.btnNext.addEventListener("click", () => {
    engine.next();
    persist();
    renderAll();
  });

  els.btnFinish.addEventListener("click", () => {
    const summary = engine.finish();
    if (summary) {
      stopTimer();
      renderResult(summary);
      persist();
    }
  });

  els.btnReview.addEventListener("click", () => {
    reviewMode = true;
    els.qSection.classList.remove("hidden");
    els.actions.classList.remove("hidden");
    renderAll();
  });

  els.btnRestart.addEventListener("click", () => {
    StorageService.clear();
    window.location.reload();
  });

  els.form.addEventListener("change", (e) => {
    const target = /** @type {HTMLInputElement} */ (e.target);
    if (target?.name === "option") {
      const idx = Number(target.value);
      engine.select(idx);
      persist();
      renderNav();
    }
  });
}

function renderAll() {
  renderProgress();
  renderTimer();
  renderQuestion();
  renderNav();
}

function renderProgress() {
  els.progress.textContent = `Вопрос ${engine.currentIndex + 1} из ${engine.length}`;
}

function renderTimer() {
  const sec = engine.remainingSec ?? 0;
  const m = Math.floor(sec / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, "0");
  els.timer.textContent = `${m}:${s}`;
}

function renderQuestion() {
  const q = engine.currentQuestion;
  els.qText.textContent = q.text;

  els.form.innerHTML = "";
  q.options.forEach((opt, i) => {
    const id = `opt-${q.id}-${i}`;
    const wrapper = document.createElement("label");
    wrapper.className = "option";

    if (reviewMode) {
      const chosen = engine.answers[q.id];
      if (i === q.correctIndex) wrapper.classList.add("correct");
      if (chosen === i && i !== q.correctIndex) {
        wrapper.classList.add("incorrect");
      }
    }

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "option";
    input.value = String(i);
    input.id = id;
    input.checked = engine.getSelectedIndex() === i;

    const span = document.createElement("span");
    span.textContent = opt;

    wrapper.appendChild(input);
    wrapper.appendChild(span);
    els.form.appendChild(wrapper);
  });
}

function renderNav() {
  const selectedIndex = engine.getSelectedIndex();
  const hasSelection = selectedIndex !== undefined;

  els.btnPrev.disabled = engine.currentIndex === 0;
  els.btnNext.disabled =
    engine.currentIndex >= engine.length - 1 || !hasSelection;
  els.btnFinish.disabled =
    engine.currentIndex !== engine.length - 1 || !hasSelection;
}

function renderResult(summary) {
  els.result.classList.remove("hidden");
  els.qSection.classList.add("hidden");
  els.actions.classList.add("hidden");

  const status = summary.passed ? "Пройден" : "Не пройден";
  els.resultSummary.textContent = `${summary.correct} / ${summary.total} (${summary.percent}%) — ${status}`;
}

function persist() {
  StorageService.saveState(engine.toState());
}
