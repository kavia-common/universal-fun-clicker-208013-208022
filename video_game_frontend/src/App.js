import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

/**
 * Retro-themed clicker/arcade game:
 * - Central "game canvas" (DOM-based) with moving targets
 * - Pointer + keyboard controls
 * - HUD: score, level, time, accuracy, streak, high score
 * - Responsive scaling
 * - localStorage persistence for settings + high score
 *
 * Offline-first: no API/WS required.
 */

const STORAGE_KEYS = {
  settings: "retroClicker.settings.v1",
  highScore: "retroClicker.highScore.v1",
};

const DEFAULT_SETTINGS = {
  theme: "light", // "light" | "dark"
  reducedMotion: false,
  sound: false, // Placeholder toggle (no audio assets bundled)
};

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function loadJSON(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures (private mode, quota, etc.)
  }
}

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function formatTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

// PUBLIC_INTERFACE
function App() {
  /** Settings + persistence */
  const [settings, setSettings] = useState(() => loadJSON(STORAGE_KEYS.settings, DEFAULT_SETTINGS));
  const [highScore, setHighScore] = useState(() => {
    const val = Number(window.localStorage.getItem(STORAGE_KEYS.highScore) || "0");
    return Number.isFinite(val) ? val : 0;
  });

  /** Game state */
  const [status, setStatus] = useState("idle"); // "idle" | "playing" | "paused" | "gameover"
  const [level, setLevel] = useState(1);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [hits, setHits] = useState(0);
  const [misses, setMisses] = useState(0);

  // Timer
  const ROUND_SECONDS = 45;
  const [timeLeft, setTimeLeft] = useState(ROUND_SECONDS);

  /** "Canvas" sizing and scaling */
  const stageRef = useRef(null);
  const [stageSize, setStageSize] = useState({ w: 640, h: 420 });

  /** Target entity (single moving target for an arcade/clicker feel) */
  const [target, setTarget] = useState(() => ({
    id: 1,
    x: 320,
    y: 210,
    r: 22,
    vx: 180,
    vy: 140,
    hue: 190,
    alive: true,
  }));

  /** Refs for game loop */
  const rafRef = useRef(0);
  const lastRef = useRef(0);
  const timeAccumulatorRef = useRef(0);
  const statusRef = useRef(status);
  const stageSizeRef = useRef(stageSize);
  const targetRef = useRef(target);
  const levelRef = useRef(level);

  /** Apply theme to document */
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", settings.theme);
  }, [settings.theme]);

  /** Persist settings */
  useEffect(() => {
    saveJSON(STORAGE_KEYS.settings, settings);
  }, [settings]);

  /** Keep refs fresh */
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  useEffect(() => {
    stageSizeRef.current = stageSize;
  }, [stageSize]);
  useEffect(() => {
    targetRef.current = target;
  }, [target]);
  useEffect(() => {
    levelRef.current = level;
  }, [level]);

  /** Measure stage size for responsive scaling */
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      // Keep a minimum size so physics doesn't explode on tiny screens
      setStageSize({
        w: clamp(Math.floor(cr.width), 280, 1200),
        h: clamp(Math.floor(cr.height), 240, 900),
      });
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const accuracy = useMemo(() => {
    const total = hits + misses;
    if (total <= 0) return 0;
    return Math.round((hits / total) * 100);
  }, [hits, misses]);

  const difficulty = useMemo(() => {
    // Difficulty scales with level: more speed, slightly smaller radius
    const speedMul = 1 + (level - 1) * 0.18;
    const radius = clamp(24 - (level - 1) * 1.2, 12, 24);
    return { speedMul, radius };
  }, [level]);

  const instructions = useMemo(
    () => [
      "Click/Tap the orb to score.",
      "Space = pause/resume, R = restart.",
      "Misses reset combo. Survive the clock.",
    ],
    []
  );

  function updateHighScoreIfNeeded(nextScore) {
    if (nextScore > highScore) {
      setHighScore(nextScore);
      try {
        window.localStorage.setItem(STORAGE_KEYS.highScore, String(nextScore));
      } catch {
        // ignore
      }
    }
  }

  function resetRound() {
    setScore(0);
    setCombo(0);
    setHits(0);
    setMisses(0);
    setLevel(1);
    setTimeLeft(ROUND_SECONDS);

    // Re-seed target to center with deterministic-ish velocities
    setTarget((t) => ({
      ...t,
      id: t.id + 1,
      x: stageSizeRef.current.w / 2,
      y: stageSizeRef.current.h / 2,
      r: 22,
      vx: 180,
      vy: 140,
      hue: 190,
      alive: true,
    }));
  }

  function startGame() {
    resetRound();
    setStatus("playing");
  }

  function togglePause() {
    setStatus((s) => (s === "playing" ? "paused" : s === "paused" ? "playing" : s));
  }

  function endGame() {
    setStatus("gameover");
  }

  function bumpLevelIfNeeded(nextScore) {
    // Level thresholds: 0->1, 120->2, 260->3, 420->4, ... (accelerating)
    const nextLevel = Math.max(1, Math.floor(Math.sqrt(nextScore / 120)) + 1);
    if (nextLevel !== levelRef.current) {
      setLevel(nextLevel);
      // Give a little time reward on level-up
      setTimeLeft((t) => clamp(t + 2, 0, ROUND_SECONDS));
      // Shift target hue for a satisfying "stage change"
      setTarget((prev) => ({ ...prev, hue: (prev.hue + 35) % 360 }));
    }
  }

  /** Core simulation step: updates target position, collisions with bounds, timer */
  function step(dt) {
    // Timer ticks in real seconds, not frame-based
    timeAccumulatorRef.current += dt;
    while (timeAccumulatorRef.current >= 1) {
      timeAccumulatorRef.current -= 1;
      setTimeLeft((t) => {
        const next = t - 1;
        if (next <= 0) {
          // End of round
          // Use setTimeout to avoid state update re-entrancy in render
          setTimeout(() => endGame(), 0);
          return 0;
        }
        return next;
      });
    }

    // Target physics only while playing
    const stage = stageSizeRef.current;
    const cur = targetRef.current;

    const { speedMul, radius } = difficulty;
    const speedLimit = 520 * speedMul;

    // If reducedMotion, keep target slow but still interactive
    const motionMul = settings.reducedMotion ? 0.35 : 1;

    let vx = clamp(cur.vx * speedMul * motionMul, -speedLimit, speedLimit);
    let vy = clamp(cur.vy * speedMul * motionMul, -speedLimit, speedLimit);

    let x = cur.x + vx * dt;
    let y = cur.y + vy * dt;

    const r = radius;

    // Bounce off bounds with a slight "energy gain" for arcade feel
    const bounceBoost = 1.02;

    if (x - r < 0) {
      x = r;
      vx = Math.abs(vx) * bounceBoost;
    } else if (x + r > stage.w) {
      x = stage.w - r;
      vx = -Math.abs(vx) * bounceBoost;
    }

    if (y - r < 0) {
      y = r;
      vy = Math.abs(vy) * bounceBoost;
    } else if (y + r > stage.h) {
      y = stage.h - r;
      vy = -Math.abs(vy) * bounceBoost;
    }

    // Small drift in hue adds "CRT neon" vibe
    const hue = (cur.hue + dt * 30) % 360;

    setTarget((prev) => ({
      ...prev,
      x,
      y,
      r,
      vx: vx / (speedMul * motionMul || 1),
      vy: vy / (speedMul * motionMul || 1),
      hue,
    }));
  }

  /** RAF loop */
  useEffect(() => {
    function loop(ts) {
      const last = lastRef.current || ts;
      const dt = clamp((ts - last) / 1000, 0, 0.05);
      lastRef.current = ts;

      if (statusRef.current === "playing") {
        step(dt);
      }

      rafRef.current = window.requestAnimationFrame(loop);
    }

    rafRef.current = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [difficulty, settings.reducedMotion]);

  /** Keyboard controls */
  useEffect(() => {
    function onKeyDown(e) {
      const key = e.key.toLowerCase();

      // Avoid interfering with accessibility shortcuts when focused on inputs
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      if (key === " " || key === "spacebar") {
        e.preventDefault();
        if (statusRef.current === "idle") startGame();
        else togglePause();
      } else if (key === "r") {
        e.preventDefault();
        startGame();
      } else if (key === "escape") {
        if (statusRef.current === "playing") setStatus("paused");
      }
    }

    window.addEventListener("keydown", onKeyDown, { passive: false });
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function registerMiss() {
    setMisses((m) => m + 1);
    setCombo(0);
  }

  function registerHit() {
    setHits((h) => h + 1);
    setCombo((c) => c + 1);

    setScore((s) => {
      // Score formula: base + combo scaling + time urgency
      const urgency = 1 + (1 - timeLeft / ROUND_SECONDS) * 0.35;
      const comboBonus = 1 + clamp(combo, 0, 25) * 0.08;
      const lvlBonus = 1 + (levelRef.current - 1) * 0.06;

      const delta = Math.round(10 * urgency * comboBonus * lvlBonus);
      const next = s + delta;

      // Side-effects that depend on score
      bumpLevelIfNeeded(next);
      updateHighScoreIfNeeded(next);

      return next;
    });

    // Make target "jump" to a new location for a clicker/arcade feel
    const stage = stageSizeRef.current;
    setTarget((prev) => {
      const pad = 12 + prev.r;
      const nx = pad + Math.random() * (stage.w - pad * 2);
      const ny = pad + Math.random() * (stage.h - pad * 2);

      // Randomize velocity direction a bit
      const base = 170 + Math.random() * 120 + (levelRef.current - 1) * 14;
      const ang = Math.random() * Math.PI * 2;
      const vx = Math.cos(ang) * base;
      const vy = Math.sin(ang) * base;

      return { ...prev, x: nx, y: ny, vx, vy, hue: (prev.hue + 55) % 360 };
    });
  }

  function onStagePointerDown(e) {
    if (statusRef.current === "idle") {
      startGame();
      return;
    }
    if (statusRef.current !== "playing") return;

    const stageEl = stageRef.current;
    if (!stageEl) return;

    const rect = stageEl.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const cur = targetRef.current;
    const dx = px - cur.x;
    const dy = py - cur.y;
    const dist2 = dx * dx + dy * dy;

    if (dist2 <= cur.r * cur.r) {
      registerHit();
    } else {
      registerMiss();
    }
  }

  // Small "CRT" visual intensity based on combo
  const glowIntensity = clamp(combo / 18, 0, 1);

  return (
    <div className="App">
      <div className="appShell">
        <header className="topBar">
          <div className="brand">
            <div className="brandMark" aria-hidden="true">
              <span className="brandDot" />
            </div>
            <div className="brandText">
              <div className="brandTitle">Neon Orb Clicker</div>
              <div className="brandSub">Retro arcade • quick rounds • one more try</div>
            </div>
          </div>

          <div className="hud">
            <div className="hudItem">
              <div className="hudLabel">Score</div>
              <div className="hudValue">{score}</div>
            </div>
            <div className="hudItem">
              <div className="hudLabel">High</div>
              <div className="hudValue">{highScore}</div>
            </div>
            <div className="hudItem">
              <div className="hudLabel">Level</div>
              <div className="hudValue">{level}</div>
            </div>
            <div className="hudItem">
              <div className="hudLabel">Time</div>
              <div className="hudValue mono">{formatTime(timeLeft)}</div>
            </div>
            <div className="hudItem">
              <div className="hudLabel">Accuracy</div>
              <div className="hudValue">{accuracy}%</div>
            </div>
            <div className="hudItem">
              <div className="hudLabel">Combo</div>
              <div className="hudValue">{combo}</div>
            </div>
          </div>

          <div className="topControls">
            <button
              className="btn"
              onClick={() => setSettings((s) => ({ ...s, theme: s.theme === "light" ? "dark" : "light" }))}
              aria-label={`Switch to ${settings.theme === "light" ? "dark" : "light"} mode`}
              type="button"
            >
              {settings.theme === "light" ? "Dark" : "Light"}
            </button>
          </div>
        </header>

        <main className="mainGrid">
          <section className="panel instructionsPanel" aria-label="Instructions">
            <div className="panelTitle">How to Play</div>
            <ul className="instructionList">
              {instructions.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>

            <div className="panelTitle">Controls</div>
            <div className="keyGrid" role="list">
              <div className="keyRow" role="listitem">
                <span className="keyCap">Click/Tap</span>
                <span className="keyDesc">Hit the orb</span>
              </div>
              <div className="keyRow" role="listitem">
                <span className="keyCap">Space</span>
                <span className="keyDesc">Start / Pause</span>
              </div>
              <div className="keyRow" role="listitem">
                <span className="keyCap">R</span>
                <span className="keyDesc">Restart</span>
              </div>
              <div className="keyRow" role="listitem">
                <span className="keyCap">Esc</span>
                <span className="keyDesc">Pause</span>
              </div>
            </div>

            <div className="panelTitle">Options</div>
            <label className="toggleRow">
              <input
                type="checkbox"
                checked={settings.reducedMotion}
                onChange={(e) => setSettings((s) => ({ ...s, reducedMotion: e.target.checked }))}
              />
              <span>Reduced motion</span>
            </label>
            <label className="toggleRow">
              <input
                type="checkbox"
                checked={settings.sound}
                onChange={(e) => setSettings((s) => ({ ...s, sound: e.target.checked }))}
              />
              <span>Sound (toggle only)</span>
            </label>

            <div className="panelHint">
              Tip: keep a streak. Combo boosts points. Miss resets combo.
            </div>
          </section>

          <section className="panel gamePanel" aria-label="Game area">
            <div className="gameHeader">
              <div className="statusPill" data-status={status}>
                {status === "idle" && "Ready"}
                {status === "playing" && "LIVE"}
                {status === "paused" && "Paused"}
                {status === "gameover" && "Round Over"}
              </div>
              <div className="microStats">
                <span>
                  Hits <strong>{hits}</strong>
                </span>
                <span className="dotSep" aria-hidden="true">
                  •
                </span>
                <span>
                  Misses <strong>{misses}</strong>
                </span>
              </div>
            </div>

            <div
              className="stageWrap"
              style={{
                ["--glow" as any]: glowIntensity.toFixed(3),
              }}
            >
              <div
                ref={stageRef}
                className="stage"
                role="application"
                aria-label="Neon Orb game canvas"
                tabIndex={0}
                onPointerDown={onStagePointerDown}
              >
                {/* Scanline overlay */}
                <div className="scanlines" aria-hidden="true" />

                {/* Target */}
                <button
                  type="button"
                  className="target"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (statusRef.current === "idle") startGame();
                    else if (statusRef.current === "playing") registerHit();
                  }}
                  aria-label="Neon orb target"
                  style={{
                    left: `${target.x}px`,
                    top: `${target.y}px`,
                    width: `${target.r * 2}px`,
                    height: `${target.r * 2}px`,
                    ["--hue" as any]: `${Math.round(target.hue)}`,
                  }}
                />
              </div>
            </div>

            <div className="controlsRow" aria-label="Game controls">
              {status === "idle" && (
                <button className="btn btnPrimary" onClick={startGame} type="button">
                  Start
                </button>
              )}
              {status === "playing" && (
                <button className="btn" onClick={togglePause} type="button">
                  Pause
                </button>
              )}
              {status === "paused" && (
                <button className="btn btnPrimary" onClick={togglePause} type="button">
                  Resume
                </button>
              )}
              {(status === "paused" || status === "playing") && (
                <button className="btn" onClick={startGame} type="button">
                  Restart
                </button>
              )}
              {status === "gameover" && (
                <>
                  <button className="btn btnPrimary" onClick={startGame} type="button">
                    Play Again
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      setStatus("idle");
                      setTimeLeft(ROUND_SECONDS);
                      setCombo(0);
                    }}
                    type="button"
                  >
                    Back to Ready
                  </button>
                </>
              )}

              <div className="controlsSpacer" />

              <div className="stageMeta" aria-label="Stage info">
                <span className="mono">
                  {stageSize.w}×{stageSize.h}
                </span>
                <span className="dotSep" aria-hidden="true">
                  •
                </span>
                <span className="mono">Round: {ROUND_SECONDS}s</span>
              </div>
            </div>

            {status === "gameover" && (
              <div className="gameOverCard" role="status" aria-live="polite">
                <div className="gameOverTitle">Round Over</div>
                <div className="gameOverBody">
                  <div className="gameOverStat">
                    <span className="label">Score</span>
                    <span className="value">{score}</span>
                  </div>
                  <div className="gameOverStat">
                    <span className="label">High</span>
                    <span className="value">{highScore}</span>
                  </div>
                  <div className="gameOverStat">
                    <span className="label">Accuracy</span>
                    <span className="value">{accuracy}%</span>
                  </div>
                  <div className="gameOverStat">
                    <span className="label">Max combo</span>
                    <span className="value">{combo}</span>
                  </div>
                </div>
                <div className="gameOverHint">Press R to restart instantly.</div>
              </div>
            )}
          </section>
        </main>

        <footer className="footer">
          <span className="footerLeft">Offline-ready • localStorage saves high score + settings</span>
          <span className="footerRight">Pointer + keyboard supported</span>
        </footer>
      </div>
    </div>
  );
}

export default App;
