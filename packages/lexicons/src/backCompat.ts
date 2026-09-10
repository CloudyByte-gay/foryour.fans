/**
 * Structural backward-compatibility check for published `fans.foryour.*`
 * schemas.
 *
 * Non-negotiable Rule 5 (`prompts/lexicon-authority.md`): once a schema is
 * published — and especially once a third party could have adopted it — changes
 * must be backward compatible. New fields optional, no field removed, no
 * type/name change on an existing field. A breaking change requires a NEW NSID,
 * not an edit.
 *
 * `compareToGolden()` diffs the current `com.atproto.lexicon.schema` record
 * bodies against a committed golden snapshot
 * (`src/__fixtures__/published-schemas.json`) and classifies every difference.
 * `authority.test.ts`'s "back-compat guard" fails on any `breaking` entry (its
 * message points here) and on any `additive` entry not yet folded into the
 * snapshot (regenerate with
 * `pnpm --filter @foryour-fans/lexicons authority:snapshot`).
 */

export type SchemaChangeKind = "breaking" | "additive" | "benign";

export interface SchemaChange {
  kind: SchemaChangeKind;
  /** Dotted path into the record, e.g. `defs.main.record.properties.text.maxLength`. */
  path: string;
  detail: string;
}

type Json = unknown;

function isObject(v: Json): v is Record<string, Json> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function typeName(v: Json): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/**
 * `required` arrays: adding an entry is breaking (old data without it is now
 * invalid); removing one is additive (a field became optional).
 */
function classifyRequiredArray(oldReq: Json, newReq: Json, path: string, out: SchemaChange[]): void {
  const oldList = Array.isArray(oldReq) ? (oldReq as string[]) : [];
  const newList = Array.isArray(newReq) ? (newReq as string[]) : [];
  for (const name of newList) {
    if (!oldList.includes(name)) {
      out.push({
        kind: "breaking",
        path: `${path}[${JSON.stringify(name)}]`,
        detail: `field "${name}" became required — old data without it is now invalid`,
      });
    }
  }
  for (const name of oldList) {
    if (!newList.includes(name)) {
      out.push({
        kind: "additive",
        path: `${path}[${JSON.stringify(name)}]`,
        detail: `field "${name}" is no longer required`,
      });
    }
  }
}

const LOOSENING_MAX_KEYS = new Set(["maxLength", "maxGraphemes", "maxSize", "maxItems", "maximum"]);
const TIGHTENING_MIN_KEYS = new Set(["minLength", "minGraphemes", "minimum", "minItems"]);
const IDENTITY_KEYS = new Set(["type", "format", "ref"]);

function walk(oldNode: Json, newNode: Json, path: string, out: SchemaChange[]): void {
  if (isObject(oldNode) && isObject(newNode)) {
    const parentIsProperties = path === "properties" || path.endsWith(".properties");
    for (const key of new Set([...Object.keys(oldNode), ...Object.keys(newNode)])) {
      const childPath = path ? `${path}.${key}` : key;
      const inOld = key in oldNode;
      const inNew = key in newNode;

      if (key === "required" && (Array.isArray(oldNode[key]) || Array.isArray(newNode[key]))) {
        classifyRequiredArray(oldNode[key], newNode[key], childPath, out);
        continue;
      }
      if (inOld && !inNew) {
        out.push({
          kind: "breaking",
          path: childPath,
          detail: parentIsProperties
            ? `property "${key}" was removed — breaking (Rule 5: a breaking change needs a new NSID)`
            : `schema node "${key}" was removed`,
        });
        continue;
      }
      if (!inOld && inNew) {
        out.push({
          kind: "additive",
          path: childPath,
          detail: parentIsProperties ? `new property "${key}" added` : `new schema node "${key}" added`,
        });
        continue;
      }
      walk(oldNode[key], newNode[key], childPath, out);
    }
    return;
  }

  if (typeName(oldNode) !== typeName(newNode)) {
    out.push({
      kind: "breaking",
      path,
      detail: `type changed ${typeName(oldNode)} → ${typeName(newNode)}`,
    });
    return;
  }

  if (Array.isArray(oldNode) && Array.isArray(newNode)) {
    if (JSON.stringify(oldNode) !== JSON.stringify(newNode)) {
      // knownValues / accept / enum lists. The protocol treats knownValues as
      // non-exhaustive, so flag benign and let a human read the diff.
      out.push({
        kind: "benign",
        path,
        detail: `array changed ${JSON.stringify(oldNode)} → ${JSON.stringify(newNode)}`,
      });
    }
    return;
  }

  if (oldNode === newNode) return;

  const key = path.split(".").pop() ?? "";
  let kind: SchemaChangeKind = "benign";
  if (IDENTITY_KEYS.has(key)) {
    kind = "breaking";
  } else if (
    LOOSENING_MAX_KEYS.has(key) &&
    typeof oldNode === "number" &&
    typeof newNode === "number" &&
    newNode < oldNode
  ) {
    kind = "breaking"; // tightening an upper bound invalidates previously-valid data
  } else if (
    TIGHTENING_MIN_KEYS.has(key) &&
    typeof oldNode === "number" &&
    typeof newNode === "number" &&
    newNode > oldNode
  ) {
    kind = "breaking"; // raising a lower bound invalidates previously-valid data
  }
  out.push({ kind, path, detail: `value changed ${JSON.stringify(oldNode)} → ${JSON.stringify(newNode)}` });
}

/** Diff two schema record bodies and classify every change. Empty = identical. */
export function classifyLexiconSchemaChange(oldRecord: Json, newRecord: Json): SchemaChange[] {
  const out: SchemaChange[] = [];
  walk(oldRecord, newRecord, "", out);
  return out;
}

export interface BackCompatReport {
  removedNsids: string[];
  addedNsids: string[];
  changes: Record<string, SchemaChange[]>;
  breaking: Array<{ nsid: string; change: SchemaChange }>;
  additive: Array<{ nsid: string; change: SchemaChange }>;
}

export function compareToGolden(
  golden: Record<string, Json>,
  current: Record<string, Json>,
): BackCompatReport {
  const removedNsids = Object.keys(golden).filter((n) => !(n in current));
  const addedNsids = Object.keys(current).filter((n) => !(n in golden));
  const changes: Record<string, SchemaChange[]> = {};
  const breaking: BackCompatReport["breaking"] = [];
  const additive: BackCompatReport["additive"] = [];

  for (const nsid of Object.keys(golden)) {
    if (!(nsid in current)) continue;
    const diff = classifyLexiconSchemaChange(golden[nsid], current[nsid]);
    if (diff.length) changes[nsid] = diff;
    for (const change of diff) {
      if (change.kind === "breaking") breaking.push({ nsid, change });
      else if (change.kind === "additive") additive.push({ nsid, change });
    }
  }

  return { removedNsids, addedNsids, changes, breaking, additive };
}
