import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <h1>foryour.fans</h1>
      <p>
        An AT Protocol-native paid creator network. Your identity is a portable AT
        Protocol account (a DID) — not a username and password we own. Creators
        publish public posts through the open AT Protocol network, and offer
        paid subscription tiers for content that stays private to their
        subscribers.
      </p>
      <nav>
        <Link href="/login">Continue with AT Protocol</Link>
      </nav>
    </main>
  );
}
