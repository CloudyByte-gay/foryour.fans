import { redirect } from "next/navigation";
import { fetchApi } from "../../../lib/serverApi";
import { CreatorSettingsForm } from "./CreatorSettingsForm";

interface OwnCreator {
  slug: string;
  displayName: string | null;
  bio: string | null;
  website: string | null;
}

export default async function CreatorSettingsPage() {
  const meResponse = await fetchApi("/me");
  if (meResponse.status === 401) {
    redirect("/login");
  }
  if (!meResponse.ok) {
    throw new Error(`Failed to load /me: ${meResponse.status}`);
  }

  const creatorResponse = await fetchApi("/creators/me");
  if (creatorResponse.status === 404) {
    redirect("/become-a-creator");
  }
  if (!creatorResponse.ok) {
    throw new Error(`Failed to load /creators/me: ${creatorResponse.status}`);
  }

  const creator = (await creatorResponse.json()) as OwnCreator;

  return (
    <main>
      <h1>Creator settings</h1>
      <CreatorSettingsForm initial={creator} />
    </main>
  );
}
