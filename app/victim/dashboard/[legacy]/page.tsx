import { notFound, permanentRedirect } from 'next/navigation';

export default async function LegacyVictimDashboardPage({
  params,
}: {
  params: Promise<{ legacy: string }>;
}) {
  const { legacy } = await params;

  if (legacy.toLowerCase() === 'page.tsx') {
    permanentRedirect('/victim/dashboard');
  }

  notFound();
}
