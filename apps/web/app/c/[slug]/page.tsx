import { notFound } from "next/navigation";
import { fetchApi } from "../../../lib/serverApi";

interface PublicCreator {
  did: string;
  slug: string;
  displayName: string | null;
  bio: string | null;
  website: string | null;
  createdAt: string;
}

export default async function CreatorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const response = await fetchApi(`/creators/${encodeURIComponent(slug)}`);
  if (response.status === 404) {
    notFound();
  }
  if (!response.ok) {
    throw new Error(`Failed to load creator: ${response.status}`);
  }

  const creator = (await response.json()) as PublicCreator;

  return (
    <main>
      <h1>{creator.displayName ?? creator.slug}</h1>
      {creator.bio && <p>{creator.bio}</p>}
      {creator.website && (
        <p>
          <a href={creator.website}>{creator.website}</a>
        </p>
      )}
      <p>@{creator.slug}</p>
    </main>
  );
}
