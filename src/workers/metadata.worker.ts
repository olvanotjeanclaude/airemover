/// <reference lib="webworker" />
import type { WorkerRequest, WorkerResponse } from "@/types/worker";
import { handleWorkerRequest } from "./handler";

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  const post = (response: WorkerResponse, transfer: Transferable[] = []): void => {
    scope.postMessage(response, transfer);
  };

  void handleWorkerRequest(request, (value, stage) => {
    post({ kind: "progress", jobId: request.jobId, value, stage });
  }).then((outcome) => {
    post(outcome.response, outcome.transfer);
  });
});

export {};
