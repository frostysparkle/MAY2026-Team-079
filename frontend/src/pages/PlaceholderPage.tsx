/**
 * Temporary placeholder used while the router is scaffolded. Each real screen
 * replaces its route element in a later commit.
 */
export default function PlaceholderPage({ title }: { title: string }) {
  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="text-xl font-semibold text-brand">{title}</h1>
      <p className="text-muted">Screen coming in a later commit.</p>
    </main>
  );
}
