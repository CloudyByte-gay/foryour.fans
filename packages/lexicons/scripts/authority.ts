/**
 * Lexicon-authority publish / verify tooling for `fans.foryour.*`.
 *
 *   pnpm --filter @foryour-fans/lexicons authority <command> [flags]
 *
 * Commands:
 *   keygen            Print a fresh secp256k1 signing keypair (private hex +
 *                     did:key + publicKeyMultibase). The private half goes in
 *                     the deploy secret store as LEXICON_AUTHORITY_SIGNING_KEY;
 *                     the DID document update goes through review.
 *   regen             Rebuild packages/lexicons/authority/{did.json,
 *                     authority-repo.car,manifest.json} from the compiled
 *                     schemas + the signing key (LEXICON_AUTHORITY_SIGNING_KEY,
 *                     else the in-repo DEV key — clearly stamped as such).
 *   snapshot          Rewrite src/__fixtures__/published-schemas.json (the
 *                     back-compat golden) from the current schemas.
 *   dry-run           Print the record set + required _lexicon.* TXT records +
 *                     record CIDs. Writes nothing.
 *   check             Resolve every NSID over the real network the way an
 *                     external client would (@atproto/lex-resolver) and assert
 *                     the resolved schema deep-equals the local one. Also
 *                     re-verifies the committed CAR artifact (records + commit
 *                     signature). Non-zero exit on any drift / missing record /
 *                     missing-or-wrong TXT record.
 *                       --ci            don't fail if the authority DNS isn't
 *                                       live yet; still fail on artifact drift.
 *                       --did <did>     resolve against this DID instead of the
 *                                       production one (local testing).
 *
 * See docs/lexicon-authority.md.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveTxt } from "node:dns/promises";
import { Secp256k1Keypair, formatMultikey } from "@atproto/crypto";
import { LexResolver } from "@atproto/lex-resolver";
import {
  ALL_NSIDS,
  LEXICON_AUTHORITIES,
  LEXICON_AUTHORITY_DID,
  LEXICON_AUTHORITY_HOSTNAME,
  LEXICON_SCHEMA_COLLECTION,
  buildAllLexiconSchemaRecords,
  schemaRecordUri,
} from "../src/authority.js";
import {
  buildAuthorityRepo,
  multikeyToDidKey,
  readAuthorityRepo,
  verifyAuthorityRepoSig,
} from "../src/authorityRepo.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const AUTHORITY_DIR = `${ROOT}authority`;
const DID_JSON = `${AUTHORITY_DIR}/did.json`;
const CAR_FILE = `${AUTHORITY_DIR}/authority-repo.car`;
const MANIFEST = `${AUTHORITY_DIR}/manifest.json`;
const GENERATED_TS = `${ROOT}src/authorityArtifact.generated.ts`;
const GOLDEN = `${ROOT}src/__fixtures__/published-schemas.json`;

/**
 * DEV signing key — a fixed, intentionally-public throwaway. The committed
 * authority artifact is signed with this so CI and local integration tests have
 * a valid repo without a secret. `regen` with a real LEXICON_AUTHORITY_SIGNING_KEY
 * (runbook step 1) overwrites did.json + the CAR before any deploy.
 */
const DEV_PRIVATE_KEY_HEX = "d0".repeat(32);

function green(s: string) {
  return `\x1b[32m${s}\x1b[0m`;
}
function red(s: string) {
  return `\x1b[31m${s}\x1b[0m`;
}
function yellow(s: string) {
  return `\x1b[33m${s}\x1b[0m`;
}

async function importKeypair(hex: string): Promise<Secp256k1Keypair> {
  // Pass a plain Uint8Array, not the hex string: some @noble/curves versions
  // reject the Buffer/typed-array shape `@atproto/crypto`'s own hex path yields.
  const bytes = Uint8Array.from(Buffer.from(hex, "hex"));
  if (bytes.length !== 32) {
    throw new Error(`signing key must be 32 bytes of hex (got ${bytes.length})`);
  }
  return Secp256k1Keypair.import(bytes, { exportable: true });
}

async function loadSigningKey(): Promise<{ keypair: Secp256k1Keypair; provenance: "production" | "dev" }> {
  const fromEnv = process.env.LEXICON_AUTHORITY_SIGNING_KEY?.trim();
  if (fromEnv) {
    return { keypair: await importKeypair(fromEnv), provenance: "production" };
  }
  return { keypair: await importKeypair(DEV_PRIVATE_KEY_HEX), provenance: "dev" };
}

function didDocument(did: string, publicKeyMultibase: string, serviceEndpoint: string) {
  return {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/multikey/v1",
      "https://w3id.org/security/suites/secp256k1-2019/v1",
    ],
    id: did,
    verificationMethod: [
      {
        id: `${did}#atproto`,
        type: "Multikey",
        controller: did,
        publicKeyMultibase,
      },
    ],
    service: [
      {
        id: "#atproto_pds",
        type: "AtprotoPersonalDataServer",
        serviceEndpoint,
      },
    ],
  };
}

async function cmdKeygen(): Promise<void> {
  const dev = process.argv.includes("--dev");
  const keypair = dev ? await importKeypair(DEV_PRIVATE_KEY_HEX) : await Secp256k1Keypair.create({ exportable: true });
  const priv = Buffer.from(await keypair.export()).toString("hex");
  const multibase = formatMultikey(keypair.jwtAlg, keypair.publicKeyBytes());
  console.log(dev ? yellow("# DEV KEY (fixed, public — never production)") : "# NEW signing keypair");
  console.log(`LEXICON_AUTHORITY_SIGNING_KEY=${priv}`);
  console.log(`did:key                = ${keypair.did()}`);
  console.log(`publicKeyMultibase     = ${multibase}`);
  console.log("");
  console.log("Next: put LEXICON_AUTHORITY_SIGNING_KEY in the deploy secret store,");
  console.log("then `authority regen` and commit packages/lexicons/authority/*.");
}

async function cmdRegen(): Promise<void> {
  const didFlag = flagValue("--did") ?? LEXICON_AUTHORITY_DID;
  const serviceEndpoint = flagValue("--endpoint") ?? `https://${LEXICON_AUTHORITY_HOSTNAME}`;
  const { keypair, provenance } = await loadSigningKey();
  const multibase = formatMultikey(keypair.jwtAlg, keypair.publicKeyBytes());

  const repo = await buildAuthorityRepo({ keypair, did: didFlag });
  mkdirSync(AUTHORITY_DIR, { recursive: true });

  const doc = didDocument(didFlag, multibase, serviceEndpoint);
  writeFileSync(DID_JSON, JSON.stringify(doc, null, 2) + "\n");
  writeFileSync(CAR_FILE, repo.car);

  const manifest = {
    $comment:
      "Generated by `pnpm --filter @foryour-fans/lexicons authority regen`. Do not hand-edit. See docs/lexicon-authority.md.",
    did: repo.did,
    serviceEndpoint,
    collection: LEXICON_SCHEMA_COLLECTION,
    commitCid: repo.commitCid,
    rev: repo.rev,
    signingKey: {
      provenance,
      didKey: repo.signingDidKey,
      publicKeyMultibase: multibase,
      ...(provenance === "dev"
        ? { WARNING: "DEV key — rotate via `authority regen` with LEXICON_AUTHORITY_SIGNING_KEY before DNS cutover." }
        : {}),
    },
    nsids: ALL_NSIDS,
    txtRecords: LEXICON_AUTHORITIES.map((a) => ({ name: a.txtRecordName, value: `did=${repo.did}` })),
    records: repo.recordCids,
  };
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");

  // Embedded copy for `apps/web` to import — a generated .ts is guaranteed to
  // be in the Next bundle (standalone file-tracing can miss a runtime
  // readFileSync). The .json/.car files above stay committed as the
  // human-reviewable artifacts; `authorityArtifact.test.ts` asserts they match.
  const generated = `// GENERATED by \`pnpm --filter @foryour-fans/lexicons authority regen\`. Do not edit.
// The fans.foryour.* Lexicon authority: DID document, signed schema-repo CAR,
// per-NSID record bodies, and manifest — embedded so apps/web can serve them
// with no filesystem access (the source lexicon JSON isn't traced into the
// Next standalone bundle). See docs/lexicon-authority.md.
/* eslint-disable */
export const AUTHORITY_DID_DOCUMENT = ${JSON.stringify(doc, null, 2)} as const;

export const AUTHORITY_MANIFEST = ${JSON.stringify(manifest, null, 2)} as const;

/** NSID -> the exact \`com.atproto.lexicon.schema\` record body to serve. */
export const AUTHORITY_RECORDS: Record<string, {
  $type: "com.atproto.lexicon.schema";
  lexicon: 1;
  id: string;
  description?: string;
  defs: Record<string, unknown>;
}> = ${JSON.stringify(buildAllLexiconSchemaRecords(), null, 2)};

const AUTHORITY_CAR_BASE64 =
  "${Buffer.from(repo.car).toString("base64")}";

/** The signed \`com.atproto.lexicon.schema\` repo, as a CAR. */
export const AUTHORITY_CAR: Uint8Array = Uint8Array.from(
  typeof Buffer !== "undefined"
    ? Buffer.from(AUTHORITY_CAR_BASE64, "base64")
    : (atob(AUTHORITY_CAR_BASE64) as unknown as string).split("").map((c) => c.charCodeAt(0)),
);
`;
  writeFileSync(GENERATED_TS, generated);

  console.log(green("wrote"), DID_JSON.replace(ROOT, ""));
  console.log(green("wrote"), CAR_FILE.replace(ROOT, ""), `(${repo.car.byteLength} bytes)`);
  console.log(green("wrote"), MANIFEST.replace(ROOT, ""));
  console.log(green("wrote"), GENERATED_TS.replace(ROOT, ""));
  console.log("");
  console.log(`did            ${repo.did}`);
  console.log(`signing key    ${provenance === "dev" ? yellow("DEV (rotate before cutover)") : green("production")}`);
  console.log(`commit         ${repo.commitCid}`);
  console.log(`rev            ${repo.rev}`);
  for (const nsid of ALL_NSIDS) console.log(`  ${nsid.padEnd(28)} ${repo.recordCids[nsid]}`);
}

function cmdSnapshot(): void {
  const records = buildAllLexiconSchemaRecords();
  mkdirSync(fileURLToPath(new URL("../src/__fixtures__/", import.meta.url)), { recursive: true });
  writeFileSync(GOLDEN, JSON.stringify(records, null, 2) + "\n");
  console.log(green("wrote"), GOLDEN.replace(ROOT, ""), `(${Object.keys(records).length} NSIDs)`);
}

async function cmdDryRun(): Promise<void> {
  const { keypair } = await loadSigningKey();
  const repo = await buildAuthorityRepo({ keypair });
  console.log("# Required DNS TXT records (not hierarchical — each authority needs its own):");
  for (const a of LEXICON_AUTHORITIES) {
    console.log(`  ${a.txtRecordName}\tTXT\t"did=${LEXICON_AUTHORITY_DID}"   (${a.nsids.join(", ")})`);
  }
  console.log("");
  console.log(`# ${ALL_NSIDS.length} schema records at at://${LEXICON_AUTHORITY_DID}/${LEXICON_SCHEMA_COLLECTION}/<nsid>:`);
  for (const nsid of ALL_NSIDS) {
    console.log(`  ${nsid.padEnd(28)} cid=${repo.recordCids[nsid]}`);
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

async function verifyCommittedArtifact(): Promise<string[]> {
  const errors: string[] = [];
  let car: Uint8Array;
  let manifest: Record<string, unknown>;
  let doc: Record<string, unknown>;
  try {
    car = new Uint8Array(readFileSync(CAR_FILE));
    manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
    doc = JSON.parse(readFileSync(DID_JSON, "utf8"));
  } catch (err) {
    return [`cannot read committed authority artifact: ${(err as Error).message} — run \`authority regen\``];
  }

  const vm = (doc.verificationMethod as Array<Record<string, string>> | undefined)?.find((m) =>
    m.id?.endsWith("#atproto"),
  );
  if (!vm?.publicKeyMultibase) {
    errors.push("did.json has no #atproto verificationMethod with publicKeyMultibase");
    return errors;
  }
  const didKey = multikeyToDidKey(vm.publicKeyMultibase);

  try {
    await verifyAuthorityRepoSig(car, didKey);
  } catch (err) {
    errors.push(`committed CAR signature does not verify: ${(err as Error).message}`);
  }

  const read = await readAuthorityRepo(car);
  const built = buildAllLexiconSchemaRecords();
  for (const nsid of ALL_NSIDS) {
    const got = read.records[nsid];
    if (!got) {
      errors.push(`committed CAR is missing a record for ${nsid}`);
      continue;
    }
    if (!deepEqual(got.record, built[nsid])) {
      errors.push(`committed CAR record for ${nsid} does not match the compiled schema — run \`authority regen\``);
    }
    const manifestCid = (manifest.records as Record<string, string> | undefined)?.[nsid];
    if (manifestCid && manifestCid !== got.cid) {
      errors.push(`manifest.json cid for ${nsid} (${manifestCid}) != CAR cid (${got.cid}) — run \`authority regen\``);
    }
  }
  for (const nsid of Object.keys(read.records)) {
    if (!ALL_NSIDS.includes(nsid)) errors.push(`committed CAR has an unexpected record: ${nsid}`);
  }
  if (read.did !== (manifest.did ?? LEXICON_AUTHORITY_DID)) {
    errors.push(`committed CAR did (${read.did}) != manifest did (${String(manifest.did)})`);
  }
  return errors;
}

async function cmdCheck(): Promise<void> {
  const ci = process.argv.includes("--ci");
  const did = flagValue("--did") ?? LEXICON_AUTHORITY_DID;
  let failed = false;

  console.log("== committed artifact ==");
  const artifactErrors = await verifyCommittedArtifact();
  if (artifactErrors.length) {
    failed = true;
    for (const e of artifactErrors) console.log(red("  ✗ " + e));
  } else {
    console.log(green(`  ✓ ${ALL_NSIDS.length} records match the compiled schemas; commit signature verifies`));
  }

  console.log("");
  console.log(`== live DNS + resolution (${did}) ==`);
  let dnsLive = true;
  for (const a of LEXICON_AUTHORITIES) {
    try {
      const txt = (await resolveTxt(a.txtRecordName)).map((c) => c.join("")).filter((l) => l.startsWith("did="));
      if (txt.length !== 1) {
        dnsLive = false;
        console.log(red(`  ✗ ${a.txtRecordName}: expected exactly one did= record, got ${txt.length}`));
      } else if (txt[0] !== `did=${did}`) {
        dnsLive = false;
        console.log(red(`  ✗ ${a.txtRecordName}: ${txt[0]} != did=${did}`));
      } else {
        console.log(green(`  ✓ ${a.txtRecordName} -> ${txt[0]}`));
      }
    } catch (err) {
      dnsLive = false;
      console.log((ci ? yellow : red)(`  ${ci ? "–" : "✗"} ${a.txtRecordName}: ${(err as Error).message}`));
    }
  }

  if (!dnsLive) {
    if (ci) {
      console.log(yellow("\n  authority DNS is not live yet — skipping network resolution (--ci)."));
      process.exit(failed ? 1 : 0);
    }
    console.log(red("\n  authority DNS is not live — cannot resolve. See docs/lexicon-authority.md §8."));
    process.exit(1);
  }

  const resolver = new LexResolver({});
  const built = buildAllLexiconSchemaRecords();
  for (const nsid of ALL_NSIDS) {
    try {
      const { lexicon, uri } = await resolver.get(nsid);
      const expectedUri = schemaRecordUri(nsid, did);
      if (uri.toString() !== expectedUri) {
        failed = true;
        console.log(red(`  ✗ ${nsid}: resolved to ${uri.toString()} != ${expectedUri}`));
        continue;
      }
      const resolvedRecord = { $type: LEXICON_SCHEMA_COLLECTION, ...lexicon };
      if (!deepEqual(resolvedRecord, built[nsid])) {
        failed = true;
        console.log(red(`  ✗ ${nsid}: resolved schema differs from the local compiled schema`));
      } else {
        console.log(green(`  ✓ ${nsid} resolves and deep-equals the local schema`));
      }
    } catch (err) {
      failed = true;
      console.log(red(`  ✗ ${nsid}: ${(err as Error).message}`));
    }
  }

  process.exit(failed ? 1 : 0);
}

function flagValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case "keygen":
      return cmdKeygen();
    case "regen":
      return cmdRegen();
    case "snapshot":
      return cmdSnapshot();
    case "dry-run":
      return cmdDryRun();
    case "check":
      return cmdCheck();
    default:
      console.error(`unknown command: ${cmd ?? "(none)"}\n`);
      console.error("commands: keygen | regen | snapshot | dry-run | check");
      process.exit(2);
  }
}

void main();
