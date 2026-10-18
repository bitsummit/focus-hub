import React, { useRef, useState } from "react";
import { BookOpen, Check, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { type JournalBlock } from "../../shared/contracts";
import { t as tr, locale } from "../i18n";
import { type WorkspaceProps } from "../app/types";
import { niceDate } from "../lib/dates";
import { requestId } from "../lib/tasks";
import { PageHeading, Empty, TaskLine, PeriodNav } from "../components/WorkspaceUI";

export function JournalFeed({ page, onPage, onDate, ...props }: WorkspaceProps & {
  page:number; onPage:(page:number)=>void; onDate:(date:string)=>void;
}) {
  const {data}=props;
  const [search,setSearch]=useState("");
  const tasks=new Map(data.tasks.map(task=>[task.id,task]));
  const blocksByEntry=new Map<string,JournalBlock[]>();
  for(const block of data.blocks){
    const group=blocksByEntry.get(block.journal_entry_id) ?? [];
    group.push(block);blocksByEntry.set(block.journal_entry_id,group);
  }
  for(const blocks of blocksByEntry.values())blocks.sort((a,b)=>a.sort_order-b.sort_order);
  const needle=search.trim().toLocaleLowerCase(locale());
  const entries=data.journals.filter(entry=>!needle ||
    [entry.entry_date,entry.title,...(blocksByEntry.get(entry.id) ?? []).map(block=>
      block.block_type==='task_reference' ? tasks.get(block.task_id ?? '')?.title ?? '' : block.text_content
    )].join(' ').toLocaleLowerCase(locale()).includes(needle)
  ).sort((a,b)=>b.entry_date.localeCompare(a.entry_date));
  const pages=Math.max(1,Math.ceil(entries.length/15));
  const current=Math.min(page,pages);
  const visible=entries.slice((current-1)*15,current*15);
  return <>
    <PageHeading title={tr("Diario")} subtitle={tr("Tus entradas, de la más reciente a la más antigua.")}
      action={<div className="journal-feed-actions">
        <input type="date" aria-label={tr("Fecha del diario")} value=""
          onChange={event=>event.target.value && onDate(event.target.value)} />
        <button className="button primary" onClick={()=>onDate(props.today)}><Plus size={16}/>{tr("Nueva entrada")}</button>
      </div>} />
    <div className="journal-feed-toolbar">
      <input type="search" aria-label={tr("Buscar entradas del diario")} placeholder={tr("Buscar en el diario…")}
        value={search} onChange={event=>{setSearch(event.target.value);if(page!==1)onPage(1);}} />
      <span className="muted">{tr("{0} entradas",entries.length)}</span>
    </div>
    <section className="journal-feed" aria-label={tr("Entradas del diario")}>
      {visible.map(entry=>{
        const blocks=blocksByEntry.get(entry.id) ?? [];
        return <article className="journal-paper journal-feed-entry" key={entry.id}
          data-entry-date={entry.entry_date} aria-labelledby={'journal-entry-'+entry.id}>
          <header className="journal-feed-heading">
            <div><h2 id={'journal-entry-'+entry.id}><time dateTime={entry.entry_date}>{niceDate(entry.entry_date)}</time></h2></div>
            <div className="journal-feed-actions"><button className="text-button"
              aria-label={tr("Abrir entrada {0}",entry.entry_date)} onClick={()=>onDate(entry.entry_date)}>
              {tr("Abrir entrada")}<ChevronRight size={16}/></button></div>
          </header>
          <div className="journal-blocks">{blocks.map(block=><JournalBlockView key={block.id}
            block={block} revision={entry.revision} {...props}/>)}
            {!blocks.length && <p className="muted">{tr("Entrada sin contenido.")}</p>}
          </div>
        </article>;
      })}
      {!visible.length && <Empty title={tr(needle ? "Ninguna entrada coincide con la búsqueda" : "No hay entradas de diario")}
        text={tr(needle ? "Prueba con otra búsqueda." : "Abre una fecha y guarda una nota o tarea para crear tu primera entrada.")}
        icon={BookOpen}/>}
    </section>
    {pages>1 && <nav className="journal-pagination" aria-label={tr("Paginación del diario")}>
      <button className="button" aria-label={tr("Página anterior")} disabled={current===1}
        onClick={()=>onPage(current-1)}><ChevronLeft size={16}/>{tr("Anterior")}</button>
      <span role="status" aria-live="polite">{tr("Página {0} de {1}",current,pages)}</span>
      <button className="button" aria-label={tr("Página siguiente")} disabled={current===pages}
        onClick={()=>onPage(current+1)}>{tr("Siguiente")}<ChevronRight size={16}/></button>
    </nav>}
  </>;
}

export function JournalPage({
  date,
  onDate,
  ...props
}: WorkspaceProps & { date: string; onDate: (date: string) => void }) {
  const { data, mutate } = props;
  const entry = data.journals.find((j) => j.entry_date === date),
    blocks = data.blocks
      .filter((b) => b.journal_entry_id === entry?.id)
      .sort((a, b) => a.sort_order - b.sort_order),
    [text, setText] = useState(""),
    [indent, setIndent] = useState(0),
    [search, setSearch] = useState(""),
    [request, setRequest] = useState(requestId());
  const pendingAppend = useRef<{
    key: string;
    payload: {
      text: string;
      indent_level: number;
      revision: number;
      request_id: string;
    };
  } | null>(null);
  const append = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const key = JSON.stringify([date, text, indent]);
    if (pendingAppend.current?.key !== key)
      pendingAppend.current = {
        key,
        payload: {
          text,
          indent_level: indent,
          revision: entry?.revision ?? 0,
          request_id: request,
        },
      };
    if (
      await mutate(
        "/api/journals/" + date + "/blocks",
        "POST",
        pendingAppend.current.payload,
      )
    ) {
      pendingAppend.current = null;
      setText("");
      setRequest(requestId());
    }
  };
  return (
    <>
      <PageHeading
        title={tr("Diario")}
        subtitle={tr("Notas y tareas vinculadas por día.")}
        action={
          <div className="journal-date">
            <PeriodNav date={date} onChange={onDate} />
            <input
              type="date"
              aria-label={tr("Fecha del diario")}
              value={date}
              onChange={(e) => e.target.value && onDate(e.target.value)}
            />
          </div>
        }
      />
      <div className="journal-layout">
        <section className="journal-paper">
          <div className="journal-paper-header">
            <span className="eyebrow">
              {date === props.today ? tr("HOY") : tr("TU DIARIO")}
            </span>
            <h2>
              {new Intl.DateTimeFormat(locale(), {
                weekday: "long",
                day: "numeric",
                month: "long",
                timeZone: "UTC",
              }).format(new Date(date + "T12:00:00Z"))}
            </h2>
            <span>
              {blocks.length}{tr(" bloques ·")}{" "}
              {entry ? tr("Guardado en tu espacio") : tr("Sin entrada guardada")}
            </span>
          </div>
          <div className="journal-blocks">
            {blocks.map((block) => (
              <JournalBlockView
                key={block.id}
                block={block}
                revision={entry?.revision ?? 0}
                {...props}
              />
            ))}
            {!blocks.length && (
              <div className="journal-prompt">
                <p>{tr("Sin bloques en esta fecha.")}</p>
                <span>{tr("Escribe una nota o una tarea en el campo inferior.")}</span>
              </div>
            )}
          </div>
          <form className="journal-compose" onSubmit={append}>
            <textarea
              aria-label={tr("Escribir en el diario")}
              rows={3}
              placeholder={
                tr("Escribe una nota…\n- [ ] Una tarea · # Un encabezado")
              }
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setRequest(requestId());
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="journal-compose-tools">
              <select
                aria-label={tr("Indentación del bloque")}
                value={indent}
                onChange={(e) => setIndent(Number(e.target.value))}
              >
                <option value={0}>{tr("Nivel principal")}</option>
                <option value={1}>{tr("↳ Subtarea / indentado")}</option>
              </select>
              <span>{tr("Enter para guardar · Mayús+Enter para salto")}</span>
              <button
                className="button primary"
                disabled={!text.trim() || props.busy}
              >{tr("Añadir")}<Plus size={16} />
              </button>
            </div>
          </form>
        </section>
        <aside className="journal-aside">
          <div className="panel journal-tips">
            <BookOpen size={22} />
            <h3>{tr("Escribe a tu manera.")}</h3>
            <p>{tr("Las notas siguen siendo notas. Las tareas se conectan con todo tu espacio.")}</p>
            <dl>
              <dt>{tr("Una tarea")}</dt>
              <dd>
                <code>{tr("- [ ] Preparar propuesta")}</code>
              </dd>
              <dt>{tr("Prioridad rápida")}</dt>
              <dd>
                <code>{tr("! Alta · !! Crítica")}</code>
              </dd>
              <dt>{tr("Contexto de proyecto")}</dt>
              <dd>
                <code>{tr("# Nombre del proyecto")}</code>
                <span>{tr("Un encabezado existente da contexto a las siguientes tareas.")}</span>
              </dd>
              <dt>{tr("Proyecto en una línea")}</dt>
              <dd>
                <code>{tr("- [ ] Revisar #proyecto")}</code>
              </dd>
              <dt>{tr("Subtarea")}</dt>
              <dd>{tr("Selecciona el nivel indentado después de una tarea.")}</dd>
            </dl>
          </div>
          <div className="panel">
            <h3>{tr("Otros días")}</h3>
            <input
              aria-label={tr("Buscar días del diario")}
              placeholder={tr("Buscar en el diario…")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="journal-days">
              {data.journals
                .filter(
                  (j) =>
                    !search ||
                    j.entry_date.includes(search) ||
                    data.blocks.some(
                      (b) =>
                        b.journal_entry_id === j.id &&
                        b.text_content
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                    ),
                )
                .sort((a, b) => b.entry_date.localeCompare(a.entry_date))
                .slice(0, 15)
                .map((j) => (
                  <button
                    key={j.id}
                    className={j.entry_date === date ? "selected" : ""}
                    onClick={() => onDate(j.entry_date)}
                  >
                    {niceDate(j.entry_date)}
                    <ChevronRight size={14} />
                  </button>
                ))}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

function JournalBlockView({
  block,
  revision,
  ...props
}: WorkspaceProps & { block: JournalBlock; revision: number }) {
  const { data, mutate } = props;
  const [editing, setEditing] = useState(false),
    [text, setText] = useState(block.text_content),
    [editRevision, setEditRevision] = useState(revision);
  const task = data.tasks.find((t) => t.id === block.task_id);
  return (
    <div
      className={"journal-block block-" + block.block_type}
      style={{ marginLeft: block.indent_level * 25 }}
    >
      {block.block_type === "task_reference" ? (
        task && !task.deleted_at ? (
          <TaskLine task={task} {...props} />
        ) : (
          <span className="muted">{tr("Referencia a una tarea eliminada")}</span>
        )
      ) : editing ? (
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await mutate("/api/blocks/" + block.id, "PATCH", {
                revision: editRevision,
                text_content: text,
              })
            )
              setEditing(false);
          }}
        >
          <input
            autoFocus
            aria-label={tr("Editar bloque")}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button className="icon-button" aria-label={tr("Guardar bloque")}>
            <Check size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={tr("Cancelar edición")}
            onClick={() => setEditing(false)}
          >
            <X size={16} />
          </button>
        </form>
      ) : (
        <button
          className="block-text"
          onClick={() => {
            setText(block.text_content);
            setEditRevision(revision);
            setEditing(true);
          }}
        >
          {block.block_type === "bullet" && <span>• </span>}
          {block.text_content}
        </button>
      )}
      <button
        className="block-delete"
        aria-label={tr("Quitar bloque del diario")}
        title={tr("Quitar mención (conserva la tarea)")}
        onClick={() => {
          if (
            confirm(
              tr("¿Quitar este bloque del diario? Las tareas vinculadas se conservan."),
            )
          )
            mutate("/api/blocks/" + block.id, "DELETE", { revision });
        }}
      >
        <X size={13} />
      </button>
    </div>
  );
}
