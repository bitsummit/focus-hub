import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { type Session } from "../../shared/contracts";
import { BrandLogo } from "../components/BrandLogo";
import { BRAND_TAGLINE } from "../brand";
import { t as tr, translateError } from "../i18n";

export function LoginPage({
  read,
  onLogin,
}: {
  read: (path: string, init?: RequestInit) => Promise<any>;
  onLogin: (s: Session) => Promise<void>;
}) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="login-layout">
      <section className="login-story">
        <div className="login-brand-lockup">
          <BrandLogo size="large" />
          <p className="brand-tagline" lang="en">{BRAND_TAGLINE}</p>
        </div>
        <div className="login-story-copy">
          <h1 className="login-headline"><span>{tr("Tareas,")}</span><span>{tr("proyectos y")}</span><span>{tr("progreso.")}</span></h1>
          <p>{tr("Captura, organiza y consulta tu trabajo.")}<br />{tr("Tus tareas y su historial, en un solo lugar.")}</p>
        </div>
      </section>
      <section className="login-form">
        <div>
          <h2>{tr("Bienvenido de nuevo")}</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const challenge = await read("/api/session/challenge");
                const s = await read("/api/session", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "X-Login-CSRF": challenge.loginToken },
                  body: JSON.stringify({ email, password }),
                });
                await onLogin(s);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>{tr("Correo electrónico")}<input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>{tr("Contraseña")}<input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="error-text">
                {translateError(error)}
              </p>
            )}
            <button className="button primary" disabled={busy}>
              {busy ? tr("Entrando…") : tr("Entrar en mi espacio")}
              <ArrowUpRight size={17} />
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
