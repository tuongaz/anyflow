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
        style={{
          fontWeight: 700,
          fontSize: 16,
          color: '#0f172a',
          letterSpacing: '-0.02em',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
        }}
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
