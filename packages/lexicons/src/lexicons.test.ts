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
});
