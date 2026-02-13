import React, { useEffect, useRef, useState } from 'react';
import { Trophy, Play, RotateCcw, Zap, Shield, Skull, Info } from 'lucide-react';
import { audio } from '../utils/audio';

// --- 常數與類型定義 ---
const CANVAS_WIDTH = 480;
const CANVAS_HEIGHT = 640;
const PLAYER_SIZE = 40;
const ENEMY_SIZE = 30;
const BOSS_SIZE = 120;
const BULLET_SIZE = 4;

type PowerUpType = 'DOUBLE_SHOT' | 'SHIELD' | 'LIFE' | 'THUNDER';

const PIXEL_DATA = {
  PLAYER: [[0,0,0,1,1,0,0,0],[0,0,1,1,1,1,0,0],[0,0,1,1,1,1,0,0],[0,1,1,1,1,1,1,0],[1,1,1,1,1,1,1,1],[1,1,0,1,1,0,1,1],[1,0,0,1,1,0,0,1],[1,0,0,1,1,0,0,1]],
  ENEMY_RED: [[0,0,1,0,0,1,0,0],[0,1,1,1,1,1,1,0],[1,1,1,1,1,1,1,1],[1,0,1,1,1,1,0,1],[1,1,1,1,1,1,1,1],[0,0,1,0,0,1,0,0],[0,1,0,1,1,0,1,0],[1,0,1,0,0,1,0,1]],
  ENEMY_PURPLE: [[0,1,1,0,0,1,1,0],[1,1,1,1,1,1,1,1],[1,0,1,1,1,1,0,1],[1,1,1,1,1,1,1,1],[0,1,1,1,1,1,1,0],[0,0,1,0,0,1,0,0],[0,1,1,0,0,1,1,0],[1,1,0,0,0,0,1,1]],
  BOSS: [[0,0,0,1,1,1,1,0,0,0],[0,0,1,1,1,1,1,1,0,0],[0,1,1,0,1,1,0,1,1,0],[1,1,1,1,1,1,1,1,1,1],[1,0,1,1,1,1,1,1,0,1],[1,1,1,0,0,0,0,1,1,1],[0,1,1,1,1,1,1,1,1,0],[0,0,1,0,1,1,0,1,0,0]]
};

interface Entity { x: number; y: number; width: number; height: number; }
interface Bullet extends Entity { active: boolean; fromPlayer: boolean; color: string; vx: number; vy: number; isRicochet?: boolean; piercing?: boolean; isThunder?: boolean; thunderDamage?: number; thunderRadius?: number; hitEnemies?: Set<number>; }
interface Enemy extends Entity { alive: boolean; type: 'RED' | 'PURPLE' | 'YELLOW' | 'BOSS'; hp: number; maxHp: number; originX: number; originY: number; isDiving: boolean; diveAngle: number; scoreValue: number; }
interface PowerUp extends Entity { type: PowerUpType; active: boolean; }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; color: string; }

const GalagaGame: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<'START' | 'PLAYING' | 'GAMEOVER'>('START');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(Number(localStorage.getItem('galaga-highscore')) || 0);
  const [lives, setLives] = useState(3);
  const [level, setLevel] = useState(1);

  const weaponLevelRef = useRef(1);
  const shieldCountRef = useRef(0);
  const invulnerableRef = useRef(0);
  const thunderLevelRef = useRef(0);
  const lastThunderShotRef = useRef(0);

  const [weaponLevel, setWeaponLevel] = useState(1);
  const [shieldCount, setShieldCount] = useState(0);
  const [thunderLevel, setThunderLevel] = useState(0);

  const playerRef = useRef({ x: CANVAS_WIDTH / 2 - PLAYER_SIZE / 2, y: CANVAS_HEIGHT - 60 });
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
  const requestRef = useRef<number>();

  useEffect(() => {
    starsRef.current = Array.from({ length: 80 }, () => ({ x: Math.random() * CANVAS_WIDTH, y: Math.random() * CANVAS_HEIGHT, size: Math.random() * 2, speed: Math.random() * 3 + 1 }));
    const handleKeyDown = (e: KeyboardEvent) => keysRef.current.add(e.code);
    const handleKeyUp = (e: KeyboardEvent) => keysRef.current.delete(e.code);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', handleKeyUp); if (requestRef.current) cancelAnimationFrame(requestRef.current); };
  }, []);

  const initGame = () => {
    playerRef.current = { x: CANVAS_WIDTH / 2 - PLAYER_SIZE / 2, y: CANVAS_HEIGHT - 60 };
    bulletsRef.current = [];
    enemiesRef.current = [];
    powerUpsRef.current = [];
    particlesRef.current = [];
    setScore(0);
    setLives(3);
    setLevel(1);
    weaponLevelRef.current = 1; setWeaponLevel(1);
    shieldCountRef.current = 0; setShieldCount(0);
    thunderLevelRef.current = 0; setThunderLevel(0);
    invulnerableRef.current = 0;
    bossActive.current = false;
    formationOffset.current = 0;
    spawnEnemies(1);
    setGameState('PLAYING');
    audio.playBGM();
  };

  const spawnEnemies = (lvl: number) => {
    if (lvl % 5 === 0) { spawnBoss(); return; }
    bossActive.current = false;
    // Every 5 levels: +10% enemies (scale = rows*cols grow), enemy size shrinks to fit
    const tier = Math.floor(lvl / 5); // 0 for lvl 1-4, 1 for 6-9, 2 for 11-14...
    const scale = Math.pow(1.1, tier); // 1.0, 1.1, 1.21, ...
    const baseRows = 5, baseCols = 9;
    const rows = Math.round(baseRows * Math.sqrt(scale));
    const cols = Math.round(baseCols * Math.sqrt(scale));
    const totalGridW = 410, totalGridH = 200; // fixed area
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
        enemies.push({ x: ex, y: ey, originX: ex, originY: ey, width: eSize, height: eSize, alive: true, type, hp: r === 0 ? 2 : 1, maxHp: r === 0 ? 2 : 1, isDiving: false, diveAngle: 0, scoreValue: (rows - 1 - r) * 100 });
      }
    }
    enemiesRef.current = enemies;
  };

  const spawnBoss = () => {
    bossActive.current = true;
    audio.playBossSpawn();
    const bossHp = (80 + level * 20) * 2;
    enemiesRef.current = [{ x: CANVAS_WIDTH / 2 - BOSS_SIZE / 2, y: -150, originX: CANVAS_WIDTH / 2 - BOSS_SIZE / 2, originY: 100, width: BOSS_SIZE, height: BOSS_SIZE, alive: true, type: 'BOSS', hp: bossHp, maxHp: bossHp, isDiving: false, diveAngle: 0, scoreValue: 5000 + (level * 1000) }];
  };

  const update = () => {
    if (gameState !== 'PLAYING') return;
    if (invulnerableRef.current > 0) invulnerableRef.current -= 0.016;
    updatePlayer(); updateEnemies(); updateBullets(); updatePowerUps(); updateParticles(); checkCollisions();
    if (enemiesRef.current.length > 0 && enemiesRef.current.every(e => !e.alive)) { setLevel(prev => { const nextLvl = prev + 1; spawnEnemies(nextLvl); return nextLvl; }); audio.playPowerUp(); }
  };

  const draw = (ctx: CanvasRenderingContext2D) => {
    ctx.save();
    if (screenShake.current > 0) { ctx.translate((Math.random()-0.5)*screenShake.current, (Math.random()-0.5)*screenShake.current); screenShake.current *= 0.9; }
    updateBackground(ctx); drawPlayer(ctx); drawEnemies(ctx); drawBullets(ctx); drawPowerUps(ctx); drawParticles(ctx);
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

  const updateBackground = (ctx: CanvasRenderingContext2D) => { ctx.fillStyle = '#000814'; ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT); ctx.fillStyle = '#ffffff'; starsRef.current.forEach(star => { star.y += star.speed; if (star.y > CANVAS_HEIGHT) star.y = 0; ctx.fillRect(star.x, star.y, star.size, star.size); }); };

  const updatePlayer = () => {
    const speed = 6;
    if (keysRef.current.has('ArrowLeft') && playerRef.current.x > 0) playerRef.current.x -= speed;
    if (keysRef.current.has('ArrowRight') && playerRef.current.x < CANVAS_WIDTH - PLAYER_SIZE) playerRef.current.x += speed;
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
            // Find nearest enemy (with slight offset per ball for spread)
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
            // Add slight spread for multiple balls
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
  };

  const updateEnemies = () => {
    formationOffset.current += 0.05 * formationDir.current; if (Math.abs(formationOffset.current) > 30) formationDir.current *= -1;
    const difficultyFactor = 1 + (level * 0.01);
    enemiesRef.current.forEach(e => {
      if (!e.alive) return;
      if (e.type === 'BOSS') {
        if (e.y < e.originY) e.y += 2; e.x = e.originX + Math.sin(Date.now()/1000) * 100;
        const bossShootChance = (0.05 + (level * 0.005)) * 1.3;
        if (Math.random() < bossShootChance) { const angle = (Math.random() * Math.PI) / 1.5 + Math.PI / 6; bulletsRef.current.push({ x: e.x + e.width/2, y: e.y + e.height - 20, width: 6, height: 6, active: true, fromPlayer: false, color: '#FF00FF', vx: Math.cos(angle) * (5 * difficultyFactor), vy: Math.sin(angle) * (5 * difficultyFactor) }); }
      } else if (e.isDiving) {
        // Dive toward player with slight sine wobble
        const targetX = playerRef.current.x + PLAYER_SIZE / 2 - e.width / 2;
        const dxToPlayer = targetX - e.x;
        e.x += Math.sign(dxToPlayer) * Math.min(Math.abs(dxToPlayer), 3) * difficultyFactor + Math.sin(e.diveAngle) * 2;
        e.y += 5 * difficultyFactor;
        e.diveAngle += 0.1;
        if (e.y > CANVAS_HEIGHT) { e.y = -50; e.isDiving = false; }
      }
      else {
        e.x = e.originX + Math.sin(formationOffset.current) * 20;
        // All enemy types can dive; RED has lower chance, PURPLE higher
        const diveChance = e.type === 'PURPLE' ? 0.002 : e.type === 'RED' ? 0.001 : 0.0005;
        if (Math.random() < diveChance * difficultyFactor) {
          e.isDiving = true; e.diveAngle = 0;
          // Aim toward player's current X position
          const dx = (playerRef.current.x + PLAYER_SIZE / 2) - (e.x + e.width / 2);
          e.diveAngle = Math.atan2(1, dx / 100);
        }
      }
      const shootChance = (0.002 + (level * 0.0005)) * difficultyFactor;
      if (Math.random() < shootChance && e.type !== 'BOSS') { bulletsRef.current.push({ x: e.x + e.width/2, y: e.y + e.height, width: 4, height: 8, active: true, fromPlayer: false, color: '#FF0000', vx: 0, vy: 5 * difficultyFactor }); }
    });
  };

  const updateBullets = () => {
    bulletsRef.current.forEach(b => {
      if (b.isThunder) {
        // Thunder tracking: steer towards nearest alive enemy
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
          // Smooth steering
          b.vx += (targetVx - b.vx) * 0.08;
          b.vy += (targetVy - b.vy) * 0.08;
          // Normalize to maintain speed
          const newSpeed = Math.sqrt(b.vx * b.vx + b.vy * b.vy) || 1;
          b.vx = (b.vx / newSpeed) * currentSpeed;
          b.vy = (b.vy / newSpeed) * currentSpeed;
        }
      }
      b.x += b.vx; b.y += b.vy;
    });
    bulletsRef.current = bulletsRef.current.filter(b => b.y > -50 && b.y < CANVAS_HEIGHT + 50 && b.x > -50 && b.x < CANVAS_WIDTH + 50 && b.active);
  };

  const updatePowerUps = () => { powerUpsRef.current.forEach(p => p.y += 3); powerUpsRef.current = powerUpsRef.current.filter(p => p.y < CANVAS_HEIGHT && p.active); };
  const updateParticles = () => { particlesRef.current.forEach(p => { p.x += p.vx; p.y += p.vy; p.life -= 0.02; }); particlesRef.current = particlesRef.current.filter(p => p.life > 0); };

  const checkCollisions = () => {
    const ricochetBullets: Bullet[] = [];
    bulletsRef.current.filter(b => b.fromPlayer).forEach(bullet => {
      enemiesRef.current.filter(e => e.alive).forEach((enemy, idx) => {
        if (bullet.active && rectIntersect(bullet, enemy)) {
          // Piercing: skip if already hit this enemy
          if (bullet.piercing && bullet.hitEnemies) {
            if (bullet.hitEnemies.has(idx)) return;
            bullet.hitEnemies.add(idx);
          }

          if (bullet.isThunder) {
            // Thunder bullet hit
            bullet.active = false;
            const dmg = bullet.thunderDamage || 1;
            enemy.hp -= dmg;
            screenShake.current = enemy.type === 'BOSS' ? 2 : 5;
            // AOE explosion for Lv4+
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
                    setScore(s => { const ns = s + e.scoreValue; if (ns > highScore) { setHighScore(ns); localStorage.setItem('galaga-highscore', ns.toString()); } return ns; });
                  }
                }
              });
              // Electric arc particles
              for (let i = 0; i < 12; i++) {
                particlesRef.current.push({ x: cx, y: cy, vx: (Math.random() - 0.5) * 16, vy: (Math.random() - 0.5) * 16, life: 0.8, color: Math.random() > 0.5 ? '#EECCFF' : '#FFFFFF' });
              }
            }
          } else {
            // Normal bullet hit
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
            setScore(s => { const ns = s + enemy.scoreValue; if (ns > highScore) { setHighScore(ns); localStorage.setItem('galaga-highscore', ns.toString()); } return ns; });
            if (Math.random() < 0.05 || enemy.type === 'BOSS') spawnPowerUp(enemy.x + enemy.width / 2, enemy.y);
          }
        }
      });
    });
    if (ricochetBullets.length > 0) bulletsRef.current.push(...ricochetBullets);
    const playerBox = { x: playerRef.current.x + 5, y: playerRef.current.y + 5, width: PLAYER_SIZE - 10, height: PLAYER_SIZE - 10 };
    bulletsRef.current.filter(b => !b.fromPlayer).forEach(b => { if (rectIntersect(b, playerBox)) { b.active = false; handlePlayerHit(); } });
    enemiesRef.current.filter(e => e.alive).forEach(e => { if (rectIntersect(e, playerBox)) { if (e.type !== 'BOSS') e.alive = false; handlePlayerHit(); } });
    powerUpsRef.current.filter(p => p.active).forEach(p => { if (rectIntersect(p, playerBox)) { p.active = false; applyPowerUp(p.type); } });
  };

  const rectIntersect = (a: any, b: any) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

  const handlePlayerHit = () => {
    if (invulnerableRef.current > 0) return;
    if (shieldCountRef.current > 0) { shieldCountRef.current -= 1; setShieldCount(shieldCountRef.current); audio.playPowerUp(); screenShake.current = 10; invulnerableRef.current = 1.0; return; }

    // 被擊中：Buff 全部重置
    weaponLevelRef.current = 1; setWeaponLevel(1);
    shieldCountRef.current = 0; setShieldCount(0);
    thunderLevelRef.current = 0; setThunderLevel(0);

    screenShake.current = 25; invulnerableRef.current = 1.5;
    setLives(l => { if (l <= 1) { setGameState('GAMEOVER'); audio.playGameOver(); audio.stopBGM(); return 0; } audio.playExplosion(); return l - 1; });
  };

  const createExplosion = (x: number, y: number, count: number) => { for (let i = 0; i < count; i++) { particlesRef.current.push({ x, y, vx: (Math.random()-0.5)*12, vy: (Math.random()-0.5)*12, life: 1, color: `hsl(${Math.random()*60 + 10}, 100%, 50%)` }); } };
  const spawnPowerUp = (x: number, y: number) => { const types: PowerUpType[] = ['DOUBLE_SHOT', 'SHIELD', 'LIFE', 'THUNDER']; const type = types[Math.floor(Math.random()*types.length)]; powerUpsRef.current.push({ x, y, width: 20, height: 20, type, active: true }); };

  const applyPowerUp = (type: PowerUpType) => {
    audio.playPowerUp();
    if (type === 'LIFE') setLives(l => Math.min(l + 1, 3));
    else if (type === 'SHIELD') { shieldCountRef.current = Math.min(shieldCountRef.current + 1, 2); setShieldCount(shieldCountRef.current); }
    else if (type === 'THUNDER') { if (thunderLevelRef.current < 5) { thunderLevelRef.current += 1; setThunderLevel(thunderLevelRef.current); } }
    else { if (weaponLevelRef.current < 5) { weaponLevelRef.current += 1; setWeaponLevel(weaponLevelRef.current); } }
  };

  const drawPixelArt = (ctx: CanvasRenderingContext2D, data: number[][], x: number, y: number, size: number, color: string) => { const pSize = size / data[0].length; ctx.fillStyle = color; data.forEach((row, i) => { row.forEach((pixel, j) => { if (pixel) ctx.fillRect(x + j * pSize, y + i * pSize, pSize + 0.5, pSize + 0.5); }); }); };

  const drawPlayer = (ctx: CanvasRenderingContext2D) => {
    const { x, y } = playerRef.current;
    if (invulnerableRef.current > 0 && Math.floor(Date.now() / 100) % 2 === 0) ctx.globalAlpha = 0.3;
    drawPixelArt(ctx, PIXEL_DATA.PLAYER, x, y, PLAYER_SIZE, '#00D4FF');
    if (shieldCountRef.current >= 1) { const pulse = Math.sin(Date.now() / 100) * 0.2 + 0.8; ctx.strokeStyle = `rgba(0, 255, 255, ${pulse})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x + PLAYER_SIZE/2, y + PLAYER_SIZE/2, PLAYER_SIZE * 0.85, 0, Math.PI * 2); ctx.stroke(); }
    if (shieldCountRef.current >= 2) { const pulse = Math.cos(Date.now() / 150) * 0.2 + 0.7; ctx.strokeStyle = `rgba(255, 255, 0, ${pulse})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x + PLAYER_SIZE/2, y + PLAYER_SIZE/2, PLAYER_SIZE * 1.05, 0, Math.PI * 2); ctx.stroke(); }
    ctx.globalAlpha = 1.0;
  };

  const drawEnemies = (ctx: CanvasRenderingContext2D) => { enemiesRef.current.forEach(e => { if (!e.alive) return; let color = '#FF5252'; let data = PIXEL_DATA.ENEMY_RED; if (e.type === 'PURPLE') { color = '#E040FB'; data = PIXEL_DATA.ENEMY_PURPLE; } if (e.type === 'YELLOW') color = '#FFEB3B'; if (e.type === 'BOSS') { color = '#FF0055'; data = PIXEL_DATA.BOSS; } drawPixelArt(ctx, data, e.x, e.y, e.width, color); if (e.type === 'BOSS') { ctx.fillStyle = '#333'; ctx.fillRect(e.x, e.y - 20, e.width, 10); ctx.fillStyle = '#FF0055'; ctx.fillRect(e.x, e.y - 20, e.width * (e.hp/e.maxHp), 10); } }); };

  const drawBullets = (ctx: CanvasRenderingContext2D) => {
    bulletsRef.current.forEach(b => {
      if (b.isThunder) {
        // Draw thunder ball as circle with purple glow
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
      ctx.fillStyle = '#FFF';
      ctx.beginPath();
      ctx.arc(p.x + 10, p.y + 10, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.type === 'LIFE' ? '#F00' : p.type === 'SHIELD' ? '#00F' : p.type === 'THUNDER' ? '#8B00FF' : '#FF0';
      ctx.font = 'bold 12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(p.type === 'LIFE' ? 'H' : p.type === 'SHIELD' ? 'S' : p.type === 'THUNDER' ? 'T' : 'W', p.x + 10, p.y + 14);
    });
  };

  const drawParticles = (ctx: CanvasRenderingContext2D) => { particlesRef.current.forEach(p => { ctx.globalAlpha = p.life; ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 3, 3); }); ctx.globalAlpha = 1.0; };

  return (
    <div className="flex flex-col items-center select-none scale-90 sm:scale-100">
      <div className="w-[480px] flex justify-between items-end mb-2 text-white font-mono px-2">
        <div><div className="text-gray-400 text-[10px] uppercase">High Score</div><div className="text-xl text-yellow-400">{highScore.toLocaleString()}</div></div>
        <div className="text-center">{bossActive.current ? <Skull className="text-red-500 animate-pulse" /> : <div className="text-blue-400 font-bold italic">LVL {level}</div>}</div>
        <div className="text-right"><div className="text-gray-400 text-[10px] uppercase">Score</div><div className="text-xl text-white">{score.toLocaleString()}</div></div>
      </div>

      <div className="relative rounded-lg overflow-hidden shadow-[0_0_50px_rgba(0,100,255,0.3)] border-4 border-gray-900 bg-black">
        <canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} />
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
          {shieldCount > 0 && <div className="flex items-center gap-1 bg-blue-400/20 px-2 py-0.5 rounded border border-blue-400/50"><Shield size={14} className="text-blue-400" /><span className="text-blue-400 font-bold text-[10px]">x{shieldCount}</span></div>}
        </div>

        {gameState === 'START' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/95 px-8">
            <h1 className="text-7xl font-black text-white italic tracking-tighter mb-4">BEES</h1>
            <div className="w-full max-w-xs bg-gray-900/50 p-4 rounded-xl border border-gray-800 mb-8">
              <div className="flex items-center gap-2 mb-3 text-blue-400 text-sm font-bold"><Info size={16}/> 戰鬥手冊</div>
              <div className="space-y-3">
                <div className="flex items-center gap-3"><div className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-yellow-600 font-bold text-xs">W</div><div className="text-gray-300 text-[11px] leading-tight"><span className="text-yellow-400 font-bold">武力升級</span>：最高 Lv5，受傷重置</div></div>
                <div className="flex items-center gap-3"><div className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-purple-600 font-bold text-xs">T</div><div className="text-gray-300 text-[11px] leading-tight"><span className="text-purple-400 font-bold">雷電武器</span>：自動追蹤雷球，最高 Lv5，受傷重置</div></div>
                <div className="flex items-center gap-3"><div className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-blue-600 font-bold text-xs">S</div><div className="text-gray-300 text-[11px] leading-tight"><span className="text-blue-400 font-bold">電漿護盾</span>：最高保存 2 層，受傷重置</div></div>
                <div className="flex items-center gap-3"><div className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-red-600 font-bold text-xs">H</div><div className="text-gray-300 text-[11px] leading-tight"><span className="text-red-400 font-bold">戰機修復</span>：增加一架戰機 (上限 3)</div></div>
              </div>
            </div>
            <button onClick={initGame} className="px-12 py-4 bg-white text-black font-black text-xl hover:bg-blue-500 hover:text-white transition-all transform hover:scale-110">START MISSION</button>
          </div>
        )}

        {gameState === 'GAMEOVER' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-950/95 backdrop-blur-md">
            <h2 className="text-6xl font-black text-white mb-2">CRASHED</h2>
            <div className="bg-black/50 p-6 rounded-lg border border-red-500/30 mb-12 text-center w-64">
              <p className="text-gray-400 text-xs uppercase tracking-widest">FINAL SCORE</p>
              <p className="text-4xl text-white font-mono">{score.toLocaleString()}</p>
            </div>
            <button onClick={initGame} className="px-10 py-4 bg-white text-red-600 rounded-full font-black hover:bg-red-500 hover:text-white transition-all">REDEPLOY</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default GalagaGame;
