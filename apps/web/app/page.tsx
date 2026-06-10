const MODULES = [
  'HR',
  'Finance',
  'Inventory',
  'CRM',
  'Reporting',
  'Notifications',
] as const;

export default function DashboardPage() {
  return (
    <main className="shell">
      <header className="shell__header">
        <h1>MetaXperts ERP</h1>
        <p>Dashboard shell — modules are wired up in later build phases.</p>
      </header>
      <section className="shell__grid">
        {MODULES.map((name) => (
          <article key={name} className="card">
            <h2>{name}</h2>
            <span className="card__status">coming soon</span>
          </article>
        ))}
      </section>
    </main>
  );
}
