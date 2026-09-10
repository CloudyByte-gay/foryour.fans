import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LEXICON_AUTHORITY_DID, LEXICON_TXT_RECORD_NAMES } from "./authority.js";

/**
 * Non-negotiable Rule 1: the set of `_lexicon.*` TXT records is DERIVED from
 * `NSID` in `nsids.ts`. Terraform can't run TypeScript, so `dns.tf` carries a
 * literal list — and this test fails CI if that list drifts from
 * `LEXICON_TXT_RECORD_NAMES`. A new authority in `nsids.ts` must be added to
 * `dns.tf` before this goes green again.
 */
const DNS_TF = readFileSync(
  fileURLToPath(new URL("../../../infrastructure/gcp/terraform/dns.tf", import.meta.url)),
  "utf8",
);

describe("infrastructure/gcp/terraform/dns.tf ↔ nsids.ts", () => {
  it("declares exactly the _lexicon.* TXT record names the namespace requires", () => {
    const block = DNS_TF.match(/lexicon_authority_txt_names\s*=\s*\[([^\]]*)\]/);
    expect(block, "dns.tf has no lexicon_authority_txt_names list").not.toBeNull();
    const declared = [...block![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    expect(declared.slice().sort()).toEqual([...LEXICON_TXT_RECORD_NAMES].sort());
  });

  it("the TXT record content is a quoted did=<the authority DID>", () => {
    // Cloudflare's v5 provider needs the quotation marks inside `content`
    // (zone-file presentation form); see the comment in dns.tf.
    expect(DNS_TF).toMatch(/content\s*=\s*"\\"did=\$\{var\.lexicon_authority_did\}\\""/);
    const varDefault = readFileSync(
      fileURLToPath(new URL("../../../infrastructure/gcp/terraform/variables.tf", import.meta.url)),
      "utf8",
    ).match(/variable "lexicon_authority_did"[\s\S]*?default\s*=\s*"([^"]+)"/);
    expect(varDefault?.[1]).toBe(LEXICON_AUTHORITY_DID);
  });

  it("uses a short TTL (spec: don't cache _lexicon lookups for long)", () => {
    const resource = DNS_TF.match(/resource "cloudflare_dns_record" "lexicon_authority"[\s\S]*?\n}/);
    expect(resource?.[0]).toMatch(/ttl\s*=\s*300\b/);
    expect(resource?.[0]).toMatch(/proxied\s*=\s*false/);
  });
});
