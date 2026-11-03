import { track } from "../analytics";
import { openTributeProduct, openTributeWeb, tributeTelegramLink, tributeWebLink } from "../telegram";

type PlanId = "monthly" | "yearly";
type PayMethod = "stars" | "card";

const METHODS: { id: PayMethod; title: string; note: string }[] = [
  {
    id: "stars",
    title: "Звёзды в Telegram",
    note: "Только звёзды. В Telegram цифровые товары продаются так.",
  },
  {
    id: "card",
    title: "Карта в браузере",
    note: "Откроется в браузере. Там оплата картой.",
  },
];

export function TributePlans({
  subscribeUrl,
  subscribeYearlyUrl,
  source,
}: {
  subscribeUrl: string;
  subscribeYearlyUrl?: string;
  source: string;
}) {
  const plans: { id: PlanId; url: string; label: string; quiet: boolean }[] = [
    { id: "monthly", url: subscribeUrl, label: "Месяц", quiet: false },
  ];
  if (subscribeYearlyUrl) {
    plans.push({ id: "yearly", url: subscribeYearlyUrl, label: "Год · −45%", quiet: true });
  }

  return (
    <div className="pay-methods">
      {METHODS.map((method) => (
        <section key={method.id} className="pay-method" aria-label={method.title}>
          <div className="pay-method-copy">
            <strong>{method.title}</strong>
            <p>{method.note}</p>
          </div>
          <div className="pay-method-actions">
            {plans.map((plan) => {
              const href = method.id === "stars" ? tributeTelegramLink(plan.url) : tributeWebLink(plan.url);
              return (
                <a
                  key={plan.id}
                  className={plan.quiet ? "pay-choice pay-choice-quiet" : "pay-choice"}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => {
                    track("checkout_opened", { plan: plan.id, source, method: method.id });
                    const opened = method.id === "stars" ? openTributeProduct(plan.url) : openTributeWeb(plan.url);
                    if (opened) event.preventDefault();
                  }}
                >
                  {plan.label}
                </a>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
