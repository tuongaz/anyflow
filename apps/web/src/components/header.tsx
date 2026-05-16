import { ProjectSwitcher } from '@/components/project-switcher';
import type { CreateProjectResult, DemoSummary } from '@/lib/api';
import { navigate } from '@/lib/router';

export interface HeaderProps {
  demos: DemoSummary[];
  currentSlug?: string;
  onProjectCreated?: (result: CreateProjectResult) => void;
  onProjectUnregistered?: (id: string) => void;
}

export function Header({
  demos,
  currentSlug,
  onProjectCreated,
  onProjectUnregistered,
}: HeaderProps) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b bg-background px-4">
      <button
        type="button"
        onClick={() => navigate('/')}
        className="text-base font-bold tracking-tight text-[#0f172a] hover:text-[#0f172a]/80"
        style={{ letterSpacing: '-0.02em' }}
      >
        SeeFlow
      </button>
      <div className="flex items-center gap-3">
        <ProjectSwitcher
          demos={demos}
          currentSlug={currentSlug}
          onProjectCreated={onProjectCreated}
          onProjectUnregistered={onProjectUnregistered}
        />
      </div>
    </header>
  );
}
