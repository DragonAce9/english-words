import { metrics } from "@opentelemetry/api";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import type { IncomingMessage, ServerResponse } from "node:http";

const exporter = new PrometheusExporter({ preventServerStart: true });
const meterProvider = new MeterProvider({ readers: [exporter] });
metrics.setGlobalMeterProvider(meterProvider);

const meter = meterProvider.getMeter("english-words");

export const sessionStarted = meter.createCounter("session_started", {
  description: "Mini App learning sessions started",
});

export const progressWritten = meter.createCounter("progress_written", {
  description: "Progress batches written to Postgres",
});

export const httpDuration = meter.createHistogram("http_request_duration_ms", {
  description: "HTTP handler latency",
  unit: "ms",
});

export function collectMetrics(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const res = {
      statusCode: 200,
      setHeader() {
        return this;
      },
      getHeader() {
        return undefined;
      },
      write(chunk: string | Buffer) {
        chunks.push(Buffer.from(chunk));
        return true;
      },
      end(chunk?: string | Buffer) {
        if (chunk) chunks.push(Buffer.from(chunk));
        resolve(Buffer.concat(chunks).toString("utf8"));
      },
    } as unknown as ServerResponse;

    try {
      exporter.getMetricsRequestHandler({} as IncomingMessage, res);
    } catch (error) {
      reject(error);
    }
  });
}
