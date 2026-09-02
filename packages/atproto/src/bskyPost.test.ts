import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BSKY_POST_MAX_GRAPHEMES,
  BskyPostValidationError,
  bskyAppUrl,
  buildBskyPostRecord,
  buildExternalEmbed,
  buildImagesEmbed,
  graphemeLength,
  parseAtUri,
  parseFacets,
  utf8ByteLength,
  validateBskyPostRecord,
} from "./bskyPost.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vendoredPost: any = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../lexicons/vendor/app/bsky/feed/post.json", import.meta.url)),
    "utf8",
  ),
);

describe("vendored lexicon stays in sync with the validator", () => {
  it("matches text limits and required fields", () => {
    const record = vendoredPost.defs.main.record;
    expect(record.required).toEqual(["text", "createdAt"]);
    expect(record.properties.text.maxLength).toBe(3000);
    expect(record.properties.text.maxGraphemes).toBe(BSKY_POST_MAX_GRAPHEMES);
    expect(record.properties.langs.maxLength).toBe(3);
    expect(record.properties.tags.maxLength).toBe(8);
  });
});

describe("graphemeLength / utf8ByteLength", () => {
  it("counts user-perceived characters, not code units", () => {
    expect(graphemeLength("hello")).toBe(5);
    expect(graphemeLength("👩‍👩‍👧‍👦")).toBe(1); // one grapheme, many code points
    expect(graphemeLength("日本語")).toBe(3);
  });
  it("byte length is UTF-8", () => {
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("é")).toBe(2);
    expect(utf8ByteLength("😀")).toBe(4);
  });
});

describe("parseFacets", () => {
  it("detects a bare-domain and an https link with correct byte offsets", async () => {
    const text = "see example.com and https://foo.test/x";
    const facets = await parseFacets(text);
    const links = facets.filter((f) => f.features[0]!.$type === "app.bsky.richtext.facet#link");
    expect(links).toHaveLength(2);
    // "example.com" starts at byte 4
    expect(links[0]!.index.byteStart).toBe(4);
    expect(links[0]!.index.byteEnd).toBe(4 + "example.com".length);
    expect((links[0]!.features[0] as { uri: string }).uri).toBe("https://example.com");
    expect((links[1]!.features[0] as { uri: string }).uri).toBe("https://foo.test/x");
  });

  it("computes byte offsets past a multi-byte character", async () => {
    const text = "😀 https://foo.test";
    const [facet] = await parseFacets(text);
    // "😀 " is 4 + 1 = 5 bytes
    expect(facet!.index.byteStart).toBe(5);
    expect(facet!.index.byteEnd).toBe(5 + "https://foo.test".length);
  });

  it("resolves a mention to a DID and drops an unresolvable one", async () => {
    const resolveHandle = async (h: string) => (h === "alice.test" ? "did:plc:alice" : null);
    const facets = await parseFacets("hi @alice.test and @ghost.test", { resolveHandle });
    const mentions = facets.filter((f) => f.features[0]!.$type === "app.bsky.richtext.facet#mention");
    expect(mentions).toHaveLength(1);
    expect((mentions[0]!.features[0] as { did: string }).did).toBe("did:plc:alice");
  });

  it("detects hashtags without the # and caps/dedupes them", async () => {
    const facets = await parseFacets("#Art #art #photography #123 done");
    const tags = facets
      .filter((f) => f.features[0]!.$type === "app.bsky.richtext.facet#tag")
      .map((f) => (f.features[0] as { tag: string }).tag);
    expect(tags).toEqual(["Art", "photography"]); // #art deduped (case-insensitive), #123 numeric-only dropped
  });
});

describe("buildBskyPostRecord", () => {
  it("builds a minimal valid record", () => {
    const rec = buildBskyPostRecord({ text: "hello world", createdAt: new Date("2026-01-01T00:00:00Z") });
    expect(rec.$type).toBe("app.bsky.feed.post");
    expect(rec.text).toBe("hello world");
    expect(rec.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(rec.facets).toBeUndefined();
    validateBskyPostRecord(rec);
  });

  it("carries facets, langs, tags and self-labels", () => {
    const rec = buildBskyPostRecord({
      text: "x",
      createdAt: "2026-01-01T00:00:00.000Z",
      langs: ["en", "ja"],
      tags: ["art"],
      labels: ["porn"],
      facets: [{ index: { byteStart: 0, byteEnd: 1 }, features: [{ $type: "app.bsky.richtext.facet#tag", tag: "x" }] }],
    });
    expect(rec.langs).toEqual(["en", "ja"]);
    expect(rec.tags).toEqual(["art"]);
    expect(rec.labels).toEqual({
      $type: "com.atproto.label.defs#selfLabels",
      values: [{ val: "porn" }],
    });
    validateBskyPostRecord(rec);
  });

  it("rejects text over the grapheme limit", () => {
    expect(() =>
      buildBskyPostRecord({ text: "a".repeat(BSKY_POST_MAX_GRAPHEMES + 1), createdAt: new Date() }),
    ).toThrow(BskyPostValidationError);
  });

  it("rejects more than 3 langs", () => {
    expect(() => buildBskyPostRecord({ text: "x", createdAt: new Date(), langs: ["en", "ja", "fr", "de"] })).toThrow(
      BskyPostValidationError,
    );
  });
});

describe("validateBskyPostRecord", () => {
  it("rejects a deprecated entities field", () => {
    expect(() =>
      validateBskyPostRecord({ $type: "app.bsky.feed.post", text: "x", createdAt: new Date().toISOString(), entities: [] }),
    ).toThrow(/entities/);
  });
  it("rejects a bad createdAt", () => {
    expect(() => validateBskyPostRecord({ $type: "app.bsky.feed.post", text: "x", createdAt: "not-a-date" })).toThrow(
      BskyPostValidationError,
    );
  });
});

describe("embed builders", () => {
  const blob = { $type: "blob", ref: { $link: "bafyimg" }, mimeType: "image/jpeg", size: 1000 };
  it("builds an images embed and enforces the 2MB / count limits", () => {
    const embed = buildImagesEmbed([{ blob, mimeType: "image/jpeg", size: 1000, alt: "a cat" }]);
    expect(embed.$type).toBe("app.bsky.embed.images");
    expect((embed.images as unknown[]).length).toBe(1);
    expect(() => buildImagesEmbed([{ blob, mimeType: "image/jpeg", size: 3_000_000, alt: "big" }])).toThrow(
      BskyPostValidationError,
    );
    expect(() => buildImagesEmbed([])).toThrow(BskyPostValidationError);
  });
  it("builds an external embed", () => {
    const embed = buildExternalEmbed({ uri: "https://x.test", title: "T", description: "D" });
    expect(embed).toEqual({
      $type: "app.bsky.embed.external",
      external: { uri: "https://x.test", title: "T", description: "D" },
    });
  });
});

describe("AT URI helpers", () => {
  it("parses an AT URI", () => {
    expect(parseAtUri("at://did:plc:abc/app.bsky.feed.post/3k")).toEqual({
      did: "did:plc:abc",
      collection: "app.bsky.feed.post",
      rkey: "3k",
    });
    expect(parseAtUri("nope")).toBeNull();
  });
  it("builds a bsky.app permalink only for feed posts", () => {
    expect(bskyAppUrl("at://did:plc:abc/app.bsky.feed.post/3k", "alice.test")).toBe(
      "https://bsky.app/profile/alice.test/post/3k",
    );
    expect(bskyAppUrl("at://did:plc:abc/fans.foryour.post/3k")).toBeNull();
  });
});
