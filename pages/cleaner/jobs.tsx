import Header from '@/components/layout/Header';
import Card from '@/components/ui/Card';

export default function CleanerJobs() {
  return (
    <>
      <Header />
      <main className="auth-wrap" style={{ minHeight: 'calc(100vh - 56px)' }}>
        <Card className="auth-card">
          <h1 className="h1 accent" style={{ marginBottom: 12 }}>Your Jobs</h1>
          <p className="muted">No jobs yet. When a manager invites you by SMS, they’ll appear here.</p>
        </Card>
      </main>
    </>
  );
}
