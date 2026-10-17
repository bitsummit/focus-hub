import { useEffect, useId, useRef, useState, type ComponentPropsWithoutRef } from "react";
import { createPortal } from "react-dom";
import type { Project } from "../../shared/contracts";
import { t } from "../i18n";
import "./project-select.css";

type Props = Omit<ComponentPropsWithoutRef<"select">, "value" | "onChange" | "children"> & {
  value: string | null;
  projects: Project[];
  taskTitle: string;
  onChange: (projectId: string | null) => unknown;
};

/** Choosing a project proposes a change; nothing changes until confirmed. */
export function ProjectSelect({ value, projects, taskTitle, onChange, ...props }: Props) {
  const [proposed, setProposed] = useState<string | null | undefined>(undefined);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const headingId = useId();
  const descriptionId = useId();
  const projectName = (id: string | null) => projects.find(project => project.id === id)?.name ?? t("Bandeja de entrada");
  useEffect(() => {
    if (proposed === undefined) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      selectRef.current?.focus({ preventScroll: true });
    };
  }, [proposed]);

  return <>
    <select {...props} ref={selectRef} value={value ?? ""} onChange={event => {
      const next = event.target.value || null;
      if (next !== value) setProposed(next);
    }}>
      <option value="">{t("Bandeja de entrada")}</option>
      {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
    </select>
    {proposed !== undefined && createPortal(<dialog ref={dialogRef} className="project-confirmation" role="alertdialog"
      aria-modal="true" aria-labelledby={headingId} aria-describedby={descriptionId}
      onKeyDown={event => event.stopPropagation()}
      onCancel={event => { event.preventDefault(); setProposed(undefined); }}>
      <h2 id={headingId}>{t("Cambiar proyecto")}</h2>
      <p id={descriptionId}>{t('¿Cambiar el proyecto de «{0}»?', taskTitle)}</p>
      <dl>
        <div><dt>{t("Proyecto actual")}</dt><dd>{projectName(value)}</dd></div>
        <div><dt>{t("Nuevo proyecto")}</dt><dd>{projectName(proposed)}</dd></div>
      </dl>
      <div className="project-confirmation-actions">
        <button type="button" className="button" autoFocus onClick={() => setProposed(undefined)}>{t("Cancelar")}</button>
        <button type="button" className="button primary" onClick={() => {
          const next = proposed;
          setProposed(undefined);
          onChange(next);
        }}>{t("Confirmar")}</button>
      </div>
    </dialog>, document.body)}
  </>;
}
