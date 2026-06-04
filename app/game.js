window.initDualNBack = function initDualNBack(options = {}) {        const $ = (id) => document.getElementById(id);

        const els = {
          grid: $("grid"),
          btnStart: $("btnStart"),
          btnReset: $("btnReset"),
          btnHelp: $("btnHelp"),
          btnSettings: $("btnSettings"),
          dlgSettings: $("dlgSettings"),
          btnCloseSettings: $("btnCloseSettings"),
          stRound: $("stRound"),
          stN: $("stN"),
          stTrial: $("stTrial"),
          stScore: $("stScore"),
          indRun: $("indRun"),
          ansV: $("ansV"),
          ansA: $("ansA"),
          hitV: $("hitV"),
          hitA: $("hitA"),
          log: $("log"),
          toast: $("toast"),
          flashLeft: $("flashLeft"),
          flashRight: $("flashRight"),
          dlgHelp: $("dlgHelp"),
          btnCloseHelp: $("btnCloseHelp"),
          btnInfo: $("btnInfo"),
          statsBar: $("statsBar"),
          form: $("form"),
          inpN: $("inpN"),
          inpTrials: $("inpTrials"),
          inpStimMs: $("inpStimMs"),
          inpIsiMs: $("inpIsiMs"),
          selAudioMode: $("selAudioMode"),
          rngVol: $("rngVol"),
          rngTargetRate: $("rngTargetRate"),
          selCaption: $("selCaption"),
        };

        const LS_KEY = "dual-n-back:v1";

        const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
        const nowMs = () => performance.now();
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

        function fmtPct(x) {
          if (!Number.isFinite(x)) return "-";
          return `${Math.round(x * 100)}%`;
        }

        function showToast(text) {
          els.toast.textContent = text;
          els.toast.classList.add("show");
          window.clearTimeout(showToast._t);
          showToast._t = window.setTimeout(() => els.toast.classList.remove("show"), 1400);
        }

        function flashHalf(side, ok) {
          const el = side === "left" ? els.flashLeft : els.flashRight;
          if (!el) return;
          const rect = els.grid.getBoundingClientRect();
          const half = rect.width / 2;
          el.style.top = `${rect.top}px`;
          el.style.left = side === "left" ? `${rect.left}px` : `${rect.left + half}px`;
          el.style.width = `${half}px`;
          el.style.height = `${rect.height}px`;
          el.classList.remove("ok", "bad", "show");
          el.classList.add(ok ? "ok" : "bad", "show");
          window.clearTimeout(flashHalf[side]);
          flashHalf[side] = window.setTimeout(() => {
            el.classList.remove("show");
          }, 180);
        }

        function logLine(html) {
          const div = document.createElement("div");
          div.innerHTML = html;
          els.log.appendChild(div);
          els.log.scrollTop = els.log.scrollHeight;
        }

        function clearLog() {
          els.log.innerHTML =
            '<div class="muted">Ready. Check settings and press <strong>Start</strong>.</div>';
        }

        function randInt(n) {
          return Math.floor(Math.random() * n);
        }

        // --- Audio: tone + optional speech ---
        const SYMBOLS = Array.from({ length: 26 }, (_, i) =>
          String.fromCharCode("A".charCodeAt(0) + i)
        );
        const FREQS = SYMBOLS.map((_, i) => 220 * Math.pow(2, i / 12));

        const SUBTITLE_DEFAULT = "Visual (position) + auditory (A–Z) memory training";
        const LETTER_NAMES = {
          A: "ay", B: "bee", C: "see", D: "dee", E: "ee", F: "eff", G: "jee", H: "aych",
          I: "eye", J: "jay", K: "kay", L: "ell", M: "em", N: "en", O: "oh", P: "pee",
          Q: "cue", R: "are", S: "ess", T: "tee", U: "you", V: "vee", W: "double you",
          X: "ex", Y: "why", Z: "zee",
        };

        let audioCtx = null;
        function getAudioCtx() {
          if (audioCtx) return audioCtx;
          const Ctx = window.AudioContext || window.webkitAudioContext;
          if (!Ctx) return null;
          audioCtx = new Ctx();
          return audioCtx;
        }

        async function unlockAudioHard() {
          const ctx = getAudioCtx();
          if (!ctx) return;
          try {
            const buffer = ctx.createBuffer(1, 1, 22050);
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(ctx.destination);
            source.start(0);
            if (ctx.state === "suspended") await ctx.resume();
          } catch (_) {}
        }

        async function ensureAudioUnlocked() {
          const ctx = getAudioCtx();
          if (!ctx) return;
          if (ctx.state === "suspended") {
            try {
              await ctx.resume();
            } catch (_) {}
          }
        }

        let preferredEnVoice = null;

        function pickEnglishVoice() {
          if (!window.speechSynthesis) return null;
          const voices = window.speechSynthesis.getVoices();
          if (!voices.length) return preferredEnVoice;
          const ranked = voices.filter((v) => v.lang && /^en(-|$)/i.test(v.lang));
          const prefer = (list) =>
            list.find((v) => /samantha|alex|daniel|karen|moira|victoria|fred|english/i.test(v.name)) ||
            list.find((v) => v.lang === "en-US") ||
            list.find((v) => v.lang.startsWith("en")) ||
            null;
          preferredEnVoice = prefer(ranked) || prefer(voices);
          return preferredEnVoice;
        }

        function playTone(idx, vol, durationMs) {
          const ctx = getAudioCtx();
          if (!ctx) return;
          const t0 = ctx.currentTime;
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = "sine";
          osc.frequency.value = FREQS[idx % FREQS.length];
          g.gain.setValueAtTime(0.0001, t0);
          g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol), t0 + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + durationMs / 1000);
          osc.connect(g);
          g.connect(ctx.destination);
          osc.start(t0);
          osc.stop(t0 + durationMs / 1000 + 0.02);
        }

        function playFeedback(ok) {
          const ctx = getAudioCtx();
          if (!ctx) return;
          const t0 = ctx.currentTime;
          const volume = Math.max(0.04, state.vol * 0.5);

          const make = (freq, start, dur, type = "sine") => {
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, start);
            g.gain.setValueAtTime(0.0001, start);
            g.gain.exponentialRampToValueAtTime(volume, start + 0.01);
            g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
            osc.connect(g);
            g.connect(ctx.destination);
            osc.start(start);
            osc.stop(start + dur + 0.015);
          };

          if (ok) {
            // 띵동
            make(880, t0, 0.09, "sine");
            make(1174.66, t0 + 0.11, 0.13, "sine");
          } else {
            // 에엥
            make(320, t0, 0.11, "sawtooth");
            make(240, t0 + 0.09, 0.16, "sawtooth");
          }
        }

        function speakSymbol(symbol) {
          if (!("speechSynthesis" in window)) return false;
          const u = new SpeechSynthesisUtterance(LETTER_NAMES[symbol] || symbol);
          u.rate = 0.95;
          u.pitch = 1.0;
          u.volume = 1;
          u.lang = "en-US";
          const voice = pickEnglishVoice();
          if (voice) u.voice = voice;
          try {
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(u);
            return true;
          } catch (_) {
            return false;
          }
        }

        async function primeSpeechAudible() {
          await unlockAudioHard();
          await ensureAudioUnlocked();
          pickEnglishVoice();
          const idx = 0;
          playTone(idx, Math.max(0.35, state.vol), 180);
          speakSymbol("A");
        }

        async function playStimulusAudio(aud, symbol) {
          await ensureAudioUnlocked();
          const dur = Math.min(420, Math.max(220, state.stimMs));
          const vol = Math.max(0.2, state.vol);

          if (state.audioMode === "off") return;

          if (state.audioMode === "tone") {
            playTone(aud, vol, dur);
            return;
          }

          if (state.audioMode === "speech") {
            if (!speakSymbol(symbol)) playTone(aud, vol, dur);
            return;
          }

          if (state.audioMode === "tone+speech") {
            playTone(aud, vol * 0.55, dur);
            window.setTimeout(() => {
              if (!speakSymbol(symbol)) playTone(aud, vol, dur);
            }, 60);
          }
        }

        // --- Game state ---
        const state = {
          running: false,
          round: 1,
          n: 2,
          trials: 30,
          stimMs: 500,
          isiMs: 1500,
          audioMode: "speech",
          vol: 0.4,
          targetRate: 0.25,
          caption: "off",
          // generated per round
          seqPos: [],
          seqAud: [],
          // per trial input tracking
          trialIdx: -1,
          trialOpenedAt: 0,
          pressedV: false,
          pressedA: false,
          // scoring
          score: 0,
          hitsV: 0,
          hitsA: 0,
          faV: 0,
          faA: 0,
          missV: 0,
          missA: 0,
          correctRejV: 0,
          correctRejA: 0,
        };

        function loadSettings() {
          try {
            const raw = localStorage.getItem(LS_KEY);
            if (!raw) return;
            const s = JSON.parse(raw);
            if (!s || typeof s !== "object") return;
            state.n = clamp(Number(s.n) || 2, 1, 6);
            state.trials = clamp(Number(s.trials) || 30, 10, 120);
            state.stimMs = clamp(Number(s.stimMs) || 500, 300, 1500);
            state.isiMs = clamp(Number(s.isiMs) || 1500, 300, 2500);
            state.audioMode = typeof s.audioMode === "string" ? s.audioMode : "speech";
            state.vol = clamp(Number(s.vol) ?? 0.4, 0, 1);
            state.targetRate = clamp(Number(s.targetRate) || 0.25, 0.1, 0.5);
            state.caption = s.caption === "on" ? "on" : "off";
          } catch (_) {}
        }

        function saveSettings() {
          const s = {
            n: state.n,
            trials: state.trials,
            stimMs: state.stimMs,
            isiMs: state.isiMs,
            audioMode: state.audioMode,
            vol: state.vol,
            targetRate: state.targetRate,
            caption: state.caption,
          };
          try {
            localStorage.setItem(LS_KEY, JSON.stringify(s));
          } catch (_) {}
        }

        function syncFormFromState() {
          els.inpN.value = String(state.n);
          els.inpTrials.value = String(state.trials);
          els.inpStimMs.value = String(state.stimMs);
          els.inpIsiMs.value = String(state.isiMs);
          els.selAudioMode.value = state.audioMode;
          els.rngVol.value = String(state.vol);
          els.rngTargetRate.value = String(state.targetRate);
          els.selCaption.value = state.caption;
        }

        function syncStateFromForm() {
          state.n = clamp(parseInt(els.inpN.value, 10) || 2, 1, 6);
          state.trials = clamp(parseInt(els.inpTrials.value, 10) || 30, 10, 120);
          state.stimMs = clamp(parseInt(els.inpStimMs.value, 10) || 500, 300, 1500);
          state.isiMs = clamp(parseInt(els.inpIsiMs.value, 10) || 1500, 300, 2500);
          state.isiMs = Math.max(state.isiMs, state.stimMs);
          state.audioMode = els.selAudioMode.value;
          state.vol = clamp(parseFloat(els.rngVol.value) || 0, 0, 1);
          state.targetRate = clamp(parseFloat(els.rngTargetRate.value) || 0.25, 0.1, 0.5);
          state.caption = els.selCaption.value === "on" ? "on" : "off";
          saveSettings();
          syncFormFromState();
          renderHeader();
        }

        function resetRoundStats() {
          state.score = 0;
          state.hitsV = 0;
          state.hitsA = 0;
          state.faV = 0;
          state.faA = 0;
          state.missV = 0;
          state.missA = 0;
          state.correctRejV = 0;
          state.correctRejA = 0;
        }

        function resetRuntime() {
          state.running = false;
          state.trialIdx = -1;
          state.pressedV = false;
          state.pressedA = false;
          state.seqPos = [];
          state.seqAud = [];
          els.btnStart.textContent = "Start";
          els.btnStart.disabled = false;
          els.btnReset.disabled = false;
          els.indRun.classList.remove("live");
          els.ansV.textContent = "-";
          els.ansA.textContent = "-";
          els.hitV.textContent = "-";
          els.hitA.textContent = "-";
          clearGridActive();
          renderHeader();
        }

        function clearGridActive() {
          const cells = els.grid.querySelectorAll(".cell");
          for (const c of cells) c.classList.remove("active");
        }

        function buildGrid() {
          els.grid.innerHTML = "";
          for (let i = 0; i < 9; i++) {
            const cell = document.createElement("div");
            cell.className = "cell";
            cell.setAttribute("role", "gridcell");
            cell.setAttribute("aria-label", `칸 ${i + 1}`);
            cell.dataset.idx = String(i);
            const dot = document.createElement("div");
            dot.className = "dot";
            cell.appendChild(dot);
            els.grid.appendChild(cell);
          }
          els.grid.setAttribute("role", "grid");
          els.grid.setAttribute("aria-rowcount", "3");
          els.grid.setAttribute("aria-colcount", "3");
        }

        function renderHeader() {
          els.stRound.textContent = `${state.round}`;
          els.stN.textContent = `${state.n}`;
          els.stTrial.textContent =
            state.trialIdx < 0 ? `0 / ${state.trials}` : `${state.trialIdx + 1} / ${state.trials}`;
          els.stScore.textContent = `${state.score}`;
        }

        function setFormDisabled(disabled) {
          els.form.querySelectorAll("input, select").forEach((el) => {
            el.disabled = disabled;
          });
        }

        function setRunningUI(running) {
          state.running = running;
          setFormDisabled(running);
          if (running) {
            els.indRun.classList.add("live");
            els.btnStart.disabled = true;
            els.btnReset.disabled = true;
          } else {
            els.indRun.classList.remove("live");
            els.btnStart.textContent = "Start";
            els.btnStart.disabled = false;
            els.btnReset.disabled = false;
          }
        }

        function toggleStatsPanel() {
          if (!els.statsBar || !els.btnInfo) return;
          const hidden = els.statsBar.classList.toggle("stats-hidden");
          const show = !hidden;
          els.btnInfo.setAttribute("aria-pressed", show ? "true" : "false");
          els.btnInfo.textContent = show ? "HIDE" : "INFO";
        }

        function genSequenceWithTargets({ length, symbolsCount, n, targetRate }) {
          const seq = new Array(length);
          for (let i = 0; i < length; i++) seq[i] = randInt(symbolsCount);

          const targetIndices = [];
          for (let i = n; i < length; i++) {
            if (Math.random() < targetRate) targetIndices.push(i);
          }
          // enforce targets
          for (const i of targetIndices) {
            seq[i] = seq[i - n];
          }

          // When n>=2, suppress most accidental 1-back repeats so n=2/3 feels distinct from n=1.
          if (n >= 2) {
            for (let i = 1; i < length; i++) {
              if (targetIndices.includes(i)) continue;
              if (seq[i] === seq[i - 1]) {
                let v = seq[i];
                for (let k = 0; k < 8; k++) {
                  v = randInt(symbolsCount);
                  if (v !== seq[i - 1] && (i < n || v !== seq[i - n])) break;
                }
                seq[i] = v;
              }
            }
          }

          // reduce accidental targets slightly by nudging non-target positions
          for (let i = n; i < length; i++) {
            if (targetIndices.includes(i)) continue;
            if (seq[i] === seq[i - n] && Math.random() < 0.75) {
              let v = seq[i];
              for (let k = 0; k < 6; k++) {
                v = randInt(symbolsCount);
                if (v !== seq[i - n]) break;
              }
              seq[i] = v;
            }
          }
          return seq;
        }

        function isMatch(seq, i, n) {
          if (i < n) return false;
          return seq[i] === seq[i - n];
        }

        function acc(hits, misses, fas, crs) {
          const denom = hits + misses + fas + crs;
          if (!denom) return NaN;
          return (hits + crs) / denom;
        }

        function scoreHit() {
          state.score += 2;
        }
        function scoreFA() {
          state.score -= 1;
        }
        function scoreMiss() {
          state.score -= 1;
        }
        function scoreCR() {
          // no-op
        }

        function resetPerTrialInputs() {
          state.pressedV = false;
          state.pressedA = false;
          els.hitV.textContent = "-";
          els.hitA.textContent = "-";
        }

        function setAnswerChips(vAns, aAns) {
          els.ansV.textContent = vAns ? "match" : "none";
          els.ansA.textContent = aAns ? "match" : "none";
        }

        function markHitUI(which, ok) {
          const el = which === "V" ? els.hitV : els.hitA;
          el.textContent = ok ? "hit" : "miss";
          el.style.color = ok ? "var(--good)" : "var(--bad)";
          window.setTimeout(() => {
            el.style.color = "";
          }, 450);
        }

        function updateScoreUI() {
          els.stScore.textContent = `${state.score}`;
        }

        function finalizeTrialJudgement(trialIndex) {
          const n = state.n;
          const vAns = isMatch(state.seqPos, trialIndex, n);
          const aAns = state.audioMode === "off" ? false : isMatch(state.seqAud, trialIndex, n);

          // Visual
          if (vAns && state.pressedV) {
            state.hitsV++;
            scoreHit();
          } else if (vAns && !state.pressedV) {
            state.missV++;
            scoreMiss();
            flashHalf("right", false);
          } else if (!vAns && state.pressedV) {
            state.faV++;
            scoreFA();
          } else {
            state.correctRejV++;
            scoreCR();
          }

          // Audio
          if (state.audioMode !== "off") {
            if (aAns && state.pressedA) {
              state.hitsA++;
              scoreHit();
            } else if (aAns && !state.pressedA) {
              state.missA++;
              scoreMiss();
              flashHalf("left", false);
            } else if (!aAns && state.pressedA) {
              state.faA++;
              scoreFA();
            } else {
              state.correctRejA++;
              scoreCR();
            }
          }
        }

        function renderRoundSummary() {
          const vAcc = acc(state.hitsV, state.missV, state.faV, state.correctRejV);
          const aAcc =
            state.audioMode === "off"
              ? NaN
              : acc(state.hitsA, state.missA, state.faA, state.correctRejA);

          logLine(
            `<div class="muted">— 라운드 종료 —</div>
             <div>점수: <strong>${state.score}</strong></div>
             <div>시각: <span class="good">히트 ${state.hitsV}</span>, <span class="bad">오답 ${state.faV}</span>, 놓침 ${state.missV}, 정거절 ${state.correctRejV}, 정확도 ${fmtPct(vAcc)}</div>
             <div>청각: ${
               state.audioMode === "off"
                 ? '<span class="muted">꺼짐</span>'
                 : `<span class="good">히트 ${state.hitsA}</span>, <span class="bad">오답 ${state.faA}</span>, 놓침 ${state.missA}, 정거절 ${state.correctRejA}, 정확도 ${fmtPct(aAcc)}`
             }</div>`
          );
        }

        function highlightPosition(posIdx) {
          clearGridActive();
          const cell = els.grid.querySelector(`.cell[data-idx="${posIdx}"]`);
          if (cell) cell.classList.add("active");
        }

        function renderCaption(symbol) {
          if (state.caption !== "on") return;
          const sub = $("subtitle");
          sub.textContent = `Audio: ${symbol}`;
          window.clearTimeout(renderCaption._t);
          renderCaption._t = window.setTimeout(() => {
            sub.textContent = SUBTITLE_DEFAULT;
          }, Math.max(600, state.isiMs * 0.6));
        }

        async function presentStimulus(trialIndex) {
          const pos = state.seqPos[trialIndex];
          const aud = state.seqAud[trialIndex];

          highlightPosition(pos);
          state.trialOpenedAt = nowMs();
          resetPerTrialInputs();

          const n = state.n;
          const vAns = isMatch(state.seqPos, trialIndex, n);
          const aAns = state.audioMode === "off" ? false : isMatch(state.seqAud, trialIndex, n);
          setAnswerChips(vAns, aAns);

          if (state.audioMode !== "off") {
            const symbol = SYMBOLS[aud];
            await playStimulusAudio(aud, symbol);
            renderCaption(symbol);
          }
        }

        function handlePress(which) {
          if (!state.running) return;
          if (state.trialIdx < 0 || state.trialIdx >= state.trials) return;
          const i = state.trialIdx;
          const n = state.n;
          if (which === "V") {
            if (state.pressedV) return;
            state.pressedV = true;
            const ok = isMatch(state.seqPos, i, n);
            markHitUI("V", ok);
            flashHalf("right", ok);
            playFeedback(ok);
            showToast(ok ? "Visual: correct" : "Visual: wrong");
          } else if (which === "A") {
            if (state.audioMode === "off") {
              showToast("Audio is off");
              return;
            }
            if (state.pressedA) return;
            state.pressedA = true;
            const ok = isMatch(state.seqAud, i, n);
            markHitUI("A", ok);
            flashHalf("left", ok);
            playFeedback(ok);
            showToast(ok ? "Audio: correct" : "Audio: wrong");
          }
        }

        // Main loop uses a run token to cancel safely
        let runToken = 0;
        async function runRound() {
          runToken++;
          const token = runToken;

          syncStateFromForm();
          resetRoundStats();
          clearLog();
          logLine(`<div class="muted">라운드 ${state.round} 시작 · N=${state.n} · ${state.trials} trials</div>`);

          await ensureAudioUnlocked();

          const len = state.trials;
          state.seqPos = genSequenceWithTargets({
            length: len,
            symbolsCount: 9,
            n: state.n,
            targetRate: state.targetRate,
          });
          state.seqAud = genSequenceWithTargets({
            length: len,
            symbolsCount: SYMBOLS.length,
            n: state.n,
            targetRate: state.targetRate,
          });

          state.trialIdx = 0;
          setRunningUI(true);
          renderHeader();

          // countdown
          showToast("Starting…");
          await sleep(250);

          while (state.trialIdx < state.trials) {
            if (token !== runToken) return;

            const i = state.trialIdx;
            renderHeader();
            await presentStimulus(i);

            // keep stimulus visible for stimMs
            const tStart = nowMs();
            while (nowMs() - tStart < state.stimMs) {
              if (token !== runToken) return;
              await sleep(16);
            }

            // stimulus off — blank ISI; input stays open until full trial interval ends
            clearGridActive();

            const remaining = Math.max(0, state.isiMs - state.stimMs);
            const tIsi = nowMs();
            while (nowMs() - tIsi < remaining) {
              if (token !== runToken) return;
              await sleep(16);
            }

            finalizeTrialJudgement(i);
            updateScoreUI();

            const vAns = isMatch(state.seqPos, i, state.n);
            const aAns = state.audioMode === "off" ? false : isMatch(state.seqAud, i, state.n);
            const vTag = vAns ? "V✓" : "V·";
            const aTag = state.audioMode === "off" ? "A-" : aAns ? "A✓" : "A·";
            const vIn = state.pressedV ? "V!" : "V ";
            const aIn = state.audioMode === "off" ? "A-" : state.pressedA ? "A!" : "A ";
            logLine(
              `<span class="muted">#${i + 1}</span> <span>${vTag}/${aTag}</span> <span class="muted">in ${vIn}/${aIn}</span>`
            );

            state.trialIdx++;
          }

          if (token !== runToken) return;
          setRunningUI(false);
          renderHeader();
          renderRoundSummary();
          showToast("Round complete");
        }

        async function startGame() {
          if (state.running) return;
          await primeSpeechAudible();
          runRound();
        }

        function hardReset() {
          runToken++;
          state.round = 1;
          resetRoundStats();
          resetRuntime();
          clearLog();
          showToast("Reset");
          $("subtitle").textContent = SUBTITLE_DEFAULT;
        }

        function nextRound() {
          state.round++;
          resetRoundStats();
          resetRuntime();
          clearLog();
        }

        // UI events
        els.btnStart.addEventListener("click", startGame);
        els.btnReset.addEventListener("click", hardReset);
        if (els.btnInfo) {
          els.btnInfo.addEventListener("click", () => toggleStatsPanel());
        }
        els.btnHelp.addEventListener("click", () => {
          try {
            els.dlgHelp.showModal();
          } catch (_) {
            alert("L: visual match, A: audio match. Press when same as N trials ago.");
          }
        });
        els.btnCloseHelp.addEventListener("click", () => els.dlgHelp.close());

        if (els.btnSettings && els.dlgSettings) {
          els.btnSettings.addEventListener("click", () => {
            if (state.running) {
              showToast("게임 중에는 설정을 바꿀 수 없어요");
            }
            try {
              els.dlgSettings.showModal();
            } catch (_) {
              alert("설정 창을 열 수 없어요. 브라우저를 업데이트해 주세요.");
            }
          });
          els.btnCloseSettings.addEventListener("click", () => els.dlgSettings.close());
        }

        els.form.addEventListener("input", () => {
          if (state.running) return;
          syncStateFromForm();
        });

        // Keyboard
        window.addEventListener("keydown", (e) => {
          if (e.repeat) return;
          const key = e.key.toLowerCase();
          if (key === "a") {
            e.preventDefault();
            handlePress("A");
            return;
          }
          if (key === "l") {
            e.preventDefault();
            handlePress("V");
            return;
          }
          if (key === "i") {
            e.preventDefault();
            toggleStatsPanel();
            return;
          }
          if (key === "r") {
            e.preventDefault();
            if (!state.running) hardReset();
            return;
          }
          if (key === "enter") {
            if (document.activeElement && ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) {
              return;
            }
            e.preventDefault();
            startGame();
          }
        });

        document.addEventListener(
          "pointerdown",
          () => {
            unlockAudioHard();
          },
          { once: false, passive: true }
        );

        if (window.speechSynthesis) {
          window.speechSynthesis.addEventListener("voiceschanged", pickEnglishVoice);
          pickEnglishVoice();
        }

        // Double click log to start next round
        els.log.addEventListener("dblclick", () => {
          if (state.running) return;
          nextRound();
          showToast(`Round ${state.round} ready`);
        });

        // Initialization
        buildGrid();
        loadSettings();
        syncFormFromState();
        clearLog();
        resetRuntime();
        renderHeader();

        if (options.registerSw && "serviceWorker" in navigator) {
          navigator.serviceWorker.register(options.swPath || "./sw.js").catch(() => {});
        }
};
