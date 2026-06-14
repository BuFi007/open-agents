import type {
  AiSdkHarnessSandboxProvider,
  Sandbox,
} from "@open-agents/sandbox";
import { connectSandbox } from "@open-agents/sandbox";
import {
  isExternalHarnessId,
  runHarnessTurn,
} from "@open-agents/harness-runner";
import {
  INTERNAL_HARNESS_SIGNATURE_HEADER,
  verifyInternalHarnessRequest,
} from "@/lib/harness-runner/internal-request";
import type {
  InternalHarnessRunEvent,
  InternalHarnessRunRequest,
} from "@/lib/harness-runner/protocol";
import { DEFAULT_SANDBOX_PORTS } from "@/lib/sandbox/config";

export const maxDuration = 800;

type HarnessCapableSandbox = Sandbox & {
  toHarnessSandboxProvider(
    bridgePorts?: ReadonlyArray<number>,
  ): AiSdkHarnessSandboxProvider;
};

function isHarnessCapableSandbox(
  sandbox: Sandbox,
): sandbox is HarnessCapableSandbox {
  return (
    "toHarnessSandboxProvider" in sandbox &&
    typeof sandbox.toHarnessSandboxProvider === "function"
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(request: Request) {
  const bodyText = await request.text();
  if (
    !verifyInternalHarnessRequest(
      bodyText,
      request.headers.get(INTERNAL_HARNESS_SIGNATURE_HEADER),
    )
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let input: InternalHarnessRunRequest;
  try {
    input = JSON.parse(bodyText) as InternalHarnessRunRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!isExternalHarnessId(input.harnessId)) {
    return Response.json({ error: "Invalid harness" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: InternalHarnessRunEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The caller disconnected; request.signal will abort the harness run.
        }
      };

      void (async () => {
        try {
          const sandbox = await connectSandbox(input.sandboxState, {
            ports: DEFAULT_SANDBOX_PORTS,
          });
          if (!isHarnessCapableSandbox(sandbox)) {
            throw new Error(
              "Configured sandbox provider does not support external harnesses",
            );
          }

          const result = await runHarnessTurn({
            harnessId: input.harnessId,
            sandboxProvider: sandbox.toHarnessSandboxProvider([5001]),
            workingDirectory: input.workingDirectory,
            sessionId: input.sessionId,
            messageId: input.messageId,
            messages: input.messages,
            originalMessages: input.originalMessages,
            selectedModelId: input.selectedModelId,
            modelId: input.modelId,
            abortSignal: request.signal,
            onChunk: (chunk) => {
              send({ type: "chunk", chunk });
            },
          });
          send({ type: "result", result });
        } catch (error) {
          console.error("[harness-runner] Harness turn failed:", error);
          send({ type: "error", error: getErrorMessage(error) });
        } finally {
          try {
            controller.close();
          } catch {
            // The stream was already cancelled by the caller.
          }
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}
