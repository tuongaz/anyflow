import { Header } from '@/components/header';
import { useDemos } from '@/hooks/use-demos';
import { usePathname } from '@/lib/router';
import { DemoView } from '@/pages/demo-view';
import { StudioHome } from '@/pages/studio-home';

const matchDemoSlug = (pathname: string): string | null => {
  if (!pathname.startsWith('/d/')) return null;
  const slug = pathname.slice('/d/'.length);
  return slug.length > 0 ? decodeURIComponent(slug) : null;
};

export function App() {
  const pathname = usePathname();
  const { demos } = useDemos();
  const slug = matchDemoSlug(pathname);

  if (demos === null) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground">
      <Header demos={demos} currentSlug={slug ?? undefined} />
      <main className="min-h-0 flex-1">
        {slug ? <DemoView slug={slug} demos={demos} /> : <StudioHome demos={demos} />}
      </main>
    </div>
  );
}
