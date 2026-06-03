window.initDualNBack = function initDualNBack(options = {}) {        const $ = (id) => document.getElementById(id);

        const els = {
          grid: $("grid"),
          btnStart: $("btnStart"),
          btnStartText: $("btnStartText"),
          buildTag: $("buildTag"),
          btnReset: $("btnReset"),
          btnHelp: $("btnHelp"),
          btnSettings: $("btnSettings"),
          btnStats: $("btnStats"),
          dlgSettings: $("dlgSettings"),
          btnCloseSettings: $("btnCloseSettings"),
          btnTouchSound: $("btnTouchSound"),
          btnTouchPosition: $("btnTouchPosition"),
          statsBar: $("statsBar"),
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
        const isIOS =
          /iPad|iPhone|iPod/.test(navigator.userAgent) ||
          (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

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
            '<div class="muted">Ready. Check settings and tap <strong>START</strong>.</div>';
        }

        function randInt(n) {
          return Math.floor(Math.random() * n);
        }

        // --- Audio: tone + optional speech ---
        const SYMBOLS = Array.from({ length: 26 }, (_, i) =>
          String.fromCharCode("A".charCodeAt(0) + i)
        );
        const FREQS = SYMBOLS.map((_, i) => 220 * Math.pow(2, i / 12));

        let audioCtx = null;
        let audioUnlocked = false;

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
            if (ctx.state === "suspended") await ctx.resume();
            audioUnlocked = true;
          } catch (_) {}
        }

        async function ensureAudioUnlocked() {
          const ctx = getAudioCtx();
          if (!ctx) return;
          if (ctx.state === "suspended") {
            try {
              await ctx.resume();
              audioUnlocked = true;
            } catch (_) {}
          } else {
            audioUnlocked = true;
          }
        }

        let preferredEnVoice = null;
        let voicesReady = false;

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
          voicesReady = !!preferredEnVoice || voices.length > 0;
          return preferredEnVoice;
        }

        const SUBTITLE_DEFAULT = "Visual (position) + auditory (A–Z) memory training";
        const LETTER_NAMES = {
          A: "ay", B: "bee", C: "see", D: "dee", E: "ee", F: "eff", G: "jee", H: "aych",
          I: "eye", J: "jay", K: "kay", L: "ell", M: "em", N: "en", O: "oh", P: "pee",
          Q: "cue", R: "are", S: "ess", T: "tee", U: "you", V: "vee", W: "double you",
          X: "ex", Y: "why", Z: "zee",
        };

        const BUILD_VER = "v17";
        const AUDIO_VER = BUILD_VER;
        const USE_ELEMENT_AUDIO = options.mobile || isIOS;
        const letterBlobUrls = Object.create(null);
        const letterBuffers = Object.create(null);
        let letterAudioReady = false;
        let activeClip = null;
        let activeBufferSource = null;
        let activeOscillators = [];
        let letterPlaySeq = 0;
        let letterBusy = false;
        let letterPlayChain = Promise.resolve();
        let sharedLetterAudio = null;
        let mobileLetterAudio = null;
        let roundLock = false;

        function getMobileLetterAudio() {
          if (!mobileLetterAudio) {
            mobileLetterAudio = new Audio();
            mobileLetterAudio.preload = "auto";
            mobileLetterAudio.playsInline = true;
            mobileLetterAudio.setAttribute("playsinline", "");
          }
          return mobileLetterAudio;
        }

        function stopLetterAudio() {
          letterPlaySeq++;
          letterBusy = false;
          if (mobileLetterAudio) {
            try {
              mobileLetterAudio.pause();
            } catch (_) {}
          }
          for (const osc of activeOscillators) {
            try {
              osc.stop();
            } catch (_) {}
          }
          activeOscillators = [];
          if (activeClip) {
            try {
              activeClip.pause();
              activeClip.currentTime = 0;
              activeClip.removeAttribute("src");
              activeClip.load();
            } catch (_) {}
            activeClip = null;
          }
          if (sharedLetterAudio) {
            try {
              sharedLetterAudio.pause();
              sharedLetterAudio.currentTime = 0;
              sharedLetterAudio.removeAttribute("src");
              sharedLetterAudio.load();
            } catch (_) {}
          }
          if (activeBufferSource) {
            try {
              activeBufferSource.stop();
            } catch (_) {}
            activeBufferSource = null;
          }
          if (window.speechSynthesis) {
            try {
              window.speechSynthesis.cancel();
            } catch (_) {}
          }
        }

        async function playLetterSpeech(symbol) {
          if (!("speechSynthesis" in window)) return false;
          const word = LETTER_NAMES[symbol] || symbol;
          const seq = letterPlaySeq;
          letterBusy = true;
          return new Promise((resolve) => {
            let settled = false;
            const finish = (ok) => {
              if (settled) return;
              settled = true;
              if (seq === letterPlaySeq) letterBusy = false;
              resolve(ok && seq === letterPlaySeq);
            };
            const u = new SpeechSynthesisUtterance(word);
            u.lang = "en-US";
            u.rate = 0.86;
            u.pitch = 1;
            u.volume = Math.min(1, Math.max(0.55, state.vol));
            const voice = pickEnglishVoice();
            if (voice) u.voice = voice;
            u.onend = () => finish(true);
            u.onerror = () => finish(false);
            try {
              window.speechSynthesis.cancel();
              window.speechSynthesis.speak(u);
            } catch (_) {
              finish(false);
              return;
            }
            window.setTimeout(() => finish(false), 1100);
          });
        }

        async function playLetterMobileWav(symbol) {
          const a = getMobileLetterAudio();
          const url = `./audio/${symbol}.wav?${AUDIO_VER}`;
          const seq = letterPlaySeq;
          letterBusy = true;
          a.volume = Math.min(1, Math.max(0.5, state.vol));
          try {
            if (!a.paused) a.pause();
            if (!a.src || !a.src.includes(`${symbol}.wav`)) a.src = url;
            a.currentTime = 0;
            await a.play();
            if (seq !== letterPlaySeq) return false;
            await new Promise((resolve) => {
              let settled = false;
              const done = () => {
                if (settled) return;
                settled = true;
                a.removeEventListener("ended", done);
                a.removeEventListener("error", done);
                if (seq === letterPlaySeq) letterBusy = false;
                resolve();
              };
              a.addEventListener("ended", done);
              a.addEventListener("error", done);
              const ms = Math.max(420, Math.ceil((a.duration || 0.55) * 1000) + 80);
              window.setTimeout(done, ms);
            });
            return seq === letterPlaySeq;
          } catch (_) {
            if (seq === letterPlaySeq) letterBusy = false;
            return false;
          }
        }

        async function playLetterMobile(symbol, seq) {
          const bufPlay = playLetterBuffer(symbol, seq);
          if (!bufPlay) return false;
          const ok = await bufPlay;
          if (ok) await sleep(60);
          return ok;
        }

        async function loadLetterBuffers() {
          if (letterAudioReady) return true;
          await ensureAudioUnlocked();
          const ctx = getAudioCtx();
          let loaded = 0;
          await Promise.all(
            SYMBOLS.map(async (sym) => {
              const url = `./audio/${sym}.wav?${AUDIO_VER}`;
              try {
                const res = await fetch(url, { cache: "no-store" });
                if (!res.ok) return;
                const blob = await res.blob();
                if (!USE_ELEMENT_AUDIO) letterBlobUrls[sym] = URL.createObjectURL(blob);
                if (ctx) {
                  const ab = await blob.arrayBuffer();
                  letterBuffers[sym] = await ctx.decodeAudioData(ab.slice(0));
                }
                loaded++;
              } catch (_) {}
            })
          );
          letterAudioReady = loaded >= 20;
          return letterAudioReady;
        }

        function playLetterBuffer(symbol, seq) {
          const ctx = getAudioCtx();
          const buf = letterBuffers[symbol];
          if (!ctx || !buf) return null;
          try {
            const t0 = ctx.currentTime;
            const peak = Math.min(1, Math.max(0.45, state.vol));
            const dur = buf.duration;
            const src = ctx.createBufferSource();
            const g = ctx.createGain();
            src.buffer = buf;
            g.gain.setValueAtTime(0.001, t0);
            g.gain.linearRampToValueAtTime(peak, t0 + 0.02);
            g.gain.setValueAtTime(peak, Math.max(t0 + 0.03, t0 + dur - 0.05));
            g.gain.linearRampToValueAtTime(0.001, t0 + dur);
            src.connect(g);
            g.connect(ctx.destination);
            activeBufferSource = src;
            letterBusy = true;
            return new Promise((resolve) => {
              let settled = false;
              const done = () => {
                if (settled) return;
                settled = true;
                if (activeBufferSource === src) activeBufferSource = null;
                if (seq === letterPlaySeq) letterBusy = false;
                resolve(seq === letterPlaySeq);
              };
              src.onended = done;
              src.start(t0);
              src.stop(t0 + dur + 0.02);
              window.setTimeout(done, Math.ceil(dur * 1000) + 120);
            });
          } catch (_) {
            letterBusy = false;
            return null;
          }
        }

        async function waitLetterIdle(maxMs = 720) {
          const t0 = nowMs();
          while (letterBusy && nowMs() - t0 < maxMs) {
            await sleep(20);
          }
        }

        async function playLetterClip(symbol) {
          const prev = letterPlayChain;
          let release = () => {};
          letterPlayChain = new Promise((r) => {
            release = r;
          });
          await prev;
          try {
            return await playLetterClipInner(symbol);
          } finally {
            release();
          }
        }

        async function playLetterClipInner(symbol) {
          await waitLetterIdle(USE_ELEMENT_AUDIO ? 800 : 520);
          stopLetterAudio();
          const seq = letterPlaySeq;
          await ensureAudioUnlocked();
          if (!letterAudioReady) await loadLetterBuffers();
          if (seq !== letterPlaySeq) return false;

          if (USE_ELEMENT_AUDIO) {
            return playLetterMobile(symbol, seq);
          }

          const bufPlay = playLetterBuffer(symbol, seq);
          if (bufPlay) {
            const ok = await bufPlay;
            return ok && seq === letterPlaySeq;
          }

          const url = letterBlobUrls[symbol] || `./audio/${symbol}.wav?${AUDIO_VER}`;
          if (!sharedLetterAudio) {
            sharedLetterAudio = new Audio();
            sharedLetterAudio.playsInline = true;
            sharedLetterAudio.preload = "auto";
          }
          try {
            sharedLetterAudio.pause();
            sharedLetterAudio.currentTime = 0;
            sharedLetterAudio.src = url;
            sharedLetterAudio.volume = Math.max(0.35, state.vol);
            activeClip = sharedLetterAudio;
            letterBusy = true;
            await sharedLetterAudio.play();
            if (seq !== letterPlaySeq) return false;
            await new Promise((resolve) => {
              let settled = false;
              const done = () => {
                if (settled) return;
                settled = true;
                sharedLetterAudio.removeEventListener("ended", done);
                sharedLetterAudio.removeEventListener("error", done);
                if (seq === letterPlaySeq) letterBusy = false;
                resolve();
              };
              sharedLetterAudio.addEventListener("ended", done);
              sharedLetterAudio.addEventListener("error", done);
              const durMs = Math.max(
                380,
                Math.ceil((sharedLetterAudio.duration || 0.48) * 1000) + 120
              );
              window.setTimeout(done, durMs);
            });
            if (seq !== letterPlaySeq) return false;
            return true;
          } catch (_) {
            if (activeClip === sharedLetterAudio) activeClip = null;
            if (seq === letterPlaySeq) letterBusy = false;
          }
          return false;
        }

        function primeSpeech() {
          pickEnglishVoice();
          loadLetterBuffers();
        }

        async function primeSpeechAudible() {
          await unlockAudioHard();
          await ensureAudioUnlocked();
          if (!USE_ELEMENT_AUDIO) pickEnglishVoice();
          const ok = await loadLetterBuffers();
          if (!ok) showToast("Audio files missing — upload app/audio to GitHub");
        }

        function speakSymbol(symbol) {
          if (!("speechSynthesis" in window)) return;
          if (USE_ELEMENT_AUDIO) return;
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
          } catch (_) {}
        }

        async function playStimulusAudio(aud, symbol) {
          const dur = Math.min(420, Math.max(220, state.stimMs));
          const vol = Math.max(0.2, state.vol);

          if (state.audioMode === "off") return;

          if (state.audioMode === "tone") {
            playTone(aud, vol, dur);
            return;
          }

          if (USE_ELEMENT_AUDIO) {
            if (state.audioMode === "tone") {
              playTone(aud, vol, dur);
              return;
            }
            await playLetterClip(symbol);
            return;
          }

          if (state.audioMode === "speech") {
            stopLetterAudio();
            speakSymbol(symbol);
            return;
          }
          if (state.audioMode === "tone+speech") {
            stopLetterAudio();
            await playLetterClip(symbol);
            return;
          }
        }

        function playTone(idx, vol, durationMs) {
          const ctx = getAudioCtx();
          if (!ctx) return;
          const t0 = ctx.currentTime;
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = "sine";
          osc.frequency.value = FREQS[idx % FREQS.length];
          const peak = Math.max(0.08, vol);
          g.gain.setValueAtTime(0.001, t0);
          g.gain.linearRampToValueAtTime(peak, t0 + 0.02);
          g.gain.linearRampToValueAtTime(0.001, t0 + durationMs / 1000);
          osc.connect(g);
          g.connect(ctx.destination);
          osc.start(t0);
          const stopAt = t0 + durationMs / 1000 + 0.03;
          osc.stop(stopAt);
          activeOscillators.push(osc);
          osc.onended = () => {
            activeOscillators = activeOscillators.filter((o) => o !== osc);
          };
        }

        function playFeedback(_ok) {
          /* No correct/wrong beeps — visual flash + toast only */
        }

        // --- Game state ---
        const state = {
          running: false,
          paused: false,
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
          state.paused = false;
          state.trialIdx = -1;
          state.pressedV = false;
          state.pressedA = false;
          state.seqPos = [];
          state.seqAud = [];
          setFormDisabled(false);
          updateTouchMainButton();
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
            cell.setAttribute("aria-label", `Cell ${i + 1}`);
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
          if (!els.form) return;
          const lock = disabled && state.running;
          els.form.querySelectorAll("input, select, .step-btn").forEach((el) => {
            el.disabled = lock;
          });
        }

        function updateTouchMainButton() {
          if (!options.touchControls || !els.btnStart) return;
          document.getElementById("btnTouchPause")?.remove();
          const showStop = state.running && !state.paused;
          const text = showStop ? "STOP" : "START";
          if (els.btnStartText) els.btnStartText.textContent = text;
          els.btnStart.setAttribute("aria-label", text);
        }

        function setRunningUI(running) {
          state.running = running;
          setFormDisabled(running);
          if (running) {
            els.indRun.classList.add("live");
            if (!options.touchControls) els.btnStart.textContent = "Pause";
          } else {
            els.indRun.classList.remove("live");
            state.paused = false;
            if (!options.touchControls) els.btnStart.textContent = "START";
          }
          els.btnReset.disabled = false;
          updateTouchMainButton();
        }

        function setPausedUI(paused) {
          state.paused = paused;
          if (!state.running) {
            updateTouchMainButton();
            return;
          }
          if (paused) stopLetterAudio();
          if (!options.touchControls) els.btnStart.textContent = paused ? "Resume" : "Pause";
          els.indRun.classList.toggle("live", !paused);
          updateTouchMainButton();
        }

        function toggleStatsPanel() {
          if (!els.statsBar || !els.btnStats) return;
          const hidden = els.statsBar.classList.toggle("stats-hidden");
          const show = !hidden;
          els.btnStats.setAttribute("aria-pressed", show ? "true" : "false");
          els.btnStats.textContent = show ? "HIDE" : "INFO";
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
          els.ansV.textContent = vAns ? "Match" : "None";
          els.ansA.textContent = aAns ? "Match" : "None";
        }

        function markHitUI(which, ok) {
          const el = which === "V" ? els.hitV : els.hitA;
          el.textContent = ok ? "Correct" : "Wrong";
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
            `<div class="muted">— Round complete —</div>
             <div>Score: <strong>${state.score}</strong></div>
             <div>Visual: <span class="good">hits ${state.hitsV}</span>, <span class="bad">wrong ${state.faV}</span>, miss ${state.missV}, reject ${state.correctRejV}, acc ${fmtPct(vAcc)}</div>
             <div>Audio: ${
               state.audioMode === "off"
                 ? '<span class="muted">off</span>'
                 : `<span class="good">hits ${state.hitsA}</span>, <span class="bad">wrong ${state.faA}</span>, miss ${state.missA}, reject ${state.correctRejA}, acc ${fmtPct(aAcc)}`
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
          if (options.mobile || options.touchControls) {
            unlockAudioHard();
          }
          if (!state.running || state.paused) return;
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
          if (roundLock || state.running) return;
          roundLock = true;
          runToken++;
          const token = runToken;
          try {
          syncStateFromForm();
          if (USE_ELEMENT_AUDIO && state.audioMode !== "off") {
            state.audioMode = "speech";
            if (els.selAudioMode) els.selAudioMode.value = "speech";
          }
          resetRoundStats();
          clearLog();
          logLine(`<div class="muted">Round ${state.round} · N=${state.n} · ${state.trials} trials</div>`);

          state.trialIdx = 0;
          renderHeader();

          await unlockAudioHard();
          await ensureAudioUnlocked();
          await primeSpeechAudible();

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

          // countdown
          showToast("Starting…");
          await sleep(250);

          setRunningUI(true);
          setPausedUI(false);

          while (state.trialIdx < state.trials) {
            if (token !== runToken) break;

            if (state.paused) {
              await sleep(80);
              continue;
            }

            const i = state.trialIdx;
            renderHeader();
            await presentStimulus(i);

            // keep stimulus visible for stimMs
            const tStart = nowMs();
            while (nowMs() - tStart < state.stimMs) {
              if (token !== runToken) break;
              if (state.paused) break;
              await sleep(16);
            }

            // stimulus off — blank ISI; input stays open until full trial interval ends
            clearGridActive();

            const remaining = Math.max(0, state.isiMs - state.stimMs);
            const tIsi = nowMs();
            while (nowMs() - tIsi < remaining) {
              if (token !== runToken) break;
              if (state.paused) break;
              await sleep(16);
            }

            // finalize only after stimMs + blank ISI (full response window)
            if (!state.paused) {
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
          }

          if (token === runToken) {
            stopLetterAudio();
            setRunningUI(false);
            setPausedUI(false);
            renderHeader();
            renderRoundSummary();
            showToast("Round complete");
            els.btnReset.disabled = false;
          }
          } finally {
            roundLock = false;
            if (state.running) {
              setRunningUI(false);
              setPausedUI(false);
            }
            setFormDisabled(false);
          }
        }

        function toggleStartPause() {
          if (!state.running) {
            if (roundLock) return;
            primeSpeechAudible();
            runRound();
            return;
          }
          setPausedUI(!state.paused);
          showToast(state.paused ? "Paused" : "Resumed");
        }

        function hardReset() {
          runToken++;
          roundLock = false;
          stopLetterAudio();
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
        els.btnStart.addEventListener("click", toggleStartPause);
        els.btnStart.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleStartPause();
          }
        });
        els.btnReset.addEventListener("click", hardReset);
        els.btnHelp.addEventListener("click", () => {
          try {
            els.dlgHelp.showModal();
          } catch (_) {
            alert("L: visual match, A: audio match, Space: pause/resume. Match when same as N trials ago!");
          }
        });
        els.btnCloseHelp.addEventListener("click", () => els.dlgHelp.close());

        if (els.btnSettings && els.dlgSettings) {
          els.btnSettings.addEventListener("click", () => {
            setFormDisabled(false);
            if (state.running) {
              showToast("Stop the game first to change settings");
            }
            try {
              els.dlgSettings.showModal();
            } catch (_) {
              alert("Could not open settings. Please update your browser.");
            }
          });
          els.btnCloseSettings.addEventListener("click", () => els.dlgSettings.close());
        }

        els.form.addEventListener("input", () => {
          if (state.running) return;
          syncStateFromForm();
        });

        els.form.addEventListener("click", (e) => {
          const btn = e.target.closest(".step-btn");
          if (!btn) return;
          e.preventDefault();
          if (state.running) {
            showToast("Stop the game first to change settings");
            return;
          }
          const input = $(btn.dataset.step);
          if (!input) return;
          const delta = parseInt(btn.dataset.delta, 10) || 0;
          const min = parseFloat(input.min);
          const max = parseFloat(input.max);
          let val = parseInt(input.value, 10) || 0;
          val = clamp(val + delta, min, max);
          input.value = String(val);
          syncStateFromForm();
        });

        if (options.touchControls) {
          document.addEventListener(
            "touchstart",
            () => {
              unlockAudioHard();
            },
            { passive: true }
          );
          els.btnTouchSound.addEventListener("click", () => {
            unlockAudioHard();
            handlePress("A");
          });
          els.btnTouchPosition.addEventListener("click", () => {
            unlockAudioHard();
            handlePress("V");
          });
          if (els.btnStats) {
            els.btnStats.addEventListener("click", () => toggleStatsPanel());
          }
        }

        if (window.speechSynthesis) {
          window.speechSynthesis.addEventListener("voiceschanged", pickEnglishVoice);
          pickEnglishVoice();
        }

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
          if (key === " " || key === "spacebar") {
            e.preventDefault();
            toggleStartPause();
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
            toggleStartPause();
          }
        });

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
        updateTouchMainButton();
        setFormDisabled(false);

        if (els.buildTag) els.buildTag.textContent = BUILD_VER;
};
