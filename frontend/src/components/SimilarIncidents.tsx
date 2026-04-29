import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { analyticsApi } from '../api/services';
import { Card } from './ui/Forms';
import { PriorityBadge } from './ui/Badges';

interface SimilarRecord {
  id: string;
  recordNumber: string;
  title: string;
  priority: string;
  resolutionHours: number | null;
  lastComment: string | null;
}

const truncateComment = (text: string, max = 140): string =>
  text.length <= max ? text : text.slice(0, max).trimEnd() + '…';

export function SimilarIncidents({ recordId }: { recordId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['similar', recordId],
    queryFn: () => analyticsApi.similar(recordId).then((r) => r.data),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <Card title="Similar Resolved Tickets">
        <div className="p-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="animate-pulse flex flex-col gap-1.5">
              <div className="h-3 w-32 bg-gray-100 rounded" />
              <div className="h-3 w-full bg-gray-100 rounded" />
              <div className="h-2.5 w-3/4 bg-gray-50 rounded" />
            </div>
          ))}
        </div>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card title="Similar Resolved Tickets">
        <div className="p-4 text-sm text-gray-400">Couldn't load similar incidents.</div>
      </Card>
    );
  }

  const similar: SimilarRecord[] = data?.similar || [];
  if (similar.length === 0) return null;

  return (
    <Card title="Similar Resolved Tickets">
      <ul className="divide-y divide-gray-100">
        {similar.map((s) => (
          <li key={s.id} className="px-5 py-3 hover:bg-gray-50 transition">
            <Link to={`/records/${s.id}`} className="block group">
              <div className="flex items-center gap-2 mb-1">
                <PriorityBadge priority={s.priority} short />
                <span className="font-mono text-xs text-gray-400">{s.recordNumber}</span>
                {typeof s.resolutionHours === 'number' && (
                  <span className="ml-auto text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                    Resolved in {s.resolutionHours}h
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-900 truncate group-hover:text-blue-700">{s.title}</p>
              {s.lastComment && (
                <p className="text-xs text-gray-500 mt-1 line-clamp-2">{truncateComment(s.lastComment)}</p>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
