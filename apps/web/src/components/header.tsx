import { ProjectSwitcher } from '@/components/project-switcher';
import type { DemoSummary } from '@/lib/api';
import { navigate } from '@/lib/router';

export interface HeaderProps {
  demos: DemoSummary[];
  currentSlug?: string;
}

export function Header({ demos, currentSlug }: HeaderProps) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b bg-background px-4">
      <button
        type="button"
        onClick={() => navigate('/')}
        className="text-sm font-semibold tracking-tight hover:text-foreground/80"
      >
        AnyDemo Studio
      </button>
      {demos.length > 0 ? <ProjectSwitcher demos={demos} currentSlug={currentSlug} /> : null}
    </header>
  );
}
