import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<{ language: string }>();

export function enterLanguage<T>(language: string, fn: () => T): T {
  return store.run({ language: language || "en" }, fn);
}

export function activeLanguage(): string {
  return store.getStore()?.language ?? "en";
}
