import { useEffect, useState } from "react";
import { ArrowDown, Check, CheckCircle2, Inbox, Leaf, Settings } from "lucide-react";
import { t as tr, locale, translateError } from "../i18n";
import { type WorkspaceProps } from "../app/types";
import { PageHeading, PanelTitle } from "../components/WorkspaceUI";

export function SettingsPage({
  read,
  ...props
}: WorkspaceProps & { read: (path: string, init?: RequestInit) => Promise<any> }) {
  const { data, mutate } = props,
    [name, setName] = useState(data.user.display_name),
    [timezone, setTimezone] = useState(data.user.timezone),
    [theme, setTheme] = useState(data.user.theme),
    [language, setSelectedLanguage] = useState(data.user.language),
    [view, setView] = useState(data.user.preferred_task_view),
    [week, setWeek] = useState(data.user.week_start_day),
    [success, setSuccess] = useState(""),
    [error, setError] = useState(""),
    [preview, setPreview] = useState("");
  useEffect(() => { setSelectedLanguage(data.user.language); }, [data.user.language]);
  const download = async (format: string) => {
    try {
      setError("");
      const response = await fetch("/api/export?format=" + format, {
        credentials: "same-origin",
      });
      if (!response.ok)
        throw new Error("No se ha podido exportar. Inténtalo de nuevo.");
      const blob = await response.blob(),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = `focus-hub-${props.today}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      setSuccess("Exportación descargada.");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <PageHeading
        title={tr("Configuración")}
        subtitle={tr("Preferencias y exportación de datos.")}
      />
      <div className="settings-grid">
        <section className="panel">
          <PanelTitle
            icon={Settings}
            title={tr("Mi espacio")}
            subtitle={tr("Preferencias personales y calendario.")}
          />
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                Intl.DateTimeFormat(locale(), { timeZone: timezone });
                if (
                  await mutate("/api/preferences", "PATCH", {
                    display_name: name,
                    language,
                    timezone,
                    theme,
                    preferred_task_view: view,
                    week_start_day: week,
                  })
                ) {
                  setSuccess("Preferencias guardadas.");
                  setError("");
                }
              } catch {
                setError(
                  "Introduce una zona IANA válida, por ejemplo Europe/Madrid.",
                );
              }
            }}
          >
            <label>{tr("Nombre")}<input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>{tr("Zona horaria IANA")}<input
                required
                list="timezones"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              />
              <datalist id="timezones">
                {[
                  "Europe/Madrid",
                  "Atlantic/Canary",
                  "Europe/London",
                  "America/Mexico_City",
                  "America/Bogota",
                  "America/Argentina/Buenos_Aires",
                  "UTC",
                ].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </datalist>
              <small>{tr("Los días y semanas se calculan en esta zona.")}</small>
            </label>
            <div className="form-grid">
              <label>{tr("Idioma")}<select value={language} onChange={(e) => setSelectedLanguage(e.target.value as typeof language)}>
                  <option value="es">{tr("Español")}</option>
                  <option value="en">{tr("English")}</option>
                </select>
              </label>
              <label>{tr("Apariencia")}<select
                  value={theme}
                  onChange={(e) => setTheme(e.target.value as typeof theme)}
                >
                  <option value="light">{tr("Clara")}</option>
                  <option value="dark">{tr("Oscura")}</option>
                  <option value="system">{tr("Seguir al sistema")}</option>
                </select>
              </label>
              <label>{tr("Vista de tareas")}<select
                  value={view}
                  onChange={(e) => setView(e.target.value as typeof view)}
                >
                  <option value="board">{tr("Kanban")}</option>
                  <option value="table">{tr("Tabla")}</option>
                </select>
              </label>
              <label>{tr("La semana empieza en")}<select
                  value={week}
                  onChange={(e) => setWeek(Number(e.target.value))}
                >
                  <option value={1}>{tr("Lunes")}</option>
                  <option value={0}>{tr("Domingo")}</option>
                </select>
              </label>
            </div>
            <button className="button primary" disabled={props.busy}>{tr("Guardar preferencias")}<Check size={16} />
            </button>
          </form>
        </section>
        <div>
          <section className="panel">
            <PanelTitle
              icon={Inbox}
              title={tr("Exportar datos")}
              subtitle={tr("Descarga archivos de tu espacio, cuando quieras.")}
            />
            <p className="settings-copy">{tr("El JSON conserva identificadores, proyectos, objetivos, hitos, tareas, eventos, bloques de diario y focos. Incluye versión de esquema para facilitar futuras migraciones.")}</p>
            <div className="export-options">
              <button className="button" onClick={() => download("json")}>
                <ArrowDown size={16} />{tr("Exportar todo · JSON")}</button>
              <button className="button" onClick={() => download("csv")}>
                <ArrowDown size={16} />{tr("Exportar tareas · CSV")}</button>
            </div>
            <div className="import-preview">
              <h3>{tr("Validar una exportación")}</h3>
              <p>{tr("Solo lectura. No importa ni modifica datos.")}</p>
              <label className="button file-button">{tr("Seleccionar JSON")}<input
                  type="file"
                  accept="application/json,.json"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const json = JSON.parse(await file.text());
                      const required = [
                        "tasks",
                        "projects",
                        "goals",
                        "milestones",
                        "events",
                        "journals",
                        "blocks",
                        "focus",
                      ];
                      const root = json.data ?? json;
                      const aliases: Record<string, string[]> = {
                        events: ["events", "task_events"],
                        journals: ["journals", "journal_entries"],
                        blocks: ["blocks", "journal_blocks"],
                        focus: ["focus", "focus_items"],
                      };
                      const missing = required.filter(
                        (k) =>
                          !(aliases[k] ?? [k]).some((name) =>
                            Array.isArray(root[name]),
                          ),
                      );
                      setPreview(
                        missing.length
                          ? `Estructura incompleta: faltan ${missing.join(", ")}.`
                          : "JSON válido: colecciones principales presentes. La importación futura también deberá validar referencias e integridad.",
                      );
                    } catch {
                      setPreview("El archivo no contiene JSON válido.");
                    }
                  }}
                />
              </label>
              {preview && <p role="status">{translateError(preview)}</p>}
            </div>
          </section>
          <section className="panel privacy-panel">
            <Leaf size={21} />
            <h3>{tr("Privado por diseño.")}</h3>
            <p>{tr("Sin conexión a Notion. Sin datos públicos. Las operaciones se limitan a tu espacio autenticado.")}</p>
            <p>{tr("Para eliminar una tarea, abre su detalle y confirma la eliminación. Archivar un proyecto conserva su historia.")}</p>
          </section>
        </div>
      </div>
      {success && (
        <div className="success-message" role="status">
          <CheckCircle2 size={17} />
          {tr(success)}
        </div>
      )}
      {error && (
        <div role="alert" className="error-text">
          {translateError(error)}
        </div>
      )}
    </>
  );
}
