import { describe, expect, it } from "vitest";
import { isHttpsWebAppUrl } from "./bot.js";

describe("isHttpsWebAppUrl", () => {
  it("accepts public https Mini App URLs", () => {
    expect(isHttpsWebAppUrl("https://app.example.com")).toBe(true);
    expect(isHttpsWebAppUrl("https://app.example.com/mini")).toBe(true);
  });

  it("rejects localhost, http, empty, and junk", () => {
    expect(isHttpsWebAppUrl("http://localhost:3000")).toBe(false);
    expect(isHttpsWebAppUrl("http://127.0.0.1:3000")).toBe(false);
    expect(isHttpsWebAppUrl("")).toBe(false);
    expect(isHttpsWebAppUrl(undefined)).toBe(false);
    expect(isHttpsWebAppUrl("not-a-url")).toBe(false);
  });
});
