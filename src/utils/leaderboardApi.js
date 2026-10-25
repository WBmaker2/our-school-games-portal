// Our School Games Portal - Local Storage Leaderboard Service
// Zero-Backend / Serverless Architecture: 100% Client-Side LocalStorage Persistence
// Supports Offline Play, Safe Isolation, and Instant 0ms Sync

const STORAGE_PREFIX = 'school_leaderboard_';
const LEGACY_STORAGE_PREFIX = 'dochon_leaderboard_';

/**
 * Deduplicate leaderboard array by player name, keeping ONLY the single highest score for each unique name.
 */
export function deduplicateLeaderboard(list) {
  if (!Array.isArray(list)) return [];

  const map = new Map();

  list.forEach(item => {
    const rawName = String(item.name || '').trim();
    if (!rawName) return;

    const itemScore = Number(item.score) || 0;

    if (!map.has(rawName)) {
      map.set(rawName, { ...item, name: rawName, score: itemScore });
    } else {
      const existing = map.get(rawName);
      const existingScore = Number(existing.score) || 0;

      // Keep the entry with the higher score
      if (itemScore > existingScore) {
        map.set(rawName, { ...item, name: rawName, score: itemScore });
      } else if (itemScore === existingScore) {
        // If scores are equal, keep the entry with more recent date/timestamp
        const itemTime = item.timestamp || (item.date ? new Date(item.date).getTime() : 0);
        const existingTime = existing.timestamp || (existing.date ? new Date(existing.date).getTime() : 0);
        if (itemTime >= existingTime) {
          map.set(rawName, { ...item, name: rawName, score: itemScore });
        }
      }
    }
  });

  const result = Array.from(map.values());
  result.sort((a, b) => Number(b.score) - Number(a.score));
  return result;
}

/**
 * Get internal storage key for a game
 */
function getStorageKey(gameKey) {
  return `${STORAGE_PREFIX}${gameKey}`;
}

/**
 * Migrate legacy data if exists
 */
function getStoredList(gameKey) {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return [];
  const currentKey = getStorageKey(gameKey);
  const legacyKey = `${LEGACY_STORAGE_PREFIX}${gameKey}`;

  try {
    const stored = localStorage.getItem(currentKey);
    if (stored) {
      return deduplicateLeaderboard(JSON.parse(stored));
    }

    // Check legacy key
    const legacy = localStorage.getItem(legacyKey);
    if (legacy) {
      const parsed = deduplicateLeaderboard(JSON.parse(legacy));
      localStorage.setItem(currentKey, JSON.stringify(parsed));
      return parsed;
    }
  } catch (e) {
    console.warn('[Leaderboard] Error reading localStorage:', e);
  }

  return [];
}

/**
 * Save list to localStorage
 */
function saveStoredList(gameKey, list) {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  const currentKey = getStorageKey(gameKey);
  try {
    const deduplicated = deduplicateLeaderboard(list);
    localStorage.setItem(currentKey, JSON.stringify(deduplicated));
  } catch (e) {
    console.error('[Leaderboard] Error saving to localStorage:', e);
  }
}

/**
 * Sync / Initialize localStorage (Migration & Local integrity check)
 */
export async function syncLocalStorageToCloudDB() {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;

  try {
    // Scan all legacy keys and migrate to new prefix
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(LEGACY_STORAGE_PREFIX)) {
        const gameKey = key.replace(LEGACY_STORAGE_PREFIX, '');
        const targetKey = getStorageKey(gameKey);
        if (!localStorage.getItem(targetKey)) {
          const legacyData = localStorage.getItem(key);
          if (legacyData) {
            localStorage.setItem(targetKey, legacyData);
          }
        }
      }
    }
  } catch (err) {
    console.warn('[Leaderboard] Local migration notice:', err);
  }
}

/**
 * Fetch leaderboard rankings for a specific game from Local Storage (Deduplicated by Name)
 */
export async function getLeaderboardFromDB(gameKey = 'pacman') {
  const localList = getStoredList(gameKey);
  if (localList.length > 0) {
    return localList;
  }

  // Load default initial rankings for this game
  const initial = getLocalLeaderboardFallback(gameKey);
  saveStoredList(gameKey, initial);
  return initial;
}

/**
 * Fetch ALL games' leaderboard rankings from Local Storage in a single call.
 * Returns an object: { [gameKey]: deduplicatedList }
 */
export async function getAllLeaderboardsFromDB() {
  const result = {};

  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return result;

  try {
    // Find all matching keys in localStorage
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) {
        const gameKey = key.replace(STORAGE_PREFIX, '');
        try {
          const list = JSON.parse(localStorage.getItem(key) || '[]');
          result[gameKey] = deduplicateLeaderboard(list);
        } catch (e) {}
      }
    }
  } catch (err) {
    console.warn('[Leaderboard] Batch read fallback:', err);
  }

  return result;
}

/**
 * Submit a new high score record to Local Storage (Updates existing record if higher, or pushes new)
 */
export async function submitScoreToDB(gameKey, name, score) {
  let cleanName = '우리 학교 학생';
  let newScore = 0;

  if (typeof name === 'object' && name !== null) {
    cleanName = String(name.name || '').trim() || '우리 학교 학생';
    newScore = Number(name.score) || 0;
  } else {
    cleanName = String(name || '').trim() || '우리 학교 학생';
    newScore = Number(score) || 0;
  }

  // Rule: Do not register scores of 100 or below to Leaderboard
  if (newScore <= 100) {
    return false;
  }

  const todayDate = new Date().toISOString().split('T')[0];
  const currentList = await getLeaderboardFromDB(gameKey);

  const existingIdx = currentList.findIndex(item => item.name === cleanName);

  if (existingIdx !== -1) {
    // If existing score is higher or equal, keep it
    if (newScore > currentList[existingIdx].score) {
      currentList[existingIdx].score = newScore;
      currentList[existingIdx].date = todayDate;
      currentList[existingIdx].timestamp = Date.now();
    }
  } else {
    currentList.push({
      id: `local_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      name: cleanName,
      score: newScore,
      date: todayDate,
      timestamp: Date.now()
    });
  }

  const deduplicated = deduplicateLeaderboard(currentList);
  saveStoredList(gameKey, deduplicated);
  return true;
}

/**
 * Update an existing score record in Local Storage (Admin Feature)
 */
export async function updateScoreInDB(gameKey, id, name, score) {
  const updatedName = String(name).trim();
  const updatedScore = Number(score) || 0;

  try {
    const list = await getLeaderboardFromDB(gameKey);
    const index = list.findIndex(item => String(item.id) === String(id) || item.name === name);
    if (index !== -1) {
      list[index].name = updatedName;
      list[index].score = updatedScore;
      list[index].date = new Date().toISOString().split('T')[0];
      list[index].timestamp = Date.now();
    } else {
      list.push({
        id: id || `local_${Date.now()}`,
        name: updatedName,
        score: updatedScore,
        date: new Date().toISOString().split('T')[0],
        timestamp: Date.now()
      });
    }
    saveStoredList(gameKey, list);
    return true;
  } catch (e) {
    console.error('[Leaderboard] Failed to update score:', e);
    return false;
  }
}

/**
 * Delete a score record from Local Storage (Admin Feature)
 */
export async function deleteScoreFromDB(gameKey, id) {
  try {
    const list = await getLeaderboardFromDB(gameKey);
    const filtered = list.filter(item => String(item.id) !== String(id));
    saveStoredList(gameKey, filtered);
    return true;
  } catch (e) {
    console.error('[Leaderboard] Failed to delete score:', e);
    return false;
  }
}

/**
 * Reset a game's leaderboard to initial defaults
 */
export async function resetGameLeaderboard(gameKey) {
  const initial = getLocalLeaderboardFallback(gameKey);
  saveStoredList(gameKey, initial);
  return initial;
}

/**
 * Fallback Local Leaderboard Initial Mock Data
 */
function getLocalLeaderboardFallback(gameKey) {
  const fallbackMap = {
    pacman: [
      { id: 'p1', name: '김학생 (5A)', score: 12400, date: '2026-08-12' },
      { id: 'p2', name: '이슬기 (4B)', score: 9800, date: '2026-08-12' },
      { id: 'p3', name: '박민준 (6C)', score: 8500, date: '2026-08-11' },
      { id: 'p4', name: '최하은 (3A)', score: 6200, date: '2026-08-10' },
      { id: 'p5', name: '정우진 (5B)', score: 4900, date: '2026-08-09' }
    ],
    dino: [
      { id: 'd1', name: '선생님', score: 1836, date: '2026-08-17' },
      { id: 'd2', name: '김학생 (5A)', score: 1520, date: '2026-08-15' },
      { id: 'd3', name: '이달려 (4B)', score: 1180, date: '2026-08-15' },
      { id: 'd4', name: '박익룡 (6C)', score: 890, date: '2026-08-14' },
      { id: 'd5', name: '최선인장 (3A)', score: 650, date: '2026-08-14' }
    ],
    snake: [
      { id: 's1', name: '강스네이크 (6A)', score: 480, date: '2026-08-14' },
      { id: 's2', name: '김학생 (5A)', score: 360, date: '2026-08-14' },
      { id: 's3', name: '이민서 (4C)', score: 280, date: '2026-08-13' },
      { id: 's4', name: '박지훈 (3B)', score: 190, date: '2026-08-12' },
      { id: 's5', name: '최예은 (5C)', score: 150, date: '2026-08-11' }
    ],
    solitaire: [
      { id: 'so1', name: '선생님', score: 890, date: '2026-08-17' },
      { id: 'so2', name: '김에이스 (6A)', score: 780, date: '2026-08-15' },
      { id: 'so3', name: '이스페이드 (5B)', score: 650, date: '2026-08-15' },
      { id: 'so4', name: '박하트 (4C)', score: 520, date: '2026-08-14' },
      { id: 'so5', name: '최클로버 (3A)', score: 410, date: '2026-08-14' }
    ],
    minesweeper: [
      { id: 'm1', name: '이지뢰 (6B)', score: 3200, date: '2026-08-16' },
      { id: 'm2', name: '김학생 (5A)', score: 2450, date: '2026-08-16' },
      { id: 'm3', name: '박하늘 (4A)', score: 1800, date: '2026-08-15' },
      { id: 'm4', name: '정수빈 (3C)', score: 1250, date: '2026-08-15' },
      { id: 'm5', name: '최강우 (5B)', score: 850, date: '2026-08-14' }
    ],
    baseball: [
      { id: 'b1', name: '이홈런 (6A)', score: 4850, date: '2026-08-16' },
      { id: 'b2', name: '김학생 (5A)', score: 3620, date: '2026-08-16' },
      { id: 'b3', name: '박타자 (4B)', score: 2750, date: '2026-08-16' },
      { id: 'b4', name: '최안타 (5C)', score: 1980, date: '2026-08-15' },
      { id: 'b5', name: '강슬러거 (3A)', score: 1240, date: '2026-08-15' }
    ],
    colortile: [
      { id: 'c1', name: '김타일 (6C)', score: 8600, date: '2026-08-16' },
      { id: 'c2', name: '이퍼즐 (5B)', score: 6400, date: '2026-08-16' },
      { id: 'c3', name: '김학생 (5A)', score: 4950, date: '2026-08-16' },
      { id: 'c4', name: '박매칭 (4A)', score: 3200, date: '2026-08-16' },
      { id: 'c5', name: '최콤보 (3B)', score: 1800, date: '2026-08-16' }
    ],
    popcorn: [
      { id: 'pop1', name: '선생님', score: 1775, date: '2026-08-17' },
      { id: 'pop2', name: '김팝콘 (6A)', score: 1450, date: '2026-08-16' },
      { id: 'pop3', name: '이버터 (5B)', score: 1180, date: '2026-08-16' },
      { id: 'pop4', name: '박불꽃 (4C)', score: 890, date: '2026-08-15' },
      { id: 'pop5', name: '최옥수수 (3A)', score: 620, date: '2026-08-15' }
    ],
    tictactoe: [
      { id: 't1', name: '선생님', score: 660, date: '2026-08-17' },
      { id: 't2', name: '김도넛 (6A)', score: 550, date: '2026-08-16' },
      { id: 't3', name: '이딸기 (5B)', score: 420, date: '2026-08-16' },
      { id: 't4', name: '박초코 (4C)', score: 310, date: '2026-08-15' },
      { id: 't5', name: '최글레이즈 (3A)', score: 220, date: '2026-08-15' }
    ],
    champion: [
      { id: 'ch1', name: '김럭키 (6A)', score: 3200, date: '2026-08-16' },
      { id: 'ch2', name: '김학생 (5A)', score: 2650, date: '2026-08-16' },
      { id: 'ch3', name: '이닌자 (4B)', score: 2100, date: '2026-08-16' },
      { id: 'ch4', name: '박챔피언 (5C)', score: 1750, date: '2026-08-15' },
      { id: 'ch5', name: '최두루마리 (3A)', score: 1200, date: '2026-08-15' }
    ],
    cricket: [
      { id: 'cr1', name: '선생님', score: 101, date: '2026-08-17' },
      { id: 'cr2', name: '김바운더리 (6A)', score: 95, date: '2026-08-17' },
      { id: 'cr3', name: '이스윙 (5B)', score: 82, date: '2026-08-17' },
      { id: 'cr4', name: '박볼러 (4C)', score: 68, date: '2026-08-16' },
      { id: 'cr5', name: '최크리켓 (3A)', score: 54, date: '2026-08-16' }
    ],
    ponyexpress: [
      { id: 'pe1', name: '선생님', score: 2096, date: '2026-08-17' },
      { id: 'pe2', name: '김라이더 (6A)', score: 1750, date: '2026-08-17' },
      { id: 'pe3', name: '이우편 (5B)', score: 1380, date: '2026-08-16' },
      { id: 'pe4', name: '박포니 (4C)', score: 990, date: '2026-08-16' },
      { id: 'pe5', name: '최배달 (3A)', score: 680, date: '2026-08-15' }
    ],
    jerrylawson: [
      { id: 'jl1', name: '선생님', score: 4315, date: '2026-08-17' },
      { id: 'jl2', name: '김카트리지 (6A)', score: 3600, date: '2026-08-17' },
      { id: 'jl3', name: '이픽셀 (5B)', score: 2850, date: '2026-08-16' },
      { id: 'jl4', name: '박도트 (4C)', score: 2100, date: '2026-08-16' },
      { id: 'jl5', name: '최레트로 (3A)', score: 1450, date: '2026-08-15' }
    ],
    magic: [
      { id: 'mg1', name: '선생님', score: 35375, date: '2026-08-17' },
      { id: 'mg2', name: '김매직 (6A)', score: 28400, date: '2026-08-17' },
      { id: 'mg3', name: '이지팡이 (5B)', score: 21500, date: '2026-08-16' },
      { id: 'mg4', name: '박스펠 (4C)', score: 15200, date: '2026-08-16' },
      { id: 'mg5', name: '최위자드 (3A)', score: 9800, date: '2026-08-15' }
    ],
    fruitmerge: [
      { id: 'fm1', name: '선생님', score: 13020, date: '2026-08-17' },
      { id: 'fm2', name: '김수박 (6A)', score: 9850, date: '2026-08-17' },
      { id: 'fm3', name: '이멜론 (5B)', score: 7400, date: '2026-08-16' },
      { id: 'fm4', name: '박파인애플 (4C)', score: 5200, date: '2026-08-16' },
      { id: 'fm5', name: '최딸기 (3A)', score: 3100, date: '2026-08-15' }
    ],
    brickbreaker: [
      { id: 'bb1', name: '선생님', score: 7870, date: '2026-08-17' },
      { id: 'bb2', name: '김벽돌 (6A)', score: 6200, date: '2026-08-17' },
      { id: 'bb3', name: '이레이저 (5B)', score: 4850, date: '2026-08-16' },
      { id: 'bb4', name: '박콤보 (4C)', score: 3400, date: '2026-08-16' },
      { id: 'bb5', name: '최볼 (3A)', score: 2150, date: '2026-08-15' }
    ],
    skyjumper: [
      { id: 'sj1', name: '선생님', score: 18450, date: '2026-08-19' },
      { id: 'sj2', name: '김점퍼 (6A)', score: 14200, date: '2026-08-19' },
      { id: 'sj3', name: '이로켓 (5B)', score: 11500, date: '2026-08-18' },
      { id: 'sj4', name: '박스프링 (4C)', score: 8300, date: '2026-08-18' },
      { id: 'sj5', name: '최우주 (3A)', score: 5400, date: '2026-08-17' }
    ],
    kidscoding: [
      { id: 'kc1', name: '선생님', score: 3200, date: '2026-08-20' },
      { id: 'kc2', name: '김알고 (6A)', score: 2800, date: '2026-08-20' },
      { id: 'kc3', name: '이루프 (5B)', score: 2400, date: '2026-08-19' },
      { id: 'kc4', name: '박토끼 (4C)', score: 1900, date: '2026-08-19' },
      { id: 'kc5', name: '최당근 (3A)', score: 1400, date: '2026-08-19' }
    ],
    bubbletea: [
      { id: 'bt1', name: '선생님', score: 2850, date: '2026-08-21' },
      { id: 'bt2', name: '김버블 (6A)', score: 2400, date: '2026-08-21' },
      { id: 'bt3', name: '이타로 (5B)', score: 1950, date: '2026-08-21' },
      { id: 'bt4', name: '박밀크 (4C)', score: 1500, date: '2026-08-21' },
      { id: 'bt5', name: '최흑당 (3A)', score: 1100, date: '2026-08-21' }
    ],
    memory: [
      { id: 'mem1', name: '선생님', score: 4800, date: '2026-08-23' },
      { id: 'mem2', name: '김두뇌 (6A)', score: 3950, date: '2026-08-23' },
      { id: 'mem3', name: '이기억 (5B)', score: 3100, date: '2026-08-23' },
      { id: 'mem4', name: '박퍼즐 (4C)', score: 2250, date: '2026-08-22' },
      { id: 'mem5', name: '최집중 (3A)', score: 1600, date: '2026-08-22' }
    ],
    microkart: [
      { id: 'mk1', name: '선생님', score: 5400, date: '2026-09-04' },
      { id: 'mk2', name: '김드리프트 (6A)', score: 4850, date: '2026-09-04' },
      { id: 'mk3', name: '이부스터 (5B)', score: 4100, date: '2026-09-03' },
      { id: 'mk4', name: '박바나나 (4C)', score: 3200, date: '2026-09-03' },
      { id: 'mk5', name: '최스피드 (3A)', score: 2450, date: '2026-09-02' }
    ],
    piratecoin: [
      { id: 'pc1', name: '선생님', score: 3800, date: '2026-09-10' },
      { id: 'pc2', name: '이황금해적 (6A)', score: 3200, date: '2026-09-10' },
      { id: 'pc3', name: '박보물선장 (5B)', score: 2650, date: '2026-09-09' },
      { id: 'pc4', name: '최코인도둑 (4C)', score: 1950, date: '2026-09-09' },
      { id: 'pc5', name: '강쾌속앵커 (3A)', score: 1400, date: '2026-09-08' }
    ],
    tetris: [
      { id: 'tt1', name: '선생님', score: 6200, date: '2026-10-20' },
      { id: 'tt2', name: '김블록 (6A)', score: 5400, date: '2026-10-20' },
      { id: 'tt3', name: '이라인 (5B)', score: 4200, date: '2026-10-19' },
      { id: 'tt4', name: '박회전 (4C)', score: 3100, date: '2026-10-18' },
      { id: 'tt5', name: '최콤보 (3A)', score: 2000, date: '2026-10-17' }
    ]
  };

  if (fallbackMap[gameKey]) {
    return deduplicateLeaderboard(fallbackMap[gameKey]);
  }

  return deduplicateLeaderboard([
    { id: '1', name: '박민준 (6C)', score: 3450, date: '2026-08-12' },
    { id: '2', name: '김학생 (5A)', score: 2890, date: '2026-08-12' },
    { id: '3', name: '윤서연 (4A)', score: 2100, date: '2026-08-11' },
    { id: '4', name: '강현우 (6A)', score: 1750, date: '2026-08-10' }
  ]);
}
