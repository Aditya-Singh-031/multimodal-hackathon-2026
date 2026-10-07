import { MOCK_PATIENTS, mockPredict, mockSimulate } from "./mock";
import type { Patient, PredictRequest, Prediction, Simulation } from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function http<T>(path: string, init?: RequestInit, timeoutMs = 15000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${BASE}${path}`, {
      ...init, signal: ctl.signal, headers: { "Content-Type": "application/json" },
    });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return (await r.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

/** Every call degrades to the offline model; `offline` tells the UI to show a badge. */
export async function getPatients(): Promise<{ data: Patient[]; offline: boolean }> {
  try {
    const data = await http<Patient[]>("/api/patients", undefined, 5000);
    if (!data.length) throw new Error("empty");
    return { data, offline: false };
  } catch {
    return { data: MOCK_PATIENTS, offline: true };
  }
}

export async function predict(req: PredictRequest): Promise<{ data: Prediction; offline: boolean }> {
  try {
    return { data: await http<Prediction>("/api/predict", { method: "POST", body: JSON.stringify(req) }), offline: false };
  } catch {
    return { data: mockPredict(req), offline: true };
  }
}

export async function simulate(
  base: PredictRequest, overrides: Record<string, number | boolean>,
): Promise<{ data: Simulation; offline: boolean }> {
  try {
    return { data: await http<Simulation>("/api/simulate", { method: "POST", body: JSON.stringify({ base, overrides }) }), offline: false };
  } catch {
    return { data: mockSimulate(base, overrides), offline: true };
  }
}
