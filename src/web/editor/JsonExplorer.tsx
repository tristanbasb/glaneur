import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

export type JsonPath = Array<string | number>;

export function pathToString(path: JsonPath): string {
  let out = '';
  for (const part of path) {
    if (typeof part === 'number') out += `[${part}]`;
    else if (/^[A-Za-z_$][\w$-]*$/.test(part)) out += out ? `.${part}` : part;
    else out += `["${part}"]`;
  }
  return out;
}

export function parsePath(path: string): JsonPath {
  const out: JsonPath = [];
  const re = /\["([^"]+)"\]|\[(\d+)\]|([^.[\]]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path))) {
    if (m[1] !== undefined) out.push(m[1]);
    else if (m[2] !== undefined) out.push(Number(m[2]));
    else out.push(m[3]);
  }
  return out;
}

function preview(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value.length > 120 ? `${value.slice(0, 120)}…` : value);
  return String(value);
}

interface NodeProps {
  name: string;
  value: unknown;
  path: JsonPath;
  depth: number;
  itemsPath: string;
  onUseList: (path: string) => void;
  onUseValue: (path: JsonPath) => void;
}

function JsonNode({ name, value, path, depth, itemsPath, onUseList, onUseValue }: NodeProps) {
  const pathString = pathToString(path);
  const onTheWay = !!itemsPath && (itemsPath === pathString || itemsPath.startsWith(pathString));
  const [open, setOpen] = useState(depth < 2 || onTheWay || (!!itemsPath && pathString.startsWith(`${itemsPath}[0]`)));

  if (!value || typeof value !== 'object') {
    return (
      <button type="button" className="json-leaf" onClick={() => onUseValue(path)} title={`Utiliser ${pathString}`}>
        <span className="json-key">{name}</span>
        <span className={`json-val json-${value === null ? 'null' : typeof value}`}>{preview(value)}</span>
      </button>
    );
  }

  const entries: Array<[string | number, unknown]> = Array.isArray(value) ? value.map((v, i) => [i, v]) : Object.entries(value);
  const listOfObjects = Array.isArray(value) && value.length > 0 && value.every((v) => v && typeof v === 'object' && !Array.isArray(v));
  const isItems = listOfObjects && pathString === itemsPath;

  return (
    <div className={`json-node ${isItems ? 'is-items' : ''}`}>
      <div className="json-row">
        <button type="button" className="json-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={open ? 'Replier' : 'Déplier'}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <span className="json-key">{name}</span>
        <span className="json-meta">{Array.isArray(value) ? `[${value.length}]` : `{${entries.length}}`}</span>
        {listOfObjects && (
          <button type="button" className="json-use" onClick={() => onUseList(pathString)}>
            {isItems ? 'Liste des articles' : 'Utiliser comme liste'}
          </button>
        )}
      </div>
      {open && (
        <div className="json-children">
          {entries.slice(0, 40).map(([key, child]) => (
            <JsonNode
              key={String(key)}
              name={typeof key === 'number' ? `[${key}]` : key}
              value={child}
              path={[...path, key]}
              depth={depth + 1}
              itemsPath={itemsPath}
              onUseList={onUseList}
              onUseValue={onUseValue}
            />
          ))}
          {entries.length > 40 && <p className="json-more">… {entries.length - 40} de plus</p>}
        </div>
      )}
    </div>
  );
}

export function JsonExplorer({ data, itemsPath, onUseList, onUseValue }: { data: unknown; itemsPath: string; onUseList: (path: string) => void; onUseValue: (path: JsonPath) => void }) {
  return (
    <div className="json-tree mono">
      <JsonNode name="racine" value={data} path={[]} depth={0} itemsPath={itemsPath} onUseList={onUseList} onUseValue={onUseValue} />
    </div>
  );
}
