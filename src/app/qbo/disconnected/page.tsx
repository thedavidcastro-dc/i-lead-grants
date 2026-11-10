import Link from "next/link";

/** Intuit's "Disconnect URL": where a user lands after disconnecting the app from the QuickBooks side. */
export default function DisconnectedPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-paper px-4">
      <div className="max-w-md rounded-md border border-line bg-panel p-6">
        <h1 className="text-xl font-semibold text-navy">QuickBooks disconnected</h1>
        <p className="text-sm text-muted mt-2">
          GrantBridge no longer has access to the QuickBooks company. Synced data already in GrantBridge is kept;
          new syncs stop until an administrator reconnects.
        </p>
        <Link href="/settings/quickbooks" className="inline-block mt-4 text-navy underline">
          Go to QuickBooks settings
        </Link>
      </div>
    </main>
  );
}
