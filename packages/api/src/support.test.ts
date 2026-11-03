import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SUPPORT_USERNAME,
  SUPPORT_SELF,
  SUPPORT_UNAVAILABLE,
  formatSupportHeader,
  isSameSupportAccount,
  isSupportStartPayload,
  parseReplyCommand,
  parseSupportUserId,
  parseUserIdFromSupportHeader,
  persistSupportUserId,
  rememberSupportSender,
  rememberTicket,
  resetSupportState,
  resolveSupportChatId,
  isConfiguredSupportUser,
  matchesSupportUsername,
  normalizeUsername,
  supportChatTarget,
  supportUnavailableMessage,
  telegramErrorDescription,
  userIdFromRepliedMessage,
  hasDeliverableContent,
  enterSupportMode,
  isAwaitingSupport,
  leaveSupportMode,
} from "./support.js";

afterEach(() => {
  delete process.env.SUPPORT_TELEGRAM_USER_ID;
  delete process.env.SUPPORT_TELEGRAM_USERNAME;
  resetSupportState();
});

describe("support helpers", () => {
  it("parses a numeric support user id and ignores junk", () => {
    expect(parseSupportUserId("482910")).toBe(482910);
    expect(parseSupportUserId("")).toBeNull();
    expect(parseSupportUserId("nope")).toBeNull();
    expect(parseSupportUserId("-3")).toBeNull();
  });

  it("normalizes usernames and builds a chat target", () => {
    expect(normalizeUsername("@YOUR_SUPPORT_USERNAME")).toBe("YOUR_SUPPORT_USERNAME");
    expect(normalizeUsername(undefined)).toBe(DEFAULT_SUPPORT_USERNAME);
    expect(supportChatTarget(99, "YOUR_SUPPORT_USERNAME")).toBe(99);
    expect(supportChatTarget(null, "YOUR_SUPPORT_USERNAME")).toBe("@YOUR_SUPPORT_USERNAME");
  });

  it("formats a header with id, username and name", () => {
    const header = formatSupportHeader({
      id: 42,
      username: "ann",
      first_name: "Анна",
      last_name: "К",
    });
    expect(header).toContain("id 42");
    expect(header).toContain("@ann");
    expect(header).toContain("Анна К");
    expect(header).toContain("/reply 42");
    expect(parseUserIdFromSupportHeader(header)).toBe(42);
  });

  it("parses /reply and /start support", () => {
    expect(parseReplyCommand("/reply 9001 Спасибо, посмотрели")).toEqual({
      userId: 9001,
      text: "Спасибо, посмотрели",
    });
    expect(parseReplyCommand("/reply@YOUR_BOT_USERNAME 11 ок")).toEqual({ userId: 11, text: "ок" });
    expect(parseReplyCommand("/reply 11")).toBeNull();
    expect(isSupportStartPayload("support")).toBe(true);
    expect(isSupportStartPayload("SUPPORT")).toBe(true);
    expect(isSupportStartPayload("")).toBe(false);
  });

  it("resolves a user from a reply via map, header or forward origin", () => {
    rememberTicket(501, 777);
    expect(userIdFromRepliedMessage({ message_id: 501, text: "other" })).toBe(777);
    expect(userIdFromRepliedMessage({ text: formatSupportHeader({ id: 88, first_name: "Илья" }) })).toBe(88);
    expect(
      userIdFromRepliedMessage({
        forward_origin: { type: "user", sender_user: { id: 55 } },
      }),
    ).toBe(55);
    expect(userIdFromRepliedMessage({ text: "просто текст" })).toBeNull();
  });

  it("learns the support sender from username YOUR_SUPPORT_USERNAME", () => {
    expect(isConfiguredSupportUser({ id: 1, username: "someone" })).toBe(false);
    expect(isConfiguredSupportUser({ id: 123456, username: "YOUR_SUPPORT_USERNAME" })).toBe(true);
    expect(isConfiguredSupportUser({ id: 123456 })).toBe(true);
    expect(isConfiguredSupportUser({ id: 9, username: "other" })).toBe(false);
    expect(matchesSupportUsername("YOUR_SUPPORT_USERNAME")).toBe(true);
  });

  it("learns YOUR_SUPPORT_USERNAME case-insensitively", () => {
    rememberSupportSender({ id: 99, username: "YOUR_SUPPORT_USERNAME" });
    expect(isConfiguredSupportUser({ id: 99 })).toBe(true);
  });

  it("treats the writer as the support inbox when ids match", () => {
    expect(isSameSupportAccount({ id: 1000000001, username: "YOUR_SUPPORT_USERNAME" }, 1000000001)).toBe(true);
    expect(isSameSupportAccount({ id: 1000000002, username: "YOUR_TELEGRAM_USERNAME" }, 1000000001)).toBe(false);
    expect(isSameSupportAccount({ id: 1000000001, username: "YOUR_SUPPORT_USERNAME" }, "@YOUR_SUPPORT_USERNAME")).toBe(true);
    expect(isSameSupportAccount({ id: 1000000002, username: "YOUR_TELEGRAM_USERNAME" }, "@YOUR_SUPPORT_USERNAME")).toBe(false);
    expect(SUPPORT_SELF).toContain("аккаунт поддержки");
  });

  it("only the configured SUPPORT_TELEGRAM_USER_ID can reply", () => {
    process.env.SUPPORT_TELEGRAM_USER_ID = "555";
    expect(isConfiguredSupportUser({ id: 555, username: "YOUR_SUPPORT_USERNAME" })).toBe(true);
    expect(isConfiguredSupportUser({ id: 1, username: "YOUR_SUPPORT_USERNAME" })).toBe(false);
  });

  it("tracks support compose mode", () => {
    enterSupportMode(10);
    expect(isAwaitingSupport(10)).toBe(true);
    leaveSupportMode(10);
    expect(isAwaitingSupport(10)).toBe(false);
  });

  it("accepts text, photos and documents as deliverable", () => {
    expect(hasDeliverableContent({ text: "привет" })).toBe(true);
    expect(hasDeliverableContent({ text: "/support" })).toBe(false);
    expect(hasDeliverableContent({ photo: [{}] })).toBe(true);
    expect(hasDeliverableContent({ document: { file_id: "x" } })).toBe(true);
    expect(hasDeliverableContent({ text: "" })).toBe(false);
  });

  it("resolves support chat via getChat and keeps the numeric id", async () => {
    const id = await resolveSupportChatId(async () => ({ id: 777001 }));
    expect(id).toBe(777001);
    rememberSupportSender({ id: 1, username: "nope" });
    expect(await resolveSupportChatId(async () => ({ id: 1 }))).toBe(777001);
  });

  it("does not send to @YOUR_SUPPORT_USERNAME when getChat fails", async () => {
    let called = 0;
    const target = await resolveSupportChatId(async () => {
      called += 1;
      throw Object.assign(new Error("chat not found"), { description: "Bad Request: chat not found" });
    });
    expect(called).toBe(1);
    expect(target).toBeNull();
  });

  it("uses the numeric id from an YOUR_SUPPORT_USERNAME update without getChat", async () => {
    let called = 0;
    const target = await resolveSupportChatId(async () => {
      called += 1;
      return { id: 1 };
    }, { id: 1000000001, username: "YOUR_SUPPORT_USERNAME" });
    expect(called).toBe(0);
    expect(target).toBe(1000000001);
  });

  it("prefers SUPPORT_TELEGRAM_USER_ID over username and getChat", async () => {
    process.env.SUPPORT_TELEGRAM_USER_ID = "1000000001";
    let called = 0;
    const target = await resolveSupportChatId(async () => {
      called += 1;
      return { id: 1 };
    }, { id: 1000000002, username: "YOUR_TELEGRAM_USERNAME" });
    expect(called).toBe(0);
    expect(target).toBe(1000000001);
    expect(isSameSupportAccount({ id: 1000000002, username: "YOUR_TELEGRAM_USERNAME" }, target!)).toBe(false);
  });

  it("surfaces the Telegram description on a failed send", () => {
    const error = { description: "Bad Request: chat not found" };
    expect(telegramErrorDescription(error)).toBe("Bad Request: chat not found");
    expect(supportUnavailableMessage(error)).toBe(`${SUPPORT_UNAVAILABLE}\n(Bad Request: chat not found)`);
    expect(supportUnavailableMessage()).toBe(SUPPORT_UNAVAILABLE);
  });

  it("writes the learned support id into a dotenv file", () => {
    const file = join(mkdtempSync(join(tmpdir(), "support-env-")), ".env");
    writeFileSync(file, "SUPPORT_TELEGRAM_USERNAME=YOUR_SUPPORT_USERNAME\n");
    expect(persistSupportUserId(1000000001, file)).toBe(true);
    expect(readFileSync(file, "utf8")).toContain("SUPPORT_TELEGRAM_USER_ID=1000000001");
  });
});
