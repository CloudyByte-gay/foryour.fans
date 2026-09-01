import { redirect } from "next/navigation";
import { fetchApi } from "../../lib/serverApi";
import { BecomeCreatorForm } from "./BecomeCreatorForm";

interface OwnCreator {
  slug: string;
}

export default async function BecomeACreatorPage() {
  const meResponse = await fetchApi("/me");
  if (meResponse.status === 401) {
    redirect("/login");
  }
  if (!meResponse.ok) {
    throw new Error(`Failed to load /me: ${meResponse.status}`);
  }

  const creatorResponse = await fetchApi("/creators/me");
  if (creatorResponse.ok) {
    const creator = (await creatorResponse.json()) as OwnCreator;
    redirect(`/c/${creator.slug}`);
  }

  return (
    <main>
      <h1>Become a creator</h1>
      <BecomeCreatorForm />
    </main>
  );
}
