// A real, schema-aware Cypher editor for the graph view -- syntax highlighting,
// bracket matching, and ANTLR-grammar-backed autocomplete (labels, relationship
// types, property keys, keywords) from Neo4j's own official CodeMirror 6
// integration. Not a hand-rolled textarea: `createCypherEditor` is the same
// engine that powers Neo4j Browser's own query bar.
import { useEffect, useRef } from 'react'
import { createCypherEditor, type EditorApi } from '@neo4j-cypher/codemirror'
import { keymap } from '@codemirror/view'
import '@neo4j-cypher/codemirror/css/cypher-codemirror.css'

// Orbit's actual schema (matches ask.ts's SCHEMA_PROMPT and every MERGE this
// codebase writes) -- this is what makes the hints "type-aware" rather than
// generic Cypher keyword completion.
export const ORBIT_CYPHER_SCHEMA = {
  labels: ['Venue', 'Contact', 'Source', 'Sequence'],
  relationshipTypes: ['WORKS_AT', 'VERIFIED_BY', 'ENROLLED_IN', 'TARGETS'],
  propertyKeys: [
    'venue_id', 'contact_id', 'sequence_id', 'name', 'category', 'district',
    'title', 'role', 'verified', 'status', 'website', 'email', 'phone',
    'vertical_id', 'apps', 'last_shipped', 'linkedin_url', 'linkedin_industry',
    'linkedin_location', 'imported_at', 'updated_at', 'lead_json',
  ],
}

export default function CypherEditor({
  value, onChange, onRun, theme, placeholder, readOnly,
}: {
  value: string
  onChange: (v: string) => void
  onRun: () => void
  theme: 'light' | 'dark'
  placeholder?: string
  readOnly?: boolean
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<EditorApi | null>(null)
  // Keep the run handler current without tearing down the editor on every
  // parent re-render -- the keymap extension is only wired once, at mount.
  const onRunRef = useRef(onRun)
  onRunRef.current = onRun

  useEffect(() => {
    if (!hostRef.current) return
    const api = createCypherEditor(hostRef.current, {
      value,
      schema: ORBIT_CYPHER_SCHEMA,
      theme,
      placeholder,
      readOnly,
      lineNumbers: false,
      lineWrapping: true,
      history: true,
      autocompleteTriggerStrings: ['.', ':', '(', '$'],
      postExtensions: [
        keymap.of([{ key: 'Mod-Enter', run: () => { onRunRef.current(); return true } }]),
      ],
    })
    apiRef.current = api
    const off = api.onValueChanged(v => onChange(v))
    return () => { off(); api.destroy() }
    // Mount once; value/theme/readOnly are pushed via imperative setters below
    // so typing doesn't get fought by a controlled-value re-render loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { apiRef.current?.setTheme(theme) }, [theme])
  useEffect(() => { apiRef.current?.setReadOnly(readOnly ?? false) }, [readOnly])
  // External writes (e.g. "load this generated Cypher into the editor") --
  // skip when the value already matches what's onscreen, so typing doesn't
  // get clobbered by its own onChange round-trip.
  useEffect(() => {
    if (apiRef.current && value !== apiRef.current.codemirror.state.doc.toString()) {
      apiRef.current.setValue(value)
    }
  }, [value])

  return <div ref={hostRef} className="cypher-editor-host" />
}
