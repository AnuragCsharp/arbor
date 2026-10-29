/**
 * G9 — headless, deterministic simulation of the Arena game engine.
 *
 * Proves the rules the player actually experiences, with no renderer/DOM:
 *   • enemies spawn, walk to the nearest tree, and chop it;
 *   • a tree falls after exactly its species' hit points (pine 3, oak 5);
 *   • felling fires treeDown + onTreesRemaining; the last tree ends the game;
 *   • a crosshair ray kills the enemy it points at, awards points, booms;
 *   • a ray pointing away misses and changes nothing.
 *
 * Runs on a plain THREE.Scene with a seeded RNG so the outcome is repeatable.
 * Prints GAME_OK on success; throws (non-zero exit) on any failed assertion.
 */
import * as THREE from 'three';
import { ArenaGame, TREE_HP, type GameSfx } from '../src/game.ts';

/* ---- tiny harness ---- */
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

/** deterministic LCG so spawns/strikes are repeatable across runs */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

interface Counts {
  chop: number;
  explosion: number;
  treeDown: number;
  gameOver: number;
}
function makeSfx(c: Counts): GameSfx {
  return {
    chop: () => (c.chop += 1),
    explosion: () => (c.explosion += 1),
    treeDown: () => (c.treeDown += 1),
    gameOver: () => (c.gameOver += 1),
  };
}

function freshCounts(): Counts {
  return { chop: 0, explosion: 0, treeDown: 0, gameOver: 0 };
}

/* ---- Test 1 & 2: a tree falls after exactly maxHp chops (varied by species) ---- */
function fellTest(type: 'pine' | 'oak'): void {
  const scene = new THREE.Scene();
  const c = freshCounts();
  let remaining = -1;
  let total = -1;
  let overScore = -1;

  const game = new ArenaGame(
    scene,
    {
      onScore: () => {},
      onTreesRemaining: (r, t) => {
        remaining = r;
        total = t;
      },
      onWave: () => {},
      onGameOver: (s) => {
        overScore = s;
      },
      sfx: makeSfx(c),
    },
    // huge spawnInterval → the engine auto-spawns exactly ONE enemy (at the
    // 0.6s grace tick) and never a second, isolating a single chopper.
    { spawnInterval: 1e9, rng: seeded(type === 'pine' ? 7 : 99) }
  );

  game.registerTree(new THREE.Group(), type, new THREE.Vector3(0, 0, -3));
  assert(game.start(), `${type}: start() should succeed with a tree`);

  // step ~60s at 50ms; stop as soon as the tree is felled
  for (let i = 0; i < 1200 && c.treeDown === 0; i++) game.update(0.05);

  assert(c.treeDown === 1, `${type}: exactly one tree should fall (got ${c.treeDown})`);
  assert(c.chop === TREE_HP[type], `${type}: chops should equal maxHp ${TREE_HP[type]} (got ${c.chop})`);
  assert(remaining === 0 && total === 1, `${type}: onTreesRemaining should report 0/1 (got ${remaining}/${total})`);
  assert(game.isOver && !game.isPlaying, `${type}: game should be over after the last tree falls`);
  assert(c.gameOver === 1, `${type}: gameOver sfx should fire once`);
  assert(overScore === 0, `${type}: score should be 0 with no kills (got ${overScore})`);
}

/* ---- Test 3 & 4: crosshair ray kills the enemy it points at, misses otherwise ---- */
function shootTest(): void {
  const scene = new THREE.Scene();
  const c = freshCounts();
  let score = -1;

  const game = new ArenaGame(
    scene,
    {
      onScore: (s) => {
        score = s;
      },
      onTreesRemaining: () => {},
      onWave: () => {},
      onGameOver: () => {},
      sfx: makeSfx(c),
    },
    { spawnInterval: 1e9, rng: seeded(42) }
  );

  game.registerTree(new THREE.Group(), 'oak', new THREE.Vector3(0, 0, -8));
  assert(game.start(), 'shoot: start() should succeed');

  // let the single enemy appear
  for (let i = 0; i < 40 && game.enemyCount() === 0; i++) game.update(0.05);
  assert(game.enemyCount() === 1, `shoot: one enemy should be present (got ${game.enemyCount()})`);

  const e = game.debugEnemies()[0];
  const enemyPos = new THREE.Vector3(e.x, e.y, e.z);

  // a ray pointing AWAY from the enemy must miss
  const origin = new THREE.Vector3(0, 0.2, 0);
  const away = origin.clone().sub(enemyPos).normalize();
  assert(game.shootRay(origin, away) === null, 'shoot: ray facing away should miss');
  assert(c.explosion === 0 && game.enemyCount() === 1, 'shoot: a miss must not kill or boom');

  // a ray pointing AT the enemy must hit, score, and boom
  const toward = enemyPos.clone().sub(origin).normalize();
  const hit = game.shootRay(origin, toward);
  assert(hit !== null, 'shoot: ray at the enemy should hit');
  assert(game.enemyCount() === 0, 'shoot: the enemy should be gone after a hit');
  assert(c.explosion === 1, 'shoot: explosion sfx should fire once');
  assert(score === 10, `shoot: score should be pointsPerKill=10 (got ${score})`);
}

/* ---- Test 5: with real spawns, both trees eventually fall and the game ends ---- */
function gameOverTest(): void {
  const scene = new THREE.Scene();
  const c = freshCounts();
  let overScore = -1;

  const game = new ArenaGame(
    scene,
    {
      onScore: () => {},
      onTreesRemaining: () => {},
      onWave: () => {},
      onGameOver: (s) => {
        overScore = s;
      },
      sfx: makeSfx(c),
    },
    { rng: seeded(123) } // default spawn pacing — a real assault
  );

  game.registerTree(new THREE.Group(), 'pine', new THREE.Vector3(-2, 0, 0));
  game.registerTree(new THREE.Group(), 'oak', new THREE.Vector3(2, 0, 0));
  assert(game.start(), 'gameover: start() should succeed');
  assert(game.treeCount() === 2 && game.aliveTreeCount() === 2, 'gameover: two trees alive at start');

  // never shoot — let the creatures do their work; bounded to stay finite
  for (let i = 0; i < 6000 && !game.isOver; i++) game.update(0.05);

  assert(game.isOver, 'gameover: game should end once every tree is felled');
  assert(game.aliveTreeCount() === 0, 'gameover: no trees should remain alive');
  assert(c.gameOver === 1, `gameover: gameOver sfx should fire once (got ${c.gameOver})`);
  assert(c.treeDown === 2, `gameover: both trees should report a fall (got ${c.treeDown})`);
  assert(overScore === 0, `gameover: score should be 0 with no kills (got ${overScore})`);
}

fellTest('pine');
fellTest('oak');
shootTest();
gameOverTest();

console.log('GAME_OK');
