import { JsonTree } from '@/components/json-tree';
import { StatusPill } from '@/components/nodes/status-pill';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import type { NodeRunState } from '@/hooks/use-node-runs';
import type { DemoNode } from '@/lib/api';

export interface DetailPanelProps {
  node: DemoNode | null;
  filePath?: string;
  /** Current run state for the selected node, when known. */
  run?: NodeRunState;
  onClose: () => void;
}

export function DetailPanel({ node, filePath, run, onClose }: DetailPanelProps) {
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
        className="!w-[380px] sm:!max-w-[380px] overflow-y-auto"
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

            {run ? <RunSection run={run} /> : null}

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

function RunSection({ run }: { run: NodeRunState }) {
  return (
    <div
      className="rounded-md border bg-card px-3 py-2 text-xs"
      data-testid="detail-panel-run"
      data-status={run.status}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium uppercase tracking-wide text-[10px] text-muted-foreground">
          Last run
        </span>
        <div className="flex items-center gap-2">
          {typeof run.responseStatus === 'number' ? (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
              {run.responseStatus}
            </span>
          ) : null}
          <StatusPill status={run.status} />
        </div>
      </div>
      {run.status === 'error' && run.error ? (
        <div className="rounded bg-rose-50 px-2 py-1.5 text-rose-900 dark:bg-rose-950/40 dark:text-rose-100">
          {run.error}
        </div>
      ) : null}
      {run.body !== undefined ? (
        <div className="mt-1 max-h-72 overflow-auto rounded bg-muted/40 p-2">
          <JsonTree value={run.body} />
        </div>
      ) : null}
    </div>
  );
}
