"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  DIVIDER_HTML,
  FONT_FAMILIES,
  FONT_SIZES,
  SNIPPETS,
  buttonHtml,
  isSafeImageSource,
  isSafeLinkTarget,
  spacerHtml,
  tableHtml,
} from "@/components/admin/email/snippets";

export interface RichTextHandle {
  insertText: (text: string) => void;
  focus: () => void;
}

type Panel = "link" | "image" | "table" | "button" | "snippets" | null;

const btn =
  "inline-flex h-8 min-w-8 items-center justify-center rounded border border-transparent px-2 text-sm text-neutral-700 hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gray-900 disabled:opacity-40";
const sel = "h-8 rounded border border-neutral-300 bg-white px-1.5 text-xs";
const field = "rounded-md border border-gray-300 px-2 py-1.5 text-sm";

/**
 * WYSIWYG email body editor built on the browser's native editing support (no extra
 * dependency). Output is plain inline-styled HTML; the server re-sanitizes it on every
 * preview, save and send, so nothing produced here is trusted.
 */
export const RichTextEditor = forwardRef<
  RichTextHandle,
  {
    value: string;
    onChange: (html: string) => void;
    onFocusEditor?: () => void;
    disabled?: boolean;
  }
>(function RichTextEditor({ value, onChange, onFocusEditor, disabled }, ref) {
  const editor = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string>("");
  const savedRange = useRef<Range | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [color, setColor] = useState("#111827");

  // Keep the DOM in sync when the value changes from outside (HTML tab, reload, restore).
  useEffect(() => {
    const el = editor.current;
    if (el && value !== lastEmitted.current) {
      el.innerHTML = value;
      lastEmitted.current = value;
    }
  }, [value]);

  const emit = useCallback(() => {
    const el = editor.current;
    if (!el) return;
    const html = el.innerHTML;
    lastEmitted.current = html;
    onChange(html);
  }, [onChange]);

  // Remember the caret/selection so toolbar clicks and panels can restore it.
  useEffect(() => {
    const onSelection = () => {
      const sel = window.getSelection();
      const el = editor.current;
      if (sel && sel.rangeCount && el && el.contains(sel.anchorNode)) {
        savedRange.current = sel.getRangeAt(0).cloneRange();
      }
    };
    document.addEventListener("selectionchange", onSelection);
    return () => document.removeEventListener("selectionchange", onSelection);
  }, []);

  const restore = useCallback(() => {
    const el = editor.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (sel && savedRange.current) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
  }, []);

  const exec = useCallback(
    (command: string, arg?: string) => {
      restore();
      document.execCommand("styleWithCSS", false, "true");
      document.execCommand(command, false, arg);
      emit();
    },
    [emit, restore]
  );

  const insertHtml = useCallback(
    (html: string) => {
      restore();
      document.execCommand("insertHTML", false, html);
      emit();
    },
    [emit, restore]
  );

  useImperativeHandle(ref, () => ({
    insertText: (text: string) => {
      restore();
      document.execCommand("insertText", false, text);
      emit();
    },
    focus: () => restore(),
  }));

  const selectionHtml = () => {
    const range = savedRange.current;
    if (!range || range.collapsed) return "";
    const div = document.createElement("div");
    div.appendChild(range.cloneContents());
    return div.innerHTML;
  };

  // Font size/family aren't expressible with execCommand without legacy <font> tags,
  // so wrap the selection in a styled span instead.
  const wrapSelection = (style: string) => {
    const html = selectionHtml();
    if (!html) return;
    insertHtml(`<span style="${style}">${html}</span>`);
  };

  const closePanel = () => {
    setPanel(null);
    setPanelError(null);
  };

  const keep = (e: React.MouseEvent) => e.preventDefault(); // don't steal the editor selection

  const Btn = ({ label, onClick, children, active }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean }) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onMouseDown={keep}
      onClick={onClick}
      className={`${btn} ${active ? "bg-neutral-200" : ""}`}
    >
      {children}
    </button>
  );

  return (
    <div className="rounded-lg border border-neutral-300 bg-white">
      <style>{`.rte-content table td,.rte-content table th{outline:1px dashed #e4e4e7;outline-offset:-1px}.rte-content img{max-width:100%;height:auto}.rte-content:focus{outline:none}`}</style>

      <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5 border-b border-neutral-200 p-1.5">
        <Btn label="Undo" onClick={() => exec("undo")}>↶</Btn>
        <Btn label="Redo" onClick={() => exec("redo")}>↷</Btn>
        <span className="mx-1 h-5 w-px bg-neutral-200" />
        <select aria-label="Paragraph style" disabled={disabled} className={sel} defaultValue="p" onChange={(e) => { exec("formatBlock", e.target.value); e.target.value = "p"; }}>
          <option value="p">Paragraph</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
        </select>
        <select aria-label="Font family" disabled={disabled} className={sel} defaultValue="" onChange={(e) => { if (e.target.value) wrapSelection(`font-family:${e.target.value}`); e.target.value = ""; }}>
          <option value="">Font</option>
          {FONT_FAMILIES.map((f) => <option key={f} value={f}>{f.split(",")[0].replace(/'/g, "")}</option>)}
        </select>
        <select aria-label="Font size" disabled={disabled} className={sel} defaultValue="" onChange={(e) => { if (e.target.value) wrapSelection(`font-size:${e.target.value}px`); e.target.value = ""; }}>
          <option value="">Size</option>
          {FONT_SIZES.map((s) => <option key={s} value={s}>{s}px</option>)}
        </select>
        <span className="mx-1 h-5 w-px bg-neutral-200" />
        <Btn label="Bold" onClick={() => exec("bold")}><strong>B</strong></Btn>
        <Btn label="Italic" onClick={() => exec("italic")}><em>I</em></Btn>
        <Btn label="Underline" onClick={() => exec("underline")}><u>U</u></Btn>
        <label className={`${btn} cursor-pointer gap-1`} title="Text colour" onMouseDown={keep}>
          <span aria-hidden style={{ borderBottom: `3px solid ${color}` }}>A</span>
          <input
            type="color"
            aria-label="Text colour"
            disabled={disabled}
            value={color}
            onChange={(e) => { setColor(e.target.value); exec("foreColor", e.target.value); }}
            className="sr-only"
          />
        </label>
        <span className="mx-1 h-5 w-px bg-neutral-200" />
        <Btn label="Align left" onClick={() => exec("justifyLeft")}>⇤</Btn>
        <Btn label="Align centre" onClick={() => exec("justifyCenter")}>↔</Btn>
        <Btn label="Align right" onClick={() => exec("justifyRight")}>⇥</Btn>
        <Btn label="Bulleted list" onClick={() => exec("insertUnorderedList")}>• List</Btn>
        <Btn label="Numbered list" onClick={() => exec("insertOrderedList")}>1. List</Btn>
        <span className="mx-1 h-5 w-px bg-neutral-200" />
        <Btn label="Insert link" active={panel === "link"} onClick={() => { setPanelError(null); setPanel(panel === "link" ? null : "link"); }}>Link</Btn>
        <Btn label="Insert image" active={panel === "image"} onClick={() => { setPanelError(null); setPanel(panel === "image" ? null : "image"); }}>Image</Btn>
        <Btn label="Insert table" active={panel === "table"} onClick={() => setPanel(panel === "table" ? null : "table")}>Table</Btn>
        <Btn label="Insert button" active={panel === "button"} onClick={() => { setPanelError(null); setPanel(panel === "button" ? null : "button"); }}>Button</Btn>
        <Btn label="Insert divider" onClick={() => insertHtml(DIVIDER_HTML)}>―</Btn>
        <select aria-label="Insert spacing" disabled={disabled} className={sel} defaultValue="" onChange={(e) => { if (e.target.value) insertHtml(spacerHtml(Number(e.target.value))); e.target.value = ""; }}>
          <option value="">Spacing</option>
          {[8, 16, 24, 32, 48].map((n) => <option key={n} value={n}>{n}px space</option>)}
        </select>
        <select aria-label="Padding around selection" disabled={disabled} className={sel} defaultValue="" onChange={(e) => { const html = selectionHtml(); if (e.target.value && html) insertHtml(`<div style="padding:${e.target.value}px;">${html}</div>`); e.target.value = ""; }}>
          <option value="">Padding</option>
          {[8, 16, 24, 32].map((n) => <option key={n} value={n}>{n}px padding</option>)}
        </select>
        <Btn label="Reusable components" active={panel === "snippets"} onClick={() => setPanel(panel === "snippets" ? null : "snippets")}>Components ▾</Btn>
        <Btn label="Clear formatting" onClick={() => exec("removeFormat")}>Clear</Btn>
      </div>

      {panel && (
        <div className="flex flex-wrap items-end gap-3 border-b border-neutral-200 bg-neutral-50 p-3 text-sm">
          {panel === "link" && <LinkPanel onApply={(url, text) => {
            if (!isSafeLinkTarget(url)) return setPanelError("Use a full https:// link, mailto:, tel: or a {{variable}}.");
            if (selectionHtml()) exec("createLink", url);
            else insertHtml(`<a href="${url.replace(/"/g, "&quot;")}">${(text || url).replace(/</g, "&lt;")}</a>`);
            closePanel();
          }} />}
          {panel === "image" && <ImagePanel onApply={(src, alt) => {
            if (!isSafeImageSource(src)) return setPanelError("Image URLs must start with https:// (or be a {{variable}}).");
            insertHtml(`<img src="${src.replace(/"/g, "&quot;")}" alt="${alt.replace(/"/g, "&quot;")}" style="max-width:100%;height:auto;">`);
            closePanel();
          }} />}
          {panel === "table" && <TablePanel onApply={(r, c, h) => { insertHtml(tableHtml(r, c, h)); closePanel(); }} />}
          {panel === "button" && <ButtonPanel onApply={(label, href, colour) => {
            if (!label.trim()) return setPanelError("Enter the button text.");
            if (!isSafeLinkTarget(href)) return setPanelError("Use a full https:// link, mailto:, tel: or a {{variable}}.");
            insertHtml(buttonHtml(label.trim(), href.trim(), colour));
            closePanel();
          }} />}
          {panel === "snippets" && (
            <div className="flex flex-wrap gap-2">
              {SNIPPETS.map((s) => (
                <button key={s.id} type="button" onMouseDown={keep} onClick={() => { insertHtml(s.html); closePanel(); }} title={s.description} className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-neutral-100">
                  {s.label}
                </button>
              ))}
            </div>
          )}
          <button type="button" onClick={closePanel} className="ml-auto text-xs text-neutral-500 underline">Close</button>
          {panelError && <p role="alert" className="w-full text-xs text-red-600">{panelError}</p>}
        </div>
      )}

      <div
        ref={editor}
        role="textbox"
        aria-multiline="true"
        aria-label="Email content"
        contentEditable={!disabled}
        suppressContentEditableWarning
        spellCheck
        onInput={emit}
        onBlur={emit}
        onFocus={onFocusEditor}
        onPaste={(e) => {
          // Paste as plain text: avoids importing arbitrary styles, scripts or Office markup.
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, text);
          emit();
        }}
        onDrop={(e) => e.preventDefault()}
        className="rte-content min-h-[320px] max-h-[640px] overflow-auto p-4 text-base leading-6 text-neutral-900"
        style={{ fontFamily: "Arial, Helvetica, sans-serif" }}
      />
    </div>
  );
});

function LinkPanel({ onApply }: { onApply: (url: string, text: string) => void }) {
  const [url, setUrl] = useState("https://");
  const [text, setText] = useState("");
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); onApply(url, text); }}>
      <label className="flex flex-col gap-1 text-xs font-medium">Link URL<input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} className={`${field} w-72`} /></label>
      <label className="flex flex-col gap-1 text-xs font-medium">Text (if nothing is selected)<input value={text} onChange={(e) => setText(e.target.value)} className={`${field} w-48`} /></label>
      <button className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white">Apply</button>
    </form>
  );
}

function ImagePanel({ onApply }: { onApply: (src: string, alt: string) => void }) {
  const [src, setSrc] = useState("https://");
  const [alt, setAlt] = useState("");
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); onApply(src, alt); }}>
      <label className="flex flex-col gap-1 text-xs font-medium">Image URL (https)<input autoFocus value={src} onChange={(e) => setSrc(e.target.value)} className={`${field} w-72`} /></label>
      <label className="flex flex-col gap-1 text-xs font-medium">Alt text<input value={alt} onChange={(e) => setAlt(e.target.value)} className={`${field} w-48`} /></label>
      <button className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white">Insert</button>
    </form>
  );
}

function TablePanel({ onApply }: { onApply: (rows: number, cols: number, header: boolean) => void }) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [header, setHeader] = useState(true);
  const num = (v: string) => Math.min(10, Math.max(1, Number(v) || 1));
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); onApply(rows, cols, header); }}>
      <label className="flex flex-col gap-1 text-xs font-medium">Rows<input type="number" min={1} max={10} value={rows} onChange={(e) => setRows(num(e.target.value))} className={`${field} w-20`} /></label>
      <label className="flex flex-col gap-1 text-xs font-medium">Columns<input type="number" min={1} max={10} value={cols} onChange={(e) => setCols(num(e.target.value))} className={`${field} w-20`} /></label>
      <label className="flex items-center gap-1.5 pb-2 text-xs"><input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} />Header row</label>
      <button className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white">Insert table</button>
    </form>
  );
}

function ButtonPanel({ onApply }: { onApply: (label: string, href: string, colour: string) => void }) {
  const [label, setLabel] = useState("View details");
  const [href, setHref] = useState("https://");
  const [colour, setColour] = useState("#111827");
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); onApply(label, href, colour); }}>
      <label className="flex flex-col gap-1 text-xs font-medium">Button text<input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} className={`${field} w-44`} /></label>
      <label className="flex flex-col gap-1 text-xs font-medium">Link URL<input value={href} onChange={(e) => setHref(e.target.value)} className={`${field} w-64`} /></label>
      <label className="flex flex-col gap-1 text-xs font-medium">Colour<input type="color" value={colour} onChange={(e) => setColour(e.target.value)} className="h-8 w-12 rounded border border-gray-300" /></label>
      <button className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white">Insert button</button>
    </form>
  );
}
