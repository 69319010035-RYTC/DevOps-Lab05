"use strict";

(() => {
  const LEVELS = {
    easy: { name: "ง่าย", columns: 4, rows: 3 },
    medium: { name: "กลาง", columns: 6, rows: 4 },
    hard: { name: "ยาก", columns: 10, rows: 6 },
    impossible: { name: "เป็นไปไม่ได้", columns: 15, rows: 10 },
  };
  const LEVEL_ORDER = ["easy", "medium", "hard", "impossible"];
  const CANVAS_WIDTH = 1200;
  const BOARD_WIDTH = 450;
  const BOARD_LEFT = 36;
  const BOARD_TOP = 180;
  const TRAY_LEFT = 530;
  const TRAY_TOP = 64;
  const TRAY_WIDTH = 640;
  const TRAY_BOTTOM_GAP = 45;
  const AUTO_MOVE_DURATION_MS = 180;
  const AUTO_STEP_DELAY_MS = 50;

  const canvas = document.querySelector("#puzzle");
  const context = canvas.getContext("2d");
  const difficultySelect = document.querySelector("#difficulty");
  const startButton = document.querySelector("#start-button");
  const autoCurrentButton = document.querySelector("#auto-current-button");
  const autoAllButton = document.querySelector("#auto-all-button");
  const stopAutoButton = document.querySelector("#stop-auto-button");
  const musicButton = document.querySelector("#music-button");
  const statusElement = document.querySelector("#game-status");
  const progressElement = document.querySelector("#progress");
  const audioFeedback = document.querySelector("#audio-feedback");
  const image = new Image();

  const MUSIC_CHORDS = [
    { pad: [130.81, 196, 261.63, 329.63], melody: [523.25, 659.25, 587.33] },
    { pad: [110, 164.81, 220, 261.63], melody: [493.88, 440, 523.25] },
    { pad: [87.31, 130.81, 174.61, 220], melody: [440, 523.25, 659.25] },
    { pad: [98, 146.83, 196, 246.94], melody: [587.33, 493.88, 392] },
  ];

  let game = null;
  let autoToken = 0;
  let autoRunning = false;
  let activeAnimation = null;
  let dragging = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let audioContext = null;
  let soundEffectsGain = null;
  let musicFilter = null;
  let musicMasterGain = null;
  let musicEnabled = false;
  let musicChordIndex = 0;
  let musicTimer = null;
  let musicVoices = [];
  let snapParticles = [];
  let snapAnimationFrame = null;

  function setStatus(message) {
    statusElement.textContent = message;
  }

  function reportAudioError(error) {
    audioFeedback.textContent = `เสียงไม่พร้อมใช้งาน: ${error.message}`;
  }

  function ensureAudioContext() {
    if (!audioContext) {
      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextConstructor) return null;

      try {
        audioContext = new AudioContextConstructor();
        soundEffectsGain = audioContext.createGain();
        soundEffectsGain.gain.value = 0.55;
        soundEffectsGain.connect(audioContext.destination);

        musicFilter = audioContext.createBiquadFilter();
        musicFilter.type = "lowpass";
        musicFilter.frequency.value = 1100;
        musicFilter.Q.value = 0.55;
        musicMasterGain = audioContext.createGain();
        musicMasterGain.gain.value = 0;
        musicFilter.connect(musicMasterGain);
        musicMasterGain.connect(audioContext.destination);
      } catch (error) {
        reportAudioError(error);
        return null;
      }
    }

    if (audioContext.state === "suspended") {
      audioContext.resume().catch(reportAudioError);
    }
    return audioContext;
  }

  function playTone(frequency, duration, volume, endFrequency, delay = 0) {
    const audio = ensureAudioContext();
    if (!audio || !soundEffectsGain) return;

    const startTime = audio.currentTime + delay;
    const oscillator = audio.createOscillator();
    const envelope = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, startTime);
    if (endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(endFrequency, startTime + duration);
    }
    envelope.gain.setValueAtTime(0.0001, startTime);
    envelope.gain.exponentialRampToValueAtTime(volume, startTime + 0.015);
    envelope.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    oscillator.connect(envelope);
    envelope.connect(soundEffectsGain);
    oscillator.start(startTime);
    oscillator.stop(startTime + duration + 0.025);
  }

  function playPickupSound() {
    playTone(420, 0.09, 0.025, 560);
  }

  function playSnapSound() {
    playTone(523.25, 0.18, 0.035, null, 0);
    playTone(659.25, 0.2, 0.03, null, 0.055);
    playTone(783.99, 0.24, 0.025, null, 0.11);
  }

  function playMissSound() {
    playTone(240, 0.12, 0.018, 170);
  }

  function updateMusicButton() {
    musicButton.textContent = musicEnabled ? "♫ เพลง: เปิด" : "♫ เพลง: ปิด";
    musicButton.setAttribute("aria-pressed", String(musicEnabled));
  }

  function playAmbientChord(chordIndex) {
    if (!musicEnabled || !audioContext) return;

    const startTime = audioContext.currentTime;
    const chord = MUSIC_CHORDS[chordIndex];
    const chordEnvelope = audioContext.createGain();
    chordEnvelope.gain.setValueAtTime(0.0001, startTime);
    chordEnvelope.gain.linearRampToValueAtTime(0.075, startTime + 1.2);
    chordEnvelope.gain.setValueAtTime(0.075, startTime + 3.5);
    chordEnvelope.gain.linearRampToValueAtTime(0.0001, startTime + 4.8);
    chordEnvelope.connect(musicFilter);

    musicVoices = [];
    chord.pad.forEach((frequency) => {
      const oscillator = audioContext.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, startTime);
      oscillator.connect(chordEnvelope);
      oscillator.start(startTime);
      oscillator.stop(startTime + 4.9);
      musicVoices.push(oscillator);
    });

    chord.melody.forEach((frequency, index) => {
      const noteStart = startTime + 0.4 + index * 1.35;
      const oscillator = audioContext.createOscillator();
      const noteEnvelope = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, noteStart);
      noteEnvelope.gain.setValueAtTime(0.0001, noteStart);
      noteEnvelope.gain.linearRampToValueAtTime(0.04, noteStart + 0.08);
      noteEnvelope.gain.exponentialRampToValueAtTime(0.0001, noteStart + 1.2);
      oscillator.connect(noteEnvelope);
      noteEnvelope.connect(musicFilter);
      oscillator.start(noteStart);
      oscillator.stop(noteStart + 1.25);
      musicVoices.push(oscillator);
    });

    musicChordIndex = (chordIndex + 1) % MUSIC_CHORDS.length;
    musicTimer = window.setTimeout(() => playAmbientChord(musicChordIndex), 4200);
  }

  async function toggleMusic() {
    if (musicEnabled) {
      musicEnabled = false;
      window.clearTimeout(musicTimer);
      musicTimer = null;
      if (audioContext && musicMasterGain) {
        const now = audioContext.currentTime;
        musicMasterGain.gain.cancelScheduledValues(now);
        musicMasterGain.gain.setValueAtTime(musicMasterGain.gain.value, now);
        musicMasterGain.gain.linearRampToValueAtTime(0, now + 0.25);
        musicVoices.forEach((voice) => voice.stop(now + 0.3));
        musicVoices = [];
      }
      updateMusicButton();
      audioFeedback.textContent = "เพลงปิดแล้ว";
      return;
    }

    const audio = ensureAudioContext();
    if (!audio || !musicMasterGain) {
      audioFeedback.textContent = "เบราว์เซอร์นี้ไม่รองรับเพลงพื้นหลัง";
      return;
    }

    try {
      await audio.resume();
      musicEnabled = true;
      const now = audio.currentTime;
      musicMasterGain.gain.cancelScheduledValues(now);
      musicMasterGain.gain.setValueAtTime(musicMasterGain.gain.value, now);
      musicMasterGain.gain.linearRampToValueAtTime(0.42, now + 0.8);
      updateMusicButton();
      audioFeedback.textContent = "เปิดเพลงบรรเลงแล้ว";
      playAmbientChord(musicChordIndex);
    } catch (error) {
      reportAudioError(error);
    }
  }

  function drawSnapParticles(targetContext) {
    const now = performance.now();
    targetContext.save();
    targetContext.globalCompositeOperation = "lighter";
    snapParticles.forEach((particle) => {
      const age = now - particle.startedAt;
      if (age < 0 || age >= particle.duration) return;
      const seconds = age / 1000;
      const progress = age / particle.duration;
      targetContext.globalAlpha = 1 - progress;
      targetContext.fillStyle = particle.color;
      targetContext.beginPath();
      targetContext.arc(
        particle.x + particle.velocityX * seconds,
        particle.y + particle.velocityY * seconds + 35 * seconds * seconds,
        particle.radius * (1 - progress * 0.35),
        0,
        Math.PI * 2,
      );
      targetContext.fill();
    });
    targetContext.restore();
  }

  function animateSnapParticles() {
    snapAnimationFrame = null;
    const now = performance.now();
    snapParticles = snapParticles.filter((particle) => now - particle.startedAt < particle.duration);
    draw();
    if (snapParticles.length > 0) {
      snapAnimationFrame = window.requestAnimationFrame(animateSnapParticles);
    }
  }

  function emitSnapEffect(piece) {
    const target = getTarget(piece);
    const centerX = target.x + game.padding + game.cellWidth / 2;
    const centerY = target.y + game.padding + game.cellHeight / 2;
    const colors = ["#a6fff1", "#fff3b0", "#ffffff", "#83d6d1"];
    const radius = Math.max(1.2, Math.min(3.2, Math.min(game.cellWidth, game.cellHeight) * 0.09));

    for (let index = 0; index < 18; index += 1) {
      const angle = (Math.PI * 2 * index) / 18 + Math.random() * 0.18;
      const speed = 28 + Math.random() * 70;
      snapParticles.push({
        x: centerX,
        y: centerY,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed,
        radius: radius * (0.6 + Math.random() * 0.8),
        color: colors[index % colors.length],
        startedAt: performance.now(),
        duration: 460 + Math.random() * 180,
      });
    }

    if (snapAnimationFrame === null) {
      snapAnimationFrame = window.requestAnimationFrame(animateSnapParticles);
    }
  }

  function setAutoRunning(running) {
    autoRunning = running;
    stopAutoButton.hidden = !running;
    difficultySelect.disabled = running;
    startButton.disabled = running;
    autoCurrentButton.disabled = running;
    autoAllButton.disabled = running;
  }

  function cancelAuto(message) {
    autoToken += 1;
    if (activeAnimation) {
      activeAnimation.piece.x = activeAnimation.startX;
      activeAnimation.piece.y = activeAnimation.startY;
      activeAnimation = null;
      if (game) draw();
    }
    setAutoRunning(false);
    if (message) setStatus(message);
  }

  function randomSign() {
    return Math.random() < 0.5 ? -1 : 1;
  }

  function shuffled(items) {
    const result = items.slice();
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
  }

  function makePiecePath(piece, padding, cellWidth, cellHeight) {
    const path = new Path2D();
    const left = padding;
    const top = padding;
    const right = left + cellWidth;
    const bottom = top + cellHeight;

    path.moveTo(left, top);
    addEdge(path, left, top, right, top, piece.edges.top, 0, -1, piece.depth);
    addEdge(path, right, top, right, bottom, piece.edges.right, 1, 0, piece.depth);
    addEdge(path, right, bottom, left, bottom, piece.edges.bottom, 0, 1, piece.depth);
    addEdge(path, left, bottom, left, top, piece.edges.left, -1, 0, piece.depth);
    path.closePath();
    return path;
  }

  function addEdge(path, startX, startY, endX, endY, sign, normalX, normalY, depth) {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const length = Math.hypot(deltaX, deltaY);
    const tangentX = deltaX / length;
    const tangentY = deltaY / length;

    function point(position, offset) {
      return [
        startX + tangentX * length * position + normalX * offset,
        startY + tangentY * length * position + normalY * offset,
      ];
    }

    if (sign === 0) {
      path.lineTo(endX, endY);
      return;
    }

    const outward = sign * depth;
    const start = point(0.34, 0);
    const neckStart = point(0.42, outward * 0.3);
    const peakStart = point(0.44, outward * 0.78);
    const peakEnd = point(0.56, outward * 0.78);
    const neckEnd = point(0.58, outward * 0.3);
    const end = point(0.66, 0);

    path.lineTo(start[0], start[1]);
    path.bezierCurveTo(
      ...point(0.35, outward * 0.42),
      ...point(0.37, outward * 0.78),
      neckStart[0],
      neckStart[1],
    );
    path.bezierCurveTo(
      ...point(0.43, outward * 1.05),
      ...point(0.46, outward),
      peakStart[0],
      peakStart[1],
    );
    path.bezierCurveTo(
      ...point(0.48, outward * 0.95),
      ...point(0.52, outward * 0.95),
      peakEnd[0],
      peakEnd[1],
    );
    path.bezierCurveTo(
      ...point(0.54, outward),
      ...point(0.57, outward * 1.05),
      neckEnd[0],
      neckEnd[1],
    );
    path.bezierCurveTo(
      ...point(0.63, outward * 0.78),
      ...point(0.65, outward * 0.42),
      end[0],
      end[1],
    );
    path.lineTo(endX, endY);
  }

  function createPieces(level, geometry) {
    const horizontalEdges = Array.from({ length: level.rows - 1 }, () =>
      Array.from({ length: level.columns }, randomSign),
    );
    const verticalEdges = Array.from({ length: level.rows }, () =>
      Array.from({ length: level.columns - 1 }, randomSign),
    );
    const pieces = [];

    for (let row = 0; row < level.rows; row += 1) {
      for (let column = 0; column < level.columns; column += 1) {
        const piece = {
          row,
          column,
          placed: false,
          edges: {
            top: row === 0 ? 0 : -horizontalEdges[row - 1][column],
            right: column === level.columns - 1 ? 0 : verticalEdges[row][column],
            bottom: row === level.rows - 1 ? 0 : horizontalEdges[row][column],
            left: column === 0 ? 0 : -verticalEdges[row][column - 1],
          },
          depth: geometry.depth,
        };
        piece.path = makePiecePath(
          piece,
          geometry.padding,
          geometry.cellWidth,
          geometry.cellHeight,
        );
        pieces.push(piece);
      }
    }
    return shuffled(pieces);
  }

  function getTarget(piece) {
    return {
      x: game.boardX + piece.column * game.cellWidth - game.padding,
      y: game.boardY + piece.row * game.cellHeight - game.padding,
    };
  }

  function layoutPieces(pieces) {
    const slotWidth = game.cellWidth + game.padding * 2 + 8;
    const slotHeight = game.cellHeight + game.padding * 2 + 10;
    const columns = Math.max(1, Math.floor(TRAY_WIDTH / slotWidth));
    const rows = Math.ceil(pieces.length / columns);

    pieces.forEach((piece, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      piece.x = TRAY_LEFT + column * slotWidth + 4;
      piece.y = TRAY_TOP + row * slotHeight + 4;
    });

    canvas.width = CANVAS_WIDTH;
    canvas.height = Math.ceil(TRAY_TOP + rows * slotHeight + TRAY_BOTTOM_GAP);
  }

  function startGame(levelId, preserveAuto) {
    if (!preserveAuto) cancelAuto();
    dragging = null;
    if (snapAnimationFrame !== null) {
      window.cancelAnimationFrame(snapAnimationFrame);
      snapAnimationFrame = null;
    }
    snapParticles = [];

    const level = LEVELS[levelId];
    if (!level || !image.complete || image.naturalWidth === 0) {
      setStatus("โหลด car.jpg ไม่สำเร็จ กรุณาตรวจสอบว่าไฟล์อยู่ในโฟลเดอร์เดียวกับเกม");
      return;
    }

    const boardHeight = BOARD_WIDTH * image.naturalHeight / image.naturalWidth;
    const cellWidth = BOARD_WIDTH / level.columns;
    const cellHeight = boardHeight / level.rows;
    const depth = Math.min(cellWidth, cellHeight) * 0.2;
    const padding = depth + 3;

    game = {
      levelId,
      level,
      boardX: BOARD_LEFT,
      boardY: BOARD_TOP,
      boardWidth: BOARD_WIDTH,
      boardHeight,
      cellWidth,
      cellHeight,
      depth,
      padding,
      trayTop: TRAY_TOP,
      pieces: [],
    };
    game.pieces = createPieces(level, game);
    layoutPieces(game.pieces);
    difficultySelect.value = levelId;
    progressElement.textContent = `0 / ${game.pieces.length} ชิ้น`;
    setStatus(`ด่าน${level.name}: ลากชิ้นส่วนไปวางบนกระดาน`);
    draw();
  }

  function drawBoard(targetContext) {
    const { boardX, boardY, boardWidth, boardHeight, level, cellWidth, cellHeight } = game;
    targetContext.save();
    targetContext.fillStyle = "#202d49";
    targetContext.fillRect(boardX, boardY, boardWidth, boardHeight);
    targetContext.strokeStyle = "rgba(186, 205, 241, 0.2)";
    targetContext.lineWidth = 1;
    targetContext.setLineDash([5, 5]);
    for (let column = 1; column < level.columns; column += 1) {
      const x = boardX + column * cellWidth;
      targetContext.beginPath();
      targetContext.moveTo(x, boardY);
      targetContext.lineTo(x, boardY + boardHeight);
      targetContext.stroke();
    }
    for (let row = 1; row < level.rows; row += 1) {
      const y = boardY + row * cellHeight;
      targetContext.beginPath();
      targetContext.moveTo(boardX, y);
      targetContext.lineTo(boardX + boardWidth, y);
      targetContext.stroke();
    }
    targetContext.setLineDash([]);
    targetContext.strokeStyle = "rgba(186, 205, 241, 0.8)";
    targetContext.lineWidth = 2;
    targetContext.strokeRect(boardX, boardY, boardWidth, boardHeight);
    targetContext.restore();

    targetContext.save();
    targetContext.fillStyle = "#a9b5cf";
    targetContext.font = "500 15px Leelawadee UI, Tahoma, sans-serif";
    targetContext.textAlign = "left";
    targetContext.fillText("กระดาน", boardX, boardY - 14);
    targetContext.fillText("ชิ้นส่วน", TRAY_LEFT, game.trayTop - 18);
    targetContext.restore();
  }

  function drawPiece(piece, targetContext) {
    const { padding, cellWidth, cellHeight, boardWidth, boardHeight } = game;
    targetContext.save();
    targetContext.translate(piece.x, piece.y);
    if (piece === dragging) {
      targetContext.shadowColor = "rgba(131, 214, 209, 0.95)";
      targetContext.shadowBlur = 17;
      targetContext.shadowOffsetY = 5;
    } else if (!piece.placed) {
      targetContext.shadowColor = "rgba(2, 8, 20, 0.36)";
      targetContext.shadowBlur = 8;
      targetContext.shadowOffsetY = 3;
    }
    targetContext.clip(piece.path);
    targetContext.drawImage(
      image,
      padding - piece.column * cellWidth,
      padding - piece.row * cellHeight,
      boardWidth,
      boardHeight,
    );
    targetContext.restore();

    targetContext.save();
    targetContext.translate(piece.x, piece.y);
    targetContext.strokeStyle = piece === dragging
      ? "#b6fff4"
      : piece.placed
        ? "rgba(255,255,255,0.72)"
        : "rgba(18, 30, 50, 0.8)";
    targetContext.lineWidth = piece === dragging ? 3 : piece.placed ? 1.25 : 1.5;
    targetContext.lineJoin = "round";
    if (piece === dragging) {
      targetContext.shadowColor = "rgba(131, 214, 209, 0.9)";
      targetContext.shadowBlur = 10;
    }
    targetContext.stroke(piece.path);
    targetContext.restore();
  }

  function drawScene(targetContext, excludedPiece = null) {
    targetContext.clearRect(0, 0, canvas.width, canvas.height);
    drawBoard(targetContext);
    game.pieces.forEach((piece) => {
      if (piece !== excludedPiece) drawPiece(piece, targetContext);
    });
  }

  function draw() {
    if (!game) return;
    drawScene(context);
    drawSnapParticles(context);
  }

  function updateProgress() {
    const placed = game.pieces.reduce((count, piece) => count + (piece.placed ? 1 : 0), 0);
    progressElement.textContent = `${placed} / ${game.pieces.length} ชิ้น`;
    if (placed === game.pieces.length) {
      setStatus(`สำเร็จแล้ว! ต่อภาพด่าน${game.level.name}ครบทุกชิ้น`);
    }
    return placed;
  }

  function pointerPosition(event) {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * canvas.width / bounds.width,
      y: (event.clientY - bounds.top) * canvas.height / bounds.height,
    };
  }

  function pieceContains(piece, x, y) {
    return context.isPointInPath(piece.path, x - piece.x, y - piece.y);
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (!game || autoRunning) return;
    const point = pointerPosition(event);
    const piece = game.pieces.slice().reverse().find(
      (candidate) => !candidate.placed && pieceContains(candidate, point.x, point.y),
    );
    if (!piece) return;

    dragging = piece;
    dragOffsetX = point.x - piece.x;
    dragOffsetY = point.y - piece.y;
    game.pieces.splice(game.pieces.indexOf(piece), 1);
    game.pieces.push(piece);
    canvas.setPointerCapture(event.pointerId);
    playPickupSound();
    draw();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!dragging || !game) return;
    const point = pointerPosition(event);
    dragging.x = point.x - dragOffsetX;
    dragging.y = point.y - dragOffsetY;
    draw();
  });

  function finishDrag() {
    if (!dragging || !game) return;
    const piece = dragging;
    const target = getTarget(piece);
    const snapDistance = Math.max(game.cellWidth, game.cellHeight) * 0.38;
    if (
      Math.abs(piece.x - target.x) <= snapDistance &&
      Math.abs(piece.y - target.y) <= snapDistance
    ) {
      piece.x = target.x;
      piece.y = target.y;
      piece.placed = true;
      updateProgress();
      emitSnapEffect(piece);
      playSnapSound();
    } else {
      const centerX = piece.x + game.padding + game.cellWidth / 2;
      const centerY = piece.y + game.padding + game.cellHeight / 2;
      if (
        centerX >= game.boardX &&
        centerX <= game.boardX + game.boardWidth &&
        centerY >= game.boardY &&
        centerY <= game.boardY + game.boardHeight
      ) {
        playMissSound();
      }
    }
    dragging = null;
    draw();
  }

  canvas.addEventListener("pointerup", finishDrag);
  canvas.addEventListener("pointercancel", finishDrag);

  function wait(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function animatePiece(piece, token) {
    const target = getTarget(piece);
    const backgroundCanvas = document.createElement("canvas");
    backgroundCanvas.width = canvas.width;
    backgroundCanvas.height = canvas.height;
    const backgroundContext = backgroundCanvas.getContext("2d");
    if (!backgroundContext) throw new Error("Unable to create the Auto animation canvas");
    drawScene(backgroundContext, piece);

    const animation = {
      piece,
      startX: piece.x,
      startY: piece.y,
      backgroundCanvas,
    };
    const startTime = performance.now();
    activeAnimation = animation;

    return new Promise((resolve) => {
      function frame(currentTime) {
        if (token !== autoToken) {
          if (activeAnimation === animation) activeAnimation = null;
          resolve(false);
          return;
        }

        const progress = Math.min(1, (currentTime - startTime) / AUTO_MOVE_DURATION_MS);
        const easedProgress = 1 - Math.pow(1 - progress, 3);
        piece.x = animation.startX + (target.x - animation.startX) * easedProgress;
        piece.y = animation.startY + (target.y - animation.startY) * easedProgress;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(animation.backgroundCanvas, 0, 0);
        drawPiece(piece, context);

        if (progress < 1) {
          window.requestAnimationFrame(frame);
          return;
        }

        piece.x = target.x;
        piece.y = target.y;
        piece.placed = true;
        activeAnimation = null;
        updateProgress();
        draw();
        resolve(true);
      }

      window.requestAnimationFrame(frame);
    });
  }

  async function solveLevel(token) {
    const pieces = shuffled(game.pieces.filter((piece) => !piece.placed));
    for (const piece of pieces) {
      if (token !== autoToken) return false;
      const completed = await animatePiece(piece, token);
      if (!completed) return false;
      await wait(AUTO_STEP_DELAY_MS);
    }
    return token === autoToken;
  }

  async function runCurrentAuto() {
    if (game.levelId !== difficultySelect.value) {
      startGame(difficultySelect.value, true);
    }
    cancelAuto();
    const token = autoToken;
    setAutoRunning(true);
    setStatus(`กำลัง Auto ด่าน${game.level.name}…`);
    const completed = await solveLevel(token);
    if (token !== autoToken) return;
    setAutoRunning(false);
    if (completed) setStatus(`Auto สำเร็จ! ผ่านด่าน${game.level.name}แล้ว`);
  }

  async function runAllAuto() {
    cancelAuto();
    const token = autoToken;
    setAutoRunning(true);
    for (let index = 0; index < LEVEL_ORDER.length; index += 1) {
      if (token !== autoToken) return;
      const levelId = LEVEL_ORDER[index];
      startGame(levelId, true);
      setStatus(`Auto ทุกด่าน · ด่าน ${index + 1}/${LEVEL_ORDER.length}: ${LEVELS[levelId].name}`);
      const completed = await solveLevel(token);
      if (!completed || token !== autoToken) return;
      setStatus(`ผ่านด่าน${LEVELS[levelId].name}แล้ว · ${index + 1}/${LEVEL_ORDER.length}`);
      if (index < LEVEL_ORDER.length - 1) await wait(550);
    }
    if (token === autoToken) {
      setAutoRunning(false);
      setStatus("ยอดเยี่ยม! Auto ผ่านครบทั้ง 4 ด่านแล้ว");
    }
  }

  startButton.addEventListener("click", () => startGame(difficultySelect.value, false));
  autoCurrentButton.addEventListener("click", runCurrentAuto);
  autoAllButton.addEventListener("click", runAllAuto);
  stopAutoButton.addEventListener("click", () => cancelAuto("หยุด Auto แล้ว · ความคืบหน้าถูกเก็บไว้"));
  musicButton.addEventListener("click", toggleMusic);

  image.addEventListener("load", () => {
    startGame(difficultySelect.value, false);
  });
  image.addEventListener("error", () => {
    setStatus("โหลด car.jpg ไม่สำเร็จ กรุณาตรวจสอบว่าไฟล์อยู่ในโฟลเดอร์เดียวกับเกม");
  });
  image.src = "car.jpg";
})();
