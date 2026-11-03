import { config } from "./config.js";
import { signTributeBody } from "./tribute.js";

const telegramUserId = Number(process.env.DEV_TELEGRAM_USER_ID ?? 1);
const eventName = process.argv[2] ?? "new_digital_product";
const purchaseId = Number(process.argv[3] ?? 42);
const productId = Number(
  process.argv[4] ??
    (eventName.includes("year") ? config.tributeProductYearlyId : config.tributeProductMonthlyId),
);
const base = process.env.API_URL ?? `http://127.0.0.1:${config.port}`;

const payload: Record<string, unknown> =
  eventName === "digital_product_refund"
    ? {
        purchase_id: purchaseId,
        product_id: productId,
        telegram_user_id: telegramUserId,
      }
    : {
        product_id: productId,
        purchase_id: purchaseId,
        amount: 49900,
        currency: "rub",
        telegram_user_id: telegramUserId,
      };

const body = JSON.stringify({
  name: eventName === "yearly" ? "new_digital_product" : eventName,
  created_at: new Date().toISOString(),
  sent_at: new Date().toISOString(),
  payload:
    eventName === "yearly"
      ? {
          product_id: config.tributeProductYearlyId,
          purchase_id: purchaseId,
          amount: 399000,
          currency: "rub",
          telegram_user_id: telegramUserId,
        }
      : payload,
});

const signature = signTributeBody(body);
const response = await fetch(`${base}/webhook/tribute`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "trbt-signature": signature,
  },
  body,
});

console.log(response.status, await response.text());
