import { Search } from "lucide-react";

export const EmptyState = () => (
  <div className="flex-1 flex flex-col items-center justify-center h-full text-on-surface-variant bg-surface relative z-10">
    <Search className="w-12 h-12 mb-4 opacity-50 text-primary" />
    <h2 className="text-xl font-headline font-semibold text-on-surface">
      No Contact Selected
    </h2>
  </div>
);
