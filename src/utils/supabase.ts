// Supabase REST API client (zero-dependency, uses fetch directly)

const SUPABASE_URL = 'https://xjwapsmblcoldoecingk.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhqd2Fwc21ibGNvbGRvZWNpbmdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEwNzIxMDQsImV4cCI6MjA4NjY0ODEwNH0.2GsPSTq-OujnJYqZy4AFZhNKr6lW9Az0yJXcvywyGTE';

const headers = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=minimal',
};

export interface LeaderboardEntry {
  id: number;
  nickname: string;
  score: number;
  level: number;
  created_at: string;
}

export async function submitScore(
  nickname: string,
  score: number,
  level: number,
): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/leaderboard`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ nickname, score, level }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/leaderboard?select=id,nickname,score,level,created_at&order=score.desc&limit=100`,
      { headers },
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function getPlayerRank(score: number): Promise<number> {
  try {
    // Count how many scores are strictly higher than the player's score
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/leaderboard?select=id&score=gt.${score}`,
      {
        headers: { ...headers, Prefer: 'count=exact' },
      },
    );
    if (!res.ok) return -1;
    const count = res.headers.get('content-range');
    // content-range format: "0-N/total" or "*/total"
    if (count) {
      const total = parseInt(count.split('/')[1], 10);
      return (isNaN(total) ? 0 : total) + 1;
    }
    return -1;
  } catch {
    return -1;
  }
}
