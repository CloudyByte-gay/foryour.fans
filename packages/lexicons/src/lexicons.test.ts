import { cidForRawBytes } from "@atproto/lex";
import { describe, expect, it } from "vitest";
import { fans } from "./lexicons/index.js";
import { NSID } from "./nsids.js";

async function fakeImageBlob() {
  const bytes = new TextEncoder().encode("not a real image, just test bytes");
  const cid = await cidForRawBytes(bytes);
  return { $type: "blob" as const, ref: cid, mimeType: "image/png", size: bytes.length };
}

describe("fans.foryour.profile", () => {
  it("$nsid matches the centralized NSID constant", () => {
    expect(fans.foryour.profile.$nsid).toBe(NSID.profile);
  });

  it("validates a minimal record (every field optional)", () => {
    const result = fans.foryour.profile.$safeValidate({ $type: NSID.profile });
    expect(result.success).toBe(true);
  });

  it("validates a full record", () => {
    const result = fans.foryour.profile.$safeValidate({
      $type: NSID.profile,
      displayName: "Alice",
      bio: "Making things.",
      website: "https://alice.example",
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects a bio that exceeds maxGraphemes", () => {
    const result = fans.foryour.profile.$safeValidate({
      $type: NSID.profile,
      bio: "x".repeat(3000),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-URI website", () => {
    const result = fans.foryour.profile.$safeValidate({
      $type: NSID.profile,
      website: "not a url",
    });
    expect(result.success).toBe(false);
  });

  it("the generated Main type has no billing/payout-shaped fields to accidentally set", () => {
    // A compile-time guarantee, not a runtime one: AT records are an "open"
    // format (unknown properties round-trip rather than being rejected), so
    // the real backstop against smuggling billing data into a public AT
    // record is that our typed $build() helper's input type has no such
    // field to assign in the first place. If this next line ever stops
    // producing a type error, someone added a field like this to the
    // lexicon — see prompts/full.md's list of fields that must never enter
    // a public AT record.
    // @ts-expect-error -- stripeCustomerId is not a field of fans.foryour.profile
    fans.foryour.profile.$build({ displayName: "Alice", stripeCustomerId: "cus_should_not_exist" });
  });
});

describe("fans.foryour.tier", () => {
  const base = {
    $type: NSID.tier,
    name: "Supporter",
    monthlyPrice: 500,
    currency: "usd",
    createdAt: new Date().toISOString(),
  };

  it("$nsid matches the centralized NSID constant", () => {
    expect(fans.foryour.tier.$nsid).toBe(NSID.tier);
  });

  it("validates a record with all required fields", () => {
    expect(fans.foryour.tier.$safeValidate(base).success).toBe(true);
  });

  it("rejects a record missing a required field", () => {
    const { currency: _currency, ...withoutCurrency } = base;
    expect(fans.foryour.tier.$safeValidate(withoutCurrency).success).toBe(false);
  });

  it("rejects a negative monthlyPrice", () => {
    expect(fans.foryour.tier.$safeValidate({ ...base, monthlyPrice: -100 }).success).toBe(false);
  });

  it("rejects a currency code that isn't 3 characters", () => {
    expect(fans.foryour.tier.$safeValidate({ ...base, currency: "dollars" }).success).toBe(false);
  });
});

describe("fans.foryour.post", () => {
  it("$nsid matches the centralized NSID constant", () => {
    expect(fans.foryour.post.$nsid).toBe(NSID.post);
  });

  it("validates a text-only post", () => {
    const result = fans.foryour.post.$safeValidate({
      $type: NSID.post,
      text: "hello world",
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects a post missing createdAt", () => {
    const result = fans.foryour.post.$safeValidate({ $type: NSID.post, text: "hello" });
    expect(result.success).toBe(false);
  });

  it("validates a post with an image embed and self-labels", async () => {
    const result = fans.foryour.post.$safeValidate({
      $type: NSID.post,
      text: "look at this",
      createdAt: new Date().toISOString(),
      embed: {
        $type: NSID.embedImages,
        images: [
          {
            image: await fakeImageBlob(),
            alt: "a fake image",
          },
        ],
      },
      labels: {
        $type: "com.atproto.label.defs#selfLabels",
        values: [{ val: "nudity" }],
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects text longer than the maximum length", () => {
    const result = fans.foryour.post.$safeValidate({
      $type: NSID.post,
      text: "x".repeat(3001),
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });

  it("validates a public post carrying the new optional linkage/visibility fields", () => {
    const result = fans.foryour.post.$safeValidate({
      $type: NSID.post,
      text: "dual-published",
      visibility: "public",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      bskyUri: "at://did:plc:abc/app.bsky.feed.post/3kaa",
      bskyCid: "bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5uxgr37vhqtr7g5eyrku",
      canonicalUri: "at://did:plc:abc/fans.foryour.post/3kbb",
      sourceApp: "foryour.fans",
    });
    expect(result.success).toBe(true);
  });

  it("validates a gated post: empty text, encryptedBody, accessPolicy + media refs", () => {
    const result = fans.foryour.post.$safeValidate({
      $type: NSID.post,
      text: "",
      visibility: "tier",
      createdAt: new Date().toISOString(),
      accessPolicy: { uri: "at://did:plc:abc/fans.foryour.accessPolicy/3kcc" },
      encryptedBody: {
        algorithm: "AES-256-GCM",
        keyRef: "at://did:plc:abc/fans.foryour.post/3kdd",
        iv: "YmFzZTY0aXY=",
        ciphertext: "Y2lwaGVydGV4dA==",
      },
      media: [{ uri: "at://did:plc:abc/fans.foryour.media/3kee" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an encryptedBody missing its ciphertext", () => {
    const result = fans.foryour.post.$safeValidate({
      $type: NSID.post,
      text: "",
      visibility: "subscribers",
      createdAt: new Date().toISOString(),
      encryptedBody: { algorithm: "AES-256-GCM", keyRef: "k", iv: "iv" },
    });
    expect(result.success).toBe(false);
  });

  it("still has no billing-shaped field on the generated build input", () => {
    // @ts-expect-error -- stripeCustomerId is not a field of fans.foryour.post
    fans.foryour.post.$build({ text: "", createdAt: new Date().toISOString(), stripeCustomerId: "cus_x" });
  });
});

describe("fans.foryour.media", () => {
  async function fakeBlob() {
    const bytes = new TextEncoder().encode("bytes-on-the-creator-pds");
    const cid = await cidForRawBytes(bytes);
    return { $type: "blob" as const, ref: cid, mimeType: "image/jpeg", size: bytes.length };
  }

  it("$nsid matches the centralized NSID constant", () => {
    expect(fans.foryour.media.$nsid).toBe(NSID.media);
  });

  it("validates public (cleartext) media with no encryption metadata", async () => {
    const result = fans.foryour.media.$safeValidate({
      $type: NSID.media,
      blob: await fakeBlob(),
      mimeType: "image/jpeg",
      size: 24,
      width: 800,
      height: 600,
      alt: "a photo",
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("validates gated media with encryption metadata (and no key material in it)", async () => {
    const result = fans.foryour.media.$safeValidate({
      $type: NSID.media,
      blob: await fakeBlob(),
      mimeType: "video/mp4",
      size: 1024,
      duration: 12,
      createdAt: new Date().toISOString(),
      encryption: {
        algorithm: "AES-256-GCM",
        keyRef: "at://did:plc:abc/fans.foryour.media/3kff",
        iv: "YmFzZTY0aXY=",
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("fans.foryour.accessPolicy", () => {
  it("$nsid matches the centralized NSID constant", () => {
    expect(fans.foryour.accessPolicy.$nsid).toBe(NSID.accessPolicy);
  });

  it("validates a subscribers-audience policy", () => {
    const result = fans.foryour.accessPolicy.$safeValidate({
      $type: NSID.accessPolicy,
      audience: "subscribers",
      createdAt: new Date().toISOString(),
      keyGrant: { protocol: "foryour.fans/keygrant-v1", algorithm: "AES-256-GCM" },
    });
    expect(result.success).toBe(true);
  });

  it("validates a tier-audience policy referencing a tier by AT URI", () => {
    const result = fans.foryour.accessPolicy.$safeValidate({
      $type: NSID.accessPolicy,
      audience: "tier",
      minimumTier: { uri: "at://did:plc:abc/fans.foryour.tier/3kgg", rkey: "3kgg" },
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });
});

describe("fans.foryour.serviceConfig", () => {
  it("$nsid matches the centralized NSID constant", () => {
    expect(fans.foryour.serviceConfig.$nsid).toBe(NSID.serviceConfig);
  });

  it("validates a self record pointing at app + key-grant endpoints", () => {
    const result = fans.foryour.serviceConfig.$safeValidate({
      $type: NSID.serviceConfig,
      primaryAppEndpoint: "https://foryour.fans",
      compatibleAppEndpoints: ["https://other.example"],
      keyGrantEndpoint: "https://foryour.fans/api/content-keys/grant",
      entitlementIssuer: "did:web:foryour.fans",
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("has no subscriber/billing-shaped field on the generated build input", () => {
    // @ts-expect-error -- subscribers is not a field of fans.foryour.serviceConfig
    fans.foryour.serviceConfig.$build({ createdAt: new Date().toISOString(), subscribers: ["did:plc:x"] });
  });
});

describe("fans.foryour.like", () => {
  const base = {
    $type: NSID.like,
    subject: {
      uri: "at://did:plc:abc/fans.foryour.post/3kbb",
      cid: "bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5uxgr37vhqtr7g5eyrku",
    },
    createdAt: new Date().toISOString(),
  };

  it("$nsid matches the centralized NSID constant", () => {
    expect(fans.foryour.like.$nsid).toBe(NSID.like);
  });

  it("validates a like with a strong-ref subject", () => {
    expect(fans.foryour.like.$safeValidate(base).success).toBe(true);
  });

  it("rejects a like missing its subject", () => {
    const { subject: _subject, ...withoutSubject } = base;
    expect(fans.foryour.like.$safeValidate(withoutSubject).success).toBe(false);
  });

  it("rejects a subject missing its cid (strong ref, not a bare uri)", () => {
    expect(
      fans.foryour.like.$safeValidate({ ...base, subject: { uri: base.subject.uri } }).success,
    ).toBe(false);
  });

  it("rejects a non-AT-URI subject", () => {
    expect(
      fans.foryour.like.$safeValidate({ ...base, subject: { ...base.subject, uri: "https://example.com/x" } }).success,
    ).toBe(false);
  });

  it("rejects a like missing createdAt", () => {
    const { createdAt: _createdAt, ...withoutCreatedAt } = base;
    expect(fans.foryour.like.$safeValidate(withoutCreatedAt).success).toBe(false);
  });

  it("has no field for smuggling the liker's identity or a like target list", () => {
    // @ts-expect-error -- likerDid is not a field of fans.foryour.like (the liker is the repo owner)
    fans.foryour.like.$build({ subject: base.subject, createdAt: base.createdAt, likerDid: "did:plc:x" });
  });
});
