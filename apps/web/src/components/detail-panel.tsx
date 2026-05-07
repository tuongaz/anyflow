import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import type { DemoNode } from '@/lib/api';

export interface DetailPanelProps {
  node: DemoNode | null;
  filePath?: string;
  onClose: () => void;
}

export function DetailPanel({ node, filePath, onClose }: DetailPanelProps) {
  const open = node !== null;
  const detail = node?.data.detail;

  return (
    <Sheet
      open={open}
      modal={false}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="!w-[380px] sm:!max-w-[380px]"
        data-testid="detail-panel"
      >
        {node ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <SheetTitle data-testid="detail-panel-title">{node.data.label}</SheetTitle>
              <SheetDescription className="font-mono text-[11px]">
                {node.id} · {node.type}
              </SheetDescription>
            </div>

            {detail?.summary ? (
              <p className="text-sm text-foreground/90 leading-relaxed">{detail.summary}</p>
            ) : null}

            {detail?.fields && detail.fields.length > 0 ? (
              <div className="rounded-md border bg-muted/30">
                <dl className="divide-y">
                  {detail.fields.map((field) => (
                    <div key={field.label} className="flex items-start gap-3 px-3 py-2 text-xs">
                      <dt className="w-24 shrink-0 font-medium text-muted-foreground">
                        {field.label}
                      </dt>
                      <dd className="flex-1 break-all font-mono">{field.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}

            {filePath ? (
              <div className="mt-2 rounded-md bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
                <div className="font-medium uppercase tracking-wide text-[10px] mb-1">
                  Demo file
                </div>
                <div className="font-mono break-all">{filePath}</div>
              </div>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
