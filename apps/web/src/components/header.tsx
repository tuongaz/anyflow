import { ProjectSwitcher } from '@/components/project-switcher';
import type { CreateProjectResult, DemoSummary } from '@/lib/api';
import { navigate } from '@/lib/router';

export interface HeaderProps {
  demos: DemoSummary[];
  currentSlug?: string;
  onProjectCreated?: (result: CreateProjectResult) => void;
}

export function Header({ demos, currentSlug, onProjectCreated }: HeaderProps) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b bg-background px-4">
      <button
        type="button"
        onClick={() => navigate('/')}
        className="text-sm font-semibold tracking-tight hover:text-foreground/80"
      >
        AnyDemo Studio
      </button>
      <div className="flex items-center gap-3">
        <ProjectSwitcher
          demos={demos}
          currentSlug={currentSlug}
          onProjectCreated={onProjectCreated}
        />
      </div>
    </header>
  );
}
