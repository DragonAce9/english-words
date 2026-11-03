import { useEffect, useState } from "react";
import {
  canOfferHomeScreen,
  checkHomeScreenStatus,
  onHomeScreenAdded,
  promptAddToHomeScreen,
  type HomeScreenStatus,
} from "../telegram";

export function HomeScreenButton() {
  const [status, setStatus] = useState<HomeScreenStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void checkHomeScreenStatus().then((next) => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return onHomeScreenAdded(() => setStatus("added"));
  }, []);

  if (!status || !canOfferHomeScreen(status)) return null;

  return (
    <button
      type="button"
      className="ghost home-screen-btn"
      onClick={() => {
        promptAddToHomeScreen();
      }}
    >
      Добавить на экран Домой
    </button>
  );
}
