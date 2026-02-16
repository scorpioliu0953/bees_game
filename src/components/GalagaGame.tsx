import React, { useEffect, useRef, useState } from 'react';
import { Trophy, Play, RotateCcw, Zap, Shield, Skull, Info } from 'lucide-react';
import { audio } from '../utils/audio';
import { submitScore, getLeaderboard, getPlayerRank, type LeaderboardEntry } from '../utils/supabase';

// --- 常數與類型定義 ---
const CANVAS_WIDTH = 480;
const DEFAULT_CANVAS_HEIGHT = 640;
const MAX_CANVAS_HEIGHT = 1200; // canvas 內部解析度上限
const PLAYER_SIZE = 40;
const ENEMY_SIZE = 30;
const BOSS_SIZE = 120;
const BULLET_SIZE = 4;

type PowerUpType = 'DOUBLE_SHOT' | 'SHIELD' | 'LIFE' | 'THUNDER' | 'ALLY' | 'SLOW_TIME' | 'DOUBLE_SCORE' | 'FRAGMENT' | 'ORBITAL';

// --- 碎片（永久升級）系統 ---
interface FragmentData {
  weaponLevel: number; // 0-3
  dropRate: number;    // 0-5 (each +2%)
  shield: number;      // 0-2
  speed: number;       // 0-3
  orbital: number;     // 0-3
}

const defaultFragments = (): FragmentData => ({ weaponLevel: 0, dropRate: 0, shield: 0, speed: 0, orbital: 0 });

const PIXEL_DATA = {
  PLAYER: [[0,0,0,1,1,0,0,0],[0,0,1,1,1,1,0,0],[0,0,1,1,1,1,0,0],[0,1,1,1,1,1,1,0],[1,1,1,1,1,1,1,1],[1,1,0,1,1,0,1,1],[1,0,0,1,1,0,0,1],[1,0,0,1,1,0,0,1]],
  ENEMY_RED: [[0,0,1,0,0,1,0,0],[0,1,1,1,1,1,1,0],[1,1,1,1,1,1,1,1],[1,0,1,1,1,1,0,1],[1,1,1,1,1,1,1,1],[0,0,1,0,0,1,0,0],[0,1,0,1,1,0,1,0],[1,0,1,0,0,1,0,1]],
  ENEMY_PURPLE: [[0,1,1,0,0,1,1,0],[1,1,1,1,1,1,1,1],[1,0,1,1,1,1,0,1],[1,1,1,1,1,1,1,1],[0,1,1,1,1,1,1,0],[0,0,1,0,0,1,0,0],[0,1,1,0,0,1,1,0],[1,1,0,0,0,0,1,1]],
  BOSS: [[0,0,0,1,1,1,1,0,0,0],[0,0,1,1,1,1,1,1,0,0],[0,1,1,0,1,1,0,1,1,0],[1,1,1,1,1,1,1,1,1,1],[1,0,1,1,1,1,1,1,0,1],[1,1,1,0,0,0,0,1,1,1],[0,1,1,1,1,1,1,1,1,0],[0,0,1,0,1,1,0,1,0,0]]
};

interface Entity { x: number; y: number; width: number; height: number; }
interface Bullet extends Entity { active: boolean; fromPlayer: boolean; color: string; vx: number; vy: number; isRicochet?: boolean; piercing?: boolean; isThunder?: boolean; thunderDamage?: number; thunderRadius?: number; hitEnemies?: Set<number>; isHoming?: boolean; }
interface Enemy extends Entity { alive: boolean; type: 'RED' | 'PURPLE' | 'YELLOW' | 'BOSS'; hp: number; maxHp: number; originX: number; originY: number; isDiving: boolean; diveAngle: number; scoreValue: number; isElite?: boolean; }
interface PowerUp extends Entity { type: PowerUpType; active: boolean; }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; color: string; }

const GalagaGame: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<'START' | 'PLAYING' | 'GAMEOVER'>('START');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(Number(localStorage.getItem('galaga-highscore')) || 0);
  const [lives, setLives] = useState(3);
  const [level, setLevel] = useState(1);

  // Leaderboard state
  const [leaderboardPhase, setLeaderboardPhase] = useState<'input' | 'loading' | 'board'>('input');
  const [nickname, setNickname] = useState('');
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardEntry[]>([]);
  const [playerRank, setPlayerRank] = useState(-1);
  const [showStartLeaderboard, setShowStartLeaderboard] = useState(false);
  const [startLeaderboardData, setStartLeaderboardData] = useState<LeaderboardEntry[]>([]);
  const [startLeaderboardLoading, setStartLeaderboardLoading] = useState(false);

  // Bonus stage state
  const [bonusPhase, setBonusPhase] = useState<'none' | 'announce' | 'countdown' | 'playing' | 'result' | 'countdown_end' | 'boss_clear'>('none');
  const bonusPhaseRef = useRef('none');
  const bonusTimerRef = useRef(0);
  const bonusScoreRef = useRef(0);
  const bonusKillCountRef = useRef(0);
  const bonusTotalRef = useRef(0);
  const bonusWaveTimerRef = useRef(0);

  // Fragment pickup message
  const [fragmentMsg, setFragmentMsg] = useState('');

  // 動態 canvas 高度，根據螢幕比例計算
  const [canvasHeight, setCanvasHeight] = useState(() => {
    if (typeof window !== 'undefined') {
      const ratio = window.innerHeight / window.innerWidth;
      return Math.round(Math.min(MAX_CANVAS_HEIGHT, Math.max(DEFAULT_CANVAS_HEIGHT, CANVAS_WIDTH * ratio)));
    }
    return DEFAULT_CANVAS_HEIGHT;
  });
  const canvasHeightRef = useRef(canvasHeight);

  useEffect(() => {
    const updateHeight = () => {
      const ratio = window.innerHeight / window.innerWidth;
      const h = Math.round(Math.min(MAX_CANVAS_HEIGHT, Math.max(DEFAULT_CANVAS_HEIGHT, CANVAS_WIDTH * ratio)));
      canvasHeightRef.current = h;
      setCanvasHeight(h);
      playerRef.current.y = h - 60;
    };
    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, []);

  const weaponLevelRef = useRef(1);
  const shieldCountRef = useRef(0);
  const invulnerableRef = useRef(0);
  const thunderLevelRef = useRef(0);
  const lastThunderShotRef = useRef(0);
  const allyLevelRef = useRef(0);
  const lastAllyShotRef = useRef(0);

  // New mechanic refs
  const slowTimeEndRef = useRef(0);
  const doubleScoreEndRef = useRef(0);
  const bossPhaseRef = useRef(1);
  const bossHomingTimerRef = useRef(0);
  const bossLaserRef = useRef<{ x: number; startTime: number; phase: 'none' | 'warning' | 'firing' }>({ x: 0, startTime: 0, phase: 'none' });
  const bossMinionsSpawnedRef = useRef(false);
  const phaseTransitionFlashRef = useRef(0);
  const levelRef = useRef(1);
  const fragmentsRef = useRef<FragmentData>(defaultFragments());

  // Orbital weapon refs
  const orbitalLevelRef = useRef(0);
  const orbitalAngleRef = useRef(0);
  const [orbitalLevel, setOrbitalLevel] = useState(0);

  // Pause
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);

  const [weaponLevel, setWeaponLevel] = useState(1);
  const [shieldCount, setShieldCount] = useState(0);
  const [thunderLevel, setThunderLevel] = useState(0);
  const [allyLevel, setAllyLevel] = useState(0);

  const playerRef = useRef({ x: CANVAS_WIDTH / 2 - PLAYER_SIZE / 2, y: canvasHeightRef.current - 60 });
  const bulletsRef = useRef<Bullet[]>([]);
  const enemiesRef = useRef<Enemy[]>([]);
  const powerUpsRef = useRef<PowerUp[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const keysRef = useRef<Set<string>>(new Set());
  const lastShotRef = useRef(0);
  const formationOffset = useRef(0);
  const formationDir = useRef(1);
  const starsRef = useRef<{x: number, y: number, size: number, speed: number}[]>([]);
  const screenShake = useRef(0);
  const bossActive = useRef(false);
  const bossAppearanceCountRef = useRef(0);
  const requestRef = useRef<number>();
  const gameStateRef = useRef(gameState);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    starsRef.current = Array.from({ length: 100 }, () => ({ x: Math.random() * CANVAS_WIDTH, y: Math.random() * canvasHeightRef.current, size: Math.random() * 2, speed: Math.random() * 3 + 1 }));
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && gameStateRef.current === 'PLAYING') {
        e.preventDefault();
        pausedRef.current = !pausedRef.current;
        setPaused(pausedRef.current);
        return;
      }
      keysRef.current.add(e.code);
    };
    const handleKeyUp = (e: KeyboardEvent) => keysRef.current.delete(e.code);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', handleKeyUp); if (requestRef.current) cancelAnimationFrame(requestRef.current); };
  }, []);

  const gameAreaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = gameAreaRef.current;
    if (!el) return;
    const handler = (e: TouchEvent) => {
      if (gameStateRef.current !== 'PLAYING') return;
      if (pausedRef.current) return;
      e.preventDefault();
      const touch = e.touches[0];
      if (!touch) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = CANVAS_WIDTH / rect.width;
      const canvasX = (touch.clientX - rect.left) * scaleX;
      playerRef.current.x = Math.max(0, Math.min(CANVAS_WIDTH - PLAYER_SIZE, canvasX - PLAYER_SIZE / 2));
    };
    const tapHandler = (e: TouchEvent) => {
      if (gameStateRef.current !== 'PLAYING') return;
      const touch = e.changedTouches[0];
      if (!touch) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const tapY = touch.clientY - rect.top;
      if (tapY < rect.height / 3) {
        e.preventDefault();
        pausedRef.current = !pausedRef.current;
        setPaused(pausedRef.current);
      }
    };
    el.addEventListener('touchmove', handler, { passive: false });
    el.addEventListener('touchend', tapHandler, { passive: false });
    return () => { el.removeEventListener('touchmove', handler); el.removeEventListener('touchend', tapHandler); };
  }, []);

  // --- Helper: score multiplier ---
  const getScoreMultiplier = () => {
    const base = Date.now() < doubleScoreEndRef.current ? 2 : 1;
    return base;
  };

  // --- Helper: set bonus phase (syncs ref + state) ---
  const setBonusPhaseSync = (phase: 'none' | 'announce' | 'countdown' | 'playing' | 'result' | 'countdown_end' | 'boss_clear') => {
    bonusPhaseRef.current = phase;
    setBonusPhase(phase);
  };

  const initGame = () => {
    // Reset fragments each new game (only persist within this game session)
    const frags = defaultFragments();
    fragmentsRef.current = frags;

    playerRef.current = { x: CANVAS_WIDTH / 2 - PLAYER_SIZE / 2, y: canvasHeightRef.current - 60 };
    bulletsRef.current = [];
    enemiesRef.current = [];
    powerUpsRef.current = [];
    particlesRef.current = [];
    setScore(0);
    setLives(3);
    setLevel(1);
    levelRef.current = 1;

    // Apply fragment bonuses
    const initWeapon = Math.min(1 + frags.weaponLevel, 5);
    weaponLevelRef.current = initWeapon; setWeaponLevel(initWeapon);
    const initShield = frags.shield;
    shieldCountRef.current = initShield; setShieldCount(initShield);
    thunderLevelRef.current = 0; setThunderLevel(0);
    allyLevelRef.current = 0; setAllyLevel(0);
    orbitalLevelRef.current = frags.orbital; setOrbitalLevel(frags.orbital);
    orbitalAngleRef.current = 0;
    invulnerableRef.current = 0;
    pausedRef.current = false; setPaused(false);
    bossActive.current = false;
    bossAppearanceCountRef.current = 0;
    bossPhaseRef.current = 1;
    bossHomingTimerRef.current = 0;
    bossLaserRef.current = { x: 0, startTime: 0, phase: 'none' };
    bossMinionsSpawnedRef.current = false;
    phaseTransitionFlashRef.current = 0;
    slowTimeEndRef.current = 0;
    doubleScoreEndRef.current = 0;
    formationOffset.current = 0;
    setBonusPhaseSync('none');
    bonusTimerRef.current = 0;
    bonusScoreRef.current = 0;
    bonusKillCountRef.current = 0;
    bonusTotalRef.current = 0;
    setFragmentMsg('');
    setLeaderboardPhase('input');
    setNickname('');
    setLeaderboardData([]);
    setPlayerRank(-1);
    spawnEnemies(1);
    setGameState('PLAYING');
    audio.playBGM();
  };

  const spawnEnemies = (lvl: number) => {
    // Bonus stage takes priority over boss
    if (lvl % 20 === 0) return; // bonus stage handles its own enemies
    if (lvl % 5 === 0) { spawnBoss(); return; }
    bossActive.current = false;
    const tier = Math.floor(lvl / 5);
    const scale = Math.pow(1.1, tier);
    const baseRows = 5, baseCols = 9;
    const rows = Math.round(baseRows * Math.sqrt(scale));
    const cols = Math.round(baseCols * Math.sqrt(scale));
    const totalGridW = 410, totalGridH = 200;
    const cellW = totalGridW / cols;
    const cellH = totalGridH / rows;
    const eSize = Math.min(cellW, cellH) * 0.7;
    const startX = (CANVAS_WIDTH - totalGridW) / 2;
    const enemies: Enemy[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let type: 'RED' | 'PURPLE' | 'YELLOW' = 'RED';
        if (r === 0) type = 'YELLOW'; else if (r === 1) type = 'PURPLE';
        const ex = startX + c * cellW + (cellW - eSize) / 2;
        const ey = 60 + r * cellH + (cellH - eSize) / 2;
        const baseHp = r === 0 ? 2 : 1;
        // 5% chance to be elite
        const isElite = Math.random() < 0.05;
        const hp = isElite ? baseHp * 3 : baseHp;
        const scoreVal = (rows - 1 - r) * 100;
        enemies.push({ x: ex, y: ey, originX: ex, originY: ey, width: isElite ? eSize * 1.05 : eSize, height: isElite ? eSize * 1.05 : eSize, alive: true, type, hp, maxHp: hp, isDiving: false, diveAngle: 0, scoreValue: isElite ? scoreVal * 3 : scoreVal, isElite });
      }
    }
    enemiesRef.current = enemies;
  };

  const spawnBoss = () => {
    bossAppearanceCountRef.current += 1;
    bossActive.current = true;
    bossPhaseRef.current = 1;
    bossHomingTimerRef.current = 0;
    bossLaserRef.current = { x: 0, startTime: 0, phase: 'none' };
    bossMinionsSpawnedRef.current = false;
    audio.playBossSpawn();
    const bossHp = (80 + levelRef.current * 20) * 2;
    enemiesRef.current = [{ x: CANVAS_WIDTH / 2 - BOSS_SIZE / 2, y: -150, originX: CANVAS_WIDTH / 2 - BOSS_SIZE / 2, originY: 100, width: BOSS_SIZE, height: BOSS_SIZE, alive: true, type: 'BOSS', hp: bossHp, maxHp: bossHp, isDiving: false, diveAngle: 0, scoreValue: 5000 + (levelRef.current * 1000) }];
  };

  // --- Bonus Stage ---
  const startBonusStage = () => {
    bossActive.current = false;
    enemiesRef.current = [];
    bulletsRef.current = [];
    bonusScoreRef.current = 0;
    bonusKillCountRef.current = 0;
    bonusTotalRef.current = 0;
    bonusWaveTimerRef.current = 0;
    bonusTimerRef.current = Date.now();
    setBonusPhaseSync('announce');
  };

  const spawnBonusWave = () => {
    const waveType = Math.random();
    const count = 6 + Math.floor(Math.random() * 4); // 6-9 enemies
    bonusTotalRef.current += count;
    const eSize = 22;
    if (waveType < 0.5) {
      // V-formation from top
      for (let i = 0; i < count; i++) {
        const row = i < count / 2 ? i : count - 1 - i;
        const col = i;
        const ex = CANVAS_WIDTH / 2 - (count * 15) / 2 + col * 15;
        const ey = -30 - row * 20;
        enemiesRef.current.push({ x: ex, y: ey, originX: ex, originY: ey, width: eSize, height: eSize, alive: true, type: 'RED', hp: 1, maxHp: 1, isDiving: true, diveAngle: Math.random() * Math.PI * 2, scoreValue: 200 });
      }
    } else {
      // Wave from side
      const fromLeft = Math.random() < 0.5;
      for (let i = 0; i < count; i++) {
        const ex = fromLeft ? -30 - i * 25 : CANVAS_WIDTH + 30 + i * 25;
        const ey = 80 + Math.sin(i * 0.8) * 60;
        enemiesRef.current.push({ x: ex, y: ey, originX: ex, originY: ey, width: eSize, height: eSize, alive: true, type: 'PURPLE', hp: 1, maxHp: 1, isDiving: true, diveAngle: fromLeft ? 0 : Math.PI, scoreValue: 200 });
      }
    }
  };

  const update = () => {
    if (gameState !== 'PLAYING') return;
    if (pausedRef.current) return;
    if (invulnerableRef.current > 0) invulnerableRef.current -= 0.016;

    const now = Date.now();

    // --- Bonus stage flow ---
    if (bonusPhaseRef.current !== 'none') {
      const elapsed = now - bonusTimerRef.current;
      if (bonusPhaseRef.current === 'announce') {
        if (elapsed > 2000) { bonusTimerRef.current = now; setBonusPhaseSync('countdown'); }
        return;
      }
      if (bonusPhaseRef.current === 'countdown') {
        if (elapsed > 5000) { bonusTimerRef.current = now; bonusWaveTimerRef.current = now; bulletsRef.current = []; setBonusPhaseSync('playing'); }
        updatePlayerMove();
        updateParticles();
      }
      if (bonusPhaseRef.current === 'playing') {
        // Spawn waves periodically
        if (now - bonusWaveTimerRef.current > 2000) {
          spawnBonusWave();
          bonusWaveTimerRef.current = now;
        }
        // Update bonus enemies (fly through, no shooting)
        updateBonusEnemies();
        updatePlayer();
        updateBullets();
        updatePowerUps();
        updateParticles();
        checkBonusCollisions();
        if (elapsed > 15000) {
          // Bonus time up
          const allKilled = bonusKillCountRef.current >= bonusTotalRef.current && bonusTotalRef.current > 0;
          if (allKilled) bonusScoreRef.current += 5000;
          bonusTimerRef.current = now;
          setBonusPhaseSync('result');
        }
        return;
      }
      if (bonusPhaseRef.current === 'result') {
        if (elapsed > 3000) { bonusTimerRef.current = now; setBonusPhaseSync('countdown_end'); }
        return;
      }
      if (bonusPhaseRef.current === 'countdown_end') {
        if (elapsed > 5000) {
          setBonusPhaseSync('none');
          enemiesRef.current = [];
          bulletsRef.current = [];
          // Advance to next level
          const nextLvl = levelRef.current + 1;
          levelRef.current = nextLvl;
          setLevel(nextLvl);
          spawnEnemies(nextLvl);
        }
        updatePlayerMove();
        updateParticles();
      }
      if (bonusPhaseRef.current === 'boss_clear') {
        if (elapsed > 5000) {
          setBonusPhaseSync('none');
          enemiesRef.current = [];
          bulletsRef.current = [];
          const nextLvl = levelRef.current + 1;
          levelRef.current = nextLvl;
          setLevel(nextLvl);
          if (nextLvl % 20 === 0) {
            startBonusStage();
          } else {
            spawnEnemies(nextLvl);
          }
        }
        updatePlayerMove();
        updateParticles();
      }
      return;
    }

    updatePlayer(); updateEnemies(); updateBullets(); updatePowerUps(); updateParticles(); checkCollisions();

    // Boss phase tracking
    if (bossActive.current) {
      const boss = enemiesRef.current.find(e => e.type === 'BOSS' && e.alive);
      if (boss) {
        const hpRatio = boss.hp / boss.maxHp;
        const lvl = levelRef.current;
        let newPhase = 1;
        if (lvl >= 61) {
          if (hpRatio <= 0.40) newPhase = 3;
          else if (hpRatio <= 0.75) newPhase = 2;
        } else if (lvl >= 31) {
          if (hpRatio <= 0.50) newPhase = 2;
        }
        if (newPhase > bossPhaseRef.current) {
          bossPhaseRef.current = newPhase;
          screenShake.current = 30;
          phaseTransitionFlashRef.current = now;
          // Spawn minions on phase 3 entry
          if (newPhase === 3 && !bossMinionsSpawnedRef.current) {
            bossMinionsSpawnedRef.current = true;
            for (let i = 0; i < 2; i++) {
              const mx = boss.x + (i === 0 ? -50 : boss.width + 20);
              enemiesRef.current.push({ x: mx, y: boss.y + 30, originX: mx, originY: boss.y + 80, width: ENEMY_SIZE, height: ENEMY_SIZE, alive: true, type: 'RED', hp: 2, maxHp: 2, isDiving: false, diveAngle: 0, scoreValue: 500 });
            }
          }
        }
      }
    }

    // Level transition
    if (enemiesRef.current.length > 0 && enemiesRef.current.every(e => !e.alive)) {
      audio.playPowerUp();
      if (bossActive.current) {
        // Boss defeated: 5-second countdown before next level
        bossActive.current = false;
        bulletsRef.current = [];
        enemiesRef.current = [];
        bonusTimerRef.current = Date.now();
        setBonusPhaseSync('boss_clear');
      } else {
        bulletsRef.current = [];
        const nextLvl = levelRef.current + 1;
        levelRef.current = nextLvl;
        setLevel(nextLvl);
        if (nextLvl % 20 === 0) {
          startBonusStage();
        } else {
          spawnEnemies(nextLvl);
        }
      }
    }
  };

  const updateBonusEnemies = () => {
    enemiesRef.current.forEach(e => {
      if (!e.alive) return;
      // Bonus enemies just fly through
      if (e.diveAngle === 0) {
        // Flying right or downward
        e.x += 3;
        e.y += 2 + Math.sin(Date.now() / 200 + e.originX) * 1.5;
      } else if (Math.abs(e.diveAngle - Math.PI) < 0.1) {
        // Flying left
        e.x -= 3;
        e.y += 2 + Math.sin(Date.now() / 200 + e.originX) * 1.5;
      } else {
        // V-formation: fly downward with sine wobble
        e.y += 4;
        e.x += Math.sin(Date.now() / 300 + e.originX * 0.1) * 2;
      }
      // Remove if off screen
      if (e.y > canvasHeightRef.current + 50 || e.x > CANVAS_WIDTH + 100 || e.x < -100) {
        e.alive = false;
      }
    });
  };

  const checkBonusCollisions = () => {
    // Player bullets hit enemies, but enemies don't hurt player
    bulletsRef.current.filter(b => b.fromPlayer).forEach(bullet => {
      enemiesRef.current.filter(e => e.alive).forEach((enemy) => {
        if (bullet.active && rectIntersect(bullet, enemy)) {
          if (bullet.piercing && bullet.hitEnemies) {
            const idx = enemiesRef.current.indexOf(enemy);
            if (bullet.hitEnemies.has(idx)) return;
            bullet.hitEnemies.add(idx);
          }
          if (!bullet.piercing && !bullet.isThunder) bullet.active = false;
          if (bullet.isThunder) bullet.active = false;
          enemy.hp -= (bullet.isThunder && bullet.thunderDamage) ? bullet.thunderDamage : 1;
          if (enemy.hp <= 0) {
            enemy.alive = false;
            bonusKillCountRef.current++;
            const pts = enemy.scoreValue * getScoreMultiplier();
            bonusScoreRef.current += pts;
            createExplosion(enemy.x + enemy.width / 2, enemy.y + enemy.height / 2, 6);
            audio.playExplosion();
            setScore(s => { const ns = s + pts; if (ns > highScore) { setHighScore(ns); localStorage.setItem('galaga-highscore', ns.toString()); } return ns; });
          }
        }
      });
    });
  };

  const draw = (ctx: CanvasRenderingContext2D) => {
    ctx.save();
    if (screenShake.current > 0) { ctx.translate((Math.random()-0.5)*screenShake.current, (Math.random()-0.5)*screenShake.current); screenShake.current *= 0.9; }
    updateBackground(ctx); drawPlayer(ctx); drawEnemies(ctx); drawBullets(ctx); drawPowerUps(ctx); drawParticles(ctx);

    // Boss laser drawing
    if (bossLaserRef.current.phase !== 'none') {
      const laser = bossLaserRef.current;
      const now = Date.now();
      const elapsed = now - laser.startTime;
      if (laser.phase === 'warning') {
        // Flashing thin line
        const flash = Math.floor(now / 80) % 2 === 0;
        if (flash) {
          ctx.strokeStyle = 'rgba(255, 0, 0, 0.6)';
          ctx.lineWidth = 2;
          ctx.setLineDash([8, 4]);
          ctx.beginPath();
          ctx.moveTo(laser.x, 0);
          ctx.lineTo(laser.x, canvasHeightRef.current);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      } else if (laser.phase === 'firing') {
        // Thick beam
        const intensity = Math.min(1, elapsed / 200);
        const width = 30 * intensity;
        const grd = ctx.createLinearGradient(laser.x - width, 0, laser.x + width, 0);
        grd.addColorStop(0, 'rgba(255, 0, 0, 0)');
        grd.addColorStop(0.3, 'rgba(255, 100, 100, 0.5)');
        grd.addColorStop(0.5, 'rgba(255, 255, 255, 0.9)');
        grd.addColorStop(0.7, 'rgba(255, 100, 100, 0.5)');
        grd.addColorStop(1, 'rgba(255, 0, 0, 0)');
        ctx.fillStyle = grd;
        ctx.fillRect(laser.x - width, 0, width * 2, canvasHeightRef.current);
      }
    }

    // Slow time overlay
    if (Date.now() < slowTimeEndRef.current) {
      ctx.fillStyle = 'rgba(100, 150, 255, 0.08)';
      ctx.fillRect(0, 0, CANVAS_WIDTH, canvasHeightRef.current);
    }

    // Phase transition flash
    if (phaseTransitionFlashRef.current > 0) {
      const elapsed = Date.now() - phaseTransitionFlashRef.current;
      if (elapsed < 500) {
        ctx.fillStyle = `rgba(255, 255, 255, ${0.6 * (1 - elapsed / 500)})`;
        ctx.fillRect(0, 0, CANVAS_WIDTH, canvasHeightRef.current);
      } else {
        phaseTransitionFlashRef.current = 0;
      }
    }

    // Draw slow time / double score HUD on canvas
    const now = Date.now();
    let hudY = canvasHeightRef.current - 50;
    if (now < slowTimeEndRef.current) {
      const remaining = Math.ceil((slowTimeEndRef.current - now) / 1000);
      ctx.fillStyle = 'rgba(100, 150, 255, 0.3)';
      ctx.fillRect(CANVAS_WIDTH - 110, hudY - 16, 100, 20);
      ctx.fillStyle = '#AACCFF';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`減速 ${remaining}s`, CANVAS_WIDTH - 14, hudY - 2);
      hudY -= 22;
    }
    if (now < doubleScoreEndRef.current) {
      const remaining = Math.ceil((doubleScoreEndRef.current - now) / 1000);
      const flash = Math.floor(now / 300) % 2 === 0;
      ctx.fillStyle = 'rgba(255, 215, 0, 0.3)';
      ctx.fillRect(CANVAS_WIDTH - 110, hudY - 16, 100, 20);
      ctx.fillStyle = flash ? '#FFD700' : '#FFA500';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`x2 分數 ${remaining}s`, CANVAS_WIDTH - 14, hudY - 2);
    }
    ctx.textAlign = 'left';

    ctx.restore();
  };

  const gameLoop = () => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    update(); draw(ctx);
    requestRef.current = requestAnimationFrame(gameLoop);
  };

  useEffect(() => {
    if (gameState === 'PLAYING') { if (requestRef.current) cancelAnimationFrame(requestRef.current); requestRef.current = requestAnimationFrame(gameLoop); }
    return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current); };
  }, [gameState]);

  const updateBackground = (ctx: CanvasRenderingContext2D) => { const ch = canvasHeightRef.current; ctx.fillStyle = '#000814'; ctx.fillRect(0, 0, CANVAS_WIDTH, ch); ctx.fillStyle = '#ffffff'; starsRef.current.forEach(star => { star.y += star.speed; if (star.y > ch) star.y = 0; ctx.fillRect(star.x, star.y, star.size, star.size); }); };

  const updatePlayerMove = () => {
    const fragSpeed = fragmentsRef.current.speed;
    const speed = 6 + fragSpeed;
    if (keysRef.current.has('ArrowLeft') && playerRef.current.x > 0) playerRef.current.x -= speed;
    if (keysRef.current.has('ArrowRight') && playerRef.current.x < CANVAS_WIDTH - PLAYER_SIZE) playerRef.current.x += speed;
  };

  const updatePlayer = () => {
    updatePlayerMove();
    const now = Date.now();
    const wLevel = weaponLevelRef.current;
    const fireRate = Math.max(100, 300 - (wLevel * 20));
    if (now - lastShotRef.current > fireRate) {
      const centerX = playerRef.current.x + PLAYER_SIZE / 2;
      const centerY = playerRef.current.y;
      if (wLevel === 1) {
        const bColor = '#00FFFF';
        bulletsRef.current.push({ x: centerX - 2, y: centerY, width: 4, height: 12, active: true, fromPlayer: true, color: bColor, vx: 0, vy: -10 });
      } else if (wLevel === 2) {
        const bColor = '#00FFFF';
        bulletsRef.current.push({ x: centerX - 10, y: centerY, width: 4, height: 12, active: true, fromPlayer: true, color: bColor, vx: 0, vy: -10 }, { x: centerX + 6, y: centerY, width: 4, height: 12, active: true, fromPlayer: true, color: bColor, vx: 0, vy: -10 });
      } else if (wLevel === 3) {
        const bColor = '#00FFFF';
        bulletsRef.current.push({ x: centerX - 2, y: centerY, width: 4, height: 12, active: true, fromPlayer: true, color: bColor, vx: 0, vy: -10 }, { x: centerX - 12, y: centerY, width: 4, height: 12, active: true, fromPlayer: true, color: bColor, vx: -2, vy: -10 }, { x: centerX + 8, y: centerY, width: 4, height: 12, active: true, fromPlayer: true, color: bColor, vx: 2, vy: -10 });
      } else if (wLevel === 4) {
        const bColor = '#FFD700';
        bulletsRef.current.push({ x: centerX - 2, y: centerY, width: 4, height: 12, active: true, fromPlayer: true, color: bColor, vx: 0, vy: -10, isRicochet: false }, { x: centerX - 12, y: centerY, width: 4, height: 12, active: true, fromPlayer: true, color: bColor, vx: -2, vy: -10, isRicochet: false }, { x: centerX + 8, y: centerY, width: 4, height: 12, active: true, fromPlayer: true, color: bColor, vx: 2, vy: -10, isRicochet: false });
      } else if (wLevel === 5) {
        const pColor = '#00FF88';
        bulletsRef.current.push(
          { x: centerX - 2, y: centerY, width: 5, height: 14, active: true, fromPlayer: true, color: pColor, vx: 0, vy: -10, piercing: true, hitEnemies: new Set<number>() },
          { x: centerX - 14, y: centerY, width: 5, height: 14, active: true, fromPlayer: true, color: pColor, vx: -1.5, vy: -10, piercing: true, hitEnemies: new Set<number>() },
          { x: centerX + 10, y: centerY, width: 5, height: 14, active: true, fromPlayer: true, color: pColor, vx: 1.5, vy: -10, piercing: true, hitEnemies: new Set<number>() },
          { x: centerX - 22, y: centerY, width: 5, height: 14, active: true, fromPlayer: true, color: pColor, vx: -3.5, vy: -9, piercing: true, hitEnemies: new Set<number>() },
          { x: centerX + 18, y: centerY, width: 5, height: 14, active: true, fromPlayer: true, color: pColor, vx: 3.5, vy: -9, piercing: true, hitEnemies: new Set<number>() }
        );
      }
      audio.playShoot(); lastShotRef.current = now;
    }

    // Thunder auto-fire
    const tLevel = thunderLevelRef.current;
    if (tLevel > 0) {
      const cooldowns = [0, 1500, 1200, 1000, 800, 600];
      const counts = [0, 1, 1, 2, 2, 3];
      const speeds = [0, 3, 4, 4, 5, 5];
      const damages = [0, 1, 2, 2, 2, 3];
      const radii = [0, 0, 0, 0, 40, 60];
      const cooldown = cooldowns[tLevel];
      const count = counts[tLevel];
      const tSpeed = speeds[tLevel];
      const tDamage = damages[tLevel];
      const tRadius = radii[tLevel];

      if (now - lastThunderShotRef.current > cooldown) {
        const centerX = playerRef.current.x + PLAYER_SIZE / 2;
        const centerY = playerRef.current.y;
        const aliveEnemies = enemiesRef.current.filter(e => e.alive);

        for (let i = 0; i < count; i++) {
          let vx = 0, vy = -tSpeed;
          if (aliveEnemies.length > 0) {
            let nearest = aliveEnemies[0];
            let minDist = Infinity;
            aliveEnemies.forEach(e => {
              const dx = (e.x + e.width / 2) - centerX;
              const dy = (e.y + e.height / 2) - centerY;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist < minDist) { minDist = dist; nearest = e; }
            });
            const dx = (nearest.x + nearest.width / 2) - centerX;
            const dy = (nearest.y + nearest.height / 2) - centerY;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            vx = (dx / dist) * tSpeed;
            vy = (dy / dist) * tSpeed;
            if (count > 1) {
              const spreadAngle = (i - (count - 1) / 2) * 0.3;
              const cos = Math.cos(spreadAngle), sin = Math.sin(spreadAngle);
              const nvx = vx * cos - vy * sin;
              const nvy = vx * sin + vy * cos;
              vx = nvx; vy = nvy;
            }
          }
          bulletsRef.current.push({
            x: centerX - 4, y: centerY, width: 8, height: 8,
            active: true, fromPlayer: true, color: '#AA77FF',
            vx, vy, isThunder: true, thunderDamage: tDamage, thunderRadius: tRadius
          });
        }
        lastThunderShotRef.current = now;
      }
    }

    // Ally auto-fire
    const aLevel = allyLevelRef.current;
    if (aLevel > 0) {
      const allyCooldown = aLevel >= 4 ? 280 : 400;
      if (now - lastAllyShotRef.current > allyCooldown) {
        const px = playerRef.current.x + PLAYER_SIZE / 2;
        const py = playerRef.current.y + PLAYER_SIZE / 2;
        const allyPositions: [number, number][] = [];
        if (aLevel >= 1) allyPositions.push([-25, 20]);
        if (aLevel >= 2) allyPositions.push([25, 20]);
        if (aLevel >= 5) allyPositions.push([0, 30]);

        const allyColor = '#FF8800';
        allyPositions.forEach(([ox, oy]) => {
          const ax = px + ox;
          const ay = py + oy;
          if (aLevel <= 2) {
            bulletsRef.current.push({ x: ax - 2, y: ay, width: 3, height: 10, active: true, fromPlayer: true, color: allyColor, vx: 0, vy: -9 });
          } else {
            bulletsRef.current.push(
              { x: ax - 4, y: ay, width: 3, height: 10, active: true, fromPlayer: true, color: allyColor, vx: -1, vy: -9 },
              { x: ax + 2, y: ay, width: 3, height: 10, active: true, fromPlayer: true, color: allyColor, vx: 1, vy: -9 }
            );
          }
        });
        lastAllyShotRef.current = now;
      }
    }

    // Orbital weapon: rotate and damage enemies on contact
    const oLevel = orbitalLevelRef.current;
    if (oLevel > 0) {
      orbitalAngleRef.current += 0.03; // slow rotation
      const cx = playerRef.current.x + PLAYER_SIZE / 2;
      const cy = playerRef.current.y + PLAYER_SIZE / 2;
      const orbitRadius = 45;
      const ballRadius = 8;
      const scoreMul = getScoreMultiplier();
      for (let i = 0; i < oLevel; i++) {
        const angle = orbitalAngleRef.current + (i * Math.PI * 2) / oLevel;
        const bx = cx + Math.cos(angle) * orbitRadius;
        const by = cy + Math.sin(angle) * orbitRadius;
        // Check collision with enemies
        enemiesRef.current.filter(e => e.alive).forEach(enemy => {
          const ex = enemy.x + enemy.width / 2;
          const ey = enemy.y + enemy.height / 2;
          const dx = bx - ex;
          const dy = by - ey;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < ballRadius + enemy.width / 2) {
            enemy.hp -= 1;
            if (enemy.hp <= 0) {
              enemy.alive = false;
              createExplosion(enemy.x + enemy.width / 2, enemy.y + enemy.height / 2, enemy.type === 'BOSS' ? 30 : 10);
              audio.playExplosion();
              const pts = enemy.scoreValue * scoreMul;
              setScore(s => { const ns = s + pts; if (ns > highScore) { setHighScore(ns); localStorage.setItem('galaga-highscore', ns.toString()); } return ns; });
              if (enemy.type === 'BOSS') {
                spawnPowerUp(enemy.x + enemy.width / 2, enemy.y);
                spawnFragmentPowerUp(enemy.x + enemy.width / 2, enemy.y - 20);
              } else if (enemy.isElite) {
                spawnPowerUp(enemy.x + enemy.width / 2, enemy.y);
              } else {
                const dropChance = 0.05 + fragmentsRef.current.dropRate * 0.02;
                if (Math.random() < dropChance) spawnPowerUp(enemy.x + enemy.width / 2, enemy.y);
              }
            }
          }
        });
      }
    }
  };

  const updateEnemies = () => {
    const now = Date.now();
    const isSlowed = now < slowTimeEndRef.current;
    const slowMul = isSlowed ? 0.5 : 1;

    formationOffset.current += 0.05 * formationDir.current * slowMul; if (Math.abs(formationOffset.current) > 30) formationDir.current *= -1;
    const difficultyFactor = 1 + (levelRef.current * 0.01);
    enemiesRef.current.forEach(e => {
      if (!e.alive) return;
      const eliteSpeedMul = e.isElite ? 1.3 : 1;
      if (e.type === 'BOSS') {
        const phase = bossPhaseRef.current;
        const moveSpeedMul = phase >= 2 ? 1.5 : 1;
        if (e.y < e.originY) e.y += 2 * slowMul;
        e.x = e.originX + Math.sin(now / 1000) * 100 * moveSpeedMul * slowMul;
        const n = bossAppearanceCountRef.current;
        const bossFactor = Math.pow(1.1, n - 1);
        const bossShootChance = (0.05 + (levelRef.current * 0.005)) * 1.3 * bossFactor * slowMul;
        const bossBulletSpeed = 5 * difficultyFactor * bossFactor * slowMul;
        const bulletsPerShot = Math.max(1, Math.round(bossFactor));
        if (Math.random() < bossShootChance) {
          for (let i = 0; i < bulletsPerShot; i++) {
            const angle = (Math.random() * Math.PI) / 1.5 + Math.PI / 6;
            bulletsRef.current.push({ x: e.x + e.width/2, y: e.y + e.height - 20, width: 6, height: 6, active: true, fromPlayer: false, color: '#FF00FF', vx: Math.cos(angle) * bossBulletSpeed, vy: Math.sin(angle) * bossBulletSpeed });
          }
        }

        // Phase 2+: Homing missiles
        if (phase >= 2) {
          if (now - bossHomingTimerRef.current > 2000 / slowMul) {
            bossHomingTimerRef.current = now;
            const missileCount = phase >= 3 ? 2 : 1;
            for (let i = 0; i < missileCount; i++) {
              const mx = e.x + e.width / 2 + (i === 0 ? -15 : 15);
              const my = e.y + e.height;
              bulletsRef.current.push({ x: mx, y: my, width: 6, height: 10, active: true, fromPlayer: false, color: '#FF3333', vx: 0, vy: 3 * slowMul, isHoming: true });
            }
          }
        }

        // Phase 3: Laser beam
        if (phase >= 3) {
          const laser = bossLaserRef.current;
          if (laser.phase === 'none') {
            // Start new laser every 5 seconds
            if (now - laser.startTime > 5000) {
              bossLaserRef.current = { x: playerRef.current.x + PLAYER_SIZE / 2 + (Math.random() - 0.5) * 60, startTime: now, phase: 'warning' };
            }
          } else if (laser.phase === 'warning') {
            if (now - laser.startTime > 800) {
              bossLaserRef.current = { ...laser, startTime: now, phase: 'firing' };
            }
          } else if (laser.phase === 'firing') {
            if (now - laser.startTime > 1500) {
              bossLaserRef.current = { x: 0, startTime: now, phase: 'none' };
            }
          }
        }
      } else if (e.isDiving) {
        const targetX = playerRef.current.x + PLAYER_SIZE / 2 - e.width / 2;
        const dxToPlayer = targetX - e.x;
        e.x += Math.sign(dxToPlayer) * Math.min(Math.abs(dxToPlayer), 3) * difficultyFactor * eliteSpeedMul * slowMul + Math.sin(e.diveAngle) * 2 * slowMul;
        e.y += 5 * difficultyFactor * eliteSpeedMul * slowMul;
        e.diveAngle += 0.1;
        if (e.y > canvasHeightRef.current) { e.y = -50; e.isDiving = false; }
      }
      else {
        e.x = e.originX + Math.sin(formationOffset.current) * 20;
        const diveChance = e.type === 'PURPLE' ? 0.002 : e.type === 'RED' ? 0.001 : 0.0005;
        if (Math.random() < diveChance * difficultyFactor * slowMul) {
          e.isDiving = true; e.diveAngle = 0;
          const dx = (playerRef.current.x + PLAYER_SIZE / 2) - (e.x + e.width / 2);
          e.diveAngle = Math.atan2(1, dx / 100);
        }
      }
      // 敵機射擊：降低成長幅度與上限，避免高關卡子彈瞬間過於密集
      const shootDifficulty = 1 + (levelRef.current * 0.005);
      const shootChance = Math.min(0.006, (0.0015 + (levelRef.current * 0.00015)) * shootDifficulty) * slowMul;
      const enemyBulletCount = bulletsRef.current.filter(b => !b.fromPlayer && !b.isHoming).length;
      if (Math.random() < shootChance && e.type !== 'BOSS' && enemyBulletCount < 22) { bulletsRef.current.push({ x: e.x + e.width/2, y: e.y + e.height, width: 4, height: 8, active: true, fromPlayer: false, color: '#FF0000', vx: 0, vy: 5 * difficultyFactor * slowMul }); }
    });
  };

  const updateBullets = () => {
    const now = Date.now();
    const isSlowed = now < slowTimeEndRef.current;
    const slowMul = isSlowed ? 0.5 : 1;

    bulletsRef.current.forEach(b => {
      if (b.isThunder) {
        const aliveEnemies = enemiesRef.current.filter(e => e.alive);
        if (aliveEnemies.length > 0) {
          let nearest = aliveEnemies[0];
          let minDist = Infinity;
          aliveEnemies.forEach(e => {
            const dx = (e.x + e.width / 2) - (b.x + b.width / 2);
            const dy = (e.y + e.height / 2) - (b.y + b.height / 2);
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < minDist) { minDist = dist; nearest = e; }
          });
          const dx = (nearest.x + nearest.width / 2) - (b.x + b.width / 2);
          const dy = (nearest.y + nearest.height / 2) - (b.y + b.height / 2);
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const currentSpeed = Math.sqrt(b.vx * b.vx + b.vy * b.vy) || 1;
          const targetVx = (dx / dist) * currentSpeed;
          const targetVy = (dy / dist) * currentSpeed;
          b.vx += (targetVx - b.vx) * 0.08;
          b.vy += (targetVy - b.vy) * 0.08;
          const newSpeed = Math.sqrt(b.vx * b.vx + b.vy * b.vy) || 1;
          b.vx = (b.vx / newSpeed) * currentSpeed;
          b.vy = (b.vy / newSpeed) * currentSpeed;
        }
      }
      // Homing missiles (enemy): steer toward player
      if (b.isHoming && !b.fromPlayer) {
        const px = playerRef.current.x + PLAYER_SIZE / 2;
        const py = playerRef.current.y + PLAYER_SIZE / 2;
        const dx = px - (b.x + b.width / 2);
        const dy = py - (b.y + b.height / 2);
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const currentSpeed = Math.sqrt(b.vx * b.vx + b.vy * b.vy) || 3;
        const targetVx = (dx / dist) * currentSpeed;
        const targetVy = (dy / dist) * currentSpeed;
        b.vx += (targetVx - b.vx) * 0.05;
        b.vy += (targetVy - b.vy) * 0.05;
        const newSpeed = Math.sqrt(b.vx * b.vx + b.vy * b.vy) || 1;
        b.vx = (b.vx / newSpeed) * currentSpeed;
        b.vy = (b.vy / newSpeed) * currentSpeed;
      }
      // Apply slow time to enemy bullets
      const mul = (!b.fromPlayer && !b.isThunder) ? slowMul : 1;
      b.x += b.vx * mul; b.y += b.vy * mul;
    });
    bulletsRef.current = bulletsRef.current.filter(b => b.y > -50 && b.y < canvasHeightRef.current + 50 && b.x > -50 && b.x < CANVAS_WIDTH + 50 && b.active);
  };

  const updatePowerUps = () => { powerUpsRef.current.forEach(p => p.y += 3); powerUpsRef.current = powerUpsRef.current.filter(p => p.y < canvasHeightRef.current && p.active); };
  const updateParticles = () => { particlesRef.current.forEach(p => { p.x += p.vx; p.y += p.vy; p.life -= 0.02; }); particlesRef.current = particlesRef.current.filter(p => p.life > 0); };

  const checkCollisions = () => {
    const ricochetBullets: Bullet[] = [];
    const scoreMul = getScoreMultiplier();
    bulletsRef.current.filter(b => b.fromPlayer).forEach(bullet => {
      enemiesRef.current.filter(e => e.alive).forEach((enemy, idx) => {
        if (bullet.active && rectIntersect(bullet, enemy)) {
          if (bullet.piercing && bullet.hitEnemies) {
            if (bullet.hitEnemies.has(idx)) return;
            bullet.hitEnemies.add(idx);
          }

          if (bullet.isThunder) {
            bullet.active = false;
            const dmg = bullet.thunderDamage || 1;
            enemy.hp -= dmg;
            screenShake.current = enemy.type === 'BOSS' ? 2 : 5;
            if (bullet.thunderRadius && bullet.thunderRadius > 0) {
              const aoeDmg = bullet.thunderRadius >= 60 ? 2 : 1;
              const cx = enemy.x + enemy.width / 2;
              const cy = enemy.y + enemy.height / 2;
              enemiesRef.current.filter(e => e.alive && e !== enemy).forEach(e => {
                const dx = (e.x + e.width / 2) - cx;
                const dy = (e.y + e.height / 2) - cy;
                if (Math.sqrt(dx * dx + dy * dy) < bullet.thunderRadius!) {
                  e.hp -= aoeDmg;
                  if (e.hp <= 0) {
                    e.alive = false;
                    createExplosion(e.x + e.width / 2, e.y + e.height / 2, 10);
                    audio.playExplosion();
                    const pts = e.scoreValue * scoreMul;
                    setScore(s => { const ns = s + pts; if (ns > highScore) { setHighScore(ns); localStorage.setItem('galaga-highscore', ns.toString()); } return ns; });
                    if (e.isElite || Math.random() < 0.05 + fragmentsRef.current.dropRate * 0.02) spawnPowerUp(e.x + e.width / 2, e.y);
                  }
                }
              });
              for (let i = 0; i < 12; i++) {
                particlesRef.current.push({ x: cx, y: cy, vx: (Math.random() - 0.5) * 16, vy: (Math.random() - 0.5) * 16, life: 0.8, color: Math.random() > 0.5 ? '#EECCFF' : '#FFFFFF' });
              }
            }
          } else {
            if (!bullet.piercing) bullet.active = false;
            enemy.hp--;
            screenShake.current = enemy.type === 'BOSS' ? 2 : 5;
            if (bullet.isRicochet === false) {
              for (let i = 0; i < 3; i++) {
                const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.8;
                ricochetBullets.push({ x: enemy.x + enemy.width / 2, y: enemy.y + enemy.height / 2, width: 3, height: 8, active: true, fromPlayer: true, color: '#FFA500', vx: Math.cos(angle) * 8, vy: Math.sin(angle) * 8, isRicochet: true });
              }
            }
          }
          if (enemy.hp <= 0) {
            enemy.alive = false;
            createExplosion(enemy.x + enemy.width / 2, enemy.y + enemy.height / 2, enemy.type === 'BOSS' ? 30 : 10);
            audio.playExplosion();
            const pts = enemy.scoreValue * scoreMul;
            setScore(s => { const ns = s + pts; if (ns > highScore) { setHighScore(ns); localStorage.setItem('galaga-highscore', ns.toString()); } return ns; });
            // Elite: 100% drop. Boss: drop fragment + normal. Others: chance-based
            if (enemy.type === 'BOSS') {
              spawnPowerUp(enemy.x + enemy.width / 2, enemy.y);
              // Boss drops fragment
              spawnFragmentPowerUp(enemy.x + enemy.width / 2, enemy.y - 20);
            } else if (enemy.isElite) {
              spawnPowerUp(enemy.x + enemy.width / 2, enemy.y);
            } else {
              const dropChance = 0.05 + fragmentsRef.current.dropRate * 0.02;
              if (Math.random() < dropChance) spawnPowerUp(enemy.x + enemy.width / 2, enemy.y);
            }
          }
        }
      });
    });
    if (ricochetBullets.length > 0) bulletsRef.current.push(...ricochetBullets);

    const playerBox = { x: playerRef.current.x + 5, y: playerRef.current.y + 5, width: PLAYER_SIZE - 10, height: PLAYER_SIZE - 10 };

    // Enemy bullets hit player
    bulletsRef.current.filter(b => !b.fromPlayer).forEach(b => { if (rectIntersect(b, playerBox)) { b.active = false; handlePlayerHit(); } });
    // Enemy collision with player
    enemiesRef.current.filter(e => e.alive).forEach(e => { if (rectIntersect(e, playerBox)) { if (e.type !== 'BOSS') e.alive = false; handlePlayerHit(); } });
    // Power-up collection
    powerUpsRef.current.filter(p => p.active).forEach(p => { if (rectIntersect(p, playerBox)) { p.active = false; applyPowerUp(p.type); } });

    // Laser damage
    if (bossLaserRef.current.phase === 'firing') {
      const laser = bossLaserRef.current;
      const laserHalfWidth = 15;
      const px = playerRef.current.x + PLAYER_SIZE / 2;
      if (Math.abs(px - laser.x) < laserHalfWidth + PLAYER_SIZE / 4) {
        handlePlayerHit();
      }
    }
  };

  const rectIntersect = (a: any, b: any) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

  const handlePlayerHit = () => {
    // Bonus stage: player doesn't take damage
    if (bonusPhaseRef.current === 'playing') return;

    if (invulnerableRef.current > 0) return;
    if (shieldCountRef.current > 0) { shieldCountRef.current -= 1; setShieldCount(shieldCountRef.current); audio.playPowerUp(); screenShake.current = 10; invulnerableRef.current = 1.0; return; }

    // 被擊中：Buff 全部重置（但保留碎片基礎值）
    const frags = fragmentsRef.current;
    const initWeapon = Math.min(1 + frags.weaponLevel, 5);
    weaponLevelRef.current = initWeapon; setWeaponLevel(initWeapon);
    shieldCountRef.current = frags.shield; setShieldCount(frags.shield);
    thunderLevelRef.current = 0; setThunderLevel(0);
    allyLevelRef.current = 0; setAllyLevel(0);
    orbitalLevelRef.current = frags.orbital; setOrbitalLevel(frags.orbital);

    screenShake.current = 25; invulnerableRef.current = 1.5;
    setLives(l => { if (l <= 1) { setGameState('GAMEOVER'); audio.playGameOver(); audio.stopBGM(); return 0; } audio.playExplosion(); return l - 1; });
  };

  const createExplosion = (x: number, y: number, count: number) => { for (let i = 0; i < count; i++) { particlesRef.current.push({ x, y, vx: (Math.random()-0.5)*12, vy: (Math.random()-0.5)*12, life: 1, color: `hsl(${Math.random()*60 + 10}, 100%, 50%)` }); } };

  const spawnPowerUp = (x: number, y: number) => {
    // Weighted random: SLOW_TIME has 1/5 the weight of others
    const types: { type: PowerUpType; weight: number }[] = [
      { type: 'DOUBLE_SHOT', weight: 5 },
      { type: 'SHIELD', weight: 5 },
      { type: 'LIFE', weight: 5 },
      { type: 'THUNDER', weight: 5 },
      { type: 'ALLY', weight: 5 },
      { type: 'SLOW_TIME', weight: 1 },
      { type: 'DOUBLE_SCORE', weight: 5 },
      { type: 'ORBITAL', weight: 4 },
    ];
    const totalWeight = types.reduce((s, t) => s + t.weight, 0);
    let r = Math.random() * totalWeight;
    let chosen: PowerUpType = 'DOUBLE_SHOT';
    for (const t of types) {
      r -= t.weight;
      if (r <= 0) { chosen = t.type; break; }
    }
    powerUpsRef.current.push({ x, y, width: 20, height: 20, type: chosen, active: true });
  };

  const spawnFragmentPowerUp = (x: number, y: number) => {
    powerUpsRef.current.push({ x, y, width: 24, height: 24, type: 'FRAGMENT', active: true });
  };

  const applyPowerUp = (type: PowerUpType) => {
    audio.playPowerUp();
    if (type === 'LIFE') setLives(l => Math.min(l + 1, 3));
    else if (type === 'SHIELD') { shieldCountRef.current = Math.min(shieldCountRef.current + 1, 3); setShieldCount(shieldCountRef.current); }
    else if (type === 'THUNDER') { if (thunderLevelRef.current < 5) { thunderLevelRef.current += 1; setThunderLevel(thunderLevelRef.current); } }
    else if (type === 'ALLY') { if (allyLevelRef.current < 5) { allyLevelRef.current += 1; setAllyLevel(allyLevelRef.current); } }
    else if (type === 'SLOW_TIME') { slowTimeEndRef.current = Date.now() + 8000; }
    else if (type === 'DOUBLE_SCORE') { doubleScoreEndRef.current = Date.now() + 15000; }
    else if (type === 'FRAGMENT') { applyFragment(); }
    else if (type === 'ORBITAL') { if (orbitalLevelRef.current < 3) { orbitalLevelRef.current += 1; setOrbitalLevel(orbitalLevelRef.current); } }
    else { if (weaponLevelRef.current < 5) { weaponLevelRef.current += 1; setWeaponLevel(weaponLevelRef.current); } }
  };

  const applyFragment = () => {
    const frags = { ...fragmentsRef.current };
    // Find upgradeable stats
    const upgradeable: { key: keyof FragmentData; label: string; max: number }[] = [];
    if (frags.weaponLevel < 3) upgradeable.push({ key: 'weaponLevel', label: '初始武器 +1', max: 3 });
    if (frags.dropRate < 5) upgradeable.push({ key: 'dropRate', label: '道具掉落率 +2%', max: 5 });
    if (frags.shield < 2) upgradeable.push({ key: 'shield', label: '初始護盾 +1', max: 2 });
    if (frags.speed < 3) upgradeable.push({ key: 'speed', label: '移動速度 +1', max: 3 });
    if (frags.orbital < 3) upgradeable.push({ key: 'orbital', label: '初始護衛球 +1', max: 3 });
    if (upgradeable.length === 0) {
      setFragmentMsg('所有碎片已滿級!');
      setTimeout(() => setFragmentMsg(''), 3000);
      return;
    }
    const chosen = upgradeable[Math.floor(Math.random() * upgradeable.length)];
    frags[chosen.key] = Math.min(frags[chosen.key] + 1, chosen.max);
    fragmentsRef.current = frags;
    setFragmentMsg(`碎片: ${chosen.label}`);
    setTimeout(() => setFragmentMsg(''), 3000);
  };

  const drawPixelArt = (ctx: CanvasRenderingContext2D, data: number[][], x: number, y: number, size: number, color: string) => { const pSize = size / data[0].length; ctx.fillStyle = color; data.forEach((row, i) => { row.forEach((pixel, j) => { if (pixel) ctx.fillRect(x + j * pSize, y + i * pSize, pSize + 0.5, pSize + 0.5); }); }); };

  const drawPlayer = (ctx: CanvasRenderingContext2D) => {
    const { x, y } = playerRef.current;
    if (invulnerableRef.current > 0 && Math.floor(Date.now() / 100) % 2 === 0) ctx.globalAlpha = 0.3;
    drawPixelArt(ctx, PIXEL_DATA.PLAYER, x, y, PLAYER_SIZE, '#00D4FF');
    if (shieldCountRef.current >= 1) { const pulse = Math.sin(Date.now() / 100) * 0.2 + 0.8; ctx.strokeStyle = `rgba(0, 255, 255, ${pulse})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x + PLAYER_SIZE/2, y + PLAYER_SIZE/2, PLAYER_SIZE * 0.85, 0, Math.PI * 2); ctx.stroke(); }
    if (shieldCountRef.current >= 2) { const pulse = Math.cos(Date.now() / 150) * 0.2 + 0.7; ctx.strokeStyle = `rgba(255, 255, 0, ${pulse})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x + PLAYER_SIZE/2, y + PLAYER_SIZE/2, PLAYER_SIZE * 1.05, 0, Math.PI * 2); ctx.stroke(); }
    if (shieldCountRef.current >= 3) { const pulse = Math.sin(Date.now() / 120) * 0.2 + 0.8; ctx.strokeStyle = `rgba(255, 100, 255, ${pulse})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x + PLAYER_SIZE/2, y + PLAYER_SIZE/2, PLAYER_SIZE * 1.25, 0, Math.PI * 2); ctx.stroke(); }
    ctx.globalAlpha = 1.0;

    // Draw ally wingmen
    const aLvl = allyLevelRef.current;
    if (aLvl > 0) {
      const cx = x + PLAYER_SIZE / 2;
      const cy = y + PLAYER_SIZE / 2;
      const allySize = 20;
      const positions: [number, number][] = [];
      if (aLvl >= 1) positions.push([-25, 20]);
      if (aLvl >= 2) positions.push([25, 20]);
      if (aLvl >= 5) positions.push([0, 30]);
      const hover = Math.sin(Date.now() / 200) * 2;
      positions.forEach(([ox, oy]) => {
        drawPixelArt(ctx, PIXEL_DATA.PLAYER, cx + ox - allySize / 2, cy + oy - allySize / 2 + hover, allySize, '#FF8800');
      });
    }

    // Draw orbital balls
    const oLvl = orbitalLevelRef.current;
    if (oLvl > 0) {
      const cx2 = x + PLAYER_SIZE / 2;
      const cy2 = y + PLAYER_SIZE / 2;
      const orbitR = 45;
      for (let i = 0; i < oLvl; i++) {
        const angle = orbitalAngleRef.current + (i * Math.PI * 2) / oLvl;
        const bx = cx2 + Math.cos(angle) * orbitR;
        const by = cy2 + Math.sin(angle) * orbitR;
        ctx.save();
        ctx.shadowBlur = 12;
        ctx.shadowColor = '#00FF88';
        ctx.fillStyle = '#00FF88';
        ctx.beginPath();
        ctx.arc(bx, by, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.beginPath();
        ctx.arc(bx - 2, by - 2, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  };

  const drawEnemies = (ctx: CanvasRenderingContext2D) => {
    enemiesRef.current.forEach(e => {
      if (!e.alive) return;
      let color = '#FF5252'; let data = PIXEL_DATA.ENEMY_RED;
      if (e.type === 'PURPLE') { color = '#E040FB'; data = PIXEL_DATA.ENEMY_PURPLE; }
      if (e.type === 'YELLOW') color = '#FFEB3B';
      if (e.type === 'BOSS') { color = '#FF0055'; data = PIXEL_DATA.BOSS; }

      // Elite glow
      if (e.isElite) {
        ctx.save();
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#FFFFFF';
        drawPixelArt(ctx, data, e.x, e.y, e.width, color);
        ctx.restore();
      } else {
        drawPixelArt(ctx, data, e.x, e.y, e.width, color);
      }

      // Boss health bar with phase colors
      if (e.type === 'BOSS') {
        ctx.fillStyle = '#333';
        ctx.fillRect(e.x, e.y - 20, e.width, 10);
        const phase = bossPhaseRef.current;
        let barColor = '#FF0055';
        if (phase === 2) barColor = '#FF8800';
        if (phase === 3) barColor = '#AA00FF';
        ctx.fillStyle = barColor;
        ctx.fillRect(e.x, e.y - 20, e.width * (e.hp/e.maxHp), 10);
        // Phase indicator
        if (phase > 1) {
          ctx.fillStyle = barColor;
          ctx.font = 'bold 10px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`階段 ${phase}`, e.x + e.width / 2, e.y - 24);
          ctx.textAlign = 'left';
        }
      }
    });
  };

  const drawBullets = (ctx: CanvasRenderingContext2D) => {
    bulletsRef.current.forEach(b => {
      if (b.isThunder) {
        const tLvl = thunderLevelRef.current;
        const colors = ['#AA77FF', '#BB88FF', '#CC99FF', '#DDAAFF', '#EECCFF'];
        const color = colors[Math.min(tLvl - 1, colors.length - 1)] || '#AA77FF';
        ctx.save();
        ctx.shadowBlur = 12;
        ctx.shadowColor = '#AA77FF';
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(b.x + b.width / 2, b.y + b.height / 2, b.width / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (b.isHoming && !b.fromPlayer) {
        // Draw homing missile as red triangle
        ctx.save();
        ctx.shadowBlur = 8;
        ctx.shadowColor = '#FF3333';
        ctx.fillStyle = '#FF3333';
        const cx = b.x + b.width / 2;
        const cy = b.y + b.height / 2;
        const angle = Math.atan2(b.vy, b.vx);
        ctx.translate(cx, cy);
        ctx.rotate(angle + Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(0, -6);
        ctx.lineTo(-4, 6);
        ctx.lineTo(4, 6);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = b.color;
        ctx.shadowBlur = b.piercing ? 16 : 8;
        ctx.shadowColor = b.color;
        ctx.fillRect(b.x, b.y, b.width, b.height);
        ctx.shadowBlur = 0;
      }
    });
  };

  const drawPowerUps = (ctx: CanvasRenderingContext2D) => {
    powerUpsRef.current.forEach(p => {
      if (p.type === 'FRAGMENT') {
        // Golden fragment powerup with glow
        ctx.save();
        ctx.shadowBlur = 20;
        ctx.shadowColor = '#FFD700';
        ctx.fillStyle = '#FFD700';
        ctx.beginPath();
        ctx.arc(p.x + 12, p.y + 12, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#FFF';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('F', p.x + 12, p.y + 17);
        ctx.restore();
        return;
      }
      ctx.fillStyle = '#FFF';
      ctx.beginPath();
      ctx.arc(p.x + 10, p.y + 10, 10, 0, Math.PI * 2);
      ctx.fill();
      let labelColor = '#FF0';
      let label = 'W';
      if (p.type === 'LIFE') { labelColor = '#F00'; label = 'H'; }
      else if (p.type === 'SHIELD') { labelColor = '#00F'; label = 'S'; }
      else if (p.type === 'THUNDER') { labelColor = '#8B00FF'; label = 'T'; }
      else if (p.type === 'ALLY') { labelColor = '#FF8800'; label = 'A'; }
      else if (p.type === 'SLOW_TIME') { labelColor = '#6644CC'; label = 'X'; }
      else if (p.type === 'DOUBLE_SCORE') { labelColor = '#DAA520'; label = '$'; }
      else if (p.type === 'ORBITAL') { labelColor = '#00AA66'; label = 'O'; }
      ctx.fillStyle = labelColor;
      ctx.font = 'bold 12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(label, p.x + 10, p.y + 14);
    });
  };

  const drawParticles = (ctx: CanvasRenderingContext2D) => { particlesRef.current.forEach(p => { ctx.globalAlpha = p.life; ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 3, 3); }); ctx.globalAlpha = 1.0; };

  return (
    <div
      className="flex flex-col items-center select-none max-w-full max-h-[100dvh] min-h-0"
      style={{ aspectRatio: `${CANVAS_WIDTH} / ${canvasHeight}`, height: '100dvh' }}
    >
      <div
        ref={gameAreaRef}
        className="relative overflow-hidden bg-black touch-none w-full flex-1 min-h-0"
        style={{ touchAction: 'none' }}
      >
        <canvas ref={canvasRef} width={CANVAS_WIDTH} height={canvasHeight} className="w-full h-full block" />
        <div className="absolute top-2 left-3 right-3 flex justify-between items-start text-white font-mono z-10">
          <div><div className="text-gray-400 text-[10px] uppercase">最高分</div><div className="text-lg text-yellow-400">{highScore.toLocaleString()}</div></div>
          <div className="text-center">{bossActive.current ? <Skull className="text-red-500 animate-pulse" /> : <div className="text-blue-400 font-bold italic text-sm">第 {level} 關</div>}</div>
          <div className="text-right"><div className="text-gray-400 text-[10px] uppercase">分數</div><div className={`text-lg ${Date.now() < doubleScoreEndRef.current && Math.floor(Date.now() / 300) % 2 === 0 ? 'text-yellow-400' : 'text-white'}`}>{score.toLocaleString()}</div></div>
        </div>
        <div className="absolute bottom-4 left-4 flex gap-2">
          {[...Array(lives)].map((_, i) => (
            <div key={i} className="w-5 h-5 flex items-center justify-center opacity-80 animate-pulse">
              <svg viewBox="0 0 8 8" className="w-full h-full fill-blue-400">
                {PIXEL_DATA.PLAYER.map((row, r) => row.map((p, c) => p ? <rect key={`${r}-${c}`} x={c} y={r} width="1.1" height="1.1" /> : null))}
              </svg>
            </div>
          ))}
        </div>
        <div className="absolute bottom-4 right-4 flex gap-2 items-center">
          {weaponLevel > 1 && <div className="flex items-center gap-1 bg-yellow-400/20 px-2 py-0.5 rounded border border-yellow-400/50"><Zap size={14} className="text-yellow-400" /><span className="text-yellow-400 font-bold text-[10px]">LV.{weaponLevel}</span></div>}
          {thunderLevel > 0 && <div className="flex items-center gap-1 bg-purple-400/20 px-2 py-0.5 rounded border border-purple-400/50"><Zap size={14} className="text-purple-400" /><span className="text-purple-400 font-bold text-[10px]">T.{thunderLevel}</span></div>}
          {allyLevel > 0 && <div className="flex items-center gap-1 bg-orange-400/20 px-2 py-0.5 rounded border border-orange-400/50"><Zap size={14} className="text-orange-400" /><span className="text-orange-400 font-bold text-[10px]">A.{allyLevel}</span></div>}
          {orbitalLevel > 0 && <div className="flex items-center gap-1 bg-green-400/20 px-2 py-0.5 rounded border border-green-400/50"><Shield size={14} className="text-green-400" /><span className="text-green-400 font-bold text-[10px]">O.{orbitalLevel}</span></div>}
          {shieldCount > 0 && <div className="flex items-center gap-1 bg-blue-400/20 px-2 py-0.5 rounded border border-blue-400/50"><Shield size={14} className="text-blue-400" /><span className="text-blue-400 font-bold text-[10px]">x{shieldCount}</span></div>}
        </div>

        {/* Pause overlay */}
        {paused && gameState === 'PLAYING' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 z-30">
            <h2 className="text-5xl font-black text-white mb-4">暫停</h2>
            <p className="text-gray-400 text-sm">按空白鍵或點擊上方繼續</p>
          </div>
        )}

        {/* Fragment pickup message */}
        {fragmentMsg && (
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 bg-yellow-400/90 text-black font-black text-lg px-6 py-3 rounded-lg animate-bounce z-20">
            {fragmentMsg}
          </div>
        )}

        {/* Bonus stage overlays */}
        {bonusPhase === 'announce' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 z-20">
            <h2 className="text-5xl font-black text-yellow-400 animate-pulse mb-4">獎勵關卡!</h2>
            <p className="text-gray-300 text-sm">僅追加分數，不會損失生命</p>
          </div>
        )}
        {bonusPhase === 'countdown' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
            <div className="text-7xl font-black text-white animate-pulse">
              {Math.max(1, Math.ceil(5 - (Date.now() - bonusTimerRef.current) / 1000))}
            </div>
          </div>
        )}
        {bonusPhase === 'playing' && (
          <div className="absolute top-12 left-1/2 -translate-x-1/2 z-20">
            <div className="bg-yellow-400/20 border border-yellow-400/50 px-4 py-1 rounded text-yellow-400 font-bold text-sm">
              獎勵 {Math.max(0, Math.ceil(15 - (Date.now() - bonusTimerRef.current) / 1000))}秒 | +{bonusScoreRef.current.toLocaleString()}
            </div>
          </div>
        )}
        {bonusPhase === 'result' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 z-20">
            <h2 className="text-4xl font-black text-green-400 mb-4">獎勵完成!</h2>
            <p className="text-white text-2xl font-mono">+{bonusScoreRef.current.toLocaleString()} 分</p>
            {bonusKillCountRef.current >= bonusTotalRef.current && bonusTotalRef.current > 0 && (
              <p className="text-yellow-400 text-lg font-bold mt-2">完美! +5000 獎勵</p>
            )}
          </div>
        )}
        {bonusPhase === 'countdown_end' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
            <div className="text-center">
              <p className="text-gray-400 text-sm mb-2">下一關開始</p>
              <div className="text-5xl font-black text-white animate-pulse">
                {Math.max(1, Math.ceil(5 - (Date.now() - bonusTimerRef.current) / 1000))}
              </div>
            </div>
          </div>
        )}
        {bonusPhase === 'boss_clear' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
            <div className="text-center">
              <h2 className="text-4xl font-black text-yellow-400 mb-4">BOSS 擊破!</h2>
              <p className="text-gray-400 text-sm mb-2">下一關開始</p>
              <div className="text-5xl font-black text-white animate-pulse">
                {Math.max(1, Math.ceil(5 - (Date.now() - bonusTimerRef.current) / 1000))}
              </div>
            </div>
          </div>
        )}

        {gameState === 'START' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/95 px-8">
            <h1 className="text-7xl font-black text-white italic tracking-tighter mb-4">BEES</h1>
            <div className="w-full max-w-xs bg-gray-900/50 p-4 rounded-xl border border-gray-800 mb-8">
              <div className="flex items-center gap-2 mb-3 text-blue-400 text-sm font-bold"><Info size={16}/> 戰鬥手冊</div>
              <div className="space-y-3">
                <div className="flex items-center gap-3"><div className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-yellow-600 font-bold text-xs">W</div><div className="text-gray-300 text-[11px] leading-tight"><span className="text-yellow-400 font-bold">武力升級</span>：最高 Lv5，受傷重置</div></div>
                <div className="flex items-center gap-3"><div className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-purple-600 font-bold text-xs">T</div><div className="text-gray-300 text-[11px] leading-tight"><span className="text-purple-400 font-bold">雷電武器</span>：自動追蹤雷球，最高 Lv5，受傷重置</div></div>
                <div className="flex items-center gap-3"><div className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-orange-600 font-bold text-xs">A</div><div className="text-gray-300 text-[11px] leading-tight"><span className="text-orange-400 font-bold">僚機</span>：小型戰機跟隨射擊，最高 Lv5，受傷重置</div></div>
                <div className="flex items-center gap-3"><div className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-blue-600 font-bold text-xs">S</div><div className="text-gray-300 text-[11px] leading-tight"><span className="text-blue-400 font-bold">電漿護盾</span>：最高保存 3 層，受傷重置</div></div>
                <div className="flex items-center gap-3"><div className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-red-600 font-bold text-xs">H</div><div className="text-gray-300 text-[11px] leading-tight"><span className="text-red-400 font-bold">戰機修復</span>：增加一架戰機 (上限 3)</div></div>
                <div className="flex items-center gap-3"><div className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-indigo-600 font-bold text-xs">X</div><div className="text-gray-300 text-[11px] leading-tight"><span className="text-indigo-400 font-bold">時間減速</span>：敵人速度減半 8 秒（稀有）</div></div>
                <div className="flex items-center gap-3"><div className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-amber-600 font-bold text-xs">$</div><div className="text-gray-300 text-[11px] leading-tight"><span className="text-amber-400 font-bold">分數加倍</span>：所有擊殺分數 x2，持續 15 秒</div></div>
                <div className="flex items-center gap-3"><div className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-green-600 font-bold text-xs">O</div><div className="text-gray-300 text-[11px] leading-tight"><span className="text-green-400 font-bold">護衛球</span>：環繞戰機的護衛球，最高 Lv3，受傷重置</div></div>
                <div className="flex items-center gap-3"><div className="w-6 h-6 rounded-full bg-yellow-400 flex items-center justify-center text-white font-bold text-xs">F</div><div className="text-gray-300 text-[11px] leading-tight"><span className="text-yellow-400 font-bold">永久碎片</span>：Boss 掉落，永久提升初始能力</div></div>
                <div className="mt-2 pt-2 border-t border-gray-700 text-gray-400 text-[10px]">暫停：桌面按空白鍵 / 手機點擊畫面上方 1/3</div>
              </div>
            </div>
            <div className="flex gap-3 items-center">
              <button onClick={initGame} className="px-12 py-4 bg-white text-black font-black text-xl hover:bg-blue-500 hover:text-white transition-all transform hover:scale-110">開始任務</button>
              <button
                onClick={async () => {
                  setShowStartLeaderboard(true);
                  setStartLeaderboardLoading(true);
                  const board = await getLeaderboard();
                  setStartLeaderboardData(board);
                  setStartLeaderboardLoading(false);
                }}
                className="px-4 py-4 bg-yellow-400/20 text-yellow-400 font-bold text-sm border border-yellow-400/50 rounded hover:bg-yellow-400/30 transition-all"
              >
                <Trophy size={20} />
              </button>
            </div>

            {showStartLeaderboard && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setShowStartLeaderboard(false)}>
                <div className="bg-gray-950 border border-gray-700 rounded-xl p-4 w-80 max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-yellow-400 font-black text-lg flex items-center gap-2"><Trophy size={18} /> 排行榜</h3>
                    <button onClick={() => setShowStartLeaderboard(false)} className="text-gray-500 hover:text-white text-xl leading-none">&times;</button>
                  </div>
                  {startLeaderboardLoading ? (
                    <div className="text-white text-center py-8 animate-pulse">載入中...</div>
                  ) : (
                    <div className="overflow-y-auto flex-1">
                      <table className="w-full text-xs font-mono">
                        <thead>
                          <tr className="text-gray-500 border-b border-gray-800 sticky top-0 bg-gray-950">
                            <th className="py-2 px-2 text-left w-8">#</th>
                            <th className="py-2 px-2 text-left">暱稱</th>
                            <th className="py-2 px-2 text-right">分數</th>
                            <th className="py-2 px-2 text-right">關卡</th>
                          </tr>
                        </thead>
                        <tbody>
                          {startLeaderboardData.map((entry, i) => (
                            <tr key={entry.id} className={i < 3 ? 'text-yellow-300' : 'text-gray-300'}>
                              <td className="py-1.5 px-2">{i + 1}</td>
                              <td className="py-1.5 px-2 truncate max-w-[120px]">{entry.nickname}</td>
                              <td className="py-1.5 px-2 text-right">{entry.score.toLocaleString()}</td>
                              <td className="py-1.5 px-2 text-right">{entry.level}</td>
                            </tr>
                          ))}
                          {startLeaderboardData.length === 0 && (
                            <tr><td colSpan={4} className="py-4 text-center text-gray-500">暫無資料</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {gameState === 'GAMEOVER' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-950/95 backdrop-blur-md overflow-y-auto py-6">
            <h2 className="text-5xl font-black text-white mb-2">墜毀</h2>

            {leaderboardPhase === 'input' && (
              <>
                <div className="bg-black/50 p-5 rounded-lg border border-red-500/30 mb-6 text-center w-64">
                  <p className="text-gray-400 text-xs uppercase tracking-widest">最終分數</p>
                  <p className="text-4xl text-white font-mono">{score.toLocaleString()}</p>
                  <p className="text-gray-500 text-xs mt-1">第 {level} 關</p>
                </div>
                <div className="w-64 mb-4">
                  <input
                    type="text"
                    maxLength={16}
                    placeholder="輸入暱稱..."
                    value={nickname}
                    onChange={e => setNickname(e.target.value)}
                    className="w-full px-4 py-3 bg-black/60 border border-gray-600 rounded-lg text-white text-center text-lg font-mono focus:outline-none focus:border-yellow-400 placeholder-gray-600"
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={async () => {
                      if (!nickname.trim()) return;
                      setLeaderboardPhase('loading');
                      await submitScore(nickname.trim(), score, level);
                      const [board, rank] = await Promise.all([
                        getLeaderboard(),
                        getPlayerRank(score),
                      ]);
                      setLeaderboardData(board);
                      setPlayerRank(rank);
                      setLeaderboardPhase('board');
                    }}
                    disabled={!nickname.trim()}
                    className="px-6 py-3 bg-yellow-400 text-black font-bold rounded-lg hover:bg-yellow-300 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Trophy size={16} className="inline mr-1 -mt-0.5" />
                    提交排行榜
                  </button>
                  <button
                    onClick={initGame}
                    className="px-6 py-3 bg-white/10 text-white font-bold rounded-lg hover:bg-white/20 transition-all border border-white/20"
                  >
                    跳過
                  </button>
                </div>
              </>
            )}

            {leaderboardPhase === 'loading' && (
              <div className="text-white text-lg animate-pulse mt-8">提交中...</div>
            )}

            {leaderboardPhase === 'board' && (
              <>
                {playerRank > 0 && (
                  <div className="bg-yellow-400/20 border border-yellow-400/50 rounded-lg px-4 py-2 mb-3 text-yellow-300 font-bold text-sm">
                    你的排名：第 {playerRank} 名
                  </div>
                )}
                <div className="w-72 max-h-[50vh] overflow-y-auto bg-black/60 rounded-lg border border-gray-700 mb-4">
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="text-gray-500 border-b border-gray-800 sticky top-0 bg-black/90">
                        <th className="py-2 px-2 text-left w-8">#</th>
                        <th className="py-2 px-2 text-left">暱稱</th>
                        <th className="py-2 px-2 text-right">分數</th>
                        <th className="py-2 px-2 text-right">關卡</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboardData.map((entry, i) => {
                        const isMe = entry.nickname === nickname.trim() && entry.score === score;
                        return (
                          <tr
                            key={entry.id}
                            className={isMe ? 'bg-yellow-400/20 text-yellow-300' : 'text-gray-300'}
                          >
                            <td className="py-1.5 px-2">{i + 1}</td>
                            <td className="py-1.5 px-2 truncate max-w-[100px]">{entry.nickname}</td>
                            <td className="py-1.5 px-2 text-right">{entry.score.toLocaleString()}</td>
                            <td className="py-1.5 px-2 text-right">{entry.level}</td>
                          </tr>
                        );
                      })}
                      {leaderboardData.length === 0 && (
                        <tr><td colSpan={4} className="py-4 text-center text-gray-500">暫無資料</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <button
                  onClick={initGame}
                  className="px-10 py-3 bg-white text-red-600 rounded-full font-black hover:bg-red-500 hover:text-white transition-all"
                >
                  重新出擊
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default GalagaGame;
