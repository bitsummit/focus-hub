import { useEffect, useRef, useState, type FormEvent } from "react";
import { PRIORITIES, priorityLabels, type CaptureInput, type Priority, type Project } from "../../shared/contracts";
import { t } from "../i18n";
import "./quick-capture.css";

export interface MobileQuickCaptureProps {
  open: boolean;
  onClose: () => void;
  projects: Project[];
  onCapture: (input: CaptureInput) => Promise<boolean>;
}

/** A small, modal capture flow; tasks remain authoritative in the parent API state. */
export function MobileQuickCapture({ open, onClose, projects, onCapture }: MobileQuickCaptureProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef(false);
  const requestRef = useRef<{ signature: string; input: CaptureInput } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  // Empty means automatic normal priority, allowing ! / !! shorthand to work.
  const [priority, setPriority] = useState<Priority | "">("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<{ projectName: string | null } | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    const viewport = window.visualViewport;
    const sizeForKeyboard = () => {
      dialog.style.setProperty("--v11-capture-height", `${viewport?.height ?? window.innerHeight}px`);
      dialog.style.setProperty("--v11-capture-inset", `${Math.max(0, window.innerHeight - (viewport?.height ?? window.innerHeight) - (viewport?.offsetTop ?? 0))}px`);
    };
    sizeForKeyboard();
    viewport?.addEventListener("resize", sizeForKeyboard);
    viewport?.addEventListener("scroll", sizeForKeyboard);
    dialog.showModal();
    titleRef.current?.focus({ preventScroll: true });
    return () => {
      viewport?.removeEventListener("resize", sizeForKeyboard);
      viewport?.removeEventListener("scroll", sizeForKeyboard);
      dialog.close();
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
      opener?.focus({ preventScroll: true });
    };
  }, [open]);

  function changed() {
    requestRef.current = null;
    setError("");
    setFeedback(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current || !title.trim()) return;
    const closeAfterSave = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("data-close") === "true";
    const values = { text: title.trim(), project_id: projectId || null, ...(priority ? { priority } : {}) };
    const signature = JSON.stringify(values);
    if (!requestRef.current || requestRef.current.signature !== signature) {
      requestRef.current = { signature, input: { ...values, request_id: crypto.randomUUID() } };
    }
    pendingRef.current = true;
    setPending(true);
    setError("");
    setFeedback(null);
    try {
      const saved = await onCapture(requestRef.current.input);
      if (!saved) {
        setError("No se pudo guardar. Conservamos el texto; vuelve a intentarlo.");
        return;
      }
      requestRef.current = null;
      setTitle("");
      setFeedback({ projectName: projects.find((project) => project.id === projectId)?.name ?? null });
      if (closeAfterSave) closeRef.current();
    } catch {
      setError("No se pudo guardar. Comprueba la conexión y vuelve a intentarlo.");
    } finally {
      pendingRef.current = false;
      setPending(false);
      titleRef.current?.focus({ preventScroll: true });
    }
  }

  function close() {
    if (!pendingRef.current) closeRef.current();
  }

  return (
    <dialog
      ref={dialogRef}
      className="v11-capture-sheet"
      aria-labelledby="v11-capture-heading"
      onCancel={(event) => { event.preventDefault(); close(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
      }}
    >
      <header className="v11-capture-heading">
        <h2 id="v11-capture-heading">{t("Captura rápida")}</h2>
        <button type="button" aria-label={t("Cerrar captura rápida")} disabled={pending} onClick={close}>×</button>
      </header>
      <form onSubmit={submit} aria-busy={pending}>
        <label className="v11-capture-title-label" htmlFor="v11-capture-title">{t("Título de la tarea")}</label>
        <input
          ref={titleRef}
          id="v11-capture-title"
          placeholder={t("¿Qué necesitas hacer?")}
          value={title}
          required
          maxLength={500}
          autoComplete="off"
          readOnly={pending}
          enterKeyHint="done"
          onChange={(event) => { changed(); setTitle(event.target.value); }}
        />
        <div className="v11-capture-options">
          <label htmlFor="v11-capture-project">{t("Proyecto")}
            <select id="v11-capture-project" value={projectId} disabled={pending} onChange={(event) => { changed(); setProjectId(event.target.value); }}>
              <option value="">{t("Bandeja de entrada")}</option>
              {projects.filter((project) => project.status !== "archived").map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          <label htmlFor="v11-capture-priority">{t("Prioridad")}
            <select id="v11-capture-priority" value={priority} disabled={pending} onChange={(event) => { changed(); setPriority(event.target.value as Priority | ""); }}>
              <option value="">{t("Normal · ! / !!")}</option>
              {PRIORITIES.map((value) => <option key={value} value={value}>{t(priorityLabels[value])}</option>)}
            </select>
          </label>
        </div>
        <div className="v11-capture-message">
          {error && <p role="alert">{t(error)}</p>}
          <p className="capture-feedback" role="status" aria-live="polite">{feedback && <>{t("Tarea guardada en ")}{feedback.projectName ?? t("Bandeja de entrada")}{"."}</>}</p>
        </div>
        <footer className="v11-capture-actions">
          <button type="submit" className="v11-capture-primary" disabled={pending || !title.trim()}>{t(pending ? "Guardando…" : "Guardar y seguir")}</button>
          <button type="submit" data-close="true" disabled={pending || !title.trim()}>{t("Guardar y cerrar")}</button>
        </footer>
      </form>
    </dialog>
  );
}
