import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { UserRound, X } from "lucide-react";
import { useStore } from "./model";
type User = {
  id: string;
  email: string;
  role: "admin" | "analyst" | "viewer";
  active?: boolean;
};
type Session = { user: User | null; setup: boolean; required: boolean };
const Context = createContext<{ user: User | null; open: () => void }>({
  user: null,
  open: () => {},
});
export const useAccount = () => useContext(Context);
export function AccountButton() {
  const { open, user } = useAccount();
  const ar = useStore((s) => s.lang === "ar");
  return (
    <button
      onClick={open}
      aria-label={ar ? "الحساب" : "Account"}
      title={user?.email || (ar ? "الحساب" : "Account")}
    >
      <UserRound size={16} />
    </button>
  );
}
async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch("/api/" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok)
    throw Error(
      (await r.json().catch(() => ({}))).message ||
        "Account service unavailable",
    );
  return r.status === 204 ? null : r.json();
}
export function AccountShell({ children }: { children: ReactNode }) {
  const ar = useStore((s) => s.lang === "ar"),
    t = (en: string, a: string) => (ar ? a : en);
  const [session, setSession] = useState<Session | null>(null),
    [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [users, setUsers] = useState<User[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const load = () =>
    api("auth/session")
      .then(setSession)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  const visible = open || (!!session?.required && !session.user);
  useEffect(() => {
    if (visible && !dialog.current?.open) dialog.current?.showModal();
    else if (!visible && dialog.current?.open) dialog.current?.close();
  }, [visible]);
  useEffect(() => {
    setError("");
    if (visible && session?.user?.role === "admin")
      api("accounts")
        .then(setUsers)
        .catch((e) => setError(e.message));
  }, [visible, session?.user?.id]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    setError("");
    setBusy(true);
    try {
      if (session?.user) {
        await api("accounts", "POST", data);
        setUsers(await api("accounts"));
        form.reset();
      } else {
        await api(session?.setup ? "auth/setup" : "auth/login", "POST", data);
        form.reset();
        await load();
        setOpen(false);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!session)
    return (
      <div className="account-start" role="status">
        {error ? (
          <button onClick={load}>
            {t("Retry connection", "إعادة الاتصال")}
          </button>
        ) : (
          t("Connecting to GulfHazard…", "جارٍ الاتصال بمنصة الرصد…")
        )}
      </div>
    );
  return (
    <Context.Provider value={{ user: session.user, open: () => setOpen(true) }}>
      {(!session.required || session.user) && (
        <div className="account-app" key={session.user?.id || "public"}>
          {children}
        </div>
      )}
      <dialog
        ref={dialog}
        className="account-dialog"
        dir={ar ? "rtl" : "ltr"}
        onCancel={(e) => {
          if (session.required && !session.user) e.preventDefault();
          else setOpen(false);
        }}
      >
        <div className="between row">
          <h2>
            {session.user
              ? t("Account", "الحساب")
              : session.setup
                ? t(
                    "Create the first administrator",
                    "إنشاء حساب المسؤول الأول",
                  )
                : t("Sign in", "تسجيل الدخول")}
          </h2>
          {(!session.required || session.user) && (
            <button
              onClick={() => setOpen(false)}
              aria-label={t("Close", "إغلاق")}
            >
              <X size={17} />
            </button>
          )}
        </div>
        {session.user && (
          <p>
            {session.user.email} · {session.user.role}
          </p>
        )}
        {(!session.user || session.user.role === "admin") && (
          <form className="stack" onSubmit={submit}>
            {session.user && (
              <strong>{t("Create account", "إضافة حساب")}</strong>
            )}
            <label>
              {t("Email", "البريد الإلكتروني")}
              <input
                required
                name="email"
                type="email"
                autoComplete={session.user ? "off" : "username"}
              />
            </label>
            <label>
              {t("Password", "كلمة المرور")}
              <input
                required
                name="password"
                type="password"
                minLength={session.setup || session.user ? 12 : 1}
                maxLength={256}
                autoComplete={
                  session.setup || session.user
                    ? "new-password"
                    : "current-password"
                }
              />
            </label>
            {session.user && (
              <label>
                {t("Role", "الصلاحية")}
                <select name="role">
                  <option value="viewer">{t("Viewer", "مشاهد")}</option>
                  <option value="analyst">{t("Analyst", "محلل")}</option>
                  <option value="admin">{t("Administrator", "مسؤول")}</option>
                </select>
              </label>
            )}
            <button className="primary" disabled={busy}>
              {session.user || session.setup
                ? t("Create account", "إنشاء حساب")
                : t("Sign in", "دخول")}
            </button>
          </form>
        )}
        {session.user?.role === "admin" &&
          users
            .filter((u) => u.id !== session.user!.id)
            .map((u) => (
              <div className="listrow" key={u.id}>
                <span>{u.email}</span>
                <select
                  aria-label={t("Role", "الصلاحية") + " " + u.email}
                  value={u.active ? u.role : "disabled"}
                  onChange={async (e) => {
                    const value = e.target.value;
                    try {
                      await api("accounts/" + u.id, "PATCH", {
                        active: value !== "disabled",
                        role: value === "disabled" ? u.role : value,
                      });
                      setUsers(await api("accounts"));
                    } catch (err) {
                      setError((err as Error).message);
                    }
                  }}
                >
                  {["viewer", "analyst", "admin", "disabled"].map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </div>
            ))}
        {session.user && (
          <button
            onClick={async () => {
              try {
                await api("auth/logout", "POST", {});
                await load();
                setOpen(false);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            {t("Sign out", "تسجيل الخروج")}
          </button>
        )}
        {error && <p role="alert">{error}</p>}
      </dialog>
    </Context.Provider>
  );
}
