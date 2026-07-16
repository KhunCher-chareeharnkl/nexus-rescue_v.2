import VictimDashboard from './dashboard-client';
import './dashboard.css';

export default async function VictimDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const params = await searchParams;
  const initialTab = params.tab === 'status' ? 'status' : 'sos';

  return <VictimDashboard initialTab={initialTab} />;
}
