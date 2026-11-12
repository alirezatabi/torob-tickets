/** Loading state that mirrors the real card layout (no layout shift). */
export function ResultsSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="card p-4">
          <div className="flex items-center gap-2">
            <div className="skeleton size-8 rounded-lg" />
            <div className="flex-1 space-y-1.5">
              <div className="skeleton h-3 w-28" />
              <div className="skeleton h-2 w-20" />
            </div>
            <div className="skeleton h-5 w-24" />
          </div>
          <div className="mt-4 flex items-center gap-3">
            <div className="skeleton h-4 w-12" />
            <div className="skeleton h-px flex-1" />
            <div className="skeleton h-4 w-12" />
          </div>
          <div className="mt-3 flex gap-1.5">
            <div className="skeleton h-4 w-20" />
            <div className="skeleton h-4 w-24" />
            <div className="skeleton h-4 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}
