import type { WorkerRequest, WorkerResponse } from "@/types/worker";
import { CleanError } from "@/types/processing";

export type ProgressHandler = (value: number, stage: string) => void;

interface PendingJob {
  request: WorkerRequest;
  transfer: Transferable[];
  onProgress?: ProgressHandler;
  resolve: (response: WorkerResponse) => void;
  reject: (error: Error) => void;
}

interface Slot {
  worker: Worker;
  job: PendingJob | null;
}

function createWorker(): Worker {
  return new Worker(new URL("../../workers/metadata.worker.ts", import.meta.url), {
    type: "module",
    name: "metadata-cleaner",
  });
}

/**
 * A fixed pool of module workers with a shared FIFO queue.
 *
 * Workers are replaced rather than reused after a crash, so one image that
 * exhausts memory cannot take the rest of a 500-file batch down with it.
 */
export class WorkerPool {
  private slots: Slot[] = [];
  private queue: PendingJob[] = [];
  private disposed = false;

  constructor(private readonly size: number) {}

  private ensureStarted(): void {
    if (this.disposed) throw new Error("The worker pool has been disposed");
    while (this.slots.length < Math.max(1, this.size)) {
      this.slots.push(this.createSlot());
    }
  }

  private createSlot(): Slot {
    const slot: Slot = { worker: createWorker(), job: null };

    slot.worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      if (response.kind === "progress") {
        slot.job?.onProgress?.(response.value, response.stage);
        return;
      }
      const job = slot.job;
      slot.job = null;
      job?.resolve(response);
      this.drain();
    });

    slot.worker.addEventListener("error", (event: ErrorEvent) => {
      const job = slot.job;
      slot.job = null;
      event.preventDefault();
      job?.reject(
        new CleanError(
          "worker-crashed",
          event.message || "The background worker stopped unexpectedly.",
        ),
      );
      this.replaceSlot(slot);
      this.drain();
    });

    return slot;
  }

  private replaceSlot(slot: Slot): void {
    slot.worker.terminate();
    const index = this.slots.indexOf(slot);
    if (index >= 0) {
      this.slots[index] = this.disposed ? slot : this.createSlot();
    }
  }

  private drain(): void {
    if (this.disposed) return;
    for (const slot of this.slots) {
      if (slot.job || this.queue.length === 0) continue;
      const job = this.queue.shift();
      if (!job) return;
      slot.job = job;
      try {
        slot.worker.postMessage(job.request, job.transfer);
      } catch (error) {
        slot.job = null;
        job.reject(
          error instanceof Error ? error : new Error("Failed to hand work to the worker"),
        );
      }
    }
  }

  run(
    request: WorkerRequest,
    transfer: Transferable[] = [],
    onProgress?: ProgressHandler,
  ): Promise<WorkerResponse> {
    this.ensureStarted();
    return new Promise<WorkerResponse>((resolve, reject) => {
      this.queue.push({ request, transfer, onProgress, resolve, reject });
      this.drain();
    });
  }

  /** Drops queued work; jobs already inside a worker are allowed to finish. */
  clearQueue(): void {
    const dropped = this.queue.splice(0, this.queue.length);
    for (const job of dropped) {
      job.reject(new CleanError("cancelled", "Cancelled before processing started."));
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearQueue();
    for (const slot of this.slots) {
      slot.job?.reject(new CleanError("cancelled", "Processing was cancelled."));
      slot.worker.terminate();
    }
    this.slots = [];
  }
}
