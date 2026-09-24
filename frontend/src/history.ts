import type { Analysis, PostInput } from './api';

export type QueryRecord = {
  id: number;
  post: PostInput;
  analysis: Analysis;
};

export type QuerySort = 'newest';

export function sortQueryRecords(records: QueryRecord[], sort: QuerySort): QueryRecord[] {
  if (sort === 'newest') {
    return [...records].sort((a, b) => {
      const timeDifference = Date.parse(b.analysis.analyzedAt) - Date.parse(a.analysis.analyzedAt);
      return timeDifference || b.id - a.id;
    });
  }
  return [...records];
}
