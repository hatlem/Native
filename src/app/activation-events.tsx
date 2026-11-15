import { prisma } from "@/lib/prisma";
import { DataLayerEvent } from "@/app/data-layer-event";

const SIGNUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Funnel instrumentation: fires `signup_completed` once (per browser session,
// see DataLayerEvent) the first time a recently created account reaches the
// signed-in app. Rendered from the first signed-in screens (home, onboarding).
// dataLayer only receives anything when GTM is configured and consent given.
export async function SignupCompletedEvent({ userId }: { userId: string }) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { createdAt: true },
  });
  if (!user || Date.now() - user.createdAt.getTime() > SIGNUP_WINDOW_MS) return null;
  return <DataLayerEvent event="signup_completed" id={userId} />;
}
