import { useState } from "react";
import { submitTeacherApplication, visibleError, type TeachLanguage } from "../api";
import { languageFlag } from "../languageFlag";
import { isInsideTelegram } from "../telegram";
import type { TeacherCard } from "../types";
import { ScreenHeader } from "./ScreenHeader";

const APPLY_FAILED = "Не удалось отправить заявку в поддержку. Попробуйте ещё раз.";
const BIO_MAX = 200;

function clipChars(value: string, max: number): string {
  const chars = [...value];
  return chars.length <= max ? value : chars.slice(0, max).join("");
}

function visibleApplyError(err: unknown): string {
  return visibleError(err, APPLY_FAILED);
}

function TeacherApply({
  teachLanguages,
  telegramUserId,
  telegramUsername,
}: {
  teachLanguages: TeachLanguage[];
  telegramUserId: number;
  telegramUsername: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [languages, setLanguages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const username = telegramUsername?.trim().replace(/^@/, "") ?? "";
  const bioLeft = BIO_MAX - [...bio].length;

  function toggleLanguage(code: string) {
    setLanguages((current) => (current.includes(code) ? current.filter((item) => item !== code) : [...current, code]));
  }

  async function submit() {
    if (busy || sent) return;
    setBusy(true);
    setError("");
    try {
      await submitTeacherApplication({ name: name.trim(), bio: bio.trim(), languages });
      setSent(true);
    } catch (err) {
      setSent(false);
      setError(visibleApplyError(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="card stack teacher-apply">
        <strong>Вы преподаватель?</strong>
        <p className="teachers-lead">Подайте заявку на вступление в ленту. Её проверит поддержка.</p>
        <button type="button" className="primary" onClick={() => setOpen(true)}>
          Подать заявку
        </button>
      </div>
    );
  }

  return (
    <form
      className="card stack teacher-apply"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <strong>Заявка в преподаватели</strong>
      <input
        className="input"
        value={name}
        maxLength={80}
        placeholder="Имя"
        aria-label="Имя"
        autoComplete="off"
        disabled={busy || sent}
        onChange={(event) => setName(event.target.value)}
      />
      <p className="teachers-lead">Telegram: {username ? `@${username}` : "в аккаунте нет username"}</p>
      <p className="teachers-lead">Telegram id: {telegramUserId}</p>
      <textarea
        className="input"
        value={bio}
        maxLength={BIO_MAX}
        rows={3}
        placeholder="Коротко о себе"
        aria-label="О себе"
        disabled={busy || sent}
        onChange={(event) => setBio(clipChars(event.target.value, BIO_MAX))}
      />
      <p className="teachers-lead">Осталось {bioLeft} из {BIO_MAX}</p>
      <p className="teachers-lead">Коротко о себе будет показано в профиле преподавателя.</p>
      <p className="teachers-lead">Фото: из аватарки аккаунта</p>
      <fieldset className="teacher-languages">
        <legend>Язык</legend>
        {teachLanguages.map((language) => {
          const flag = languageFlag(language.code);
          return (
            <label key={language.code}>
              <input
                type="checkbox"
                checked={languages.includes(language.code)}
                disabled={busy || sent}
                onChange={() => toggleLanguage(language.code)}
              />
              {flag ? (
                <span className="language-flag" aria-hidden="true">
                  {flag}
                </span>
              ) : null}
              {language.title}
            </label>
          );
        })}
      </fieldset>
      {error ? <p className="teacher-form-error">{error}</p> : null}
      {sent ? (
        <p className="teachers-lead" role="status">
          Заявка отправлена. Когда её разберут, бот напишет вам.
        </p>
      ) : (
        <button
          className="primary"
          type="submit"
          disabled={busy || !name.trim() || !bio.trim() || languages.length === 0 || !username}
        >
          {busy ? "Отправляем…" : "Отправить заявку"}
        </button>
      )}
    </form>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

export function TeachersFeed({
  teachers,
  locked = false,
  admin = false,
  languageTitle,
  listed = false,
  ownProfile = false,
  teachLanguages = [],
  account,
  onBack,
  onOpenAccess,
  onCreate,
  onDelete,
  onLeave,
  onRefreshPhoto,
}: {
  teachers: TeacherCard[];
  locked?: boolean;
  admin?: boolean;
  languageTitle?: string;
  listed?: boolean;
  ownProfile?: boolean;
  teachLanguages?: TeachLanguage[];
  account?: { telegramUserId: number; telegramUsername: string | null };
  onBack: () => void;
  onOpenAccess?: () => void;
  onCreate?: (input: { name: string; telegramUsername: string; bio: string }) => Promise<string | null>;
  onDelete?: (id: string) => Promise<void>;
  onLeave?: () => Promise<void>;
  onRefreshPhoto?: (id: string) => Promise<string | null>;
}) {
  const list = teachers ?? [];
  const showStub = !admin && (locked || list.length === 0);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit() {
    if (!onCreate || busy) return;
    setBusy(true);
    setFormError("");
    setNotice("");
    try {
      const warning = await onCreate({
        name: name.trim(),
        telegramUsername: username.trim().replace(/^@/, ""),
        bio: bio.trim(),
      });
      setName("");
      setUsername("");
      setBio("");
      setNotice(warning ?? "");
    } catch (err) {
      setFormError(visibleError(err));
    } finally {
      setBusy(false);
    }
  }

  async function refreshPhoto(teacher: TeacherCard) {
    if (!onRefreshPhoto || busy) return;
    setBusy(true);
    setFormError("");
    setNotice("");
    try {
      const warning = await onRefreshPhoto(teacher.id);
      setNotice(warning ?? "Фото обновлено из профиля Telegram");
    } catch (err) {
      setFormError(visibleError(err));
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    if (!onLeave || busy) return;
    if (!window.confirm("Удалить профиль из ленты? Карточка пропадёт на всех языках.")) return;
    setBusy(true);
    setFormError("");
    try {
      await onLeave();
    } catch (err) {
      setFormError(visibleError(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(teacher: TeacherCard) {
    if (!onDelete || busy) return;
    if (!window.confirm(`Удалить профиль ${teacher.name}?`)) return;
    setBusy(true);
    setFormError("");
    try {
      await onDelete(teacher.id);
    } catch (err) {
      setFormError(visibleError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="teachers-feed">
      <ScreenHeader
        className="teachers-top"
        backClassName="teachers-back"
        title="Преподаватели"
        onBack={onBack}
      />

      {ownProfile ? (
        <div className="card stack teacher-apply">
          <strong>Ваш профиль в ленте</strong>
          <p className="teachers-lead">Ученики видят карточку и могут написать вам в Telegram.</p>
          {formError ? <p className="teacher-form-error">{formError}</p> : null}
          <button type="button" className="ghost" disabled={busy} onClick={() => void leave()}>
            Удалить профиль
          </button>
        </div>
      ) : null}

      {listed ? null : (
        <TeacherApply
          teachLanguages={teachLanguages}
          telegramUserId={account?.telegramUserId ?? 0}
          telegramUsername={account?.telegramUsername ?? null}
        />
      )}

      {showStub ? (
        <div className="teachers-stub card stack">
          <div className="teachers-stub-avatar" aria-hidden>
            ?
          </div>
          <strong>{locked ? "Нужен полный доступ" : "Пока никого нет"}</strong>
          <p>
            {locked
              ? "Лента открывается с полным доступом. Можно написать преподавателю в Telegram."
              : "Когда появятся карточки, здесь будут фото, короткое описание и кнопка, чтобы написать."}
          </p>
          {locked && onOpenAccess ? (
            <button type="button" className="pay-pill" onClick={onOpenAccess}>
              Полный доступ
            </button>
          ) : null}
          <button type="button" className={locked ? "ghost" : "primary"} onClick={onBack}>
            ← На главную
          </button>
        </div>
      ) : (
        <>
          {admin ? (
            <form
              className="card stack teacher-admin"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <strong>Добавить преподавателя</strong>
              <p className="teachers-lead">
                Фото возьмём из профиля Telegram.
                {languageTitle ? ` Карточка попадёт в ленту «${languageTitle}».` : ""}
              </p>
              <input
                className="input"
                value={name}
                maxLength={80}
                placeholder="Имя"
                aria-label="Имя"
                autoComplete="off"
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
              <input
                className="input"
                value={username}
                maxLength={32}
                placeholder="Telegram, например anna_tutor"
                aria-label="Telegram"
                autoComplete="off"
                disabled={busy}
                onChange={(event) => setUsername(event.target.value)}
              />
              <textarea
                className="input"
                value={bio}
                maxLength={200}
                rows={3}
                placeholder="Коротко о себе, до 200 символов"
                aria-label="О себе"
                disabled={busy}
                onChange={(event) => setBio(event.target.value)}
              />
              {formError ? <p className="teacher-form-error">{formError}</p> : null}
              {notice ? <p className="teachers-lead">{notice}</p> : null}
              <button className="primary" type="submit" disabled={busy || !name.trim() || !username.trim()}>
                Добавить
              </button>
            </form>
          ) : null}
          {list.length === 0 ? (
            <p className="teachers-lead">Пока в ленте никого нет.</p>
          ) : (
            <>
              <p className="teachers-lead">Напиши тому, кто откликнется — порядок карточек каждый раз случайный.</p>
              <div className="teachers-list">
                {list.map((teacher) => (
                  <article key={teacher.id} className="teacher-card">
                    <div className="teacher-head">
                      {teacher.photoUrl ? (
                        <img
                          className="teacher-photo"
                          src={teacher.photoUrl}
                          alt={teacher.name}
                          width={64}
                          height={64}
                        />
                      ) : (
                        <div className="teacher-photo teacher-photo-fallback" aria-hidden>
                          {initials(teacher.name)}
                        </div>
                      )}
                      <div className="teacher-meta">
                        <strong>{teacher.name}</strong>
                        <span>@{teacher.telegramUsername}</span>
                      </div>
                    </div>
                    {teacher.bio ? <p className="teacher-bio">{teacher.bio}</p> : null}
                    <a
                      className="primary teacher-write"
                      href={`https://t.me/${teacher.telegramUsername}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Написать преподавателю
                    </a>
                    {admin ? (
                      <>
                        <button className="ghost teacher-delete" type="button" disabled={busy} onClick={() => void refreshPhoto(teacher)}>
                          Обновить фото
                        </button>
                        <button className="ghost teacher-delete" type="button" disabled={busy} onClick={() => void remove(teacher)}>
                          Удалить
                        </button>
                      </>
                    ) : null}
                  </article>
                ))}
              </div>
            </>
          )}
          {isInsideTelegram() ? null : (
            <button type="button" className="ghost teachers-back-bottom" onClick={onBack}>
              ← Назад
            </button>
          )}
        </>
      )}
    </div>
  );
}
