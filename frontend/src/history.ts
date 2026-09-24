import type { Analysis, PostInput } from './api';

export type QueryRecord = {
  id: number;
  post: PostInput;
  analysis: Analysis;
};

export type QuerySort = 'newest' | 'priority';

function compareNewest(a: QueryRecord, b: QueryRecord): number {
  const timeDifference = Date.parse(b.analysis.analyzedAt) - Date.parse(a.analysis.analyzedAt);
  return timeDifference || b.id - a.id;
}

export function sortQueryRecords(records: QueryRecord[], sort: QuerySort): QueryRecord[] {
  return [...records].sort((a, b) => {
    if (sort === 'priority') {
      const levelDifference = Number(a.analysis.priority.level.slice(-1)) - Number(b.analysis.priority.level.slice(-1));
      if (levelDifference) return levelDifference;
    }
    return compareNewest(a, b);
  });
}
